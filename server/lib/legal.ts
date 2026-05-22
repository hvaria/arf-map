/**
 * Phase 4 — Legal acceptance helpers + middleware.
 *
 * These helpers read / write the `legal_acceptances` table that backs the
 * clickwrap audit trail. The middleware re-prompts users on a version bump:
 * if any document in `LEGAL_DOCS` has been bumped since the user's last
 * acceptance row, state-changing requests get 409 `LEGAL_REACCEPT_REQUIRED`
 * until the user re-accepts.
 *
 * Why we don't block GETs: the FE blocking modal needs to load `/me`,
 * `/api/legal/<slug>`, etc. while it's prompting. If we 409'd those reads
 * the modal would have nothing to render and the user would be stuck.
 *
 * The Stripe webhook endpoint (`/api/billing/webhook`) is also exempt — it's
 * machine-to-machine traffic with no user session.
 */

import type { Request, Response, NextFunction } from "express";
import { pool } from "../db/index";
import {
  LEGAL_DOCS,
  LEGAL_DOC_SLUGS,
  type LegalDocSlug,
} from "@shared/legal";

// ─────────────────────────────────────────────────────────────────────────────
// recordAcceptance
// ─────────────────────────────────────────────────────────────────────────────

export interface RecordAcceptanceArgs {
  req: Request;
  accountKind: "facility" | "job_seeker";
  accountId: number;
  document: LegalDocSlug;
  version: string;
}

/**
 * Inserts one row in `legal_acceptances`. Idempotent via ON CONFLICT DO NOTHING
 * on the (account_kind, account_id, document, version) UNIQUE index — the FE
 * is free to retry on a flaky network and we won't poison the audit log with
 * duplicate rows.
 *
 * `accepted_ip` uses `req.ip` (express resolves this from X-Forwarded-For
 * when `trust proxy` is set — see server/index.ts). `accepted_user_agent`
 * is whatever the browser sent; we don't validate it.
 */
export async function recordAcceptance(args: RecordAcceptanceArgs): Promise<void> {
  const { req, accountKind, accountId, document, version } = args;
  const ip = (req.ip ?? null) as string | null;
  const userAgent = req.get("user-agent") ?? null;

  await pool.query(
    `INSERT INTO legal_acceptances
       (account_kind, account_id, document, version, accepted_at, accepted_ip, accepted_user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (account_kind, account_id, document, version) DO NOTHING`,
    [accountKind, accountId, document, version, Date.now(), ip, userAgent],
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// getPendingAcceptances
// ─────────────────────────────────────────────────────────────────────────────

export interface GetPendingAcceptancesArgs {
  accountKind: "facility" | "job_seeker";
  accountId: number;
}

/**
 * Returns the list of LegalDocSlugs whose CURRENT version (from LEGAL_DOCS)
 * has not been accepted by this account. New accounts → all 3 slugs.
 *
 * We resolve each slug independently rather than scanning the table once
 * because the version-string lookup is cheap (PK-indexed) and the per-slug
 * answer is easy to reason about. If a future tenant has 20+ documents we
 * can switch to a single GROUP BY query.
 */
export async function getPendingAcceptances(
  args: GetPendingAcceptancesArgs,
): Promise<LegalDocSlug[]> {
  const { accountKind, accountId } = args;
  const pending: LegalDocSlug[] = [];

  for (const slug of LEGAL_DOC_SLUGS) {
    const version = LEGAL_DOCS[slug].version;
    const r = await pool.query<{ id: number }>(
      `SELECT id FROM legal_acceptances
       WHERE account_kind = $1 AND account_id = $2 AND document = $3 AND version = $4
       LIMIT 1`,
      [accountKind, accountId, slug, version],
    );
    if (r.rows.length === 0) {
      pending.push(slug);
    }
  }

  return pending;
}

// ─────────────────────────────────────────────────────────────────────────────
// requirePendingLegalAcceptances middleware
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Auto-detecting variant: sniffs `req.user` (facility) vs
 * `req.session.jobSeekerId` (job seeker). Anonymous (neither) passes through.
 *
 * Mount this on app-level routes that may serve either auth flow, or where
 * factoring per-portal isn't worth it. The dedicated factory
 * `requirePendingLegalAcceptances` below is the preferred form when the
 * call site already knows the portal.
 */
export function requirePendingLegalAcceptancesAuto() {
  return async function legalAcceptanceGuardAuto(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const method = req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return next();
    }
    // Use originalUrl for path matching — req.path may be stripped by an
    // upstream app.use(prefix, ...) mount and is therefore unreliable here.
    const fullPath = (req.originalUrl || req.url || "").split("?")[0];
    if (fullPath === "/api/billing/webhook") {
      return next();
    }
    // Allow the acceptance write itself, plus logout, through. Otherwise a
    // user with stale acceptances would be locked into the modal with no
    // escape hatch.
    if (
      fullPath === "/api/legal/accept" ||
      fullPath === "/api/facility/logout" ||
      fullPath === "/api/jobseeker/logout"
    ) {
      return next();
    }

    let accountKind: "facility" | "job_seeker" | null = null;
    let accountId: number | undefined;

    const user = req.user as { id?: number } | undefined;
    if (user?.id != null) {
      accountKind = "facility";
      accountId = user.id;
    } else if (req.session?.jobSeekerId != null) {
      accountKind = "job_seeker";
      accountId = req.session.jobSeekerId;
    }

    if (!accountKind || !accountId) return next();

    try {
      const pending = await getPendingAcceptances({ accountKind, accountId });
      if (pending.length === 0) return next();
      res.status(409).json({
        code: "LEGAL_REACCEPT_REQUIRED",
        message:
          "Our legal documents have been updated. Please review and accept them to continue.",
        pendingAcceptances: pending,
      });
    } catch (err) {
      console.error("[legal] requirePendingLegalAcceptancesAuto failed:", err);
      next();
    }
  };
}

/**
 * Express middleware factory. Mount AFTER the relevant auth guard (so
 * `req.user` or `req.session.jobSeekerId` is populated).
 *
 * Behavior:
 *   - GET / HEAD / OPTIONS → pass through (the FE needs reads to render
 *     the blocking modal).
 *   - Stripe webhook exempt (no user session).
 *   - For POST / PUT / PATCH / DELETE: if `getPendingAcceptances` returns
 *     a non-empty list, respond 409 with:
 *       { code: "LEGAL_REACCEPT_REQUIRED",
 *         message: "...",
 *         pendingAcceptances: LegalDocSlug[] }
 *
 * `accountKind` is fixed per call site — facility-protected routes mount the
 * 'facility' variant and jobseeker-protected routes mount the 'job_seeker'
 * variant. We resolve `accountId` from the appropriate session field; if it's
 * missing (defensive — the upstream auth guard should have 401'd), we just
 * pass through rather than synthesize a fake user.
 */
export function requirePendingLegalAcceptances(
  accountKind: "facility" | "job_seeker",
) {
  return async function legalAcceptanceGuard(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    // Reads are never blocked — the FE needs them to load the modal.
    const method = req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
      return next();
    }

    // Use originalUrl so the path check is robust against router mount
    // prefixes stripping req.path.
    const fullPath = (req.originalUrl || req.url || "").split("?")[0];

    // Stripe webhook is exempt — machine-to-machine, no user session.
    if (fullPath === "/api/billing/webhook") {
      return next();
    }
    // The acceptance write endpoint MUST pass through — it is the only way
    // for a user with stale acceptances to clear the gate. Logout is also
    // exempt so a session can be terminated without re-accepting.
    if (
      fullPath === "/api/legal/accept" ||
      fullPath === "/api/facility/logout" ||
      fullPath === "/api/jobseeker/logout"
    ) {
      return next();
    }

    // Resolve account id from the appropriate session field.
    let accountId: number | undefined;
    if (accountKind === "facility") {
      const user = req.user as { id?: number } | undefined;
      accountId = user?.id;
    } else {
      accountId = req.session?.jobSeekerId;
    }

    // Defensive: if no auth state, let the upstream auth guard surface the
    // canonical 401 instead of muddying it with a 409 here.
    if (!accountId) return next();

    try {
      const pending = await getPendingAcceptances({ accountKind, accountId });
      if (pending.length === 0) return next();

      res.status(409).json({
        code: "LEGAL_REACCEPT_REQUIRED",
        message:
          "Our legal documents have been updated. Please review and accept them to continue.",
        pendingAcceptances: pending,
      });
    } catch (err) {
      // Don't take the whole API down if the legal check throws — log and let
      // the request through. The next deploy will surface the bug; in the
      // meantime, blocking writes on infra failure is worse than missing one
      // re-prompt.
      console.error("[legal] requirePendingLegalAcceptances failed:", err);
      next();
    }
  };
}
