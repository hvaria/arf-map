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
    try {
      await compFacilityAccount(user.id);
      // Log enough to audit (user id + code prefix) but never the full
      // code, since logs may flow to aggregators.
      const prefix = submitted.slice(0, 3);
      console.log(
        `[billing] account ${user.id} (${user.username}) redeemed bypass code starting with "${prefix}..."`,
      );
      return res.json({ status: "active" });
    } catch (err) {
      console.error("[billing] redeem-code error:", (err as Error).message);
      return res.status(500).json({ code: "REDEEM_FAILED" });
    }
  },
);
