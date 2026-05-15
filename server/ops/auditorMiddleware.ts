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
 *   SESSION level instead: an `auditor_view` audit row is emitted at
 *   most once per minute per share-link. The in-process Map is fine for
 *   single-instance Fly.io; if we ever scale out, swap the Map for a
 *   small Redis SETEX.
 *
 * Mutation guard:
 *   `blockAuditorMutations` rejects every non-GET on the auditor router
 *   with 403 — defense in depth even if a route handler forgets to
 *   check. Read-only is the whole point of an audit session.
 */

import type { NextFunction, Request, Response } from "express";

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

// ── Audit-view debounce ─────────────────────────────────────────────────────
//
// Map<shareLinkId, lastEmittedMs>. One minute is short enough that the
// audit trail still tells the "this token was used during these
// windows" story, and long enough that a tab refresh / poller doesn't
// flood the ops_audit_trail table.

const AUDIT_VIEW_DEBOUNCE_MS = 60 * 1000;
const lastAuditViewAt = new Map<number, number>();

async function maybeEmitAuditView(
  session: AuditorSession,
  now: number,
): Promise<void> {
  const last = lastAuditViewAt.get(session.shareLinkId) ?? 0;
  if (now - last < AUDIT_VIEW_DEBOUNCE_MS) return;
  lastAuditViewAt.set(session.shareLinkId, now);
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
  } catch (err) {
    // Audit-emit failures must never break the request — match the rest
    // of the ops modules' safeAudit pattern.
    // eslint-disable-next-line no-console
    console.error("[ops] auditor_view audit emit failed", err);
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
 * Test-only: reset the debounce map so tests can assert audit-emit
 * behavior deterministically.
 */
export function _resetAuditorMiddlewareForTests(): void {
  lastAuditViewAt.clear();
}
