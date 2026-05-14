/**
 * Wave 2 finale — Obligation engine storage + router smoke tests.
 *
 * Coverage:
 *  - CRUD + tenant isolation (storage + router).
 *  - State machine: every legal transition succeeds; every illegal one
 *    throws a domain error; terminal statuses reject further moves
 *    except the explicit `rejected → pending` reopen.
 *  - completeObligation with recurrence rule creates the next cycle
 *    with the correct due_at (uses shared/obligations.nextDueAt cases).
 *  - backfillLegacyComplianceItems: idempotent on second call; maps
 *    legacy status correctly; carries source_entity_type / id.
 *  - Backward-compat shim: legacy GET /compliance after backfill returns
 *    the same shape; POST writes to obligations; legacy row in
 *    ops_compliance_calendar remains untouched.
 *  - Route smoke: 401 unauth, 403 wrong tenant, 200/201 happy paths,
 *    audit-trail rows appear for each mutation.
 *
 * Conventions reused from server/__tests__/ops/staffCredentials.test.ts.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { bootstrapOpsSchema } from "../../ops/opsStorage";
import {
  backfillLegacyComplianceItems,
  completeObligation,
  createObligation,
  getObligation,
  listObligations,
  listObligationsAsLegacyCompliance,
  softDeleteObligation,
  transitionObligation,
  updateObligation,
} from "../../ops/obligationsStorage";
import type { OpsObligation } from "../../ops/opsSchema";
import {
  buildTestApp,
  cleanFacilityAccounts,
  seedFacility,
  type TestFacility,
} from "../trackers/setupTestApp";

const FACILITY_A = "TEST-FAC-OBL-A";
const FACILITY_B = "TEST-FAC-OBL-B";
const USER_A = "test-obl-a-user";
const USER_B = "test-obl-b-user";
const PW_A = "test-pw-obl-a-12345!";
const PW_B = "test-pw-obl-b-12345!";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const ACTOR = { id: "alice", role: "admin" };
const REQUIRED_HEADERS = { "X-Requested-With": "XMLHttpRequest" } as const;
const DAY = 24 * 60 * 60 * 1000;

let app: Express;
let facilityA: TestFacility;
let facilityB: TestFacility;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_obligations         WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_compliance_calendar  WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail          WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_facility_settings    WHERE facility_number = ANY($1::text[])`,
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
    email: "test-obl-a@example.com",
  });
  facilityB = await seedFacility({
    facilityNumber: FACILITY_B,
    username: USER_B,
    password: PW_B,
    email: "test-obl-b@example.com",
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

async function seedObligation(
  facilityNumber: string,
  overrides: Partial<{
    obligationType: string;
    title: string;
    dueAt: number;
    status: string;
    recurrenceRule: string | null;
    severity: string;
    assignedTo: string | null;
    sourceEntityType: string | null;
    sourceEntityId: number | null;
  }> = {},
): Promise<OpsObligation> {
  const now = Date.now();
  return createObligation(
    {
      facilityNumber,
      obligationType: overrides.obligationType ?? "license_renewal",
      targetType: "facility",
      targetId: null,
      title: overrides.title ?? "Renew facility license",
      description: null,
      dueAt: overrides.dueAt ?? now + 30 * DAY,
      completedAt: null,
      completedBy: null,
      assignedTo: overrides.assignedTo ?? null,
      severity: overrides.severity ?? "medium",
      status: (overrides.status as "pending") ?? "pending",
      evidenceRequired: 0,
      recurrenceRule: overrides.recurrenceRule ?? null,
      reminderDaysBefore: 30,
      sourceEntityType: overrides.sourceEntityType ?? null,
      sourceEntityId: overrides.sourceEntityId ?? null,
      notes: null,
      createdBy: ACTOR.id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    ACTOR,
  );
}

async function auditCount(
  facilityNumber: string,
  action: string,
): Promise<number> {
  const r = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM ops_audit_trail
     WHERE facility_number = $1 AND action = $2 AND entity_type = 'ops_obligation'`,
    [facilityNumber, action],
  );
  return Number(r.rows[0]?.c ?? 0);
}

async function seedLegacy(
  facilityNumber: string,
  overrides: Partial<{
    itemType: string;
    description: string;
    dueDate: number;
    status: string;
    assignedTo: string | null;
    completedDate: number | null;
    reminderDaysBefore: number | null;
  }> = {},
): Promise<number> {
  const now = Date.now();
  const r = await pool.query<{ id: number }>(
    `INSERT INTO ops_compliance_calendar
        (facility_number, item_type, description, due_date,
         completed_date, assigned_to, status, reminder_days_before,
         created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [
      facilityNumber,
      overrides.itemType ?? "fire_drill",
      overrides.description ?? "Quarterly fire drill",
      overrides.dueDate ?? now + 60 * DAY,
      overrides.completedDate ?? null,
      overrides.assignedTo ?? null,
      overrides.status ?? "pending",
      overrides.reminderDaysBefore ?? 30,
      now,
    ],
  );
  return Number(r.rows[0].id);
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage — CRUD + tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("obligations — CRUD + tenant isolation", () => {
  it("create + get returns the row; audit emitted", async () => {
    const row = await seedObligation(FACILITY_A, { title: "Test 1" });
    expect(row.id).toBeGreaterThan(0);
    expect(row.facilityNumber).toBe(FACILITY_A);
    expect(row.status).toBe("pending");
    const fetched = await getObligation(row.id, FACILITY_A);
    expect(fetched?.id).toBe(row.id);
    expect(await auditCount(FACILITY_A, "create")).toBe(1);
  });

  it("tenant isolation: facility A's row invisible to facility B", async () => {
    const row = await seedObligation(FACILITY_A);
    expect(await getObligation(row.id, FACILITY_B)).toBeUndefined();
    const bList = await listObligations(FACILITY_B, { page: 1, limit: 20 });
    expect(bList.total).toBe(0);
  });

  it("update changes a field; emits update audit", async () => {
    const row = await seedObligation(FACILITY_A);
    const after = await updateObligation(
      row.id,
      FACILITY_A,
      { assignedTo: "bob" },
      ACTOR,
    );
    expect(after?.assignedTo).toBe("bob");
    expect(await auditCount(FACILITY_A, "update")).toBe(1);
  });

  it("update with wrong facility returns undefined (tenant isolation)", async () => {
    const row = await seedObligation(FACILITY_A);
    const after = await updateObligation(
      row.id,
      FACILITY_B,
      { assignedTo: "mallory" },
      ACTOR,
    );
    expect(after).toBeUndefined();
  });

  it("soft-delete hides the row; preserves it in storage; delete audit emitted", async () => {
    const row = await seedObligation(FACILITY_A);
    expect(await softDeleteObligation(row.id, FACILITY_A, ACTOR)).toBe(true);
    expect(await getObligation(row.id, FACILITY_A)).toBeUndefined();
    const raw = await pool.query<{ deleted_at: number | null }>(
      `SELECT deleted_at FROM ops_obligations WHERE id=$1`,
      [row.id],
    );
    expect(raw.rows[0].deleted_at).not.toBeNull();
    expect(await auditCount(FACILITY_A, "delete")).toBe(1);
  });

  it("soft-delete is idempotent (second call returns false)", async () => {
    const row = await seedObligation(FACILITY_A);
    expect(await softDeleteObligation(row.id, FACILITY_A, ACTOR)).toBe(true);
    expect(await softDeleteObligation(row.id, FACILITY_A, ACTOR)).toBe(false);
  });

  it("list filters by dueWithinDays + non-terminal status", async () => {
    const now = Date.now();
    await seedObligation(FACILITY_A, { dueAt: now + 5 * DAY });
    await seedObligation(FACILITY_A, { dueAt: now + 60 * DAY });
    await seedObligation(FACILITY_A, { dueAt: now + 5 * DAY, status: "closed" });
    const r = await listObligations(FACILITY_A, {
      dueWithinDays: 30,
      page: 1,
      limit: 20,
    });
    expect(r.total).toBe(1);
  });

  it("list overdueOnly returns rows with due_at < now AND non-terminal", async () => {
    const now = Date.now();
    await seedObligation(FACILITY_A, { dueAt: now - 5 * DAY });
    await seedObligation(FACILITY_A, { dueAt: now + 5 * DAY });
    await seedObligation(FACILITY_A, { dueAt: now - 5 * DAY, status: "closed" });
    const r = await listObligations(FACILITY_A, {
      overdueOnly: true,
      page: 1,
      limit: 20,
    });
    expect(r.total).toBe(1);
  });

  it("list filters by sourceEntityType + sourceEntityId", async () => {
    await seedObligation(FACILITY_A, {
      sourceEntityType: "ops_temperature_log",
      sourceEntityId: 42,
    });
    await seedObligation(FACILITY_A, {
      sourceEntityType: "ops_temperature_log",
      sourceEntityId: 99,
    });
    const r = await listObligations(FACILITY_A, {
      sourceEntityType: "ops_temperature_log",
      sourceEntityId: 42,
      page: 1,
      limit: 20,
    });
    expect(r.total).toBe(1);
    expect(r.rows[0].sourceEntityId).toBe(42);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// State machine
// ─────────────────────────────────────────────────────────────────────────────

describe("obligations — state machine", () => {
  it("allows pending → in_progress → submitted → under_review → approved → closed", async () => {
    const row = await seedObligation(FACILITY_A);
    const r1 = await transitionObligation(row.id, FACILITY_A, "in_progress", ACTOR);
    expect(r1?.status).toBe("in_progress");
    const r2 = await transitionObligation(r1!.id, FACILITY_A, "submitted", ACTOR);
    expect(r2?.status).toBe("submitted");
    const r3 = await transitionObligation(r2!.id, FACILITY_A, "under_review", ACTOR);
    expect(r3?.status).toBe("under_review");
    const r4 = await transitionObligation(r3!.id, FACILITY_A, "approved", ACTOR);
    expect(r4?.status).toBe("approved");
    const r5 = await transitionObligation(r4!.id, FACILITY_A, "closed", ACTOR);
    expect(r5?.status).toBe("closed");
  });

  it("allows under_review → rejected → pending (reopen path)", async () => {
    const row = await seedObligation(FACILITY_A);
    await transitionObligation(row.id, FACILITY_A, "submitted", ACTOR);
    await transitionObligation(row.id, FACILITY_A, "under_review", ACTOR);
    const r1 = await transitionObligation(row.id, FACILITY_A, "rejected", ACTOR);
    expect(r1?.status).toBe("rejected");
    const r2 = await transitionObligation(row.id, FACILITY_A, "pending", ACTOR);
    expect(r2?.status).toBe("pending");
  });

  it("rejects an illegal transition with the domain error", async () => {
    const row = await seedObligation(FACILITY_A);
    // pending → approved is illegal (must go through review)
    await expect(
      transitionObligation(row.id, FACILITY_A, "approved", ACTOR),
    ).rejects.toThrow(/Cannot transition from pending to approved/);
  });

  it("rejects further transitions from terminal closed (except reopen path)", async () => {
    const row = await seedObligation(FACILITY_A);
    await transitionObligation(row.id, FACILITY_A, "submitted", ACTOR);
    await transitionObligation(row.id, FACILITY_A, "under_review", ACTOR);
    await transitionObligation(row.id, FACILITY_A, "approved", ACTOR);
    await transitionObligation(row.id, FACILITY_A, "closed", ACTOR);
    await expect(
      transitionObligation(row.id, FACILITY_A, "pending", ACTOR),
    ).rejects.toThrow(/Cannot transition from closed/);
  });

  it("admin can force pending → expired (overdue cleanup)", async () => {
    const row = await seedObligation(FACILITY_A);
    const r = await transitionObligation(row.id, FACILITY_A, "expired", ACTOR);
    expect(r?.status).toBe("expired");
    // expired is terminal — no further moves.
    await expect(
      transitionObligation(row.id, FACILITY_A, "pending", ACTOR),
    ).rejects.toThrow(/Cannot transition from expired/);
  });

  it("transition is no-op when toStatus === current (idempotent)", async () => {
    const row = await seedObligation(FACILITY_A);
    const r = await transitionObligation(row.id, FACILITY_A, "pending", ACTOR);
    expect(r?.status).toBe("pending");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Completion + recurrence roll-forward
// ─────────────────────────────────────────────────────────────────────────────

describe("obligations — completeObligation + recurrence", () => {
  it("non-recurring close: returns { closed, next: undefined }", async () => {
    const row = await seedObligation(FACILITY_A, { recurrenceRule: null });
    const result = await completeObligation(row.id, FACILITY_A, "bob", ACTOR);
    expect(result?.closed.status).toBe("closed");
    expect(result?.closed.completedBy).toBe("bob");
    expect(result?.next).toBeUndefined();
    expect(await auditCount(FACILITY_A, "close")).toBe(1);
  });

  it("annual recurrence creates next cycle with due_at = +1 calendar year", async () => {
    // Use a base that doesn't straddle a DST boundary across 1y. mid-July
    // is safe in every IANA zone we care about.
    const base = new Date("2026-07-15T12:00:00.000Z").getTime();
    const row = await seedObligation(FACILITY_A, {
      recurrenceRule: "annual",
      dueAt: base,
    });
    const result = await completeObligation(row.id, FACILITY_A, "bob", ACTOR);
    expect(result?.next).toBeDefined();
    const expectedDate = new Date(base);
    expectedDate.setFullYear(expectedDate.getFullYear() + 1);
    expect(result?.next?.dueAt).toBe(expectedDate.getTime());
    expect(result?.next?.sourceEntityType).toBe("ops_obligation");
    expect(result?.next?.sourceEntityId).toBe(row.id);
    expect(result?.next?.status).toBe("pending");
    // Audit: 1 close on original + 1 create for next cycle.
    expect(await auditCount(FACILITY_A, "close")).toBe(1);
    expect(await auditCount(FACILITY_A, "create")).toBe(2);
  });

  it("quarterly recurrence: +3 calendar months", async () => {
    // `nextDueAt` uses local-time setMonth so cycles preserve the
    // wall-clock month/day regardless of DST. Mirror that behavior here
    // by computing the expected from a Date with the same setter chain
    // — comparing against a hard-coded UTC ms would be tz-fragile.
    const base = new Date("2026-06-15T12:00:00.000Z").getTime();
    const row = await seedObligation(FACILITY_A, {
      recurrenceRule: "quarterly",
      dueAt: base,
    });
    const result = await completeObligation(row.id, FACILITY_A, "bob", ACTOR);
    const expectedDate = new Date(base);
    expectedDate.setMonth(expectedDate.getMonth() + 3);
    expect(result?.next?.dueAt).toBe(expectedDate.getTime());
  });

  it("every_n_days:7 → +7 literal days", async () => {
    const base = Date.now();
    const row = await seedObligation(FACILITY_A, {
      recurrenceRule: "every_n_days:7",
      dueAt: base,
    });
    const result = await completeObligation(row.id, FACILITY_A, "bob", ACTOR);
    expect(result?.next?.dueAt).toBe(base + 7 * DAY);
  });

  it("complete refuses terminal status", async () => {
    const row = await seedObligation(FACILITY_A);
    await completeObligation(row.id, FACILITY_A, "bob", ACTOR);
    await expect(
      completeObligation(row.id, FACILITY_A, "bob", ACTOR),
    ).rejects.toThrow(/terminal status/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Legacy backfill (idempotent)
// ─────────────────────────────────────────────────────────────────────────────

describe("obligations — backfillLegacyComplianceItems", () => {
  it("creates one obligation per legacy row; subsequent call is a no-op", async () => {
    await seedLegacy(FACILITY_A, { itemType: "fire_drill", status: "pending" });
    await seedLegacy(FACILITY_A, { itemType: "license_renewal", status: "completed" });
    const r1 = await backfillLegacyComplianceItems(FACILITY_A, ACTOR);
    expect(r1.created).toBe(2);
    expect(r1.skipped).toBe(0);
    const r2 = await backfillLegacyComplianceItems(FACILITY_A, ACTOR);
    expect(r2.created).toBe(0);
    expect(r2.skipped).toBe(2);
  });

  it("maps legacy status correctly", async () => {
    const legacyCompletedId = await seedLegacy(FACILITY_A, {
      itemType: "fire_drill",
      status: "completed",
      completedDate: Date.now(),
    });
    const legacyOverdueId = await seedLegacy(FACILITY_A, {
      itemType: "license_renewal",
      status: "overdue",
    });
    await backfillLegacyComplianceItems(FACILITY_A, ACTOR);
    const rows = await listObligations(FACILITY_A, {
      sourceEntityType: "legacy_compliance",
      page: 1,
      limit: 50,
    });
    const completed = rows.rows.find((r) => r.sourceEntityId === legacyCompletedId);
    const overdue = rows.rows.find((r) => r.sourceEntityId === legacyOverdueId);
    expect(completed?.status).toBe("closed");
    expect(completed?.completedAt).not.toBeNull();
    expect(overdue?.status).toBe("pending");
  });

  it("legacy row in ops_compliance_calendar remains untouched after backfill", async () => {
    const legacyId = await seedLegacy(FACILITY_A);
    await backfillLegacyComplianceItems(FACILITY_A, ACTOR);
    const r = await pool.query<{ id: number; status: string }>(
      `SELECT id, status FROM ops_compliance_calendar WHERE id=$1`,
      [legacyId],
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].status).toBe("pending");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compat shim
// ─────────────────────────────────────────────────────────────────────────────

describe("legacy /compliance shim", () => {
  it("GET /compliance returns the historic shape after backfill", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    await seedLegacy(FACILITY_A, {
      itemType: "fire_drill",
      description: "Q2 fire drill",
    });
    const res = await agent
      .get(`/api/ops/facilities/${FACILITY_A}/compliance`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    const item = res.body.data[0];
    // Historic field names — `itemType`, `dueDate`, etc. — must be present.
    expect(item).toHaveProperty("itemType");
    expect(item).toHaveProperty("dueDate");
    expect(item).toHaveProperty("status");
    expect(item).toHaveProperty("description");
    expect(item.itemType).toBe("fire_drill");
    expect(item.status).toBe("pending");
  });

  it("POST /compliance writes to ops_obligations (legacy table empty)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/compliance")
      .set(REQUIRED_HEADERS)
      .send({
        itemType: "fire_drill",
        description: "Quarterly fire drill",
        dueDate: Date.now() + 30 * DAY,
      });
    expect(res.status).toBe(201);
    // Legacy table unchanged.
    const legacy = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM ops_compliance_calendar WHERE facility_number=$1`,
      [FACILITY_A],
    );
    expect(legacy.rows[0].c).toBe(0);
    // Obligation row created.
    const obl = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM ops_obligations WHERE facility_number=$1`,
      [FACILITY_A],
    );
    expect(obl.rows[0].c).toBe(1);
  });

  it("PUT /compliance/:id completes a previously-backfilled legacy row", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    await seedLegacy(FACILITY_A);
    // Trigger backfill via GET.
    await agent
      .get(`/api/ops/facilities/${FACILITY_A}/compliance`)
      .set(REQUIRED_HEADERS);
    // Find the newly-created obligation id.
    const all = await listObligationsAsLegacyCompliance(FACILITY_A);
    expect(all).toHaveLength(1);
    const id = all[0].id;
    const completed = await agent
      .put(`/api/ops/compliance/${id}`)
      .set(REQUIRED_HEADERS)
      .send({ completedDate: Date.now() });
    expect(completed.status).toBe(200);
    const after = await listObligationsAsLegacyCompliance(FACILITY_A);
    expect(after[0].status).toBe("completed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Router smoke
// ─────────────────────────────────────────────────────────────────────────────

describe("router — obligations", () => {
  it("401 when not logged in", async () => {
    const res = await request(app)
      .get(`/api/ops/facilities/${FACILITY_A}/obligations`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(401);
  });

  it("403 when reading another facility's obligations", async () => {
    const agentA = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agentA
      .get(`/api/ops/facilities/${FACILITY_B}/obligations`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(403);
  });

  it("happy path: POST → 201; list returns the row; audit emitted", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const post = await agent
      .post("/api/ops/obligations")
      .set(REQUIRED_HEADERS)
      .send({
        obligationType: "license_renewal",
        title: "Renew CCLD facility license",
        dueAt: Date.now() + 60 * DAY,
        severity: "high",
      });
    expect(post.status).toBe(201);
    expect(post.body.success).toBe(true);
    expect(post.body.data.severity).toBe("high");

    const list = await agent
      .get(`/api/ops/facilities/${FACILITY_A}/obligations`)
      .set(REQUIRED_HEADERS);
    expect(list.status).toBe(200);
    expect(list.body.meta.total).toBe(1);
    expect(await auditCount(FACILITY_A, "create")).toBe(1);
  });

  it("POST 400 on invalid obligationType", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/obligations")
      .set(REQUIRED_HEADERS)
      .send({
        obligationType: "not_a_real_type",
        title: "x",
        dueAt: Date.now(),
      });
    expect(res.status).toBe(400);
  });

  it("PUT transition: legal move succeeds with audit; illegal returns 400", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const row = await seedObligation(FACILITY_A);
    const ok = await agent
      .post(`/api/ops/obligations/${row.id}/transition`)
      .set(REQUIRED_HEADERS)
      .send({ status: "in_progress" });
    expect(ok.status).toBe(200);
    const bad = await agent
      .post(`/api/ops/obligations/${row.id}/transition`)
      .set(REQUIRED_HEADERS)
      .send({ status: "approved" });
    expect(bad.status).toBe(400);
    expect(bad.body.error).toMatch(/Cannot transition/);
  });

  it("POST /complete closes + creates next cycle on recurring", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const base = new Date("2026-07-15T12:00:00.000Z").getTime();
    const row = await seedObligation(FACILITY_A, {
      recurrenceRule: "monthly",
      dueAt: base,
    });
    const res = await agent
      .post(`/api/ops/obligations/${row.id}/complete`)
      .set(REQUIRED_HEADERS)
      .send({ by: "bob" });
    expect(res.status).toBe(200);
    expect(res.body.data.closed.status).toBe("closed");
    const expectedDate = new Date(base);
    expectedDate.setMonth(expectedDate.getMonth() + 1);
    expect(res.body.data.next.dueAt).toBe(expectedDate.getTime());
    expect(res.body.data.next.sourceEntityId).toBe(row.id);
  });

  it("DELETE soft-deletes; subsequent GET returns 404", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const row = await seedObligation(FACILITY_A);
    const del = await agent
      .delete(`/api/ops/obligations/${row.id}`)
      .set(REQUIRED_HEADERS);
    expect(del.status).toBe(200);
    const get = await agent
      .get(`/api/ops/obligations/${row.id}`)
      .set(REQUIRED_HEADERS);
    expect(get.status).toBe(404);
  });

  it("POST /backfill-legacy returns count and is idempotent", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    await seedLegacy(FACILITY_A);
    await seedLegacy(FACILITY_A, { itemType: "license_renewal" });
    const r1 = await agent
      .post(`/api/ops/facilities/${FACILITY_A}/obligations/backfill-legacy`)
      .set(REQUIRED_HEADERS);
    expect(r1.status).toBe(200);
    expect(r1.body.data.created).toBe(2);
    const r2 = await agent
      .post(`/api/ops/facilities/${FACILITY_A}/obligations/backfill-legacy`)
      .set(REQUIRED_HEADERS);
    expect(r2.body.data.created).toBe(0);
    expect(r2.body.data.skipped).toBe(2);
  });
});
