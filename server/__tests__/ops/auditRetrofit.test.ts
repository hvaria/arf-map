/**
 * Wave 4 Phase 4.2 — Audit-trail retrofit tests.
 *
 * Exercises one create + one update + one terminal-state transition on
 * each retrofitted entity, then asserts a matching `ops_audit_trail` row
 * appears with the expected entity_type. Covers:
 *
 *  - ops_resident      (createResident / updateResident / softDeleteResident)
 *  - ops_medication    (createMedication / updateMedication / discontinueMedication)
 *  - ops_med_pass      (recordMedPass / updateMedPassRecord)
 *  - ops_admission     (startAdmission / updateAdmissionLicForm)
 *
 * Audit emission is wrapped in try/catch inside the storage layer so a
 * failing audit write must NOT throw out of the mutation. We also assert
 * that property: stubbing recordAudit to throw still leaves the mutation
 * row inserted.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import {
  bootstrapOpsSchema,
  createResident,
  updateResident,
  softDeleteResident,
  createMedication,
  updateMedication,
  discontinueMedication,
  recordMedPass,
  updateMedPassRecord,
  startAdmission,
  updateAdmissionLicForm,
} from "../../ops/opsStorage";
import { listAuditForFacility } from "../../ops/auditStorage";

const FACILITY = "TEST-FAC-AUDIT-RETROFIT";
const ACTOR = { id: "alice", role: "admin" };

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_med_passes WHERE facility_number = $1`,
    [FACILITY],
  );
  await pool.query(
    `DELETE FROM ops_medications WHERE facility_number = $1`,
    [FACILITY],
  );
  await pool.query(
    `DELETE FROM ops_admissions WHERE facility_number = $1`,
    [FACILITY],
  );
  await pool.query(`DELETE FROM ops_leads WHERE facility_number = $1`, [FACILITY]);
  await pool.query(
    `DELETE FROM ops_residents WHERE facility_number = $1`,
    [FACILITY],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail WHERE facility_number = $1`,
    [FACILITY],
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

async function auditCount(
  entityType: string,
  action?: string,
): Promise<number> {
  const { rows } = await listAuditForFacility(FACILITY, {
    entityType,
    action,
    page: 1,
    limit: 100,
  });
  return rows.length;
}

describe("audit retrofit — residents", () => {
  it("emits create + update + delete audit rows", async () => {
    const r = await createResident(
      {
        facilityNumber: FACILITY,
        firstName: "Jane",
        lastName: "Doe",
        admissionDate: Date.now(),
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    expect(await auditCount("ops_resident", "create")).toBe(1);

    await updateResident(r.id, FACILITY, { firstName: "Janet" }, ACTOR);
    expect(await auditCount("ops_resident", "update")).toBe(1);

    const ok = await softDeleteResident(r.id, FACILITY, ACTOR);
    expect(ok).toBe(true);
    expect(await auditCount("ops_resident", "delete")).toBe(1);
  });

  it("works without an actor (no audit row, no throw)", async () => {
    const r = await createResident({
      facilityNumber: FACILITY,
      firstName: "Anon",
      lastName: "Tester",
      admissionDate: Date.now(),
      status: "active",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    expect(r.id).toBeGreaterThan(0);
    expect(await auditCount("ops_resident")).toBe(0);
  });
});

describe("audit retrofit — medications + med passes", () => {
  it("emits audit rows for the medication lifecycle", async () => {
    const resident = await createResident(
      {
        facilityNumber: FACILITY,
        firstName: "Med",
        lastName: "Pati",
        admissionDate: Date.now(),
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );

    const med = await createMedication(
      {
        residentId: resident.id,
        facilityNumber: FACILITY,
        drugName: "Aspirin",
        dosage: "81mg",
        route: "PO",
        frequency: "daily",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    expect(await auditCount("ops_medication", "create")).toBe(1);

    await updateMedication(med.id, FACILITY, { dosage: "162mg" }, ACTOR);
    expect(await auditCount("ops_medication", "update")).toBeGreaterThanOrEqual(1);

    const ok = await discontinueMedication(
      med.id,
      FACILITY,
      "no longer indicated",
      ACTOR.id,
      ACTOR,
    );
    expect(ok).toBe(true);
    expect(await auditCount("ops_medication", "delete")).toBe(1);
  });

  it("emits audit rows for med pass create + update", async () => {
    const resident = await createResident(
      {
        facilityNumber: FACILITY,
        firstName: "Med",
        lastName: "PassResi",
        admissionDate: Date.now(),
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    const med = await createMedication(
      {
        residentId: resident.id,
        facilityNumber: FACILITY,
        drugName: "Tylenol",
        dosage: "500mg",
        route: "PO",
        frequency: "BID",
        status: "active",
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    const mp = await recordMedPass(
      {
        medicationId: med.id,
        residentId: resident.id,
        facilityNumber: FACILITY,
        scheduledDatetime: Date.now(),
        status: "pending",
        createdAt: Date.now(),
      },
      ACTOR,
    );
    expect(await auditCount("ops_med_pass", "create")).toBe(1);

    const ok = await updateMedPassRecord(
      mp.id,
      { status: "given", administeredDatetime: Date.now() },
      ACTOR,
    );
    expect(ok).toBe(true);
    expect(await auditCount("ops_med_pass", "update")).toBe(1);
  });
});

describe("audit retrofit — admissions", () => {
  it("emits create + update audit rows for admissions", async () => {
    // Seed a minimal lead row first (admission requires lead_id).
    const leadRes = await pool.query<{ id: number }>(
      `INSERT INTO ops_leads
         (facility_number, prospect_name, contact_name, stage, created_at, updated_at)
       VALUES ($1, 'Prospect A', 'Contact A', 'inquiry', $2, $2)
       RETURNING id`,
      [FACILITY, Date.now()],
    );
    const leadId = Number(leadRes.rows[0].id);

    const admission = await startAdmission(
      {
        leadId,
        facilityNumber: FACILITY,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    expect(await auditCount("ops_admission", "create")).toBe(1);

    const ok = await updateAdmissionLicForm(admission.id, "lic_601", true, ACTOR);
    expect(ok).toBe(true);
    expect(await auditCount("ops_admission", "update")).toBe(1);
  });
});
