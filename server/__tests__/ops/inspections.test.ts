/**
 * W13 Inspections + citations — server storage tests.
 *
 * Coverage:
 *  - Create inspection + add citations + list with detail.
 *  - closeInspection blocked while any citation is open (Phase 4 §12).
 *  - closeInspection succeeds once every citation is closed.
 *  - closeCitation idempotent on already-closed; updates closure metadata.
 *  - addCitation rejected against a closed inspection.
 *  - Tenant isolation on get + list + addCitation.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import {
  addCitation,
  bootstrapOpsSchema,
  closeCitation,
  closeInspection,
  createInspection,
  getInspection,
  listInspections,
} from "../../ops/opsStorage";

const FACILITY_A = "TEST-FAC-INSP-A";
const FACILITY_B = "TEST-FAC-INSP-B";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const ACTOR = { id: "alice", role: "admin" };

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_inspection_citations WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_inspections          WHERE facility_number = ANY($1::text[])`,
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

async function mkInspection(facilityNumber: string) {
  return createInspection(
    {
      facilityNumber,
      inspectorOrg: "CCLD",
      inspectorName: "Inspector Pham",
      purpose: "annual",
      visitAt: Date.now(),
      findingsJson: null,
      createdBy: ACTOR.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    ACTOR,
  );
}

describe("inspections — citations CRUD + detail view", () => {
  it("getInspection returns inspection + citations + evidence (empty)", async () => {
    const insp = await mkInspection(FACILITY_A);
    await addCitation(insp.id, FACILITY_A, { citationTitle: "Title 22 §87468(a)" }, ACTOR);
    await addCitation(insp.id, FACILITY_A, { citationTitle: "Title 22 §87411(c)" }, ACTOR);

    const full = await getInspection(insp.id, FACILITY_A);
    expect(full).toBeDefined();
    expect(full!.inspection.id).toBe(insp.id);
    expect(full!.citations.length).toBe(2);
    expect(full!.evidence).toEqual([]);
  });

  it("addCitation returns undefined for an unknown / cross-tenant inspection id", async () => {
    const insp = await mkInspection(FACILITY_A);
    const wrong = await addCitation(insp.id, FACILITY_B, { citationTitle: "x" }, ACTOR);
    expect(wrong).toBeUndefined();
  });
});

describe("inspections — close gating (Phase 4 §12)", () => {
  it("blocks closeInspection while any citation is open", async () => {
    const insp = await mkInspection(FACILITY_A);
    await addCitation(insp.id, FACILITY_A, { citationTitle: "Open citation" }, ACTOR);
    await expect(
      closeInspection(insp.id, FACILITY_A, ACTOR),
    ).rejects.toThrow(/open citations remain/i);
  });

  it("allows closeInspection once every citation is closed", async () => {
    const insp = await mkInspection(FACILITY_A);
    const c1 = await addCitation(insp.id, FACILITY_A, { citationTitle: "A" }, ACTOR);
    const c2 = await addCitation(insp.id, FACILITY_A, { citationTitle: "B" }, ACTOR);
    expect(c1).toBeDefined();
    expect(c2).toBeDefined();
    await closeCitation(c1!.id, FACILITY_A, ACTOR, "Fixed signage");
    await closeCitation(c2!.id, FACILITY_A, ACTOR, "Retrained staff");
    const closed = await closeInspection(insp.id, FACILITY_A, ACTOR);
    expect(closed?.status).toBe("closed");
    expect(closed?.closedAt).not.toBeNull();
  });

  it("addCitation against a closed inspection is rejected", async () => {
    const insp = await mkInspection(FACILITY_A);
    await closeInspection(insp.id, FACILITY_A, ACTOR); // no citations → closes
    await expect(
      addCitation(insp.id, FACILITY_A, { citationTitle: "late add" }, ACTOR),
    ).rejects.toThrow(/closed inspection/i);
  });

  it("closeCitation is idempotent on already-closed", async () => {
    const insp = await mkInspection(FACILITY_A);
    const c = await addCitation(insp.id, FACILITY_A, { citationTitle: "x" }, ACTOR);
    expect(c).toBeDefined();
    const first = await closeCitation(c!.id, FACILITY_A, ACTOR, "fix");
    const second = await closeCitation(c!.id, FACILITY_A, ACTOR, "fix again");
    expect(first?.status).toBe("closed");
    expect(second?.status).toBe("closed");
    expect(second?.closureNote).toBe(first?.closureNote);
  });
});

describe("inspections — tenant isolation", () => {
  it("getInspection returns undefined for another facility's id", async () => {
    const insp = await mkInspection(FACILITY_A);
    const wrong = await getInspection(insp.id, FACILITY_B);
    expect(wrong).toBeUndefined();
  });

  it("listInspections respects facility_number", async () => {
    await mkInspection(FACILITY_A);
    await mkInspection(FACILITY_A);
    await mkInspection(FACILITY_B);
    const a = await listInspections(FACILITY_A, { page: 1, limit: 50 });
    const b = await listInspections(FACILITY_B, { page: 1, limit: 50 });
    expect(a.total).toBe(2);
    expect(b.total).toBe(1);
  });

  it("closeCitation rejects cross-tenant citation id", async () => {
    const insp = await mkInspection(FACILITY_A);
    const c = await addCitation(insp.id, FACILITY_A, { citationTitle: "x" }, ACTOR);
    expect(c).toBeDefined();
    const wrong = await closeCitation(c!.id, FACILITY_B, ACTOR, "trying");
    expect(wrong).toBeUndefined();
  });
});
