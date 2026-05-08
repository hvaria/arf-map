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
  trackerAlerts,
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
  getDefinition,
  serializeDefinitionForClient,
  type Shift,
} from "./registry";

/**
 * Local alias for the transaction object passed to `db.transaction(cb)`.
 * Avoids stamping out the full `PgTransaction<...>` generic at every callsite
 * while still keeping the type narrow enough that `tx.insert(...)` /
 * `tx.select(...)` / `tx.execute(...)` are all type-checked. (No `any`.)
 */
type TxLike = Parameters<Parameters<typeof db.transaction>[0]>[0];

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
 * Version row enriched with the actor's human-readable display name + role,
 * resolved at read time via LEFT JOIN against `ops_staff` (preferred when
 * `changedByStaffId` is non-null) and `facility_accounts` (fallback). We do
 * not denormalize these onto `tracker_entry_versions` because:
 *   (a) staff/account names can change later — denormalization would drift,
 *   (b) versions are infrequently read,
 *   (c) keeps the table schema light.
 */
export type HydratedTrackerEntryVersionRowWithActor =
  HydratedTrackerEntryVersionRow & {
    changedByDisplayName: string;
    changedByRole: string;
  };

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
// Alert evaluator (runs inside an entry mutation's transaction)
//
// Each tracker's `alerts: AlertRule[]` is a list of pure evaluators that
// take a payload + lightweight ctx and return `AlertEvent | null`. We run
// every rule against the entry's payload and persist a row into
// `tracker_alerts` for each fired rule.
//
// Idempotency rule: if a rule sets `autoResolveOnNextEntry: true` (the v1
// default) AND there's an active alert for the same
// (facility_number, tracker_slug, rule_id, resident_id) tuple, mark the
// prior alert resolved and insert a fresh active row. This way a stream
// of critical readings doesn't accumulate dozens of zombie alerts —
// "newest reading wins". Rules without that flag stack normally.
//
// Returns `{ fired: number }` for callers (and tests) that care about the
// count. All side-effects ride on the caller's transaction.
// ─────────────────────────────────────────────────────────────────────────────

type EvaluateAlertsArgs = {
  slug: string;
  facilityNumber: string;
  sourceEntryId: number;
  residentId: number | null;
  shift: string | null;
  occurredAt: number;
  payload: unknown;
};

async function evaluateAndPersistAlerts(
  tx: TxLike,
  args: EvaluateAlertsArgs,
): Promise<{ fired: number }> {
  const def = getDefinition(args.slug);
  const rules = def?.alerts;
  if (!rules || rules.length === 0) return { fired: 0 };

  const ctx = {
    trackerSlug: args.slug,
    residentId: args.residentId,
    shift: args.shift,
    occurredAt: args.occurredAt,
  };

  const now = Date.now();
  let fired = 0;

  for (const rule of rules) {
    let event: ReturnType<typeof rule.evaluate>;
    try {
      event = rule.evaluate(args.payload, ctx);
    } catch (err) {
      // A misbehaving rule must not poison the entry write. Log and skip.
      console.error(
        `[trackers] alert rule '${rule.id}' threw — skipping`,
        err,
      );
      continue;
    }
    if (!event) continue;

    if (event.autoResolveOnNextEntry === true) {
      // Auto-resolve any prior `active` alert for the same tuple. We scope
      // by resident_id explicitly: when residentId is null on the new
      // entry, only resolve prior null-resident alerts (the IS NULL branch).
      const conds = [
        eq(trackerAlerts.facilityNumber, args.facilityNumber),
        eq(trackerAlerts.trackerSlug, args.slug),
        eq(trackerAlerts.ruleId, rule.id),
        eq(trackerAlerts.status, "active"),
      ];
      if (args.residentId === null) {
        conds.push(sql`${trackerAlerts.residentId} IS NULL`);
      } else {
        conds.push(eq(trackerAlerts.residentId, args.residentId));
      }
      await tx
        .update(trackerAlerts)
        .set({ status: "resolved", resolvedAt: now, updatedAt: now })
        .where(and(...conds));
    }

    await tx.insert(trackerAlerts).values({
      facilityNumber: args.facilityNumber,
      trackerSlug: args.slug,
      ruleId: event.ruleId ?? rule.id,
      severity: event.severity ?? rule.defaultSeverity,
      residentId: args.residentId,
      sourceEntryId: args.sourceEntryId,
      shift: args.shift,
      message: event.message,
      detail: event.detail ?? null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    fired += 1;
  }

  return { fired };
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

    // Alert evaluation rides on the same txn so a fired alert can never
    // outlive its source entry. Trackers without rules return early —
    // ADL, etc. — at near-zero cost.
    await evaluateAndPersistAlerts(tx, {
      slug: row.trackerSlug,
      facilityNumber: audit.facilityNumber,
      sourceEntryId: row.id,
      residentId: row.residentId ?? null,
      shift: row.shift ?? null,
      occurredAt: row.occurredAt,
      payload: hydrated.payload,
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

      // Alert evaluation per item, atomic with the entry + audit. The
      // single-tx-per-batch contract is preserved — if any alert insert
      // throws, the whole batch rolls back.
      await evaluateAndPersistAlerts(tx, {
        slug: ctx.slug,
        facilityNumber,
        sourceEntryId: row.id,
        residentId: row.residentId ?? null,
        shift: row.shift ?? null,
        occurredAt: row.occurredAt,
        payload: hydrated.payload,
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
// Stream entries for CSV export
//
// Yields rows in keyset-paginated batches (500 at a time, ordered by
// occurred_at DESC, id DESC) so memory stays bounded for multi-month
// exports. Soft-deleted rows are excluded — matches History tab semantics.
// Resident name is LEFT-JOINed from `ops_residents`; if the resident row is
// missing (deleted, cross-tenant impossible due to facility scope) the
// caller falls back to a `#<id>` sentinel.
//
// We use raw SQL through `pool` (not Drizzle) for the JOIN because
// `ops_residents` lives in another module's table object and pulling it in
// here would couple the tracker storage to the ops module — see the same
// rationale on `listVersions` above.
// ─────────────────────────────────────────────────────────────────────────────

export type EntryExportRow = {
  id: number;
  occurredAt: number;
  shift: string | null;
  status: string;
  reportedByDisplayName: string;
  reportedByRole: string;
  payload: unknown;
  residentId: number | null;
  residentFirstName: string | null;
  residentLastName: string | null;
};

export type StreamEntriesForExportArgs = {
  slug: string;
  from: number;
  to: number;
  shift?: Shift;
  residentId?: number;
};

const EXPORT_BATCH_SIZE = 500;

export async function* streamEntriesForExport(
  facilityNumber: string,
  args: StreamEntriesForExportArgs,
): AsyncGenerator<EntryExportRow> {
  // Cursor is (occurred_at, id) keyset. We seed with sentinel +Infinity so
  // the first batch returns the most recent row; subsequent batches use the
  // last yielded row's (occurredAt, id) as the strict upper bound.
  let cursorOccurredAt: number | null = null;
  let cursorId: number | null = null;

  for (;;) {
    // Build the parameterized query incrementally so optional filters and the
    // cursor predicate slot in cleanly. Param numbering is 1-based.
    const params: Array<string | number> = [
      facilityNumber,
      args.slug,
      args.from,
      args.to,
    ];
    let where = `e.facility_number = $1
                 AND e.tracker_slug   = $2
                 AND e.status         <> 'deleted'
                 AND e.occurred_at   >= $3
                 AND e.occurred_at   <= $4`;

    if (args.shift !== undefined) {
      params.push(args.shift);
      where += ` AND e.shift = $${params.length}`;
    }
    if (args.residentId !== undefined) {
      params.push(args.residentId);
      where += ` AND e.resident_id = $${params.length}`;
    }
    if (cursorOccurredAt !== null && cursorId !== null) {
      params.push(cursorOccurredAt);
      const occIdx = params.length;
      params.push(cursorId);
      const idIdx = params.length;
      where += ` AND (e.occurred_at, e.id) < ($${occIdx}, $${idIdx})`;
    }

    params.push(EXPORT_BATCH_SIZE);
    const limitIdx = params.length;

    const sqlText = `
      SELECT
        e.id                            AS id,
        e.occurred_at                   AS occurred_at,
        e.shift                         AS shift,
        e.status                        AS status,
        e.reported_by_display_name      AS reported_by_display_name,
        e.reported_by_role              AS reported_by_role,
        e.payload                       AS payload,
        e.resident_id                   AS resident_id,
        r.first_name                    AS resident_first_name,
        r.last_name                     AS resident_last_name
      FROM tracker_entries e
      LEFT JOIN ops_residents r
        ON r.id = e.resident_id AND r.facility_number = e.facility_number
      WHERE ${where}
      ORDER BY e.occurred_at DESC, e.id DESC
      LIMIT $${limitIdx}
    `;

    const result = await pool.query<{
      id: string | number;
      occurred_at: string | number;
      shift: string | null;
      status: string;
      reported_by_display_name: string;
      reported_by_role: string;
      payload: string;
      resident_id: string | number | null;
      resident_first_name: string | null;
      resident_last_name: string | null;
    }>(sqlText, params);

    if (result.rows.length === 0) return;

    for (const r of result.rows) {
      const row: EntryExportRow = {
        id: Number(r.id),
        occurredAt: Number(r.occurred_at),
        shift: r.shift,
        status: r.status,
        reportedByDisplayName: r.reported_by_display_name,
        reportedByRole: r.reported_by_role,
        payload: parsePayload(r.payload),
        residentId: r.resident_id === null ? null : Number(r.resident_id),
        residentFirstName: r.resident_first_name,
        residentLastName: r.resident_last_name,
      };
      yield row;
    }

    if (result.rows.length < EXPORT_BATCH_SIZE) return;

    const last = result.rows[result.rows.length - 1]!;
    cursorOccurredAt = Number(last.occurred_at);
    cursorId = Number(last.id);
  }
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

    // Re-evaluate alerts on the post-update payload. An edited entry that
    // is now critical SHOULD alert; the auto-resolve dedupe inside
    // `evaluateAndPersistAlerts` keeps a stream of edits from snowballing.
    await evaluateAndPersistAlerts(tx, {
      slug: updatedRow.trackerSlug,
      facilityNumber,
      sourceEntryId: id,
      residentId: updatedRow.residentId ?? null,
      shift: updatedRow.shift ?? null,
      occurredAt: updatedRow.occurredAt,
      payload: updatedHydrated.payload,
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

    // Soft-delete the entry → resolve any active alerts that pointed at it.
    // Without this the OperationsTab Alerts panel would show alerts whose
    // source data was soft-deleted (zombies). Scoped by facility for safety
    // even though source_entry_id is globally unique.
    await tx
      .update(trackerAlerts)
      .set({ status: "resolved", resolvedAt: now, updatedAt: now })
      .where(
        and(
          eq(trackerAlerts.facilityNumber, facilityNumber),
          eq(trackerAlerts.sourceEntryId, id),
          eq(trackerAlerts.status, "active"),
        ),
      );

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
 *
 * Each row is enriched with `changedByDisplayName` + `changedByRole` via a
 * single LEFT JOIN against `ops_staff` (preferred) and `facility_accounts`
 * (fallback). No N+1: one query returns the full page. Fallbacks if both
 * joined rows are missing — e.g. account deleted — preserve the row with
 * sentinel values rather than failing the response.
 */
export async function listVersions(
  entryId: number,
  facilityNumber: string,
): Promise<HydratedTrackerEntryVersionRowWithActor[] | null> {
  const entry = await getEntryById(entryId, facilityNumber);
  if (!entry) return null;

  // Raw SQL because Drizzle joins across module-owned tables (ops_staff,
  // facility_accounts) would require importing those table objects here and
  // we keep tracker storage decoupled from the ops/auth modules. The shape is
  // tight enough that hand-rolled SQL is the simpler tradeoff.
  const result = await pool.query<{
    id: string | number;
    entry_id: string | number;
    version_number: number;
    payload_snapshot: string;
    changed_by_facility_account_id: string | number;
    changed_by_staff_id: string | number | null;
    changed_at: string | number;
    change_reason: string | null;
    staff_first_name: string | null;
    staff_last_name: string | null;
    staff_role: string | null;
    account_username: string | null;
    account_role: string | null;
  }>(
    `SELECT
       v.id,
       v.entry_id,
       v.version_number,
       v.payload_snapshot,
       v.changed_by_facility_account_id,
       v.changed_by_staff_id,
       v.changed_at,
       v.change_reason,
       s.first_name AS staff_first_name,
       s.last_name  AS staff_last_name,
       s.role       AS staff_role,
       a.username   AS account_username,
       a.role       AS account_role
     FROM tracker_entry_versions v
     LEFT JOIN ops_staff         s ON s.id = v.changed_by_staff_id
     LEFT JOIN facility_accounts a ON a.id = v.changed_by_facility_account_id
     WHERE v.entry_id = $1
     ORDER BY v.version_number DESC`,
    [entryId],
  );

  return result.rows.map((r) => {
    const staffName =
      r.staff_first_name && r.staff_last_name
        ? `${r.staff_first_name} ${r.staff_last_name}`.trim()
        : null;
    const displayName =
      (r.changed_by_staff_id !== null && staffName) ||
      r.account_username ||
      "Unknown";
    const role =
      (r.changed_by_staff_id !== null && r.staff_role) ||
      r.account_role ||
      "unknown";

    const hydrated: HydratedTrackerEntryVersionRowWithActor = {
      id: Number(r.id),
      entryId: Number(r.entry_id),
      versionNumber: r.version_number,
      payloadSnapshot: parsePayload(r.payload_snapshot),
      changedByFacilityAccountId: Number(r.changed_by_facility_account_id),
      changedByStaffId:
        r.changed_by_staff_id === null ? null : Number(r.changed_by_staff_id),
      changedAt: Number(r.changed_at),
      changeReason: r.change_reason,
      changedByDisplayName: displayName,
      changedByRole: role,
    };
    return hydrated;
  });
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
// Alerts — list / acknowledge / resolve / summary
//
// Reads/writes go through the `trackerAlerts` table imported at the top of
// this file. The evaluator (`evaluateAndPersistAlerts`) populates rows on
// every entry mutation; the router below exposes them to the OperationsTab
// Alerts panel.
// ─────────────────────────────────────────────────────────────────────────────

import type { TrackerAlertRow } from "./trackerSchema";

export type ListAlertsParams = {
  /** Defaults to ['active'] when omitted. */
  status?: ReadonlyArray<"active" | "acknowledged" | "resolved">;
  severity?: ReadonlyArray<"info" | "warn" | "critical">;
  slug?: string;
  residentId?: number;
  cursor?: { createdAt: number; id: number };
  limit?: number;
};

export type ListAlertsResult = {
  items: TrackerAlertRow[];
  nextCursor?: { createdAt: number; id: number };
};

const ALERTS_DEFAULT_LIMIT = 50;
const ALERTS_MAX_LIMIT = 200;

/**
 * Keyset-paginated list of tracker alerts for a facility, ordered
 * (created_at DESC, id DESC). Defaults to status='active' when no status
 * filter is supplied — matches the OperationsTab Alerts panel default.
 */
export async function listAlerts(
  facilityNumber: string,
  params: ListAlertsParams,
): Promise<ListAlertsResult> {
  const limit = Math.min(
    ALERTS_MAX_LIMIT,
    Math.max(1, params.limit ?? ALERTS_DEFAULT_LIMIT),
  );

  const conds = [eq(trackerAlerts.facilityNumber, facilityNumber)];

  const statuses = params.status && params.status.length > 0
    ? params.status
    : (["active"] as const);
  conds.push(sql`${trackerAlerts.status} = ANY(${[...statuses]}::text[])`);

  if (params.severity && params.severity.length > 0) {
    conds.push(
      sql`${trackerAlerts.severity} = ANY(${[...params.severity]}::text[])`,
    );
  }
  if (params.slug !== undefined) {
    conds.push(eq(trackerAlerts.trackerSlug, params.slug));
  }
  if (params.residentId !== undefined) {
    conds.push(eq(trackerAlerts.residentId, params.residentId));
  }
  if (params.cursor) {
    conds.push(
      sql`(${trackerAlerts.createdAt}, ${trackerAlerts.id}) < (${params.cursor.createdAt}, ${params.cursor.id})`,
    );
  }

  const rows = await db
    .select()
    .from(trackerAlerts)
    .where(and(...conds))
    .orderBy(desc(trackerAlerts.createdAt), desc(trackerAlerts.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const slice = hasMore ? rows.slice(0, limit) : rows;
  const last = slice[slice.length - 1];
  const nextCursor =
    hasMore && last
      ? { createdAt: last.createdAt, id: last.id }
      : undefined;

  return { items: slice, nextCursor };
}

export async function getAlertById(
  id: number,
  facilityNumber: string,
): Promise<TrackerAlertRow | null> {
  const rows = await db
    .select()
    .from(trackerAlerts)
    .where(
      and(
        eq(trackerAlerts.id, id),
        eq(trackerAlerts.facilityNumber, facilityNumber),
      ),
    );
  return rows[0] ?? null;
}

/**
 * Returned by the ack/resolve storage paths to let the router map
 * "alert resolved" → 409. Lets the router stay free of state-machine logic.
 */
export class TrackerAlertAlreadyResolvedError extends Error {
  constructor() {
    super("Alert already resolved");
    this.name = "TrackerAlertAlreadyResolvedError";
  }
}

export type AlertActionInput = {
  id: number;
  facilityNumber: string;
  actor: ActorCtx;
  note?: string | null;
  reqCtx?: TrackerRequestContext;
};

/**
 * Mark an alert as `acknowledged`. Idempotent on re-acknowledge of an
 * already-acknowledged alert (returns the row, no DB write). Throws
 * TrackerAlertAlreadyResolvedError when the alert is `resolved` so the
 * router can surface a 409.
 *
 * Audit row written inside the transaction so the trail can never drift
 * from the row state. (Mirrors entry mutation paths.)
 */
export async function acknowledgeAlert(
  input: AlertActionInput,
): Promise<TrackerAlertRow> {
  const now = Date.now();
  return await db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(trackerAlerts)
      .where(
        and(
          eq(trackerAlerts.id, input.id),
          eq(trackerAlerts.facilityNumber, input.facilityNumber),
        ),
      );
    const existing = existingRows[0];
    if (!existing) throw new TrackerNotFoundError("Alert not found");
    if (existing.status === "resolved") {
      throw new TrackerAlertAlreadyResolvedError();
    }
    if (existing.status === "acknowledged") {
      // Idempotent re-ack: no-op (preserves first-ack metadata).
      return existing;
    }

    const updatedRows = await tx
      .update(trackerAlerts)
      .set({
        status: "acknowledged",
        acknowledgedAt: now,
        acknowledgedByFacilityAccountId: input.actor.facilityAccountId,
        acknowledgedByStaffId: input.actor.staffId ?? null,
        acknowledgedNote: input.note ?? null,
        updatedAt: now,
      })
      .where(eq(trackerAlerts.id, input.id))
      .returning();
    const updated = updatedRows[0]!;

    // Audit on the alert entity for traceability — uses a small "ack"-style
    // marker on the audit-log `action` field. We re-use the existing
    // `update` action from the schema's open enum because the audit table
    // is tracker-entry-shaped today; the entity_type discriminates.
    await tx.insert(trackerAuditLog).values({
      entityType: "tracker_entry", // closest existing entity_type; alert audits live on the same table
      entityId: input.id,
      action: "update",
      actorFacilityAccountId: input.actor.facilityAccountId,
      actorStaffId: input.actor.staffId ?? null,
      facilityNumber: input.facilityNumber,
      before: JSON.stringify(existing),
      after: JSON.stringify(updated),
      ipAddress: input.reqCtx?.ipAddress ?? null,
      userAgent: input.reqCtx?.userAgent ?? null,
      createdAt: now,
    });

    return updated;
  });
}

/**
 * Mark an alert as `resolved`. 404 if missing/wrong tenant. Idempotent
 * resolves of an already-resolved alert return the row unchanged.
 */
export async function resolveAlert(
  input: AlertActionInput,
): Promise<TrackerAlertRow> {
  const now = Date.now();
  return await db.transaction(async (tx) => {
    const existingRows = await tx
      .select()
      .from(trackerAlerts)
      .where(
        and(
          eq(trackerAlerts.id, input.id),
          eq(trackerAlerts.facilityNumber, input.facilityNumber),
        ),
      );
    const existing = existingRows[0];
    if (!existing) throw new TrackerNotFoundError("Alert not found");
    if (existing.status === "resolved") {
      // Idempotent re-resolve.
      return existing;
    }

    const updatedRows = await tx
      .update(trackerAlerts)
      .set({
        status: "resolved",
        resolvedAt: now,
        // If a note is provided on resolve, capture it on the same column
        // (acknowledgedNote doubles as the action note — single TEXT slot
        // for v1; we don't bloat the table with a second column yet).
        acknowledgedNote: input.note ?? existing.acknowledgedNote ?? null,
        updatedAt: now,
      })
      .where(eq(trackerAlerts.id, input.id))
      .returning();
    const updated = updatedRows[0]!;

    await tx.insert(trackerAuditLog).values({
      entityType: "tracker_entry",
      entityId: input.id,
      action: "update",
      actorFacilityAccountId: input.actor.facilityAccountId,
      actorStaffId: input.actor.staffId ?? null,
      facilityNumber: input.facilityNumber,
      before: JSON.stringify(existing),
      after: JSON.stringify(updated),
      ipAddress: input.reqCtx?.ipAddress ?? null,
      userAgent: input.reqCtx?.userAgent ?? null,
      createdAt: now,
    });

    return updated;
  });
}

/**
 * Severity-bucketed counts of `active` alerts for a facility. Backs the
 * standalone `/alerts/summary` endpoint consumed by the OperationsTab
 * Alerts panel. Single grouped query — no per-severity round-trip.
 */
export async function getActiveAlertCounts(
  facilityNumber: string,
): Promise<{
  active: number;
  critical: number;
  warn: number;
  info: number;
}> {
  const result = await pool.query<{ severity: string; c: number }>(
    `SELECT severity, COUNT(*)::int AS c
       FROM tracker_alerts
       WHERE facility_number = $1 AND status = 'active'
       GROUP BY severity`,
    [facilityNumber],
  );
  let critical = 0;
  let warn = 0;
  let info = 0;
  for (const r of result.rows) {
    const c = Number(r.c) || 0;
    if (r.severity === "critical") critical = c;
    else if (r.severity === "warn") warn = c;
    else if (r.severity === "info") info = c;
  }
  return { active: critical + warn + info, critical, warn, info };
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-exports for the router layer (avoids long import paths there).
// ─────────────────────────────────────────────────────────────────────────────

export type {
  TrackerEntryRow,
  TrackerEntryVersionRow,
  NewTrackerEntryRow,
  TrackerAlertRow,
} from "./trackerSchema";

