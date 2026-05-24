/**
 * Wave 4 Phase 4.1 — Obligation auto-expire scheduler.
 *
 * Resolves the §11 BA open question: when an obligation is overdue and
 * still pending past the grace period, transition it to `expired` so the
 * daily-triage stops surfacing it as "actionable" and the audit trail
 * captures the lifecycle event. Recurrence handling is unchanged — the
 * `expired` state is terminal and never auto-rolls forward.
 *
 * Pattern mirrors server/ops/dailySummaryScheduler.ts (top-of-hour tick +
 * global enable). Set DISABLE_OBLIGATION_EXPIRE=1 in staging/test
 * deployments sharing a prod DB to avoid double-expiring rows.
 *
 * Behavior:
 *   - Tick once per UTC hour.
 *   - One query lists distinct facilities with at least one pending
 *     obligation.
 *   - For each facility, `expireOverdueObligations(facilityNumber)`:
 *       - Reads OBLIGATION_EXPIRE_GRACE_DAYS reg setting (default 1).
 *       - SELECTs candidate ids: status='pending' AND deleted_at IS NULL
 *         AND due_at < now - graceDays*DAY.
 *       - Caps each pass at MAX_PER_TICK (200) to avoid long-running
 *         work; the next tick picks up the rest.
 *       - Calls transitionObligation(id, fn, 'expired', actor) per row,
 *         preserving the state-machine validation + audit emission.
 *
 * Why reuse transitionObligation rather than a bulk UPDATE:
 *   - The state machine in obligationsStorage.ALLOWED_TRANSITIONS is the
 *     single source of truth for legal moves. Bypassing it would mean
 *     `pending → expired` could fire from any status if the wrong cron
 *     query slipped past us. Reusing it keeps the audit row consistent
 *     with admin-driven expirations.
 */

import { pool } from "../db/index";
import { transitionObligation } from "./obligationsStorage";
import { getRegSetting } from "./regSettings";
import type { AuditActor } from "./auditStorage";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_TICK = 200;

// ─────────────────────────────────────────────────────────────────────────
// Phase 5 — multi-machine safety: pg_try_advisory_lock per tick.
//
// Mirrors the pattern in dailySummaryScheduler.ts. Without this gate, a
// 2-machine Fly deploy would double-expire obligations because each
// machine boots its own setInterval and both would race past the
// state-machine guard. The session-scoped lock pins the tick to one
// machine; losers no-op.
//
// Distinct lock-key constant: 0x6f626c_6967_6578_70 ≈ ASCII 'obligexp'
// as a u64. Must NOT collide with the daily-summary key.
// ─────────────────────────────────────────────────────────────────────────
const OBLIGATION_EXPIRE_LOCK_KEY = 0x6f626c69676578_70; // 'obligexp'

async function withObligationExpireLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const res = await client.query<{ pg_try_advisory_lock: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock`,
      [OBLIGATION_EXPIRE_LOCK_KEY],
    );
    if (!res.rows[0].pg_try_advisory_lock) {
      // eslint-disable-next-line no-console
      console.log("[obligationExpire] tick skipped — another machine is processing");
      return null;
    }
    try {
      return await fn();
    } finally {
      await client
        .query(`SELECT pg_advisory_unlock($1)`, [OBLIGATION_EXPIRE_LOCK_KEY])
        .catch(() => {
          // Session-scoped lock is released when the client is released
          // anyway; swallow to keep the tick clean.
        });
    }
  } finally {
    client.release();
  }
}

// Exported for tests so the lock semantics can be exercised without
// pulling the entire scheduler tick into the unit test harness.
export const _phase5Internals = {
  OBLIGATION_EXPIRE_LOCK_KEY,
  withObligationExpireLock,
};

const SYSTEM_ACTOR: AuditActor = { id: "system_expire_cron", role: "system" };

function safeNonNegativeInt(raw: string | null | undefined, fallback: number): number {
  if (raw === null || raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

export interface ExpireOverdueOptions {
  now?: number;
  graceDays?: number;
}

/**
 * Idempotent expire pass for a single facility. Returns the count of
 * obligations transitioned to `expired`. Exported for tests + manual
 * triggering from an admin route.
 */
export async function expireOverdueObligations(
  facilityNumber: string,
  opts: ExpireOverdueOptions = {},
): Promise<{ expired: number }> {
  if (!facilityNumber) throw new Error("facilityNumber is required");

  const now = opts.now ?? Date.now();
  let graceDays = opts.graceDays;
  if (graceDays === undefined) {
    const raw = await getRegSetting(facilityNumber, "OBLIGATION_EXPIRE_GRACE_DAYS")
      .catch(() => null);
    graceDays = safeNonNegativeInt(raw, 1);
  } else if (graceDays < 0 || !Number.isFinite(graceDays)) {
    graceDays = 1;
  }
  const cutoff = now - graceDays * DAY_MS;

  // SELECT candidate ids ONCE, capped at MAX_PER_TICK. The next tick
  // picks up the rest. status='pending' only — in_progress/submitted/
  // under_review represent work the admin has acknowledged and is not
  // auto-expired (admin action remains the path for those, mirroring
  // the §6 state machine documentation).
  const res = await pool.query<{ id: number }>(
    `SELECT id FROM ops_obligations
       WHERE facility_number = $1
         AND status = 'pending'
         AND deleted_at IS NULL
         AND due_at < $2
       ORDER BY due_at ASC, id ASC
       LIMIT $3`,
    [facilityNumber, cutoff, MAX_PER_TICK],
  );

  let expired = 0;
  for (const row of res.rows) {
    try {
      const after = await transitionObligation(
        Number(row.id),
        facilityNumber,
        "expired",
        SYSTEM_ACTOR,
        { note: `auto-expired by cron (grace ${graceDays}d)` },
      );
      if (after && after.status === "expired") expired += 1;
    } catch (err) {
      // A single row's failure must not stop the pass — log and continue.
      // eslint-disable-next-line no-console
      console.error(
        `[obligationExpire] transition #${row.id} failed:`,
        (err as Error)?.message ?? err,
      );
    }
  }
  return { expired };
}

/**
 * Run one scheduler tick. Exported for testability — production
 * `setInterval` calls this every hour.
 *
 * Phase 5: wrapped in `withObligationExpireLock`. When another Fly machine
 * holds the lock, returns `{ facilities: 0, expired: 0 }` and exits — the
 * winning machine handles every pending obligation that pass.
 */
export async function runObligationExpireTick(
  now: number = Date.now(),
): Promise<{ facilities: number; expired: number }> {
  const result = await withObligationExpireLock(async () => {
    // Distinct facilities with at least one pending obligation. Tenant
    // isolation is enforced inside expireOverdueObligations, so the
    // dispatcher only needs the keys.
    const res = await pool.query<{ facility_number: string }>(
      `SELECT DISTINCT facility_number
         FROM ops_obligations
        WHERE status = 'pending'
          AND deleted_at IS NULL`,
    );
    let expired = 0;
    for (const row of res.rows) {
      try {
        const r = await expireOverdueObligations(row.facility_number, { now });
        expired += r.expired;
        if (r.expired > 0) {
          // eslint-disable-next-line no-console
          console.log(
            `[obligationExpire] ${row.facility_number}: expired ${r.expired} obligation(s)`,
          );
        }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `[obligationExpire] tick failed for ${row.facility_number}:`,
          (err as Error)?.message ?? err,
        );
      }
    }
    return { facilities: res.rows.length, expired };
  });
  return result ?? { facilities: 0, expired: 0 };
}

/**
 * Start the once-per-UTC-hour scheduler. Returns a `stop` handle.
 *
 * Implementation: align the first tick to the top of the next hour via
 * `setTimeout`, then run on a fixed `setInterval(HOUR_MS)` from there.
 * Honors DISABLE_OBLIGATION_EXPIRE=1 to no-op in staging/test deployments.
 */
export function startObligationExpireScheduler(): { stop: () => void } {
  if (process.env.DISABLE_OBLIGATION_EXPIRE === "1") {
    // eslint-disable-next-line no-console
    console.log(
      "[obligationExpire] DISABLE_OBLIGATION_EXPIRE=1 — scheduler not started",
    );
    return { stop: () => {} };
  }

  let intervalHandle: NodeJS.Timeout | null = null;
  let timeoutHandle: NodeJS.Timeout | null = null;

  const now = Date.now();
  const msUntilTopOfHour = HOUR_MS - (now % HOUR_MS);

  timeoutHandle = setTimeout(() => {
    timeoutHandle = null;
    runObligationExpireTick().catch((err) => {
      // eslint-disable-next-line no-console
      console.error(
        "[obligationExpire] tick error:",
        (err as Error)?.message ?? err,
      );
    });
    intervalHandle = setInterval(() => {
      runObligationExpireTick().catch((err) => {
        // eslint-disable-next-line no-console
        console.error(
          "[obligationExpire] tick error:",
          (err as Error)?.message ?? err,
        );
      });
    }, HOUR_MS);
  }, msUntilTopOfHour);

  // eslint-disable-next-line no-console
  console.log(
    `[obligationExpire] scheduler started — first tick in ${Math.round(
      msUntilTopOfHour / 60000,
    )}m`,
  );

  return {
    stop: () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (intervalHandle) clearInterval(intervalHandle);
    },
  };
}
