/**
 * W8 Chart Completeness Sweep — pure evaluator + storage + router tests.
 *
 * Coverage:
 *   - Pure evaluator (`evaluateChartCompleteness`):
 *       * every required item complete → worst=ok
 *       * one item missing → worst=missing
 *       * annual physician's report beyond window → worst=stale
 *       * stale beaten by missing in the precedence (missing wins)
 *   - Storage:
 *       * tenant isolation: facility A residents do not surface for facility B
 *       * `complete` counter matches across the un-filtered set
 *       * `worst=missing` filter returns only incomplete charts
 *       * `getChartCompletenessForResident` returns the same evaluator output
 *   - Route smoke:
 *       * 401 unauth
 *       * 403 cross-tenant facility number
 *       * 200 happy path with meta totals
 *
 * Conventions reused from server/__tests__/ops/staffCredentials.test.ts.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { bootstrapOpsSchema } from "../../ops/opsStorage";
import {
  getChartCompletenessForResident,
  listChartCompleteness,
} from "../../ops/chartCompletenessStorage";
import {
  CHART_REQUIREMENTS,
  evaluateChartCompleteness,
  type AdmissionForChart,
  type ResidentForChart,
} from "../../../shared/chart-completeness";
import {
  buildTestApp,
  cleanFacilityAccounts,
  seedFacility,
  type TestFacility,
} from "../trackers/setupTestApp";

const FACILITY_A = "TEST-FAC-CHART-A";
const FACILITY_B = "TEST-FAC-CHART-B";
const USER_A = "test-chart-a-user";
const USER_B = "test-chart-b-user";
const PW_A = "test-pw-chart-a-12345!";
const PW_B = "test-pw-chart-b-12345!";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const REQUIRED_HEADERS = { "X-Requested-With": "XMLHttpRequest" } as const;
const DAY = 24 * 60 * 60 * 1000;

let app: Express;
let facilityA: TestFacility;
let facilityB: TestFacility;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_admissions WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_residents WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_facility_settings WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
}

beforeAll(async () => {
  app = buildTestApp();
  await bootstrapMainSchema();
  await bootstrapOpsSchema();
  facilityA = await seedFacility({
    facilityNumber: FACILITY_A,
    username: USER_A,
    password: PW_A,
    email: "test-chart-a@example.com",
  });
  facilityB = await seedFacility({
    facilityNumber: FACILITY_B,
    username: USER_B,
    password: PW_B,
    email: "test-chart-b@example.com",
  });
});

afterAll(async () => {
  await cleanup();
  await cleanFacilityAccounts(ALL_FN);
  await pool.end();
});

beforeEach(async () => {
  await cleanup();
});

async function loginAgent(
  app_: Express,
  username: string,
  password: string,
): Promise<request.Agent> {
  const agent = request.agent(app_);
  const res = await agent
    .post("/api/facility/login")
    .set(REQUIRED_HEADERS)
    .send({ username, password });
  expect(res.status, `login failed: ${res.text}`).toBe(200);
  return agent;
}

async function seedResident(
  facilityNumber: string,
  overrides: Partial<{
    firstName: string;
    lastName: string;
    status: string;
    roomNumber: string | null;
  }> = {},
): Promise<number> {
  const now = Date.now();
  const r = await pool.query<{ id: number }>(
    `INSERT INTO ops_residents
       (facility_number, first_name, last_name, status, room_number,
        admission_date, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $7) RETURNING id`,
    [
      facilityNumber,
      overrides.firstName ?? "Jane",
      overrides.lastName ?? "Doe",
      overrides.status ?? "active",
      overrides.roomNumber ?? "101",
      now - 30 * DAY,
      now,
    ],
  );
  return Number(r.rows[0].id);
}

/**
 * Seed an admission with all LIC checkboxes ticked. Caller can pass
 * overrides to drop specific completed-flags or push the lic_602a date
 * back in time to exercise the "stale" path.
 */
async function seedAdmissionFull(
  facilityNumber: string,
  residentId: number,
  overrides: Partial<{
    lic601Completed: number;
    lic601Date: number | null;
    lic602aCompleted: number;
    lic602aDate: number | null;
    lic603Completed: number;
    lic603Date: number | null;
    lic604aCompleted: number;
    lic604aDate: number | null;
    lic605aCompleted: number;
    lic605aDate: number | null;
    tbTestResultsReceived: number;
  }> = {},
): Promise<number> {
  const now = Date.now();
  const r = await pool.query<{ id: number }>(
    `INSERT INTO ops_admissions
       (lead_id, facility_number, resident_id,
        lic_601_completed, lic_601_date,
        lic_602a_completed, lic_602a_date,
        lic_603_completed, lic_603_date,
        lic_604a_completed, lic_604a_date,
        lic_605a_completed, lic_605a_date,
        tb_test_results_received,
        created_at, updated_at)
     VALUES (1, $1, $2,
        $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13,
        $14, $14) RETURNING id`,
    [
      facilityNumber,
      residentId,
      overrides.lic601Completed ?? 1,
      overrides.lic601Date === undefined ? now : overrides.lic601Date,
      overrides.lic602aCompleted ?? 1,
      overrides.lic602aDate === undefined ? now : overrides.lic602aDate,
      overrides.lic603Completed ?? 1,
      overrides.lic603Date === undefined ? now : overrides.lic603Date,
      overrides.lic604aCompleted ?? 1,
      overrides.lic604aDate === undefined ? now : overrides.lic604aDate,
      overrides.lic605aCompleted ?? 1,
      overrides.lic605aDate === undefined ? now : overrides.lic605aDate,
      overrides.tbTestResultsReceived ?? 1,
      now,
    ],
  );
  return Number(r.rows[0].id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure evaluator
// ─────────────────────────────────────────────────────────────────────────────

describe("chart completeness — pure evaluator", () => {
  const baseResident: ResidentForChart = { id: 1, status: "active" };

  function makeFullAdmission(now: number): AdmissionForChart {
    return {
      lic601Completed: 1, lic601Date: now,
      lic602aCompleted: 1, lic602aDate: now,
      lic603Completed: 1, lic603Date: now,
      lic604aCompleted: 1, lic604aDate: now,
      lic605aCompleted: 1, lic605aDate: now,
      tbTestResultsReceived: 1,
    };
  }

  it("every required item complete + fresh annual → worst=ok", () => {
    const now = Date.now();
    const result = evaluateChartCompleteness(baseResident, makeFullAdmission(now), now, 365);
    expect(result.worst).toBe("ok");
    expect(result.missing).toEqual([]);
    expect(result.stale).toEqual([]);
    expect(result.completedCount).toBe(CHART_REQUIREMENTS.length);
  });

  it("null admission → every item missing", () => {
    const result = evaluateChartCompleteness(baseResident, null, Date.now(), 365);
    expect(result.worst).toBe("missing");
    expect(result.missing.length).toBe(CHART_REQUIREMENTS.length);
    expect(result.completedCount).toBe(0);
  });

  it("one missing item → worst=missing, listed in `missing`", () => {
    const now = Date.now();
    const adm = makeFullAdmission(now);
    adm.lic603Completed = 0;
    const result = evaluateChartCompleteness(baseResident, adm, now, 365);
    expect(result.worst).toBe("missing");
    expect(result.missing).toContain("lic_603");
  });

  it("annual physician's report beyond window → worst=stale (not missing)", () => {
    const now = Date.now();
    const adm = makeFullAdmission(now);
    // 400 days ago, with a 365-day annual window → stale.
    adm.lic602aDate = now - 400 * DAY;
    const result = evaluateChartCompleteness(baseResident, adm, now, 365);
    expect(result.worst).toBe("stale");
    expect(result.stale).toContain("lic_602a");
    expect(result.missing).toEqual([]);
  });

  it("missing beats stale in worst precedence", () => {
    const now = Date.now();
    const adm = makeFullAdmission(now);
    adm.lic602aDate = now - 400 * DAY; // would be stale
    adm.lic601Completed = 0;            // also missing
    const result = evaluateChartCompleteness(baseResident, adm, now, 365);
    expect(result.worst).toBe("missing");
  });

  it("custom annualWindowDays narrows the stale window", () => {
    const now = Date.now();
    const adm = makeFullAdmission(now);
    adm.lic602aDate = now - 100 * DAY;
    // 365 d window → fresh
    expect(evaluateChartCompleteness(baseResident, adm, now, 365).worst).toBe("ok");
    // 90 d window → stale at 100 d
    expect(evaluateChartCompleteness(baseResident, adm, now, 90).worst).toBe("stale");
  });

  it("annual item completed but no date → stale (admin can't prove freshness)", () => {
    const now = Date.now();
    const adm = makeFullAdmission(now);
    adm.lic602aDate = null;
    const result = evaluateChartCompleteness(baseResident, adm, now, 365);
    expect(result.worst).toBe("stale");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Storage layer
// ─────────────────────────────────────────────────────────────────────────────

describe("chart completeness — storage", () => {
  it("tenant isolation: facility A's residents do not appear under facility B", async () => {
    const rA = await seedResident(FACILITY_A, { firstName: "A" });
    await seedAdmissionFull(FACILITY_A, rA);
    const rB = await seedResident(FACILITY_B, { firstName: "B" });
    await seedAdmissionFull(FACILITY_B, rB);

    const listA = await listChartCompleteness(FACILITY_A);
    expect(listA.rows.length).toBe(1);
    expect(listA.rows[0].residentFirstName).toBe("A");

    const listB = await listChartCompleteness(FACILITY_B);
    expect(listB.rows.length).toBe(1);
    expect(listB.rows[0].residentFirstName).toBe("B");
  });

  it("`complete` counter matches the count of ok-worst rows", async () => {
    // Three residents at facility A:
    //   1 → fully complete
    //   2 → missing (no admission row)
    //   3 → fully complete
    const r1 = await seedResident(FACILITY_A, { firstName: "One" });
    await seedAdmissionFull(FACILITY_A, r1);
    await seedResident(FACILITY_A, { firstName: "Two" });
    const r3 = await seedResident(FACILITY_A, { firstName: "Three" });
    await seedAdmissionFull(FACILITY_A, r3);

    const result = await listChartCompleteness(FACILITY_A);
    expect(result.activeResidents).toBe(3);
    expect(result.complete).toBe(2);
    expect(result.total).toBe(3);
  });

  it("`worst=missing` filter returns only incomplete charts", async () => {
    const r1 = await seedResident(FACILITY_A, { firstName: "OK" });
    await seedAdmissionFull(FACILITY_A, r1);
    await seedResident(FACILITY_A, { firstName: "NoAdmission" });

    const filtered = await listChartCompleteness(FACILITY_A, { worst: "missing" });
    expect(filtered.total).toBe(1);
    expect(filtered.rows.every((r) => r.worst === "missing")).toBe(true);
    // complete + activeResidents are pre-filter counts.
    expect(filtered.complete).toBe(1);
    expect(filtered.activeResidents).toBe(2);
  });

  it("discharged residents are excluded", async () => {
    const r1 = await seedResident(FACILITY_A, { firstName: "Active" });
    await seedAdmissionFull(FACILITY_A, r1);
    await seedResident(FACILITY_A, { firstName: "Discharged", status: "discharged" });

    const result = await listChartCompleteness(FACILITY_A);
    expect(result.activeResidents).toBe(1);
    expect(result.rows[0].residentFirstName).toBe("Active");
  });

  it("limit slices the result", async () => {
    for (let i = 0; i < 5; i += 1) {
      await seedResident(FACILITY_A, { firstName: `R${i}` });
    }
    const result = await listChartCompleteness(FACILITY_A, { limit: 2 });
    expect(result.rows.length).toBe(2);
    // total = pre-limit count of filtered set.
    expect(result.total).toBe(5);
    expect(result.activeResidents).toBe(5);
  });

  it("getChartCompletenessForResident returns the same evaluator shape", async () => {
    const rid = await seedResident(FACILITY_A, { firstName: "Solo" });
    await seedAdmissionFull(FACILITY_A, rid);
    const row = await getChartCompletenessForResident(rid, FACILITY_A);
    expect(row).toBeDefined();
    expect(row?.worst).toBe("ok");
    expect(row?.residentFirstName).toBe("Solo");
    expect(row?.totalCount).toBe(CHART_REQUIREMENTS.length);
  });

  it("getChartCompletenessForResident is tenant-scoped", async () => {
    const rid = await seedResident(FACILITY_A);
    await seedAdmissionFull(FACILITY_A, rid);
    // Same numeric id, queried from the other facility — must be undefined.
    const row = await getChartCompletenessForResident(rid, FACILITY_B);
    expect(row).toBeUndefined();
  });

  it("most recent admission row wins when multiple exist", async () => {
    const rid = await seedResident(FACILITY_A);
    // Older admission: lic_602a not completed.
    const oldNow = Date.now() - 30 * DAY;
    await pool.query(
      `INSERT INTO ops_admissions
         (lead_id, facility_number, resident_id,
          lic_602a_completed, lic_602a_date,
          created_at, updated_at)
       VALUES (1, $1, $2, 0, NULL, $3, $3)`,
      [FACILITY_A, rid, oldNow],
    );
    // Newer admission: everything completed.
    await seedAdmissionFull(FACILITY_A, rid);

    const row = await getChartCompletenessForResident(rid, FACILITY_A);
    expect(row?.worst).toBe("ok");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Router smoke
// ─────────────────────────────────────────────────────────────────────────────

describe("router — W8 chart completeness", () => {
  it("401 when not logged in", async () => {
    const res = await request(app)
      .get(`/api/ops/facilities/${FACILITY_A}/chart-completeness`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(401);
  });

  it("403 when reading another facility's chart-completeness", async () => {
    const agentA = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agentA
      .get(`/api/ops/facilities/${FACILITY_B}/chart-completeness`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(403);
  });

  it("200 happy path with meta totals", async () => {
    const r1 = await seedResident(FACILITY_A, { firstName: "Ada" });
    await seedAdmissionFull(FACILITY_A, r1);
    await seedResident(FACILITY_A, { firstName: "Bea" }); // no admission → missing

    const agentA = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agentA
      .get(`/api/ops/facilities/${FACILITY_A}/chart-completeness`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
    expect(res.body.meta.total).toBe(2);
    expect(res.body.meta.complete).toBe(1);
    expect(res.body.meta.activeResidents).toBe(2);
  });

  it("400 on unknown query field (strict zod)", async () => {
    const agentA = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agentA
      .get(`/api/ops/facilities/${FACILITY_A}/chart-completeness?unknown=1`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(400);
  });

  it("per-resident route 200 + 404", async () => {
    const rid = await seedResident(FACILITY_A);
    await seedAdmissionFull(FACILITY_A, rid);
    const agentA = await loginAgent(app, facilityA.username, facilityA.password);

    const ok = await agentA
      .get(`/api/ops/residents/${rid}/chart-completeness`)
      .set(REQUIRED_HEADERS);
    expect(ok.status).toBe(200);
    expect(ok.body.success).toBe(true);
    expect(ok.body.data.worst).toBe("ok");

    const missing = await agentA
      .get(`/api/ops/residents/999999999/chart-completeness`)
      .set(REQUIRED_HEADERS);
    expect(missing.status).toBe(404);
  });

  it("per-resident route enforces tenant scope via storage lookup", async () => {
    const rid = await seedResident(FACILITY_A);
    await seedAdmissionFull(FACILITY_A, rid);
    // Log in as facility B and try to read facility A's resident by id.
    const agentB = await loginAgent(app, facilityB.username, facilityB.password);
    const res = await agentB
      .get(`/api/ops/residents/${rid}/chart-completeness`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(404);
  });
});
