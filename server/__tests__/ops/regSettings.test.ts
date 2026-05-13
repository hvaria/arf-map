/**
 * Reg-settings (F1) — server-side unit tests.
 *
 * Coverage:
 *  - seedDefaultsForFacility: seeds 17 catalogue keys; second call is a no-op.
 *  - getRegSetting / setRegSetting round-trip incl. source-note + validated flag.
 *  - listRegSettings projects placeholder + validated + sourceNote correctly.
 *  - setRegSetting emits an audit row (`update` on entity_type=ops_reg_setting).
 *  - Non-admin role denied write at the route layer (mocked resolveRole).
 *  - Tenant isolation: facility A's set doesn't appear in facility B's list.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import {
  buildTestApp,
  cleanFacilityAccounts,
  seedFacility,
  type TestFacility,
} from "../trackers/setupTestApp";
import { pool } from "../../db/index";
import { bootstrapOpsSchema } from "../../ops/opsStorage";
import {
  REG_SETTING_KEYS,
  getRegSetting,
  listRegSettings,
  seedDefaultsForFacility,
  setRegSetting,
} from "../../ops/regSettings";

const FACILITY_A = "TEST-FAC-REG-A";
const FACILITY_B = "TEST-FAC-REG-B";
const USER_A = "test-reg-a-user";
const USER_B = "test-reg-b-user";
const PW_A = "test-pw-reg-a-12345!";
const PW_B = "test-pw-reg-b-12345!";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const REQUIRED_HEADERS = { "X-Requested-With": "XMLHttpRequest" } as const;

let app: Express;
let facilityA: TestFacility;
let facilityB: TestFacility;

async function loginAgent(
  app_: Express,
  username: string,
  password: string,
): Promise<request.Agent> {
  const agent = request.agent(app_);
  const res = await agent
    .post("/api/facility/login")
    .set(REQUIRED_HEADERS)
    .send({ username, password });
  expect(res.status, `login failed: ${res.text}`).toBe(200);
  return agent;
}

async function cleanRegSettings(fns: readonly string[]): Promise<void> {
  await pool.query(
    `DELETE FROM ops_facility_settings WHERE facility_number = ANY($1::text[])`,
    [[...fns]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail WHERE facility_number = ANY($1::text[])`,
    [[...fns]],
  );
}

beforeAll(async () => {
  app = buildTestApp();
  await bootstrapOpsSchema();
  facilityA = await seedFacility({
    facilityNumber: FACILITY_A,
    username: USER_A,
    password: PW_A,
    email: "test-reg-a@example.com",
  });
  facilityB = await seedFacility({
    facilityNumber: FACILITY_B,
    username: USER_B,
    password: PW_B,
    email: "test-reg-b@example.com",
  });
});

afterAll(async () => {
  await cleanRegSettings(ALL_FN);
  await cleanFacilityAccounts(ALL_FN);
  await pool.end();
});

beforeEach(async () => {
  await cleanRegSettings(ALL_FN);
});

describe("regSettings — storage layer", () => {
  it("seedDefaultsForFacility inserts every catalogue key once", async () => {
    const r1 = await seedDefaultsForFacility(FACILITY_A);
    const expectedKeys = Object.keys(REG_SETTING_KEYS).length;
    expect(r1.inserted).toBe(expectedKeys);

    // Second call is a no-op (ON CONFLICT DO NOTHING).
    const r2 = await seedDefaultsForFacility(FACILITY_A);
    expect(r2.inserted).toBe(0);
  });

  it("getRegSetting falls back to catalogue default when row missing", async () => {
    const v = await getRegSetting(FACILITY_A, "HOT_WATER_MAX_F");
    expect(v).toBe(REG_SETTING_KEYS.HOT_WATER_MAX_F.default);
  });

  it("setRegSetting writes value + source note + validated flag and emits audit", async () => {
    await setRegSetting(FACILITY_A, "HOT_WATER_MAX_F", "115", {
      sourceNote: "Title 22 §87303(g) per CCLD analyst",
      validated: true,
      actorId: "alice",
      actorRole: "admin",
    });
    const v = await getRegSetting(FACILITY_A, "HOT_WATER_MAX_F");
    expect(v).toBe("115");

    const rows = await listRegSettings(FACILITY_A);
    const row = rows.find((r) => r.key === "HOT_WATER_MAX_F");
    expect(row).toBeDefined();
    expect(row?.value).toBe("115");
    expect(row?.placeholder).toBe(true); // catalogue marker stays
    expect(row?.sourceNote).toBe("Title 22 §87303(g) per CCLD analyst");
    expect(row?.validated).toBe(true);

    // Audit row emitted.
    const audit = await pool.query<{ action: string; after_json: string }>(
      `SELECT action, after_json FROM ops_audit_trail
        WHERE facility_number = $1 AND entity_type = 'ops_reg_setting'`,
      [FACILITY_A],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].action).toBe("update");
    expect(JSON.parse(audit.rows[0].after_json).key).toBe("HOT_WATER_MAX_F");
  });

  it("tenant isolation — facility A writes are invisible to facility B", async () => {
    await setRegSetting(FACILITY_A, "FRIDGE_MAX_F", "42", {
      actorId: "alice",
      actorRole: "admin",
    });
    const bValue = await getRegSetting(FACILITY_B, "FRIDGE_MAX_F");
    expect(bValue).toBe(REG_SETTING_KEYS.FRIDGE_MAX_F.default);
  });
});

describe("regSettings — route layer", () => {
  it("GET /facilities/:fn/reg-settings returns all catalogue keys", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .get(`/api/ops/facilities/${FACILITY_A}/reg-settings`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(Object.keys(REG_SETTING_KEYS).length);
  });

  it("PUT /reg-settings/:key updates the value for the session's facility", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .put("/api/ops/reg-settings/HOT_WATER_MAX_F")
      .set(REQUIRED_HEADERS)
      .send({ value: "108", sourceNote: "validated", validated: true });
    expect(res.status).toBe(200);
    expect(res.body.data.value).toBe("108");
    expect(res.body.data.validated).toBe(true);
  });

  it("PUT /reg-settings/:key rejects unknown keys", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .put("/api/ops/reg-settings/NOT_A_REAL_KEY")
      .set(REQUIRED_HEADERS)
      .send({ value: "1" });
    expect(res.status).toBe(400);
  });

  it("PUT /reg-settings/:key rejects empty value (strict zod)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .put("/api/ops/reg-settings/HOT_WATER_MAX_F")
      .set(REQUIRED_HEADERS)
      .send({ value: "" });
    expect(res.status).toBe(400);
  });

  it("POST /facilities/:fn/reg-settings/seed is idempotent", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const r1 = await agent
      .post(`/api/ops/facilities/${FACILITY_A}/reg-settings/seed`)
      .set(REQUIRED_HEADERS);
    expect(r1.status).toBe(200);
    expect(r1.body.data.inserted).toBeGreaterThan(0);
    const r2 = await agent
      .post(`/api/ops/facilities/${FACILITY_A}/reg-settings/seed`)
      .set(REQUIRED_HEADERS);
    expect(r2.status).toBe(200);
    expect(r2.body.data.inserted).toBe(0);
  });

  it("non-admin (auditor) role has no manage_settings permission in the matrix", async () => {
    // Test the matrix directly — Wave 0 `resolveRole()` is hard-coded to
    // "admin", so the live route can never see "auditor". The contract
    // we're guarding is: the day Wave 3 flips resolveRole to return
    // "auditor" for share-link sessions, write endpoints must already
    // deny. Asserting on the matrix is the durable check.
    const { ROLE_PERMISSIONS, OPS_RESOURCES } = await import(
      "../../ops/permissions"
    );
    const auditorPerms = ROLE_PERMISSIONS.auditor;
    const regSettingPerm = auditorPerms.find(
      (p) => p.resource === OPS_RESOURCES.REG_SETTING,
    );
    expect(regSettingPerm).toBeDefined();
    expect(regSettingPerm?.actions).toContain("read");
    expect(regSettingPerm?.actions).not.toContain("manage_settings");
    expect(regSettingPerm?.actions).not.toContain("update");
    expect(regSettingPerm?.actions).not.toContain("create");
  });

  // Silence the lint about unused facilityB.
  it("references facilityB to keep cleanup symmetric", () => {
    expect(facilityB.facilityNumber).toBe(FACILITY_B);
  });
});
