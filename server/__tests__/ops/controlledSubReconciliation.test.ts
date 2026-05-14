/**
 * W11 Controlled-sub reconciliation — server storage tests.
 *
 * Coverage:
 *  - listControlledSubDiscrepancies filters by resolved flag.
 *  - Only rows with discrepancy != 0 are returned.
 *  - resolveControlledSubDiscrepancy appends a [resolved by … on … witnessed
 *    by …]: <note> trailer to discrepancy_notes; records audit; flips resolved=1.
 *  - Double-resolve rejected.
 *  - Tenant isolation: facility A's discrepancies invisible to facility B.
 *  - listRecentDestructions returns drugName via the medication join.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import {
  bootstrapOpsSchema,
  listControlledSubDiscrepancies,
  listRecentDestructions,
  resolveControlledSubDiscrepancy,
} from "../../ops/opsStorage";

const FACILITY_A = "TEST-FAC-CSC-A";
const FACILITY_B = "TEST-FAC-CSC-B";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const ACTOR = { id: "alice", role: "admin" };

async function cleanup(): Promise<void> {
  // Order matters — counts FK conceptually to medications, medications FK to
  // residents. Use ANY arrays so we can wipe both facilities at once.
  await pool.query(
    `DELETE FROM ops_med_destruction      WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_controlled_sub_counts WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_medications          WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_residents            WHERE facility_number = ANY($1::text[])`,
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

async function seedResident(facilityNumber: string, firstName: string, lastName: string) {
  const now = Date.now();
  const r = await pool.query<{ id: number }>(
    `INSERT INTO ops_residents (facility_number, first_name, last_name, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'active', $4, $4)
     RETURNING id`,
    [facilityNumber, firstName, lastName, now],
  );
  return Number(r.rows[0].id);
}

async function seedControlledMed(
  facilityNumber: string,
  residentId: number,
  drugName: string,
) {
  const now = Date.now();
  const r = await pool.query<{ id: number }>(
    `INSERT INTO ops_medications
       (resident_id, facility_number, drug_name, dosage, route, frequency,
        is_controlled, status, created_at, updated_at)
     VALUES ($1, $2, $3, '10 mg', 'PO', 'Daily', 1, 'active', $4, $4)
     RETURNING id`,
    [residentId, facilityNumber, drugName, now],
  );
  return Number(r.rows[0].id);
}

async function seedCount(
  facilityNumber: string,
  medicationId: number,
  opts: { discrepancy: number; resolved?: 0 | 1; notes?: string | null },
) {
  const now = Date.now();
  const r = await pool.query<{ id: number }>(
    `INSERT INTO ops_controlled_sub_counts
       (medication_id, facility_number, count_date, shift, counted_by,
        witnessed_by, opening_count, closing_count, administered_count,
        wasted_count, discrepancy, discrepancy_notes, resolved, created_at)
     VALUES ($1, $2, $3, 'PM', 'nurse-a', 'nurse-b', 10, 8, 1, 0, $4, $5, $6, $3)
     RETURNING id`,
    [medicationId, facilityNumber, now, opts.discrepancy, opts.notes ?? null, opts.resolved ?? 0],
  );
  return Number(r.rows[0].id);
}

describe("controlled-sub — list filters", () => {
  it("returns only rows with non-zero discrepancy", async () => {
    const rid = await seedResident(FACILITY_A, "Margaret", "Chen");
    const mid = await seedControlledMed(FACILITY_A, rid, "Lorazepam");
    await seedCount(FACILITY_A, mid, { discrepancy: 0 });   // clean count
    await seedCount(FACILITY_A, mid, { discrepancy: -1 });  // discrepancy

    const r = await listControlledSubDiscrepancies(FACILITY_A, { page: 1, limit: 50 });
    expect(r.total).toBe(1);
    expect(r.rows[0].drugName).toBe("Lorazepam");
    expect(r.rows[0].residentFirstName).toBe("Margaret");
  });

  it("filters by resolved=true vs resolved=false", async () => {
    const rid = await seedResident(FACILITY_A, "R", "Hayes");
    const mid = await seedControlledMed(FACILITY_A, rid, "Tramadol");
    await seedCount(FACILITY_A, mid, { discrepancy: -1, resolved: 0 });
    await seedCount(FACILITY_A, mid, { discrepancy: -2, resolved: 1 });

    const unresolved = await listControlledSubDiscrepancies(FACILITY_A, {
      resolved: false,
      page: 1,
      limit: 50,
    });
    expect(unresolved.total).toBe(1);
    expect(unresolved.rows[0].resolved).toBe(0);

    const resolved = await listControlledSubDiscrepancies(FACILITY_A, {
      resolved: true,
      page: 1,
      limit: 50,
    });
    expect(resolved.total).toBe(1);
    expect(resolved.rows[0].resolved).toBe(1);
  });

  it("ageMs is computed from countDate", async () => {
    const rid = await seedResident(FACILITY_A, "X", "Y");
    const mid = await seedControlledMed(FACILITY_A, rid, "Drug");
    await seedCount(FACILITY_A, mid, { discrepancy: -1 });
    const r = await listControlledSubDiscrepancies(FACILITY_A, { page: 1, limit: 50 });
    expect(r.rows[0].ageMs).toBeGreaterThanOrEqual(0);
  });
});

describe("controlled-sub — resolve", () => {
  it("flips resolved=1, appends trailer to discrepancy_notes, records audit", async () => {
    const rid = await seedResident(FACILITY_A, "M", "C");
    const mid = await seedControlledMed(FACILITY_A, rid, "Lorazepam");
    const cid = await seedCount(FACILITY_A, mid, {
      discrepancy: -1,
      notes: "Intake: missing 1 from PM pack",
    });
    const row = await resolveControlledSubDiscrepancy(
      cid,
      FACILITY_A,
      ACTOR,
      { note: "Found in resident drawer, returned to count", witnessedBy: "nurse-c" },
    );
    expect(row?.resolved).toBe(1);
    expect(row?.discrepancyNotes).toContain("Intake: missing 1 from PM pack");
    expect(row?.discrepancyNotes).toContain("[resolved by alice on");
    expect(row?.discrepancyNotes).toContain("witnessed by nurse-c");
    expect(row?.discrepancyNotes).toContain("Found in resident drawer");

    const audit = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM ops_audit_trail
       WHERE facility_number = $1 AND entity_type = 'ops_controlled_sub_count'
         AND entity_id = $2 AND action = 'resolve'`,
      [FACILITY_A, cid],
    );
    expect(audit.rows[0].c).toBe(1);
  });

  it("rejects double-resolve", async () => {
    const rid = await seedResident(FACILITY_A, "M", "C");
    const mid = await seedControlledMed(FACILITY_A, rid, "Drug");
    const cid = await seedCount(FACILITY_A, mid, { discrepancy: -1 });
    await resolveControlledSubDiscrepancy(cid, FACILITY_A, ACTOR, {
      note: "Done",
      witnessedBy: "x",
    });
    await expect(
      resolveControlledSubDiscrepancy(cid, FACILITY_A, ACTOR, {
        note: "again",
        witnessedBy: "x",
      }),
    ).rejects.toThrow(/already resolved/i);
  });

  it("returns undefined for unknown / cross-tenant count id", async () => {
    const wrong = await resolveControlledSubDiscrepancy(99999, FACILITY_A, ACTOR, {
      note: "x",
      witnessedBy: "y",
    });
    expect(wrong).toBeUndefined();
  });
});

describe("controlled-sub — tenant isolation", () => {
  it("facility A discrepancies invisible from facility B", async () => {
    const rid = await seedResident(FACILITY_A, "M", "C");
    const mid = await seedControlledMed(FACILITY_A, rid, "Lorazepam");
    await seedCount(FACILITY_A, mid, { discrepancy: -1 });
    const b = await listControlledSubDiscrepancies(FACILITY_B, { page: 1, limit: 50 });
    expect(b.total).toBe(0);
  });
});

describe("controlled-sub — recent destructions accordion (§6.B.1)", () => {
  it("returns destroyed meds joined with drug_name, newest first", async () => {
    const rid = await seedResident(FACILITY_A, "M", "C");
    const mid = await seedControlledMed(FACILITY_A, rid, "Lorazepam");
    const now = Date.now();
    await pool.query(
      `INSERT INTO ops_med_destruction
         (medication_id, facility_number, quantity, unit, destruction_method,
          destroyed_by, witnessed_by, destruction_date, reason, created_at)
       VALUES ($1, $2, 3, 'tab', 'reverse-distributor', 'alice', 'bob', $3, 'expired', $3)`,
      [mid, FACILITY_A, now],
    );
    const recent = await listRecentDestructions(FACILITY_A, { limit: 10 });
    expect(recent.length).toBe(1);
    expect(recent[0].drugName).toBe("Lorazepam");
    expect(recent[0].quantity).toBe(3);
  });

  it("tenant scoped — destruction in facility A invisible to facility B", async () => {
    const rid = await seedResident(FACILITY_A, "M", "C");
    const mid = await seedControlledMed(FACILITY_A, rid, "Lorazepam");
    const now = Date.now();
    await pool.query(
      `INSERT INTO ops_med_destruction
         (medication_id, facility_number, quantity, unit, destruction_method,
          destroyed_by, witnessed_by, destruction_date, reason, created_at)
       VALUES ($1, $2, 3, 'tab', 'm', 'a', 'b', $3, 'r', $3)`,
      [mid, FACILITY_A, now],
    );
    const b = await listRecentDestructions(FACILITY_B);
    expect(b.length).toBe(0);
  });
});
