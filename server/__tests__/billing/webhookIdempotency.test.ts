/**
 * Phase 2 R2 — Stripe webhook idempotency guard tests.
 *
 * The webhook handler now opens with:
 *
 *   INSERT INTO stripe_processed_events (event_id, event_type, processed_at)
 *        VALUES ($1, $2, $3)
 *        ON CONFLICT (event_id) DO NOTHING
 *        RETURNING event_id;
 *
 * The handler short-circuits with `{ received: true, alreadyProcessed: true }`
 * when RETURNING yields no rows — Stripe is replaying an event we already
 * processed and we MUST NOT re-run the downstream subscription upsert.
 *
 * These tests are scoped specifically to the idempotency contract; the
 * end-to-end happy-path coverage (event-type routing, status transitions,
 * cache mirror, etc.) already lives in webhookHandler.test.ts.
 */

import "dotenv/config";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

// Stripe SDK mock — must be hoisted before the handler imports it.
const stripeMocks = vi.hoisted(() => {
  const constructEvent = vi.fn();
  const subscriptionsRetrieve = vi.fn();
  return { constructEvent, subscriptionsRetrieve };
});

vi.mock("stripe", () => {
  class MockStripe {
    webhooks = { constructEvent: stripeMocks.constructEvent };
    subscriptions = { retrieve: stripeMocks.subscriptionsRetrieve };
    customers = { create: vi.fn() };
    checkout = { sessions: { create: vi.fn() } };
    billingPortal = { sessions: { create: vi.fn() } };
  }
  return { default: MockStripe };
});

import express, { type Express } from "express";
import request from "supertest";
import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { stripeWebhookHandler } from "../../billing/webhookHandler";
import { __resetStripeForTests } from "../../billing/stripeClient";

const FACILITY_NUMBER = "TEST-FAC-WEBHOOK-IDEMP";
const FACILITY_USERNAME = "test-fac-webhook-idemp-user";
const FACILITY_EMAIL = "test-fac-webhook-idemp@example.com";

const STRIPE_CUSTOMER_ID = "cus_TEST_WEBHOOK_IDEMP";
const STRIPE_SUBSCRIPTION_ID = "sub_TEST_WEBHOOK_IDEMP";
const STRIPE_PRICE_ID = "price_TEST_OPS_PRO_MONTHLY";

let app: Express;
let facilityAccountId: number;

function buildWebhookApp(): Express {
  const a = express();
  a.post(
    "/api/billing/webhook",
    express.raw({ type: "application/json" }),
    stripeWebhookHandler,
  );
  return a;
}

async function seedAccount(): Promise<number> {
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

function makeStripeSubscription(opts: {
  status: string;
  periodEnd?: number;
}): any {
  const periodEnd =
    opts.periodEnd ?? Math.floor(Date.now() / 1000) + 30 * 86400;
  return {
    id: STRIPE_SUBSCRIPTION_ID,
    object: "subscription",
    status: opts.status,
    customer: STRIPE_CUSTOMER_ID,
    cancel_at_period_end: false,
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
  // Surgical cleanup so we don't trample other billing tests.
  await pool.query(
    `DELETE FROM stripe_processed_events
      WHERE event_id LIKE 'evt_idemp_%'`,
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
  // Each test uses a distinct event id, so we don't need to wipe the
  // processed_events table between cases. But we do reset the
  // subscription state so the upsert-call assertion is meaningful.
  await pool.query(
    `DELETE FROM facility_subscriptions WHERE facility_account_id = $1`,
    [facilityAccountId],
  );
  await pool.query(
    `UPDATE facility_accounts
        SET subscription_status = NULL,
            subscription_current_period_end = NULL
      WHERE id = $1`,
    [facilityAccountId],
  );
});

describe("stripeWebhookHandler — Phase 2 R2 idempotency guard", () => {
  it("first delivery of an event returns { received: true } and runs the upsert", async () => {
    const subscription = makeStripeSubscription({ status: "active" });
    const event = {
      id: "evt_idemp_first",
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
    expect(res.body).toEqual({ received: true });
    // The upsert ran exactly once.
    expect(stripeMocks.subscriptionsRetrieve).toHaveBeenCalledTimes(1);

    // The idempotency row was persisted.
    const rows = await pool.query<{ event_id: string; event_type: string }>(
      `SELECT event_id, event_type FROM stripe_processed_events WHERE event_id = $1`,
      [event.id],
    );
    expect(rows.rowCount).toBe(1);
    expect(rows.rows[0]).toEqual({
      event_id: event.id,
      event_type: event.type,
    });
  });

  it("replaying the same event id short-circuits with alreadyProcessed: true", async () => {
    const subscription = makeStripeSubscription({ status: "active" });
    const event = {
      id: "evt_idemp_replay",
      type: "customer.subscription.created",
      data: { object: subscription },
    };
    stripeMocks.constructEvent.mockReturnValue(event);
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(subscription);

    // First delivery — upsert runs.
    const r1 = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=123,v1=ok")
      .send(Buffer.from(JSON.stringify(event)));
    expect(r1.status).toBe(200);
    expect(r1.body).toEqual({ received: true });
    expect(stripeMocks.subscriptionsRetrieve).toHaveBeenCalledTimes(1);

    // Replay — guard short-circuits BEFORE the switch.
    const r2 = await request(app)
      .post("/api/billing/webhook")
      .set("Content-Type", "application/json")
      .set("stripe-signature", "t=123,v1=ok")
      .send(Buffer.from(JSON.stringify(event)));
    expect(r2.status).toBe(200);
    expect(r2.body).toEqual({ received: true, alreadyProcessed: true });
    // CRITICAL: the upsert did NOT run a second time.
    expect(stripeMocks.subscriptionsRetrieve).toHaveBeenCalledTimes(1);
  });

  it("persists exactly one stripe_processed_events row per event_id, even under replay", async () => {
    const subscription = makeStripeSubscription({ status: "active" });
    const event = {
      id: "evt_idemp_singlerow",
      type: "customer.subscription.created",
      data: { object: subscription },
    };
    stripeMocks.constructEvent.mockReturnValue(event);
    stripeMocks.subscriptionsRetrieve.mockResolvedValue(subscription);

    // Three deliveries.
    for (let i = 0; i < 3; i++) {
      await request(app)
        .post("/api/billing/webhook")
        .set("Content-Type", "application/json")
        .set("stripe-signature", "t=123,v1=ok")
        .send(Buffer.from(JSON.stringify(event)));
    }

    // Still exactly one row.
    const countRes = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
         FROM stripe_processed_events
        WHERE event_id = $1`,
      [event.id],
    );
    expect(Number(countRes.rows[0].c)).toBe(1);

    // And the downstream upsert ran exactly once across all three deliveries.
    expect(stripeMocks.subscriptionsRetrieve).toHaveBeenCalledTimes(1);
  });

  it("distinct event ids each run the upsert independently", async () => {
    const sub = makeStripeSubscription({ status: "active" });

    for (const id of [
      "evt_idemp_distinct_a",
      "evt_idemp_distinct_b",
      "evt_idemp_distinct_c",
    ]) {
      const event = {
        id,
        type: "customer.subscription.created",
        data: { object: sub },
      };
      stripeMocks.constructEvent.mockReturnValueOnce(event);
      stripeMocks.subscriptionsRetrieve.mockResolvedValueOnce(sub);
      const res = await request(app)
        .post("/api/billing/webhook")
        .set("Content-Type", "application/json")
        .set("stripe-signature", "t=123,v1=ok")
        .send(Buffer.from(JSON.stringify(event)));
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ received: true });
    }

    expect(stripeMocks.subscriptionsRetrieve).toHaveBeenCalledTimes(3);
    const rows = await pool.query<{ c: string }>(
      `SELECT COUNT(*)::text AS c
         FROM stripe_processed_events
        WHERE event_id LIKE 'evt_idemp_distinct_%'`,
    );
    expect(Number(rows.rows[0].c)).toBe(3);
  });
});
