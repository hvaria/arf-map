/**
 * Billing service — higher-level Stripe operations called by routes.
 *
 * Wraps Stripe Customer / Checkout / Billing Portal calls and keeps the
 * Checkout success / cancel / portal-return URLs centralized in
 * `getStripeEnv()`. Route handlers should only know about
 * `createCheckoutSession` and `createPortalSession`.
 *
 * `allow_promotion_codes` is true so the owner can issue 100%-off comps
 * via Stripe Coupons + Promotion Codes (Dashboard → Coupons). Stripe
 * Checkout shows a "Add promotion code" link when this is on.
 */

import type { FacilityAccount } from "@shared/schema";
import { getStripe, getStripeEnv } from "./stripeClient";
import {
  getStripeCustomerIdForAccount,
  setStripeCustomerIdForAccount,
} from "./subscriptionRepository";

// Defense-in-depth: validate that any URL we hand to the browser came
// from Stripe before redirecting. Guards against open-redirect if our
// STRIPE_SECRET_KEY is ever replaced with an attacker-controlled key.
function assertStripeUrl(url: string, kind: "checkout" | "portal"): void {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    throw new Error(`Stripe ${kind} session URL is malformed`);
  }
  if (!host.endsWith(".stripe.com") && host !== "stripe.com") {
    throw new Error(`Stripe ${kind} session URL not on stripe.com host`);
  }
}

/**
 * Return the Stripe Customer id for a facility account, creating one on
 * Stripe the first time and persisting it locally so subsequent calls
 * are a cheap DB read.
 *
 * The created customer gets `metadata.facilityAccountId` so the webhook
 * can resolve customer → account without relying on the subscription's
 * own metadata (which Stripe lets admins clear from the dashboard).
 */
export async function getOrCreateStripeCustomer(
  account: FacilityAccount,
): Promise<string> {
  const existing = await getStripeCustomerIdForAccount(account.id);
  if (existing) return existing;

  const stripe = getStripe();
  const customer = await stripe.customers.create({
    // `email` is nullable on facility_accounts — Stripe Customer email
    // is also optional, so leave undefined when missing rather than
    // sending an empty string.
    email: account.email ?? undefined,
    name: account.username,
    metadata: {
      facilityAccountId: String(account.id),
      facilityNumber: account.facilityNumber,
    },
  });

  await setStripeCustomerIdForAccount(account.id, customer.id);
  return customer.id;
}

/**
 * Mint a Stripe Checkout session for the Ops Pro Monthly plan and
 * return its hosted URL. Frontend redirects the browser to this URL;
 * Stripe handles payment capture, then redirects back to
 * `STRIPE_CHECKOUT_SUCCESS_URL` or `STRIPE_CHECKOUT_CANCEL_URL`.
 *
 * We pass `client_reference_id` AND `metadata.facilityAccountId` AND
 * `subscription_data.metadata.facilityAccountId` so the webhook can
 * resolve the account from any of the three lifecycle events
 * (checkout.session.completed → subscription, customer.subscription.*,
 * invoice.* via the underlying sub).
 */
export async function createCheckoutSession(
  account: FacilityAccount,
): Promise<{ url: string }> {
  const stripe = getStripe();
  const env = getStripeEnv();
  const customerId = await getOrCreateStripeCustomer(account);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: env.priceIdOpsProMonthly, quantity: 1 }],
    success_url: env.checkoutSuccessUrl,
    cancel_url: env.checkoutCancelUrl,
    client_reference_id: String(account.id),
    metadata: { facilityAccountId: String(account.id) },
    subscription_data: {
      metadata: { facilityAccountId: String(account.id) },
    },
    allow_promotion_codes: true,
  });

  if (!session.url) {
    throw new Error("Stripe Checkout session has no url");
  }
  assertStripeUrl(session.url, "checkout");
  return { url: session.url };
}

/**
 * Mint a Stripe Customer Portal session so the user can update their
 * payment method / cancel / view invoices. We never expose this URL to
 * users who have never paid — Stripe would 400 on a customer that has
 * no subscriptions, but we still want to fail fast with a clearer error.
 */
export async function createPortalSession(
  account: FacilityAccount,
): Promise<{ url: string }> {
  const stripe = getStripe();
  const env = getStripeEnv();
  const customerId = await getStripeCustomerIdForAccount(account.id);
  if (!customerId) {
    throw new Error("No Stripe customer found for this account");
  }
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: env.portalReturnUrl,
  });
  if (!session.url) {
    throw new Error("Stripe Portal session has no url");
  }
  assertStripeUrl(session.url, "portal");
  return { url: session.url };
}
