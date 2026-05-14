/**
 * Wave 3 W1 — Triage aggregator tests.
 *
 * Coverage:
 *  - Empty facility → every counts entry is 0; items is empty.
 *  - Single overdue obligation → counts.overdue_obligations === 1, item
 *    surfaced with severity from the obligation row.
 *  - One expired + one expiring credential → both surface, severities
 *    diverge ("high" vs "medium").
 *  - Aggregator resilience: mock one source storage function to throw.
 *    Its section falls back to 0 + empty; the other sections still
 *    populate correctly.
 *  - Tenant isolation: facility A's data does not leak into B's aggregate.
 *
 * Test harness conventions reused from server/__tests__/ops/obligations.test.ts.
 */

import "dotenv/config";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { bootstrapOpsSchema } from "../../ops/opsStorage";
import { createObligation } from "../../ops/obligationsStorage";
import { aggregateTriage } from "../../ops/triageAggregator";

const FACILITY_A = "TEST-FAC-TRIAGE-A";
const FACILITY_B = "TEST-FAC-TRIAGE-B";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const ACTOR = { id: "alice", role: "admin" };
const DAY = 24 * 60 * 60 * 1000;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_obligations         WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_staff_credentials   WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_staff               WHERE facility_number = ANY($1::text[])`,
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
  vi.restoreAllMocks();
});

async function seedStaff(facilityNumber: string): Promise<number> {
  const now = Date.now();
  const r = await pool.query<{ id: number }>(
    `INSERT INTO ops_staff
       (facility_number, first_name, last_name, role, status, created_at, updated_at)
     VALUES ($1, 'Jane', 'Doe', 'caregiver', 'active', $2, $2) RETURNING id`,
    [facilityNumber, now],
  );
  return Number(r.rows[0].id);
}

async function seedCredential(
  facilityNumber: string,
  staffId: number,
  expiresAt: number,
): Promise<void> {
  const now = Date.now();
  await pool.query(
    `INSERT INTO ops_staff_credentials
       (facility_number, staff_id, credential_type, issued_at, expires_at,
        verified_at, verified_by, status, note, created_by, created_at, updated_at, deleted_at)
     VALUES ($1, $2, 'cpr', NULL, $3, NULL, NULL, 'active', NULL, $4, $5, $5, NULL)`,
    [facilityNumber, staffId, expiresAt, ACTOR.id, now],
  );
}

async function seedOverdueObligation(
  facilityNumber: string,
  overrides: Partial<{ severity: string; title: string; dueAt: number }> = {},
): Promise<void> {
  const now = Date.now();
  await createObligation(
    {
      facilityNumber,
      obligationType: "license_renewal",
      targetType: "facility",
      targetId: null,
      title: overrides.title ?? "Renew facility license",
      description: null,
      dueAt: overrides.dueAt ?? now - 5 * DAY,
      completedAt: null,
      completedBy: null,
      assignedTo: null,
      severity: overrides.severity ?? "high",
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

describe("triageAggregator — empty facility", () => {
  it("returns zero counts for the storage-driven sections", async () => {
    const payload = await aggregateTriage(FACILITY_A);
    expect(payload.facilityNumber).toBe(FACILITY_A);
    // Note: drills_quarter_deficit derives from a reg-setting target × shifts
    // vs. logged fire drills this quarter — an empty facility shows the
    // deficit as 1 item, which is correct behavior. We assert on the
    // other storage-driven sections being empty here.
    const storageDrivenSections = [
      "overdue_obligations",
      "incidents_past_sla",
      "credentials_expired",
      "credentials_expiring",
      "temperature_out_of_range_open",
      "vendors_expired",
      "vendors_expiring",
      "complaints_open",
      "charts_incomplete",
      "controlled_sub_discrepancies_aging",
    ] as const;
    for (const s of storageDrivenSections) {
      expect(payload.counts[s], `section ${s}`).toBe(0);
    }
  });
});

describe("triageAggregator — overdue obligations", () => {
  it("surfaces a single overdue obligation with the row's severity", async () => {
    await seedOverdueObligation(FACILITY_A, { severity: "high" });
    const payload = await aggregateTriage(FACILITY_A);
    expect(payload.counts.overdue_obligations).toBe(1);
    const item = payload.items.find((i) => i.section === "overdue_obligations");
    expect(item).toBeDefined();
    expect(item!.severity).toBe("high");
    expect(item!.subject).toMatch(/license/i);
  });

  it("coerces unknown severity strings to medium", async () => {
    await seedOverdueObligation(FACILITY_A, { severity: "wat" });
    const payload = await aggregateTriage(FACILITY_A);
    const item = payload.items.find((i) => i.section === "overdue_obligations");
    expect(item?.severity).toBe("medium");
  });
});

describe("triageAggregator — credentials expired + expiring", () => {
  it("partitions expired vs expiring with diverging severities", async () => {
    const now = Date.now();
    const staffId = await seedStaff(FACILITY_A);
    await seedCredential(FACILITY_A, staffId, now - 3 * DAY);    // expired
    await seedCredential(FACILITY_A, staffId, now + 10 * DAY);   // expiring (within default 60d)
    const payload = await aggregateTriage(FACILITY_A, { now });
    expect(payload.counts.credentials_expired).toBe(1);
    expect(payload.counts.credentials_expiring).toBe(1);
    const expired = payload.items.find((i) => i.section === "credentials_expired");
    const expiring = payload.items.find((i) => i.section === "credentials_expiring");
    expect(expired?.severity).toBe("high");
    expect(expiring?.severity).toBe("medium");
    // Expiring items report a negative ageDays (days_until).
    expect(typeof expiring?.ageDays).toBe("number");
    expect(expiring!.ageDays!).toBeLessThanOrEqual(0);
  });
});

describe("triageAggregator — resilience to per-section failures", () => {
  it("blanks a failing section but keeps the others populated", async () => {
    await seedOverdueObligation(FACILITY_A, { severity: "high" });
    // Force the incidents-past-SLA section to throw — chartCompleteness
    // is the easiest to stub since it imports a regSetting. Instead, we
    // mock `listIncidentsPastSla` from opsStorage so the section fails.
    const opsStorage = await import("../../ops/opsStorage");
    const spy = vi
      .spyOn(opsStorage, "listIncidentsPastSla")
      .mockImplementation(async () => {
        throw new Error("simulated downstream failure");
      });
    const payload = await aggregateTriage(FACILITY_A);
    expect(payload.counts.incidents_past_sla).toBe(0);
    // Other sections still populated.
    expect(payload.counts.overdue_obligations).toBe(1);
    spy.mockRestore();
  });
});

describe("triageAggregator — tenant isolation", () => {
  it("facility A's data does not leak into facility B's aggregate", async () => {
    await seedOverdueObligation(FACILITY_A, { severity: "high" });
    const payloadA = await aggregateTriage(FACILITY_A);
    const payloadB = await aggregateTriage(FACILITY_B);
    expect(payloadA.counts.overdue_obligations).toBe(1);
    expect(payloadB.counts.overdue_obligations).toBe(0);
    // B's overdue-obligation items should be empty (the drills deficit
    // section may still surface a single facility-level item).
    const bOverdueItems = payloadB.items.filter(
      (i) => i.section === "overdue_obligations",
    );
    expect(bOverdueItems.length).toBe(0);
  });
});

describe("triageAggregator — per-section limit + counts", () => {
  it("counts reflect un-sliced totals; items respect perSectionLimit", async () => {
    // Seed 15 overdue obligations so we can slice.
    for (let i = 0; i < 15; i += 1) {
      await seedOverdueObligation(FACILITY_A, {
        severity: "medium",
        title: `Obligation #${i}`,
      });
    }
    const payload = await aggregateTriage(FACILITY_A, { perSectionLimit: 5 });
    expect(payload.counts.overdue_obligations).toBe(15);
    const inItems = payload.items.filter(
      (i) => i.section === "overdue_obligations",
    );
    expect(inItems.length).toBe(5);
  });
});
