import type { Request, Response, NextFunction } from "express";

/**
 * Express middleware that gates the Operations module behind an active
 * facility subscription (Phase 0 of the Operations paywall).
 *
 * Reads from the hot-path cache columns on `facility_accounts` populated
 * by the Stripe webhook writer (Phase 1). The cache columns are present
 * on `req.user` because Passport's `deserializeUser` returns the full
 * facility account row — see `passport.deserializeUser` in
 * `server/index.ts`.
 *
 * Gate rule (locked for Phase 0):
 *   status === "active"  || status === "trialing"  → allow
 *   anything else (incl. null / past_due / canceled) → 402
 *
 * Stripe Smart Retries keep `status === "active"` during the dunning
 * grace window — when Stripe actually flips a row to "past_due" the
 * customer has already exhausted retries and access should stop.
 * Phase 1 may refine this; Phase 0 keeps the gate simple.
 *
 * MUST be mounted AFTER the facility auth middleware (Passport
 * `req.isAuthenticated()` check). If `req.user` is missing this falls
 * through to a defensive 401 rather than crashing — but the canonical
 * 401 should come from the upstream auth guard.
 *
 * The 402 response shape is locked across server + client:
 *   { code: "SUBSCRIPTION_REQUIRED",
 *     upgradeUrl: "/api/billing/checkout",
 *     message: "Operations requires an active subscription" }
 *
 * `upgradeUrl` is a stub for Phase 0 — Phase 1 will mint a real Stripe
 * Checkout session at that path.
 */
export function requireActiveSubscription(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  // req.user is set by Passport (facility auth). requireFacilityAuth must
  // run first; this is a defensive fallback so the gate never crashes on
  // an unauthenticated request.
  const account = req.user as { subscriptionStatus?: string | null } | undefined;
  if (!account) {
    res.status(401).json({ code: "UNAUTHENTICATED" });
    return;
  }
  const status = account.subscriptionStatus;
  if (status === "active" || status === "trialing") {
    next();
    return;
  }
  res.status(402).json({
    code: "SUBSCRIPTION_REQUIRED",
    upgradeUrl: "/api/billing/checkout",
    message: "Operations requires an active subscription",
  });
}
