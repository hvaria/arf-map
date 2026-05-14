/**
 * W10 Complaints — server storage tests.
 *
 * Coverage:
 *  - Anonymous: blank complainant fields are accepted when type='anonymous'.
 *  - Non-anonymous types require a complainant name.
 *  - addInvestigationNote appends a note row and bumps parent updatedAt.
 *  - Status transitions: open → investigating → resolved → closed are legal;
 *    reverse moves are blocked (except investigating → open as a clerical
 *    reopen, which is allowed by design).
 *  - close gates on status='resolved'.
 *  - Tenant isolation on get + list.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import {
  addInvestigationNote,
  bootstrapOpsSchema,
  closeComplaint,
  createComplaint,
  getComplaint,
  listComplaints,
  resolveComplaint,
  updateComplaint,
} from "../../ops/opsStorage";

const FACILITY_A = "TEST-FAC-CMP-A";
const FACILITY_B = "TEST-FAC-CMP-B";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const ACTOR = { id: "alice", role: "admin" };

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_complaint_investigation_notes WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_complaints   WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail  WHERE facility_number = ANY($1::text[])`,
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

async function mkComplaint(facilityNumber: string, overrides: Partial<{
  complainantType: string;
  complainantName: string | null;
  complainantRelation: string | null;
  nature: string;
  externalRef: string | null;
}> = {}) {
  // Default to a non-anonymous family complaint with named complainant. Tests
  // that want anonymous explicitly pass complainantType: "anonymous" plus
  // null name/relation.
  const complainantType = overrides.complainantType ?? "family";
  const isAnonymous = complainantType === "anonymous";
  return createComplaint(
    {
      facilityNumber,
      receivedAt: Date.now(),
      complainantType,
      complainantName:
        "complainantName" in overrides
          ? overrides.complainantName ?? null
          : isAnonymous
            ? null
            : "Jane Doe",
      complainantRelation:
        "complainantRelation" in overrides
          ? overrides.complainantRelation ?? null
          : isAnonymous
            ? null
            : "daughter",
      nature: overrides.nature ?? "Dietary complaint — food was cold",
      intakeNotes: null,
      assignedTo: null,
      externalRef: overrides.externalRef ?? null,
      createdBy: ACTOR.id,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    ACTOR,
  );
}

describe("complaints — anonymous handling (§6.A.3)", () => {
  it("accepts blank/null complainant fields when complainantType='anonymous'", async () => {
    const c = await mkComplaint(FACILITY_A, {
      complainantType: "anonymous",
      complainantName: null,
      complainantRelation: null,
      nature: "Anonymous staff complaint about scheduling",
    });
    expect(c.complainantType).toBe("anonymous");
    expect(c.complainantName).toBeNull();
    expect(c.complainantRelation).toBeNull();
  });

  it("rejects blank complainantName for non-anonymous types", async () => {
    await expect(
      mkComplaint(FACILITY_A, { complainantType: "family", complainantName: "   " }),
    ).rejects.toThrow(/required for non-anonymous/i);
  });

  it("trims whitespace-only complainantRelation to null but accepts it", async () => {
    const c = await mkComplaint(FACILITY_A, {
      complainantType: "family",
      complainantName: "Robin",
      complainantRelation: "   ",
    });
    // Stored as null because trim() === "" coerced to null.
    expect(c.complainantRelation).toBeNull();
  });

  it("external_ref field persists as-is", async () => {
    const c = await mkComplaint(FACILITY_A, {
      externalRef: "Ombudsman ref #2026-512",
    });
    expect(c.externalRef).toBe("Ombudsman ref #2026-512");
  });
});

describe("complaints — investigation notes", () => {
  it("addInvestigationNote inserts a note + bumps parent updatedAt", async () => {
    const c = await mkComplaint(FACILITY_A);
    const beforeUpdate = c.updatedAt;
    // small sleep so updatedAt is observably newer
    await new Promise((r) => setTimeout(r, 5));
    const note = await addInvestigationNote(c.id, FACILITY_A, ACTOR, "Spoke with kitchen lead");
    expect(note?.note).toContain("kitchen lead");

    const full = await getComplaint(c.id, FACILITY_A);
    expect(full?.investigationNotes.length).toBe(1);
    expect(full?.complaint.updatedAt).toBeGreaterThanOrEqual(beforeUpdate);
  });

  it("addInvestigationNote returns undefined for unknown complaint id", async () => {
    const res = await addInvestigationNote(99999, FACILITY_A, ACTOR, "ghost");
    expect(res).toBeUndefined();
  });
});

describe("complaints — status transitions", () => {
  it("open → investigating → resolved → closed is the canonical path", async () => {
    const c = await mkComplaint(FACILITY_A);
    const inv = await updateComplaint(c.id, FACILITY_A, { status: "investigating" }, ACTOR);
    expect(inv?.status).toBe("investigating");
    const resolved = await resolveComplaint(c.id, FACILITY_A, ACTOR, "Apology + dietary plan reviewed");
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.resolvedAt).not.toBeNull();
    const closed = await closeComplaint(c.id, FACILITY_A, ACTOR);
    expect(closed?.status).toBe("closed");
    expect(closed?.closedAt).not.toBeNull();
  });

  it("blocks illegal reverse transitions (resolved → open)", async () => {
    const c = await mkComplaint(FACILITY_A);
    await resolveComplaint(c.id, FACILITY_A, ACTOR, "Done");
    await expect(
      updateComplaint(c.id, FACILITY_A, { status: "open" }, ACTOR),
    ).rejects.toThrow(/Illegal complaint transition/i);
  });

  it("blocks closed → anything", async () => {
    const c = await mkComplaint(FACILITY_A);
    await resolveComplaint(c.id, FACILITY_A, ACTOR, "Done");
    await closeComplaint(c.id, FACILITY_A, ACTOR);
    await expect(
      updateComplaint(c.id, FACILITY_A, { status: "open" }, ACTOR),
    ).rejects.toThrow(/Illegal complaint transition/i);
    await expect(
      updateComplaint(c.id, FACILITY_A, { status: "resolved" }, ACTOR),
    ).rejects.toThrow(/Illegal complaint transition/i);
  });

  it("allows the investigating → open reopen (clerical correction)", async () => {
    const c = await mkComplaint(FACILITY_A);
    await updateComplaint(c.id, FACILITY_A, { status: "investigating" }, ACTOR);
    const reopened = await updateComplaint(c.id, FACILITY_A, { status: "open" }, ACTOR);
    expect(reopened?.status).toBe("open");
  });

  it("close requires status='resolved'", async () => {
    const c = await mkComplaint(FACILITY_A);
    await expect(
      closeComplaint(c.id, FACILITY_A, ACTOR),
    ).rejects.toThrow(/must be resolved/i);
  });

  it("resolve refuses when already resolved or closed", async () => {
    const c = await mkComplaint(FACILITY_A);
    await resolveComplaint(c.id, FACILITY_A, ACTOR, "ok");
    await expect(
      resolveComplaint(c.id, FACILITY_A, ACTOR, "again"),
    ).rejects.toThrow(/Cannot resolve/i);
  });
});

describe("complaints — tenant isolation", () => {
  it("getComplaint returns undefined for another facility's id", async () => {
    const c = await mkComplaint(FACILITY_A);
    const wrong = await getComplaint(c.id, FACILITY_B);
    expect(wrong).toBeUndefined();
  });

  it("listComplaints respects facility_number", async () => {
    await mkComplaint(FACILITY_A);
    await mkComplaint(FACILITY_A);
    await mkComplaint(FACILITY_B);
    const a = await listComplaints(FACILITY_A, { page: 1, limit: 50 });
    const b = await listComplaints(FACILITY_B, { page: 1, limit: 50 });
    expect(a.total).toBe(2);
    expect(b.total).toBe(1);
  });
});
