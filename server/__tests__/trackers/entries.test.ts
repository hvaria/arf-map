/**
 * Tracker Module — entries integration tests (single + bulk + versioning).
 *
 * Covers fix-history items:
 *   - C1 (idempotent retap)         → Test 1
 *   - C4 (audit-log shape)          → asserted on every insert path
 *   - Versioning correctness        → Test 3
 *   - Bulk per-item idempotency     → Test 5
 *
 * Tests run against the local PostgreSQL pointed at by DATABASE_URL.
 * Each test cleans up its own tracker rows in `afterEach` so the suite is
 * rerunnable. The two seeded facility accounts are torn down in
 * `afterAll`. We do NOT drop or recreate the schema.
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
  countAuditLog,
  countEntries,
  seedFacility,
  type TestFacility,
} from "./setupTestApp";
import { pool } from "../../db/index";

// File-local facility identifiers — must NOT collide with the security
// test file because the two test files run in parallel forks against the
// same DB and cleanup is scoped by facility_number.
const FACILITY_A_NUMBER = "TEST-FAC-ENTRIES-A";
const FACILITY_A_USERNAME = "test-fac-entries-a-user";
const FACILITY_A_PASSWORD = "test-pw-entries-a-12345!";
const ALL_FACILITY_NUMBERS = [FACILITY_A_NUMBER] as const;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — payload builders, login, headers
// ─────────────────────────────────────────────────────────────────────────────

function adlPayload(overrides: Partial<{ goal_id: string; shift: "AM" | "PM" | "NOC"; status: "C" | "I" | "NA"; note: string }> = {}) {
  return {
    goal_id: "bathing",
    shift: "AM" as const,
    status: "C" as const,
    ...overrides,
  };
}

function singleEntryBody(overrides: Partial<{
  clientId: string;
  residentId: number;
  occurredAt: number;
  payload: ReturnType<typeof adlPayload>;
  shift: "AM" | "PM" | "NOC";
}> = {}) {
  return {
    clientId: overrides.clientId ?? randomUUID(),
    residentId: overrides.residentId ?? 1,
    occurredAt: overrides.occurredAt ?? Date.now(),
    payload: overrides.payload ?? adlPayload(),
    ...(overrides.shift ? { shift: overrides.shift } : {}),
  };
}

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
  expect(res.status, `login failed for ${username}: ${res.text}`).toBe(200);
  return agent;
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite-level setup
// ─────────────────────────────────────────────────────────────────────────────

let app: Express;
let facilityA: TestFacility;

beforeAll(async () => {
  app = buildTestApp();
  facilityA = await seedFacility({
    facilityNumber: FACILITY_A_NUMBER,
    username: FACILITY_A_USERNAME,
    password: FACILITY_A_PASSWORD,
    email: "test-fac-entries-a@example.com",
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
// Test 1 — Idempotent retap returns server status (regression for C1)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/ops/trackers/adl/entries — idempotency (C1 regression)", () => {
  it("second POST with same clientId returns 200 + duplicate:true with the original id", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const body = singleEntryBody();

    // First call — fresh insert.
    const first = await agent
      .post("/api/ops/trackers/adl/entries")
      .set(REQUIRED_HEADERS)
      .send(body);

    expect(first.status).toBe(201);
    expect(first.body.success).toBe(true);
    expect(first.body.duplicate).toBe(false);
    expect(first.body.data?.id).toBeTypeOf("number");
    expect(first.body.data.payload).toEqual(body.payload);

    const firstId = first.body.data.id as number;

    // Second call with the *same* body / clientId — must short-circuit.
    const second = await agent
      .post("/api/ops/trackers/adl/entries")
      .set(REQUIRED_HEADERS)
      .send(body);

    expect(second.status).toBe(200);
    expect(second.body.success).toBe(true);
    expect(second.body.duplicate).toBe(true);
    expect(second.body.data?.id).toBe(firstId);
    // The response payload is the original posted payload, not a different
    // version (regression check: an earlier bug double-stringified, so a
    // re-tap could surface a string instead of the object payload).
    expect(second.body.data.payload).toEqual(body.payload);
    expect(typeof second.body.data.payload).toBe("object");

    // Exactly one DB row for the clientId, scoped to this facility.
    const total = await countEntries(facilityA.facilityNumber);
    expect(total).toBe(1);

    const rows = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM tracker_entries
       WHERE facility_number = $1 AND client_id = $2`,
      [facilityA.facilityNumber, body.clientId],
    );
    expect(Number(rows.rows[0].c)).toBe(1);

    // C4 regression — audit row's `after.payload` must be a JSON OBJECT,
    // not a re-stringified TEXT column.
    const auditRows = await pool.query<{ after: string | null }>(
      `SELECT after FROM tracker_audit_log
       WHERE facility_number = $1 AND entity_id = $2 AND action = 'create'`,
      [facilityA.facilityNumber, firstId],
    );
    expect(auditRows.rows.length).toBe(1);
    const after = JSON.parse(auditRows.rows[0].after ?? "null");
    expect(after).not.toBeNull();
    expect(typeof after.payload).toBe("object");
    expect(after.payload).toEqual(body.payload);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Versioning increments version_number; snapshot equals pre-update payload
// ─────────────────────────────────────────────────────────────────────────────

describe("PATCH /api/ops/trackers/entries/:id — versioning", () => {
  it("snapshots the pre-update payload at each PATCH and returns versions in DESC order", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);

    // Create.
    const original = adlPayload({ status: "C", note: "v0" });
    const createRes = await agent
      .post("/api/ops/trackers/adl/entries")
      .set(REQUIRED_HEADERS)
      .send(singleEntryBody({ payload: original }));
    expect(createRes.status).toBe(201);
    const entryId = createRes.body.data.id as number;

    // PATCH #1 — payload changes from `original` to `afterFirst`.
    const afterFirst = adlPayload({ status: "I", note: "v1" });
    const patch1 = await agent
      .patch(`/api/ops/trackers/entries/${entryId}`)
      .set(REQUIRED_HEADERS)
      .send({ payload: afterFirst, changeReason: "first edit" });
    expect(patch1.status).toBe(200);
    expect(patch1.body.success).toBe(true);
    expect(patch1.body.data.payload).toEqual(afterFirst);
    expect(patch1.body.data.status).toBe("edited");

    // tracker_entries row reflects the new payload.
    const after1Row = await pool.query<{ payload: string; status: string }>(
      `SELECT payload, status FROM tracker_entries WHERE id = $1`,
      [entryId],
    );
    expect(JSON.parse(after1Row.rows[0].payload)).toEqual(afterFirst);
    expect(after1Row.rows[0].status).toBe("edited");

    // ONE version row, version_number=1, snapshot = ORIGINAL payload.
    const v1 = await pool.query<{ version_number: number; payload_snapshot: string }>(
      `SELECT version_number, payload_snapshot FROM tracker_entry_versions
       WHERE entry_id = $1 ORDER BY version_number ASC`,
      [entryId],
    );
    expect(v1.rows.length).toBe(1);
    expect(Number(v1.rows[0].version_number)).toBe(1);
    expect(JSON.parse(v1.rows[0].payload_snapshot)).toEqual(original);

    // PATCH #2 — payload changes from `afterFirst` to `afterSecond`.
    const afterSecond = adlPayload({ status: "NA", note: "v2" });
    const patch2 = await agent
      .patch(`/api/ops/trackers/entries/${entryId}`)
      .set(REQUIRED_HEADERS)
      .send({ payload: afterSecond, changeReason: "second edit" });
    expect(patch2.status).toBe(200);
    expect(patch2.body.data.payload).toEqual(afterSecond);

    // TWO version rows. v1.snapshot == original, v2.snapshot == afterFirst.
    const v2 = await pool.query<{ version_number: number; payload_snapshot: string }>(
      `SELECT version_number, payload_snapshot FROM tracker_entry_versions
       WHERE entry_id = $1 ORDER BY version_number ASC`,
      [entryId],
    );
    expect(v2.rows.length).toBe(2);
    expect(Number(v2.rows[0].version_number)).toBe(1);
    expect(JSON.parse(v2.rows[0].payload_snapshot)).toEqual(original);
    expect(Number(v2.rows[1].version_number)).toBe(2);
    expect(JSON.parse(v2.rows[1].payload_snapshot)).toEqual(afterFirst);

    // GET /versions returns DESC order.
    const versionsRes = await agent
      .get(`/api/ops/trackers/entries/${entryId}/versions`)
      .set(REQUIRED_HEADERS);
    expect(versionsRes.status).toBe(200);
    expect(versionsRes.body.success).toBe(true);
    const items = versionsRes.body.data as Array<{
      versionNumber: number;
      payloadSnapshot: unknown;
    }>;
    expect(items.length).toBe(2);
    expect(items[0].versionNumber).toBe(2);
    expect(items[1].versionNumber).toBe(1);
    // Hydrated payload — must be an object, not a JSON string (M2 contract).
    expect(typeof items[0].payloadSnapshot).toBe("object");
    expect(items[0].payloadSnapshot).toEqual(afterFirst);
    expect(items[1].payloadSnapshot).toEqual(original);

    // C4 regression — update audit rows must hold OBJECTS in before/after.payload.
    const auditRows = await pool.query<{ before: string; after: string }>(
      `SELECT before, after FROM tracker_audit_log
       WHERE facility_number = $1 AND entity_id = $2 AND action = 'update'
       ORDER BY id ASC`,
      [facilityA.facilityNumber, entryId],
    );
    expect(auditRows.rows.length).toBe(2);
    for (const row of auditRows.rows) {
      const before = JSON.parse(row.before);
      const after = JSON.parse(row.after);
      expect(typeof before.payload).toBe("object");
      expect(typeof after.payload).toBe("object");
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — Bulk insert respects per-item idempotency (mixed batch)
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/ops/trackers/adl/entries/bulk — per-item idempotency", () => {
  it("only inserts non-duplicate items on a re-tapped batch and audits exactly once per insert", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const aId = randomUUID();
    const bId = randomUUID();
    const cId = randomUUID();
    const baseTs = Date.now();

    const itemA = {
      clientId: aId,
      residentId: 1,
      occurredAt: baseTs,
      payload: adlPayload({ goal_id: "bathing", note: "A" }),
    };
    const itemB = {
      clientId: bId,
      residentId: 1,
      occurredAt: baseTs + 1,
      payload: adlPayload({ goal_id: "dressing", note: "B" }),
    };
    const itemC = {
      clientId: cId,
      residentId: 1,
      occurredAt: baseTs + 2,
      payload: adlPayload({ goal_id: "grooming", note: "C" }),
    };

    // First batch: A, B (both fresh).
    const batch1 = await agent
      .post("/api/ops/trackers/adl/entries/bulk")
      .set(REQUIRED_HEADERS)
      .send({ items: [itemA, itemB] });
    expect(batch1.status).toBe(200);
    expect(batch1.body.success).toBe(true);
    const items1 = batch1.body.data.items as Array<{ clientId: string; data: { id: number; payload: unknown }; duplicate: boolean }>;
    expect(items1.length).toBe(2);
    for (const it of items1) {
      expect(it.duplicate).toBe(false);
      expect(typeof it.data.id).toBe("number");
      expect(typeof it.data.payload).toBe("object");
    }
    expect(batch1.body.data.summary).toEqual({ ok: 2, duplicates: 0, failed: 0 });

    expect(await countEntries(facilityA.facilityNumber)).toBe(2);
    expect(await countAuditLog(facilityA.facilityNumber, "create")).toBe(2);

    const aIdRow = items1.find((x) => x.clientId === aId)!;
    const bIdRow = items1.find((x) => x.clientId === bId)!;
    expect(aIdRow).toBeDefined();
    expect(bIdRow).toBeDefined();

    // Second batch: A (dupe), B (dupe), C (fresh).
    const batch2 = await agent
      .post("/api/ops/trackers/adl/entries/bulk")
      .set(REQUIRED_HEADERS)
      .send({ items: [itemA, itemB, itemC] });
    expect(batch2.status).toBe(200);
    expect(batch2.body.success).toBe(true);
    const items2 = batch2.body.data.items as Array<{ clientId: string; data: { id: number }; duplicate: boolean }>;
    expect(items2.length).toBe(3);

    const a2 = items2.find((x) => x.clientId === aId)!;
    const b2 = items2.find((x) => x.clientId === bId)!;
    const c2 = items2.find((x) => x.clientId === cId)!;
    expect(a2.duplicate).toBe(true);
    expect(b2.duplicate).toBe(true);
    expect(c2.duplicate).toBe(false);
    // Duplicates must echo the ORIGINAL ids from batch1 (not freshly minted).
    expect(a2.data.id).toBe(aIdRow.data.id);
    expect(b2.data.id).toBe(bIdRow.data.id);

    expect(batch2.body.data.summary).toEqual({ ok: 3, duplicates: 2, failed: 0 });

    // DB count: 3 rows total (one new from C).
    expect(await countEntries(facilityA.facilityNumber)).toBe(3);

    // Audit log: exactly THREE create rows total (2 from batch1 + 1 from batch2),
    // not 5. Duplicates must NOT generate audit rows.
    expect(await countAuditLog(facilityA.facilityNumber, "create")).toBe(3);
  });
});
