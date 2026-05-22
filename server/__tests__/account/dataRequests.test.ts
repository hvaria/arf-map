/**
 * Phase 4 — /api/account/* endpoint integration tests.
 *
 * Verifies (against the real test Postgres):
 *   - POST /api/account/data-export creates a 'pending' export row.
 *   - POST /api/account/delete-request creates a 'pending' delete row.
 *   - POST /api/account/email-change/initiate inserts a row with the OTP
 *     hashed (not raw) in payload_json + rate-limits the request body shape.
 *   - POST /api/account/email-change/verify with the right OTP flips status
 *     to 'fulfilled' AND updates the live account email.
 *   - 401 when no session is attached.
 *
 * Auth path: the test app stamps `req.session.jobSeekerId` directly via a
 * test-only login endpoint (same shim used by credentials.test.ts), since
 * the production /api/jobseeker/login flow requires an email-verified
 * account and would force a heavier fixture.
 *
 * Email delivery: we mock `../email` so sendVerificationEmail is captured
 * (and never actually attempts to hit Resend / SMTP from the test runner).
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// ── email module mock — capture the send calls without delivering ────────────
const emailMocks = vi.hoisted(() => {
  return {
    sendVerificationEmail: vi.fn(async (_to: string, _otp: string) => {}),
    sendEmail: vi.fn(async (_args: { to: string; subject: string; html: string; text?: string }) => ({})),
    sendPasswordResetEmail: vi.fn(async () => {}),
  };
});

vi.mock("../../email", () => emailMocks);

import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import session from "express-session";
import request from "supertest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { accountRouter } from "../../routes/account";

const SEEKER_EMAIL = "test-acct-seeker@example.com";
const SEEKER_USERNAME = "test-acct-seeker";
let seekerId: number;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: "account-test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 1000 },
    }),
  );

  // Same CSRF guard as production.
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

  // Test-only fast login.
  app.post("/__test/seeker-login", (req: Request, res: Response, next) => {
    const { jobSeekerId } = req.body as { jobSeekerId: number };
    req.session.regenerate((regErr) => {
      if (regErr) return next(regErr);
      req.session.jobSeekerId = jobSeekerId;
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.json({ ok: true, jobSeekerId });
      });
    });
  });

  app.use("/api/account", accountRouter);
  return app;
}

async function authedAgent(app: Express, id: number): Promise<request.Agent> {
  const agent = request.agent(app);
  const r = await agent
    .post("/__test/seeker-login")
    .set("X-Requested-With", "XMLHttpRequest")
    .send({ jobSeekerId: id });
  expect(r.status, `test login failed: ${r.text}`).toBe(200);
  return agent;
}

beforeAll(async () => {
  await bootstrapMainSchema();
  const r = await pool.query<{ id: number }>(
    `INSERT INTO job_seeker_accounts (username, email, password, email_verified, created_at)
     VALUES ($1, $2, 'unused-hash', 1, $3)
     ON CONFLICT (email) DO UPDATE SET username = EXCLUDED.username, email = EXCLUDED.email
     RETURNING id`,
    [SEEKER_USERNAME, SEEKER_EMAIL, Date.now()],
  );
  seekerId = Number(r.rows[0].id);
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM account_data_requests WHERE account_kind = 'job_seeker' AND account_id = $1`,
    [seekerId],
  );
  await pool.query(
    `DELETE FROM job_seeker_accounts WHERE id = $1`,
    [seekerId],
  );
});

beforeEach(async () => {
  await pool.query(
    `DELETE FROM account_data_requests WHERE account_kind = 'job_seeker' AND account_id = $1`,
    [seekerId],
  );
  // Reset the email back to the canonical address before each test.
  await pool.query(
    `UPDATE job_seeker_accounts SET email = $1 WHERE id = $2`,
    [SEEKER_EMAIL, seekerId],
  );
  emailMocks.sendVerificationEmail.mockClear();
  emailMocks.sendEmail.mockClear();
});

describe("POST /api/account/data-export", () => {
  it("returns 401 without a session", async () => {
    const app = buildApp();
    const res = await request(app)
      .post("/api/account/data-export")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({});
    expect(res.status).toBe(401);
  });

  it("inserts a pending export row and returns the request id", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerId);
    const res = await agent
      .post("/api/account/data-export")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({});
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ estimatedFulfillmentDays: 45 });
    expect(typeof res.body.requestId).toBe("number");

    const rows = await pool.query(
      `SELECT kind, status FROM account_data_requests WHERE id = $1`,
      [res.body.requestId],
    );
    expect(rows.rows[0]).toMatchObject({ kind: "export", status: "pending" });
  });
});

describe("POST /api/account/delete-request", () => {
  it("inserts a pending delete row", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerId);
    const res = await agent
      .post("/api/account/delete-request")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({});
    expect(res.status).toBe(201);
    expect(res.body.estimatedFulfillmentDays).toBe(45);

    const rows = await pool.query(
      `SELECT kind, status FROM account_data_requests WHERE id = $1`,
      [res.body.requestId],
    );
    expect(rows.rows[0]).toMatchObject({ kind: "delete", status: "pending" });
  });
});

describe("POST /api/account/email-change/initiate", () => {
  it("rejects an invalid email body shape with 400", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerId);
    const res = await agent
      .post("/api/account/email-change/initiate")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ newEmail: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("inserts a pending email_change row with hashed OTP (raw not stored)", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerId);
    const NEW_EMAIL = "test-acct-seeker-NEW@example.com";
    const res = await agent
      .post("/api/account/email-change/initiate")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ newEmail: NEW_EMAIL });
    expect(res.status).toBe(201);
    expect(typeof res.body.requestId).toBe("number");

    const row = (
      await pool.query<{
        kind: string;
        status: string;
        payload_json: any;
      }>(
        `SELECT kind, status, payload_json FROM account_data_requests WHERE id = $1`,
        [res.body.requestId],
      )
    ).rows[0];
    expect(row.kind).toBe("email_change");
    expect(row.status).toBe("pending");
    const payload = row.payload_json as { newEmail: string; otpHash: string; otpExpiry: number };
    expect(payload.newEmail).toBe(NEW_EMAIL.toLowerCase());
    // OTP hash should be SHA-256 hex (64 chars); the raw 6-digit OTP must
    // NEVER be persisted.
    expect(payload.otpHash).toMatch(/^[a-f0-9]{64}$/);
    expect(payload.otpExpiry).toBeGreaterThan(Date.now());

    // Both addresses got the verification email.
    expect(emailMocks.sendVerificationEmail).toHaveBeenCalledTimes(2);
    const recipients = emailMocks.sendVerificationEmail.mock.calls.map((c) => c[0]);
    expect(recipients.sort()).toEqual([NEW_EMAIL.toLowerCase(), SEEKER_EMAIL]);
  });

  it("rejects a newEmail equal to the current email", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerId);
    const res = await agent
      .post("/api/account/email-change/initiate")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ newEmail: SEEKER_EMAIL });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/current/i);
  });
});

describe("POST /api/account/email-change/verify", () => {
  it("flips status=fulfilled and updates the account email on correct OTP", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerId);
    const NEW_EMAIL = "test-acct-seeker-V2@example.com";

    const init = await agent
      .post("/api/account/email-change/initiate")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ newEmail: NEW_EMAIL });
    expect(init.status).toBe(201);
    const requestId: number = init.body.requestId;

    // Pull the raw OTP back out of the captured email mock. The OTP is the
    // 2nd argument to the FIRST send call.
    const otp = emailMocks.sendVerificationEmail.mock.calls[0]?.[1];
    expect(typeof otp).toBe("string");
    expect(otp).toMatch(/^\d{6}$/);

    const verify = await agent
      .post("/api/account/email-change/verify")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ requestId, otp });
    expect(verify.status, verify.text).toBe(200);
    expect(verify.body.ok).toBe(true);
    expect(verify.body.newEmail).toBe(NEW_EMAIL.toLowerCase());

    // Request is fulfilled.
    const req = await pool.query(
      `SELECT status, fulfilled_at FROM account_data_requests WHERE id = $1`,
      [requestId],
    );
    expect(req.rows[0].status).toBe("fulfilled");
    expect(req.rows[0].fulfilled_at).not.toBeNull();

    // Account email is updated.
    const acct = await pool.query(
      `SELECT email FROM job_seeker_accounts WHERE id = $1`,
      [seekerId],
    );
    expect(acct.rows[0].email).toBe(NEW_EMAIL.toLowerCase());
  });

  it("returns 400 INVALID_OTP on a wrong code", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerId);
    const init = await agent
      .post("/api/account/email-change/initiate")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ newEmail: "test-acct-seeker-BAD@example.com" });
    expect(init.status).toBe(201);
    const requestId: number = init.body.requestId;

    const verify = await agent
      .post("/api/account/email-change/verify")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ requestId, otp: "000000" });
    expect(verify.status).toBe(400);
    expect(verify.body.code).toBe("INVALID_OTP");

    // Account email unchanged.
    const acct = await pool.query(
      `SELECT email FROM job_seeker_accounts WHERE id = $1`,
      [seekerId],
    );
    expect(acct.rows[0].email).toBe(SEEKER_EMAIL);
  });
});
