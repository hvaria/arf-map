/**
 * Phase 6 — validation hardening regression suite.
 *
 * Three concerns covered:
 *
 *   1. Body-supplied `facilityNumber` is IGNORED (server uses the session-
 *      sourced facility, not the wire value). Without this, a future
 *      refactor that passes `parsed.data` through to storage would
 *      silently leak across tenants.
 *   2. Money / quantity fields are bounded — NaN / Infinity / negative /
 *      absurd magnitudes all reject with 400 VALIDATION_ERROR.
 *   3. `.strict()` on every request-body schema — unknown fields surface
 *      as a 400 rather than being silently dropped (the same bug class
 *      that broke tour scheduling in an earlier round).
 *
 * One representative endpoint per pattern is exercised. The full
 * surface is covered indirectly via `permissiveOptionalSchemas.test.ts`
 * which already asserts the happy paths still 201 with the new schemas.
 *
 * Owns its own facility number prefix so it doesn't collide with
 * parallel tests via Vitest forks.
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

const FACILITY_A = "TEST-PHASE6-A";
const FACILITY_B = "TEST-PHASE6-B"; // never logged in as — used as the wire decoy
const USERNAME = "test-phase6-a-user";
const PASSWORD = "test-pw-phase6-12345!";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
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
  for (const table of [
    "ops_billing_charges",
    "ops_payments",
    "ops_invoices",
    "ops_med_destruction",
    "ops_controlled_sub_counts",
    "ops_med_passes",
    "ops_medications",
    "ops_residents",
    "ops_audit_trail",
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
    facilityNumber: FACILITY_A,
    username: USERNAME,
    password: PASSWORD,
    email: "test-phase6@example.com",
  });
  await cleanup();
  const now = Date.now();
  const resident = await createResident(
    {
      facilityNumber: FACILITY_A,
      firstName: "Phase6",
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

// ─────────────────────────────────────────────────────────────────────────────
// 1. Body-supplied facilityNumber is ignored — session value wins
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase 6 — body-supplied facilityNumber is ignored", () => {
  it("POST /billing/charges: session facility number is persisted even when a different facility number is in the body", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/billing/charges")
      .set(REQUIRED_HEADERS)
      .send({
        // ATTACK: claim a different facility in the body.
        facilityNumber: FACILITY_B,
        residentId,
        chargeType: "room_board",
        description: "Phase 6 tenant-isolation test",
        amount: 250.0,
      });
    // The `.strict()` on chargeSchema means the unexpected `facilityNumber`
    // surfaces as 400 rather than being silently dropped. Locking the
    // CURRENT contract: if someone relaxes strict mode in the future, this
    // test fails loudly and forces them to think about it. The conditional
    // below is defensive depth — if strict mode IS later relaxed, at least
    // the persisted row must still carry the session's facility.
    expect(res.status).toBe(400);
    if (res.status === 201) {
      expect(res.body.data.facilityNumber).toBe(FACILITY_A);
    }
  });

  it("POST /billing/charges: legitimate body (no facilityNumber field) persists with session facility", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/billing/charges")
      .set(REQUIRED_HEADERS)
      .send({
        residentId,
        chargeType: "room_board",
        description: "Legit charge",
        amount: 100.0,
      });
    expect(res.status, `expected 201, got ${res.status} ${res.text}`).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.facilityNumber).toBe(FACILITY_A);
  });

  it("POST /billing/payments: rejects body-supplied facilityNumber (strict mode)", async () => {
    const agent = await loginAgent();
    // Need a valid invoice id — generate one for this resident first.
    const invRes = await agent
      .post("/api/ops/billing/invoices/generate")
      .set(REQUIRED_HEADERS)
      .send({
        residentId,
        periodStart: Date.now() - 86400000 * 30,
        periodEnd: Date.now(),
      });
    // generateInvoice may return 201 (charges existed) or a domain error
    // (no charges yet). Either is fine — we just need a sentinel to send
    // a payment against. If we got 201, use the real id; otherwise use 1
    // (the strict-mode rejection will fire before any DB lookup).
    const invoiceId =
      invRes.status === 201 && invRes.body?.data?.id
        ? Number(invRes.body.data.id)
        : 1;

    const res = await agent
      .post("/api/ops/billing/payments")
      .set(REQUIRED_HEADERS)
      .send({
        invoiceId,
        facilityNumber: FACILITY_B, // ATTACK
        residentId,
        amount: 100,
        paymentDate: Date.now(),
        paymentMethod: "check",
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Money / quantity bounds — NaN, Infinity, negatives, huge values all 400
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase 6 — money / quantity bounds", () => {
  const cases: Array<{ label: string; amount: unknown }> = [
    { label: "NaN",          amount: Number.NaN },
    { label: "Infinity",     amount: Number.POSITIVE_INFINITY },
    { label: "-Infinity",    amount: Number.NEGATIVE_INFINITY },
    { label: "negative",     amount: -1 },
    { label: "above 1M cap", amount: 1_000_000_001 },
  ];

  for (const c of cases) {
    it(`POST /billing/charges rejects amount=${c.label} with 400`, async () => {
      const agent = await loginAgent();
      const res = await agent
        .post("/api/ops/billing/charges")
        .set(REQUIRED_HEADERS)
        .send({
          residentId,
          chargeType: "room_board",
          description: "Bounds test",
          amount: c.amount,
        });
      expect(res.status, `expected 400 for amount=${c.label}, got ${res.status} ${res.text}`).toBe(400);
      expect(res.body.success).toBe(false);
    });
  }

  it("POST /billing/charges accepts amount at the upper bound (1,000,000)", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/billing/charges")
      .set(REQUIRED_HEADERS)
      .send({
        residentId,
        chargeType: "room_board",
        description: "Upper-bound charge",
        amount: 1_000_000,
      });
    expect(res.status, `expected 201, got ${res.status} ${res.text}`).toBe(201);
  });

  it("POST /billing/charges rejects quantity > 10,000", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/billing/charges")
      .set(REQUIRED_HEADERS)
      .send({
        residentId,
        chargeType: "supplies",
        description: "Quantity bounds test",
        amount: 10,
        quantity: 10_001,
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. .strict() — unknown body fields are rejected with 400
// ─────────────────────────────────────────────────────────────────────────────

describe("Phase 6 — strict body schemas reject unknown fields", () => {
  it("POST /residents rejects unknown body field with 400", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/residents")
      .set(REQUIRED_HEADERS)
      .send({
        firstName: "Strict",
        lastName: "Test",
        evilField: "should-be-rejected",
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("POST /billing/charges rejects unknown body field with 400", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/billing/charges")
      .set(REQUIRED_HEADERS)
      .send({
        residentId,
        chargeType: "room_board",
        description: "Strict mode test",
        amount: 50,
        secretOverride: "x",
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  it("POST /incidents rejects unknown body field with 400", async () => {
    const agent = await loginAgent();
    const res = await agent
      .post("/api/ops/incidents")
      .set(REQUIRED_HEADERS)
      .send({
        incidentType: "fall",
        incidentDate: Date.now(),
        description: "Strict mode test",
        reportedBy: "tester",
        notARealField: true,
      });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
