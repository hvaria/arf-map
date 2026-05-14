/**
 * W3 Staff Credentials — server storage + router smoke tests.
 *
 * Coverage:
 *   - Create + read; tenant isolation across facilities.
 *   - Update transitions status; recordAudit emitted with correct entityType.
 *   - Soft-delete preserves the row; list excludes deleted by default.
 *   - Filters: status, credential_type; pagination (page + limit).
 *   - listExpiringCredentials: non-expiring excluded; expired excluded
 *     unless includeExpired; within-window inclusive.
 *   - evaluateStaffCredentialsForShift:
 *       * missing required cert → worst=expired, type in `missing`
 *       * all certs present and far-future → worst=ok
 *       * one cert in warning window → worst=warning
 *       * one cert already expired by shiftAt → worst=expired
 *       * staff not found / wrong facility → throws
 *   - Route smoke: 401 unauth, 403 wrong tenant, 400 bad body (e.g.,
 *     credential_type='other' without note), 201 on create, 200 on update,
 *     audit-trail row appears for each mutation.
 *
 * Conventions reused from server/__tests__/ops/vendors.test.ts and
 * server/__tests__/ops/opsRouter.epicB.test.ts.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import {
  bootstrapOpsSchema,
  createStaffCredential,
  evaluateStaffCredentialsForShift,
  getStaffCredential,
  listExpiringCredentials,
  listStaffCredentials,
  softDeleteStaffCredential,
  updateStaffCredential,
} from "../../ops/opsStorage";
import {
  buildTestApp,
  cleanFacilityAccounts,
  seedFacility,
  type TestFacility,
} from "../trackers/setupTestApp";

const FACILITY_A = "TEST-FAC-CRED-A";
const FACILITY_B = "TEST-FAC-CRED-B";
const USER_A = "test-cred-a-user";
const USER_B = "test-cred-b-user";
const PW_A = "test-pw-cred-a-12345!";
const PW_B = "test-pw-cred-b-12345!";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const ACTOR = { id: "alice", role: "admin" };
const REQUIRED_HEADERS = { "X-Requested-With": "XMLHttpRequest" } as const;
const DAY = 24 * 60 * 60 * 1000;

let app: Express;
let facilityA: TestFacility;
let facilityB: TestFacility;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_staff_credentials WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_staff              WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail        WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_facility_settings  WHERE facility_number = ANY($1::text[])`,
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
    email: "test-cred-a@example.com",
  });
  facilityB = await seedFacility({
    facilityNumber: FACILITY_B,
    username: USER_B,
    password: PW_B,
    email: "test-cred-b@example.com",
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

async function seedStaff(
  facilityNumber: string,
  overrides: Partial<{ role: string; firstName: string; lastName: string; status: string }> = {},
): Promise<number> {
  const now = Date.now();
  const r = await pool.query<{ id: number }>(
    `INSERT INTO ops_staff
       (facility_number, first_name, last_name, role, status, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $6) RETURNING id`,
    [
      facilityNumber,
      overrides.firstName ?? "Jane",
      overrides.lastName ?? "Doe",
      overrides.role ?? "caregiver",
      overrides.status ?? "active",
      now,
    ],
  );
  return Number(r.rows[0].id);
}

async function seedCredential(
  facilityNumber: string,
  staffId: number,
  overrides: Partial<{
    credentialType: string;
    expiresAt: number | null;
    status: string;
    note: string | null;
  }> = {},
) {
  return createStaffCredential(
    {
      facilityNumber,
      staffId,
      credentialType: overrides.credentialType ?? "cpr",
      issuedAt: null,
      expiresAt: overrides.expiresAt === undefined ? Date.now() + 200 * DAY : overrides.expiresAt,
      verifiedAt: null,
      verifiedBy: null,
      status: (overrides.status ?? "active") as "active" | "expired" | "pending" | "na",
      note: overrides.note ?? null,
      createdBy: ACTOR.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    ACTOR,
  );
}

async function auditCount(
  facilityNumber: string,
  action: string,
  entityType = "ops_staff_credential",
): Promise<number> {
  const r = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM ops_audit_trail
     WHERE facility_number = $1 AND action = $2 AND entity_type = $3`,
    [facilityNumber, action, entityType],
  );
  return Number(r.rows[0]?.c ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage layer
// ─────────────────────────────────────────────────────────────────────────────

describe("staff credentials — create + read", () => {
  it("create + getStaffCredential returns the row, audit emitted", async () => {
    const staffId = await seedStaff(FACILITY_A, { role: "caregiver" });
    const row = await seedCredential(FACILITY_A, staffId, { credentialType: "cpr" });
    expect(row.id).toBeGreaterThan(0);
    expect(row.facilityNumber).toBe(FACILITY_A);
    expect(row.credentialType).toBe("cpr");

    const fetched = await getStaffCredential(row.id, FACILITY_A);
    expect(fetched?.id).toBe(row.id);

    expect(await auditCount(FACILITY_A, "create")).toBe(1);
  });

  it("tenant isolation: facility A's credential is invisible via facility B's id-scoped read", async () => {
    const staffId = await seedStaff(FACILITY_A);
    const row = await seedCredential(FACILITY_A, staffId);
    const bView = await getStaffCredential(row.id, FACILITY_B);
    expect(bView).toBeUndefined();

    const bList = await listStaffCredentials(FACILITY_B, { page: 1, limit: 50 });
    expect(bList.total).toBe(0);
  });
});

describe("staff credentials — update + soft-delete", () => {
  it("update transitions status and emits update audit", async () => {
    const staffId = await seedStaff(FACILITY_A);
    const row = await seedCredential(FACILITY_A, staffId, { status: "active" });
    const after = await updateStaffCredential(
      row.id,
      FACILITY_A,
      { status: "expired" },
      ACTOR,
    );
    expect(after?.status).toBe("expired");
    expect(await auditCount(FACILITY_A, "update")).toBe(1);
  });

  it("update rejects unknown status values", async () => {
    const staffId = await seedStaff(FACILITY_A);
    const row = await seedCredential(FACILITY_A, staffId);
    await expect(
      updateStaffCredential(row.id, FACILITY_A, { status: "junk" as never }, ACTOR),
    ).rejects.toThrow(/Invalid credential status/i);
  });

  it("soft-delete preserves the row; list excludes deleted; delete audit emitted", async () => {
    const staffId = await seedStaff(FACILITY_A);
    const row = await seedCredential(FACILITY_A, staffId);
    const ok = await softDeleteStaffCredential(row.id, FACILITY_A, ACTOR);
    expect(ok).toBe(true);

    // Row still in table (audit needs it), but get/list filter it out.
    const fetched = await getStaffCredential(row.id, FACILITY_A);
    expect(fetched).toBeUndefined();

    const list = await listStaffCredentials(FACILITY_A, { page: 1, limit: 50 });
    expect(list.total).toBe(0);

    const raw = await pool.query<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM ops_staff_credentials WHERE id = $1`,
      [row.id],
    );
    expect(raw.rows[0].deleted_at).not.toBeNull();
    expect(await auditCount(FACILITY_A, "delete")).toBe(1);
  });

  it("soft-delete returns false on second invocation (idempotent gate)", async () => {
    const staffId = await seedStaff(FACILITY_A);
    const row = await seedCredential(FACILITY_A, staffId);
    expect(await softDeleteStaffCredential(row.id, FACILITY_A, ACTOR)).toBe(true);
    expect(await softDeleteStaffCredential(row.id, FACILITY_A, ACTOR)).toBe(false);
  });
});

describe("staff credentials — filters & pagination", () => {
  it("status filter narrows the result set", async () => {
    const staffId = await seedStaff(FACILITY_A);
    await seedCredential(FACILITY_A, staffId, { credentialType: "cpr", status: "active" });
    await seedCredential(FACILITY_A, staffId, { credentialType: "first_aid", status: "pending" });
    const active = await listStaffCredentials(FACILITY_A, { status: "active", page: 1, limit: 50 });
    expect(active.total).toBe(1);
    expect(active.rows[0].credentialType).toBe("cpr");
    const pending = await listStaffCredentials(FACILITY_A, { status: "pending", page: 1, limit: 50 });
    expect(pending.total).toBe(1);
    expect(pending.rows[0].credentialType).toBe("first_aid");
  });

  it("credential_type filter narrows the result set", async () => {
    const staffId = await seedStaff(FACILITY_A);
    await seedCredential(FACILITY_A, staffId, { credentialType: "cpr" });
    await seedCredential(FACILITY_A, staffId, { credentialType: "first_aid" });
    const r = await listStaffCredentials(FACILITY_A, {
      credentialType: "first_aid",
      page: 1,
      limit: 50,
    });
    expect(r.total).toBe(1);
    expect(r.rows[0].credentialType).toBe("first_aid");
  });

  it("page + limit splits results correctly", async () => {
    const staffId = await seedStaff(FACILITY_A);
    for (let i = 0; i < 5; i++) {
      await seedCredential(FACILITY_A, staffId, {
        credentialType: "cpr",
        expiresAt: Date.now() + (i + 1) * 30 * DAY,
      });
    }
    const p1 = await listStaffCredentials(FACILITY_A, { page: 1, limit: 2 });
    const p2 = await listStaffCredentials(FACILITY_A, { page: 2, limit: 2 });
    const p3 = await listStaffCredentials(FACILITY_A, { page: 3, limit: 2 });
    expect(p1.total).toBe(5);
    expect(p1.rows).toHaveLength(2);
    expect(p2.rows).toHaveLength(2);
    expect(p3.rows).toHaveLength(1);
    const allIds = [...p1.rows, ...p2.rows, ...p3.rows].map((r) => r.id);
    expect(new Set(allIds).size).toBe(5);
  });
});

describe("listExpiringCredentials", () => {
  it("non-expiring rows (expires_at = null) are excluded", async () => {
    const staffId = await seedStaff(FACILITY_A);
    await seedCredential(FACILITY_A, staffId, {
      credentialType: "fingerprint_clearance",
      expiresAt: null,
    });
    const r = await listExpiringCredentials(FACILITY_A, { withinDays: 60 });
    expect(r).toHaveLength(0);
  });

  it("already-expired rows are excluded by default, included when includeExpired=true", async () => {
    const staffId = await seedStaff(FACILITY_A);
    await seedCredential(FACILITY_A, staffId, {
      credentialType: "cpr",
      expiresAt: Date.now() - 10 * DAY,
    });
    const def = await listExpiringCredentials(FACILITY_A, { withinDays: 60 });
    expect(def).toHaveLength(0);
    const inc = await listExpiringCredentials(FACILITY_A, {
      withinDays: 60,
      includeExpired: true,
    });
    expect(inc).toHaveLength(1);
  });

  it("rows expiring inside the window are returned (inclusive)", async () => {
    const staffId = await seedStaff(FACILITY_A);
    await seedCredential(FACILITY_A, staffId, {
      credentialType: "cpr",
      expiresAt: Date.now() + 30 * DAY,
    });
    await seedCredential(FACILITY_A, staffId, {
      credentialType: "first_aid",
      expiresAt: Date.now() + 200 * DAY,
    });
    const r = await listExpiringCredentials(FACILITY_A, { withinDays: 60 });
    expect(r).toHaveLength(1);
    expect(r[0].credentialType).toBe("cpr");
  });

  it("tenant isolation: facility A's expiring rows invisible to facility B", async () => {
    const staffId = await seedStaff(FACILITY_A);
    await seedCredential(FACILITY_A, staffId, {
      credentialType: "cpr",
      expiresAt: Date.now() + 5 * DAY,
    });
    const r = await listExpiringCredentials(FACILITY_B, { withinDays: 60 });
    expect(r).toHaveLength(0);
  });

  it("join surfaces staff name + role on the returned row", async () => {
    const staffId = await seedStaff(FACILITY_A, {
      firstName: "Pat",
      lastName: "Lee",
      role: "med_tech",
    });
    await seedCredential(FACILITY_A, staffId, {
      credentialType: "cpr",
      expiresAt: Date.now() + 5 * DAY,
    });
    const r = await listExpiringCredentials(FACILITY_A, { withinDays: 30 });
    expect(r).toHaveLength(1);
    expect(r[0].staffName).toBe("Pat Lee");
    expect(r[0].staffRole).toBe("med_tech");
  });
});

describe("evaluateStaffCredentialsForShift", () => {
  it("missing required cert → worst=expired with that type in `missing`", async () => {
    // caregiver requires: tb, fingerprint, cpr, first_aid, pre_service_hours
    const staffId = await seedStaff(FACILITY_A, { role: "caregiver" });
    // Only seed TB; everything else is missing.
    await seedCredential(FACILITY_A, staffId, {
      credentialType: "tb_clearance",
      expiresAt: Date.now() + 365 * DAY,
    });
    const r = await evaluateStaffCredentialsForShift(
      FACILITY_A,
      staffId,
      Date.now(),
      60,
    );
    expect(r.worst).toBe("expired");
    expect(r.missing).toEqual(
      expect.arrayContaining(["fingerprint_clearance", "cpr", "first_aid", "pre_service_hours"]),
    );
    expect(r.ok).toContain("tb_clearance");
  });

  it("all required certs present and far-future → worst=ok", async () => {
    const staffId = await seedStaff(FACILITY_A, { role: "caregiver" });
    const far = Date.now() + 365 * DAY;
    for (const t of ["tb_clearance", "fingerprint_clearance", "cpr", "first_aid", "pre_service_hours"]) {
      await seedCredential(FACILITY_A, staffId, { credentialType: t, expiresAt: far });
    }
    const r = await evaluateStaffCredentialsForShift(
      FACILITY_A,
      staffId,
      Date.now(),
      60,
    );
    expect(r.worst).toBe("ok");
    expect(r.missing).toEqual([]);
    expect(r.expired).toEqual([]);
    expect(r.warning).toEqual([]);
  });

  it("one cert expires inside warning window → worst=warning", async () => {
    const staffId = await seedStaff(FACILITY_A, { role: "caregiver" });
    const far = Date.now() + 365 * DAY;
    const soon = Date.now() + 30 * DAY; // inside 60d window
    for (const t of ["tb_clearance", "fingerprint_clearance", "first_aid", "pre_service_hours"]) {
      await seedCredential(FACILITY_A, staffId, { credentialType: t, expiresAt: far });
    }
    await seedCredential(FACILITY_A, staffId, {
      credentialType: "cpr",
      expiresAt: soon,
    });
    const r = await evaluateStaffCredentialsForShift(
      FACILITY_A,
      staffId,
      Date.now(),
      60,
    );
    expect(r.worst).toBe("warning");
    expect(r.warning).toContain("cpr");
  });

  it("one cert already expired by shiftAt → worst=expired", async () => {
    const staffId = await seedStaff(FACILITY_A, { role: "caregiver" });
    const far = Date.now() + 365 * DAY;
    for (const t of ["tb_clearance", "fingerprint_clearance", "cpr", "pre_service_hours"]) {
      await seedCredential(FACILITY_A, staffId, { credentialType: t, expiresAt: far });
    }
    await seedCredential(FACILITY_A, staffId, {
      credentialType: "first_aid",
      // Issued long ago, expired before today's shift.
      expiresAt: Date.now() - 10 * DAY,
    });
    const r = await evaluateStaffCredentialsForShift(
      FACILITY_A,
      staffId,
      Date.now(),
      60,
    );
    expect(r.worst).toBe("expired");
    expect(r.expired).toContain("first_aid");
  });

  it("throws when staff not found", async () => {
    await expect(
      evaluateStaffCredentialsForShift(FACILITY_A, 999_999_999, Date.now(), 60),
    ).rejects.toThrow(/staff not found/i);
  });

  it("throws when staff belongs to a different facility (tenant isolation)", async () => {
    const staffId = await seedStaff(FACILITY_A, { role: "caregiver" });
    await expect(
      evaluateStaffCredentialsForShift(FACILITY_B, staffId, Date.now(), 60),
    ).rejects.toThrow(/staff not found/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Router smoke
// ─────────────────────────────────────────────────────────────────────────────

describe("router — W3 staff credentials", () => {
  it("401 when not logged in", async () => {
    const res = await request(app)
      .get(`/api/ops/facilities/${FACILITY_A}/staff-credentials`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(401);
  });

  it("403 when reading another facility's credentials", async () => {
    const agentA = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agentA
      .get(`/api/ops/facilities/${FACILITY_B}/staff-credentials`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(403);
  });

  it("happy path: POST → 201, then list returns the row", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const staffId = await seedStaff(FACILITY_A, { role: "caregiver" });
    const post = await agent
      .post("/api/ops/staff-credentials")
      .set(REQUIRED_HEADERS)
      .send({
        staffId,
        credentialType: "cpr",
        expiresAt: Date.now() + 365 * DAY,
      });
    expect(post.status).toBe(201);
    expect(post.body.success).toBe(true);
    expect(post.body.data.credentialType).toBe("cpr");

    const list = await agent
      .get(`/api/ops/facilities/${FACILITY_A}/staff-credentials`)
      .set(REQUIRED_HEADERS);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(1);

    // Audit trail row appears for the create.
    expect(await auditCount(FACILITY_A, "create")).toBe(1);
  });

  it("400 when credential_type='other' has no note", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const staffId = await seedStaff(FACILITY_A, { role: "caregiver" });
    const res = await agent
      .post("/api/ops/staff-credentials")
      .set(REQUIRED_HEADERS)
      .send({
        staffId,
        credentialType: "other",
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.error).toMatch(/note/i);
  });

  it("PUT 200 updates an existing credential and emits an update audit", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const staffId = await seedStaff(FACILITY_A, { role: "caregiver" });
    const created = await seedCredential(FACILITY_A, staffId, { credentialType: "cpr" });
    const res = await agent
      .put(`/api/ops/staff-credentials/${created.id}`)
      .set(REQUIRED_HEADERS)
      .send({ status: "pending" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("pending");
    expect(await auditCount(FACILITY_A, "update")).toBe(1);
  });

  it("DELETE 200 soft-deletes and subsequent GET returns 404", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const staffId = await seedStaff(FACILITY_A);
    const created = await seedCredential(FACILITY_A, staffId);
    const del = await agent
      .delete(`/api/ops/staff-credentials/${created.id}`)
      .set(REQUIRED_HEADERS);
    expect(del.status).toBe(200);
    const get = await agent
      .get(`/api/ops/staff-credentials/${created.id}`)
      .set(REQUIRED_HEADERS);
    expect(get.status).toBe(404);
  });

  it("GET expiring uses CREDENTIAL_WARNING_DAYS reg setting when withinDays omitted", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const staffId = await seedStaff(FACILITY_A);
    // 45 days out — within the default 60-day reg setting window.
    await seedCredential(FACILITY_A, staffId, {
      credentialType: "cpr",
      expiresAt: Date.now() + 45 * DAY,
    });
    // 100 days out — outside.
    await seedCredential(FACILITY_A, staffId, {
      credentialType: "first_aid",
      expiresAt: Date.now() + 100 * DAY,
    });
    const res = await agent
      .get(`/api/ops/facilities/${FACILITY_A}/credentials/expiring`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.meta.withinDays).toBe(60);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].credentialType).toBe("cpr");
  });

  it("POST evaluate-shift uses CREDENTIAL_WARNING_DAYS from reg-settings, ignoring any client-supplied value", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const staffId = await seedStaff(FACILITY_A, { role: "caregiver" });
    const far = Date.now() + 365 * DAY;
    for (const t of ["tb_clearance", "fingerprint_clearance", "cpr", "first_aid", "pre_service_hours"]) {
      await seedCredential(FACILITY_A, staffId, { credentialType: t, expiresAt: far });
    }
    const res = await agent
      .post(`/api/ops/facilities/${FACILITY_A}/credentials/evaluate-shift`)
      .set(REQUIRED_HEADERS)
      // .send includes a stray warningDays the client shouldn't be able to set.
      // strict() zod schema must reject it.
      .send({ staffId, shiftAtMs: Date.now(), warningDays: 999_999 });
    expect(res.status).toBe(400);
    // Now send a clean body.
    const ok = await agent
      .post(`/api/ops/facilities/${FACILITY_A}/credentials/evaluate-shift`)
      .set(REQUIRED_HEADERS)
      .send({ staffId, shiftAtMs: Date.now() });
    expect(ok.status).toBe(200);
    expect(ok.body.data.worst).toBe("ok");
    // The server reads from reg-settings — default = 60.
    expect(ok.body.data.warningDays).toBe(60);
  });

  it("POST evaluate-shift returns 404 when staff is from another facility", async () => {
    const agentB = await loginAgent(app, facilityB.username, facilityB.password);
    const staffIdA = await seedStaff(FACILITY_A, { role: "caregiver" });
    const res = await agentB
      .post(`/api/ops/facilities/${FACILITY_B}/credentials/evaluate-shift`)
      .set(REQUIRED_HEADERS)
      .send({ staffId: staffIdA, shiftAtMs: Date.now() });
    expect(res.status).toBe(404);
  });
});
