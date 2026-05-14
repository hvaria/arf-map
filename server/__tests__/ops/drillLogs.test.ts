/**
 * W5 Drill logs — server storage tests.
 *
 * Coverage:
 *  - JSON columns (participants, residentsInvolved, correctiveActions) round-trip.
 *  - Malformed JSON in the DB does not crash the read path.
 *  - Soft-delete via status='deleted' preserves the row + audit history.
 *  - Status transition validation rejects junk values; deleted rows reject update.
 *  - List filters: kind, sinceMs; deleted rows hidden by default.
 *  - Tenant isolation.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import {
  bootstrapOpsSchema,
  createDrillLog,
  decodeDrillLog,
  getDrillLog,
  listDrillLogs,
  softDeleteDrillLog,
  updateDrillLog,
} from "../../ops/opsStorage";

const FACILITY_A = "TEST-FAC-DRILL-A";
const FACILITY_B = "TEST-FAC-DRILL-B";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const ACTOR = { id: "alice", role: "admin" };

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_drill_logs   WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail  WHERE facility_number = ANY($1::text[])`,
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

describe("drillLogs — JSON column round-trip", () => {
  it("participants / residentsInvolved / correctiveActions stringify on write, parse on read", async () => {
    const row = await createDrillLog(
      {
        facilityNumber: FACILITY_A,
        drillKind: "fire",
        scenario: "Kitchen grease fire, west wing",
        shift: "PM",
        executedAt: Date.now(),
        leader: "Mrs. Johnson",
        participants: ["Alice (RN)", "Bob (CNA)", "Carmen (DON)"],
        residentsInvolved: ["Margaret Chen (R101)", "Robert Hayes (R102)"],
        evacuationSeconds: 245,
        debriefNotes: "Evac under 5 min, wheelchair flow good, signage tested.",
        correctiveActions: ["Order 2 more sand buckets", "Replace exit sign 3B"],
        createdBy: ACTOR.id,
      },
      ACTOR,
    );
    const decoded = decodeDrillLog(row);
    expect(decoded.participants).toEqual(["Alice (RN)", "Bob (CNA)", "Carmen (DON)"]);
    expect(decoded.residentsInvolved).toEqual(["Margaret Chen (R101)", "Robert Hayes (R102)"]);
    expect(decoded.correctiveActions).toHaveLength(2);
    expect(row.evacuationSeconds).toBe(245);
    expect(row.status).toBe("executed");
  });

  it("malformed JSON in DB does not crash the read path (defaults to [])", async () => {
    // Insert a row with deliberately corrupt JSON in one of the array
    // columns so the parse defensive fallback gets exercised.
    const res = await pool.query<{ id: number }>(
      `INSERT INTO ops_drill_logs
         (facility_number, drill_kind, executed_at,
          participants_json, residents_involved_json, corrective_actions_json,
          status, created_by, created_at, updated_at)
       VALUES ($1, 'fire', $2, '{not-json', NULL, '[bad', 'executed', 'seed', $2, $2)
       RETURNING id`,
      [FACILITY_A, Date.now()],
    );
    const row = await getDrillLog(Number(res.rows[0].id), FACILITY_A);
    expect(row).toBeDefined();
    const decoded = decodeDrillLog(row!);
    expect(decoded.participants).toEqual([]);
    expect(decoded.residentsInvolved).toEqual([]);
    expect(decoded.correctiveActions).toEqual([]);
  });

  it("undefined / null JSON columns project as empty arrays", async () => {
    const row = await createDrillLog(
      {
        facilityNumber: FACILITY_A,
        drillKind: "earthquake",
        executedAt: Date.now(),
        createdBy: ACTOR.id,
      },
      ACTOR,
    );
    const d = decodeDrillLog(row);
    expect(d.participants).toEqual([]);
    expect(d.residentsInvolved).toEqual([]);
    expect(d.correctiveActions).toEqual([]);
  });
});

describe("drillLogs — soft delete preserves audit history", () => {
  it("status='deleted' hides the row from default list but keeps DB row + audit", async () => {
    const row = await createDrillLog(
      {
        facilityNumber: FACILITY_A,
        drillKind: "fire",
        executedAt: Date.now(),
        createdBy: ACTOR.id,
      },
      ACTOR,
    );
    const ok = await softDeleteDrillLog(row.id, FACILITY_A, ACTOR);
    expect(ok).toBe(true);

    // Default list hides deleted rows.
    const list = await listDrillLogs(FACILITY_A, { page: 1, limit: 50 });
    expect(list.total).toBe(0);

    // includeDeleted=true surfaces them.
    const listAll = await listDrillLogs(FACILITY_A, { page: 1, limit: 50, includeDeleted: true });
    expect(listAll.total).toBe(1);
    expect(listAll.logs[0].status).toBe("deleted");

    // Audit log has both create and delete rows.
    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM ops_audit_trail
       WHERE facility_number = $1 AND entity_type = 'ops_drill_log' AND entity_id = $2
       ORDER BY occurred_at ASC`,
      [FACILITY_A, row.id],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(["create", "delete"]);
  });

  it("update on a deleted row is rejected", async () => {
    const row = await createDrillLog(
      {
        facilityNumber: FACILITY_A,
        drillKind: "fire",
        executedAt: Date.now(),
        createdBy: ACTOR.id,
      },
      ACTOR,
    );
    await softDeleteDrillLog(row.id, FACILITY_A, ACTOR);
    await expect(
      updateDrillLog(row.id, FACILITY_A, { debriefNotes: "late edit" }, ACTOR),
    ).rejects.toThrow(/deleted/i);
  });
});

describe("drillLogs — status transitions", () => {
  it("rejects unknown status values", async () => {
    const row = await createDrillLog(
      {
        facilityNumber: FACILITY_A,
        drillKind: "fire",
        executedAt: Date.now(),
        createdBy: ACTOR.id,
      },
      ACTOR,
    );
    await expect(
      updateDrillLog(row.id, FACILITY_A, { status: "junk" }, ACTOR),
    ).rejects.toThrow(/Invalid drill status/i);
  });

  it("allows executed → completed transition", async () => {
    const row = await createDrillLog(
      {
        facilityNumber: FACILITY_A,
        drillKind: "fire",
        executedAt: Date.now(),
        createdBy: ACTOR.id,
      },
      ACTOR,
    );
    const updated = await updateDrillLog(
      row.id,
      FACILITY_A,
      { status: "completed", debriefNotes: "Debrief filed" },
      ACTOR,
    );
    expect(updated?.status).toBe("completed");
  });
});

describe("drillLogs — list filters + tenant isolation", () => {
  it("filters by kind and sinceMs", async () => {
    const long = Date.now() - 10 * 24 * 60 * 60 * 1000;
    const recent = Date.now() - 1 * 24 * 60 * 60 * 1000;
    await createDrillLog(
      { facilityNumber: FACILITY_A, drillKind: "fire",       executedAt: long,   createdBy: ACTOR.id },
      ACTOR,
    );
    await createDrillLog(
      { facilityNumber: FACILITY_A, drillKind: "earthquake", executedAt: recent, createdBy: ACTOR.id },
      ACTOR,
    );
    const fire = await listDrillLogs(FACILITY_A, { kind: "fire", page: 1, limit: 50 });
    expect(fire.total).toBe(1);

    const sinceYesterday = await listDrillLogs(FACILITY_A, {
      sinceMs: Date.now() - 2 * 24 * 60 * 60 * 1000,
      page: 1,
      limit: 50,
    });
    expect(sinceYesterday.total).toBe(1);
    expect(sinceYesterday.logs[0].drillKind).toBe("earthquake");
  });

  it("tenant isolation — facility A drills are invisible to facility B", async () => {
    await createDrillLog(
      {
        facilityNumber: FACILITY_A,
        drillKind: "fire",
        executedAt: Date.now(),
        createdBy: ACTOR.id,
      },
      ACTOR,
    );
    const bView = await listDrillLogs(FACILITY_B, { page: 1, limit: 50 });
    expect(bView.total).toBe(0);
  });
});
