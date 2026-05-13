/**
 * Stripe client + env loader for the Operations paywall (Phase 1).
 *
 * Lazy-init: `getStripe()` and `getStripeEnv()` THROW at call time, not
 * import time. The server must boot cleanly when STRIPE_* vars are unset
 * (local dev without a Stripe account, prod before the secrets are
 * provisioned, etc.) — routes call `isStripeConfigured()` first and
 * return 503 instead of crashing.
 *
 * All Stripe-using modules import from here so the API version + SDK
 * options are pinned in exactly one place.
 */

import Stripe from "stripe";

let _stripe: Stripe | null = null;

export interface StripeEnv {
  secretKey: string;
  webhookSecret: string;
  priceIdOpsProMonthly: string;
  checkoutSuccessUrl: string;
  checkoutCancelUrl: string;
  portalReturnUrl: string;
}

/**
 * Pinned Stripe API version. Update deliberately — never auto-track
 * Stripe's latest; the wire format of webhook payloads changes between
 * versions and we need test coverage before rolling forward.
 */
export const STRIPE_API_VERSION = "2026-04-22.dahlia" as const;

/**
 * Read all required Stripe env vars at once and throw if any are missing.
 * Callers should `isStripeConfigured()` first so the throw only fires
 * when the operator has partially configured Stripe (a real bug).
 */
export function getStripeEnv(): StripeEnv {
  const required = {
    secretKey: process.env.STRIPE_SECRET_KEY,
    webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
    priceIdOpsProMonthly: process.env.STRIPE_PRICE_ID_OPS_PRO_MONTHLY,
    checkoutSuccessUrl: process.env.STRIPE_CHECKOUT_SUCCESS_URL,
    checkoutCancelUrl: process.env.STRIPE_CHECKOUT_CANCEL_URL,
    portalReturnUrl: process.env.STRIPE_PORTAL_RETURN_URL,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(`Stripe env vars not set: ${missing.join(", ")}`);
  }
  return required as StripeEnv;
}

/**
 * Return the singleton Stripe SDK instance. Lazy — first call constructs
 * the client (which validates the secret key shape but does NOT make a
 * network round-trip). Subsequent calls reuse the same instance so
 * Stripe-Node can connection-pool internally.
 */
export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = new Stripe(getStripeEnv().secretKey, {
      apiVersion: STRIPE_API_VERSION,
      typescript: true,
    });
  }
  return _stripe;
}

/**
 * Cheap guard for route handlers — returns false when either of the two
 * critical secrets is missing so we can early-return 503 without ever
 * calling `getStripe()` / `getStripeEnv()` and triggering their throws.
 *
 * Only checks the secret + webhook secret because the URL/price vars are
 * Checkout-specific; the webhook can still run if those are unset (and
 * will throw later, surfacing the misconfiguration in the webhook log
 * instead of on `/api/billing/checkout`).
 */
export function isStripeConfigured(): boolean {
  return Boolean(
    process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET,
  );
}

/**
 * Test-only helper. Vitest spec files import this to reset the cached
 * SDK instance between tests that swap env vars. Not exported for
 * production callers.
 */
export function __resetStripeForTests(): void {
  _stripe = null;
}
