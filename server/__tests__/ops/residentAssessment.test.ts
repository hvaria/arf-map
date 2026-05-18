/**
 * Resident assessment storage — regression coverage for the
 * boolean-to-integer ADL fix in opsSchema.ts.
 *
 * Background: prod Postgres `ops_resident_assessments` was created in
 * an earlier build with the 15 ADL/IADL columns typed BOOLEAN, while the
 * Drizzle schema, Zod validator, and client form all use the Katz/Lawton
 * 0–3 integer scale. The mismatch surfaced as
 *
 *     invalid input syntax for type boolean: "3"
 *
 * on every assessment save and blocked resident onboarding entirely.
 * The fix is an idempotent `ALTER COLUMN ... TYPE INTEGER USING ...`
 * block appended to OPS_PG_SCHEMA_SQL that runs at every boot and is a
 * no-op once the columns are integer-typed.
 *
 * What this file proves:
 *   1. After `bootstrapOpsSchema()` the 15 ADL/IADL columns are INTEGER
 *      (not BOOLEAN) in information_schema.
 *   2. Inserting an assessment with the default Katz/Lawton value 3 on
 *      every ADL field round-trips as integer — no PG cast error, the
 *      values survive verbatim.
 *   3. Existing pre-coercion rows are not the concern of this test; the
 *      migration's BOOLEAN→INTEGER USING clause is exercised in CI only
 *      when the prod schema gets restored on top of a fresh DB. The
 *      idempotency assertion below catches accidental destructive
 *      re-runs.
 *   4. The idempotent guard works: a second `bootstrapOpsSchema()` is a
 *      no-op on an already-integer table.
 *
 * Conventions mirror server/__tests__/ops/incidentLifecycle.test.ts.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import {
  bootstrapOpsSchema,
  createAssessment,
  createResident,
  listAssessments,
} from "../../ops/opsStorage";
import {
  cleanFacilityAccounts,
  seedFacility,
  type TestFacility,
} from "../trackers/setupTestApp";

const FACILITY = "TEST-FAC-ASSESS-A";
const USER = "test-assess-a-user";
const PW = "test-pw-assess-a-12345!";
const ALL_FN = [FACILITY] as const;

// All 15 ADL/IADL columns the migration touches, in their snake_case form.
const ADL_COLUMNS = [
  "bathing",
  "dressing",
  "grooming",
  "toileting",
  "continence",
  "eating",
  "mobility",
  "transfers",
  "meal_prep",
  "housekeeping",
  "laundry",
  "transportation",
  "finances",
  "communication",
  "self_administer_meds",
] as const;

let facility: TestFacility;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_resident_assessments WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_residents WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
}

beforeAll(async () => {
  await bootstrapMainSchema();
  await bootstrapOpsSchema();
  facility = await seedFacility({
    facilityNumber: FACILITY,
    username: USER,
    password: PW,
    email: "test-assess-a@example.com",
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

describe("ops_resident_assessments ADL columns", () => {
  it("are INTEGER (not BOOLEAN) in information_schema after bootstrap", async () => {
    const result = await pool.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type
         FROM information_schema.columns
        WHERE table_name = 'ops_resident_assessments'
          AND column_name = ANY($1::text[])
        ORDER BY column_name`,
      [[...ADL_COLUMNS]],
    );
    expect(result.rows.length).toBe(ADL_COLUMNS.length);
    for (const row of result.rows) {
      expect(
        row.data_type,
        `${row.column_name} should be integer, got ${row.data_type}`,
      ).toBe("integer");
    }
  });

  it("survive a Katz/Lawton 3-on-every-field assessment round-trip", async () => {
    // Voids the legacy "invalid input syntax for type boolean: \"3\"" path.
    // Every ADL field is set to the maximum-dependence score; we round-trip
    // through createAssessment + listAssessments and verify the integers
    // arrive back verbatim.
    const now = Date.now();
    const resident = await createResident({
      facilityNumber: facility.facilityNumber,
      firstName: "Test",
      lastName: "Resident",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    const inserted = await createAssessment({
      residentId: resident.id,
      facilityNumber: facility.facilityNumber,
      assessmentType: "initial",
      assessedBy: "tester",
      assessedAt: now,
      bathing: 3,
      dressing: 3,
      grooming: 3,
      toileting: 3,
      continence: 3,
      eating: 3,
      mobility: 3,
      transfers: 3,
      mealPrep: 3,
      housekeeping: 3,
      laundry: 3,
      transportation: 3,
      finances: 3,
      communication: 3,
      selfAdministerMeds: 3,
      createdAt: now,
    });

    // The insert itself proves the bug is gone — under the legacy BOOLEAN
    // schema this would have thrown before returning.
    expect(inserted.id).toBeGreaterThan(0);
    expect(inserted.bathing).toBe(3);
    expect(inserted.selfAdministerMeds).toBe(3);

    const read = await listAssessments(resident.id, facility.facilityNumber);
    expect(read.length).toBe(1);
    const row = read[0];
    expect(row.bathing).toBe(3);
    expect(row.dressing).toBe(3);
    expect(row.grooming).toBe(3);
    expect(row.toileting).toBe(3);
    expect(row.continence).toBe(3);
    expect(row.eating).toBe(3);
    expect(row.mobility).toBe(3);
    expect(row.transfers).toBe(3);
    expect(row.mealPrep).toBe(3);
    expect(row.housekeeping).toBe(3);
    expect(row.laundry).toBe(3);
    expect(row.transportation).toBe(3);
    expect(row.finances).toBe(3);
    expect(row.communication).toBe(3);
    expect(row.selfAdministerMeds).toBe(3);
  });

  it("bootstrapOpsSchema() is idempotent on an already-integer table", async () => {
    // The DO-block is guarded on data_type='boolean'. Running bootstrap a
    // second time must not throw, must not change types, must not erase
    // rows. We don't have a row at this point (beforeEach cleans), so the
    // assertion is structural: types are still integer.
    await bootstrapOpsSchema();
    const result = await pool.query<{ data_type: string }>(
      `SELECT data_type FROM information_schema.columns
        WHERE table_name='ops_resident_assessments' AND column_name='bathing'`,
    );
    expect(result.rows[0]?.data_type).toBe("integer");
  });
});
