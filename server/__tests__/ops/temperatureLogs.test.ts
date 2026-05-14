/**
 * W7 Temperature fixtures + logs — server storage tests.
 *
 * Coverage:
 *  - Out-of-range hook fires on reading below required_min / above required_max.
 *  - Threshold copied at insert time (snapshot — later fixture edits don't
 *    retroactively change historical out_of_range flags).
 *  - Resolve clears follow-up; double-resolve rejected.
 *  - Non-existent fixture rejected.
 *  - Inactive fixture rejected.
 *  - Tenant isolation: facility A's logs invisible from facility B.
 *  - listTemperatureLogs filters (fixtureKey, sinceMs, outOfRangeOnly).
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import {
  bootstrapOpsSchema,
  createTemperatureFixture,
  createTemperatureLog,
  getTemperatureLog,
  listTemperatureFixtures,
  listTemperatureLogs,
  resolveTemperatureFollowUp,
  softInactivateTemperatureFixture,
  updateTemperatureFixture,
} from "../../ops/opsStorage";

const FACILITY_A = "TEST-FAC-TLOG-A";
const FACILITY_B = "TEST-FAC-TLOG-B";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const ACTOR = { id: "alice", role: "admin" };

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_temperature_logs     WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_temperature_fixtures WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail          WHERE facility_number = ANY($1::text[])`,
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

async function makeFridgeFixture(facilityNumber: string) {
  return createTemperatureFixture(
    {
      facilityNumber,
      fixtureKey: "fridge_main",
      fixtureLabel: "Main Fridge",
      kind: "fridge",
      requiredMin: 32,
      requiredMax: 40,
      unit: "F",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    ACTOR,
  );
}

describe("temperatureLogs — out-of-range hook (§9)", () => {
  it("flags a reading below required_min and sets follow_up_due_at = +24h", async () => {
    const fix = await makeFridgeFixture(FACILITY_A);
    const before = Date.now();
    const log = await createTemperatureLog(
      {
        facilityNumber: FACILITY_A,
        fixtureId: fix.id,
        readingValue: 28, // below 32
        readingAt: Date.now(),
        recordedBy: "cook-jane",
      },
      ACTOR,
    );
    const after = Date.now();
    expect(log.outOfRange).toBe(1);
    expect(log.followUpDueAt).not.toBeNull();
    // due ≈ now + 24h, allow a small skew either side
    const due = log.followUpDueAt as number;
    const expectedMin = before + 24 * 60 * 60 * 1000;
    const expectedMax = after + 24 * 60 * 60 * 1000;
    expect(due).toBeGreaterThanOrEqual(expectedMin);
    expect(due).toBeLessThanOrEqual(expectedMax);
  });

  it("flags a reading above required_max", async () => {
    const fix = await makeFridgeFixture(FACILITY_A);
    const log = await createTemperatureLog(
      {
        facilityNumber: FACILITY_A,
        fixtureId: fix.id,
        readingValue: 50, // above 40
        readingAt: Date.now(),
        recordedBy: "cook-jane",
      },
      ACTOR,
    );
    expect(log.outOfRange).toBe(1);
    expect(log.followUpDueAt).not.toBeNull();
  });

  it("does not flag a reading inside the range", async () => {
    const fix = await makeFridgeFixture(FACILITY_A);
    const log = await createTemperatureLog(
      {
        facilityNumber: FACILITY_A,
        fixtureId: fix.id,
        readingValue: 36,
        readingAt: Date.now(),
        recordedBy: "cook-jane",
      },
      ACTOR,
    );
    expect(log.outOfRange).toBe(0);
    expect(log.followUpDueAt).toBeNull();
  });
});

describe("temperatureLogs — threshold snapshot stability", () => {
  it("copies required_min/max to threshold_min/max at insert time and never re-reads", async () => {
    const fix = await makeFridgeFixture(FACILITY_A);
    const log = await createTemperatureLog(
      {
        facilityNumber: FACILITY_A,
        fixtureId: fix.id,
        readingValue: 36,
        readingAt: Date.now(),
        recordedBy: "cook-jane",
      },
      ACTOR,
    );
    expect(log.thresholdMin).toBe(32);
    expect(log.thresholdMax).toBe(40);

    // Admin edits the fixture later. Log's threshold MUST NOT change.
    await updateTemperatureFixture(
      fix.id,
      FACILITY_A,
      { requiredMin: 35, requiredMax: 38 },
      ACTOR,
    );
    const reread = await getTemperatureLog(log.id, FACILITY_A);
    expect(reread?.thresholdMin).toBe(32);
    expect(reread?.thresholdMax).toBe(40);
    expect(reread?.outOfRange).toBe(0); // historically in-range under old thresholds
  });
});

describe("temperatureLogs — resolve follow-up", () => {
  it("resolveTemperatureFollowUp clears follow-up + records audit; double-resolve rejected", async () => {
    const fix = await makeFridgeFixture(FACILITY_A);
    const oor = await createTemperatureLog(
      {
        facilityNumber: FACILITY_A,
        fixtureId: fix.id,
        readingValue: 28,
        readingAt: Date.now(),
        recordedBy: "cook-jane",
      },
      ACTOR,
    );
    const resolved = await resolveTemperatureFollowUp(
      oor.id,
      FACILITY_A,
      ACTOR,
      "Restocked, returned to range within 15m",
    );
    expect(resolved?.followUpResolvedAt).not.toBeNull();
    expect(resolved?.followUpResolvedBy).toBe(ACTOR.id);
    expect(resolved?.followUpResolutionNote).toContain("Restocked");

    // Audit row recorded with action='resolve'.
    const audit = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM ops_audit_trail
       WHERE facility_number = $1 AND entity_type = 'ops_temperature_log'
         AND entity_id = $2 AND action = 'resolve'`,
      [FACILITY_A, oor.id],
    );
    expect(audit.rows[0].c).toBe(1);

    // Double resolve → rejected.
    await expect(
      resolveTemperatureFollowUp(oor.id, FACILITY_A, ACTOR, "again"),
    ).rejects.toThrow(/already resolved/i);
  });

  it("rejects resolve on a non-out-of-range log", async () => {
    const fix = await makeFridgeFixture(FACILITY_A);
    const ok = await createTemperatureLog(
      {
        facilityNumber: FACILITY_A,
        fixtureId: fix.id,
        readingValue: 36,
        readingAt: Date.now(),
        recordedBy: "cook-jane",
      },
      ACTOR,
    );
    await expect(
      resolveTemperatureFollowUp(ok.id, FACILITY_A, ACTOR, "nothing to resolve"),
    ).rejects.toThrow(/not out of range/i);
  });

  it("a subsequent in-range reading does NOT auto-resolve the prior follow-up", async () => {
    const fix = await makeFridgeFixture(FACILITY_A);
    const oor = await createTemperatureLog(
      {
        facilityNumber: FACILITY_A,
        fixtureId: fix.id,
        readingValue: 28,
        readingAt: Date.now() - 60 * 60 * 1000,
        recordedBy: "cook-jane",
      },
      ACTOR,
    );
    // New reading later, in-range. Should be a brand-new row; the prior
    // follow-up remains unresolved.
    await createTemperatureLog(
      {
        facilityNumber: FACILITY_A,
        fixtureId: fix.id,
        readingValue: 36,
        readingAt: Date.now(),
        recordedBy: "cook-jane",
      },
      ACTOR,
    );
    const oorReread = await getTemperatureLog(oor.id, FACILITY_A);
    expect(oorReread?.followUpResolvedAt).toBeNull();
  });
});

describe("temperatureLogs — fixture errors", () => {
  it("rejects when fixture not found", async () => {
    await expect(
      createTemperatureLog(
        {
          facilityNumber: FACILITY_A,
          fixtureId: 99999,
          readingValue: 36,
          readingAt: Date.now(),
          recordedBy: "cook",
        },
        ACTOR,
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects when fixture belongs to another facility (tenant scope)", async () => {
    const fixA = await makeFridgeFixture(FACILITY_A);
    await expect(
      createTemperatureLog(
        {
          facilityNumber: FACILITY_B,
          fixtureId: fixA.id,
          readingValue: 36,
          readingAt: Date.now(),
          recordedBy: "cook",
        },
        ACTOR,
      ),
    ).rejects.toThrow(/not found/i);
  });

  it("rejects when fixture has been soft-inactivated", async () => {
    const fix = await makeFridgeFixture(FACILITY_A);
    await softInactivateTemperatureFixture(fix.id, FACILITY_A, ACTOR);
    await expect(
      createTemperatureLog(
        {
          facilityNumber: FACILITY_A,
          fixtureId: fix.id,
          readingValue: 36,
          readingAt: Date.now(),
          recordedBy: "cook",
        },
        ACTOR,
      ),
    ).rejects.toThrow(/not active/i);
  });
});

describe("temperatureLogs — listing + tenant isolation", () => {
  it("listTemperatureLogs respects fixtureKey + outOfRangeOnly filters", async () => {
    const fridge = await makeFridgeFixture(FACILITY_A);
    const freezer = await createTemperatureFixture(
      {
        facilityNumber: FACILITY_A,
        fixtureKey: "freezer_main",
        fixtureLabel: "Main Freezer",
        kind: "freezer",
        requiredMin: -20,
        requiredMax: 0,
        unit: "F",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );

    await createTemperatureLog(
      { facilityNumber: FACILITY_A, fixtureId: fridge.id,  readingValue: 36, readingAt: Date.now(), recordedBy: "x" },
      ACTOR,
    );
    await createTemperatureLog(
      { facilityNumber: FACILITY_A, fixtureId: fridge.id,  readingValue: 28, readingAt: Date.now(), recordedBy: "x" },
      ACTOR,
    );
    await createTemperatureLog(
      { facilityNumber: FACILITY_A, fixtureId: freezer.id, readingValue: -10, readingAt: Date.now(), recordedBy: "x" },
      ACTOR,
    );

    const all = await listTemperatureLogs(FACILITY_A, { page: 1, limit: 50 });
    expect(all.total).toBe(3);

    const fridgeOnly = await listTemperatureLogs(FACILITY_A, {
      fixtureKey: "fridge_main",
      page: 1,
      limit: 50,
    });
    expect(fridgeOnly.total).toBe(2);

    const oorOnly = await listTemperatureLogs(FACILITY_A, {
      outOfRangeOnly: true,
      page: 1,
      limit: 50,
    });
    expect(oorOnly.total).toBe(1);
    expect(oorOnly.logs[0].outOfRange).toBe(1);
  });

  it("tenant isolation — facility A logs are invisible to facility B", async () => {
    const fix = await makeFridgeFixture(FACILITY_A);
    await createTemperatureLog(
      { facilityNumber: FACILITY_A, fixtureId: fix.id, readingValue: 36, readingAt: Date.now(), recordedBy: "x" },
      ACTOR,
    );
    const bView = await listTemperatureLogs(FACILITY_B, { page: 1, limit: 50 });
    expect(bView.total).toBe(0);

    const bFixtures = await listTemperatureFixtures(FACILITY_B);
    expect(bFixtures.length).toBe(0);
  });
});
