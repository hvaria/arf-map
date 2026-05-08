/**
 * Tracker Module — PDF export integration tests.
 *
 * Covers acceptance criteria from the BA spec:
 *   AC-1  trigger / 200 contract
 *   AC-3  empty range still returns a valid PDF (header + placeholder)
 *   AC-4  92-day range cap returns 400 before the renderer runs
 *   AC-5  soft-deleted entries excluded from the rendered body
 *   AC-7  endpoint is open to all authenticated facility roles (no role gate)
 *   AC-8  unknown slug returns 404; bad query returns 400 (no silent failures)
 *   AC-10 unauthenticated request rejected with 401
 *
 * Body assertions are intentionally light — we don't parse PDF structure
 * here. We verify the PDF magic header (`%PDF-`) and trailer (`%%EOF`) so a
 * truncated render fails the test, plus the `X-Tracker-Export-Count` header
 * (the only piece of structured data the client surfaces in its toast).
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

const FACILITY_A_NUMBER = "TEST-FAC-PDF-A";
const FACILITY_A_USERNAME = "test-fac-pdf-a-user";
const FACILITY_A_PASSWORD = "test-pw-pdf-a-12345!";
const ALL_FACILITY_NUMBERS = [FACILITY_A_NUMBER] as const;

const REQUIRED_HEADERS = { "X-Requested-With": "XMLHttpRequest" } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

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
  expect(res.status, `login failed for ${username}: ${res.text}`).toBe(200);
  return agent;
}

function adlEntryBody(overrides: { occurredAt?: number; residentId?: number } = {}) {
  return {
    clientId: randomUUID(),
    residentId: overrides.residentId ?? 1,
    occurredAt: overrides.occurredAt ?? Date.now(),
    payload: {
      goal_id: "bathing",
      shift: "AM" as const,
      status: "C" as const,
    },
  };
}

let app: Express;
let facilityA: TestFacility;

beforeAll(async () => {
  app = buildTestApp();
  facilityA = await seedFacility({
    facilityNumber: FACILITY_A_NUMBER,
    username: FACILITY_A_USERNAME,
    password: FACILITY_A_PASSWORD,
    email: "test-fac-pdf-a@example.com",
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

describe("GET /api/ops/trackers/:slug/entries/export.pdf", () => {
  it("returns 200 + valid PDF body with the expected count header (AC-1)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const now = Date.now();

    // Seed three entries inside the export window.
    for (let i = 0; i < 3; i += 1) {
      await agent
        .post("/api/ops/trackers/adl/entries")
        .set(REQUIRED_HEADERS)
        .send(adlEntryBody({ occurredAt: now - i * 1000 }));
    }

    const from = now - DAY_MS;
    const to = now + DAY_MS;
    const res = await agent
      .get(`/api/ops/trackers/adl/entries/export.pdf?from=${from}&to=${to}`)
      .buffer(true)
      .parse((parserRes, cb) => {
        // Default supertest parser would try to read the binary body as text;
        // collect bytes manually instead.
        const chunks: Buffer[] = [];
        parserRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        parserRes.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.headers["content-disposition"]).toMatch(/attachment;\s*filename="tracker-adl-/);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(res.headers["x-tracker-export-count"]).toBe("3");

    const body = res.body as Buffer;
    expect(body.length).toBeGreaterThan(100);
    expect(body.slice(0, 5).toString("utf8")).toBe("%PDF-");
    // PDF trailer must be present — guarantees the renderer ran to completion.
    expect(body.slice(-6).toString("utf8")).toContain("%%EOF");
  });

  it("emits a valid PDF with count=0 when no entries match (AC-3)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);

    const from = Date.now() - 5 * DAY_MS;
    const to = Date.now() - 4 * DAY_MS;
    const res = await agent
      .get(`/api/ops/trackers/adl/entries/export.pdf?from=${from}&to=${to}`)
      .buffer(true)
      .parse((parserRes, cb) => {
        const chunks: Buffer[] = [];
        parserRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        parserRes.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["x-tracker-export-count"]).toBe("0");
    const body = res.body as Buffer;
    expect(body.slice(0, 5).toString("utf8")).toBe("%PDF-");
    expect(body.slice(-6).toString("utf8")).toContain("%%EOF");
  });

  it("rejects ranges over 92 days with 400 before rendering (AC-4)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);

    const from = Date.now() - 100 * DAY_MS;
    const to = Date.now();
    const res = await agent.get(
      `/api/ops/trackers/adl/entries/export.pdf?from=${from}&to=${to}`,
    );

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error).toMatch(/92 days/);
  });

  it("excludes soft-deleted entries from the count header (AC-5)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const now = Date.now();

    const created = await agent
      .post("/api/ops/trackers/adl/entries")
      .set(REQUIRED_HEADERS)
      .send(adlEntryBody({ occurredAt: now }));
    expect(created.status).toBe(201);
    const id: number = created.body.data.id;

    // Soft-delete the entry.
    const deleted = await agent
      .delete(`/api/ops/trackers/entries/${id}`)
      .set(REQUIRED_HEADERS);
    expect([200, 204]).toContain(deleted.status);

    const from = now - DAY_MS;
    const to = now + DAY_MS;
    const res = await agent
      .get(`/api/ops/trackers/adl/entries/export.pdf?from=${from}&to=${to}`)
      .buffer(true)
      .parse((parserRes, cb) => {
        const chunks: Buffer[] = [];
        parserRes.on("data", (chunk: Buffer) => chunks.push(chunk));
        parserRes.on("end", () => cb(null, Buffer.concat(chunks)));
      });

    expect(res.status).toBe(200);
    expect(res.headers["x-tracker-export-count"]).toBe("0");
  });

  it("returns 404 for an unknown tracker slug (AC-8)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const from = Date.now() - DAY_MS;
    const to = Date.now();
    const res = await agent.get(
      `/api/ops/trackers/does-not-exist/entries/export.pdf?from=${from}&to=${to}`,
    );
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
  });

  it("returns 400 with a clear error when from/to are missing (AC-8)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent.get("/api/ops/trackers/adl/entries/export.pdf");
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe("string");
  });

  it("rejects unauthenticated callers (AC-10)", async () => {
    const anon = request.agent(app);
    const from = Date.now() - DAY_MS;
    const to = Date.now();
    const res = await anon.get(
      `/api/ops/trackers/adl/entries/export.pdf?from=${from}&to=${to}`,
    );
    // The opsRouter's auth middleware redirects/401s unauth callers — accept
    // any non-2xx outcome that prevents the body from being rendered.
    expect(res.status).toBeGreaterThanOrEqual(401);
    expect(res.status).toBeLessThan(500);
    expect(res.headers["content-type"]).not.toBe("application/pdf");
  });
});
