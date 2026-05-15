/**
 * Wave 4 Phase 4.2 (W12) — Resident trust account storage tests.
 *
 * Coverage:
 *  - Feature gate: isTrustEnabled returns false by default; reg-setting
 *    flip turns it on.
 *  - Account open/close:
 *      • ensureTrustAccount is idempotent on the second call.
 *      • closeTrustAccount rejects when balance != 0.
 *      • closeTrustAccount succeeds when balance == 0.
 *  - Ledger append:
 *      • credit increases balance, debit decreases.
 *      • amountCents must be a positive integer.
 *      • Dual-sig: debit without witness rejected when required.
 *      • Dual-sig: debit with witness == recordedBy rejected.
 *      • Dual-sig OFF reg-setting allows debit without witness.
 *  - Reversal: opposite-direction entry with same amount, balance returns
 *    to pre-original state, reverses_entry_id wired.
 *  - Reconcile: clean ledger shows zero drift; manual cache corruption
 *    surfaces the drift; repairBalance fixes the cache.
 *  - Statement idempotency: same (account, period) returns the same row.
 *
 * Test harness conventions reused from server/__tests__/ops/postings.test.ts.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { bootstrapOpsSchema } from "../../ops/opsStorage";
import {
  appendLedgerEntry,
  closeTrustAccount,
  ensureTrustAccount,
  generateMonthlyStatement,
  isTrustEnabled,
  listLedger,
  listStatements,
  listTrustAccounts,
  reconcileAccount,
  recordReversal,
  repairBalance,
  TrustDomainError,
} from "../../ops/residentTrustStorage";
import { setRegSetting } from "../../ops/regSettings";

const FACILITY_A = "TEST-FAC-TRUST-A";
const FACILITY_B = "TEST-FAC-TRUST-B";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const ACTOR = { id: "alice", role: "admin" };
const WITNESS_ID = "bob";

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_resident_trust_statements WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_resident_trust_ledger     WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_resident_trust_accounts   WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail                WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_facility_settings          WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
}

async function enableTrust(fn: string, dualSig: boolean = true): Promise<void> {
  await setRegSetting(fn, "RESIDENT_TRUST_ENABLED", "true", {
    actorId: ACTOR.id,
    actorRole: ACTOR.role,
  });
  await setRegSetting(
    fn,
    "RESIDENT_TRUST_DUAL_SIG_REQUIRED",
    dualSig ? "true" : "false",
    { actorId: ACTOR.id, actorRole: ACTOR.role },
  );
}

beforeAll(async () => {
  await bootstrapMainSchema();
  await bootstrapOpsSchema();
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

beforeEach(async () => {
  await cleanup();
});

describe("isTrustEnabled", () => {
  it("returns false when the reg-setting is unset (catalog default)", async () => {
    expect(await isTrustEnabled(FACILITY_A)).toBe(false);
  });

  it("returns true once RESIDENT_TRUST_ENABLED is set to 'true'", async () => {
    await enableTrust(FACILITY_A);
    expect(await isTrustEnabled(FACILITY_A)).toBe(true);
  });
});

describe("ensureTrustAccount + closeTrustAccount", () => {
  it("ensureTrustAccount is idempotent", async () => {
    await enableTrust(FACILITY_A);
    const a1 = await ensureTrustAccount(FACILITY_A, 100, ACTOR.id, ACTOR);
    const a2 = await ensureTrustAccount(FACILITY_A, 100, ACTOR.id, ACTOR);
    expect(a1.id).toBe(a2.id);
    expect(a1.status).toBe("active");
    expect(a1.balanceCents).toBe(0);
  });

  it("close rejects when balance is non-zero", async () => {
    await enableTrust(FACILITY_A);
    const acct = await ensureTrustAccount(FACILITY_A, 101, ACTOR.id, ACTOR);
    await appendLedgerEntry(
      FACILITY_A,
      acct.id,
      {
        direction: "credit",
        amountCents: 1000,
        category: "cash_deposit",
        description: "Family deposit",
        transactedAt: Date.now(),
        recordedBy: ACTOR.id,
      },
      ACTOR,
    );
    await expect(
      closeTrustAccount(acct.id, FACILITY_A, ACTOR.id, ACTOR),
    ).rejects.toBeInstanceOf(TrustDomainError);
  });

  it("close succeeds when balance is zero", async () => {
    await enableTrust(FACILITY_A);
    const acct = await ensureTrustAccount(FACILITY_A, 102, ACTOR.id, ACTOR);
    const closed = await closeTrustAccount(acct.id, FACILITY_A, ACTOR.id, ACTOR);
    expect(closed?.status).toBe("closed");
    expect(closed?.closedAt).toBeGreaterThan(0);
  });

  it("listTrustAccounts isolates tenants", async () => {
    await enableTrust(FACILITY_A);
    await enableTrust(FACILITY_B);
    await ensureTrustAccount(FACILITY_A, 200, ACTOR.id, ACTOR);
    await ensureTrustAccount(FACILITY_B, 200, ACTOR.id, ACTOR);
    const aRows = await listTrustAccounts(FACILITY_A);
    const bRows = await listTrustAccounts(FACILITY_B);
    expect(aRows.length).toBe(1);
    expect(bRows.length).toBe(1);
    expect(aRows[0].facilityNumber).toBe(FACILITY_A);
    expect(bRows[0].facilityNumber).toBe(FACILITY_B);
  });
});

describe("appendLedgerEntry", () => {
  it("credit increases the cached balance", async () => {
    await enableTrust(FACILITY_A);
    const acct = await ensureTrustAccount(FACILITY_A, 300, ACTOR.id, ACTOR);
    await appendLedgerEntry(
      FACILITY_A,
      acct.id,
      {
        direction: "credit",
        amountCents: 2500,
        category: "cash_deposit",
        description: "Initial deposit",
        transactedAt: Date.now(),
        recordedBy: ACTOR.id,
      },
      ACTOR,
    );
    const { rows } = await listLedger(FACILITY_A, {
      accountId: acct.id,
      page: 1,
      limit: 50,
    });
    expect(rows.length).toBe(1);
    const r = await pool.query<{ balance_cents: string }>(
      `SELECT balance_cents FROM ops_resident_trust_accounts WHERE id = $1`,
      [acct.id],
    );
    expect(Number(r.rows[0].balance_cents)).toBe(2500);
  });

  it("debit decreases the cached balance (witness supplied)", async () => {
    await enableTrust(FACILITY_A);
    const acct = await ensureTrustAccount(FACILITY_A, 301, ACTOR.id, ACTOR);
    await appendLedgerEntry(
      FACILITY_A,
      acct.id,
      {
        direction: "credit",
        amountCents: 5000,
        category: "cash_deposit",
        description: "Family deposit",
        transactedAt: Date.now(),
        recordedBy: ACTOR.id,
      },
      ACTOR,
    );
    await appendLedgerEntry(
      FACILITY_A,
      acct.id,
      {
        direction: "debit",
        amountCents: 1200,
        category: "haircut",
        description: "Salon visit",
        transactedAt: Date.now(),
        recordedBy: ACTOR.id,
        witnessedBy: WITNESS_ID,
      },
      ACTOR,
    );
    const r = await pool.query<{ balance_cents: string }>(
      `SELECT balance_cents FROM ops_resident_trust_accounts WHERE id = $1`,
      [acct.id],
    );
    expect(Number(r.rows[0].balance_cents)).toBe(3800);
  });

  it("rejects amountCents <= 0", async () => {
    await enableTrust(FACILITY_A);
    const acct = await ensureTrustAccount(FACILITY_A, 302, ACTOR.id, ACTOR);
    await expect(
      appendLedgerEntry(
        FACILITY_A,
        acct.id,
        {
          direction: "credit",
          amountCents: 0,
          category: "cash_deposit",
          description: "bad",
          transactedAt: Date.now(),
          recordedBy: ACTOR.id,
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(TrustDomainError);
  });

  it("dual-sig: debit without witness is rejected when required", async () => {
    await enableTrust(FACILITY_A, /* dualSig */ true);
    const acct = await ensureTrustAccount(FACILITY_A, 303, ACTOR.id, ACTOR);
    await appendLedgerEntry(
      FACILITY_A,
      acct.id,
      {
        direction: "credit",
        amountCents: 1000,
        category: "cash_deposit",
        description: "seed",
        transactedAt: Date.now(),
        recordedBy: ACTOR.id,
      },
      ACTOR,
    );
    await expect(
      appendLedgerEntry(
        FACILITY_A,
        acct.id,
        {
          direction: "debit",
          amountCents: 500,
          category: "haircut",
          description: "no witness",
          transactedAt: Date.now(),
          recordedBy: ACTOR.id,
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(TrustDomainError);
  });

  it("dual-sig: witness identical to recordedBy is rejected", async () => {
    await enableTrust(FACILITY_A, /* dualSig */ true);
    const acct = await ensureTrustAccount(FACILITY_A, 304, ACTOR.id, ACTOR);
    await appendLedgerEntry(
      FACILITY_A,
      acct.id,
      {
        direction: "credit",
        amountCents: 1000,
        category: "cash_deposit",
        description: "seed",
        transactedAt: Date.now(),
        recordedBy: ACTOR.id,
      },
      ACTOR,
    );
    await expect(
      appendLedgerEntry(
        FACILITY_A,
        acct.id,
        {
          direction: "debit",
          amountCents: 500,
          category: "haircut",
          description: "same person",
          transactedAt: Date.now(),
          recordedBy: ACTOR.id,
          witnessedBy: ACTOR.id,
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(TrustDomainError);
  });

  it("dual-sig OFF: debit without witness succeeds", async () => {
    await enableTrust(FACILITY_A, /* dualSig */ false);
    const acct = await ensureTrustAccount(FACILITY_A, 305, ACTOR.id, ACTOR);
    await appendLedgerEntry(
      FACILITY_A,
      acct.id,
      {
        direction: "credit",
        amountCents: 1000,
        category: "cash_deposit",
        description: "seed",
        transactedAt: Date.now(),
        recordedBy: ACTOR.id,
      },
      ACTOR,
    );
    const row = await appendLedgerEntry(
      FACILITY_A,
      acct.id,
      {
        direction: "debit",
        amountCents: 500,
        category: "haircut",
        description: "no witness needed",
        transactedAt: Date.now(),
        recordedBy: ACTOR.id,
      },
      ACTOR,
    );
    expect(row.direction).toBe("debit");
  });

  it("rejects append when account is closed", async () => {
    await enableTrust(FACILITY_A);
    const acct = await ensureTrustAccount(FACILITY_A, 306, ACTOR.id, ACTOR);
    await closeTrustAccount(acct.id, FACILITY_A, ACTOR.id, ACTOR);
    await expect(
      appendLedgerEntry(
        FACILITY_A,
        acct.id,
        {
          direction: "credit",
          amountCents: 100,
          category: "cash_deposit",
          description: "post-close",
          transactedAt: Date.now(),
          recordedBy: ACTOR.id,
        },
        ACTOR,
      ),
    ).rejects.toBeInstanceOf(TrustDomainError);
  });
});

describe("recordReversal", () => {
  it("reverses a credit (opposite direction, sets reverses_entry_id, balance returns)", async () => {
    await enableTrust(FACILITY_A);
    const acct = await ensureTrustAccount(FACILITY_A, 400, ACTOR.id, ACTOR);
    const orig = await appendLedgerEntry(
      FACILITY_A,
      acct.id,
      {
        direction: "credit",
        amountCents: 5000,
        category: "cash_deposit",
        description: "Wrong deposit",
        transactedAt: Date.now(),
        recordedBy: ACTOR.id,
      },
      ACTOR,
    );
    const reversal = await recordReversal(
      FACILITY_A,
      orig.id,
      "Posted to wrong resident",
      ACTOR,
    );
    expect(reversal.direction).toBe("debit");
    expect(reversal.amountCents).toBe(5000);
    expect(reversal.category).toBe("reversal");
    expect(reversal.reversesEntryId).toBe(orig.id);

    const r = await pool.query<{ balance_cents: string }>(
      `SELECT balance_cents FROM ops_resident_trust_accounts WHERE id = $1`,
      [acct.id],
    );
    expect(Number(r.rows[0].balance_cents)).toBe(0);
  });
});

describe("reconcileAccount + repairBalance", () => {
  it("clean ledger has zero drift", async () => {
    await enableTrust(FACILITY_A);
    const acct = await ensureTrustAccount(FACILITY_A, 500, ACTOR.id, ACTOR);
    await appendLedgerEntry(
      FACILITY_A,
      acct.id,
      {
        direction: "credit",
        amountCents: 700,
        category: "cash_deposit",
        description: "seed",
        transactedAt: Date.now(),
        recordedBy: ACTOR.id,
      },
      ACTOR,
    );
    const r = await reconcileAccount(acct.id, FACILITY_A);
    expect(r.drift).toBe(0);
    expect(r.computedCents).toBe(700);
    expect(r.cachedCents).toBe(700);
  });

  it("manual cache corruption shows drift; repairBalance fixes it", async () => {
    await enableTrust(FACILITY_A);
    const acct = await ensureTrustAccount(FACILITY_A, 501, ACTOR.id, ACTOR);
    await appendLedgerEntry(
      FACILITY_A,
      acct.id,
      {
        direction: "credit",
        amountCents: 1234,
        category: "cash_deposit",
        description: "seed",
        transactedAt: Date.now(),
        recordedBy: ACTOR.id,
      },
      ACTOR,
    );
    // Corrupt the cached balance.
    await pool.query(
      `UPDATE ops_resident_trust_accounts SET balance_cents = $1 WHERE id = $2`,
      [9999, acct.id],
    );
    const drift = await reconcileAccount(acct.id, FACILITY_A);
    expect(drift.drift).not.toBe(0);
    expect(drift.computedCents).toBe(1234);
    expect(drift.cachedCents).toBe(9999);

    const repaired = await repairBalance(acct.id, FACILITY_A, ACTOR);
    expect(repaired?.balanceCents).toBe(1234);
    const after = await reconcileAccount(acct.id, FACILITY_A);
    expect(after.drift).toBe(0);
  });
});

describe("generateMonthlyStatement", () => {
  it("is idempotent for the same (account, period)", async () => {
    await enableTrust(FACILITY_A);
    const acct = await ensureTrustAccount(FACILITY_A, 600, ACTOR.id, ACTOR);
    const periodStart = Date.UTC(2026, 0, 1);
    const periodEnd = Date.UTC(2026, 1, 1);
    await appendLedgerEntry(
      FACILITY_A,
      acct.id,
      {
        direction: "credit",
        amountCents: 1000,
        category: "cash_deposit",
        description: "in-period",
        transactedAt: Date.UTC(2026, 0, 15),
        recordedBy: ACTOR.id,
      },
      ACTOR,
    );
    const s1 = await generateMonthlyStatement(
      FACILITY_A,
      acct.id,
      periodStart,
      periodEnd,
      ACTOR.id,
      ACTOR,
    );
    const s2 = await generateMonthlyStatement(
      FACILITY_A,
      acct.id,
      periodStart,
      periodEnd,
      ACTOR.id,
      ACTOR,
    );
    expect(s2.id).toBe(s1.id);
    expect(s1.creditTotalCents).toBe(1000);
    expect(s1.closingBalanceCents).toBe(1000);
    expect(s1.entryCount).toBe(1);
    const list = await listStatements(FACILITY_A, acct.id, { page: 1, limit: 50 });
    expect(list.total).toBe(1);
  });
});
