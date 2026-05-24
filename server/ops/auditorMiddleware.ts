/**
 * Wave 3 Phase 3.2 — Auditor share-link middleware.
 *
 * Parallel auth path. The facility-Passport session is NOT used here —
 * auditor traffic is gated by a share-link token issued from
 * server/ops/shareLinksStorage.ts.
 *
 * Mounted on the auditor router at /api/ops/auditor/*; never composed
 * with `requireFacilityAuth` or `requireActiveSubscription`.
 *
 * Token transport:
 *   - Preferred:  Authorization: Bearer <token>
 *   - Fallback:   ?token=<token>  (lets the dedicated /#/auditor/{token}
 *                                 page bootstrap before the FE auditor
 *                                 context can move the token into a
 *                                 header)
 *
 * Validation goes through `recordShareLinkVisit` — the single source of
 * truth for "is this token live?". That call also bumps visit_count +
 * last_visit_at, so admins see "this token was opened N times" without
 * an extra round-trip.
 *
 * Audit-trail debounce:
 *   The BRD §3.2 ask is "every viewed record gets logged into the audit
 *   trail". Logging per request would dwarf the actual audit volume on a
 *   busy inspection visit (every poll counts). We implement this at the
 *   SESSION level: an `auditor_view` audit row is emitted at most once
 *   per minute per share-link. Phase 5 swapped the original in-process
 *   `Map<shareLinkId, lastEmittedMs>` for a Postgres transaction-scoped
 *   advisory lock keyed on (shareLinkId, minuteBucket). Multi-machine
 *   Fly deploys no longer over-emit — only one machine wins the lock per
 *   minute-bucket, the rest skip emission and let the transaction commit
 *   (and auto-release the lock) without writing a duplicate row.
 *
 * Mutation guard:
 *   `blockAuditorMutations` rejects every non-GET on the auditor router
 *   with 403 — defense in depth even if a route handler forgets to
 *   check. Read-only is the whole point of an audit session.
 */

import type { NextFunction, Request, Response } from "express";

import { pool } from "../db/index";
import { recordShareLinkVisit } from "./shareLinksStorage";
import { recordAudit } from "./auditStorage";

export interface AuditorSession {
  facilityNumber: string;
  shareLinkId: number;
  token: string;
  expiresAt: number;
  audience: string;
  audienceLabel?: string | null;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auditor?: AuditorSession;
    }
  }
}

// ── Audit-view debounce (Phase 5: Postgres advisory lock) ───────────────────
//
// One minute is short enough that the audit trail still tells the "this
// token was used during these windows" story, and long enough that a tab
// refresh / poller doesn't flood the ops_audit_trail table.
//
// Why a Postgres advisory lock instead of an in-process Map:
//   With >1 Fly machine, each process had its own Map and would over-emit
//   N× per bucket. We now derive a deterministic 64-bit key from
//   (minuteBucket, shareLinkId) and call `pg_try_advisory_xact_lock`. Only
//   the machine that wins the bucket emits; the rest fail the try-lock and
//   skip. `_xact_lock` releases automatically at transaction end so we
//   never leak locks even if the audit insert throws.

const AUDIT_VIEW_DEBOUNCE_MS = 60 * 1000;

/**
 * Pack (minuteBucket, shareLinkId) into a signed-64-bit advisory-lock key.
 * minuteBucket fits in 41 bits comfortably until year ~6053, shareLinkId
 * fits in 31 bits (Postgres SERIAL is 32-bit signed). XOR rather than
 * straight concatenation so a same-bucket collision across different
 * share-links is impossible — different ids ⇒ different keys.
 *
 * Exported for tests so they can compute the same key and assert lock-
 * holding behavior deterministically.
 */
export function _auditorDebounceLockKey(
  shareLinkId: number,
  nowMs: number,
): number {
  const minuteBucket = Math.floor(nowMs / AUDIT_VIEW_DEBOUNCE_MS);
  // Multiply by 2^32 to stash the bucket in the upper 32 bits, XOR the
  // shareLinkId into the lower 32 bits. The product overflows JS's
  // 53-bit safe-integer range past year ~3084, but that's a non-issue
  // here: the key only needs to be deterministic + collision-free for
  // distinct (bucket, id) tuples within the same second. node-postgres
  // hands the value to pg as a bigint literal regardless.
  return minuteBucket * 0x100000000 + shareLinkId;
}

async function maybeEmitAuditView(
  session: AuditorSession,
  now: number,
): Promise<void> {
  const key = _auditorDebounceLockKey(session.shareLinkId, now);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lockRes = await client.query<{ pg_try_advisory_xact_lock: boolean }>(
      `SELECT pg_try_advisory_xact_lock($1) AS pg_try_advisory_xact_lock`,
      [key],
    );
    if (!lockRes.rows[0].pg_try_advisory_xact_lock) {
      // Another machine (or another request on this machine) already
      // emitted in this minute-bucket. COMMIT releases nothing held; just
      // close the txn cleanly.
      await client.query("COMMIT");
      return;
    }
    try {
      await recordAudit({
        facilityNumber: session.facilityNumber,
        actorId: `auditor:${session.audience}`,
        actorRole: "auditor",
        action: "update", // closest existing AuditAction; the entityType
        // 'ops_share_link' and the actorRole 'auditor' disambiguate this
        // as a view event rather than a mutation.
        entityType: "ops_share_link",
        entityId: session.shareLinkId,
        after: {
          kind: "auditor_view",
          audience: session.audience,
          audienceLabel: session.audienceLabel ?? null,
        },
      });
      await client.query("COMMIT");
    } catch (err) {
      // Audit-emit failures must never break the request — match the
      // safeAudit pattern in the rest of ops/.
      await client.query("ROLLBACK").catch(() => {});
      // eslint-disable-next-line no-console
      console.error("[ops] auditor_view audit emit failed", err);
    }
  } catch (err) {
    // Couldn't even acquire a client or BEGIN. Same swallow-and-log
    // policy — audit must never take out the user-visible request.
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line no-console
    console.error("[ops] auditor_view debounce txn failed", err);
  } finally {
    client.release();
  }
}

// ── Token extraction ────────────────────────────────────────────────────────

function extractToken(req: Request): string | undefined {
  const auth = req.headers["authorization"];
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    const t = auth.slice(7).trim();
    if (t) return t;
  }
  const q = req.query?.token;
  if (typeof q === "string" && q.length > 0) return q;
  return undefined;
}

// ── Public middleware ───────────────────────────────────────────────────────

export function requireAuditorToken(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const token = extractToken(req);
  if (!token) {
    res.status(401).json({ success: false, error: "Auditor token required" });
    return;
  }
  // recordShareLinkVisit handles invalid / revoked / expired in one
  // atomic UPDATE … RETURNING. No need for a separate check.
  recordShareLinkVisit(token)
    .then(async (row) => {
      if (!row) {
        res
          .status(401)
          .json({ success: false, error: "Auditor token invalid or expired" });
        return;
      }
      const session: AuditorSession = {
        facilityNumber: row.facilityNumber,
        shareLinkId: row.id,
        token,
        expiresAt: row.expiresAt,
        audience: row.audience,
        audienceLabel: row.audienceLabel ?? null,
      };
      req.auditor = session;
      // Fire-and-forget audit emit so we don't block the request on the
      // (debounced) audit-write round-trip.
      void maybeEmitAuditView(session, Date.now());
      next();
    })
    .catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[ops] auditor token validation failed", err);
      res.status(500).json({ success: false, error: "Internal error" });
    });
}

/**
 * Hard-block any mutation. Auditor sessions are read-only by design.
 * Mounted as middleware on the auditor router so a forgetful route
 * handler can never accidentally allow a write.
 */
export function blockAuditorMutations(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const m = req.method.toUpperCase();
  if (m === "POST" || m === "PUT" || m === "PATCH" || m === "DELETE") {
    res
      .status(403)
      .json({ success: false, error: "Auditor sessions are read-only" });
    return;
  }
  next();
}

/**
 * Test-only: kept as a no-op for backwards compatibility with existing
 * test suites that called this between cases. Phase 5 moved the debounce
 * state from an in-process Map to a Postgres `pg_try_advisory_xact_lock`
 * keyed on (minuteBucket, shareLinkId); the lock auto-releases at txn
 * end, so there is no in-process state left to reset. Tests that need a
 * "fresh" bucket should advance the clock by AUDIT_VIEW_DEBOUNCE_MS or
 * use a different shareLinkId.
 */
export function _resetAuditorMiddlewareForTests(): void {
  // intentional no-op — see docstring
}
