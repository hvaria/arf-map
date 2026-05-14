/**
 * Epic B router smoke — one happy-path + 400/404 case per resource.
 *
 * Goal of this file is breadth (every Wave 1 route mounts, validates,
 * gates by permission, returns the envelope) — depth on each resource
 * lives in its own storage test file.
 *
 * Coverage per resource:
 *   - happy path 200/201 with the envelope { success, data }
 *   - 400 on missing/invalid body
 *   - 404 on wrong-tenant id (IDOR guard via :facilityNumber + storage
 *     scope on body-only routes)
 *   - 403 on auditor role for write endpoints (matrix check, not live
 *     session — Wave 0 resolveRole() is hard-coded to "admin")
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import {
  buildTestApp,
  cleanFacilityAccounts,
  seedFacility,
  type TestFacility,
} from "../trackers/setupTestApp";
import { pool } from "../../db/index";
import { bootstrapOpsSchema } from "../../ops/opsStorage";
import { ROLE_PERMISSIONS, OPS_RESOURCES } from "../../ops/permissions";

const FACILITY_A = "TEST-FAC-EPICB-A";
const FACILITY_B = "TEST-FAC-EPICB-B";
const USER_A = "test-epicb-a-user";
const USER_B = "test-epicb-b-user";
const PW_A = "test-pw-epicb-a-12345!";
const PW_B = "test-pw-epicb-b-12345!";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const REQUIRED_HEADERS = { "X-Requested-With": "XMLHttpRequest" } as const;

let app: Express;
let facilityA: TestFacility;
let facilityB: TestFacility;

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

async function cleanup(): Promise<void> {
  // Order: dependent tables first.
  await pool.query(`DELETE FROM ops_inspection_citations           WHERE facility_number = ANY($1::text[])`, [[...ALL_FN]]);
  await pool.query(`DELETE FROM ops_inspections                    WHERE facility_number = ANY($1::text[])`, [[...ALL_FN]]);
  await pool.query(`DELETE FROM ops_complaint_investigation_notes  WHERE facility_number = ANY($1::text[])`, [[...ALL_FN]]);
  await pool.query(`DELETE FROM ops_complaints                     WHERE facility_number = ANY($1::text[])`, [[...ALL_FN]]);
  await pool.query(`DELETE FROM ops_vendors                        WHERE facility_number = ANY($1::text[])`, [[...ALL_FN]]);
  await pool.query(`DELETE FROM ops_drill_logs                     WHERE facility_number = ANY($1::text[])`, [[...ALL_FN]]);
  await pool.query(`DELETE FROM ops_temperature_logs               WHERE facility_number = ANY($1::text[])`, [[...ALL_FN]]);
  await pool.query(`DELETE FROM ops_temperature_fixtures           WHERE facility_number = ANY($1::text[])`, [[...ALL_FN]]);
  await pool.query(`DELETE FROM ops_controlled_sub_counts          WHERE facility_number = ANY($1::text[])`, [[...ALL_FN]]);
  await pool.query(`DELETE FROM ops_medications                    WHERE facility_number = ANY($1::text[])`, [[...ALL_FN]]);
  await pool.query(`DELETE FROM ops_residents                      WHERE facility_number = ANY($1::text[])`, [[...ALL_FN]]);
  await pool.query(`DELETE FROM ops_audit_trail                    WHERE facility_number = ANY($1::text[])`, [[...ALL_FN]]);
}

beforeAll(async () => {
  app = buildTestApp();
  await bootstrapOpsSchema();
  facilityA = await seedFacility({
    facilityNumber: FACILITY_A,
    username: USER_A,
    password: PW_A,
    email: "test-epicb-a@example.com",
  });
  facilityB = await seedFacility({
    facilityNumber: FACILITY_B,
    username: USER_B,
    password: PW_B,
    email: "test-epicb-b@example.com",
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

// ─────────────────────────────────────────────────────────────────────────────
// W7 Temperature fixtures + logs
// ─────────────────────────────────────────────────────────────────────────────

describe("router — W7 temperature", () => {
  it("happy path: create fixture → list → create log → list", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);

    const fxPost = await agent
      .post("/api/ops/temp-fixtures")
      .set(REQUIRED_HEADERS)
      .send({
        fixtureKey: "fridge1",
        fixtureLabel: "Kitchen Fridge",
        kind: "fridge",
        requiredMin: 32,
        requiredMax: 40,
      });
    expect(fxPost.status).toBe(201);
    expect(fxPost.body.success).toBe(true);
    const fixtureId = fxPost.body.data.id;

    const logPost = await agent
      .post("/api/ops/temp-logs")
      .set(REQUIRED_HEADERS)
      .send({
        fixtureId,
        readingValue: 28, // out of range
        readingAt: Date.now(),
        recordedBy: "Cook Jane",
      });
    expect(logPost.status).toBe(201);
    expect(logPost.body.data.outOfRange).toBe(1);
    expect(logPost.body.data.followUpDueAt).not.toBeNull();

    const list = await agent
      .get(`/api/ops/facilities/${FACILITY_A}/temp-logs?outOfRangeOnly=true`)
      .set(REQUIRED_HEADERS);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(1);
  });

  it("400 on invalid body (missing fixtureKey)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/temp-fixtures")
      .set(REQUIRED_HEADERS)
      .send({ fixtureLabel: "x" }); // no fixtureKey
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("404 on temp-log create with another facility's fixtureId (tenant scope)", async () => {
    const agentA = await loginAgent(app, facilityA.username, facilityA.password);
    const fxA = await agentA
      .post("/api/ops/temp-fixtures")
      .set(REQUIRED_HEADERS)
      .send({
        fixtureKey: "f1",
        fixtureLabel: "F",
        kind: "fridge",
        requiredMin: 32,
        requiredMax: 40,
      });
    expect(fxA.status).toBe(201);

    const agentB = await loginAgent(app, facilityB.username, facilityB.password);
    const res = await agentB
      .post("/api/ops/temp-logs")
      .set(REQUIRED_HEADERS)
      .send({
        fixtureId: fxA.body.data.id,
        readingValue: 36,
        readingAt: Date.now(),
        recordedBy: "x",
      });
    expect(res.status).toBe(404);
  });

  it("IDOR: GET /facilities/B/temp-logs from facility A's session → 403", async () => {
    const agentA = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agentA
      .get(`/api/ops/facilities/${FACILITY_B}/temp-logs`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// W5 Drills
// ─────────────────────────────────────────────────────────────────────────────

describe("router — W5 drills", () => {
  it("happy path: POST /drills with participants array → list returns decoded array", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/drills")
      .set(REQUIRED_HEADERS)
      .send({
        drillKind: "fire",
        executedAt: Date.now(),
        participants: ["Alice", "Bob"],
        evacuationSeconds: 240,
      });
    expect(res.status).toBe(201);
    expect(res.body.data.participants).toEqual(["Alice", "Bob"]);
    expect(res.body.data.evacuationSeconds).toBe(240);

    const list = await agent
      .get(`/api/ops/facilities/${FACILITY_A}/drills`)
      .set(REQUIRED_HEADERS);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(1);
  });

  it("400 on missing drillKind", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/drills")
      .set(REQUIRED_HEADERS)
      .send({ executedAt: Date.now() });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// W9 Vendors
// ─────────────────────────────────────────────────────────────────────────────

describe("router — W9 vendors", () => {
  it("happy path: POST → list → archive", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const post = await agent
      .post("/api/ops/vendors")
      .set(REQUIRED_HEADERS)
      .send({
        vendorName: "ABC Pharmacy",
        vendorType: "pharmacy",
        coiExpiresAt: Date.now() + 10 * 24 * 60 * 60 * 1000,
      });
    expect(post.status).toBe(201);
    const id = post.body.data.id;

    const list = await agent
      .get(`/api/ops/facilities/${FACILITY_A}/vendors?expiringWithinDays=30`)
      .set(REQUIRED_HEADERS);
    expect(list.body.meta.total).toBe(1);

    const archive = await agent
      .post(`/api/ops/vendors/${id}/archive`)
      .set(REQUIRED_HEADERS);
    expect(archive.status).toBe(200);
    expect(archive.body.data.status).toBe("archived");
  });

  it("400 on missing vendorName", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/vendors")
      .set(REQUIRED_HEADERS)
      .send({ vendorType: "pharmacy" });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// W10 Complaints
// ─────────────────────────────────────────────────────────────────────────────

describe("router — W10 complaints", () => {
  it("happy path: anonymous complaint create + note + resolve + close", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const post = await agent
      .post("/api/ops/complaints")
      .set(REQUIRED_HEADERS)
      .send({
        receivedAt: Date.now(),
        complainantType: "anonymous",
        // anonymous → blank names allowed
        nature: "Anonymous concern about scheduling",
        externalRef: "Internal-2026-007",
      });
    expect(post.status).toBe(201);
    expect(post.body.data.externalRef).toBe("Internal-2026-007");
    const id = post.body.data.id;

    const note = await agent
      .post(`/api/ops/complaints/${id}/notes`)
      .set(REQUIRED_HEADERS)
      .send({ note: "Interviewed scheduler" });
    expect(note.status).toBe(201);

    const resolve = await agent
      .post(`/api/ops/complaints/${id}/resolve`)
      .set(REQUIRED_HEADERS)
      .send({ resolutionNote: "Adjusted PM rotation" });
    expect(resolve.status).toBe(200);
    expect(resolve.body.data.status).toBe("resolved");

    const close = await agent
      .post(`/api/ops/complaints/${id}/close`)
      .set(REQUIRED_HEADERS);
    expect(close.status).toBe(200);
    expect(close.body.data.status).toBe("closed");
  });

  it("400 on non-anonymous complaint without complainantName", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/complaints")
      .set(REQUIRED_HEADERS)
      .send({
        receivedAt: Date.now(),
        complainantType: "family",
        // no complainantName
        nature: "X",
      });
    expect(res.status).toBe(400);
  });

  it("404 on GET /complaints/:id for another facility's id", async () => {
    const agentA = await loginAgent(app, facilityA.username, facilityA.password);
    const post = await agentA
      .post("/api/ops/complaints")
      .set(REQUIRED_HEADERS)
      .send({
        receivedAt: Date.now(),
        complainantType: "anonymous",
        nature: "x",
      });
    const id = post.body.data.id;

    const agentB = await loginAgent(app, facilityB.username, facilityB.password);
    const res = await agentB
      .get(`/api/ops/complaints/${id}`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// W13 Inspections
// ─────────────────────────────────────────────────────────────────────────────

describe("router — W13 inspections", () => {
  it("happy path: create inspection + citation + try close (blocked) + close citation + close", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const post = await agent
      .post("/api/ops/inspections")
      .set(REQUIRED_HEADERS)
      .send({
        inspectorOrg: "CCLD",
        purpose: "annual",
        visitAt: Date.now(),
      });
    expect(post.status).toBe(201);
    const inspId = post.body.data.id;

    const cite = await agent
      .post(`/api/ops/inspections/${inspId}/citations`)
      .set(REQUIRED_HEADERS)
      .send({ citationTitle: "Title 22 §87468(a)" });
    expect(cite.status).toBe(201);
    const citationId = cite.body.data.id;

    const earlyClose = await agent
      .post(`/api/ops/inspections/${inspId}/close`)
      .set(REQUIRED_HEADERS);
    expect(earlyClose.status).toBe(400);
    expect(earlyClose.body.error).toMatch(/open citations remain/i);

    const closeC = await agent
      .post(`/api/ops/citations/${citationId}/close`)
      .set(REQUIRED_HEADERS)
      .send({ closureNote: "Signage updated" });
    expect(closeC.status).toBe(200);

    const closeI = await agent
      .post(`/api/ops/inspections/${inspId}/close`)
      .set(REQUIRED_HEADERS);
    expect(closeI.status).toBe(200);
    expect(closeI.body.data.status).toBe("closed");
  });

  it("400 on invalid body (missing purpose)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/inspections")
      .set(REQUIRED_HEADERS)
      .send({ inspectorOrg: "CCLD", visitAt: Date.now() });
    expect(res.status).toBe(400);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// W11 Controlled-sub
// ─────────────────────────────────────────────────────────────────────────────

describe("router — W11 controlled-sub", () => {
  async function seedDiscrepancy(facilityNumber: string): Promise<number> {
    const now = Date.now();
    const r = await pool.query<{ id: number }>(
      `INSERT INTO ops_residents (facility_number, first_name, last_name, status, created_at, updated_at)
       VALUES ($1, 'M', 'C', 'active', $2, $2) RETURNING id`,
      [facilityNumber, now],
    );
    const rid = Number(r.rows[0].id);
    const m = await pool.query<{ id: number }>(
      `INSERT INTO ops_medications
         (resident_id, facility_number, drug_name, dosage, route, frequency,
          is_controlled, status, created_at, updated_at)
       VALUES ($1, $2, 'Lorazepam', '1 mg', 'PO', 'PRN', 1, 'active', $3, $3)
       RETURNING id`,
      [rid, facilityNumber, now],
    );
    const mid = Number(m.rows[0].id);
    const c = await pool.query<{ id: number }>(
      `INSERT INTO ops_controlled_sub_counts
         (medication_id, facility_number, count_date, shift, counted_by,
          witnessed_by, opening_count, closing_count, administered_count,
          wasted_count, discrepancy, discrepancy_notes, resolved, created_at)
       VALUES ($1, $2, $3, 'PM', 'a', 'b', 10, 8, 1, 0, -1, 'intake', 0, $3)
       RETURNING id`,
      [mid, facilityNumber, now],
    );
    return Number(c.rows[0].id);
  }

  it("happy path: list discrepancies + resolve", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const cid = await seedDiscrepancy(FACILITY_A);

    const list = await agent
      .get(`/api/ops/facilities/${FACILITY_A}/controlled-sub/discrepancies?resolved=false&includeDestructions=true`)
      .set(REQUIRED_HEADERS);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(1);
    expect(Array.isArray(list.body.meta.recentDestructions)).toBe(true);

    const resolve = await agent
      .post(`/api/ops/controlled-sub/counts/${cid}/resolve`)
      .set(REQUIRED_HEADERS)
      .send({ note: "Found in drawer", witnessedBy: "nurse-c" });
    expect(resolve.status).toBe(200);
    expect(resolve.body.data.resolved).toBe(1);
  });

  it("400 on resolve with empty note", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const cid = await seedDiscrepancy(FACILITY_A);
    const res = await agent
      .post(`/api/ops/controlled-sub/counts/${cid}/resolve`)
      .set(REQUIRED_HEADERS)
      .send({ note: "", witnessedBy: "x" });
    expect(res.status).toBe(400);
  });

  it("404 on resolve with a count id that belongs to another facility", async () => {
    const cid = await seedDiscrepancy(FACILITY_A);
    const agentB = await loginAgent(app, facilityB.username, facilityB.password);
    const res = await agentB
      .post(`/api/ops/controlled-sub/counts/${cid}/resolve`)
      .set(REQUIRED_HEADERS)
      .send({ note: "x", witnessedBy: "y" });
    expect(res.status).toBe(404);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Permission matrix — auditor must be denied writes on every new resource.
//
// Wave 0 resolveRole() is hard-coded to "admin" so the live session can't
// reach the 403 path. We assert the matrix directly — the day Wave 3 flips
// the role for share-link sessions, write actions must already deny.
// ─────────────────────────────────────────────────────────────────────────────

describe("router — auditor role denied writes (matrix contract)", () => {
  const writeActions = ["create", "update", "delete", "resolve", "close"] as const;

  for (const resource of [
    OPS_RESOURCES.TEMPERATURE_FIXTURE,
    OPS_RESOURCES.TEMPERATURE_LOG,
    OPS_RESOURCES.DRILL_LOG,
    OPS_RESOURCES.VENDOR,
    OPS_RESOURCES.COMPLAINT,
    OPS_RESOURCES.INSPECTION,
    OPS_RESOURCES.CONTROLLED_SUB_COUNT,
  ]) {
    it(`auditor has only read on ${resource}`, () => {
      const auditorPerms = ROLE_PERMISSIONS.auditor;
      const perm = auditorPerms.find((p) => p.resource === resource);
      expect(perm).toBeDefined();
      expect(perm?.actions).toContain("read");
      for (const a of writeActions) {
        expect(perm?.actions).not.toContain(a);
      }
    });
  }
});
