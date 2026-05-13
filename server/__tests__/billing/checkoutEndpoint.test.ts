/**
 * POST /api/billing/checkout — endpoint integration tests.
 *
 * Verifies:
 *   - 401 when not authenticated
 *   - 503 STRIPE_NOT_CONFIGURED when STRIPE_* env vars are missing
 *   - 200 with { url } when Stripe is configured (SDK mocked — no
 *     real API calls)
 *
 * Mocks the Stripe SDK; uses the real DB for facility_subscriptions
 * upsert (so `getOrCreateStripeCustomer` exercises its real persistence
 * path).
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── Stripe SDK mock ──────────────────────────────────────────────────────────
const stripeMocks = vi.hoisted(() => {
  const customersCreate = vi.fn();
  const checkoutSessionsCreate = vi.fn();
  const billingPortalSessionsCreate = vi.fn();
  return { customersCreate, checkoutSessionsCreate, billingPortalSessionsCreate };
});

vi.mock("stripe", () => {
  class MockStripe {
    webhooks = { constructEvent: vi.fn() };
    subscriptions = { retrieve: vi.fn() };
    customers = { create: stripeMocks.customersCreate };
    checkout = { sessions: { create: stripeMocks.checkoutSessionsCreate } };
    billingPortal = {
      sessions: { create: stripeMocks.billingPortalSessionsCreate },
    };
  }
  return { default: MockStripe };
});

import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import request from "supertest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { storage } from "../../storage";
import { hashPassword, comparePassword } from "../../auth";
import { billingRouter } from "../../routes/billing";
import { __resetStripeForTests } from "../../billing/stripeClient";
import type { FacilityAccount } from "@shared/schema";

const FACILITY_NUMBER = "TEST-FAC-CHECKOUT-A";
const FACILITY_USERNAME = "test-fac-checkout-a-user";
const FACILITY_PASSWORD = "test-pw-checkout-a-12345!";
const FACILITY_EMAIL = "test-fac-checkout-a@example.com";

let testPassportRegistered = false;
let facilityAccountId: number;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: "checkout-test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 1000 },
    }),
  );

  if (!testPassportRegistered) {
    passport.use(
      "checkout-test-local",
      new LocalStrategy(async (username, password, done) => {
        try {
          const account = await storage.getFacilityAccountByUsername(username);
          if (!account) return done(null, false);
          const ok = await comparePassword(password, account.password);
          if (!ok) return done(null, false);
          return done(null, account);
        } catch (err) {
          return done(err as Error);
        }
      }),
    );
    passport.serializeUser((user, done) => {
      done(null, (user as FacilityAccount).id);
    });
    passport.deserializeUser(async (id: number, done) => {
      try {
        const account = await storage.getFacilityAccount(id);
        done(null, account ?? false);
      } catch (err) {
        done(err as Error);
      }
    });
    testPassportRegistered = true;
  }

  app.use(passport.initialize());
  app.use(passport.session());

  // Same CSRF guard as production — billing endpoints are state-changing
  // so they require X-Requested-With on POSTs.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const m = req.method.toUpperCase();
    if (
      ["POST", "PUT", "DELETE", "PATCH"].includes(m) &&
      req.path.startsWith("/api/")
    ) {
      const xrw = req.headers["x-requested-with"];
      if (!xrw || (xrw as string).toLowerCase() !== "xmlhttprequest") {
        return res.status(403).json({ message: "CSRF validation failed." });
      }
    }
    next();
  });

  app.post("/api/facility/login", (req, res, next) => {
    passport.authenticate(
      "checkout-test-local",
      (err: Error | null, user: FacilityAccount | false) => {
        if (err) return next(err);
        if (!user) return res.status(401).json({ message: "Invalid credentials" });
        req.login(user, (loginErr) => {
          if (loginErr) return next(loginErr);
          return res.json({ id: user.id, facilityNumber: user.facilityNumber });
        });
      },
    )(req, res, next);
  });

  app.use("/api/billing", billingRouter);
  return app;
}

async function loginAgent(app: Express): Promise<request.Agent> {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/facility/login")
    .set("X-Requested-With", "XMLHttpRequest")
    .send({ username: FACILITY_USERNAME, password: FACILITY_PASSWORD });
  expect(res.status, `login failed: ${res.text}`).toBe(200);
  return agent;
}

beforeAll(async () => {
  await bootstrapMainSchema();
  const hashed = await hashPassword(FACILITY_PASSWORD);
  const r = await pool.query<{ id: number }>(
    `INSERT INTO facility_accounts
       (facility_number, username, password, role, email, email_verified, created_at)
     VALUES ($1, $2, $3, 'facility_admin', $4, 1, $5)
     ON CONFLICT (facility_number) DO UPDATE SET
       username = EXCLUDED.username,
       password = EXCLUDED.password,
       email = EXCLUDED.email,
       email_verified = 1
     RETURNING id`,
    [FACILITY_NUMBER, FACILITY_USERNAME, hashed, FACILITY_EMAIL, Date.now()],
  );
  facilityAccountId = Number(r.rows[0].id);
});

afterAll(async () => {
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
  stripeMocks.customersCreate.mockReset();
  stripeMocks.checkoutSessionsCreate.mockReset();
  // Wipe any customer id stored from a previous test so getOrCreate
  // re-enters the create-customer branch deterministically.
  await pool.query(
    `DELETE FROM facility_subscriptions WHERE facility_account_id = $1`,
    [facilityAccountId],
  );
});

describe("POST /api/billing/checkout", () => {
  it("returns 401 when not authenticated", async () => {
    // Stripe must be configured so we exclusively test the auth gate.
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    process.env.STRIPE_PRICE_ID_OPS_PRO_MONTHLY = "price_x";
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = "http://localhost/success";
    process.env.STRIPE_CHECKOUT_CANCEL_URL = "http://localhost/cancel";
    process.env.STRIPE_PORTAL_RETURN_URL = "http://localhost/portal";
    __resetStripeForTests();

    const app = buildApp();
    const res = await request(app)
      .post("/api/billing/checkout")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({});
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Not authenticated/i);
  });

  it("returns 503 STRIPE_NOT_CONFIGURED when env vars are missing", async () => {
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    __resetStripeForTests();

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/billing/checkout")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({});
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: "STRIPE_NOT_CONFIGURED" });
    expect(stripeMocks.checkoutSessionsCreate).not.toHaveBeenCalled();
  });

  it("returns 200 with { url } when Stripe is configured", async () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_x";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_x";
    process.env.STRIPE_PRICE_ID_OPS_PRO_MONTHLY = "price_x";
    process.env.STRIPE_CHECKOUT_SUCCESS_URL = "http://localhost/success";
    process.env.STRIPE_CHECKOUT_CANCEL_URL = "http://localhost/cancel";
    process.env.STRIPE_PORTAL_RETURN_URL = "http://localhost/portal";
    __resetStripeForTests();

    stripeMocks.customersCreate.mockResolvedValue({ id: "cus_test_returned" });
    stripeMocks.checkoutSessionsCreate.mockResolvedValue({
      url: "https://checkout.stripe.com/c/pay/cs_test_session_123",
    });

    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/billing/checkout")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      url: "https://checkout.stripe.com/c/pay/cs_test_session_123",
    });
    expect(stripeMocks.customersCreate).toHaveBeenCalledTimes(1);
    expect(stripeMocks.checkoutSessionsCreate).toHaveBeenCalledTimes(1);
    // Verify the price ID + mode + metadata were passed correctly.
    const args = stripeMocks.checkoutSessionsCreate.mock.calls[0][0];
    expect(args.mode).toBe("subscription");
    expect(args.line_items[0].price).toBe("price_x");
    expect(args.metadata.facilityAccountId).toBe(String(facilityAccountId));
    expect(args.client_reference_id).toBe(String(facilityAccountId));
  });
});
