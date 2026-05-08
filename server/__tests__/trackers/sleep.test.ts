/**
 * Sleep tracker — integration tests.
 *
 * Lighter than the event-style tracker tests (Skin Check, Seizure) because
 * Sleep has no conditional-required fields and no alert rule. Tests cover:
 *   - basic create
 *   - all five canonical goals accepted
 *   - shift validation
 *   - status enum validation
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
import { SLEEP_GOAL_IDS } from "@shared/tracker-schemas";

const FACILITY_A_NUMBER = "TEST-FAC-SLEEP-A";
const FACILITY_A_USERNAME = "test-fac-sleep-a-user";
const FACILITY_A_PASSWORD = "test-pw-sleep-a-12345!";
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
}

function entryBody(overrides: BodyOverrides = {}) {
  return {
    clientId: randomUUID(),
    residentId: 1,
    occurredAt: Date.now(),
    payload:
      overrides.payload ?? {
        goal_id: "slept_through",
        shift: "NOC",
        status: "C",
      },
  };
}

let app: Express;
let facilityA: TestFacility;

beforeAll(async () => {
  await bootstrapTrackersSchema();
  app = buildTestApp();
  facilityA = await seedFacility({
    facilityNumber: FACILITY_A_NUMBER,
    username: FACILITY_A_USERNAME,
    password: FACILITY_A_PASSWORD,
    email: "test-fac-sleep-a@example.com",
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

describe("POST /api/ops/trackers/sleep/entries", () => {
  it("saves a 'slept through' Completed entry on NOC", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/sleep/entries")
      .set(REQUIRED_HEADERS)
      .send(entryBody());
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.payload.goal_id).toBe("slept_through");
    expect(res.body.data.payload.status).toBe("C");
  });

  it("accepts every canonical goal_id", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    for (const goalId of SLEEP_GOAL_IDS) {
      const res = await agent
        .post("/api/ops/trackers/sleep/entries")
        .set(REQUIRED_HEADERS)
        .send(
          entryBody({
            payload: { goal_id: goalId, shift: "NOC", status: "C" },
          }),
        );
      expect(res.status, `goal ${goalId} failed: ${res.text}`).toBe(201);
    }
  });

  it("rejects an invalid status value", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/sleep/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody({
          payload: { goal_id: "restful", shift: "NOC", status: "MAYBE" },
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/status/);
  });

  it("rejects an invalid shift value", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/sleep/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody({
          payload: { goal_id: "restful", shift: "MIDNIGHT", status: "C" },
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/shift/);
  });

  it("does NOT create any tracker_alerts rows (Sleep has no v1 alert)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    await agent
      .post("/api/ops/trackers/sleep/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody({
          payload: { goal_id: "no_wandering", shift: "NOC", status: "I" },
        }),
      );
    const alerts = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM tracker_alerts
       WHERE facility_number = $1`,
      [facilityA.facilityNumber],
    );
    expect(Number(alerts.rows[0].c)).toBe(0);
  });
});
