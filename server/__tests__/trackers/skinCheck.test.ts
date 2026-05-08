/**
 * Skin Check tracker — integration tests.
 *
 * Covers acceptance criteria from the BA spec:
 *   AC-1  no-concerns path saves with finding=no_concerns, severity=none
 *   AC-2  detailed path saves a finding with body site / severity / action
 *   AC-5  severity must be `none` iff finding is `no_concerns`
 *   AC-7  severe finding fires a critical alert into tracker_alerts
 *   AC-10 action_taken required when severity ≥ moderate
 *   AC-13 Hygiene rejects new entries with goal_id="skin_check"
 *
 * The conditional-required validation is enforced server-side via the Zod
 * `superRefine` on the skin-check payload schema. We assert the 400 path for
 * each conditional rule rather than relying on the form layer.
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

const FACILITY_A_NUMBER = "TEST-FAC-SKIN-A";
const FACILITY_A_USERNAME = "test-fac-skin-a-user";
const FACILITY_A_PASSWORD = "test-pw-skin-a-12345!";
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

function entryBody(slug: "skin_check" | "hygiene", overrides: BodyOverrides = {}) {
  return {
    clientId: randomUUID(),
    residentId: overrides.residentId ?? 1,
    occurredAt: overrides.occurredAt ?? Date.now(),
    payload:
      overrides.payload ??
      (slug === "skin_check"
        ? { finding: "no_concerns", severity: "none", shift: "AM" }
        : { goal_id: "shower", shift: "AM", status: "C" }),
    ...(overrides.shift ? { shift: overrides.shift } : {}),
  };
}

let app: Express;
let facilityA: TestFacility;

beforeAll(async () => {
  // Idempotent — ensures the tracker_definitions row for `skin_check` exists
  // before the first POST. The existing entries.test.ts relies on a prior
  // server boot having seeded the older slugs; this file owns a freshly-added
  // slug, so we call the bootstrap explicitly.
  await bootstrapTrackersSchema();
  app = buildTestApp();
  facilityA = await seedFacility({
    facilityNumber: FACILITY_A_NUMBER,
    username: FACILITY_A_USERNAME,
    password: FACILITY_A_PASSWORD,
    email: "test-fac-skin-a@example.com",
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

describe("POST /api/ops/trackers/skin_check/entries", () => {
  it("saves a 'no concerns observed' entry (AC-1)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/skin_check/entries")
      .set(REQUIRED_HEADERS)
      .send(entryBody("skin_check"));
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.payload.finding).toBe("no_concerns");
    expect(res.body.data.payload.severity).toBe("none");
  });

  it("saves a finding with body site, severity, and action (AC-2)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/skin_check/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody("skin_check", {
          payload: {
            finding: "pressure_injury",
            body_site: "sacrum",
            severity: "moderate",
            shift: "AM",
            action_taken: "Repositioned and applied dressing.",
            supervisor_notified: "yes",
          },
        }),
      );
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.payload.finding).toBe("pressure_injury");
    expect(res.body.data.payload.body_site).toBe("sacrum");
    expect(res.body.data.payload.severity).toBe("moderate");
  });

  it("rejects severity != none when finding is no_concerns (AC-5)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/skin_check/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody("skin_check", {
          payload: { finding: "no_concerns", severity: "minor", shift: "AM" },
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/severity/);
  });

  it("rejects a finding without body_site (AC-2)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/skin_check/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody("skin_check", {
          payload: {
            finding: "rash",
            severity: "minor",
            shift: "AM",
          },
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/body_site/);
  });

  it("rejects moderate severity with no action_taken (AC-10)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/skin_check/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody("skin_check", {
          payload: {
            finding: "pressure_injury",
            body_site: "sacrum",
            severity: "moderate",
            shift: "AM",
            // action_taken omitted
            supervisor_notified: "yes",
          },
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/action_taken/);
  });

  it("rejects moderate+ severity without supervisor_notified set", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/skin_check/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody("skin_check", {
          payload: {
            finding: "wound",
            body_site: "foot_l",
            severity: "moderate",
            shift: "AM",
            action_taken: "Cleaned and dressed.",
            // supervisor_notified omitted
          },
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/supervisor_notified/);
  });

  it("creates a critical alert when severity is severe (AC-7)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/skin_check/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody("skin_check", {
          payload: {
            finding: "pressure_injury",
            body_site: "sacrum",
            severity: "severe",
            shift: "AM",
            action_taken: "Notified provider; preparing transfer.",
            supervisor_notified: "yes",
          },
        }),
      );
    expect(res.status).toBe(201);

    const alerts = await pool.query<{ rule_id: string; severity: string }>(
      `SELECT rule_id, severity FROM tracker_alerts
       WHERE facility_number = $1 AND rule_id = 'skin-check-severe-finding'`,
      [facilityA.facilityNumber],
    );
    expect(alerts.rows.length).toBe(1);
    expect(alerts.rows[0].severity).toBe("critical");
  });

  it("does NOT create an alert for minor or moderate findings", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    await agent
      .post("/api/ops/trackers/skin_check/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody("skin_check", {
          payload: {
            finding: "redness",
            body_site: "back",
            severity: "minor",
            shift: "AM",
          },
        }),
      );
    const alerts = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM tracker_alerts
       WHERE facility_number = $1 AND rule_id = 'skin-check-severe-finding'`,
      [facilityA.facilityNumber],
    );
    expect(Number(alerts.rows[0].c)).toBe(0);
  });
});

describe("POST /api/ops/trackers/hygiene/entries — skin_check deprecation (AC-13)", () => {
  it("rejects new Hygiene entries with goal_id='skin_check'", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/hygiene/entries")
      .set(REQUIRED_HEADERS)
      .send(
        entryBody("hygiene", {
          payload: { goal_id: "skin_check", shift: "AM", status: "C" },
        }),
      );
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Skin Check tracker/);
  });

  it("still accepts other Hygiene goals", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/trackers/hygiene/entries")
      .set(REQUIRED_HEADERS)
      .send(entryBody("hygiene"));
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
  });
});
