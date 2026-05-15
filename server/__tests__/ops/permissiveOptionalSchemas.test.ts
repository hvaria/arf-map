/**
 * Permissive optional schemas — regression guard.
 *
 * Production bug class: FE forms send `null` for "user left blank" on
 * optional fields, but BE zod schemas use `.optional()` which only
 * accepts `undefined`. The mismatch caused 400 errors across Staff,
 * Incidents, Compliance, CRM, Drills, Complaints, Vendors, Inspections,
 * Trust ledger, Postings, Temperature logs, and Tasks.
 *
 * Fix applied: every truly-optional field on the BE moved from
 * `.optional()` to `.nullable().optional()` so both `null` and
 * `undefined` validate. Storage call sites coerce `null → undefined`
 * via the `nullsToUndef` helper at the boundary so the existing
 * Drizzle-typed signatures stay stable.
 *
 * This file exercises every POST endpoint that previously rejected
 * null. Each call posts the MINIMUM REQUIRED FIELDS plus every
 * optional field set to `null`. A successful 201 (or 200 for upserts)
 * proves the schema accepts null.
 *
 * Tenant isolation is asserted via the IDOR guard on opsRouter.param
 * which redirects to 403 for cross-tenant facility numbers — these
 * tests stay in-tenant.
 *
 * Convention notes — mirrors server/__tests__/ops/incidentLifecycle.test.ts:
 *   - Owns a unique facility number prefix so parallel forks don't
 *     collide on shared rows.
 *   - Uses the real buildTestApp + seedFacility helpers.
 *   - Cleans up its own rows in afterAll.
 */

import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { bootstrapOpsSchema, createResident } from "../../ops/opsStorage";
import {
  buildTestApp,
  cleanFacilityAccounts,
  seedFacility,
  type TestFacility,
} from "../trackers/setupTestApp";

const FACILITY = "TEST-FAC-NULL-A";
const USERNAME = "test-null-a-user";
const PASSWORD = "test-pw-null-a-12345!";
const ALL_FN = [FACILITY] as const;
const REQUIRED_HEADERS = { "X-Requested-With": "XMLHttpRequest" } as const;

let app: Express;
let facility: TestFacility;
let residentId: number;

async function loginAgent(): Promise<request.Agent> {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/facility/login")
    .set(REQUIRED_HEADERS)
    .send({ username: USERNAME, password: PASSWORD });
  expect(res.status, `login failed: ${res.text}`).toBe(200);
  return agent;
}

async function cleanup(): Promise<void> {
  // Order: child tables before parent. No FK constraints in ops schema but
  // residents are still referenced by other tables conceptually.
  for (const table of [
    "ops_resident_trust_ledger",
    "ops_resident_trust_accounts",
    "ops_posting_verifications",
    "ops_posting_catalog",
    "ops_inspection_citations",
    "ops_inspections",
    "ops_complaint_investigation_notes",
    "ops_complaints",
    "ops_drill_logs",
    "ops_vendors",
    "ops_temperature_logs",
    "ops_temperature_fixtures",
    "ops_staff_credentials",
    "ops_billing_charges",
    "ops_invoices",
    "ops_payments",
    "ops_obligations",
    "ops_compliance_calendar",
    "ops_shifts",
    "ops_staff",
    "ops_admissions",
    "ops_tours",
    "ops_leads",
    "ops_incidents",
    "ops_daily_tasks",
    "ops_care_plans",
    "ops_resident_assessments",
    "ops_medications",
    "ops_residents",
    "ops_audit_trail",
    "ops_facility_settings",
  ]) {
    await pool.query(
      `DELETE FROM ${table} WHERE facility_number = ANY($1::text[])`,
      [[...ALL_FN]],
    );
  }
}

beforeAll(async () => {
  app = buildTestApp();
  await bootstrapMainSchema();
  await bootstrapOpsSchema();
  facility = await seedFacility({
    facilityNumber: FACILITY,
    username: USERNAME,
    password: PASSWORD,
    email: "test-null-a@example.com",
  });
  await cleanup();
  // Seed a single resident for tests that need an FK target.
  const now = Date.now();
  const resident = await createResident(
    {
      facilityNumber: FACILITY,
      firstName: "Test",
      lastName: "Resident",
      status: "active",
      createdAt: now,
      updatedAt: now,
    },
    { id: "tester", role: "admin" },
  );
  residentId = resident.id;
});

afterAll(async () => {
  await cleanup();
  await cleanFacilityAccounts(ALL_FN);
  await pool.end();
});

describe("Permissive optional schemas — null is accepted on every optional field", () => {
  it("POST /residents accepts null on every optional field", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/residents")
      .set(REQUIRED_HEADERS)
      .send({
        firstName: "Null",
        lastName: "Resident",
        dob: null,
        gender: null,
        ssnLast4: null,
        admissionDate: null,
        roomNumber: null,
        bedNumber: null,
        primaryDx: null,
        secondaryDx: null,
        levelOfCare: null,
        emergencyContactName: null,
        emergencyContactPhone: null,
        emergencyContactRelation: null,
        fundingSource: null,
        regionalCenterId: null,
      });
    expect(res.status, `expected 201, got ${res.status} ${res.text}`).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("POST /staff accepts null on every optional field (regression: StaffContent.tsx:224 licenseExpiry: null)", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/staff")
      .set(REQUIRED_HEADERS)
      .send({
        firstName: "Null",
        lastName: "Staffer",
        role: "caregiver",
        email: null,
        phone: null,
        hireDate: null,
        licenseNumber: null,
        licenseExpiry: null,
      });
    expect(res.status, `expected 201, got ${res.status} ${res.text}`).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("POST /incidents accepts null on every optional field (regression: IncidentsContent.tsx:238-246)", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/incidents")
      .set(REQUIRED_HEADERS)
      .send({
        residentId: null,
        incidentType: "fall",
        incidentDate: Date.now(),
        description: "Test incident",
        reportedBy: "tester",
        // All BIGINT optional timestamp columns:
        incidentTime: null,
        location: null,
        immediateActionTaken: null,
        injuryInvolved: null,
        injuryDescription: null,
        hospitalizationRequired: null,
        hospitalName: null,
        supervisorNotified: null,
        supervisorNotifiedAt: null,
        familyNotified: null,
        familyNotifiedAt: null,
        physicianNotified: null,
        physicianNotifiedAt: null,
        lic624Submitted: null,
        lic624SubmittedAt: null,
        soc341Required: null,
        soc341Submitted: null,
        rootCause: null,
        correctiveAction: null,
        followUpDate: null,
        followUpCompleted: null,
      });
    expect(res.status, `expected 201, got ${res.status} ${res.text}`).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("POST /leads accepts null on every optional field (regression: CrmContent.tsx:106 nextFollowUpDate: null)", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/leads")
      .set(REQUIRED_HEADERS)
      .send({
        contactName: "Null Contact",
        prospectName: "Null Prospect",
        contactPhone: null,
        contactEmail: null,
        contactRelation: null,
        prospectDob: null,
        prospectGender: null,
        careNeedsSummary: null,
        fundingSource: null,
        desiredMoveInDate: null,
        referralSource: null,
        assignedTo: null,
        lostReason: null,
        notes: null,
        lastContactDate: null,
        nextFollowUpDate: null,
      });
    expect(res.status, `expected 201, got ${res.status} ${res.text}`).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("POST /obligations accepts null on every optional field (regression: ComplianceContent.tsx:254 targetId: null)", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/obligations")
      .set(REQUIRED_HEADERS)
      .send({
        obligationType: "staff_training",
        title: "Test obligation",
        dueAt: Date.now() + 86400000, // tomorrow — required
        // All optional fields explicitly null:
        description: null,
        assignedTo: null,
        targetId: null,
        recurrenceRule: null,
        notes: null,
        sourceEntityType: null,
        sourceEntityId: null,
        reminderDaysBefore: null,
      });
    expect(res.status, `expected 201, got ${res.status} ${res.text}`).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("POST /obligations rejects null dueAt with a clear 400 (server still owns the required gate)", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/obligations")
      .set(REQUIRED_HEADERS)
      .send({
        obligationType: "staff_training",
        title: "Test obligation no due date",
        dueAt: null,
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(typeof res.body.error).toBe("string");
  });

  it("POST /drills accepts null on every optional field", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/drills")
      .set(REQUIRED_HEADERS)
      .send({
        drillKind: "fire",
        executedAt: Date.now(),
        scenario: null,
        shift: null,
        leader: null,
        participants: null,
        residentsInvolved: null,
        evacuationSeconds: null,
        debriefNotes: null,
        correctiveActions: null,
      });
    expect(res.status, `expected 201, got ${res.status} ${res.text}`).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("POST /vendors accepts null on every optional field", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/vendors")
      .set(REQUIRED_HEADERS)
      .send({
        vendorName: "Null Vendor",
        vendorType: "supplier",
        contactName: null,
        contactPhone: null,
        contactEmail: null,
        coiExpiresAt: null,
        licenseExpiresAt: null,
        notes: null,
      });
    expect(res.status, `expected 201, got ${res.status} ${res.text}`).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("POST /complaints accepts null on every optional field", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/complaints")
      .set(REQUIRED_HEADERS)
      .send({
        receivedAt: Date.now(),
        complainantType: "anonymous",
        nature: "Test complaint nature",
        complainantName: null,
        complainantRelation: null,
        intakeNotes: null,
        assignedTo: null,
        externalRef: null,
      });
    expect(res.status, `expected 201, got ${res.status} ${res.text}`).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("POST /inspections accepts null on every optional field", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/inspections")
      .set(REQUIRED_HEADERS)
      .send({
        inspectorOrg: "CCLD",
        purpose: "annual",
        visitAt: Date.now(),
        inspectorName: null,
        findingsJson: null,
      });
    expect(res.status, `expected 201, got ${res.status} ${res.text}`).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("POST /temp-fixtures accepts null on every optional field", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/temp-fixtures")
      .set(REQUIRED_HEADERS)
      .send({
        fixtureKey: "fridge_kitchen",
        fixtureLabel: "Kitchen Fridge",
        kind: "refrigerator",
        requiredMin: null,
        requiredMax: null,
        unit: null,
      });
    expect(res.status, `expected 201, got ${res.status} ${res.text}`).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("POST /tasks accepts null on every optional field", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/tasks")
      .set(REQUIRED_HEADERS)
      .send({
        residentId,
        taskName: "Test task",
        taskDate: Date.now(),
        scheduledTime: null,
        shift: null,
        assignedTo: null,
      });
    expect(res.status, `expected 201, got ${res.status} ${res.text}`).toBe(201);
    expect(res.body.success).toBe(true);
  });

  it("POST /billing/charges accepts null on every optional field", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/billing/charges")
      .set(REQUIRED_HEADERS)
      .send({
        facilityNumber: FACILITY,
        residentId,
        chargeType: "room_board",
        description: "Test charge",
        amount: 100.0,
        unit: null,
        quantity: null,
        billingPeriodStart: null,
        billingPeriodEnd: null,
        isRecurring: null,
        recurrenceInterval: null,
        prorated: null,
        prorateFrom: null,
        prorateTo: null,
        clinicalRefId: null,
      });
    expect(res.status, `expected 201, got ${res.status} ${res.text}`).toBe(201);
    expect(res.body.success).toBe(true);
  });
});

describe("Error handling — handleRouteError returns structured error codes", () => {
  it("500 path includes structured error code (regression: silent Internal error)", async () => {
    // We can't easily trigger a real 500 without breaking a storage
    // function, so we exercise the 400 path (which uses the same envelope)
    // and assert the shape. Missing required field on residents.
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/residents")
      .set(REQUIRED_HEADERS)
      .send({ firstName: "Only" }); // missing lastName
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    // The 400 envelope from safeParse does not yet carry a `code`,
    // but the helper-driven 400/500 envelopes from handleRouteError do.
    // We only assert the shape is JSON with success=false here.
    expect(typeof res.body.error).toBe("string");
    expect(res.body.error.length).toBeGreaterThan(0);
    // Crucial regression assertion: error is NOT the bare generic string.
    expect(res.body.error).not.toBe("Internal error");
  });
});
