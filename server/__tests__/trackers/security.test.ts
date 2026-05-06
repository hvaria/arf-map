/**
 * Tracker Module — security integration tests.
 *
 * Covers fix-history items:
 *   - M1 (cross-tracker clientId collision rejected, not silently merged)
 *     in BOTH the single-POST and bulk-POST paths.
 *   - Multi-tenant IDOR: a Facility-B-authenticated request for a
 *     Facility-A entry must return 404 (existence-leak avoidance) and
 *     leave the row untouched.
 *
 * Note on the cross-tracker collision tests: the foundation slice ships
 * exactly one tracker (`adl`). To exercise the cross-tracker code path
 * without registering a second tracker (which would require touching
 * production code), we plant a synthetic row directly via SQL with
 * `tracker_slug = 'fake-other'` and the same `(facility_number, client_id)`
 * the test then re-uses through the API. The single-POST and bulk-POST
 * 409 contracts both fire on the (facility_number, client_id) match
 * combined with the slug-mismatch defense-in-depth check.
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
  countEntries,
  insertCrossTrackerRow,
  seedFacility,
  type TestFacility,
} from "./setupTestApp";
import { pool } from "../../db/index";

// File-local facility identifiers — must NOT collide with the entries
// test file because the two run in parallel forks against the same DB.
const FACILITY_A_NUMBER = "TEST-FAC-SEC-A";
const FACILITY_A_USERNAME = "test-fac-sec-a-user";
const FACILITY_A_PASSWORD = "test-pw-sec-a-12345!";
const FACILITY_B_NUMBER = "TEST-FAC-SEC-B";
const FACILITY_B_USERNAME = "test-fac-sec-b-user";
const FACILITY_B_PASSWORD = "test-pw-sec-b-67890!";
const ALL_FACILITY_NUMBERS = [FACILITY_A_NUMBER, FACILITY_B_NUMBER] as const;

const REQUIRED_HEADERS = { "X-Requested-With": "XMLHttpRequest" } as const;

function adlPayload() {
  return { goal_id: "bathing", shift: "AM" as const, status: "C" as const };
}

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
// Suite-level setup — two facilities, both authenticated independently.
// ─────────────────────────────────────────────────────────────────────────────

let app: Express;
let facilityA: TestFacility;
let facilityB: TestFacility;

beforeAll(async () => {
  app = buildTestApp();
  facilityA = await seedFacility({
    facilityNumber: FACILITY_A_NUMBER,
    username: FACILITY_A_USERNAME,
    password: FACILITY_A_PASSWORD,
    email: "test-fac-sec-a@example.com",
  });
  facilityB = await seedFacility({
    facilityNumber: FACILITY_B_NUMBER,
    username: FACILITY_B_USERNAME,
    password: FACILITY_B_PASSWORD,
    email: "test-fac-sec-b@example.com",
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
// Test 2 — Cross-tracker clientId collision is rejected (M1).
// Single-POST defense-in-depth check + bulk path's TrackerClientIdSlugMismatchError.
// ─────────────────────────────────────────────────────────────────────────────

describe("cross-tracker clientId collision (M1)", () => {
  it("single POST returns 409 when the clientId already belongs to a different tracker_slug", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const sharedClientId = randomUUID();

    // Plant a 'fake-other' row with the shared clientId for facility A.
    await insertCrossTrackerRow({
      facilityNumber: facilityA.facilityNumber,
      clientId: sharedClientId,
      trackerSlug: "fake-other",
      reportedByFacilityAccountId: facilityA.id,
    });
    expect(await countEntries(facilityA.facilityNumber)).toBe(1);

    const res = await agent
      .post("/api/ops/trackers/adl/entries")
      .set(REQUIRED_HEADERS)
      .send({
        clientId: sharedClientId,
        residentId: 1,
        occurredAt: Date.now(),
        payload: adlPayload(),
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/different tracker/i);

    // The fake-other row is still the only row for that (facility, clientId).
    // No ADL row was inserted.
    expect(await countEntries(facilityA.facilityNumber)).toBe(1);
    const slugRow = await pool.query<{ tracker_slug: string }>(
      `SELECT tracker_slug FROM tracker_entries
       WHERE facility_number = $1 AND client_id = $2`,
      [facilityA.facilityNumber, sharedClientId],
    );
    expect(slugRow.rows[0].tracker_slug).toBe("fake-other");
  });

  it("bulk POST returns 409 and rolls back the WHOLE batch when one item collides", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const collidingId = randomUUID();
    const freshId = randomUUID();

    // Plant the colliding 'fake-other' row first.
    await insertCrossTrackerRow({
      facilityNumber: facilityA.facilityNumber,
      clientId: collidingId,
      trackerSlug: "fake-other",
      reportedByFacilityAccountId: facilityA.id,
    });
    expect(await countEntries(facilityA.facilityNumber)).toBe(1);

    const baseTs = Date.now();
    const res = await agent
      .post("/api/ops/trackers/adl/entries/bulk")
      .set(REQUIRED_HEADERS)
      .send({
        items: [
          {
            clientId: collidingId,
            residentId: 1,
            occurredAt: baseTs,
            payload: adlPayload(),
          },
          {
            clientId: freshId,
            residentId: 1,
            occurredAt: baseTs + 1,
            payload: adlPayload(),
          },
        ],
      });

    expect(res.status).toBe(409);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/different tracker/i);

    // Only the planted fake-other row remains. The fresh second item must
    // NOT have been inserted — the whole transaction must have rolled back.
    expect(await countEntries(facilityA.facilityNumber)).toBe(1);
    const adlCount = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM tracker_entries
       WHERE facility_number = $1 AND tracker_slug = 'adl'`,
      [facilityA.facilityNumber],
    );
    expect(Number(adlCount.rows[0].c)).toBe(0);

    // No audit row for either item — the bulk path writes audit inside the txn.
    const auditCount = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM tracker_audit_log
       WHERE facility_number = $1 AND action = 'create'`,
      [facilityA.facilityNumber],
    );
    expect(Number(auditCount.rows[0].c)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Cross-facility entry access returns 404 (multi-tenant IDOR guard).
// ─────────────────────────────────────────────────────────────────────────────

describe("multi-tenant IDOR — Facility B cannot touch Facility A's entry", () => {
  it("returns 404 on GET / PATCH / DELETE / versions and leaves the row untouched", async () => {
    const agentA = await loginAgent(app, facilityA.username, facilityA.password);
    const agentB = await loginAgent(app, facilityB.username, facilityB.password);

    // Facility A creates an ADL entry.
    const original = adlPayload();
    const createRes = await agentA
      .post("/api/ops/trackers/adl/entries")
      .set(REQUIRED_HEADERS)
      .send({
        clientId: randomUUID(),
        residentId: 1,
        occurredAt: Date.now(),
        payload: original,
      });
    expect(createRes.status).toBe(201);
    const entryId = createRes.body.data.id as number;

    // Snapshot pre-attack DB state for facility A's row.
    const preAttack = await pool.query<{
      payload: string;
      status: string;
      updated_at: string;
      deleted_at: string | null;
    }>(
      `SELECT payload, status, updated_at, deleted_at
       FROM tracker_entries WHERE id = $1`,
      [entryId],
    );
    expect(preAttack.rows.length).toBe(1);

    // GET as B → 404 (existence-leak avoidance, not 403).
    const getRes = await agentB
      .get(`/api/ops/trackers/entries/${entryId}`);
    expect(getRes.status).toBe(404);
    expect(getRes.body.success).toBe(false);

    // PATCH as B → 404. The patch must be syntactically valid so we know
    // the 404 is from tenant scoping, not body validation.
    const patchRes = await agentB
      .patch(`/api/ops/trackers/entries/${entryId}`)
      .set(REQUIRED_HEADERS)
      .send({ payload: { goal_id: "bathing", shift: "AM", status: "I" }, changeReason: "attack" });
    expect(patchRes.status).toBe(404);

    // DELETE as B → 404.
    const deleteRes = await agentB
      .delete(`/api/ops/trackers/entries/${entryId}`)
      .set(REQUIRED_HEADERS);
    expect(deleteRes.status).toBe(404);

    // GET versions as B → 404.
    const versionsRes = await agentB
      .get(`/api/ops/trackers/entries/${entryId}/versions`);
    expect(versionsRes.status).toBe(404);

    // Post-attack DB state is byte-identical for the meaningful columns.
    const postAttack = await pool.query<{
      payload: string;
      status: string;
      updated_at: string;
      deleted_at: string | null;
    }>(
      `SELECT payload, status, updated_at, deleted_at
       FROM tracker_entries WHERE id = $1`,
      [entryId],
    );
    expect(postAttack.rows.length).toBe(1);
    expect(postAttack.rows[0].payload).toBe(preAttack.rows[0].payload);
    expect(postAttack.rows[0].status).toBe(preAttack.rows[0].status);
    expect(postAttack.rows[0].updated_at).toBe(preAttack.rows[0].updated_at);
    expect(postAttack.rows[0].deleted_at).toBe(preAttack.rows[0].deleted_at);

    // No version row was created and no update/delete audit row exists.
    const verCount = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM tracker_entry_versions WHERE entry_id = $1`,
      [entryId],
    );
    expect(Number(verCount.rows[0].c)).toBe(0);
    const auditB = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM tracker_audit_log
       WHERE facility_number = $1 AND action IN ('update', 'delete')`,
      [facilityB.facilityNumber],
    );
    expect(Number(auditB.rows[0].c)).toBe(0);
    const auditA = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM tracker_audit_log
       WHERE facility_number = $1 AND action IN ('update', 'delete')`,
      [facilityA.facilityNumber],
    );
    expect(Number(auditA.rows[0].c)).toBe(0);

    // Facility A still sees the row normally — sanity check the entry isn't
    // somehow soft-deleted or hidden by the IDOR guard.
    const okGet = await agentA
      .get(`/api/ops/trackers/entries/${entryId}`);
    expect(okGet.status).toBe(200);
    expect(okGet.body.data.id).toBe(entryId);
    expect(okGet.body.data.payload).toEqual(original);
  });
});
