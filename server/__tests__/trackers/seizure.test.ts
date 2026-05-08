/**
 * Seizure tracker — integration tests.
 *
 * Covers acceptance criteria from the BA spec:
 *   AC-1   detailed event saves with required fields
 *   AC-5   intervention required when rescue_med_given=yes OR duration ≥ 300s
 *   AC-8   supervisor_notified is always required
 *   AC-11  status epilepticus (≥ 5 min OR seizure_type=status_epilepticus)
 *          fires a critical alert into tracker_alerts
 *
 * The conditional-required validation lives in the Zod superRefine on the
 * payload schema; we assert the 400 path for each conditional rule rather
 * than relying on the form layer.
 */

import "dotenv/config";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { randomUUID } from "node:crypto";
import type { Express } from "express";

import {
  buildTestApp,
  cleanFacilityAccounts,
  cleanTrackerData,
  seedFacility,
  type TestFacility,
} from "./setupTestApp";
import { pool } from "../../db/index";
import { bootstrapTrackersSchema } from "../../trackers/trackerStorage";

const FACILITY_A_NUMBER = "TEST-FAC-SEIZ-A";
const FACILITY_A_USERNAME = "test-fac-seiz-a-user";
const FACILITY_A_PASSWORD = "test-pw-seiz-a-12345!";
const ALL_FACILITY_NUMBERS = [FACILITY_A_NUMBER] as const;

const REQUIRED_HEADERS = { "X-Requested-With": "XMLHttpRequest" } as const;

async function loginAgent(
  app: Express,
  username: string,
  password: string,
): Promise<request.Agent> {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/facility/login")
    .set(REQUIRED_HEADERS)
    .send({ username, password });
  expect(res.status, `login failed: ${res.text}`).toBe(200);
  return agent;
}

interface BodyOverrides {
  payload?: Record<string, unknown>;
  occurredAt?: number;
  residentId?: number;
  shift?: "AM" | "PM" | "NOC";
}

function entryBody(overrides: BodyOverrides = {}) {
  return {
    clientId: randomUUID(),
    residentId: overrides.residentId ?? 1,
    occurredAt: overrides.occurredAt ?? Date.now(),
    payload:
      overrides.payload ?? {
        seizure_type: "generalized_tonic_clonic",
        duration_seconds: 90,
        shift: "AM",
        witnessed: "yes",
        supervisor_notified: "yes",
      },
    ...(overrides.shift ? { shift: overrides.shift } : {}),
  };
}

let app: Express;
let facilityA: TestFacility;

beforeAll(async () => {
  // Idempotent — ensures the tracker_definitions row for `seizure` exists
  // before the first POST. Same pattern as skinCheck.test.ts.
  await bootstrapTrackersSchema();
  app = buildTestApp();
  facilityA = await seedFacility({
    facilityNumber: FACILITY_A_NUMBER,
    username: FACILITY_A_USERNAME,
    password: FACILITY_A_PASSWORD,
    email: "test-fac-seiz-a@example.com",
  });
});

afterAll(async () => {
  await cleanTrackerData(ALL_FACILITY_NUMBERS);
  await cleanFacilityAccounts(ALL_FACILITY_NUMBERS);
  await pool.end();
});

beforeEach(async () => {
  await cleanTrackerData(ALL_FACILITY_NUMBERS);
});

afterEach(async () => {
  await cleanTrackerData(ALL_FACILITY_NUMBERS);
});

describe("POST /api/ops/trackers/seizure/entries", () => {
  it("saves a typical seizure event with required fields (AC-1)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/seizure/entries")
      .set(REQUIRED_HEADERS)
      .send(entryBody());
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.payload.seizure_type).toBe("generalized_tonic_clonic");
    expect(res.body.data.payload.duration_seconds).toBe(90);
    expect(res.body.data.payload.witnessed).toBe("yes");
  });

  it("rejects an entry without supervisor_notified (AC-8)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/seizure/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody({
          payload: {
            seizure_type: "focal_aware",
            duration_seconds: 30,
            shift: "AM",
            witnessed: "yes",
            // supervisor_notified omitted
          },
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/supervisor_notified/);
  });

  it("requires intervention when duration ≥ 300s (AC-5)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/seizure/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody({
          payload: {
            seizure_type: "generalized_tonic_clonic",
            duration_seconds: 360,
            shift: "AM",
            witnessed: "yes",
            supervisor_notified: "yes",
            // intervention omitted
          },
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/intervention/);
  });

  it("requires intervention when seizure_type=status_epilepticus regardless of duration (AC-5)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/seizure/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody({
          payload: {
            seizure_type: "status_epilepticus",
            duration_seconds: 90, // < 300, but the type itself triggers
            shift: "AM",
            witnessed: "yes",
            supervisor_notified: "yes",
            // intervention omitted
          },
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/intervention/);
  });

  it("requires intervention when rescue_med_given=yes (AC-5)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/seizure/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody({
          payload: {
            seizure_type: "focal_impaired",
            duration_seconds: 90,
            shift: "AM",
            witnessed: "yes",
            rescue_med_given: "yes",
            supervisor_notified: "yes",
            // intervention omitted
          },
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/intervention/);
  });

  it("accepts long-duration entries when intervention is provided", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/seizure/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody({
          payload: {
            seizure_type: "generalized_tonic_clonic",
            duration_seconds: 360,
            shift: "AM",
            witnessed: "yes",
            rescue_med_given: "yes",
            intervention: "Diazepam administered. EMS called.",
            supervisor_notified: "yes",
          },
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("fires a critical alert on duration ≥ 300s (AC-11)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/seizure/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody({
          payload: {
            seizure_type: "generalized_tonic_clonic",
            duration_seconds: 360,
            shift: "AM",
            witnessed: "yes",
            rescue_med_given: "yes",
            intervention: "Diazepam administered. EMS called.",
            supervisor_notified: "yes",
          },
        }),
      );
    expect(res.status).toBe(201);

    const alerts = await pool.query<{ rule_id: string; severity: string }>(
      `SELECT rule_id, severity FROM tracker_alerts
       WHERE facility_number = $1 AND rule_id = 'seizure-status-epilepticus'`,
      [facilityA.facilityNumber],
    );
    expect(alerts.rows.length).toBe(1);
    expect(alerts.rows[0].severity).toBe("critical");
  });

  it("fires a critical alert on seizure_type=status_epilepticus (AC-11)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/seizure/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody({
          payload: {
            seizure_type: "status_epilepticus",
            duration_seconds: 240,
            shift: "AM",
            witnessed: "yes",
            rescue_med_given: "yes",
            intervention: "Lorazepam administered. EMS en route.",
            supervisor_notified: "yes",
          },
        }),
      );
    expect(res.status).toBe(201);

    const alerts = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM tracker_alerts
       WHERE facility_number = $1 AND rule_id = 'seizure-status-epilepticus'`,
      [facilityA.facilityNumber],
    );
    expect(Number(alerts.rows[0].c)).toBe(1);
  });

  it("does NOT alert on short, non-status seizures", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    await agent
      .post("/api/ops/trackers/seizure/entries")
      .set(REQUIRED_HEADERS)
      .send(entryBody());
    const alerts = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM tracker_alerts
       WHERE facility_number = $1 AND rule_id = 'seizure-status-epilepticus'`,
      [facilityA.facilityNumber],
    );
    expect(Number(alerts.rows[0].c)).toBe(0);
  });
});
