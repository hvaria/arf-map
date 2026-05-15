/**
 * Wave 4 Phase 4.2 (W12) — Resident trust accounts storage.
 *
 * Pattern reused: mirrors server/ops/postingsStorage.ts —
 *   - Module-level async functions, shared Drizzle `db` + raw `pool`.
 *   - Tenant isolation enforced at the storage layer (every WHERE carries
 *     facility_number).
 *   - Every mutation emits an audit row via `recordAudit({ entityType:
 *     'ops_resident_trust_*', … })` wrapped in safeAudit so an audit
 *     failure never rolls back the user-visible mutation.
 *
 * Feature gate: the catalog row RESIDENT_TRUST_ENABLED defaults to "false".
 * `isTrustEnabled()` is the canonical reader; routes call it first (via
 * the requireTrustEnabled middleware) so disabled facilities pay no DB
 * cost beyond the reg-settings cache hit.
 *
 * Ledger contract: insert-only at this layer (no UPDATE / DELETE helpers
 * are exported). Corrections happen via `recordReversal()` which inserts
 * a new opposite-direction row with `reverses_entry_id` pointing back.
 * Cached `balance_cents` on the account is a write-through optimization;
 * `reconcileAccount()` always reads ground-truth from SUM(signed deltas)
 * across the ledger so the inspector-facing surface can detect drift.
 */

import { and, asc, eq, gte, lt, sql } from "drizzle-orm";

import { db, pool } from "../db/index";
import {
  opsResidentTrustAccounts,
  opsResidentTrustLedger,
  opsResidentTrustStatements,
  type OpsResidentTrustAccount,
  type OpsResidentTrustLedgerEntry,
  type OpsResidentTrustStatement,
} from "./opsSchema";
import { recordAudit, type AuditActor } from "./auditStorage";
import { getRegSetting } from "./regSettings";
import {
  signedDeltaCents,
  canCloseAccount,
  type TrustLedgerDirection,
  type TrustLedgerCategory,
} from "@shared/resident-trust";

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class TrustDomainError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "TrustDomainError";
    this.code = code;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit helper
// ─────────────────────────────────────────────────────────────────────────────

async function safeAudit(args: {
  facilityNumber: string;
  actor: AuditActor;
  action: "create" | "update" | "delete" | "close";
  entityType:
    | "ops_resident_trust_account"
    | "ops_resident_trust_ledger"
    | "ops_resident_trust_statement";
  entityId: number;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  try {
    await recordAudit({
      facilityNumber: args.facilityNumber,
      actorId: args.actor.id,
      actorRole: args.actor.role,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      before: args.before,
      after: args.after,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[ops] audit emit failed for ${args.entityType}#${args.entityId}`,
      err,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Feature gate
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reads RESIDENT_TRUST_ENABLED for the facility. Returns true iff the
 * value is exactly the string "true". Any other value (or read failure)
 * returns false so the feature stays opt-in by construction.
 */
export async function isTrustEnabled(facilityNumber: string): Promise<boolean> {
  try {
    const v = await getRegSetting(facilityNumber, "RESIDENT_TRUST_ENABLED");
    return v === "true";
  } catch {
    return false;
  }
}

async function isDualSigRequired(facilityNumber: string): Promise<boolean> {
  try {
    const v = await getRegSetting(
      facilityNumber,
      "RESIDENT_TRUST_DUAL_SIG_REQUIRED",
    );
    return v === "true";
  } catch {
    // Safer to require a witness when the read fails — surfaces a bug
    // sooner than silently letting a single-sig debit through.
    return true;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Accounts
// ─────────────────────────────────────────────────────────────────────────────

export async function listTrustAccounts(
  facilityNumber: string,
  opts: { residentId?: number; status?: "active" | "closed"; includeClosed?: boolean } = {},
): Promise<OpsResidentTrustAccount[]> {
  const conds = [eq(opsResidentTrustAccounts.facilityNumber, facilityNumber)];
  if (typeof opts.residentId === "number") {
    conds.push(eq(opsResidentTrustAccounts.residentId, opts.residentId));
  }
  if (opts.status) {
    conds.push(eq(opsResidentTrustAccounts.status, opts.status));
  } else if (!opts.includeClosed) {
    conds.push(eq(opsResidentTrustAccounts.status, "active"));
  }
  return db
    .select()
    .from(opsResidentTrustAccounts)
    .where(and(...conds))
    .orderBy(asc(opsResidentTrustAccounts.residentId));
}

export async function getTrustAccount(
  id: number,
  facilityNumber: string,
): Promise<OpsResidentTrustAccount | undefined> {
  const rows = await db
    .select()
    .from(opsResidentTrustAccounts)
    .where(
      and(
        eq(opsResidentTrustAccounts.id, id),
        eq(opsResidentTrustAccounts.facilityNumber, facilityNumber),
      ),
    )
    .limit(1);
  return rows[0] as OpsResidentTrustAccount | undefined;
}

/**
 * Idempotent: returns the existing active account for (facility, resident)
 * if one is open, otherwise opens a fresh row. The partial UNIQUE index
 * `uniq_ops_trust_resident` guarantees at most one active account per
 * resident; we catch 23505 defensively in case of a race.
 */
export async function ensureTrustAccount(
  facilityNumber: string,
  residentId: number,
  openedBy: string,
  actor: AuditActor,
): Promise<OpsResidentTrustAccount> {
  // Fast path: look for an active row first.
  const existing = await db
    .select()
    .from(opsResidentTrustAccounts)
    .where(
      and(
        eq(opsResidentTrustAccounts.facilityNumber, facilityNumber),
        eq(opsResidentTrustAccounts.residentId, residentId),
        eq(opsResidentTrustAccounts.status, "active"),
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    return existing[0] as OpsResidentTrustAccount;
  }

  const now = Date.now();
  try {
    const rows = await db
      .insert(opsResidentTrustAccounts)
      .values({
        facilityNumber,
        residentId,
        balanceCents: 0,
        status: "active",
        openedAt: now,
        createdBy: openedBy,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const row = rows[0] as OpsResidentTrustAccount;
    await safeAudit({
      facilityNumber,
      actor,
      action: "create",
      entityType: "ops_resident_trust_account",
      entityId: row.id,
      after: row,
    });
    return row;
  } catch (err) {
    // Partial unique race — re-read.
    if ((err as { code?: string }).code === "23505") {
      const retry = await db
        .select()
        .from(opsResidentTrustAccounts)
        .where(
          and(
            eq(opsResidentTrustAccounts.facilityNumber, facilityNumber),
            eq(opsResidentTrustAccounts.residentId, residentId),
            eq(opsResidentTrustAccounts.status, "active"),
          ),
        )
        .limit(1);
      if (retry[0]) return retry[0] as OpsResidentTrustAccount;
    }
    throw err;
  }
}

/**
 * Close an active account. Rejects when balance != 0 (per
 * `canCloseAccount` from shared). Returns undefined when the account is
 * not found; throws TrustDomainError when the balance gate fails.
 */
export async function closeTrustAccount(
  id: number,
  facilityNumber: string,
  closedBy: string,
  actor: AuditActor,
): Promise<OpsResidentTrustAccount | undefined> {
  const existing = await getTrustAccount(id, facilityNumber);
  if (!existing) return undefined;
  if (existing.status === "closed") return existing; // idempotent
  if (!canCloseAccount(existing.balanceCents)) {
    throw new TrustDomainError(
      "balance_not_zero",
      "Trust account balance must be zero before closing",
    );
  }
  const now = Date.now();
  const rows = await db
    .update(opsResidentTrustAccounts)
    .set({
      status: "closed",
      closedAt: now,
      closedBy,
      updatedAt: now,
    })
    .where(
      and(
        eq(opsResidentTrustAccounts.id, id),
        eq(opsResidentTrustAccounts.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const row = rows[0] as OpsResidentTrustAccount | undefined;
  if (row) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "close",
      entityType: "ops_resident_trust_account",
      entityId: row.id,
      before: existing,
      after: row,
    });
  }
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ledger
// ─────────────────────────────────────────────────────────────────────────────

export interface AppendLedgerEntryInput {
  direction: TrustLedgerDirection;
  amountCents: number;
  category: TrustLedgerCategory;
  description: string;
  transactedAt: number;
  recordedBy: string;
  witnessedBy?: string;
  notes?: string;
  receiptUri?: string;
}

/**
 * Append a credit or debit. Domain rules:
 *  - account must be active
 *  - amountCents must be a positive integer
 *  - direction='debit' requires a witness when
 *    RESIDENT_TRUST_DUAL_SIG_REQUIRED='true', and the witness must differ
 *    from the recorder (dual-signature).
 *
 * After the insert the account's cached `balance_cents` is updated. Cache
 * write-through is best-effort: if it fails we still return the inserted
 * ledger row (reconcile() can rebuild the cache from the ledger).
 */
export async function appendLedgerEntry(
  facilityNumber: string,
  accountId: number,
  input: AppendLedgerEntryInput,
  actor: AuditActor,
): Promise<OpsResidentTrustLedgerEntry> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    throw new TrustDomainError(
      "invalid_amount",
      "Amount must be a positive integer (cents)",
    );
  }

  const account = await getTrustAccount(accountId, facilityNumber);
  if (!account) {
    throw new TrustDomainError(
      "account_not_found",
      "Trust account not found",
    );
  }
  if (account.status !== "active") {
    throw new TrustDomainError(
      "account_closed",
      "Trust account is closed",
    );
  }

  if (input.direction === "debit") {
    const dualSig = await isDualSigRequired(facilityNumber);
    if (dualSig) {
      if (!input.witnessedBy || !input.witnessedBy.trim()) {
        throw new TrustDomainError(
          "witness_required",
          "Debits require a witnessing staff member (dual signature)",
        );
      }
      if (input.witnessedBy.trim() === input.recordedBy.trim()) {
        throw new TrustDomainError(
          "witness_distinct",
          "Witness must be different from the recording staff member",
        );
      }
    }
  }

  const now = Date.now();
  const rows = await db
    .insert(opsResidentTrustLedger)
    .values({
      facilityNumber,
      accountId,
      residentId: account.residentId,
      direction: input.direction,
      amountCents: input.amountCents,
      category: input.category,
      description: input.description,
      transactedAt: input.transactedAt,
      recordedBy: input.recordedBy,
      witnessedBy: input.witnessedBy ?? null,
      reversesEntryId: null,
      receiptUri: input.receiptUri ?? null,
      notes: input.notes ?? null,
      createdAt: now,
    })
    .returning();
  const row = rows[0] as OpsResidentTrustLedgerEntry;

  // Write-through cache update. Best-effort.
  const delta = signedDeltaCents(input.direction, input.amountCents);
  try {
    await db
      .update(opsResidentTrustAccounts)
      .set({
        balanceCents: sql`${opsResidentTrustAccounts.balanceCents} + ${delta}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(opsResidentTrustAccounts.id, accountId),
          eq(opsResidentTrustAccounts.facilityNumber, facilityNumber),
        ),
      );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[ops] trust balance cache update failed for account ${accountId}`,
      err,
    );
  }

  await safeAudit({
    facilityNumber,
    actor,
    action: "create",
    entityType: "ops_resident_trust_ledger",
    entityId: row.id,
    after: row,
  });
  return row;
}

/**
 * Record a reversal — appends a new ledger row with category='reversal'
 * and the opposite direction, then updates the cached balance. The
 * original row stays put (insert-only contract).
 */
export async function recordReversal(
  facilityNumber: string,
  originalEntryId: number,
  reason: string,
  actor: AuditActor,
): Promise<OpsResidentTrustLedgerEntry> {
  const origRows = await db
    .select()
    .from(opsResidentTrustLedger)
    .where(
      and(
        eq(opsResidentTrustLedger.id, originalEntryId),
        eq(opsResidentTrustLedger.facilityNumber, facilityNumber),
      ),
    )
    .limit(1);
  const orig = origRows[0] as OpsResidentTrustLedgerEntry | undefined;
  if (!orig) {
    throw new TrustDomainError(
      "entry_not_found",
      "Original ledger entry not found",
    );
  }

  const account = await getTrustAccount(orig.accountId, facilityNumber);
  if (!account) {
    throw new TrustDomainError(
      "account_not_found",
      "Trust account not found",
    );
  }
  if (account.status !== "active") {
    throw new TrustDomainError(
      "account_closed",
      "Trust account is closed",
    );
  }

  const oppositeDirection: TrustLedgerDirection =
    orig.direction === "credit" ? "debit" : "credit";
  const now = Date.now();

  const rows = await db
    .insert(opsResidentTrustLedger)
    .values({
      facilityNumber,
      accountId: orig.accountId,
      residentId: orig.residentId,
      direction: oppositeDirection,
      amountCents: orig.amountCents,
      category: "reversal",
      description: `Reversal of #${orig.id}: ${reason}`,
      transactedAt: now,
      // Reversal records use the actor as the recorder; witness deliberately
      // omitted because the reversal carries the original transaction's
      // forensic context and the dual-sig gate applies to the original debit.
      recordedBy: actor.id,
      witnessedBy: null,
      reversesEntryId: orig.id,
      receiptUri: null,
      notes: reason,
      createdAt: now,
    })
    .returning();
  const reversal = rows[0] as OpsResidentTrustLedgerEntry;

  const delta = signedDeltaCents(oppositeDirection, orig.amountCents);
  try {
    await db
      .update(opsResidentTrustAccounts)
      .set({
        balanceCents: sql`${opsResidentTrustAccounts.balanceCents} + ${delta}`,
        updatedAt: now,
      })
      .where(
        and(
          eq(opsResidentTrustAccounts.id, orig.accountId),
          eq(opsResidentTrustAccounts.facilityNumber, facilityNumber),
        ),
      );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[ops] trust balance cache update failed for reversal of #${orig.id}`,
      err,
    );
  }

  await safeAudit({
    facilityNumber,
    actor,
    action: "create",
    entityType: "ops_resident_trust_ledger",
    entityId: reversal.id,
    before: orig,
    after: reversal,
  });
  return reversal;
}

export async function listLedger(
  facilityNumber: string,
  opts: { accountId: number; sinceMs?: number; untilMs?: number; page: number; limit: number },
): Promise<{ rows: OpsResidentTrustLedgerEntry[]; total: number }> {
  const conds = [
    eq(opsResidentTrustLedger.facilityNumber, facilityNumber),
    eq(opsResidentTrustLedger.accountId, opts.accountId),
  ];
  if (typeof opts.sinceMs === "number") {
    conds.push(gte(opsResidentTrustLedger.transactedAt, opts.sinceMs));
  }
  if (typeof opts.untilMs === "number") {
    conds.push(lt(opsResidentTrustLedger.transactedAt, opts.untilMs));
  }
  const where = and(...conds);
  const offset = (opts.page - 1) * opts.limit;
  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(opsResidentTrustLedger)
      .where(where)
      .orderBy(asc(opsResidentTrustLedger.transactedAt), asc(opsResidentTrustLedger.id))
      .limit(opts.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsResidentTrustLedger)
      .where(where),
  ]);
  return { rows, total: countRows[0]?.count ?? 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Reconciliation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Reconciles the ledger SUM(signed deltas) vs the cached balance on the
 * account. Returns both numbers + the drift. The caller decides what to
 * do with drift; the route exposes it directly to the admin.
 */
export async function reconcileAccount(
  accountId: number,
  facilityNumber: string,
): Promise<{ computedCents: number; cachedCents: number; drift: number }> {
  const account = await getTrustAccount(accountId, facilityNumber);
  if (!account) {
    throw new TrustDomainError(
      "account_not_found",
      "Trust account not found",
    );
  }

  // SUM via Drizzle. Cast to int via ::bigint and then number — the
  // per-account total stays well within JS-safe-integer range.
  const result = await pool.query<{ total: string | null }>(
    `SELECT COALESCE(
       SUM(CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END),
       0
     )::bigint AS total
     FROM ops_resident_trust_ledger
     WHERE facility_number = $1 AND account_id = $2`,
    [facilityNumber, accountId],
  );
  const computed = Number(result.rows[0]?.total ?? 0);
  const cached = account.balanceCents;
  return {
    computedCents: computed,
    cachedCents: cached,
    drift: cached - computed,
  };
}

/**
 * Best-effort cache repair: sets balance_cents to the SUM(signed deltas)
 * computed from the ledger. Audited as an update on the account row.
 */
export async function repairBalance(
  accountId: number,
  facilityNumber: string,
  actor: AuditActor,
): Promise<OpsResidentTrustAccount | undefined> {
  const before = await getTrustAccount(accountId, facilityNumber);
  if (!before) return undefined;
  const { computedCents } = await reconcileAccount(accountId, facilityNumber);
  const now = Date.now();
  const rows = await db
    .update(opsResidentTrustAccounts)
    .set({ balanceCents: computedCents, updatedAt: now })
    .where(
      and(
        eq(opsResidentTrustAccounts.id, accountId),
        eq(opsResidentTrustAccounts.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const after = rows[0] as OpsResidentTrustAccount | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "update",
      entityType: "ops_resident_trust_account",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

// ─────────────────────────────────────────────────────────────────────────────
// Statements
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a statement snapshot for [periodStartAt, periodEndAt).
 * Idempotent for the same (account, period) — returns the existing row if
 * present.
 *
 * Snapshot math:
 *   - opening balance = SUM(signed deltas) WHERE transacted_at < periodStartAt
 *   - closing balance = SUM(signed deltas) WHERE transacted_at < periodEndAt
 *   - credit/debit totals + entryCount over [start, end)
 */
export async function generateMonthlyStatement(
  facilityNumber: string,
  accountId: number,
  periodStartAt: number,
  periodEndAt: number,
  generatedBy: string,
  actor: AuditActor,
): Promise<OpsResidentTrustStatement> {
  if (!(periodStartAt < periodEndAt)) {
    throw new TrustDomainError(
      "invalid_period",
      "periodStartAt must be strictly less than periodEndAt",
    );
  }
  const account = await getTrustAccount(accountId, facilityNumber);
  if (!account) {
    throw new TrustDomainError(
      "account_not_found",
      "Trust account not found",
    );
  }

  // Idempotency check.
  const existingRows = await db
    .select()
    .from(opsResidentTrustStatements)
    .where(
      and(
        eq(opsResidentTrustStatements.facilityNumber, facilityNumber),
        eq(opsResidentTrustStatements.accountId, accountId),
        eq(opsResidentTrustStatements.periodStartAt, periodStartAt),
        eq(opsResidentTrustStatements.periodEndAt, periodEndAt),
      ),
    )
    .limit(1);
  if (existingRows[0]) {
    return existingRows[0] as OpsResidentTrustStatement;
  }

  const sumsRes = await pool.query<{
    opening: string | null;
    closing: string | null;
    credits: string | null;
    debits: string | null;
    entry_count: string | null;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN transacted_at < $3
         THEN CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END
         ELSE 0 END), 0)::bigint                                  AS opening,
       COALESCE(SUM(CASE WHEN transacted_at < $4
         THEN CASE WHEN direction = 'credit' THEN amount_cents ELSE -amount_cents END
         ELSE 0 END), 0)::bigint                                  AS closing,
       COALESCE(SUM(CASE WHEN direction = 'credit'
                          AND transacted_at >= $3
                          AND transacted_at <  $4
         THEN amount_cents ELSE 0 END), 0)::bigint                AS credits,
       COALESCE(SUM(CASE WHEN direction = 'debit'
                          AND transacted_at >= $3
                          AND transacted_at <  $4
         THEN amount_cents ELSE 0 END), 0)::bigint                AS debits,
       COALESCE(SUM(CASE WHEN transacted_at >= $3
                          AND transacted_at <  $4 THEN 1 ELSE 0 END), 0)::int
                                                                  AS entry_count
     FROM ops_resident_trust_ledger
     WHERE facility_number = $1 AND account_id = $2`,
    [facilityNumber, accountId, periodStartAt, periodEndAt],
  );
  const sums = sumsRes.rows[0] ?? {
    opening: "0",
    closing: "0",
    credits: "0",
    debits: "0",
    entry_count: "0",
  };

  const now = Date.now();
  const inserted = await db
    .insert(opsResidentTrustStatements)
    .values({
      facilityNumber,
      accountId,
      residentId: account.residentId,
      periodStartAt,
      periodEndAt,
      openingBalanceCents: Number(sums.opening ?? 0),
      closingBalanceCents: Number(sums.closing ?? 0),
      creditTotalCents: Number(sums.credits ?? 0),
      debitTotalCents: Number(sums.debits ?? 0),
      entryCount: Number(sums.entry_count ?? 0),
      generatedBy,
      generatedAt: now,
    })
    .returning();
  const row = inserted[0] as OpsResidentTrustStatement;
  await safeAudit({
    facilityNumber,
    actor,
    action: "create",
    entityType: "ops_resident_trust_statement",
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function listStatements(
  facilityNumber: string,
  accountId: number,
  opts: { page: number; limit: number },
): Promise<{ rows: OpsResidentTrustStatement[]; total: number }> {
  const where = and(
    eq(opsResidentTrustStatements.facilityNumber, facilityNumber),
    eq(opsResidentTrustStatements.accountId, accountId),
  );
  const offset = (opts.page - 1) * opts.limit;
  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(opsResidentTrustStatements)
      .where(where)
      .orderBy(asc(opsResidentTrustStatements.periodStartAt))
      .limit(opts.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsResidentTrustStatements)
      .where(where),
  ]);
  return { rows, total: countRows[0]?.count ?? 0 };
}
