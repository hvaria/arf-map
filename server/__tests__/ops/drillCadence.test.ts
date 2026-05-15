/**
 * Wave 4 Phase 4.1 — Drill cadence calculator tests.
 *
 * Coverage:
 *  - Quarter math: Q1/Q2/Q3/Q4 boundaries pick up only the in-quarter drills.
 *  - Deleted drills excluded (status='deleted' filter).
 *  - Deficit + status computed correctly per shift.
 *  - FIRE_DRILLS_PER_SHIFT_PER_QUARTER reg setting honored.
 *  - Tenant isolation.
 *
 * Conventions reused from server/__tests__/ops/drillLogs.test.ts.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { bootstrapOpsSchema, createDrillLog } from "../../ops/opsStorage";
import { getDrillCadence } from "../../ops/drillCadenceStorage";
import { setRegSetting } from "../../ops/regSettings";

const FACILITY_A = "TEST-FAC-CADENCE-A";
const FACILITY_B = "TEST-FAC-CADENCE-B";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const ACTOR = { id: "alice", role: "admin" };

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_drill_logs        WHERE facility_number = ANY($1::text[])`,
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

function logDrill(
  facility: string,
  executedAt: number,
  shift: "AM" | "PM" | "NOC",
  drillKind = "fire",
): Promise<unknown> {
  return createDrillLog(
    {
      facilityNumber: facility,
      drillKind,
      scenario: null,
      shift,
      executedAt,
      leader: "Mrs. J",
      participants: [],
      residentsInvolved: [],
      evacuationSeconds: null,
      debriefNotes: null,
      correctiveActions: [],
      createdBy: ACTOR.id,
    },
    ACTOR,
  );
}

describe("getDrillCadence — empty facility (default reg setting)", () => {
  it("returns deficit=1 per shift with required=1 (default)", async () => {
    const cadence = await getDrillCadence(FACILITY_A);
    expect(cadence.fire.length).toBe(3);
    for (const cell of cadence.fire) {
      expect(cell.required).toBe(1);
      expect(cell.logged).toBe(0);
      expect(cell.deficit).toBe(1);
      expect(cell.status).toBe("behind");
    }
    expect(cadence.totalDeficit).toBe(3);
    expect(cadence.worst).toBe("behind");
  });
});

describe("getDrillCadence — quarter math", () => {
  it("only counts drills in [quarterStart, quarterEnd)", async () => {
    // Use a fixed "now" mid-Q2 (May 15, 2026 UTC) → quarter is Apr 1 - Jul 1.
    const now = Date.UTC(2026, 4, 15); // May = month 4 (0-indexed)
    // In-quarter (April 5)
    await logDrill(FACILITY_A, Date.UTC(2026, 3, 5), "AM");
    // Before quarter (March 31)
    await logDrill(FACILITY_A, Date.UTC(2026, 2, 31), "AM");
    // After quarter (July 1 — boundary excluded)
    await logDrill(FACILITY_A, Date.UTC(2026, 6, 1), "AM");

    const cadence = await getDrillCadence(FACILITY_A, now);
    expect(cadence.quarterStartAt).toBe(Date.UTC(2026, 3, 1));
    expect(cadence.quarterEndAt).toBe(Date.UTC(2026, 6, 1));
    const am = cadence.fire.find((c) => c.shift === "AM")!;
    expect(am.logged).toBe(1);
    expect(am.deficit).toBe(0);
    expect(am.status).toBe("ok");
  });

  it("Q1 boundary: Jan 1 - Apr 1", async () => {
    const now = Date.UTC(2026, 0, 15);
    const cadence = await getDrillCadence(FACILITY_A, now);
    expect(cadence.quarterStartAt).toBe(Date.UTC(2026, 0, 1));
    expect(cadence.quarterEndAt).toBe(Date.UTC(2026, 3, 1));
  });

  it("Q4 boundary: Oct 1 - next Jan 1 (year rollover)", async () => {
    const now = Date.UTC(2026, 10, 15);
    const cadence = await getDrillCadence(FACILITY_A, now);
    expect(cadence.quarterStartAt).toBe(Date.UTC(2026, 9, 1));
    expect(cadence.quarterEndAt).toBe(Date.UTC(2027, 0, 1));
  });
});

describe("getDrillCadence — soft-deleted drills excluded", () => {
  it("status='deleted' rows are not counted", async () => {
    const now = Date.now();
    await logDrill(FACILITY_A, now, "AM");
    // Force-mark this one as deleted directly so we don't bring in
    // softDeleteDrillLog's audit footprint.
    await pool.query(
      `UPDATE ops_drill_logs
          SET status = 'deleted'
        WHERE facility_number = $1`,
      [FACILITY_A],
    );
    const cadence = await getDrillCadence(FACILITY_A, now);
    const am = cadence.fire.find((c) => c.shift === "AM")!;
    expect(am.logged).toBe(0);
    expect(am.deficit).toBe(1);
  });
});

describe("getDrillCadence — reg setting honored", () => {
  it("FIRE_DRILLS_PER_SHIFT_PER_QUARTER=2 raises required to 2 per shift", async () => {
    await setRegSetting(
      FACILITY_A,
      "FIRE_DRILLS_PER_SHIFT_PER_QUARTER",
      "2",
      { actorId: ACTOR.id, actorRole: ACTOR.role },
    );
    const cadence = await getDrillCadence(FACILITY_A);
    for (const cell of cadence.fire) {
      expect(cell.required).toBe(2);
      expect(cell.deficit).toBe(2);
    }
    expect(cadence.totalRequired).toBe(6);
    expect(cadence.totalDeficit).toBe(6);
  });
});

describe("getDrillCadence — per-shift deficit", () => {
  it("AM has the required count met; PM and NOC remain behind", async () => {
    const now = Date.now();
    await logDrill(FACILITY_A, now, "AM");
    const cadence = await getDrillCadence(FACILITY_A, now);
    const am = cadence.fire.find((c) => c.shift === "AM")!;
    const pm = cadence.fire.find((c) => c.shift === "PM")!;
    const noc = cadence.fire.find((c) => c.shift === "NOC")!;
    expect(am.status).toBe("ok");
    expect(pm.status).toBe("behind");
    expect(noc.status).toBe("behind");
    expect(cadence.worst).toBe("behind");
  });

  it("worst='ok' only when every shift meets its target", async () => {
    const now = Date.now();
    await logDrill(FACILITY_A, now, "AM");
    await logDrill(FACILITY_A, now, "PM");
    await logDrill(FACILITY_A, now, "NOC");
    const cadence = await getDrillCadence(FACILITY_A, now);
    expect(cadence.worst).toBe("ok");
    expect(cadence.totalDeficit).toBe(0);
  });
});

describe("getDrillCadence — tenant isolation", () => {
  it("facility A drills do not count toward facility B", async () => {
    const now = Date.now();
    await logDrill(FACILITY_A, now, "AM");
    await logDrill(FACILITY_A, now, "PM");
    await logDrill(FACILITY_A, now, "NOC");
    const cadenceB = await getDrillCadence(FACILITY_B, now);
    expect(cadenceB.totalLogged).toBe(0);
    expect(cadenceB.worst).toBe("behind");
  });
});

describe("getDrillCadence — non-fire drills excluded", () => {
  it("disaster drills do not satisfy the fire-drill target", async () => {
    const now = Date.now();
    await logDrill(FACILITY_A, now, "AM", "disaster");
    const cadence = await getDrillCadence(FACILITY_A, now);
    const am = cadence.fire.find((c) => c.shift === "AM")!;
    expect(am.logged).toBe(0);
  });
});
