/**
 * Phase 7 — External IDs (nanoid) for URL-exposed tables.
 *
 * Verifies:
 *   - Storage layer auto-generates a 12-char URL-safe `external_id` on every
 *     insert into job_postings and applicant_interests.
 *   - The generated id is unique across rows.
 *   - URL-exposed routes look up by external_id and 404 on unknown ids.
 *   - Responses never expose the internal integer PK on either table.
 *
 * Uses the real Postgres test DB plus a minimal Express app that mounts
 * the production routers behind a CSRF-and-session shim (mirrors the
 * pattern in server/__tests__/billing/checkoutEndpoint.test.ts).
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

import { pool } from "../db/index";
import { bootstrapMainSchema } from "../db/bootstrap";
import { storage } from "../storage";
import { hashPassword, comparePassword } from "../auth";
import { interestsRouter } from "../routes/interests";
import type { FacilityAccount } from "@shared/schema";

const FACILITY_NUMBER = "TEST-FAC-PHASE-7";
const FACILITY_USERNAME = "test-fac-phase-7-user";
const FACILITY_PASSWORD = "test-pw-phase-7-12345!";
const FACILITY_EMAIL = "test-fac-phase-7@example.com";
const SEEKER_EMAIL = "test-seeker-phase-7@example.com";
const SEEKER_USERNAME = "test-seeker-phase-7";

let testPassportRegistered = false;
let facilityAccountId: number;
let seekerId: number;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: "phase-7-test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: { secure: false, httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 1000 },
    }),
  );

  if (!testPassportRegistered) {
    passport.use(
      "phase-7-test-local",
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

  // Same CSRF guard as production.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const m = req.method.toUpperCase();
    if (["POST", "PUT", "DELETE", "PATCH"].includes(m) && req.path.startsWith("/api/")) {
      const xrw = req.headers["x-requested-with"];
      if (!xrw || (xrw as string).toLowerCase() !== "xmlhttprequest") {
        return res.status(403).json({ message: "CSRF validation failed." });
      }
    }
    next();
  });

  app.post("/api/facility/login", (req, res, next) => {
    passport.authenticate("phase-7-test-local", (err: Error | null, user: FacilityAccount | false) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: "Invalid credentials" });
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        return res.json({ id: user.id, facilityNumber: user.facilityNumber });
      });
    })(req, res, next);
  });

  // Test-only fast seeker login (mirrors credentials.test.ts).
  app.post("/__test/seeker-login", (req, res, next) => {
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

  app.use("/api", interestsRouter);
  return app;
}

async function loginFacility(app: Express): Promise<request.Agent> {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/facility/login")
    .set("X-Requested-With", "XMLHttpRequest")
    .send({ username: FACILITY_USERNAME, password: FACILITY_PASSWORD });
  expect(res.status, `facility login failed: ${res.text}`).toBe(200);
  return agent;
}

async function loginSeeker(app: Express): Promise<request.Agent> {
  const agent = request.agent(app);
  const res = await agent
    .post("/__test/seeker-login")
    .set("X-Requested-With", "XMLHttpRequest")
    .send({ jobSeekerId: seekerId });
  expect(res.status, `seeker login failed: ${res.text}`).toBe(200);
  return agent;
}

beforeAll(async () => {
  await bootstrapMainSchema();

  // Facility account fixture.
  const hashed = await hashPassword(FACILITY_PASSWORD);
  const r1 = await pool.query<{ id: number }>(
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
  facilityAccountId = Number(r1.rows[0].id);

  // Seeker account fixture.
  const r2 = await pool.query<{ id: number }>(
    `INSERT INTO job_seeker_accounts (username, email, password, email_verified, created_at)
     VALUES ($1, $2, 'unused-hash', 1, $3)
     ON CONFLICT (email) DO UPDATE SET username = EXCLUDED.username
     RETURNING id`,
    [SEEKER_USERNAME, SEEKER_EMAIL, Date.now()],
  );
  seekerId = Number(r2.rows[0].id);
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM applicant_interests WHERE facility_number = $1 OR job_seeker_id = $2`,
    [FACILITY_NUMBER, seekerId],
  );
  await pool.query(`DELETE FROM job_postings WHERE facility_number = $1`, [FACILITY_NUMBER]);
  await pool.query(`DELETE FROM job_seeker_accounts WHERE id = $1`, [seekerId]);
  await pool.query(`DELETE FROM facility_accounts WHERE facility_number = $1`, [FACILITY_NUMBER]);
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    `DELETE FROM applicant_interests WHERE facility_number = $1 OR job_seeker_id = $2`,
    [FACILITY_NUMBER, seekerId],
  );
  await pool.query(`DELETE FROM job_postings WHERE facility_number = $1`, [FACILITY_NUMBER]);
});

// ── Storage layer assertions ────────────────────────────────────────────────

describe("Phase 7 — storage layer", () => {
  it("createJobPosting auto-generates a 12-char URL-safe external_id", async () => {
    const jp = await storage.createJobPosting(FACILITY_NUMBER, {
      title: "Caregiver",
      type: "Full-time",
      salary: "$18-22/hr",
      description: "Test posting description.",
      requirements: JSON.stringify(["CPR"]),
    });

    expect(jp.externalId).toBeTypeOf("string");
    expect(jp.externalId).toHaveLength(12);
    // nanoid default alphabet — URL-safe (A-Za-z0-9_-).
    expect(jp.externalId).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });

  it("createJobPosting generates a fresh external_id on every insert (uniqueness)", async () => {
    const externalIds = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const jp = await storage.createJobPosting(FACILITY_NUMBER, {
        title: `Caregiver ${i}`,
        type: "Full-time",
        salary: "$18-22/hr",
        description: `Test posting ${i} — long enough to pass any sanity filter.`,
        requirements: JSON.stringify(["CPR"]),
      });
      externalIds.add(jp.externalId);
    }
    expect(externalIds.size).toBe(10);
  });

  it("getJobPostingByExternalId returns the row when present; undefined otherwise", async () => {
    const created = await storage.createJobPosting(FACILITY_NUMBER, {
      title: "Caregiver",
      type: "Full-time",
      salary: "$18-22/hr",
      description: "Test posting description.",
      requirements: JSON.stringify([]),
    });

    const found = await storage.getJobPostingByExternalId(created.externalId);
    expect(found?.id).toBe(created.id);
    expect(found?.externalId).toBe(created.externalId);

    const missing = await storage.getJobPostingByExternalId("does-not-exist");
    expect(missing).toBeUndefined();
  });

  it("upsertApplicantInterest auto-generates a 12-char external_id", async () => {
    const interest = await storage.upsertApplicantInterest(seekerId, FACILITY_NUMBER, {
      roleInterest: "Caregiver",
      message: "Hello",
    });
    expect(interest.externalId).toBeTypeOf("string");
    expect(interest.externalId).toHaveLength(12);
    expect(interest.externalId).toMatch(/^[A-Za-z0-9_-]{12}$/);
  });
});

// ── Route layer assertions ──────────────────────────────────────────────────

describe("Phase 7 — /api/jobs/:externalId route", () => {
  it("looks up by external_id; 404 on unknown id; never exposes internal integer id", async () => {
    const created = await storage.createJobPosting(FACILITY_NUMBER, {
      title: "Test Caregiver",
      type: "Full-time",
      salary: "$18-22/hr",
      description: "A test job posting long enough to pass any sanity filter.",
      requirements: JSON.stringify(["CPR"]),
    });

    const app = buildApp();

    // GET by external_id → 200 + the row, with no internal `id` on the wire.
    const ok = await request(app).get(`/api/jobs/${created.externalId}`);
    expect(ok.status).toBe(200);
    expect(ok.body.externalId).toBe(created.externalId);
    expect(ok.body.title).toBe("Test Caregiver");
    expect(ok.body.id).toBeUndefined();

    // GET by unknown external_id → 404.
    const miss = await request(app).get(`/api/jobs/aaaaaaaaaaaa`);
    expect(miss.status).toBe(404);

    // GET by integer id (legacy URL) → 404; the lookup column is external_id
    // so a bare integer string just doesn't resolve.
    const legacy = await request(app).get(`/api/jobs/${created.id}`);
    expect(legacy.status).toBe(404);
  });

  it("rejects a malformed external_id with 400", async () => {
    const app = buildApp();
    const short = await request(app).get(`/api/jobs/abc`);
    expect(short.status).toBe(400);
  });
});

describe("Phase 7 — /api/jobseeker/interests/:externalId route", () => {
  it("DELETE by external_id removes the row; 404 for unknown id; integer id 404s as 'invalid'", async () => {
    const interest = await storage.upsertApplicantInterest(seekerId, FACILITY_NUMBER, {
      roleInterest: "Caregiver",
    });
    expect(interest.externalId).toMatch(/^[A-Za-z0-9_-]{12}$/);

    const app = buildApp();
    const agent = await loginSeeker(app);

    // Happy-path DELETE by external_id.
    const ok = await agent
      .delete(`/api/jobseeker/interests/${interest.externalId}`)
      .set("X-Requested-With", "XMLHttpRequest");
    expect(ok.status).toBe(200);

    // 404 on a fresh interest's external_id that no longer exists.
    const miss = await agent
      .delete(`/api/jobseeker/interests/${interest.externalId}`)
      .set("X-Requested-With", "XMLHttpRequest");
    expect(miss.status).toBe(404);

    // Legacy DELETE by integer PK should not work — `1` is too short and is
    // rejected by the EXTERNAL_ID_REGEX guard (400).
    const legacy = await agent
      .delete(`/api/jobseeker/interests/${interest.id}`)
      .set("X-Requested-With", "XMLHttpRequest");
    expect([400, 404]).toContain(legacy.status);
  });
});

describe("Phase 7 — wire shape", () => {
  it("GET /api/jobseeker/interests never exposes the internal integer id", async () => {
    await storage.upsertApplicantInterest(seekerId, FACILITY_NUMBER, {
      roleInterest: "Caregiver",
    });

    const app = buildApp();
    const agent = await loginSeeker(app);

    const list = await agent.get("/api/jobseeker/interests");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBeGreaterThan(0);
    for (const row of list.body) {
      expect(row.externalId).toBeTypeOf("string");
      expect(row.externalId).toHaveLength(12);
      expect(row.id).toBeUndefined();
    }
  });

  it("GET /api/facility/applicants never exposes the internal integer id", async () => {
    await storage.upsertApplicantInterest(seekerId, FACILITY_NUMBER, {
      roleInterest: "Caregiver",
    });

    const app = buildApp();
    const agent = await loginFacility(app);

    const list = await agent.get("/api/facility/applicants");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body.length).toBeGreaterThan(0);
    for (const row of list.body) {
      expect(row.externalId).toBeTypeOf("string");
      expect(row.externalId).toHaveLength(12);
      expect(row.id).toBeUndefined();
    }
  });
});
