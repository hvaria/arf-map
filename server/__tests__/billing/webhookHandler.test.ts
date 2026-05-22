/**
 * Stripe webhook handler — integration tests against the real DB.
 *
 * Mocks the Stripe SDK (no real API calls) but uses the real
 * subscriptionRepository writer so the transaction + ON CONFLICT
 * upsert + facility_accounts cache mirror are all exercised end-to-end.
 *
 * Test plan (per Phase 1 spec):
 *   - 400 on missing stripe-signature header
 *   - 400 on invalid signature
 *   - 200 + idempotent upsert for checkout.session.completed
 *   - 200 + status flip to active for customer.subscription.created
 *   - 200 + status flip to past_due for invoice.payment_failed
 *   - 200 + status flip to canceled for customer.subscription.deleted
 *   - Replay of the same event reaches the same final DB state
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Stripe SDK mock (must be hoisted before the handler imports it) ──────────
// vi.hoisted runs before any import — return the mock factory + state
// the tests can manipulate per-case.
const stripeMocks = vi.hoisted(() => {
  const constructEvent = vi.fn();
  const subscriptionsRetrieve = vi.fn();
  return { constructEvent, subscriptionsRetrieve };
});

vi.mock("stripe", () => {
  // Mimic the SDK shape — `new Stripe(key, opts)` returns an instance
  // with `.webhooks.constructEvent` and `.subscriptions.retrieve`.
  class MockStripe {
    webhooks = { constructEvent: stripeMocks.constructEvent };
    subscriptions = { retrieve: stripeMocks.subscriptionsRetrieve };
    customers = { create: vi.fn() };
    checkout = { sessions: { create: vi.fn() } };
    billingPortal = { sessions: { create: vi.fn() } };
  }
  return { default: MockStripe };
});

// ── Real-DB imports (after the mock is set up) ───────────────────────────────
import express, { type Express } from "express";
import request from "supertest";
import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { stripeWebhookHandler } from "../../billing/webhookHandler";
import { __resetStripeForTests } from "../../billing/stripeClient";

const FACILITY_NUMBER = "TEST-FAC-WEBHOOK-A";
const FACILITY_USERNAME = "test-fac-webhook-a-user";
const FACILITY_EMAIL = "test-fac-webhook-a@example.com";

const STRIPE_CUSTOMER_ID = "cus_TEST_WEBHOOK_A";
const STRIPE_SUBSCRIPTION_ID = "sub_TEST_WEBHOOK_A";
const STRIPE_PRICE_ID = "price_TEST_OPS_PRO_MONTHLY";

let app: Express;
let facilityAccountId: number;

function buildWebhookApp(): Express {
  const a = express();
  // Mirror the production mounting — raw body BEFORE any JSON parser.
  // Tests POST raw Buffers via supertest's `.send(Buffer)`.
  a.post(
    "/api/billing/webhook",
    express.raw({ type: "application/json" }),
    stripeWebhookHandler,
  );
  return a;
}

async function seedAccount(): Promise<number> {
  // Insert a clean facility account with no subscription so each test
  // can drive the state via webhook events.
  const result = await pool.query<{ id: number }>(
    `INSERT INTO facility_accounts
       (facility_number, username, password, role, email, email_verified, created_at)
     VALUES ($1, $2, $3, 'facility_admin', $4, 1, $5)
     ON CONFLICT (facility_number) DO UPDATE SET
       username = EXCLUDED.username,
       email = EXCLUDED.email,
       email_verified = 1,
       subscription_status = NULL,
       subscription_current_period_end = NULL
     RETURNING id`,
    [FACILITY_NUMBER, FACILITY_USERNAME, "x", FACILITY_EMAIL, Date.now()],
  );
  return Number(result.rows[0].id);
}

async function resetSubscriptionRows(accountId: number): Promise<void> {
  await pool.query(
    `DELETE FROM facility_subscriptions WHERE facility_account_id = $1`,
    [accountId],
  );
  await pool.query(
    `UPDATE facility_accounts
        SET subscription_status = NULL,
            subscription_current_period_end = NULL
      WHERE id = $1`,
    [accountId],
  );
}

async function readSubscription(accountId: number) {
  const r = await pool.query<{
    status: string | null;
    current_period_end: number | string | null;
    stripe_customer_id: string | null;
    stripe_subscription_id: string | null;
  }>(
    `SELECT status, current_period_end, stripe_customer_id, stripe_subscription_id
       FROM facility_subscriptions
      WHERE facility_account_id = $1`,
    [accountId],
  );
  return r.rows[0] ?? null;
}

async function readAccountCache(accountId: number) {
  const r = await pool.query<{
    subscription_status: string | null;
    subscription_current_period_end: number | string | null;
  }>(
    `SELECT subscription_status, subscription_current_period_end
       FROM facility_accounts
      WHERE id = $1`,
    [accountId],
  );
  return r.rows[0] ?? null;
}

/**
 * Build a minimal Stripe.Subscription-shaped object for the upsert path.
 * Only includes fields the writer reads.
 */
function makeStripeSubscription(opts: {
  status: string;
  periodEnd?: number; // unix seconds
  cancelAtPeriodEnd?: boolean;
}): any {
  const periodEnd = opts.periodEnd ?? Math.floor(Date.now() / 1000) + 30 * 86400;
  return {
    id: STRIPE_SUBSCRIPTION_ID,
    object: "subscription",
    status: opts.status,
    customer: STRIPE_CUSTOMER_ID,
    cancel_at_period_end: opts.cancelAtPeriodEnd ?? false,
    trial_end: null,
    metadata: { facilityAccountId: String(facilityAccountId) },
    items: {
      data: [
        {
          price: { id: STRIPE_PRICE_ID },
          current_period_start: periodEnd - 30 * 86400,
          current_period_end: periodEnd,
        },
      ],
    },
    default_payment_method: {
      id: "pm_test",
      card: { last4: "4242", brand: "visa" },
    },
    latest_invoice: {
      id: "in_test",
      hosted_invoice_url: "https://invoice.stripe.test/in_test",
    },
  };
}

beforeAll(async () => {
  // Make isStripeConfigured() / getStripeEnv() succeed.
  process.env.STRIPE_SECRET_KEY = "sk_test_dummy_for_unit_tests";
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test_dummy";
  process.env.STRIPE_PRICE_ID_OPS_PRO_MONTHLY = STRIPE_PRICE_ID;
  process.env.STRIPE_CHECKOUT_SUCCESS_URL = "http://localhost/success";
  process.env.STRIPE_CHECKOUT_CANCEL_URL = "http://localhost/cancel";
  process.env.STRIPE_PORTAL_RETURN_URL = "http://localhost/portal";

  __resetStripeForTests();
  await bootstrapMainSchema();
  facilityAccountId = await seedAccount();
  app = buildWebhookApp();
});

afterAll(async () => {
  // Phase 2 R2: also clear the idempotency registry rows this test seeded
  // so subsequent runs aren't short-circuited on event-id replay.
  await pool.query(
    `DELETE FROM stripe_processed_events
      WHERE event_id LIKE 'evt_test_%' OR event_id LIKE 'evt_sub_%'
         OR event_id LIKE 'evt_invoice_%' OR event_id = 'evt_replay_1'`,
  );
  await pool.query(
    `DELETE FROM facility_subscriptions WHERE facility_account_id = $1`,
    [facilityAccountId],
  );
  await pool.query(
    `DELETE FROM facility_accounts WHERE facility_number = $1`,
    [FACILITY_NUMBER],
  );
  await pool.end();
});

beforeEach(async () => {
  stripeMocks.constructEvent.mockReset();
  stripeMocks.subscriptionsRetrieve.mockReset();
  await resetSubscriptionRows(facilityAccountId);
  // Phase 2 R2: each test reuses fixed event ids (evt_test_*, evt_sub_*,
  // evt_invoice_*, evt_replay_1). The new idempotency guard would
  // short-circuit a second run of the same test in the same DB session.
  // Wipe the registry rows so each test starts from a clean idempotency
  // state.
  await pool.query(
    `DELETE FROM stripe_processed_events
      WHERE event_id LIKE 'evt_test_%' OR event_id LIKE 'evt_sub_%'
         OR event_id LIKE 'evt_invoice_%' OR event_id = 'evt_replay_1'`,
  );
});

describe("stripeWebhookHandler", () => {
  it("returns 400 when stripe-signature header is missing", async () => {
    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .send(Buffer.from("{}"));

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Missing stripe-signature header/i);
    expect(stripeMocks.constructEvent).not.toHaveBeenCalled();
  });

  it("returns 400 on invalid signature", async () => {
    stripeMocks.constructEvent.mockImplementation(() => {
      throw new Error("No signatures found matching the expected signature");
    });

    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=123,v1=bad")
      .send(Buffer.from("{}"));

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Webhook signature verification failed/i);
  });

  it("upserts a subscription on checkout.session.completed and mirrors cache cols", async () => {
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
    const subscription = makeStripeSubscription({ status: "active", periodEnd });
    const event = {
      id: "evt_test_checkout",
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_test_123",
          subscription: STRIPE_SUBSCRIPTION_ID,
          metadata: { facilityAccountId: String(facilityAccountId) },
          client_reference_id: String(facilityAccountId),
        },
      },
    };
    stripeMocks.constructEvent.mockReturnValue(event);
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(subscription);

    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=123,v1=ok")
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ received: true });

    const sub = await readSubscription(facilityAccountId);
    expect(sub).toMatchObject({
      status: "active",
      stripe_customer_id: STRIPE_CUSTOMER_ID,
      stripe_subscription_id: STRIPE_SUBSCRIPTION_ID,
    });
    expect(Number(sub!.current_period_end)).toBe(periodEnd * 1000);

    const cache = await readAccountCache(facilityAccountId);
    expect(cache?.subscription_status).toBe("active");
    expect(Number(cache!.subscription_current_period_end)).toBe(periodEnd * 1000);
  });

  it("flips status to active on customer.subscription.created", async () => {
    const subscription = makeStripeSubscription({ status: "active" });
    const event = {
      id: "evt_sub_created",
      type: "customer.subscription.created",
      data: { object: subscription },
    };
    stripeMocks.constructEvent.mockReturnValue(event);
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(subscription);

    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=123,v1=ok")
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(200);
    const cache = await readAccountCache(facilityAccountId);
    expect(cache?.subscription_status).toBe("active");
  });

  it("flips status to past_due on invoice.payment_failed", async () => {
    const subscription = makeStripeSubscription({ status: "past_due" });
    const event = {
      id: "evt_invoice_failed",
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_failed",
          subscription: STRIPE_SUBSCRIPTION_ID,
        },
      },
    };
    stripeMocks.constructEvent.mockReturnValue(event);
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(subscription);

    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=123,v1=ok")
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(200);
    const cache = await readAccountCache(facilityAccountId);
    expect(cache?.subscription_status).toBe("past_due");
  });

  it("flips status to canceled on customer.subscription.deleted", async () => {
    const subscription = makeStripeSubscription({ status: "canceled" });
    const event = {
      id: "evt_sub_deleted",
      type: "customer.subscription.deleted",
      data: { object: subscription },
    };
    stripeMocks.constructEvent.mockReturnValue(event);
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(subscription);

    const res = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=123,v1=ok")
      .send(Buffer.from(JSON.stringify(event)));

    expect(res.status).toBe(200);
    const cache = await readAccountCache(facilityAccountId);
    expect(cache?.subscription_status).toBe("canceled");
  });

  it("is idempotent — replaying the same event reaches the same DB state", async () => {
    const periodEnd = Math.floor(Date.now() / 1000) + 30 * 86400;
    const subscription = makeStripeSubscription({ status: "active", periodEnd });
    const event = {
      id: "evt_replay_1",
      type: "customer.subscription.created",
      data: { object: subscription },
    };
    stripeMocks.constructEvent.mockReturnValue(event);
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(subscription);

    // First delivery.
    const r1 = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=123,v1=ok")
      .send(Buffer.from(JSON.stringify(event)));
    expect(r1.status).toBe(200);
    const sub1 = await readSubscription(facilityAccountId);
    const cache1 = await readAccountCache(facilityAccountId);

    // Replay (Stripe retries on transient network issues). Phase 2 R2: the
    // handler now short-circuits via the stripe_processed_events idempotency
    // guard and responds with alreadyProcessed: true — but the converged DB
    // state is exactly the same as after the first delivery, which is what
    // this test actually cares about.
    const r2 = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=123,v1=ok")
      .send(Buffer.from(JSON.stringify(event)));
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual({ received: true, alreadyProcessed: true });
    const sub2 = await readSubscription(facilityAccountId);
    const cache2 = await readAccountCache(facilityAccountId);

    expect(sub2!.status).toBe(sub1!.status);
    expect(sub2!.stripe_subscription_id).toBe(sub1!.stripe_subscription_id);
    expect(Number(sub2!.current_period_end)).toBe(Number(sub1!.current_period_end));
    expect(cache2!.subscription_status).toBe(cache1!.subscription_status);
    expect(Number(cache2!.subscription_current_period_end)).toBe(
      Number(cache1!.subscription_current_period_end),
    );

    // Crucially — only ONE row in facility_subscriptions for this account
    // (the UNIQUE index + ON CONFLICT does the right thing).
    const countRes = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
         FROM facility_subscriptions
        WHERE facility_account_id = $1`,
      [facilityAccountId],
    );
    expect(Number(countRes.rows[0].c)).toBe(1);
  });
});
