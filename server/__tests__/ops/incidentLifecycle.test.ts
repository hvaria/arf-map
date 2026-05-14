/**
 * W4 Incident Lifecycle Closer — server storage + router tests.
 *
 * Coverage:
 *   - classifyIncidentSeverity() unit cases.
 *   - evaluateIncidentChecklist:
 *       * open incident with no notifications → required-but-not-done set;
 *         CCLD verbal SLA computed with severity-driven window.
 *       * serious + past 2h with no ccld_verbal_notified_at → ccldVerbalSeverity='overdue'.
 *       * lic624 required + submitted within window → done; severity='ok'.
 *       * lic624 required + not submitted past 7d → 'overdue'.
 *       * canClose=true only when every required step done.
 *       * tenant isolation across facilities.
 *   - closeIncident:
 *       * blocked when missing root cause / corrective action → 400-style throw.
 *       * blocked when closureNote < 8 chars.
 *       * happy path sets closed_at / closed_by / closure_note + audit row.
 *   - reopenIncident:
 *       * rejects when current status != 'closed'.
 *       * accepts on closed → status='under_review', sets reopen fields,
 *         preserves prior closed_at / closed_by.
 *   - listIncidentsPastSla:
 *       * returns only open/under-review incidents with ≥1 overdue rule.
 *       * tenant-scoped.
 *   - Route smoke: 401 unauth, 403 wrong tenant, 400 missing body, 200 happy.
 *
 * Conventions mirror server/__tests__/ops/staffCredentials.test.ts.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import {
  bootstrapOpsSchema,
  closeIncident,
  createIncident,
  evaluateIncidentChecklist,
  listIncidentsPastSla,
  reopenIncident,
  updateIncident,
} from "../../ops/opsStorage";
import {
  classifyIncidentSeverity,
} from "@shared/incident-types";
import {
  buildTestApp,
  cleanFacilityAccounts,
  seedFacility,
  type TestFacility,
} from "../trackers/setupTestApp";

const FACILITY_A = "TEST-FAC-INC-A";
const FACILITY_B = "TEST-FAC-INC-B";
const USER_A = "test-inc-a-user";
const USER_B = "test-inc-b-user";
const PW_A = "test-pw-inc-a-12345!";
const PW_B = "test-pw-inc-b-12345!";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const ACTOR = { id: "alice", role: "admin" };
const REQUIRED_HEADERS = { "X-Requested-With": "XMLHttpRequest" } as const;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

let app: Express;
let facilityA: TestFacility;
let facilityB: TestFacility;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_incidents          WHERE facility_number = ANY($1::text[])`,
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
  app = buildTestApp();
  await bootstrapMainSchema();
  await bootstrapOpsSchema();
  facilityA = await seedFacility({
    facilityNumber: FACILITY_A,
    username: USER_A,
    password: PW_A,
    email: "test-inc-a@example.com",
  });
  facilityB = await seedFacility({
    facilityNumber: FACILITY_B,
    username: USER_B,
    password: PW_B,
    email: "test-inc-b@example.com",
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

async function seedIncident(
  facilityNumber: string,
  overrides: Partial<{
    incidentType: string;
    incidentDate: number;
    injuryInvolved: number;
    hospitalizationRequired: number;
    lic624Required: number;
    soc341Required: number;
    rootCause: string | null;
    correctiveAction: string | null;
    supervisorNotifiedAt: number | null;
    familyNotifiedAt: number | null;
    physicianNotifiedAt: number | null;
    ccldVerbalNotifiedAt: number | null;
    lic624SubmittedAt: number | null;
    soc341SubmittedAt: number | null;
    followUpDate: number | null;
    followUpCompleted: number;
    status: string;
  }> = {},
) {
  const row = await createIncident({
    facilityNumber,
    residentId: null,
    incidentType: overrides.incidentType ?? "fall",
    incidentDate: overrides.incidentDate ?? Date.now() - DAY,
    description: "Test incident",
    reportedBy: "tester",
    injuryInvolved: overrides.injuryInvolved ?? 0,
    hospitalizationRequired: overrides.hospitalizationRequired ?? 0,
    lic624Required: overrides.lic624Required ?? 0,
    soc341Required: overrides.soc341Required ?? 0,
    rootCause: overrides.rootCause ?? null,
    correctiveAction: overrides.correctiveAction ?? null,
    supervisorNotifiedAt: overrides.supervisorNotifiedAt ?? null,
    familyNotifiedAt: overrides.familyNotifiedAt ?? null,
    physicianNotifiedAt: overrides.physicianNotifiedAt ?? null,
    ccldVerbalNotifiedAt: overrides.ccldVerbalNotifiedAt ?? null,
    lic624SubmittedAt: overrides.lic624SubmittedAt ?? null,
    soc341SubmittedAt: overrides.soc341SubmittedAt ?? null,
    followUpDate: overrides.followUpDate ?? null,
    followUpCompleted: overrides.followUpCompleted ?? 0,
    status: overrides.status ?? "open",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  return row;
}

/**
 * Fast-forward helpers: many tests need an incident that LOOKS like it was
 * filed N hours/days ago without `sleep()`-style waiting. `incidentDate` is
 * the relevant pivot; everything else (createdAt, updatedAt) is irrelevant
 * to SLA computation.
 */
function hoursAgo(h: number): number {
  return Date.now() - h * HOUR;
}
function daysAgo(d: number): number {
  return Date.now() - d * DAY;
}

async function auditCount(
  facilityNumber: string,
  action: string,
  entityType = "ops_incident",
): Promise<number> {
  const r = await pool.query<{ c: number }>(
    `SELECT COUNT(*)::int AS c FROM ops_audit_trail
     WHERE facility_number = $1 AND action = $2 AND entity_type = $3`,
    [facilityNumber, action, entityType],
  );
  return Number(r.rows[0]?.c ?? 0);
}

// ─────────────────────────────────────────────────────────────────────────────
// Shared classifier — unit cases
// ─────────────────────────────────────────────────────────────────────────────

describe("classifyIncidentSeverity", () => {
  it("fall alone is non_emergent", () => {
    expect(classifyIncidentSeverity("fall")).toBe("non_emergent");
  });
  it("fall + injuryInvolved → serious (escalation rule 2)", () => {
    expect(classifyIncidentSeverity("fall", { injuryInvolved: true })).toBe("serious");
  });
  it("altercation + injuryInvolved → serious (escalation rule 2)", () => {
    expect(
      classifyIncidentSeverity("altercation", { injuryInvolved: true }),
    ).toBe("serious");
  });
  it("medical_emergency → serious from base catalogue", () => {
    expect(classifyIncidentSeverity("medical_emergency")).toBe("serious");
  });
  it("any incident_type with hospitalizationRequired → serious (rule 1)", () => {
    expect(
      classifyIncidentSeverity("property_damage", { hospitalizationRequired: true }),
    ).toBe("serious");
  });
  it("unknown incident_type → non_emergent (default fallback)", () => {
    expect(classifyIncidentSeverity("never-heard-of-this-type" as never)).toBe(
      "non_emergent",
    );
  });
  it("death → serious", () => {
    expect(classifyIncidentSeverity("death")).toBe("serious");
  });
  it("abuse_suspected → serious", () => {
    expect(classifyIncidentSeverity("abuse_suspected")).toBe("serious");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// createIncident — server-derived event_severity
// ─────────────────────────────────────────────────────────────────────────────

describe("createIncident — event_severity is server-derived", () => {
  it("persists serious for medical_emergency", async () => {
    const row = await seedIncident(FACILITY_A, { incidentType: "medical_emergency" });
    expect(row.eventSeverity).toBe("serious");
  });
  it("persists non_emergent for plain fall (no injury)", async () => {
    const row = await seedIncident(FACILITY_A, { incidentType: "fall" });
    expect(row.eventSeverity).toBe("non_emergent");
  });
  it("escalates to serious when fall + injuryInvolved=1", async () => {
    const row = await seedIncident(FACILITY_A, {
      incidentType: "fall",
      injuryInvolved: 1,
    });
    expect(row.eventSeverity).toBe("serious");
  });
});

describe("updateIncident — event_severity is re-derived on classifier-input change", () => {
  it("flipping injuryInvolved 0 → 1 promotes a fall to serious", async () => {
    const row = await seedIncident(FACILITY_A, {
      incidentType: "fall",
      injuryInvolved: 0,
    });
    expect(row.eventSeverity).toBe("non_emergent");
    const after = await updateIncident(row.id, FACILITY_A, { injuryInvolved: 1 });
    expect(after?.eventSeverity).toBe("serious");
  });
  it("changing incidentType from fall to medical_emergency promotes to serious", async () => {
    const row = await seedIncident(FACILITY_A, { incidentType: "fall" });
    const after = await updateIncident(row.id, FACILITY_A, {
      incidentType: "medical_emergency",
    });
    expect(after?.eventSeverity).toBe("serious");
  });
  it("client-supplied event_severity is stripped (never trusted)", async () => {
    const row = await seedIncident(FACILITY_A, { incidentType: "fall" });
    const after = await updateIncident(row.id, FACILITY_A, {
      // pretend a buggy client sent this — should be ignored.
      eventSeverity: "serious",
    } as never);
    expect(after?.eventSeverity).toBe("non_emergent");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// evaluateIncidentChecklist
// ─────────────────────────────────────────────────────────────────────────────

describe("evaluateIncidentChecklist", () => {
  it("returns undefined when the incident is in another facility", async () => {
    const row = await seedIncident(FACILITY_A);
    const r = await evaluateIncidentChecklist(FACILITY_B, row.id);
    expect(r).toBeUndefined();
  });

  it("brand-new open incident reports every required-but-not-done step", async () => {
    const row = await seedIncident(FACILITY_A, { incidentType: "fall" });
    const r = await evaluateIncidentChecklist(FACILITY_A, row.id);
    expect(r).toBeDefined();
    expect(r!.canClose).toBe(false);
    expect(r!.required.supervisor).toBe(true);
    expect(r!.required.family).toBe(true);
    expect(r!.required.ccldVerbal).toBe(true);
    expect(r!.required.lic624).toBe(false); // not flagged
    expect(r!.required.soc341).toBe(false);
    expect(r!.done.supervisor).toBe(false);
    expect(r!.blockingReasons.length).toBeGreaterThan(0);
    expect(r!.blockingReasons[0]).toMatch(/supervisor/i);
  });

  it("serious + > 2h since incident with no CCLD verbal → ccldVerbalSeverity='overdue'", async () => {
    const row = await seedIncident(FACILITY_A, {
      incidentType: "medical_emergency", // serious
      incidentDate: hoursAgo(5),
    });
    const r = await evaluateIncidentChecklist(FACILITY_A, row.id);
    expect(r!.eventSeverity).toBe("serious");
    expect(r!.sla.ccldVerbalSeverity).toBe("overdue");
  });

  it("non_emergent + < 24h since incident with no CCLD verbal → ccldVerbalSeverity in ok|warning", async () => {
    const row = await seedIncident(FACILITY_A, {
      incidentType: "fall", // non_emergent
      incidentDate: hoursAgo(1),
    });
    const r = await evaluateIncidentChecklist(FACILITY_A, row.id);
    expect(r!.eventSeverity).toBe("non_emergent");
    expect(["ok", "warning"]).toContain(r!.sla.ccldVerbalSeverity);
  });

  it("ccld_verbal_notified_at non-null → ccldVerbalSeverity='ok' even if past window", async () => {
    const row = await seedIncident(FACILITY_A, {
      incidentType: "medical_emergency",
      incidentDate: daysAgo(10),
      ccldVerbalNotifiedAt: daysAgo(10) + HOUR, // notified within 1h
    });
    const r = await evaluateIncidentChecklist(FACILITY_A, row.id);
    expect(r!.sla.ccldVerbalSeverity).toBe("ok");
  });

  it("lic624 required + submitted within window → done.lic624=true, severity='ok'", async () => {
    const row = await seedIncident(FACILITY_A, {
      incidentType: "fall",
      incidentDate: daysAgo(2),
      lic624Required: 1,
      lic624SubmittedAt: daysAgo(1),
    });
    const r = await evaluateIncidentChecklist(FACILITY_A, row.id);
    expect(r!.required.lic624).toBe(true);
    expect(r!.done.lic624).toBe(true);
    expect(r!.sla.lic624Severity).toBe("ok");
  });

  it("lic624 required + not submitted past 7d (default LIC_624_WRITTEN_DAYS) → 'overdue'", async () => {
    const row = await seedIncident(FACILITY_A, {
      incidentType: "fall",
      incidentDate: daysAgo(10),
      lic624Required: 1,
    });
    const r = await evaluateIncidentChecklist(FACILITY_A, row.id);
    expect(r!.required.lic624).toBe(true);
    expect(r!.done.lic624).toBe(false);
    expect(r!.sla.lic624Severity).toBe("overdue");
    expect(r!.blockingReasons).toContain("LIC 624 not submitted");
  });

  it("soc341 required + past 2h with no submission → 'overdue'; soc341Severity computed", async () => {
    const row = await seedIncident(FACILITY_A, {
      incidentType: "abuse_suspected",
      incidentDate: hoursAgo(5),
      soc341Required: 1,
    });
    const r = await evaluateIncidentChecklist(FACILITY_A, row.id);
    expect(r!.required.soc341).toBe(true);
    expect(r!.sla.soc341Severity).toBe("overdue");
  });

  it("physician required only when injuryInvolved or hospitalizationRequired", async () => {
    const noInjury = await seedIncident(FACILITY_A, {
      incidentType: "behavioral",
      injuryInvolved: 0,
      hospitalizationRequired: 0,
    });
    const r1 = await evaluateIncidentChecklist(FACILITY_A, noInjury.id);
    expect(r1!.required.physician).toBe(false);

    const withInjury = await seedIncident(FACILITY_A, {
      incidentType: "fall",
      injuryInvolved: 1,
    });
    const r2 = await evaluateIncidentChecklist(FACILITY_A, withInjury.id);
    expect(r2!.required.physician).toBe(true);
  });

  it("canClose=true when every required step is done and notes are present", async () => {
    const now = Date.now();
    const row = await seedIncident(FACILITY_A, {
      incidentType: "fall",
      incidentDate: now - HOUR,
      injuryInvolved: 1, // physician now required
      supervisorNotifiedAt: now,
      familyNotifiedAt: now,
      physicianNotifiedAt: now,
      ccldVerbalNotifiedAt: now,
      lic624Required: 1,
      lic624SubmittedAt: now,
      rootCause: "Wet floor near doorway",
      correctiveAction: "Added non-slip mat, retrained staff",
    });
    const r = await evaluateIncidentChecklist(FACILITY_A, row.id);
    expect(r!.canClose).toBe(true);
    expect(r!.blockingReasons).toEqual([]);
  });

  it("follow_up_date set + follow_up_completed=0 blocks close", async () => {
    const now = Date.now();
    const row = await seedIncident(FACILITY_A, {
      incidentType: "fall",
      incidentDate: now - HOUR,
      supervisorNotifiedAt: now,
      familyNotifiedAt: now,
      ccldVerbalNotifiedAt: now,
      rootCause: "tested",
      correctiveAction: "tested action",
      followUpDate: now + DAY,
      followUpCompleted: 0,
    });
    const r = await evaluateIncidentChecklist(FACILITY_A, row.id);
    expect(r!.required.followUp).toBe(true);
    expect(r!.done.followUp).toBe(false);
    expect(r!.canClose).toBe(false);
    expect(r!.blockingReasons).toContain("Follow-up not completed");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// closeIncident
// ─────────────────────────────────────────────────────────────────────────────

describe("closeIncident", () => {
  it("blocks when root cause missing (canClose=false)", async () => {
    const now = Date.now();
    const row = await seedIncident(FACILITY_A, {
      incidentType: "fall",
      incidentDate: now - HOUR,
      supervisorNotifiedAt: now,
      familyNotifiedAt: now,
      ccldVerbalNotifiedAt: now,
      // rootCause and correctiveAction intentionally missing
    });
    await expect(
      closeIncident(row.id, FACILITY_A, "alice", "All notifications complete, ok to close.", ACTOR),
    ).rejects.toThrow(/root cause/i);
  });

  it("blocks when corrective action missing", async () => {
    const now = Date.now();
    const row = await seedIncident(FACILITY_A, {
      incidentType: "fall",
      incidentDate: now - HOUR,
      supervisorNotifiedAt: now,
      familyNotifiedAt: now,
      ccldVerbalNotifiedAt: now,
      rootCause: "Wet floor",
    });
    await expect(
      closeIncident(row.id, FACILITY_A, "alice", "Ready to close at last.", ACTOR),
    ).rejects.toThrow(/corrective action/i);
  });

  it("rejects empty / too-short closure note", async () => {
    const row = await seedIncident(FACILITY_A);
    await expect(
      closeIncident(row.id, FACILITY_A, "alice", "short", ACTOR),
    ).rejects.toThrow(/at least 8 characters/i);
  });

  it("happy path: sets status=closed, closed_at, closed_by, closure_note, audit row emitted", async () => {
    const now = Date.now();
    const row = await seedIncident(FACILITY_A, {
      incidentType: "fall",
      incidentDate: now - HOUR,
      supervisorNotifiedAt: now,
      familyNotifiedAt: now,
      ccldVerbalNotifiedAt: now,
      rootCause: "Wet floor near doorway",
      correctiveAction: "Added mat, retrained staff",
    });
    const closed = await closeIncident(
      row.id,
      FACILITY_A,
      "alice",
      "All notifications complete, root cause documented.",
      ACTOR,
    );
    expect(closed?.status).toBe("closed");
    expect(closed?.closedAt).toBeTypeOf("number");
    expect(closed?.closedBy).toBe("alice");
    expect(closed?.closureNote).toMatch(/notifications complete/);

    expect(await auditCount(FACILITY_A, "close")).toBe(1);
  });

  it("returns undefined for an incident in another tenant (no leak)", async () => {
    const row = await seedIncident(FACILITY_A);
    const r = await closeIncident(row.id, FACILITY_B, "alice", "ok to close, audit context", ACTOR);
    expect(r).toBeUndefined();
  });

  it("rejects close when already closed", async () => {
    const now = Date.now();
    const row = await seedIncident(FACILITY_A, {
      incidentType: "fall",
      incidentDate: now - HOUR,
      supervisorNotifiedAt: now,
      familyNotifiedAt: now,
      ccldVerbalNotifiedAt: now,
      rootCause: "x",
      correctiveAction: "y",
      status: "closed",
    });
    await expect(
      closeIncident(row.id, FACILITY_A, "alice", "another close attempt happens here", ACTOR),
    ).rejects.toThrow(/already closed/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reopenIncident
// ─────────────────────────────────────────────────────────────────────────────

describe("reopenIncident", () => {
  it("rejects when status='open' (must be closed first)", async () => {
    const row = await seedIncident(FACILITY_A);
    await expect(
      reopenIncident(row.id, FACILITY_A, "alice", "want to reopen this one", ACTOR),
    ).rejects.toThrow(/Cannot reopen/i);
  });

  it("rejects when reason < 8 chars", async () => {
    const row = await seedIncident(FACILITY_A, { status: "closed" });
    await expect(
      reopenIncident(row.id, FACILITY_A, "alice", "short", ACTOR),
    ).rejects.toThrow(/at least 8 characters/i);
  });

  it("happy path: closed → under_review, sets reopen fields, preserves prior closed_at/by", async () => {
    const now = Date.now();
    const row = await seedIncident(FACILITY_A, {
      incidentType: "fall",
      incidentDate: now - HOUR,
      supervisorNotifiedAt: now,
      familyNotifiedAt: now,
      ccldVerbalNotifiedAt: now,
      rootCause: "x",
      correctiveAction: "y",
    });
    const closed = await closeIncident(
      row.id,
      FACILITY_A,
      "alice",
      "closing the incident for testing",
      ACTOR,
    );
    expect(closed?.status).toBe("closed");
    const priorClosedAt = closed?.closedAt;
    const priorClosedBy = closed?.closedBy;

    const reopened = await reopenIncident(
      row.id,
      FACILITY_A,
      "bob",
      "Family disputes the corrective action.",
      { id: "bob", role: "admin" },
    );
    expect(reopened?.status).toBe("under_review");
    expect(reopened?.reopenedAt).toBeTypeOf("number");
    expect(reopened?.reopenedBy).toBe("bob");
    expect(reopened?.reopenReason).toMatch(/Family disputes/);
    // Prior close audit data preserved.
    expect(reopened?.closedAt).toBe(priorClosedAt);
    expect(reopened?.closedBy).toBe(priorClosedBy);

    expect(await auditCount(FACILITY_A, "reopen")).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// listIncidentsPastSla
// ─────────────────────────────────────────────────────────────────────────────

describe("listIncidentsPastSla", () => {
  it("returns only open/under-review rows with at least one overdue rule", async () => {
    // Row 1: serious + 5h old, no CCLD → overdue.
    await seedIncident(FACILITY_A, {
      incidentType: "medical_emergency",
      incidentDate: hoursAgo(5),
    });
    // Row 2: brand-new non-emergent fall, in window → no breach.
    await seedIncident(FACILITY_A, {
      incidentType: "fall",
      incidentDate: hoursAgo(1),
    });
    // Row 3: closed incident — excluded.
    const now = Date.now();
    const closedRow = await seedIncident(FACILITY_A, {
      incidentType: "fall",
      incidentDate: hoursAgo(48),
      supervisorNotifiedAt: now,
      familyNotifiedAt: now,
      ccldVerbalNotifiedAt: now,
      rootCause: "x",
      correctiveAction: "y",
    });
    await closeIncident(closedRow.id, FACILITY_A, "alice", "closing as part of test", ACTOR);

    const r = await listIncidentsPastSla(FACILITY_A, { limit: 50 });
    expect(r.length).toBe(1);
    expect(r[0].breachedRules).toContain("ccld_verbal");
  });

  it("tenant-isolated: facility B sees nothing from facility A", async () => {
    await seedIncident(FACILITY_A, {
      incidentType: "medical_emergency",
      incidentDate: hoursAgo(5),
    });
    const r = await listIncidentsPastSla(FACILITY_B, { limit: 50 });
    expect(r).toEqual([]);
  });

  it("flags lic_624 + soc_341 breaches separately", async () => {
    await seedIncident(FACILITY_A, {
      incidentType: "abuse_suspected",
      incidentDate: daysAgo(10),
      lic624Required: 1,
      soc341Required: 1,
      // CCLD already done so only the lic_624 + soc_341 breaches show up.
      ccldVerbalNotifiedAt: daysAgo(10) + HOUR,
    });
    const r = await listIncidentsPastSla(FACILITY_A, { limit: 50 });
    expect(r.length).toBe(1);
    expect(r[0].breachedRules).toContain("lic_624");
    expect(r[0].breachedRules).toContain("soc_341");
    expect(r[0].breachedRules).not.toContain("ccld_verbal");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Router smoke
// ─────────────────────────────────────────────────────────────────────────────

describe("router — W4 incident lifecycle", () => {
  it("GET /incidents/:id/checklist 401 when unauthenticated", async () => {
    const row = await seedIncident(FACILITY_A);
    const res = await request(app)
      .get(`/api/ops/incidents/${row.id}/checklist`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(401);
  });

  it("GET /past-sla 403 when reading another facility's incidents", async () => {
    const agentA = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agentA
      .get(`/api/ops/facilities/${FACILITY_B}/incidents/past-sla`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(403);
  });

  it("GET /checklist 404 for an incident in another facility", async () => {
    const row = await seedIncident(FACILITY_A);
    const agentB = await loginAgent(app, facilityB.username, facilityB.password);
    const res = await agentB
      .get(`/api/ops/incidents/${row.id}/checklist`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(404);
  });

  it("POST /close 400 with missing closureNote", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const row = await seedIncident(FACILITY_A);
    const res = await agent
      .post(`/api/ops/incidents/${row.id}/close`)
      .set(REQUIRED_HEADERS)
      .send({});
    expect(res.status).toBe(400);
  });

  it("POST /close 400 with closureNote too short", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const row = await seedIncident(FACILITY_A);
    const res = await agent
      .post(`/api/ops/incidents/${row.id}/close`)
      .set(REQUIRED_HEADERS)
      .send({ closureNote: "short" });
    expect(res.status).toBe(400);
  });

  it("POST /close 200 happy path; audit row recorded", async () => {
    const now = Date.now();
    const row = await seedIncident(FACILITY_A, {
      incidentType: "fall",
      incidentDate: now - HOUR,
      supervisorNotifiedAt: now,
      familyNotifiedAt: now,
      ccldVerbalNotifiedAt: now,
      rootCause: "Wet floor",
      correctiveAction: "Added mat",
    });
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post(`/api/ops/incidents/${row.id}/close`)
      .set(REQUIRED_HEADERS)
      .send({ closureNote: "All steps completed; closing now." });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe("closed");
    expect(await auditCount(FACILITY_A, "close")).toBe(1);
  });

  it("POST /reopen 200 happy path; audit row recorded", async () => {
    const now = Date.now();
    const row = await seedIncident(FACILITY_A, {
      incidentType: "fall",
      incidentDate: now - HOUR,
      supervisorNotifiedAt: now,
      familyNotifiedAt: now,
      ccldVerbalNotifiedAt: now,
      rootCause: "Wet floor",
      correctiveAction: "Added mat",
    });
    await closeIncident(
      row.id,
      FACILITY_A,
      "alice",
      "Closing as part of router test setup.",
      ACTOR,
    );
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post(`/api/ops/incidents/${row.id}/reopen`)
      .set(REQUIRED_HEADERS)
      .send({ reason: "New information from family." });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("under_review");
    expect(await auditCount(FACILITY_A, "reopen")).toBe(1);
  });

  it("GET /past-sla 200 returns breached rows for the authenticated facility only", async () => {
    await seedIncident(FACILITY_A, {
      incidentType: "medical_emergency",
      incidentDate: hoursAgo(5),
    });
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .get(`/api/ops/facilities/${FACILITY_A}/incidents/past-sla`)
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(1);
  });
});
