/**
 * Phase 5 — billing_bypass_redemptions integration tests.
 *
 * Single-use-per-account is enforced at the DB layer by a partial UNIQUE
 * index on (account_id) WHERE revoked_at IS NULL. The redeem-code route
 * translates the resulting 23505 unique_violation into a clean 409
 * BYPASS_ALREADY_REDEEMED.
 *
 * Coverage:
 *   - First redeem from account A inserts a row + flips the account to
 *     `subscription_status = 'active'` (the existing happy path is
 *     unchanged by Phase 5).
 *   - Second redeem from account A returns 409 BYPASS_ALREADY_REDEEMED.
 *     The route MUST NOT write a duplicate row, and MUST NOT re-stamp
 *     the cache columns (idempotent failure).
 *   - Account B can still redeem — the UNIQUE is per-account, not global.
 *   - Setting revoked_at on the existing row re-opens the slot; account A
 *     can redeem again, producing a SECOND row.
 *   - Only the first 8 chars of the submitted code are persisted.
 *
 * Conventions reused from redeemCodeEndpoint.test.ts (in this directory).
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

const FACILITY_A_NUMBER = "TEST-FAC-BYPASS-A";
const FACILITY_A_USERNAME = "test-fac-bypass-a-user";
const FACILITY_A_PASSWORD = "test-pw-bypass-a-12345!";
const FACILITY_A_EMAIL = "test-fac-bypass-a@example.com";

const FACILITY_B_NUMBER = "TEST-FAC-BYPASS-B";
const FACILITY_B_USERNAME = "test-fac-bypass-b-user";
const FACILITY_B_PASSWORD = "test-pw-bypass-b-12345!";
const FACILITY_B_EMAIL = "test-fac-bypass-b@example.com";

const FULL_CODE = "BYPASSCODE_LONG_2026";

let testPassportRegistered = false;
let accountAId: number;
let accountBId: number;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: "bypass-test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 1000 },
    }),
  );

  if (!testPassportRegistered) {
    passport.use(
      "bypass-test-local",
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
      "bypass-test-local",
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

async function loginAgent(
  app: Express,
  username: string,
  password: string,
): Promise<request.Agent> {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/facility/login")
    .set("X-Requested-With", "XMLHttpRequest")
    .send({ username, password });
  expect(res.status, `login failed: ${res.text}`).toBe(200);
  return agent;
}

beforeAll(async () => {
  await bootstrapMainSchema();
  const hashed = await hashPassword(FACILITY_A_PASSWORD);
  const hashedB = await hashPassword(FACILITY_B_PASSWORD);
  const rA = await pool.query<{ id: number }>(
    `INSERT INTO facility_accounts
       (facility_number, username, password, role, email, email_verified, created_at)
     VALUES ($1, $2, $3, 'facility_admin', $4, 1, $5)
     ON CONFLICT (facility_number) DO UPDATE SET
       username = EXCLUDED.username,
       password = EXCLUDED.password,
       email = EXCLUDED.email,
       email_verified = 1
     RETURNING id`,
    [FACILITY_A_NUMBER, FACILITY_A_USERNAME, hashed, FACILITY_A_EMAIL, Date.now()],
  );
  accountAId = Number(rA.rows[0].id);
  const rB = await pool.query<{ id: number }>(
    `INSERT INTO facility_accounts
       (facility_number, username, password, role, email, email_verified, created_at)
     VALUES ($1, $2, $3, 'facility_admin', $4, 1, $5)
     ON CONFLICT (facility_number) DO UPDATE SET
       username = EXCLUDED.username,
       password = EXCLUDED.password,
       email = EXCLUDED.email,
       email_verified = 1
     RETURNING id`,
    [FACILITY_B_NUMBER, FACILITY_B_USERNAME, hashedB, FACILITY_B_EMAIL, Date.now()],
  );
  accountBId = Number(rB.rows[0].id);
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM billing_bypass_redemptions WHERE account_id = ANY($1::int[])`,
    [[accountAId, accountBId]],
  );
  await pool.query(
    `DELETE FROM facility_accounts WHERE facility_number = ANY($1::text[])`,
    [[FACILITY_A_NUMBER, FACILITY_B_NUMBER]],
  );
  await pool.end();
});

beforeEach(async () => {
  // Fresh slate: clear redemptions + cache columns.
  await pool.query(
    `DELETE FROM billing_bypass_redemptions WHERE account_id = ANY($1::int[])`,
    [[accountAId, accountBId]],
  );
  await pool.query(
    `UPDATE facility_accounts
        SET subscription_status = NULL,
            subscription_current_period_end = NULL
      WHERE id = ANY($1::int[])`,
    [[accountAId, accountBId]],
  );
  process.env.OPERATIONS_BYPASS_CODES = FULL_CODE;
});

describe("POST /api/billing/redeem-code — Phase 5 single-use audit", () => {
  it("first redeem inserts a row + persists only the first 8 chars", async () => {
    const app = buildApp();
    const agent = await loginAgent(
      app,
      FACILITY_A_USERNAME,
      FACILITY_A_PASSWORD,
    );
    const res = await agent
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ code: FULL_CODE });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "active" });

    const rows = await pool.query<{
      code_prefix: string;
      account_id: number;
      revoked_at: number | null;
    }>(
      `SELECT code_prefix, account_id, revoked_at
         FROM billing_bypass_redemptions WHERE account_id = $1`,
      [accountAId],
    );
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0].code_prefix).toBe(FULL_CODE.slice(0, 8));
    expect(rows.rows[0].code_prefix.length).toBeLessThanOrEqual(8);
    expect(rows.rows[0].revoked_at).toBeNull();
  });

  it("second redeem from the same account returns 409 BYPASS_ALREADY_REDEEMED", async () => {
    const app = buildApp();
    const agent = await loginAgent(
      app,
      FACILITY_A_USERNAME,
      FACILITY_A_PASSWORD,
    );
    const first = await agent
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ code: FULL_CODE });
    expect(first.status).toBe(200);

    const second = await agent
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ code: FULL_CODE });
    expect(second.status).toBe(409);
    expect(second.body).toEqual({ code: "BYPASS_ALREADY_REDEEMED" });

    // Only ONE row exists (the duplicate-key INSERT failed cleanly).
    const count = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM billing_bypass_redemptions WHERE account_id = $1`,
      [accountAId],
    );
    expect(count.rows[0].n).toBe(1);
  });

  it("a different account can still redeem (UNIQUE is per-account)", async () => {
    const app = buildApp();

    // Account A redeems first.
    const agentA = await loginAgent(
      app,
      FACILITY_A_USERNAME,
      FACILITY_A_PASSWORD,
    );
    const aRes = await agentA
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ code: FULL_CODE });
    expect(aRes.status).toBe(200);

    // Account B redeems second — must succeed.
    const agentB = await loginAgent(
      app,
      FACILITY_B_USERNAME,
      FACILITY_B_PASSWORD,
    );
    const bRes = await agentB
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ code: FULL_CODE });
    expect(bRes.status).toBe(200);
    expect(bRes.body).toEqual({ status: "active" });

    const rows = await pool.query<{ account_id: number }>(
      `SELECT account_id FROM billing_bypass_redemptions
        WHERE account_id = ANY($1::int[]) ORDER BY account_id`,
      [[accountAId, accountBId]],
    );
    expect(rows.rows).toHaveLength(2);
  });

  it("revoking the row re-opens the slot — account A can redeem again", async () => {
    const app = buildApp();
    const agent = await loginAgent(
      app,
      FACILITY_A_USERNAME,
      FACILITY_A_PASSWORD,
    );
    const first = await agent
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ code: FULL_CODE });
    expect(first.status).toBe(200);

    // Manually revoke (operator action — Phase 5 doesn't ship a revoke
    // route yet, just the column).
    await pool.query(
      `UPDATE billing_bypass_redemptions
          SET revoked_at = $1, revoked_by = 'test-suite', updated_at = $1
        WHERE account_id = $2`,
      [Date.now(), accountAId],
    );

    const second = await agent
      .post("/api/billing/redeem-code")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ code: FULL_CODE });
    expect(second.status).toBe(200);

    const rows = await pool.query<{
      revoked_at: number | null;
    }>(
      `SELECT revoked_at FROM billing_bypass_redemptions
        WHERE account_id = $1 ORDER BY id ASC`,
      [accountAId],
    );
    // Two rows: the original (revoked) + the new active one.
    expect(rows.rows).toHaveLength(2);
    expect(rows.rows[0].revoked_at).not.toBeNull(); // revoked
    expect(rows.rows[1].revoked_at).toBeNull(); // active
  });
});
