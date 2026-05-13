/**
 * Stripe webhook handler — single Express handler called for every
 * Stripe-sent event at `/api/billing/webhook`.
 *
 * MUST be mounted with `express.raw({ type: "application/json" })`
 * BEFORE the global `express.json()` runs, otherwise
 * `stripe.webhooks.constructEvent` fails signature verification (it
 * needs the unparsed Buffer, not the JSON-decoded object).
 *
 * Idempotency: all writes go through `upsertSubscriptionFromStripe`,
 * which uses INSERT ... ON CONFLICT. Replaying any event reaches the
 * same final state — Stripe's "at-least-once" delivery semantics are
 * safe here.
 *
 * Logging policy: NEVER log full event payloads (they contain customer
 * email + last4). Log event id + type + error message only.
 */

import type { Request, Response } from "express";
import type Stripe from "stripe";
import { getStripe, getStripeEnv } from "./stripeClient";
import {
  upsertSubscriptionFromStripe,
  findAccountByStripeCustomerId,
} from "./subscriptionRepository";

/**
 * Resolve a facility_accounts.id from a Stripe Subscription, trying
 * metadata first (cheap, no extra DB call) and falling back to the
 * stored customer_id lookup. Returns null when nothing matches — the
 * caller logs + 200s so Stripe doesn't retry forever.
 */
async function resolveAccountIdFromSubscription(
  subscription: Stripe.Subscription,
): Promise<number | null> {
  const fromMeta = subscription.metadata?.facilityAccountId;
  if (fromMeta) {
    const n = Number(fromMeta);
    if (!Number.isNaN(n)) return n;
  }
  const customerId =
    typeof subscription.customer === "string"
      ? subscription.customer
      : subscription.customer?.id;
  if (!customerId) return null;
  return await findAccountByStripeCustomerId(customerId);
}

export async function stripeWebhookHandler(
  req: Request,
  res: Response,
): Promise<void> {
  const stripe = getStripe();
  const env = getStripeEnv();
  const sig = req.headers["stripe-signature"];
  if (!sig || typeof sig !== "string") {
    res.status(400).send("Missing stripe-signature header");
    return;
  }

  let event: Stripe.Event;
  try {
    // req.body MUST be a Buffer here — the route is mounted with
    // express.raw() and registered BEFORE the global express.json().
    event = stripe.webhooks.constructEvent(req.body, sig, env.webhookSecret);
  } catch (err) {
    const message = (err as Error).message;
    console.error("[stripe-webhook] signature verification failed:", message);
    res.status(400).send(`Webhook signature verification failed: ${message}`);
    return;
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const accountIdRaw =
          session.metadata?.facilityAccountId ?? session.client_reference_id;
        const accountId = accountIdRaw ? Number(accountIdRaw) : NaN;
        if (!accountId || Number.isNaN(accountId)) {
          // Don't 4xx — Stripe would retry. Log + ack.
          console.error(
            `[stripe-webhook] ${event.type} ${event.id}: missing facilityAccountId on session ${session.id}`,
          );
          res.json({ received: true });
          return;
        }
        if (session.subscription) {
          const subscriptionId =
            typeof session.subscription === "string"
              ? session.subscription
              : session.subscription.id;
          const subscription = await stripe.subscriptions.retrieve(
            subscriptionId,
            { expand: ["latest_invoice", "default_payment_method"] },
          );
          await upsertSubscriptionFromStripe(subscription, accountId);
        }
        break;
      }

      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const accountId = await resolveAccountIdFromSubscription(subscription);
        if (accountId === null) {
          console.error(
            `[stripe-webhook] ${event.type} ${event.id}: no resolvable account for subscription ${subscription.id}`,
          );
          res.json({ received: true });
          return;
        }
        // Re-retrieve with expansion — the event payload only has
        // unexpanded references for latest_invoice / default_payment_method.
        const expanded = await stripe.subscriptions.retrieve(subscription.id, {
          expand: ["latest_invoice", "default_payment_method"],
        });
        await upsertSubscriptionFromStripe(expanded, accountId);
        break;
      }

      case "invoice.payment_failed":
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        // Stripe.Invoice.subscription is a string | Stripe.Subscription | null
        // depending on expansion. Older API versions kept it on the root;
        // newer ones move it to parent.subscription_details.subscription.
        // Probe both so this handler is forward-compatible.
        type LegacyInvoice = {
          subscription?: string | Stripe.Subscription | null;
          parent?: {
            subscription_details?: {
              subscription?: string | Stripe.Subscription | null;
            } | null;
          } | null;
        };
        const legacy = invoice as unknown as LegacyInvoice;
        const subRef =
          legacy.subscription ??
          legacy.parent?.subscription_details?.subscription ??
          null;
        if (!subRef) break;
        const subscriptionId = typeof subRef === "string" ? subRef : subRef.id;
        const subscription = await stripe.subscriptions.retrieve(
          subscriptionId,
          { expand: ["latest_invoice", "default_payment_method"] },
        );
        const accountId = await resolveAccountIdFromSubscription(subscription);
        if (accountId === null) {
          console.error(
            `[stripe-webhook] ${event.type} ${event.id}: no resolvable account for subscription ${subscription.id}`,
          );
          res.json({ received: true });
          return;
        }
        await upsertSubscriptionFromStripe(subscription, accountId);
        break;
      }

      default:
        // Unhandled event types are fine — Stripe still expects a 200.
        // Don't log here; Stripe sends a lot of event types we'd
        // explicitly not handle (customer.updated, invoice.created, etc.).
        break;
    }

    res.json({ received: true });
  } catch (err) {
    console.error(
      `[stripe-webhook] handler error on ${event.type} ${event.id}:`,
      (err as Error).message,
    );
    res.status(500).send("Internal error");
  }
}
