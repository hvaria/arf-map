/**
 * Subscription repository — read/write helpers for facility_subscriptions
 * and the hot-path cache columns on facility_accounts.
 *
 * Phase 0: read-only (cache columns).
 * Phase 1 (this file): write path. All Stripe SDK imports are confined
 * to this module + webhookHandler so route handlers stay framework-agnostic.
 *
 * Atomicity contract:
 *   upsertSubscriptionFromStripe writes facility_subscriptions AND mirrors
 *   `status` + `currentPeriodEnd` onto facility_accounts inside the SAME
 *   transaction. The gate middleware reads only from the cache columns,
 *   so any failure to mirror would leave the gate stale.
 */

import type Stripe from "stripe";
import { eq } from "drizzle-orm";
import { db } from "../db/index";
import { storage } from "../storage";
import { facilitySubscriptions, facilityAccounts } from "@shared/schema";

export type SubscriptionView = {
  status: string | null;
  currentPeriodEnd: number | null;
  // Phase 1 fields — null until the Stripe writer fills them in.
  cancelAtPeriodEnd: boolean;
  planId: string | null;
  latestInvoiceUrl: string | null;
  lastFour: string | null;
  cardBrand: string | null;
};

/**
 * Return the subscription view for a facility account.
 *
 * Phase 0: reads only the hot-path cache columns on facility_accounts.
 * Phase 1 will widen this to JOIN facility_subscriptions for the
 * cancel/invoice/card fields. Callers should not assume those fields are
 * populated yet.
 *
 * Returns null if the account does not exist.
 */
export async function getSubscriptionForAccount(
  accountId: number,
): Promise<SubscriptionView | null> {
  const account = await storage.getFacilityAccount(accountId);
  if (!account) return null;
  return {
    status: account.subscriptionStatus ?? null,
    currentPeriodEnd: account.subscriptionCurrentPeriodEnd ?? null,
    cancelAtPeriodEnd: false,
    planId: null,
    latestInvoiceUrl: null,
    lastFour: null,
    cardBrand: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 writers (Stripe-aware)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Stripe.Subscription puts period boundaries on the subscription item in
 * newer API versions (2024+); older event payloads still carry them on
 * the subscription root. Read both for forward/backward compatibility.
 */
function extractPeriodBounds(sub: Stripe.Subscription): {
  start: number | null;
  end: number | null;
} {
  type LegacyFields = {
    current_period_start?: number | null;
    current_period_end?: number | null;
  };
  const legacy = sub as unknown as LegacyFields;
  const fromRootStart =
    typeof legacy.current_period_start === "number"
      ? legacy.current_period_start
      : null;
  const fromRootEnd =
    typeof legacy.current_period_end === "number"
      ? legacy.current_period_end
      : null;
  // Newer payloads — read from the first item.
  const firstItem = sub.items?.data?.[0];
  const itemStart =
    typeof firstItem?.current_period_start === "number"
      ? firstItem.current_period_start
      : null;
  const itemEnd =
    typeof firstItem?.current_period_end === "number"
      ? firstItem.current_period_end
      : null;
  const start = fromRootStart ?? itemStart;
  const end = fromRootEnd ?? itemEnd;
  return {
    start: start !== null ? start * 1000 : null,
    end: end !== null ? end * 1000 : null,
  };
}

/**
 * Pull the most useful display fields off the Stripe subscription. All
 * are optional and resolve to null when the expansion isn't present —
 * this function never throws.
 */
function extractCardAndInvoice(sub: Stripe.Subscription): {
  lastFour: string | null;
  cardBrand: string | null;
  latestInvoiceUrl: string | null;
  stripePriceId: string | null;
  cancelAtPeriodEnd: number;
  trialEnd: number | null;
} {
  let lastFour: string | null = null;
  let cardBrand: string | null = null;
  const pm = sub.default_payment_method;
  if (pm && typeof pm !== "string" && pm.card) {
    lastFour = pm.card.last4 ?? null;
    cardBrand = pm.card.brand ?? null;
  }
  let latestInvoiceUrl: string | null = null;
  const inv = sub.latest_invoice;
  if (inv && typeof inv !== "string") {
    latestInvoiceUrl = inv.hosted_invoice_url ?? null;
  }
  const firstItem = sub.items?.data?.[0];
  const stripePriceId = firstItem?.price?.id ?? null;
  const cancelAtPeriodEnd = sub.cancel_at_period_end ? 1 : 0;
  const trialEnd = typeof sub.trial_end === "number" ? sub.trial_end * 1000 : null;
  return {
    lastFour,
    cardBrand,
    latestInvoiceUrl,
    stripePriceId,
    cancelAtPeriodEnd,
    trialEnd,
  };
}

/**
 * Idempotent upsert. Called by the webhook handler for any subscription
 * lifecycle event. Replaying the same event reaches the same final state.
 *
 * Transaction:
 *   1. INSERT ... ON CONFLICT (facility_account_id) DO UPDATE on
 *      facility_subscriptions.
 *   2. UPDATE facility_accounts.subscription_status +
 *      subscription_current_period_end for the same account.
 *
 * Both writes are committed atomically — a crash between them would
 * leave the gate cache stale (status active in Stripe but null on the
 * account), which would lock the customer out of features they paid for.
 */
export async function upsertSubscriptionFromStripe(
  stripeSubscription: Stripe.Subscription,
  facilityAccountId: number,
): Promise<void> {
  const now = Date.now();
  const { start, end } = extractPeriodBounds(stripeSubscription);
  const {
    lastFour,
    cardBrand,
    latestInvoiceUrl,
    stripePriceId,
    cancelAtPeriodEnd,
    trialEnd,
  } = extractCardAndInvoice(stripeSubscription);
  const status = stripeSubscription.status ?? null;
  const stripeCustomerId =
    typeof stripeSubscription.customer === "string"
      ? stripeSubscription.customer
      : stripeSubscription.customer?.id ?? null;
  const stripeSubscriptionId = stripeSubscription.id;

  await db.transaction(async (tx) => {
    await tx
      .insert(facilitySubscriptions)
      .values({
        facilityAccountId,
        stripeCustomerId,
        stripeSubscriptionId,
        stripePriceId,
        status,
        currentPeriodStart: start,
        currentPeriodEnd: end,
        cancelAtPeriodEnd,
        trialEnd,
        latestInvoiceUrl,
        lastFour,
        cardBrand,
        createdAt: now,
        updatedAt: now,
      })
      .onConflictDoUpdate({
        target: facilitySubscriptions.facilityAccountId,
        set: {
          stripeCustomerId,
          stripeSubscriptionId,
          stripePriceId,
          status,
          currentPeriodStart: start,
          currentPeriodEnd: end,
          cancelAtPeriodEnd,
          trialEnd,
          latestInvoiceUrl,
          lastFour,
          cardBrand,
          updatedAt: now,
        },
      });

    await tx
      .update(facilityAccounts)
      .set({
        subscriptionStatus: status,
        subscriptionCurrentPeriodEnd: end,
      })
      .where(eq(facilityAccounts.id, facilityAccountId));
  });
}

/**
 * Webhook fallback path. Stripe subscription/invoice events don't always
 * carry our facility account id in metadata (race: Stripe webhook fires
 * before the checkout-completion webhook has run, or metadata was
 * dropped by an admin manually creating a sub from the dashboard).
 * Resolve via the customer id we stored when minting the Checkout
 * session.
 *
 * Returns null when no row matches — the caller logs + 200s rather than
 * 4xx-ing (which would cause Stripe to retry forever).
 */
export async function findAccountByStripeCustomerId(
  customerId: string,
): Promise<number | null> {
  // SELECT up to 2 rows so we can detect (and refuse to act on) the
  // pathological case where a duplicate customer id exists. The UNIQUE
  // index on stripe_customer_id makes this impossible from normal code
  // paths, but a manual DB edit or test-cleanup mishap could create one.
  // Returning null for the ambiguous case is safer than picking one and
  // potentially flipping the wrong account's subscription state.
  const rows = await db
    .select({ id: facilitySubscriptions.facilityAccountId })
    .from(facilitySubscriptions)
    .where(eq(facilitySubscriptions.stripeCustomerId, customerId))
    .limit(2);
  if (rows.length === 0) return null;
  if (rows.length > 1) {
    console.error(
      `[billing] ambiguous stripe customer id ${customerId} maps to multiple accounts; refusing to resolve`,
    );
    return null;
  }
  return rows[0].id;
}

/**
 * Persist the Stripe customer id we just minted for an account. Called
 * from `getOrCreateStripeCustomer` so subsequent webhook events can
 * resolve customer → account without metadata.
 *
 * If no facility_subscriptions row exists yet for this account, INSERT
 * one with status NULL (the first real subscription event will fill in
 * the rest). If a row already exists, just patch the customer id —
 * never touch status here.
 */
export async function setStripeCustomerIdForAccount(
  accountId: number,
  customerId: string,
): Promise<void> {
  const now = Date.now();
  await db
    .insert(facilitySubscriptions)
    .values({
      facilityAccountId: accountId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: null,
      stripePriceId: null,
      status: null,
      currentPeriodStart: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: 0,
      trialEnd: null,
      latestInvoiceUrl: null,
      lastFour: null,
      cardBrand: null,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: facilitySubscriptions.facilityAccountId,
      set: {
        stripeCustomerId: customerId,
        updatedAt: now,
      },
    });
}

/**
 * Read the Stripe customer id we previously stored for a facility
 * account, or null if we've never minted one (this account has never
 * touched the Checkout flow).
 *
 * Used by `getOrCreateStripeCustomer` to avoid creating a duplicate
 * Stripe Customer for the same facility every time they click Upgrade.
 */
export async function getStripeCustomerIdForAccount(
  accountId: number,
): Promise<string | null> {
  const rows = await db
    .select({ stripeCustomerId: facilitySubscriptions.stripeCustomerId })
    .from(facilitySubscriptions)
    .where(eq(facilitySubscriptions.facilityAccountId, accountId))
    .limit(1);
  return rows[0]?.stripeCustomerId ?? null;
}

/**
 * Flip a facility account to `active` via an owner-controlled bypass
 * code, completely outside Stripe. Sets the cache columns on
 * facility_accounts directly; does NOT create a facility_subscriptions
 * row, does NOT call Stripe, does NOT create a customer.
 *
 * `currentPeriodEnd` is set to ~100 years out so the period-end column
 * is never a deciding factor for the gate (the gate reads status only,
 * but downstream UI displays this date — picking far-future avoids a
 * misleading "expires soon" hint).
 *
 * Idempotent: re-redeeming the same code on an already-comped account
 * just refreshes the timestamp. If the account is currently paying via
 * Stripe, this overwrites their cache row to `active` regardless — but
 * the underlying facility_subscriptions row (and Stripe sub) is left
 * untouched. The next Stripe webhook would re-mirror status back.
 */
export async function compFacilityAccount(accountId: number): Promise<void> {
  const FAR_FUTURE_MS = Date.now() + 100 * 365 * 24 * 60 * 60 * 1000;
  await db
    .update(facilityAccounts)
    .set({
      subscriptionStatus: "active",
      subscriptionCurrentPeriodEnd: FAR_FUTURE_MS,
    })
    .where(eq(facilityAccounts.id, accountId));
}
