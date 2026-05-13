/**
 * POST /api/billing/redeem-code — endpoint integration tests.
 *
 * Verifies:
 *   - 401 when not authenticated
 *   - 503 BYPASS_NOT_CONFIGURED when OPERATIONS_BYPASS_CODES env var is unset
 *   - 400 INVALID_CODE when body has no code or an empty code
 *   - 400 INVALID_CODE when code does not match any configured value
 *   - 200 { status: "active" } on valid code + cache cols on facility_accounts
 *     are flipped to `active` with a far-future currentPeriodEnd
 *   - Constant-time compare: codes of different lengths still 400 (not error)
 *
 * Uses the real DB for the cache-column write so the assertion is true
 * end-to-end. No Stripe SDK is involved — bypass codes skip Stripe entirely.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

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
import type { FacilityAccount } from "@shared/schema";

const FACILITY_NUMBER = "TEST-FAC-REDEEM-A";
const FACILITY_USERNAME = "test-fac-redeem-a-user";
const FACILITY_PASSWORD = "test-pw-redeem-a-12345!";
const FACILITY_EMAIL = "test-fac-redeem-a@example.com";

let testPassportRegistered = false;
let facilityAccountId: number;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: "redeem-test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 1000 },
    }),
  );

  if (!testPassportRegistered) {
    passport.use(
      "redeem-test-local",
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
      "redeem-test-local",
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
    `DELETE FROM facility_accounts WHERE facility_number = $1`,
    [FACILITY_NUMBER],
  );
  await pool.end();
});

beforeEach(async () => {
  // Reset the cache columns so each test starts from the "free tier" baseline.
  await pool.query(
    `UPDATE facility_accounts
        SET subscription_status = NULL,
            subscription_current_period_end = NULL
      WHERE id = $1`,
    [facilityAccountId],
  );
  // Default to a known, single-code config; individual tests override.
  process.env.OPERATIONS_BYPASS_CODES = "OWNER_FOREVER";
});

describe("POST /api/billing/redeem-code", () => {
  it("returns 401 when not authenticated", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ code: "OWNER_FOREVER" });
    expect(res.status).toBe(401);
  });

  it("returns 503 BYPASS_NOT_CONFIGURED when env var is unset", async () => {
    delete process.env.OPERATIONS_BYPASS_CODES;
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ code: "ANYTHING" });
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: "BYPASS_NOT_CONFIGURED" });
  });

  it("returns 503 BYPASS_NOT_CONFIGURED when env var is empty string", async () => {
    process.env.OPERATIONS_BYPASS_CODES = "";
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ code: "OWNER_FOREVER" });
    expect(res.status).toBe(503);
  });

  it("returns 400 INVALID_CODE when body has no code field", async () => {
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: "INVALID_CODE" });
  });

  it("returns 400 INVALID_CODE when code is empty / whitespace only", async () => {
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ code: "   " });
    expect(res.status).toBe(400);
  });

  it("returns 400 INVALID_CODE when code does not match", async () => {
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ code: "WRONG_CODE_123" });
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: "INVALID_CODE" });
    // Account is not flipped.
    const after = await pool.query<{ subscription_status: string | null }>(
      `SELECT subscription_status FROM facility_accounts WHERE id = $1`,
      [facilityAccountId],
    );
    expect(after.rows[0].subscription_status).toBeNull();
  });

  it("returns 400 INVALID_CODE for a different-length wrong code (timing-safe)", async () => {
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ code: "X" }); // 1 char vs OWNER_FOREVER's 13 chars
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: "INVALID_CODE" });
  });

  it("returns 200 and flips the account to active when code matches", async () => {
    const app = buildApp();
    const agent = await loginAgent(app);
    const beforeMs = Date.now();
    const res = await agent
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ code: "OWNER_FOREVER" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "active" });

    const after = await pool.query<{
      subscription_status: string | null;
      subscription_current_period_end: string | number | null;
    }>(
      `SELECT subscription_status, subscription_current_period_end
         FROM facility_accounts WHERE id = $1`,
      [facilityAccountId],
    );
    expect(after.rows[0].subscription_status).toBe("active");
    const periodEnd = Number(after.rows[0].subscription_current_period_end);
    // Far-future: at least 50 years out.
    const fiftyYears = 50 * 365 * 24 * 60 * 60 * 1000;
    expect(periodEnd).toBeGreaterThan(beforeMs + fiftyYears);
  });

  it("accepts any code from a multi-code list", async () => {
    process.env.OPERATIONS_BYPASS_CODES = "FIRST_CODE, SECOND_CODE ,THIRD_CODE";
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ code: "SECOND_CODE" });
    expect(res.status).toBe(200);
  });

  it("is case-sensitive", async () => {
    const app = buildApp();
    const agent = await loginAgent(app);
    const res = await agent
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ code: "owner_forever" });
    expect(res.status).toBe(400);
  });
});
