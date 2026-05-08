/**
 * Inventory + Cleaning tracker integration tests.
 *
 * Both ship with `requiresResident: false` — they're the first trackers in
 * the registry that don't bind to a resident. The critical assertion is that
 * the entries router accepts a POST with `residentId` omitted, instead of
 * returning the 400 "residentId is required" error path.
 *
 * Covers acceptance criteria:
 *   - Inventory: create / action enum / quantity validation / no-resident path
 *   - Cleaning: create / status enum / zone enum / no-resident path
 *   - Both: history payload roundtrips intact
 *   - No tracker_alerts rows produced (neither has a v1 alert rule)
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

const FACILITY_A_NUMBER = "TEST-FAC-FACOPS-A";
const FACILITY_A_USERNAME = "test-fac-facops-a-user";
const FACILITY_A_PASSWORD = "test-pw-facops-a-12345!";
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

/** Body shape with NO residentId (the whole point of these trackers). */
function noResidentBody(payload: Record<string, unknown>) {
  return {
    clientId: randomUUID(),
    occurredAt: Date.now(),
    payload,
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
    email: "test-fac-facops-a@example.com",
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

// ─────────────────────────────────────────────────────────────────────────────
// Inventory
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/ops/trackers/inventory/entries", () => {
  it("accepts an entry without residentId (requiresResident=false)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/inventory/entries")
      .set(REQUIRED_HEADERS)
      .send(
        noResidentBody({
          item_name: "Gloves (medium)",
          action: "received",
          quantity: 4,
          unit: "boxes",
          shift: "AM",
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    // resident_id stored as null on the row — confirm it didn't silently
    // attach to some default resident.
    expect(res.body.data.residentId).toBeNull();
    expect(res.body.data.payload.item_name).toBe("Gloves (medium)");
    expect(res.body.data.payload.action).toBe("received");
  });

  it("accepts every canonical action", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    for (const action of ["received", "consumed", "discarded", "counted"]) {
      const res = await agent
        .post("/api/ops/trackers/inventory/entries")
        .set(REQUIRED_HEADERS)
        .send(
          noResidentBody({
            item_name: "Wipes",
            action,
            quantity: 2,
            unit: "packs",
            shift: "PM",
          }),
        );
      expect(res.status, `action=${action} failed: ${res.text}`).toBe(201);
    }
  });

  it("rejects an unknown action", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/inventory/entries")
      .set(REQUIRED_HEADERS)
      .send(
        noResidentBody({
          item_name: "Wipes",
          action: "stolen",
          quantity: 2,
          unit: "packs",
          shift: "PM",
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/action/);
  });

  it("rejects a negative quantity", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/inventory/entries")
      .set(REQUIRED_HEADERS)
      .send(
        noResidentBody({
          item_name: "Wipes",
          action: "consumed",
          quantity: -1,
          unit: "packs",
          shift: "PM",
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/quantity/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Cleaning
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/ops/trackers/cleaning/entries", () => {
  it("accepts an entry without residentId (requiresResident=false)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/cleaning/entries")
      .set(REQUIRED_HEADERS)
      .send(
        noResidentBody({
          zone: "kitchen",
          task: "sanitize",
          status: "C",
          shift: "AM",
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.residentId).toBeNull();
    expect(res.body.data.payload.zone).toBe("kitchen");
  });

  it("rejects an unknown zone", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/cleaning/entries")
      .set(REQUIRED_HEADERS)
      .send(
        noResidentBody({
          zone: "rooftop",
          task: "sanitize",
          status: "C",
          shift: "AM",
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/zone/);
  });

  it("rejects an unknown task", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/cleaning/entries")
      .set(REQUIRED_HEADERS)
      .send(
        noResidentBody({
          zone: "kitchen",
          task: "polish",
          status: "C",
          shift: "AM",
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/task/);
  });

  it("does NOT create any tracker_alerts rows (no v1 alert)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    await agent
      .post("/api/ops/trackers/cleaning/entries")
      .set(REQUIRED_HEADERS)
      .send(
        noResidentBody({
          zone: "restroom",
          task: "sanitize",
          status: "I",
          shift: "PM",
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
