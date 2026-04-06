/**
 * Integration tests for the job seeker registration → OTP verification → profile flow.
 *
 * vi.hoisted sets DATA_DIR before any server modules are imported, ensuring the
 * singleton SQLite connection in server/db/index.ts uses the temp database.
 * Each test registers a brand-new email address so tests are fully independent.
 */
import { afterAll, describe, it, expect, vi } from "vitest";
import { rmSync } from "fs";

// ── Hoist env setup so it runs before static imports ─────────────────────────
// Must use require() here — static imports are not yet initialized when vi.hoisted runs.
const tempDir = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { mkdtempSync } = require("fs") as typeof import("fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { join } = require("path") as typeof import("path");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { tmpdir } = require("os") as typeof import("os");
  const dir = mkdtempSync(join(tmpdir(), "arf-test-"));
  process.env.DATA_DIR = dir;
  process.env.SESSION_SECRET = "test-secret-key";
  process.env.NODE_ENV = "test";
  return dir;
});

afterAll(() => {
  // Close the SQLite connection first — Windows locks open file handles
  try { sqlite.close(); } catch { /* already closed */ }
  rmSync(tempDir, { recursive: true, force: true });
});

// ── These imports now resolve after DATA_DIR is set ──────────────────────────
import supertest from "supertest";
import express from "express";
import session from "express-session";
import { storage } from "../storage";
import { hashPassword } from "../auth";
import { sqlite } from "../db/index";
import { SqliteSessionStore } from "../session/sqliteSessionStore";
import { jobseekerAuthRouter } from "../routes/jobseekerAuth";
import { requireJobSeekerAuth } from "../middleware/requireJobSeekerAuth";
import { sendVerificationEmail } from "../email";

// ── Unique email counter (scoped to this test module) ─────────────────────────
let emailCounter = 0;
function uniqueEmail() {
  return `testuser${++emailCounter}@example.com`;
}

const PASSWORD = "TestPass123!";

// ── Minimal test Express app ──────────────────────────────────────────────────
function buildTestApp() {
  const app = express();
  app.use(express.json());
  app.use(
    session({
      secret: process.env.SESSION_SECRET!,
      resave: false,
      saveUninitialized: false,
      store: new SqliteSessionStore(sqlite),
      cookie: { secure: false },
    }),
  );

  app.use("/api/jobseeker", jobseekerAuthRouter);

  app.post("/api/jobseeker/register", async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) return res.status(400).json({ message: "Email and password are required" });
    const existing = await storage.getJobSeekerAccountByEmail(email);
    if (existing) {
      if (!existing.emailVerified) {
        const n = Math.floor(100000 + Math.random() * 900000).toString();
        await storage.updateJobSeekerAccount(existing.id, {
          verificationToken: n,
          verificationExpiry: Date.now() + 15 * 60 * 1000,
        });
        await sendVerificationEmail(email, n);
        return res.json({ emailSent: true, needsVerification: true });
      }
      return res.status(409).json({ message: "Email is already registered" });
    }
    const hashed = await hashPassword(password);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const account = await storage.createJobSeekerAccount({
      username: email, email, password: hashed,
      emailVerified: 0,
      verificationToken: otp,
      verificationExpiry: Date.now() + 15 * 60 * 1000,
      createdAt: Date.now(),
    });
    await sendVerificationEmail(email, otp);
    return res.status(201).json({ emailSent: true, needsVerification: true, id: account.id });
  });

  app.post("/api/jobseeker/verify-email", async (req, res) => {
    const { email, otp } = req.body as { email?: string; otp?: string };
    if (!email || !otp) return res.status(400).json({ message: "Email and OTP are required" });
    const account = await storage.getJobSeekerAccountByEmail(email);
    if (!account) return res.status(404).json({ message: "Account not found" });
    if (account.emailVerified) return res.status(400).json({ message: "Email already verified" });
    if (!account.verificationToken || account.verificationToken !== otp) {
      return res.status(400).json({ message: "Invalid verification code" });
    }
    if (!account.verificationExpiry || Date.now() > account.verificationExpiry) {
      return res.status(400).json({ message: "Verification code has expired. Please request a new one." });
    }
    await storage.updateJobSeekerAccount(account.id, {
      emailVerified: 1, verificationToken: null, verificationExpiry: null,
    });
    req.session.jobSeekerId = account.id;
    return res.json({ ok: true, id: account.id, email: account.email });
  });

  app.get("/api/jobseeker/profile", requireJobSeekerAuth, async (req, res) => {
    const profile = await storage.getJobSeekerProfile(req.session.jobSeekerId!);
    if (!profile) return res.json(null);
    return res.json({ ...profile, jobTypes: profile.jobTypes ? JSON.parse(profile.jobTypes) : [] });
  });

  app.put("/api/jobseeker/profile", requireJobSeekerAuth, async (req, res) => {
    const { jobTypes, ...rest } = req.body;
    const data: Record<string, unknown> = { ...rest };
    if (jobTypes !== undefined) data.jobTypes = JSON.stringify(jobTypes);
    const profile = await storage.upsertJobSeekerProfile(req.session.jobSeekerId!, data as any);
    return res.json({ ...profile, jobTypes: profile.jobTypes ? JSON.parse(profile.jobTypes) : [] });
  });

  return app;
}

/** Register a brand-new user and return the live OTP from the DB. */
async function registerAndGetOtp(agent: ReturnType<typeof supertest.agent>, email: string) {
  const res = await agent.post("/api/jobseeker/register").send({ email, password: PASSWORD });
  expect(res.status).toBe(201);
  const account = await storage.getJobSeekerAccountByEmail(email);
  return { account: account!, otp: account!.verificationToken! };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("Job Seeker auth flow", () => {
  // ── Registration ────────────────────────────────────────────────────────────

  it("registration creates an unverified account", async () => {
    const email = uniqueEmail();
    await supertest(buildTestApp())
      .post("/api/jobseeker/register")
      .send({ email, password: PASSWORD })
      .expect(201);

    const account = await storage.getJobSeekerAccountByEmail(email);
    expect(account).not.toBeNull();
    expect(account!.emailVerified).toBe(0);
    expect(account!.verificationToken).toHaveLength(6);
  });

  it("registration rejects a duplicate verified email with 409", async () => {
    const email = uniqueEmail();
    const agent = supertest.agent(buildTestApp());
    const { otp } = await registerAndGetOtp(agent, email);
    await agent.post("/api/jobseeker/verify-email").send({ email, otp });

    const res = await supertest(buildTestApp())
      .post("/api/jobseeker/register")
      .send({ email, password: "other" });
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already registered/i);
  });

  // ── OTP Verification ────────────────────────────────────────────────────────

  it("verify-email marks the account as verified", async () => {
    const email = uniqueEmail();
    const agent = supertest.agent(buildTestApp());
    const { otp } = await registerAndGetOtp(agent, email);

    await agent.post("/api/jobseeker/verify-email").send({ email, otp }).expect(200);

    const account = await storage.getJobSeekerAccountByEmail(email);
    expect(account!.emailVerified).toBe(1);
    expect(account!.verificationToken).toBeNull();
  });

  it("verify-email response includes ok, id, and email", async () => {
    const email = uniqueEmail();
    const agent = supertest.agent(buildTestApp());
    const { otp } = await registerAndGetOtp(agent, email);

    const res = await agent.post("/api/jobseeker/verify-email").send({ email, otp }).expect(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.email).toBe(email);
    expect(typeof res.body.id).toBe("number");
  });

  it("verify-email establishes a session — /me returns account immediately", async () => {
    const email = uniqueEmail();
    const agent = supertest.agent(buildTestApp());
    const { otp } = await registerAndGetOtp(agent, email);
    await agent.post("/api/jobseeker/verify-email").send({ email, otp });

    const meRes = await agent.get("/api/jobseeker/me").expect(200);
    expect(meRes.body.email).toBe(email);
  });

  it("invalid OTP returns 400", async () => {
    const email = uniqueEmail();
    const agent = supertest.agent(buildTestApp());
    await registerAndGetOtp(agent, email);

    const res = await agent
      .post("/api/jobseeker/verify-email")
      .send({ email, otp: "000000" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/invalid verification code/i);
  });

  it("expired OTP returns 400", async () => {
    const email = uniqueEmail();
    await supertest(buildTestApp())
      .post("/api/jobseeker/register")
      .send({ email, password: PASSWORD });
    const account = await storage.getJobSeekerAccountByEmail(email);

    await storage.updateJobSeekerAccount(account!.id, {
      verificationToken: "999999",
      verificationExpiry: Date.now() - 1000,
    });

    const res = await supertest(buildTestApp())
      .post("/api/jobseeker/verify-email")
      .send({ email, otp: "999999" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/expired/i);
  });

  // ── Profile ─────────────────────────────────────────────────────────────────

  it("authenticated user receives null from /profile when none exists", async () => {
    const email = uniqueEmail();
    const agent = supertest.agent(buildTestApp());
    const { otp } = await registerAndGetOtp(agent, email);
    await agent.post("/api/jobseeker/verify-email").send({ email, otp });

    const res = await agent.get("/api/jobseeker/profile").expect(200);
    expect(res.body).toBeNull();
  });

  it("unauthenticated /profile request returns 401", async () => {
    await supertest(buildTestApp()).get("/api/jobseeker/profile").expect(401);
  });

  it("PUT /profile creates the first profile and returns it", async () => {
    const email = uniqueEmail();
    const agent = supertest.agent(buildTestApp());
    const { otp } = await registerAndGetOtp(agent, email);
    await agent.post("/api/jobseeker/verify-email").send({ email, otp });

    const res = await agent
      .put("/api/jobseeker/profile")
      .send({ firstName: "Jane", lastName: "Smith", city: "Sacramento", state: "CA", jobTypes: ["Caregiver"] })
      .expect(200);

    expect(res.body.firstName).toBe("Jane");
    expect(res.body.city).toBe("Sacramento");
    expect(res.body.jobTypes).toEqual(["Caregiver"]);
  });

  it("PUT /profile upserts correctly on a second call", async () => {
    const email = uniqueEmail();
    const agent = supertest.agent(buildTestApp());
    const { otp } = await registerAndGetOtp(agent, email);
    await agent.post("/api/jobseeker/verify-email").send({ email, otp });

    await agent.put("/api/jobseeker/profile").send({ firstName: "Jane", city: "Sacramento" });
    const res = await agent
      .put("/api/jobseeker/profile")
      .send({ firstName: "Janet", city: "Fresno" })
      .expect(200);

    expect(res.body.firstName).toBe("Janet");
    expect(res.body.city).toBe("Fresno");
  });

  // ── Login ────────────────────────────────────────────────────────────────────

  it("login is rejected with 403 when email is not yet verified", async () => {
    const email = uniqueEmail();
    await supertest(buildTestApp())
      .post("/api/jobseeker/register")
      .send({ email, password: PASSWORD });

    const res = await supertest(buildTestApp())
      .post("/api/jobseeker/login")
      .send({ email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("EMAIL_NOT_VERIFIED");
  });

  it("login succeeds after email verification and establishes a session", async () => {
    const email = uniqueEmail();
    const app = buildTestApp();
    const setupAgent = supertest.agent(app);
    const { otp } = await registerAndGetOtp(setupAgent, email);
    await setupAgent.post("/api/jobseeker/verify-email").send({ email, otp });

    // Simulate a new browser session (fresh agent, same app)
    const loginAgent = supertest.agent(app);
    const res = await loginAgent
      .post("/api/jobseeker/login")
      .send({ email, password: PASSWORD })
      .expect(200);
    expect(res.body.email).toBe(email);

    const meRes = await loginAgent.get("/api/jobseeker/me").expect(200);
    expect(meRes.body.email).toBe(email);
  });
});
