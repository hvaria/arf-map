/**
 * Wave 4 Phase 4.1 (W6) — Posting verification storage tests.
 *
 * Coverage:
 *  - seedDefaultPostings: idempotent on second call; every key seeded;
 *    seeded rows are tagged placeholder:true (created_by === 'system_seed').
 *  - CRUD tenant isolation.
 *  - postingFreshness cases via the list endpoint join (ok / stale /
 *    missing).
 *  - Archive then re-create same key — partial unique allows it.
 *  - createPostingVerification does not bump evidence_count on its own.
 *  - bumpVerificationEvidenceCount increments + decrements correctly.
 *  - getPostingRollup totals are accurate.
 *
 * Conventions reused from server/__tests__/ops/obligations.test.ts.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { bootstrapOpsSchema } from "../../ops/opsStorage";
import {
  archivePostingCatalogEntry,
  bumpVerificationEvidenceCount,
  createPostingCatalogEntry,
  createPostingVerification,
  getPostingRollup,
  listPostingCatalog,
  seedDefaultPostings,
  updatePostingCatalogEntry,
} from "../../ops/postingsStorage";
import { POSTING_KEYS } from "@shared/postings";

const FACILITY_A = "TEST-FAC-POSTING-A";
const FACILITY_B = "TEST-FAC-POSTING-B";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const ACTOR = { id: "alice", role: "admin" };
const DAY = 24 * 60 * 60 * 1000;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_posting_verifications WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_posting_catalog       WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail            WHERE facility_number = ANY($1::text[])`,
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

describe("seedDefaultPostings", () => {
  it("creates one row per POSTING_KEYS entry on first call, zero on second", async () => {
    const first = await seedDefaultPostings(FACILITY_A, ACTOR);
    expect(first.created).toBe(POSTING_KEYS.length);
    expect(first.skipped).toBe(0);
    const second = await seedDefaultPostings(FACILITY_A, ACTOR);
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(POSTING_KEYS.length);
  });

  it("tags every seeded row as placeholder:true and freshness:'missing'", async () => {
    await seedDefaultPostings(FACILITY_A, ACTOR);
    const rows = await listPostingCatalog(FACILITY_A);
    expect(rows.length).toBe(POSTING_KEYS.length);
    for (const r of rows) {
      expect(r.placeholder, `key=${r.postingKey}`).toBe(true);
      expect(r.freshness, `key=${r.postingKey}`).toBe("missing");
      expect(r.latestVerification).toBeNull();
      expect(r.createdBy).toBe("system_seed");
    }
  });

  it("isolates tenants — seeding A does not affect B", async () => {
    await seedDefaultPostings(FACILITY_A, ACTOR);
    const rowsB = await listPostingCatalog(FACILITY_B);
    expect(rowsB.length).toBe(0);
  });
});

describe("postingFreshness via list", () => {
  it("returns 'ok' when latest verification is 'current' AND within cadence", async () => {
    const row = await createPostingCatalogEntry(
      {
        facilityNumber: FACILITY_A,
        postingKey: "license_certificate",
        titleEn: "Facility license certificate",
        titleEs: null,
        locationHint: "Lobby",
        required: 1,
        cadenceDays: 90,
        notes: null,
        status: "active",
        createdBy: ACTOR.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    await createPostingVerification(
      {
        facilityNumber: FACILITY_A,
        catalogId: row.id,
        postingKey: "license_certificate",
        verifiedAt: Date.now() - 10 * DAY,
        verifiedBy: ACTOR.id,
        status: "current",
        note: null,
        evidenceCount: 0,
        createdAt: Date.now(),
      },
      ACTOR,
    );
    const rows = await listPostingCatalog(FACILITY_A);
    const it = rows.find((r) => r.id === row.id)!;
    expect(it.freshness).toBe("ok");
    expect(it.latestVerification?.status).toBe("current");
  });

  it("returns 'stale' when status='current' but older than cadenceDays", async () => {
    const row = await createPostingCatalogEntry(
      {
        facilityNumber: FACILITY_A,
        postingKey: "residents_rights",
        titleEn: "Residents' rights",
        titleEs: null,
        locationHint: "Common area",
        required: 1,
        cadenceDays: 30,
        notes: null,
        status: "active",
        createdBy: ACTOR.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    await createPostingVerification(
      {
        facilityNumber: FACILITY_A,
        catalogId: row.id,
        postingKey: "residents_rights",
        verifiedAt: Date.now() - 60 * DAY,
        verifiedBy: ACTOR.id,
        status: "current",
        note: null,
        evidenceCount: 0,
        createdAt: Date.now(),
      },
      ACTOR,
    );
    const rows = await listPostingCatalog(FACILITY_A);
    const it = rows.find((r) => r.id === row.id)!;
    expect(it.freshness).toBe("stale");
  });

  it("returns 'missing' when latest verification status != 'current'", async () => {
    const row = await createPostingCatalogEntry(
      {
        facilityNumber: FACILITY_A,
        postingKey: "fire_safety_notice",
        titleEn: "Fire safety procedures",
        titleEs: null,
        locationHint: "Kitchen",
        required: 1,
        cadenceDays: 60,
        notes: null,
        status: "active",
        createdBy: ACTOR.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    await createPostingVerification(
      {
        facilityNumber: FACILITY_A,
        catalogId: row.id,
        postingKey: "fire_safety_notice",
        verifiedAt: Date.now() - 5 * DAY,
        verifiedBy: ACTOR.id,
        status: "damaged",
        note: "torn corner",
        evidenceCount: 0,
        createdAt: Date.now(),
      },
      ACTOR,
    );
    const rows = await listPostingCatalog(FACILITY_A);
    const it = rows.find((r) => r.id === row.id)!;
    expect(it.freshness).toBe("missing");
    expect(it.latestVerification?.status).toBe("damaged");
  });
});

describe("archive then re-create same posting_key", () => {
  it("allows re-add of an archived posting_key (partial unique only constrains active)", async () => {
    const row1 = await createPostingCatalogEntry(
      {
        facilityNumber: FACILITY_A,
        postingKey: "no_smoking",
        titleEn: "No smoking",
        titleEs: null,
        locationHint: "Entry",
        required: 1,
        cadenceDays: 90,
        notes: null,
        status: "active",
        createdBy: ACTOR.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    const archived = await archivePostingCatalogEntry(row1.id, FACILITY_A, ACTOR);
    expect(archived).toBe(true);
    // Now insert a NEW active row with the same key — must succeed.
    const row2 = await createPostingCatalogEntry(
      {
        facilityNumber: FACILITY_A,
        postingKey: "no_smoking",
        titleEn: "No smoking (replacement)",
        titleEs: null,
        locationHint: "Entry + lounge",
        required: 1,
        cadenceDays: 90,
        notes: null,
        status: "active",
        createdBy: ACTOR.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    expect(row2.id).not.toBe(row1.id);
  });
});

describe("createPostingVerification + evidence_count", () => {
  it("starts with evidence_count = 0 (the route does not bump on its own)", async () => {
    const row = await createPostingCatalogEntry(
      {
        facilityNumber: FACILITY_A,
        postingKey: "ombudsman_contact",
        titleEn: "Ombudsman contact",
        titleEs: null,
        locationHint: "Common",
        required: 1,
        cadenceDays: 30,
        notes: null,
        status: "active",
        createdBy: ACTOR.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    const verif = await createPostingVerification(
      {
        facilityNumber: FACILITY_A,
        catalogId: row.id,
        postingKey: "ombudsman_contact",
        verifiedAt: Date.now(),
        verifiedBy: ACTOR.id,
        status: "current",
        note: null,
        evidenceCount: 0,
        createdAt: Date.now(),
      },
      ACTOR,
    );
    expect(verif.evidenceCount).toBe(0);
  });

  it("bumpVerificationEvidenceCount(+1 / -1) updates the column atomically", async () => {
    const row = await createPostingCatalogEntry(
      {
        facilityNumber: FACILITY_A,
        postingKey: "complaint_process",
        titleEn: "Complaint",
        titleEs: null,
        locationHint: "Lobby",
        required: 1,
        cadenceDays: 30,
        notes: null,
        status: "active",
        createdBy: ACTOR.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    const verif = await createPostingVerification(
      {
        facilityNumber: FACILITY_A,
        catalogId: row.id,
        postingKey: "complaint_process",
        verifiedAt: Date.now(),
        verifiedBy: ACTOR.id,
        status: "current",
        note: null,
        evidenceCount: 0,
        createdAt: Date.now(),
      },
      ACTOR,
    );
    await bumpVerificationEvidenceCount(verif.id, FACILITY_A, +1);
    await bumpVerificationEvidenceCount(verif.id, FACILITY_A, +1);
    let { rows: r } = await pool.query<{ evidence_count: number }>(
      `SELECT evidence_count FROM ops_posting_verifications WHERE id = $1`,
      [verif.id],
    );
    expect(Number(r[0].evidence_count)).toBe(2);
    await bumpVerificationEvidenceCount(verif.id, FACILITY_A, -1);
    r = (
      await pool.query<{ evidence_count: number }>(
        `SELECT evidence_count FROM ops_posting_verifications WHERE id = $1`,
        [verif.id],
      )
    ).rows;
    expect(Number(r[0].evidence_count)).toBe(1);
  });

  it("never decrements below zero (GREATEST clamp)", async () => {
    const row = await createPostingCatalogEntry(
      {
        facilityNumber: FACILITY_A,
        postingKey: "evacuation_route",
        titleEn: "Evacuation",
        titleEs: null,
        locationHint: "Hallway",
        required: 1,
        cadenceDays: 30,
        notes: null,
        status: "active",
        createdBy: ACTOR.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    const verif = await createPostingVerification(
      {
        facilityNumber: FACILITY_A,
        catalogId: row.id,
        postingKey: "evacuation_route",
        verifiedAt: Date.now(),
        verifiedBy: ACTOR.id,
        status: "current",
        note: null,
        evidenceCount: 0,
        createdAt: Date.now(),
      },
      ACTOR,
    );
    await bumpVerificationEvidenceCount(verif.id, FACILITY_A, -1);
    const r = await pool.query<{ evidence_count: number }>(
      `SELECT evidence_count FROM ops_posting_verifications WHERE id = $1`,
      [verif.id],
    );
    expect(Number(r.rows[0].evidence_count)).toBe(0);
  });
});

describe("getPostingRollup", () => {
  it("counts ok + stale + missing correctly", async () => {
    const okRow = await createPostingCatalogEntry(
      {
        facilityNumber: FACILITY_A,
        postingKey: "license_certificate",
        titleEn: "License",
        titleEs: null,
        locationHint: "Lobby",
        required: 1,
        cadenceDays: 90,
        notes: null,
        status: "active",
        createdBy: ACTOR.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    await createPostingVerification(
      {
        facilityNumber: FACILITY_A,
        catalogId: okRow.id,
        postingKey: "license_certificate",
        verifiedAt: Date.now() - 10 * DAY,
        verifiedBy: ACTOR.id,
        status: "current",
        note: null,
        evidenceCount: 0,
        createdAt: Date.now(),
      },
      ACTOR,
    );
    const staleRow = await createPostingCatalogEntry(
      {
        facilityNumber: FACILITY_A,
        postingKey: "residents_rights",
        titleEn: "Rights",
        titleEs: null,
        locationHint: "Common",
        required: 1,
        cadenceDays: 30,
        notes: null,
        status: "active",
        createdBy: ACTOR.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    await createPostingVerification(
      {
        facilityNumber: FACILITY_A,
        catalogId: staleRow.id,
        postingKey: "residents_rights",
        verifiedAt: Date.now() - 100 * DAY,
        verifiedBy: ACTOR.id,
        status: "current",
        note: null,
        evidenceCount: 0,
        createdAt: Date.now(),
      },
      ACTOR,
    );
    await createPostingCatalogEntry(
      {
        facilityNumber: FACILITY_A,
        postingKey: "ombudsman_contact",
        titleEn: "Ombudsman",
        titleEs: null,
        locationHint: "Common",
        required: 1,
        cadenceDays: 30,
        notes: null,
        status: "active",
        createdBy: ACTOR.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    const rollup = await getPostingRollup(FACILITY_A);
    expect(rollup.total).toBe(3);
    expect(rollup.ok).toBe(1);
    expect(rollup.stale).toBe(1);
    expect(rollup.missing).toBe(1);
  });
});

describe("update tenant isolation", () => {
  it("update returns undefined when the row belongs to a different facility", async () => {
    const row = await createPostingCatalogEntry(
      {
        facilityNumber: FACILITY_A,
        postingKey: "license_certificate",
        titleEn: "License",
        titleEs: null,
        locationHint: "Lobby",
        required: 1,
        cadenceDays: 90,
        notes: null,
        status: "active",
        createdBy: ACTOR.id,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      },
      ACTOR,
    );
    const result = await updatePostingCatalogEntry(
      row.id,
      FACILITY_B,
      { titleEn: "Hijacked" },
      ACTOR,
    );
    expect(result).toBeUndefined();
  });
});
