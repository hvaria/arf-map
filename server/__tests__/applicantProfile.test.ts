/**
 * Applicant Profile Review — server tests.
 *
 *  - Pure unit tests for computeExpiryStatus (always run, no DB).
 *  - API integration tests for the full-profile detail endpoint, auto-"viewed"
 *    transition, status enum validation, tenant isolation, and notes
 *    soft-delete. These branch on DB reachability (matches health.test.ts) so
 *    the suite stays green on a machine with no Postgres.
 *
 * Reuses the tracker test harness (buildTestApp + seedFacility) and mounts the
 * interestsRouter (which owns /api/facility/applicants/*) onto it.
 */
import "dotenv/config";
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { buildTestApp, seedFacility, cleanFacilityAccounts } from "./trackers/setupTestApp";
import { interestsRouter } from "../routes/interests";
import { storage, computeExpiryStatus } from "../storage";
import { pool } from "../db/index";

const HEADERS = { "X-Requested-With": "XMLHttpRequest" } as const;

const FAC_A = "TEST-APR-A";
const FAC_B = "TEST-APR-B";

// ── Pure unit: expiry tone (no DB) ───────────────────────────────────────────
describe("computeExpiryStatus", () => {
  const NOW = Date.UTC(2026, 4, 29); // 2026-05-29 (matches the session date)
  const day = 86_400_000;

  it("returns 'none' for null/empty/garbage", () => {
    expect(computeExpiryStatus(null, NOW)).toBe("none");
    expect(computeExpiryStatus(undefined, NOW)).toBe("none");
    expect(computeExpiryStatus("", NOW)).toBe("none");
    expect(computeExpiryStatus("not-a-date", NOW)).toBe("none");
  });

  it("returns 'expired' for a past date", () => {
    expect(computeExpiryStatus("2026-05-28", NOW)).toBe("expired");
    expect(computeExpiryStatus("2020-01-01", NOW)).toBe("expired");
  });

  it("returns 'expiring' within the 60-day window", () => {
    expect(computeExpiryStatus("2026-05-29", NOW)).toBe("expiring"); // today (0 days)
    expect(computeExpiryStatus("2026-07-15", NOW)).toBe("expiring"); // ~47 days
    expect(computeExpiryStatus(new Date(NOW + 60 * day).toISOString().slice(0, 10), NOW)).toBe("expiring");
  });

  it("returns 'valid' beyond 60 days out", () => {
    expect(computeExpiryStatus(new Date(NOW + 61 * day).toISOString().slice(0, 10), NOW)).toBe("valid");
    expect(computeExpiryStatus("2027-01-31", NOW)).toBe("valid");
  });
});

// ── API integration (branches on DB reachability) ───────────────────────────
describe("Applicant profile API", () => {
  let app: Express;
  let dbReachable = false;
  let seekerAId = 0;
  let interestA = ""; // FAC_A's applicant, status pending
  let interestB = ""; // FAC_B's applicant (foreign to FAC_A)

  beforeAll(async () => {
    try {
      await pool.query("SELECT 1");
      dbReachable = true;
    } catch {
      dbReachable = false;
      return;
    }

    app = buildTestApp();
    // The shared harness only mounts /api/ops; the applicant routes live on
    // interestsRouter at /api. Mounting it here is additive (the error handler
    // in buildTestApp doesn't intercept normal route matching).
    app.use("/api", interestsRouter);

    await seedFacility({ facilityNumber: FAC_A, username: "apr-a", password: "pw-aaaaaa1", email: "apr-a@test.dev" });
    await seedFacility({ facilityNumber: FAC_B, username: "apr-b", password: "pw-bbbbbb1", email: "apr-b@test.dev" });

    // Two job seekers, each with a profile, applying to one facility apiece.
    seekerAId = await seedSeeker("apr-seeker-a@test.dev", {
      firstName: "Maria", lastName: "Lopez", city: "San Jose", state: "CA",
      yearsExperience: 5, jobTypes: ["Caregiver", "Med Tech"], bio: "Memory care.",
    });
    const seekerBId = await seedSeeker("apr-seeker-b@test.dev", {
      firstName: "Jordan", lastName: "Kim", city: "Oakland", state: "CA", yearsExperience: 2,
    });

    await storage.createJobSeekerCredential(seekerAId, {
      kind: "CNA", licenseNumber: "C12345", issuingAuthority: "CDPH",
      issuedAt: "2021-02-01", expiresAt: "2027-01-31",
    });

    const iA = await storage.upsertApplicantInterest(seekerAId, FAC_A, {
      roleInterest: "Caregiver", message: "I have 5 years in RCFE settings.",
    });
    interestA = iA.externalId;
    const iB = await storage.upsertApplicantInterest(seekerBId, FAC_B, { roleInterest: "DSP" });
    interestB = iB.externalId;
  });

  afterAll(async () => {
    if (!dbReachable) return;
    // Interests + notes + history cascade off the interest FK; clean the
    // facility accounts and the two job seekers we created.
    await pool.query(`DELETE FROM applicant_interests WHERE facility_number = ANY($1::text[])`, [[FAC_A, FAC_B]]);
    await pool.query(`DELETE FROM job_seeker_accounts WHERE email LIKE 'apr-seeker-%@test.dev'`);
    await cleanFacilityAccounts([FAC_A, FAC_B]);
  });

  async function seedSeeker(email: string, profile: Record<string, unknown>): Promise<number> {
    const r = await pool.query<{ id: number }>(
      `INSERT INTO job_seeker_accounts (username, email, password, email_verified, created_at)
       VALUES ($1, $2, 'unused-hash', 1, $3)
       ON CONFLICT (email) DO UPDATE SET email_verified = 1 RETURNING id`,
      [email.split("@")[0], email, Date.now()],
    );
    const id = Number(r.rows[0].id);
    await storage.upsertJobSeekerProfile(id, profile as never);
    return id;
  }

  async function loginA(): Promise<request.Agent> {
    const agent = request.agent(app);
    const res = await agent.post("/api/facility/login").set(HEADERS).send({ username: "apr-a", password: "pw-aaaaaa1" });
    expect(res.status, res.text).toBe(200);
    return agent;
  }

  it("returns the full profile and auto-advances pending → viewed", async () => {
    if (!dbReachable) return;
    const agent = await loginA();

    const res = await agent.get(`/api/facility/applicants/${interestA}`).set(HEADERS);
    expect(res.status, res.text).toBe(200);
    expect(res.body.interest.status).toBe("viewed"); // auto-advanced on open
    expect(res.body.profile.firstName).toBe("Maria");
    expect(res.body.profile.jobTypes).toEqual(["Caregiver", "Med Tech"]);
    expect(res.body.credentials).toHaveLength(1);
    expect(res.body.credentials[0].expiryStatus).toBe("valid");
    expect(res.body.completion.percent).toBeGreaterThan(0);
    // The pending→viewed transition was recorded in the append-only history.
    expect(res.body.statusHistory.some((h: { toStatus: string }) => h.toStatus === "viewed")).toBe(true);
  });

  it("enforces tenant isolation — a foreign applicant 404s with no leak", async () => {
    if (!dbReachable) return;
    const agent = await loginA();
    const res = await agent.get(`/api/facility/applicants/${interestB}`).set(HEADERS);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NOT_FOUND");
    expect(res.body.profile).toBeUndefined();
  });

  it("rejects an out-of-enum status with 400", async () => {
    if (!dbReachable) return;
    const agent = await loginA();
    const res = await agent.patch(`/api/facility/applicants/${interestA}`).set(HEADERS).send({ status: "bogus" });
    expect(res.status).toBe(400);
  });

  it("accepts shortlisted/rejected/archived (new enum values)", async () => {
    if (!dbReachable) return;
    const agent = await loginA();
    for (const status of ["shortlisted", "rejected", "archived"]) {
      const res = await agent.patch(`/api/facility/applicants/${interestA}`).set(HEADERS).send({ status });
      expect(res.status, `${status}: ${res.text}`).toBe(200);
      expect(res.body.status).toBe(status);
    }
  });

  it("adds, lists, and soft-deletes an internal note", async () => {
    if (!dbReachable) return;
    const agent = await loginA();

    const created = await agent.post(`/api/facility/applicants/${interestA}/notes`).set(HEADERS).send({ body: "Strong DSP, call Tue" });
    expect(created.status, created.text).toBe(201);
    const noteId = created.body.externalId as string;
    expect(noteId).toMatch(/^[A-Za-z0-9_-]{12}$/);

    const list1 = await agent.get(`/api/facility/applicants/${interestA}/notes`).set(HEADERS);
    expect(list1.body.notes.some((n: { externalId: string }) => n.externalId === noteId)).toBe(true);

    const del = await agent.delete(`/api/facility/applicants/${interestA}/notes/${noteId}`).set(HEADERS);
    expect(del.status).toBe(204);

    const list2 = await agent.get(`/api/facility/applicants/${interestA}/notes`).set(HEADERS);
    expect(list2.body.notes.some((n: { externalId: string }) => n.externalId === noteId)).toBe(false);
  });

  it("rejects an unknown field on the note body (.strict)", async () => {
    if (!dbReachable) return;
    const agent = await loginA();
    const res = await agent.post(`/api/facility/applicants/${interestA}/notes`).set(HEADERS).send({ body: "x", evil: 1 });
    expect(res.status).toBe(400);
  });
});
