/**
 * Trackers module — repository / storage layer.
 *
 * Mirrors the pattern in server/ops/notesStorage.ts:
 *   - bootstrap*Schema()   → DDL on startup
 *   - writeTrackerAudit()  → per-mutation audit-log row
 *   - db.transaction(...)  → multi-write atomicity (versioning, bulk insert)
 *
 * Every write requires a caller-generated UUID `clientId`. The
 * `(facility_number, client_id)` unique index in trackerSchema.ts is the
 * safety net; we also pre-check before insert to keep the `duplicate: true`
 * envelope cheap on retry.
 *
 * Soft-delete only — `status='deleted'` + `deleted_at` + `deleted_by_account_id`.
 * Multi-tenant isolation: every read is scoped by `facility_number`. A
 * facility A request for a facility B entry returns `null` here; the router
 * surfaces that as 404 (matches notes' existence-leak avoidance).
 */

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import type { Request } from "express";

import { db, pool } from "../db/index";
import {
  TRACKERS_PG_SCHEMA_SQL,
  trackerAuditLog,
  trackerDefinitions,
  trackerEntries,
  trackerEntryVersions,
  type NewTrackerEntryRow,
  type TrackerAuditAction,
  type TrackerAuditEntityType,
  type TrackerEntryRow,
  type TrackerEntryVersionRow,
} from "./trackerSchema";
import {
  TRACKER_REGISTRY,
  serializeDefinitionForClient,
  type Shift,
} from "./registry";

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap (called from server/index.ts after bootstrapNotesSchema)
// ─────────────────────────────────────────────────────────────────────────────

export async function bootstrapTrackersSchema(): Promise<void> {
  await pool.query(TRACKERS_PG_SCHEMA_SQL);
  console.log("[trackers] PostgreSQL tables bootstrapped");
  await seedTrackerDefinitions();
}

/**
 * Upsert every entry from `TRACKER_REGISTRY` into `tracker_definitions`.
 *
 * Runs inside `bootstrapTrackersSchema` after DDL. Idempotent — `ON CONFLICT
 * (slug) DO UPDATE` keeps the row in sync if the in-process registry changes
 * across deploys. The `config_json` column gets the JSON-safe (Zod-stripped)
 * shape so it can be served unchanged to the client.
 */
async function seedTrackerDefinitions(): Promise<void> {
  const now = Date.now();
  const entries = Object.values(TRACKER_REGISTRY);
  for (const def of entries) {
    const configJson = JSON.stringify(serializeDefinitionForClient(def));
    // Phase B note: `isActive === undefined` means active.
    const isActive = def.isActive === false ? 0 : 1;
    await pool.query(
      `INSERT INTO tracker_definitions
         (slug, name, category, schema_version, config_json, is_active, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
       ON CONFLICT (slug) DO UPDATE SET
         name = EXCLUDED.name,
         category = EXCLUDED.category,
         schema_version = EXCLUDED.schema_version,
         config_json = EXCLUDED.config_json,
         is_active = EXCLUDED.is_active,
         updated_at = EXCLUDED.updated_at`,
      [
        def.slug,
        def.name,
        def.category,
        def.schemaVersion,
        configJson,
        isActive,
        now,
      ],
    );
  }
  console.log(
    `[trackers] seeded ${entries.length} tracker definition(s) into tracker_definitions`,
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Actor / request context
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Every storage write captures the acting facility user. `staffId` is `null`
 * for now — the foundation does not link facility accounts to ops_staff.
 */
export type ActorCtx = {
  facilityAccountId: number;
  staffId?: number | null;
  displayName: string;
  role: string;
};

export type TrackerRequestContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Errors
// ─────────────────────────────────────────────────────────────────────────────

export class TrackerNotFoundError extends Error {
  constructor(message = "Tracker entry not found") {
    super(message);
    this.name = "TrackerNotFoundError";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

const UUID_RX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(s: unknown): s is string {
  return typeof s === "string" && UUID_RX.test(s);
}

function first<T>(rows: T[]): T | undefined {
  return rows[0];
}

function fromBool(b: boolean): number {
  return b ? 1 : 0;
}

/**
 * Hydrated row type — the on-disk `payload` column is TEXT (JSON), but at the
 * storage boundary we parse it once so route handlers can return the row
 * as-is (mirrors the Notes module). Drizzle infers `payload: string` from the
 * column type, which would be a lie post-hydration; this type is the truth.
 */
export type HydratedTrackerEntryRow =
  Omit<TrackerEntryRow, "payload"> & { payload: unknown };

export type HydratedTrackerEntryVersionRow =
  Omit<TrackerEntryVersionRow, "payloadSnapshot"> & { payloadSnapshot: unknown };

/**
 * Trackers store payloads as TEXT (JSON). House style on Notes parses on the
 * way out so route handlers can return the row as-is. Match that here.
 */
function hydrateEntry(row: TrackerEntryRow): HydratedTrackerEntryRow {
  return {
    ...row,
    payload: parsePayload(row.payload),
  };
}

function parsePayload(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    // Defensive: shouldn't happen because we always JSON.stringify on insert.
    return raw;
  }
}

function hydrateVersion(
  row: TrackerEntryVersionRow,
): HydratedTrackerEntryVersionRow {
  return {
    ...row,
    payloadSnapshot: parsePayload(row.payloadSnapshot),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit log
// ─────────────────────────────────────────────────────────────────────────────

export type WriteTrackerAuditInput = {
  entityType: TrackerAuditEntityType;
  entityId: number;
  action: TrackerAuditAction;
  actor: ActorCtx;
  facilityNumber: string;
  before?: unknown;
  after?: unknown;
  req?: Request;
  reqCtx?: TrackerRequestContext;
};

/**
 * Insert a single row into `tracker_audit_log`.
 *
 * IP/user-agent are pulled from the optional `req` (preferred — it's what the
 * router has) or an explicit `reqCtx` (used by the bulk path which extracts
 * once and reuses for every item). Either is fine; one is required to capture
 * client metadata.
 */
export async function writeTrackerAudit(
  input: WriteTrackerAuditInput,
): Promise<void> {
  const ip =
    input.req?.ip ??
    input.req?.socket?.remoteAddress ??
    input.reqCtx?.ipAddress ??
    null;
  const ua =
    input.req?.headers?.["user-agent"] ??
    input.reqCtx?.userAgent ??
    null;

  await db.insert(trackerAuditLog).values({
    entityType: input.entityType,
    entityId: input.entityId,
    action: input.action,
    actorFacilityAccountId: input.actor.facilityAccountId,
    actorStaffId: input.actor.staffId ?? null,
    facilityNumber: input.facilityNumber,
    before: input.before === undefined ? null : JSON.stringify(input.before),
    after: input.after === undefined ? null : JSON.stringify(input.after),
    ipAddress: typeof ip === "string" ? ip : null,
    userAgent: typeof ua === "string" ? ua : null,
    createdAt: Date.now(),
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Single-entry helpers
// ─────────────────────────────────────────────────────────────────────────────

export async function findEntryByClientId(
  facilityNumber: string,
  clientId: string,
): Promise<HydratedTrackerEntryRow | null> {
  if (!isUuid(clientId)) return null;
  const rows = await db
    .select()
    .from(trackerEntries)
    .where(
      and(
        eq(trackerEntries.facilityNumber, facilityNumber),
        eq(trackerEntries.clientId, clientId),
      ),
    );
  const row = first(rows);
  return row ? hydrateEntry(row) : null;
}

export async function getEntryById(
  id: number,
  facilityNumber: string,
): Promise<HydratedTrackerEntryRow | null> {
  const rows = await db
    .select()
    .from(trackerEntries)
    .where(
      and(
        eq(trackerEntries.id, id),
        eq(trackerEntries.facilityNumber, facilityNumber),
      ),
    );
  const row = first(rows);
  return row ? hydrateEntry(row) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Insert single entry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Caller is expected to have already validated payload + checked that
 * `clientId` is fresh. The unique index on (facility_number, client_id)
 * is the final safety net — duplicate inserts will throw and the caller
 * should retry the read path.
 *
 * Insert + audit run in a single transaction (M8): a crash between the two
 * cannot leave an entry without an audit trail. Compliance trackers (Fall,
 * Elopement, Seizure, Behavior) require this guarantee.
 */
export async function insertEntry(
  input: NewTrackerEntryRow,
  audit: {
    actor: ActorCtx;
    facilityNumber: string;
    reqCtx?: TrackerRequestContext;
  },
): Promise<HydratedTrackerEntryRow> {
  const now = Date.now();
  const inserted = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(trackerEntries)
      .values({
        ...input,
        payload:
          typeof input.payload === "string"
            ? input.payload
            : JSON.stringify(input.payload),
      })
      .returning();
    const row = rows[0]!;
    const hydrated = hydrateEntry(row);

    // Audit row in the same txn so a partial failure rolls back both the
    // entry and its audit trail (matches the bulk + update + delete paths).
    await tx.insert(trackerAuditLog).values({
      entityType: "tracker_entry",
      entityId: row.id,
      action: "create",
      actorFacilityAccountId: audit.actor.facilityAccountId,
      actorStaffId: audit.actor.staffId ?? null,
      facilityNumber: audit.facilityNumber,
      before: null,
      after: JSON.stringify(hydrated),
      ipAddress: audit.reqCtx?.ipAddress ?? null,
      userAgent: audit.reqCtx?.userAgent ?? null,
      createdAt: now,
    });

    return hydrated;
  });

  return inserted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bulk insert (idempotent per item, single transaction)
// ─────────────────────────────────────────────────────────────────────────────

export type BulkEntryInput = {
  clientId: string;
  residentId?: number | null;
  shift?: Shift | null;
  occurredAt: number;
  payload: unknown;
  isIncident?: boolean;
};

export type BulkInsertContext = {
  slug: string;
  trackerDefinitionId: number;
  actor: ActorCtx;
  reqCtx?: TrackerRequestContext;
};

export type BulkInsertResultItem = {
  clientId: string;
  entry: HydratedTrackerEntryRow;
  duplicate: boolean;
};

/**
 * Thrown by `bulkInsertEntries` when an item's `clientId` collides with an
 * existing entry that belongs to a *different* tracker_slug. The router maps
 * this to a 409 — same behaviour as the single-POST path's defense-in-depth
 * check (entriesRouter.ts ~352). Rolls back the whole batch.
 */
export class TrackerClientIdSlugMismatchError extends Error {
  readonly clientId: string;
  readonly existingSlug: string;
  readonly requestedSlug: string;
  constructor(clientId: string, existingSlug: string, requestedSlug: string) {
    super("clientId already used for a different tracker");
    this.name = "TrackerClientIdSlugMismatchError";
    this.clientId = clientId;
    this.existingSlug = existingSlug;
    this.requestedSlug = requestedSlug;
  }
}

/**
 * Insert up to N items in one transaction. For each item:
 *   1. Look up `(facility_number, client_id)`.
 *   2. If found → return `{ duplicate: true, entry }` and skip insert.
 *      If found AND the existing entry belongs to a different tracker_slug,
 *      throw TrackerClientIdSlugMismatchError (mirrors single-POST 409 path).
 *   3. Otherwise insert + write audit row.
 *
 * If any individual insert throws, the whole transaction rolls back and the
 * caller can retry — every item carries its own `clientId`, so retries are
 * safe.
 */
export async function bulkInsertEntries(
  facilityNumber: string,
  items: BulkEntryInput[],
  ctx: BulkInsertContext,
): Promise<BulkInsertResultItem[]> {
  const now = Date.now();
  const results: BulkInsertResultItem[] = [];

  await db.transaction(async (tx) => {
    for (const item of items) {
      const existing = await tx
        .select()
        .from(trackerEntries)
        .where(
          and(
            eq(trackerEntries.facilityNumber, facilityNumber),
            eq(trackerEntries.clientId, item.clientId),
          ),
        );
      if (existing[0]) {
        // Defense-in-depth: a clientId is unique per (facility, client_id) but
        // NOT scoped by tracker_slug at the DB level. If the existing row is
        // for a different tracker, treat it as a 409 — the caller reused a
        // UUID across trackers and surfacing it as a "successful duplicate"
        // would silently return cross-tracker data. Mirrors the single-POST
        // check in entriesRouter.
        if (existing[0].trackerSlug !== ctx.slug) {
          throw new TrackerClientIdSlugMismatchError(
            item.clientId,
            existing[0].trackerSlug,
            ctx.slug,
          );
        }
        results.push({
          clientId: item.clientId,
          entry: hydrateEntry(existing[0]),
          duplicate: true,
        });
        continue;
      }

      const inserted = await tx
        .insert(trackerEntries)
        .values({
          clientId: item.clientId,
          trackerSlug: ctx.slug,
          trackerDefinitionId: ctx.trackerDefinitionId,
          facilityNumber,
          residentId: item.residentId ?? null,
          shift: item.shift ?? null,
          occurredAt: item.occurredAt,
          reportedByFacilityAccountId: ctx.actor.facilityAccountId,
          reportedByStaffId: ctx.actor.staffId ?? null,
          reportedByDisplayName: ctx.actor.displayName,
          reportedByRole: ctx.actor.role,
          payload: JSON.stringify(item.payload),
          status: "active",
          isIncident: fromBool(item.isIncident === true),
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      const row = inserted[0]!;
      const hydrated = hydrateEntry(row);

      // Audit row for every fresh insert. Audit happens *inside* the txn so a
      // partial failure rolls back both the entry and its audit trail. Store
      // the hydrated row (payload as object) so `after.payload` is a JSON
      // object — not a double-stringified TEXT column. (C4)
      await tx.insert(trackerAuditLog).values({
        entityType: "tracker_entry",
        entityId: row.id,
        action: "create",
        actorFacilityAccountId: ctx.actor.facilityAccountId,
        actorStaffId: ctx.actor.staffId ?? null,
        facilityNumber,
        before: null,
        after: JSON.stringify(hydrated),
        ipAddress: ctx.reqCtx?.ipAddress ?? null,
        userAgent: ctx.reqCtx?.userAgent ?? null,
        createdAt: now,
      });

      results.push({
        clientId: item.clientId,
        entry: hydrated,
        duplicate: false,
      });
    }
  });

  return results;
}

// ─────────────────────────────────────────────────────────────────────────────
// List entries (keyset pagination)
// ─────────────────────────────────────────────────────────────────────────────

export type ListEntriesParams = {
  slug: string;
  from?: number;
  to?: number;
  shift?: Shift;
  residentId?: number;
  cursor?: { occurredAt: number; id: number };
  limit?: number;
};

export type ListEntriesResult = {
  items: HydratedTrackerEntryRow[];
  nextCursor?: { occurredAt: number; id: number };
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export async function listEntries(
  facilityNumber: string,
  params: ListEntriesParams,
): Promise<ListEntriesResult> {
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, params.limit ?? DEFAULT_LIMIT),
  );

  const conds = [
    eq(trackerEntries.facilityNumber, facilityNumber),
    eq(trackerEntries.trackerSlug, params.slug),
    sql`${trackerEntries.status} <> 'deleted'`,
  ];
  if (params.from !== undefined) {
    conds.push(gte(trackerEntries.occurredAt, params.from));
  }
  if (params.to !== undefined) {
    conds.push(lte(trackerEntries.occurredAt, params.to));
  }
  if (params.shift !== undefined) {
    conds.push(eq(trackerEntries.shift, params.shift));
  }
  if (params.residentId !== undefined) {
    conds.push(eq(trackerEntries.residentId, params.residentId));
  }
  if (params.cursor) {
    conds.push(
      sql`(${trackerEntries.occurredAt}, ${trackerEntries.id}) < (${params.cursor.occurredAt}, ${params.cursor.id})`,
    );
  }

  const rows = await db
    .select()
    .from(trackerEntries)
    .where(and(...conds))
    .orderBy(desc(trackerEntries.occurredAt), desc(trackerEntries.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const last = slice[slice.length - 1];
  const nextCursor =
    hasMore && last
      ? { occurredAt: last.occurredAt, id: last.id }
      : undefined;

  return {
    items: slice.map(hydrateEntry),
    nextCursor,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Update (versioned)
// ─────────────────────────────────────────────────────────────────────────────

export type UpdateEntryPatch = {
  payload?: unknown;
  shift?: Shift | null;
  occurredAt?: number;
  isIncident?: boolean;
  changeReason?: string;
};

/**
 * Versioned update. Single transaction:
 *   1. SELECT … FOR UPDATE the entry (facility-scoped). Throws
 *      TrackerNotFoundError if missing or wrong tenant.
 *   2. Compute next version number from `tracker_entry_versions`.
 *   3. Snapshot the *pre-update* row into `tracker_entry_versions`.
 *   4. UPDATE the entry. Always sets `status='edited'` + `updated_at=now`.
 *   5. Write a single audit row with `before` (pre) and `after` (post).
 */
export async function updateEntry(
  id: number,
  facilityNumber: string,
  patch: UpdateEntryPatch,
  actor: ActorCtx,
  reqCtx?: TrackerRequestContext,
): Promise<HydratedTrackerEntryRow> {
  const now = Date.now();

  return await db.transaction(async (tx) => {
    // Lock the row. Drizzle has no first-class FOR UPDATE on node-postgres,
    // so we drop to raw SQL for the lock + read.
    const lockResult = await tx.execute(
      sql`SELECT * FROM tracker_entries
          WHERE id = ${id} AND facility_number = ${facilityNumber}
          FOR UPDATE`,
    );
    const lockedRows = (lockResult.rows ?? lockResult) as Array<
      Record<string, unknown>
    >;
    const lockedRaw = lockedRows[0];
    if (!lockedRaw) {
      throw new TrackerNotFoundError();
    }

    // Re-select via Drizzle so we get the camelCased typed row. Safe because
    // we already hold the row lock.
    const existingRows = await tx
      .select()
      .from(trackerEntries)
      .where(eq(trackerEntries.id, id));
    const existing = existingRows[0]!;
    const existingHydrated = hydrateEntry(existing);

    // Next version number = current_max + 1 (or 1 if none).
    const verResult = await tx.execute(
      sql`SELECT COALESCE(MAX(version_number), 0) AS max_v
          FROM tracker_entry_versions
          WHERE entry_id = ${id}`,
    );
    const verRows = (verResult.rows ?? verResult) as Array<
      Record<string, unknown>
    >;
    const maxV = Number(verRows[0]?.max_v ?? 0);
    const nextVersion = maxV + 1;

    // Snapshot pre-update payload. Stored as the raw on-disk TEXT (already
    // JSON) so the column type stays consistent with notes' `versions.body`
    // pattern — re-stringifying would re-encode escapes.
    await tx.insert(trackerEntryVersions).values({
      entryId: id,
      versionNumber: nextVersion,
      payloadSnapshot: existing.payload,
      changedByFacilityAccountId: actor.facilityAccountId,
      changedByStaffId: actor.staffId ?? null,
      changedAt: now,
      changeReason: patch.changeReason ?? null,
    });

    // Build the SET clause from the patch.
    const setFields: Partial<typeof trackerEntries.$inferInsert> = {
      status: "edited",
      updatedAt: now,
    };
    if (patch.payload !== undefined) {
      setFields.payload = JSON.stringify(patch.payload);
    }
    if (patch.shift !== undefined) {
      setFields.shift = patch.shift ?? null;
    }
    if (patch.occurredAt !== undefined) {
      setFields.occurredAt = patch.occurredAt;
    }
    if (patch.isIncident !== undefined) {
      setFields.isIncident = fromBool(patch.isIncident);
    }

    const updatedRows = await tx
      .update(trackerEntries)
      .set(setFields)
      .where(
        and(
          eq(trackerEntries.id, id),
          eq(trackerEntries.facilityNumber, facilityNumber),
        ),
      )
      .returning();
    const updatedRow = updatedRows[0]!;
    const updatedHydrated = hydrateEntry(updatedRow);

    // Audit inside the transaction so partial failure rolls back the trail.
    // Store hydrated rows (payload as object) so before/after.payload is a
    // JSON object — not a double-stringified TEXT column. (C4)
    await tx.insert(trackerAuditLog).values({
      entityType: "tracker_entry",
      entityId: id,
      action: "update",
      actorFacilityAccountId: actor.facilityAccountId,
      actorStaffId: actor.staffId ?? null,
      facilityNumber,
      before: JSON.stringify(existingHydrated),
      after: JSON.stringify(updatedHydrated),
      ipAddress: reqCtx?.ipAddress ?? null,
      userAgent: reqCtx?.userAgent ?? null,
      createdAt: now,
    });

    return updatedHydrated;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Soft delete
// ─────────────────────────────────────────────────────────────────────────────

export async function softDeleteEntry(
  id: number,
  facilityNumber: string,
  actor: ActorCtx,
  reqCtx?: TrackerRequestContext,
): Promise<HydratedTrackerEntryRow> {
  const now = Date.now();

  return await db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(trackerEntries)
      .where(
        and(
          eq(trackerEntries.id, id),
          eq(trackerEntries.facilityNumber, facilityNumber),
        ),
      );
    const existing = existingRows[0];
    if (!existing) {
      throw new TrackerNotFoundError();
    }
    const existingHydrated = hydrateEntry(existing);

    const updatedRows = await tx
      .update(trackerEntries)
      .set({
        status: "deleted",
        deletedAt: now,
        deletedByAccountId: actor.facilityAccountId,
        updatedAt: now,
      })
      .where(
        and(
          eq(trackerEntries.id, id),
          eq(trackerEntries.facilityNumber, facilityNumber),
        ),
      )
      .returning();
    const updatedRow = updatedRows[0]!;
    const updatedHydrated = hydrateEntry(updatedRow);

    // Hydrated before/after so audit payload is an object, not a re-encoded
    // TEXT column. (C4)
    await tx.insert(trackerAuditLog).values({
      entityType: "tracker_entry",
      entityId: id,
      action: "delete",
      actorFacilityAccountId: actor.facilityAccountId,
      actorStaffId: actor.staffId ?? null,
      facilityNumber,
      before: JSON.stringify(existingHydrated),
      after: JSON.stringify(updatedHydrated),
      ipAddress: reqCtx?.ipAddress ?? null,
      userAgent: reqCtx?.userAgent ?? null,
      createdAt: now,
    });

    return updatedHydrated;
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Versions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * List version snapshots for an entry. Joins to `tracker_entries` to enforce
 * facility scope: a facility A request for a facility B entry returns an
 * empty array (router converts to 404).
 *
 * Returns `null` when the entry itself is missing/wrong-tenant so the router
 * can distinguish "entry not visible" (404) from "entry has zero versions"
 * (200 + []).
 */
export async function listVersions(
  entryId: number,
  facilityNumber: string,
): Promise<HydratedTrackerEntryVersionRow[] | null> {
  const entry = await getEntryById(entryId, facilityNumber);
  if (!entry) return null;

  const rows = await db
    .select()
    .from(trackerEntryVersions)
    .where(eq(trackerEntryVersions.entryId, entryId))
    .orderBy(desc(trackerEntryVersions.versionNumber));
  return rows.map(hydrateVersion);
}

// ─────────────────────────────────────────────────────────────────────────────
// Definition lookup (DB-backed, used to populate `tracker_definition_id` on
// inserts so the FK column is meaningful even if the registry order changes
// across deploys).
// ─────────────────────────────────────────────────────────────────────────────

export async function findDefinitionIdBySlug(
  slug: string,
): Promise<number | null> {
  const rows = await db
    .select({ id: trackerDefinitions.id })
    .from(trackerDefinitions)
    .where(eq(trackerDefinitions.slug, slug));
  return rows[0]?.id ?? null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports for the router layer (avoids long import paths there).
// ─────────────────────────────────────────────────────────────────────────────

export type {
  TrackerEntryRow,
  TrackerEntryVersionRow,
  NewTrackerEntryRow,
} from "./trackerSchema";

