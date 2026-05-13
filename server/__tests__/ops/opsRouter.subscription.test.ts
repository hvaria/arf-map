/**
 * Operations paywall gate — end-to-end integration test.
 *
 * Drives the real Express app (via buildTestApp) and confirms that the
 * requireActiveSubscription middleware mounted on opsRouter actually
 * fires on a representative /api/ops/* endpoint.
 *
 * Test plan:
 *   - subscription_status = NULL  → GET /api/ops/residents returns 402
 *     with the locked SUBSCRIPTION_REQUIRED payload.
 *   - subscription_status = 'past_due' → same 402.
 *   - subscription_status = 'active' → GET /api/ops/residents returns
 *     200 (the existing behavior — empty data array, success: true).
 *   - subscription_status = 'trialing' → same as 'active'.
 *
 * Uses a facility number unique to this file so it does not collide with
 * the tracker test suites running in parallel forks.
 */

import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import {
  buildTestApp,
  cleanFacilityAccounts,
  seedFacility,
  type TestFacility,
} from "../trackers/setupTestApp";
import { pool } from "../../db/index";

const FACILITY_NUMBER = "TEST-FAC-SUB-A";
const FACILITY_USERNAME = "test-fac-sub-a-user";
const FACILITY_PASSWORD = "test-pw-sub-a-12345!";
const ALL_FACILITY_NUMBERS = [FACILITY_NUMBER] as const;

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

/**
 * Force the seeded account's subscription_status to the given value (or
 * NULL when `null` is passed). The seedFacility helper defaults to
 * "active" so existing tests keep working; this helper is how paywall
 * tests opt out of that default.
 */
async function setSubscriptionStatus(
  facilityNumber: string,
  status: string | null,
): Promise<void> {
  await pool.query(
    `UPDATE facility_accounts
        SET subscription_status = $1
      WHERE facility_number = $2`,
    [status, facilityNumber],
  );
}

let app: Express;
let facility: TestFacility;

beforeAll(async () => {
  app = buildTestApp();
  facility = await seedFacility({
    facilityNumber: FACILITY_NUMBER,
    username: FACILITY_USERNAME,
    password: FACILITY_PASSWORD,
    email: "test-fac-sub-a@example.com",
    // Start with no subscription so the first describe block sees NULL.
    subscriptionStatus: null,
  });
});

afterAll(async () => {
  await cleanFacilityAccounts(ALL_FACILITY_NUMBERS);
  await pool.end();
});

describe("Operations paywall gate — requireActiveSubscription on /api/ops/*", () => {
  it("returns 402 SUBSCRIPTION_REQUIRED when subscription_status is NULL", async () => {
    await setSubscriptionStatus(facility.facilityNumber, null);
    const agent = await loginAgent(app, facility.username, facility.password);

    const res = await agent.get("/api/ops/residents");

    expect(res.status).toBe(402);
    expect(res.body).toEqual({
      code: "SUBSCRIPTION_REQUIRED",
      upgradeUrl: "/api/billing/checkout",
      message: "Operations requires an active subscription",
    });
  });

  it("returns 402 when subscription_status is 'past_due'", async () => {
    await setSubscriptionStatus(facility.facilityNumber, "past_due");
    const agent = await loginAgent(app, facility.username, facility.password);

    const res = await agent.get("/api/ops/residents");

    expect(res.status).toBe(402);
    expect(res.body.code).toBe("SUBSCRIPTION_REQUIRED");
  });

  it("returns 402 when subscription_status is 'canceled'", async () => {
    await setSubscriptionStatus(facility.facilityNumber, "canceled");
    const agent = await loginAgent(app, facility.username, facility.password);

    const res = await agent.get("/api/ops/residents");

    expect(res.status).toBe(402);
    expect(res.body.code).toBe("SUBSCRIPTION_REQUIRED");
  });

  it("returns 200 (normal handler behavior) when subscription_status is 'active'", async () => {
    await setSubscriptionStatus(facility.facilityNumber, "active");
    const agent = await loginAgent(app, facility.username, facility.password);

    const res = await agent.get("/api/ops/residents");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it("returns 200 when subscription_status is 'trialing'", async () => {
    await setSubscriptionStatus(facility.facilityNumber, "trialing");
    const agent = await loginAgent(app, facility.username, facility.password);

    const res = await agent.get("/api/ops/residents");

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it("also gates the trackers sub-router (which inherits the parent middleware)", async () => {
    await setSubscriptionStatus(facility.facilityNumber, null);
    const agent = await loginAgent(app, facility.username, facility.password);

    const res = await agent.get("/api/ops/trackers/definitions");

    expect(res.status).toBe(402);
    expect(res.body.code).toBe("SUBSCRIPTION_REQUIRED");
  });

  it("also gates the notes sub-router (which inherits the parent middleware)", async () => {
    await setSubscriptionStatus(facility.facilityNumber, null);
    const agent = await loginAgent(app, facility.username, facility.password);

    // Any notes route will do — list is the cheapest. The gate fires
    // before the handler so we don't care about the response shape on
    // the 200 path here.
    const res = await agent.get("/api/ops/notes");

    expect(res.status).toBe(402);
    expect(res.body.code).toBe("SUBSCRIPTION_REQUIRED");
  });
});
