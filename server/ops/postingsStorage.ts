/**
 * Wave 4 Phase 4.1 (W6) — Posting verification storage.
 *
 * Pattern mirrored from server/ops/shareLinksStorage.ts:
 *   - Module-level async functions; shared Drizzle `db` + raw `pool`.
 *   - Tenant isolation enforced at the storage layer on every WHERE.
 *   - Every mutation emits an audit row via `recordAudit({ entityType:
 *     'ops_posting_catalog' | 'ops_posting_verification', … })` wrapped in
 *     try/catch — an audit failure never rolls back the user-visible
 *     mutation.
 *
 * Catalog vs verification:
 *   - ops_posting_catalog rows are the per-facility "what posting goes
 *     where" config. Status is 'active' or 'archived' (the DDL has a
 *     partial unique index on (facility_number, posting_key) WHERE
 *     status='active' so archive + re-add of the same key is allowed).
 *   - ops_posting_verifications are append-only walkthrough log entries.
 *     `evidence_count` is a denormalized counter the backend bumps when an
 *     ops_evidence_attachment is attached/detached (cheap list reads, no
 *     JOIN).
 *
 * Seeding (B12 placeholder):
 *   - `seedDefaultPostings` is idempotent. For each key in POSTING_KEYS
 *     not already present (active) at this facility, insert one with
 *     POSTING_DEFAULTS[key] as the values and `created_by='system_seed'`.
 *     UI uses `placeholder: true` (derived from created_by) to render the
 *     [V] chip until an admin confirms.
 *
 * Freshness:
 *   - `listPostingCatalog` joins to the latest verification per catalog
 *     entry via a LATERAL subquery and computes `freshness` via
 *     `postingFreshness()` from @shared/postings. ONE query, no N+1.
 */

import { and, desc, eq, sql } from "drizzle-orm";

import { db, pool } from "../db/index";
import { opsPostingCatalog, opsPostingVerifications } from "./opsSchema";
import type {
  InsertOpsPostingCatalog,
  InsertOpsPostingVerification,
  OpsPostingCatalog,
  OpsPostingVerification,
} from "./opsSchema";
import { recordAudit, type AuditActor } from "./auditStorage";
import {
  POSTING_DEFAULTS,
  POSTING_KEYS,
  POSTING_VERIFICATION_STATUSES,
  postingFreshness,
  type PostingKey,
  type PostingVerificationStatus,
} from "@shared/postings";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export interface PostingCatalogRow extends OpsPostingCatalog {
  /** Latest verification on file for this posting, if any. */
  latestVerification: OpsPostingVerification | null;
  /** Computed via shared/postings.ts postingFreshness(). */
  freshness: "ok" | "stale" | "missing";
  /** True when this row originated from POSTING_DEFAULTS (B12 placeholder). */
  placeholder: boolean;
}

const SYSTEM_SEED_ACTOR = "system_seed";

const POSTING_KEY_SET: ReadonlySet<string> = new Set<string>(POSTING_KEYS);
const POSTING_VERIFICATION_STATUS_SET: ReadonlySet<string> = new Set<string>(
  POSTING_VERIFICATION_STATUSES,
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function safeAudit(args: {
  facilityNumber: string;
  actor: AuditActor;
  action: "create" | "update" | "delete";
  entityType: "ops_posting_catalog" | "ops_posting_verification";
  entityId: number;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  try {
    await recordAudit({
      facilityNumber: args.facilityNumber,
      actorId: args.actor.id,
      actorRole: args.actor.role,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      before: args.before,
      after: args.after,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[ops] audit emit failed for ${args.entityType}#${args.entityId}`,
      err,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Seed defaults
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Idempotent. For each posting_key in POSTING_KEYS not already present as
 * an active catalog row at this facility, insert one with
 * POSTING_DEFAULTS[key] as the seed values and `created_by='system_seed'`.
 *
 * Implementation: pre-SELECT the existing active keys (one query),
 * compute the diff, then INSERT-only the missing ones. The partial UNIQUE
 * index on (facility_number, posting_key) WHERE status='active' also
 * guards against a concurrent seed double-firing — we collect 23505
 * violations defensively but expect zero in the steady-state path.
 */
export async function seedDefaultPostings(
  facilityNumber: string,
  actor: AuditActor,
): Promise<{ created: number; skipped: number }> {
  if (!facilityNumber) throw new Error("facilityNumber is required");

  const existingRes = await pool.query<{ posting_key: string }>(
    `SELECT posting_key FROM ops_posting_catalog
       WHERE facility_number = $1 AND status = 'active'`,
    [facilityNumber],
  );
  const existing = new Set<string>(existingRes.rows.map((r) => r.posting_key));

  const now = Date.now();
  let created = 0;
  let skipped = 0;

  for (const key of POSTING_KEYS) {
    if (existing.has(key)) {
      skipped += 1;
      continue;
    }
    const def = POSTING_DEFAULTS[key];
    try {
      const rows = await db
        .insert(opsPostingCatalog)
        .values({
          facilityNumber,
          postingKey: key,
          titleEn: def.titleEn,
          titleEs: def.titleEs ?? null,
          locationHint: def.locationHint,
          required: def.required ? 1 : 0,
          cadenceDays: def.cadenceDays,
          notes: null,
          status: "active",
          createdBy: SYSTEM_SEED_ACTOR,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = rows[0] as OpsPostingCatalog | undefined;
      if (row) {
        created += 1;
        await safeAudit({
          facilityNumber,
          actor,
          action: "create",
          entityType: "ops_posting_catalog",
          entityId: row.id,
          after: { ...row, placeholder: true },
        });
      } else {
        skipped += 1;
      }
    } catch (err) {
      // Defense in depth — partial unique should be the only path here.
      const code = (err as { code?: string }).code;
      if (code === "23505") {
        skipped += 1;
        continue;
      }
      throw err;
    }
  }

  return { created, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// List catalog (with latest verification join + freshness)
// ─────────────────────────────────────────────────────────────────────────────

interface CatalogJoinRow {
  // Catalog fields
  id: number;
  facility_number: string;
  posting_key: string;
  title_en: string;
  title_es: string | null;
  location_hint: string | null;
  required: number;
  cadence_days: number;
  notes: string | null;
  status: string;
  created_by: string;
  created_at: string | number;
  updated_at: string | number;
  // Latest verification fields (nullable when no verification exists)
  v_id: number | null;
  v_facility_number: string | null;
  v_catalog_id: number | null;
  v_posting_key: string | null;
  v_verified_at: string | number | null;
  v_verified_by: string | null;
  v_status: string | null;
  v_note: string | null;
  v_evidence_count: number | null;
  v_created_at: string | number | null;
}

function toNumber(v: string | number | null | undefined): number {
  if (v === null || v === undefined) return 0;
  return typeof v === "number" ? v : Number(v);
}

function shapeCatalogRow(r: CatalogJoinRow, now: number): PostingCatalogRow {
  // Phase 3: updatedBy / createdBy on the verification row map to null in this
  // legacy join projection — the raw SQL above doesn't fetch them. The DB
  // DEFAULT 'system' takes care of population on insert; UI flows here only
  // read the catalog/freshness columns.
  const catalog: OpsPostingCatalog = {
    id: Number(r.id),
    facilityNumber: r.facility_number,
    postingKey: r.posting_key,
    titleEn: r.title_en,
    titleEs: r.title_es,
    locationHint: r.location_hint,
    required: Number(r.required),
    cadenceDays: Number(r.cadence_days),
    notes: r.notes,
    status: r.status,
    createdBy: r.created_by,
    createdAt: toNumber(r.created_at),
    updatedAt: toNumber(r.updated_at),
    updatedBy: null,
  };

  let latest: OpsPostingVerification | null = null;
  if (r.v_id !== null && r.v_id !== undefined) {
    latest = {
      id: Number(r.v_id),
      facilityNumber: r.v_facility_number ?? "",
      catalogId: Number(r.v_catalog_id ?? 0),
      postingKey: r.v_posting_key ?? r.posting_key,
      verifiedAt: toNumber(r.v_verified_at),
      verifiedBy: r.v_verified_by ?? "",
      status: r.v_status ?? "missing",
      note: r.v_note,
      evidenceCount: Number(r.v_evidence_count ?? 0),
      createdAt: toNumber(r.v_created_at),
      updatedAt: null,
      createdBy: null,
      updatedBy: null,
    };
  }

  const freshness = postingFreshness(
    { cadenceDays: catalog.cadenceDays },
    latest
      ? {
          status: latest.status as PostingVerificationStatus,
          verifiedAt: latest.verifiedAt,
        }
      : null,
    now,
  );
  return {
    ...catalog,
    latestVerification: latest,
    freshness,
    placeholder: catalog.createdBy === SYSTEM_SEED_ACTOR,
  };
}

/**
 * List the posting catalog for a facility joined to the latest
 * verification row per entry. ONE SQL, no N+1. LATERAL is the planner-
 * friendly shape — Postgres uses idx_ops_posting_verif_catalog to pick
 * the newest row per catalog_id in one pass.
 */
export async function listPostingCatalog(
  facilityNumber: string,
  opts: { includeArchived?: boolean } = {},
): Promise<PostingCatalogRow[]> {
  if (!facilityNumber) throw new Error("facilityNumber is required");
  const includeArchived = opts.includeArchived === true;
  const now = Date.now();

  const statusFilter = includeArchived
    ? ""
    : `AND c.status = 'active'`;

  const res = await pool.query<CatalogJoinRow>(
    `SELECT
       c.id,
       c.facility_number,
       c.posting_key,
       c.title_en,
       c.title_es,
       c.location_hint,
       c.required,
       c.cadence_days,
       c.notes,
       c.status,
       c.created_by,
       c.created_at,
       c.updated_at,
       v.id                AS v_id,
       v.facility_number   AS v_facility_number,
       v.catalog_id        AS v_catalog_id,
       v.posting_key       AS v_posting_key,
       v.verified_at       AS v_verified_at,
       v.verified_by       AS v_verified_by,
       v.status            AS v_status,
       v.note              AS v_note,
       v.evidence_count    AS v_evidence_count,
       v.created_at        AS v_created_at
     FROM ops_posting_catalog c
     LEFT JOIN LATERAL (
       SELECT *
         FROM ops_posting_verifications vv
        WHERE vv.catalog_id = c.id
          AND vv.facility_number = c.facility_number
        ORDER BY vv.verified_at DESC, vv.id DESC
        LIMIT 1
     ) v ON TRUE
     WHERE c.facility_number = $1
       ${statusFilter}
     ORDER BY c.posting_key ASC, c.id ASC`,
    [facilityNumber],
  );

  return res.rows.map((r) => shapeCatalogRow(r, now));
}

export async function getPostingCatalogEntry(
  id: number,
  facilityNumber: string,
): Promise<PostingCatalogRow | undefined> {
  if (!facilityNumber) throw new Error("facilityNumber is required");
  const now = Date.now();
  const res = await pool.query<CatalogJoinRow>(
    `SELECT
       c.id, c.facility_number, c.posting_key, c.title_en, c.title_es,
       c.location_hint, c.required, c.cadence_days, c.notes, c.status,
       c.created_by, c.created_at, c.updated_at,
       v.id                AS v_id,
       v.facility_number   AS v_facility_number,
       v.catalog_id        AS v_catalog_id,
       v.posting_key       AS v_posting_key,
       v.verified_at       AS v_verified_at,
       v.verified_by       AS v_verified_by,
       v.status            AS v_status,
       v.note              AS v_note,
       v.evidence_count    AS v_evidence_count,
       v.created_at        AS v_created_at
     FROM ops_posting_catalog c
     LEFT JOIN LATERAL (
       SELECT *
         FROM ops_posting_verifications vv
        WHERE vv.catalog_id = c.id
          AND vv.facility_number = c.facility_number
        ORDER BY vv.verified_at DESC, vv.id DESC
        LIMIT 1
     ) v ON TRUE
     WHERE c.id = $1 AND c.facility_number = $2
     LIMIT 1`,
    [id, facilityNumber],
  );
  if (res.rows.length === 0) return undefined;
  return shapeCatalogRow(res.rows[0], now);
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / update / archive catalog entries
// ─────────────────────────────────────────────────────────────────────────────

export async function createPostingCatalogEntry(
  data: InsertOpsPostingCatalog,
  actor: AuditActor,
): Promise<OpsPostingCatalog> {
  if (!data.facilityNumber) throw new Error("facilityNumber is required");
  if (!data.postingKey || !POSTING_KEY_SET.has(data.postingKey)) {
    throw new Error(`Invalid posting_key: ${data.postingKey}`);
  }
  if (!data.titleEn) throw new Error("titleEn is required");

  const now = Date.now();
  const rows = await db
    .insert(opsPostingCatalog)
    .values({
      ...data,
      status: data.status ?? "active",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const row = rows[0] as OpsPostingCatalog;
  await safeAudit({
    facilityNumber: row.facilityNumber,
    actor,
    action: "create",
    entityType: "ops_posting_catalog",
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updatePostingCatalogEntry(
  id: number,
  facilityNumber: string,
  partial: Partial<InsertOpsPostingCatalog>,
  actor: AuditActor,
): Promise<OpsPostingCatalog | undefined> {
  // Strip server-managed fields so a careless caller can't reset them.
  const {
    id: _ignoreId,
    facilityNumber: _ignoreFn,
    createdAt: _ignoreCreated,
    createdBy: _ignoreCreatedBy,
    ...safe
  } = partial as Record<string, unknown>;
  void _ignoreId;
  void _ignoreFn;
  void _ignoreCreated;
  void _ignoreCreatedBy;

  const before = await pool.query<{
    id: number;
    posting_key: string;
    title_en: string;
    status: string;
  }>(
    `SELECT id, posting_key, title_en, status
       FROM ops_posting_catalog
      WHERE id = $1 AND facility_number = $2 LIMIT 1`,
    [id, facilityNumber],
  );
  if (before.rows.length === 0) return undefined;

  const now = Date.now();
  const rows = await db
    .update(opsPostingCatalog)
    .set({ ...(safe as Partial<InsertOpsPostingCatalog>), updatedAt: now })
    .where(
      and(
        eq(opsPostingCatalog.id, id),
        eq(opsPostingCatalog.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const after = rows[0] as OpsPostingCatalog | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "update",
      entityType: "ops_posting_catalog",
      entityId: after.id,
      before: before.rows[0],
      after,
    });
  }
  return after;
}

/**
 * Archive a catalog entry by flipping status='archived'. The partial
 * unique on (facility_number, posting_key) WHERE status='active' makes
 * archive + re-add of the same posting_key safe.
 */
export async function archivePostingCatalogEntry(
  id: number,
  facilityNumber: string,
  actor: AuditActor,
): Promise<boolean> {
  const now = Date.now();
  const rows = await db
    .update(opsPostingCatalog)
    .set({ status: "archived", updatedAt: now })
    .where(
      and(
        eq(opsPostingCatalog.id, id),
        eq(opsPostingCatalog.facilityNumber, facilityNumber),
        eq(opsPostingCatalog.status, "active"),
      ),
    )
    .returning();
  const after = rows[0] as OpsPostingCatalog | undefined;
  if (!after) return false;
  await safeAudit({
    facilityNumber,
    actor,
    action: "update",
    entityType: "ops_posting_catalog",
    entityId: after.id,
    after: { id: after.id, status: after.status },
  });
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Verifications
// ─────────────────────────────────────────────────────────────────────────────

export async function listPostingVerifications(
  facilityNumber: string,
  opts: { catalogId?: number; sinceMs?: number; page: number; limit: number },
): Promise<{ rows: OpsPostingVerification[]; total: number }> {
  const conds = [eq(opsPostingVerifications.facilityNumber, facilityNumber)];
  if (typeof opts.catalogId === "number") {
    conds.push(eq(opsPostingVerifications.catalogId, opts.catalogId));
  }
  if (typeof opts.sinceMs === "number") {
    conds.push(sql`${opsPostingVerifications.verifiedAt} >= ${opts.sinceMs}`);
  }
  const where = and(...conds);
  const offset = (opts.page - 1) * opts.limit;
  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(opsPostingVerifications)
      .where(where)
      .orderBy(
        desc(opsPostingVerifications.verifiedAt),
        desc(opsPostingVerifications.id),
      )
      .limit(opts.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsPostingVerifications)
      .where(where),
  ]);
  return { rows, total: countRows[0]?.count ?? 0 };
}

export async function createPostingVerification(
  data: InsertOpsPostingVerification,
  actor: AuditActor,
): Promise<OpsPostingVerification> {
  if (!data.facilityNumber) throw new Error("facilityNumber is required");
  if (!data.catalogId) throw new Error("catalogId is required");
  if (!data.status || !POSTING_VERIFICATION_STATUS_SET.has(data.status)) {
    throw new Error(`Invalid verification status: ${data.status}`);
  }
  // posting_key is denormalized — look it up from the catalog row when not
  // supplied so we can't end up with a verification pointing at a key the
  // catalog doesn't agree with.
  let postingKey = data.postingKey;
  const catalogRes = await pool.query<{ posting_key: string; facility_number: string }>(
    `SELECT posting_key, facility_number FROM ops_posting_catalog
       WHERE id = $1 LIMIT 1`,
    [data.catalogId],
  );
  if (catalogRes.rows.length === 0) {
    throw new Error(`Catalog #${data.catalogId} not found`);
  }
  if (catalogRes.rows[0].facility_number !== data.facilityNumber) {
    // Cross-tenant attempt — refuse and don't echo any catalog details.
    throw new Error(`Catalog #${data.catalogId} not found`);
  }
  if (!postingKey) postingKey = catalogRes.rows[0].posting_key as PostingKey;

  const now = Date.now();
  const rows = await db
    .insert(opsPostingVerifications)
    .values({
      ...data,
      postingKey,
      evidenceCount: data.evidenceCount ?? 0,
      createdAt: now,
    })
    .returning();
  const row = rows[0] as OpsPostingVerification;
  await safeAudit({
    facilityNumber: row.facilityNumber,
    actor,
    action: "create",
    entityType: "ops_posting_verification",
    entityId: row.id,
    after: row,
  });
  return row;
}

/**
 * Bump evidence_count on a verification row. Called by attachEvidence /
 * softDeleteEvidence in evidenceStorage when entityType ===
 * 'ops_posting_verification'. Best-effort — failures are logged but do
 * NOT bubble back up to the evidence mutation.
 */
export async function bumpVerificationEvidenceCount(
  verificationId: number,
  facilityNumber: string,
  delta: number,
): Promise<void> {
  if (!verificationId || !facilityNumber) return;
  if (delta !== 1 && delta !== -1) {
    throw new Error(`bumpVerificationEvidenceCount: delta must be ±1`);
  }
  try {
    await pool.query(
      `UPDATE ops_posting_verifications
          SET evidence_count = GREATEST(evidence_count + $1, 0)
        WHERE id = $2 AND facility_number = $3`,
      [delta, verificationId, facilityNumber],
    );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[postingsStorage] bumpVerificationEvidenceCount(${verificationId},${delta}) failed`,
      err,
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Rollup (daily-triage + tab summary tiles)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * One-row rollup of active catalog entries grouped by freshness. Used by
 * the daily-triage aggregator + the Postings tab summary tiles. Computes
 * the freshness in JS off the LATERAL join so the cadence math stays in
 * one place (`postingFreshness()` in @shared/postings).
 */
export async function getPostingRollup(
  facilityNumber: string,
): Promise<{ ok: number; stale: number; missing: number; total: number }> {
  const rows = await listPostingCatalog(facilityNumber, { includeArchived: false });
  let ok = 0;
  let stale = 0;
  let missing = 0;
  for (const r of rows) {
    if (r.freshness === "ok") ok += 1;
    else if (r.freshness === "stale") stale += 1;
    else missing += 1;
  }
  return { ok, stale, missing, total: rows.length };
}
