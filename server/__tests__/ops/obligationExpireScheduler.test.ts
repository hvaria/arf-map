/**
 * Wave 4 Phase 4.1 — Obligation auto-expire scheduler tests.
 *
 * Coverage:
 *  - expireOverdueObligations transitions only candidates past the grace
 *    period.
 *  - Grace days reg setting override is honored.
 *  - Per-facility batch cap (200 per tick) is honored — anything beyond
 *    the cap remains pending and is picked up on the next pass.
 *  - Audit emission per transition (one audit row tagged ops_obligation).
 *  - Tenant isolation.
 *  - Non-pending statuses (in_progress, submitted, etc.) are NOT auto-
 *    expired by the cron — only `pending`.
 *
 * Conventions reused from server/__tests__/ops/obligations.test.ts.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { bootstrapOpsSchema } from "../../ops/opsStorage";
import {
  createObligation,
  transitionObligation,
} from "../../ops/obligationsStorage";
import { expireOverdueObligations } from "../../ops/obligationExpireScheduler";
import { setRegSetting } from "../../ops/regSettings";
import type { OpsObligation } from "../../ops/opsSchema";

const FACILITY_A = "TEST-FAC-EXPIRE-A";
const FACILITY_B = "TEST-FAC-EXPIRE-B";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const ACTOR = { id: "alice", role: "admin" };
const DAY = 24 * 60 * 60 * 1000;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_obligations        WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail         WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_facility_settings   WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
}

beforeAll(async () => {
  await bootstrapMainSchema();
  await bootstrapOpsSchema();
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

beforeEach(async () => {
  await cleanup();
});

async function seedPending(
  facilityNumber: string,
  dueAt: number,
  title = "Renew facility license",
): Promise<OpsObligation> {
  const now = Date.now();
  return createObligation(
    {
      facilityNumber,
      obligationType: "license_renewal",
      targetType: "facility",
      targetId: null,
      title,
      description: null,
      dueAt,
      completedAt: null,
      completedBy: null,
      assignedTo: null,
      severity: "medium",
      status: "pending",
      evidenceRequired: 0,
      recurrenceRule: null,
      reminderDaysBefore: 30,
      sourceEntityType: null,
      sourceEntityId: null,
      notes: null,
      createdBy: ACTOR.id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    ACTOR,
  );
}

async function auditExpireCount(facility: string): Promise<number> {
  const r = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c
       FROM ops_audit_trail
      WHERE facility_number = $1
        AND entity_type = 'ops_obligation'
        AND after_json LIKE '%"status":"expired"%'`,
    [facility],
  );
  return Number(r.rows[0]?.c ?? 0);
}

describe("expireOverdueObligations — grace period", () => {
  it("transitions rows whose due_at is past the grace cutoff", async () => {
    const now = Date.now();
    // Grace defaults to 1 day. due_at = now - 2 days → past grace.
    await seedPending(FACILITY_A, now - 2 * DAY, "Old #1");
    await seedPending(FACILITY_A, now - 3 * DAY, "Old #2");
    // due_at = now - 12 hours → inside grace, should remain pending.
    await seedPending(FACILITY_A, now - 12 * 60 * 60 * 1000, "Inside grace");
    // due_at in the future → not overdue at all.
    await seedPending(FACILITY_A, now + 7 * DAY, "Future");

    const result = await expireOverdueObligations(FACILITY_A, { now });
    expect(result.expired).toBe(2);

    const r = await pool.query<{ status: string; title: string }>(
      `SELECT status, title FROM ops_obligations
         WHERE facility_number = $1 ORDER BY title`,
      [FACILITY_A],
    );
    const byTitle = Object.fromEntries(r.rows.map((x) => [x.title, x.status]));
    expect(byTitle["Old #1"]).toBe("expired");
    expect(byTitle["Old #2"]).toBe("expired");
    expect(byTitle["Inside grace"]).toBe("pending");
    expect(byTitle["Future"]).toBe("pending");
  });

  it("graceDays override (opts) takes precedence over the reg setting", async () => {
    const now = Date.now();
    await seedPending(FACILITY_A, now - 5 * DAY, "5 days past");
    // graceDays=10 → 5-days-past is INSIDE the grace window.
    const result = await expireOverdueObligations(FACILITY_A, {
      now,
      graceDays: 10,
    });
    expect(result.expired).toBe(0);
  });

  it("OBLIGATION_EXPIRE_GRACE_DAYS reg setting is honored", async () => {
    await setRegSetting(
      FACILITY_A,
      "OBLIGATION_EXPIRE_GRACE_DAYS",
      "7",
      { actorId: ACTOR.id, actorRole: ACTOR.role },
    );
    const now = Date.now();
    await seedPending(FACILITY_A, now - 5 * DAY, "5d past");
    const result = await expireOverdueObligations(FACILITY_A, { now });
    expect(result.expired).toBe(0);
  });
});

describe("expireOverdueObligations — audit emission", () => {
  it("emits one audit row tagged ops_obligation per transition", async () => {
    const now = Date.now();
    await seedPending(FACILITY_A, now - 5 * DAY, "to expire");
    const before = await auditExpireCount(FACILITY_A);
    await expireOverdueObligations(FACILITY_A, { now });
    const after = await auditExpireCount(FACILITY_A);
    expect(after - before).toBe(1);
  });
});

describe("expireOverdueObligations — batch cap (200)", () => {
  it("at most MAX_PER_TICK=200 transitions per call", async () => {
    const now = Date.now();
    // Seed 205 overdue pending rows. The cron only processes 200 per
    // tick; the remaining 5 stay pending for the next pass.
    const promises: Promise<unknown>[] = [];
    for (let i = 0; i < 205; i += 1) {
      promises.push(seedPending(FACILITY_A, now - (5 + i) * DAY, `batch-${i}`));
    }
    await Promise.all(promises);
    const result = await expireOverdueObligations(FACILITY_A, { now });
    expect(result.expired).toBe(200);
    const r = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM ops_obligations
         WHERE facility_number = $1 AND status = 'pending' AND deleted_at IS NULL`,
      [FACILITY_A],
    );
    expect(Number(r.rows[0]?.c ?? 0)).toBe(5);
    // Second pass should clean up the remainder.
    const second = await expireOverdueObligations(FACILITY_A, { now });
    expect(second.expired).toBe(5);
  }, 60000);
});

describe("expireOverdueObligations — non-pending excluded", () => {
  it("in_progress / submitted obligations are NOT auto-expired", async () => {
    const now = Date.now();
    const inProgress = await seedPending(FACILITY_A, now - 5 * DAY, "wip");
    await transitionObligation(inProgress.id, FACILITY_A, "in_progress", ACTOR);
    const result = await expireOverdueObligations(FACILITY_A, { now });
    expect(result.expired).toBe(0);
    const r = await pool.query<{ status: string }>(
      `SELECT status FROM ops_obligations WHERE id = $1`,
      [inProgress.id],
    );
    expect(r.rows[0].status).toBe("in_progress");
  });

  it("soft-deleted rows are NOT picked up by the cron", async () => {
    const now = Date.now();
    const row = await seedPending(FACILITY_A, now - 5 * DAY, "deleted");
    await pool.query(
      `UPDATE ops_obligations SET deleted_at = $1 WHERE id = $2`,
      [now, row.id],
    );
    const result = await expireOverdueObligations(FACILITY_A, { now });
    expect(result.expired).toBe(0);
  });
});

describe("expireOverdueObligations — tenant isolation", () => {
  it("a facility A pass does not transition facility B's rows", async () => {
    const now = Date.now();
    await seedPending(FACILITY_A, now - 5 * DAY, "a-row");
    await seedPending(FACILITY_B, now - 5 * DAY, "b-row");
    const result = await expireOverdueObligations(FACILITY_A, { now });
    expect(result.expired).toBe(1);
    const r = await pool.query<{ status: string }>(
      `SELECT status FROM ops_obligations
         WHERE facility_number = $1`,
      [FACILITY_B],
    );
    expect(r.rows[0].status).toBe("pending");
  });
});
