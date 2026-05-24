/**
 * Billing routes — Stripe Checkout + Customer Portal (Phase 1).
 *
 * The webhook is NOT mounted here — it lives directly on `app` in
 * server/index.ts so it can install `express.raw()` BEFORE the global
 * `express.json()` parser (Stripe needs the unparsed body for signature
 * verification).
 *
 * Both endpoints require facility auth (Passport session) and 503 when
 * Stripe env vars are missing so the server keeps booting in environments
 * that don't yet have Stripe configured (local dev without an account).
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import type { FacilityAccount } from "@shared/schema";
import {
  createCheckoutSession,
  createPortalSession,
} from "../billing/billingService";
import { isStripeConfigured } from "../billing/stripeClient";
import { isValidBypassCode, bypassCodesAreConfigured } from "../billing/bypassCodes";
import { compFacilityAccount } from "../billing/subscriptionRepository";
import { billingRateLimiter } from "../middleware/rateLimiter";
import { pool } from "../db/index";

export const billingRouter = Router();

// Local auth middleware — same shape as the one in routes.ts /
// opsRouter.ts. Kept inline so this router isn't coupled to a particular
// auth helper's export path.
function requireFacilityAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

/**
 * POST /api/billing/checkout
 *   Mint a Stripe Checkout session for the authenticated facility and
 *   return its hosted URL. Frontend window.location's there.
 *
 *   503 STRIPE_NOT_CONFIGURED is returned when env vars are missing so
 *   the paywall CTA can show a graceful "Billing not yet available"
 *   message instead of a generic 500. Phase 0 left a stub at this URL.
 */
billingRouter.post("/checkout", requireFacilityAuth, billingRateLimiter, async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ code: "STRIPE_NOT_CONFIGURED" });
  }
  try {
    const { url } = await createCheckoutSession(req.user as FacilityAccount);
    return res.json({ url });
  } catch (err) {
    console.error("[billing] checkout error:", (err as Error).message);
    return res.status(500).json({ code: "CHECKOUT_FAILED" });
  }
});

/**
 * POST /api/billing/portal
 *   Mint a Stripe Customer Portal session so the user can update
 *   payment method / cancel / view invoices. Phase 2 will surface this
 *   in a BillingSettings page; the route is shipped here so the
 *   Checkout flow can land users directly in the portal after success.
 */
billingRouter.post("/portal", requireFacilityAuth, billingRateLimiter, async (req, res) => {
  if (!isStripeConfigured()) {
    return res.status(503).json({ code: "STRIPE_NOT_CONFIGURED" });
  }
  try {
    const { url } = await createPortalSession(req.user as FacilityAccount);
    return res.json({ url });
  } catch (err) {
    console.error("[billing] portal error:", (err as Error).message);
    return res.status(500).json({ code: "PORTAL_FAILED" });
  }
});

/**
 * POST /api/billing/redeem-code
 *   Owner-controlled bypass — flip the authenticated facility account
 *   to `active` without going through Stripe. Codes are configured via
 *   the OPERATIONS_BYPASS_CODES env var (comma-separated). No DB store,
 *   no Stripe customer / subscription / invoice created — pure in-app
 *   comp. See server/billing/bypassCodes.ts for the rationale.
 *
 *   Rate-limited to 10/15min per account to make brute-forcing slow
 *   without locking out legitimate retypes. Stripe configuration is
 *   NOT required for this endpoint to work — the owner can comp
 *   themselves on a dev instance with no Stripe setup at all.
 */
billingRouter.post(
  "/redeem-code",
  requireFacilityAuth,
  billingRateLimiter,
  async (req, res) => {
    if (!bypassCodesAreConfigured()) {
      return res.status(503).json({ code: "BYPASS_NOT_CONFIGURED" });
    }
    const submitted = typeof req.body?.code === "string" ? req.body.code.trim() : "";
    if (!submitted) {
      return res.status(400).json({ code: "INVALID_CODE" });
    }
    if (!isValidBypassCode(submitted)) {
      return res.status(400).json({ code: "INVALID_CODE" });
    }
    const user = req.user as FacilityAccount;

    // Phase 5: persist redemption to billing_bypass_redemptions for audit.
    // The partial UNIQUE index (account_id WHERE revoked_at IS NULL)
    // enforces single-use-per-account at the DB level — a repeat redeem
    // raises Postgres error 23505 (unique_violation) which we translate
    // to a clean 409. Capturing IP + UA gives the operator dashboard
    // enough context to spot abuse without storing the full code.
    //
    // First-8-chars prefix only: logs may flow to aggregators and the
    // full code remains an out-of-band secret in OPERATIONS_BYPASS_CODES.
    const codePrefix = submitted.slice(0, 8);
    const ip =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim()
        || req.ip
        || null;
    const ua = req.headers["user-agent"] || null;
    const now = Date.now();

    // Phase 5 review fix: insert + comp must be atomic from the customer's
    // perspective. If the INSERT succeeds but compFacilityAccount throws
    // (transient pool exhaustion, network blip), the customer is left with
    // an orphan audit row that bricks their retry via the partial UNIQUE
    // → 23505 → 409 BYPASS_ALREADY_REDEEMED. Compensate by deleting the
    // just-inserted row before returning 500 so the user can simply retry.
    let insertedRowId: number | null = null;
    try {
      const insertRes = await pool.query<{ id: number }>(
        `INSERT INTO billing_bypass_redemptions
           (code_prefix, account_id, redeemed_at, redeemed_ip,
            redeemed_user_agent, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $3, $3)
         RETURNING id`,
        [codePrefix, user.id, now, ip, ua],
      );
      insertedRowId = insertRes.rows[0]?.id ?? null;
    } catch (err) {
      // 23505 = unique_violation. Partial-unique index hit means this
      // account already has an active (non-revoked) redemption row.
      const pgCode = (err as { code?: string }).code;
      if (pgCode === "23505") {
        console.log(
          `[billing] account ${user.id} (${user.username}) attempted re-redeem; already has active bypass row`,
        );
        return res.status(409).json({ code: "BYPASS_ALREADY_REDEEMED" });
      }
      console.error("[billing] redeem-code audit insert failed:", (err as Error).message);
      return res.status(500).json({ code: "REDEEM_FAILED" });
    }

    try {
      await compFacilityAccount(user.id);
      // Log enough to audit (user id + code prefix) but never the full
      // code, since logs may flow to aggregators.
      console.log(
        `[billing] account ${user.id} (${user.username}) redeemed bypass code starting with "${codePrefix.slice(0, 3)}..."`,
      );
      return res.json({ status: "active" });
    } catch (err) {
      console.error("[billing] redeem-code error:", (err as Error).message);
      // Compensate the audit insert so the partial UNIQUE doesn't lock the
      // customer out of retrying. Best-effort: if the compensation itself
      // fails, log loudly so operators can clean up manually, but still
      // return the original 500 to the caller.
      if (insertedRowId !== null) {
        try {
          await pool.query(
            `DELETE FROM billing_bypass_redemptions WHERE id = $1`,
            [insertedRowId],
          );
        } catch (compErr) {
          console.error(
            `[billing] CRITICAL: redeem-code compensation DELETE failed for row ${insertedRowId} (account ${user.id}). Manual cleanup needed:`,
            (compErr as Error).message,
          );
        }
      }
      return res.status(500).json({ code: "REDEEM_FAILED" });
    }
  },
);
