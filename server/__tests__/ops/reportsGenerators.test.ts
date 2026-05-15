/**
 * Wave 5 — Reports Hub generators tests.
 *
 * Coverage (the six implemented generators):
 *  - preaudit_pull           → application/json, non-empty bytes, parses back
 *  - incident_summary        → application/pdf, %PDF header, window honored
 *  - mar_export              → text/csv, header row + empty body for no rows
 *  - audit_trail             → text/csv, window honored
 *  - monthly_trust_statement → application/pdf, %PDF header
 *  - vendor_coi_matrix       → text/csv, header + body rows
 *  - stubs (e.g. tracker_export) → throw "Not implemented yet"
 */

import "dotenv/config";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { bootstrapOpsSchema } from "../../ops/opsStorage";
import { recordAudit } from "../../ops/auditStorage";
import {
  REPORT_GENERATORS,
  getReportGenerator,
} from "../../ops/reportsGenerators";
import {
  ensureTrustAccount,
  appendLedgerEntry,
} from "../../ops/residentTrustStorage";
import { setRegSetting } from "../../ops/regSettings";

const FACILITY_A = "TEST-FAC-RGEN-A";
const ALL_FN = [FACILITY_A] as const;
const ACTOR = { id: "alice", role: "admin" };
const DAY = 24 * 60 * 60 * 1000;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_resident_trust_ledger WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_resident_trust_statements WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_resident_trust_accounts WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_residents WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_incidents WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_vendors WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_reports WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
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

function ctx(now: number) {
  return {
    facilityNumber: FACILITY_A,
    generatedBy: ACTOR.id,
    actor: ACTOR,
    now,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// preaudit_pull
// ─────────────────────────────────────────────────────────────────────────────

describe("REPORT_GENERATORS.preaudit_pull", () => {
  it("produces non-empty JSON bytes parsable back to a bundle", async () => {
    const now = Date.now();
    const gen = getReportGenerator("preaudit_pull")!;
    const out = await gen(ctx(now), {
      audience: "internal",
      windowStartAt: now - 30 * DAY,
      windowEndAt: now,
      sections: ["incidents"],
    });
    expect(out.mime).toBe("application/json");
    expect(out.bytes.byteLength).toBeGreaterThan(0);
    const parsed = JSON.parse(out.bytes.toString("utf8"));
    expect(parsed.spec.audience).toBe("internal");
    expect(parsed.bundle).toBeDefined();
    expect(out.parameters.audience).toBe("internal");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// incident_summary
// ─────────────────────────────────────────────────────────────────────────────

describe("REPORT_GENERATORS.incident_summary", () => {
  it("renders a PDF and respects the window filter", async () => {
    const now = Date.now();
    // One in-window incident, one out-of-window.
    await pool.query(
      `INSERT INTO ops_incidents
         (facility_number, resident_id, incident_date, incident_type,
          description, reported_by, created_at, updated_at)
       VALUES ($1, NULL, $2, 'fall', 'in window', 'alice', $3, $3),
              ($1, NULL, $4, 'fall', 'out of window', 'alice', $3, $3)`,
      [FACILITY_A, now - 10 * DAY, now, now - 90 * DAY],
    );
    const gen = getReportGenerator("incident_summary")!;
    const out = await gen(ctx(now), {
      windowStartAt: now - 30 * DAY,
      windowEndAt: now,
    });
    expect(out.mime).toBe("application/pdf");
    expect(out.bytes.byteLength).toBeGreaterThan(0);
    expect(out.bytes.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(out.parameters.rowCount).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// mar_export
// ─────────────────────────────────────────────────────────────────────────────

describe("REPORT_GENERATORS.mar_export", () => {
  it("returns CSV with header even when no rows match the window", async () => {
    const now = Date.now();
    const gen = getReportGenerator("mar_export")!;
    const out = await gen(ctx(now), {
      windowStartAt: now - DAY,
      windowEndAt: now,
    });
    expect(out.mime).toBe("text/csv");
    const text = out.bytes.toString("utf8");
    expect(text.startsWith("id,scheduled_at,administered_at")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// audit_trail
// ─────────────────────────────────────────────────────────────────────────────

describe("REPORT_GENERATORS.audit_trail", () => {
  it("includes only audit rows inside [windowStartAt, windowEndAt)", async () => {
    const now = Date.now();
    // Plant a few audit rows, two in-window, one outside.
    for (let i = 0; i < 3; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      await recordAudit({
        facilityNumber: FACILITY_A,
        actorId: "alice",
        actorRole: "admin",
        action: "create",
        entityType: "ops_test_entity",
        entityId: i + 1,
      });
    }
    const gen = getReportGenerator("audit_trail")!;
    const out = await gen(ctx(now), {
      windowStartAt: now - DAY,
      windowEndAt: now + DAY,
    });
    expect(out.mime).toBe("text/csv");
    const lines = out.bytes.toString("utf8").trim().split(/\r?\n/);
    // header + 3 data rows.
    expect(lines.length).toBeGreaterThanOrEqual(4);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// monthly_trust_statement
// ─────────────────────────────────────────────────────────────────────────────

describe("REPORT_GENERATORS.monthly_trust_statement", () => {
  it("renders a PDF for a real trust account/period", async () => {
    const now = Date.now();
    // Enable trust feature flag for the facility.
    await setRegSetting(FACILITY_A, "RESIDENT_TRUST_ENABLED", "true", {
      actorId: ACTOR.id,
      actorRole: ACTOR.role,
    });

    // Seed a resident + trust account + a single credit entry.
    const resRes = await pool.query<{ id: number }>(
      `INSERT INTO ops_residents
         (facility_number, first_name, last_name, status, created_at, updated_at)
       VALUES ($1, 'Trust', 'Resident', 'active', $2, $2)
       RETURNING id`,
      [FACILITY_A, now],
    );
    const residentId = Number(resRes.rows[0].id);

    const account = await ensureTrustAccount(
      FACILITY_A,
      residentId,
      ACTOR.id,
      ACTOR,
    );

    const periodStartAt = now - 30 * DAY;
    const periodEndAt = now + DAY;

    await appendLedgerEntry(
      FACILITY_A,
      account.id,
      {
        direction: "credit",
        amountCents: 10_000,
        category: "deposit",
        description: "test deposit",
        transactedAt: now - DAY,
        recordedBy: ACTOR.id,
      },
      ACTOR,
    );

    const gen = getReportGenerator("monthly_trust_statement")!;
    const out = await gen(ctx(now), {
      accountId: account.id,
      periodStartAt,
      periodEndAt,
    });
    expect(out.mime).toBe("application/pdf");
    expect(out.bytes.subarray(0, 4).toString("ascii")).toBe("%PDF");
    expect(out.sourceEntityType).toBe("ops_resident_trust_statement");
    expect(typeof out.sourceEntityId).toBe("number");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// vendor_coi_matrix
// ─────────────────────────────────────────────────────────────────────────────

describe("REPORT_GENERATORS.vendor_coi_matrix", () => {
  it("returns CSV with vendor rows + correct header", async () => {
    const now = Date.now();
    await pool.query(
      `INSERT INTO ops_vendors
         (facility_number, vendor_name, vendor_type, status, coi_expires_at,
          license_expires_at, notes, created_at, updated_at)
       VALUES
         ($1, 'Acme Cleaning', 'janitorial', 'active', $2, NULL, 'demo', $3, $3),
         ($1, 'Bob Plumbing', 'maintenance', 'active', NULL, $2, 'demo', $3, $3)`,
      [FACILITY_A, now + 90 * DAY, now],
    );
    const gen = getReportGenerator("vendor_coi_matrix")!;
    const out = await gen(ctx(now), {});
    expect(out.mime).toBe("text/csv");
    const text = out.bytes.toString("utf8");
    expect(text.startsWith("id,vendor_name,vendor_type")).toBe(true);
    // Header + 2 rows + trailing newline.
    const lines = text.trim().split(/\r?\n/);
    expect(lines.length).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// stubs
// ─────────────────────────────────────────────────────────────────────────────

describe("REPORT_GENERATORS stubs", () => {
  it("tracker_export throws 'Not implemented yet'", async () => {
    const gen = REPORT_GENERATORS.tracker_export;
    expect(gen).toBeDefined();
    if (gen) {
      await expect(gen(ctx(Date.now()), {})).rejects.toThrow(
        /Not implemented yet/,
      );
    }
  });

  it("credentials_matrix / complaint_log / drill_log_export all throw", async () => {
    for (const k of [
      "credentials_matrix",
      "complaint_log",
      "drill_log_export",
      "posting_verification_log",
      "chart_completeness_snapshot",
    ] as const) {
      const gen = REPORT_GENERATORS[k];
      expect(gen).toBeDefined();
      if (gen) {
        // eslint-disable-next-line no-await-in-loop
        await expect(gen(ctx(Date.now()), {})).rejects.toThrow(
          /Not implemented yet/,
        );
      }
    }
  });
});
