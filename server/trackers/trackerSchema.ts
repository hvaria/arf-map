import { pgTable, text, integer, serial, bigint } from "drizzle-orm/pg-core";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL DDL — created at startup via bootstrapTrackersSchema() in
// trackerStorage.ts. Mirrors the notesSchema.ts / opsSchema.ts pattern:
// BIGSERIAL ids, BIGINT epoch-ms timestamps, INTEGER 0/1 booleans, TEXT for
// JSON payloads, TEXT for caller-generated UUIDs (Zod-validated at the API
// boundary), no DB-level FKs (consistent with the rest of the ops_* /
// tracker_* tables — soft FKs via column naming + types only).
//
// Phase A foundation = 4 tables: tracker_definitions, tracker_entries,
// tracker_entry_versions, tracker_audit_log. Per-tracker validation, registry
// seeding, idempotency middleware, routers, and client UI all land in later
// phases.
// ─────────────────────────────────────────────────────────────────────────────

export const TRACKERS_PG_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS tracker_definitions (
    id              BIGSERIAL PRIMARY KEY,
    slug            TEXT UNIQUE NOT NULL,
    name            TEXT NOT NULL,
    category        TEXT NOT NULL,
    schema_version  INTEGER NOT NULL DEFAULT 1,
    config_json     TEXT NOT NULL,
    is_active       INTEGER NOT NULL DEFAULT 1,
    created_at      BIGINT NOT NULL,
    updated_at      BIGINT NOT NULL
  );

  -- payload_type / payload_status intentionally omitted (foundation YAGNI). Add via additive ALTER TABLE when first concrete query needs them.
  CREATE TABLE IF NOT EXISTS tracker_entries (
    id                                BIGSERIAL PRIMARY KEY,
    client_id                         TEXT NOT NULL,
    tracker_slug                      TEXT NOT NULL,
    tracker_definition_id             BIGINT NOT NULL,
    facility_number                   TEXT NOT NULL,
    resident_id                       BIGINT,
    shift                             TEXT,
    occurred_at                       BIGINT NOT NULL,
    reported_by_facility_account_id   BIGINT NOT NULL,
    reported_by_staff_id              BIGINT,
    reported_by_display_name          TEXT NOT NULL,
    reported_by_role                  TEXT NOT NULL,
    payload                           TEXT NOT NULL,
    status                            TEXT NOT NULL DEFAULT 'active',
    is_incident                       INTEGER NOT NULL DEFAULT 0,
    created_at                        BIGINT NOT NULL,
    updated_at                        BIGINT NOT NULL,
    deleted_at                        BIGINT,
    deleted_by_account_id             BIGINT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS tracker_entries_facility_client_uniq
    ON tracker_entries (facility_number, client_id);
  CREATE INDEX IF NOT EXISTS tracker_entries_facility_slug_occurred_idx
    ON tracker_entries (facility_number, tracker_slug, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS tracker_entries_resident_occurred_idx
    ON tracker_entries (resident_id, occurred_at DESC)
    WHERE resident_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS tracker_entries_facility_status_idx
    ON tracker_entries (facility_number, status);

  CREATE TABLE IF NOT EXISTS tracker_entry_versions (
    id                              BIGSERIAL PRIMARY KEY,
    entry_id                        BIGINT NOT NULL,
    version_number                  INTEGER NOT NULL,
    payload_snapshot                TEXT NOT NULL,
    changed_by_facility_account_id  BIGINT NOT NULL,
    changed_by_staff_id             BIGINT,
    changed_at                      BIGINT NOT NULL,
    change_reason                   TEXT,
    UNIQUE (entry_id, version_number)
  );
  CREATE INDEX IF NOT EXISTS tracker_entry_versions_entry_idx
    ON tracker_entry_versions (entry_id, version_number DESC);

  CREATE TABLE IF NOT EXISTS tracker_audit_log (
    id                          BIGSERIAL PRIMARY KEY,
    entity_type                 TEXT NOT NULL,
    entity_id                   BIGINT NOT NULL,
    action                      TEXT NOT NULL,
    actor_facility_account_id   BIGINT,
    actor_staff_id              BIGINT,
    facility_number             TEXT NOT NULL,
    before                      TEXT,
    after                       TEXT,
    ip_address                  TEXT,
    user_agent                  TEXT,
    created_at                  BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS tracker_audit_entity_idx
    ON tracker_audit_log (entity_type, entity_id, created_at DESC);
  CREATE INDEX IF NOT EXISTS tracker_audit_facility_idx
    ON tracker_audit_log (facility_number, created_at DESC);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Drizzle table definitions (PostgreSQL)
// ─────────────────────────────────────────────────────────────────────────────

const ts = (col: string) => bigint(col, { mode: "number" });
const fk = (col: string) => bigint(col, { mode: "number" });

export const trackerDefinitions = pgTable("tracker_definitions", {
  id:             serial("id").primaryKey(),
  slug:           text("slug").notNull().unique(),
  name:           text("name").notNull(),
  category:       text("category").notNull(),
  schemaVersion:  integer("schema_version").notNull().default(1),
  configJson:     text("config_json").notNull(),
  isActive:       integer("is_active").notNull().default(1),
  createdAt:      ts("created_at").notNull(),
  updatedAt:      ts("updated_at").notNull(),
});

export const trackerEntries = pgTable("tracker_entries", {
  id:                            serial("id").primaryKey(),
  clientId:                      text("client_id").notNull(),
  trackerSlug:                   text("tracker_slug").notNull(),
  trackerDefinitionId:           fk("tracker_definition_id").notNull(),
  facilityNumber:                text("facility_number").notNull(),
  residentId:                    fk("resident_id"),
  shift:                         text("shift"),
  occurredAt:                    ts("occurred_at").notNull(),
  reportedByFacilityAccountId:   fk("reported_by_facility_account_id").notNull(),
  reportedByStaffId:             fk("reported_by_staff_id"),
  reportedByDisplayName:         text("reported_by_display_name").notNull(),
  reportedByRole:                text("reported_by_role").notNull(),
  payload:                       text("payload").notNull(),
  status:                        text("status").notNull().default("active"),
  isIncident:                    integer("is_incident").notNull().default(0),
  createdAt:                     ts("created_at").notNull(),
  updatedAt:                     ts("updated_at").notNull(),
  deletedAt:                     ts("deleted_at"),
  deletedByAccountId:            fk("deleted_by_account_id"),
});

export const trackerEntryVersions = pgTable("tracker_entry_versions", {
  id:                          serial("id").primaryKey(),
  entryId:                     fk("entry_id").notNull(),
  versionNumber:               integer("version_number").notNull(),
  payloadSnapshot:             text("payload_snapshot").notNull(),
  changedByFacilityAccountId:  fk("changed_by_facility_account_id").notNull(),
  changedByStaffId:            fk("changed_by_staff_id"),
  changedAt:                   ts("changed_at").notNull(),
  changeReason:                text("change_reason"),
});

export const trackerAuditLog = pgTable("tracker_audit_log", {
  id:                       serial("id").primaryKey(),
  entityType:               text("entity_type").notNull(),
  entityId:                 fk("entity_id").notNull(),
  action:                   text("action").notNull(),
  actorFacilityAccountId:   fk("actor_facility_account_id"),
  actorStaffId:             fk("actor_staff_id"),
  facilityNumber:           text("facility_number").notNull(),
  before:                   text("before"),
  after:                    text("after"),
  ipAddress:                text("ip_address"),
  userAgent:                text("user_agent"),
  createdAt:                ts("created_at").notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Inferred TypeScript types
//
// NB: the DB row type for tracker_definitions is `TrackerDefinitionRow` (and
// the insert is `NewTrackerDefinitionRow`) to avoid colliding with the
// `TrackerDefinition` *config object* type that frontend-engineer will define
// in shared/tracker-schemas/tracker-types.ts in Phase B. The other three
// tables follow the same `*Row` / `New*Row` naming for consistency.
// ─────────────────────────────────────────────────────────────────────────────

export type TrackerDefinitionRow      = typeof trackerDefinitions.$inferSelect;
export type NewTrackerDefinitionRow   = typeof trackerDefinitions.$inferInsert;

export type TrackerEntryRow           = typeof trackerEntries.$inferSelect;
export type NewTrackerEntryRow        = typeof trackerEntries.$inferInsert;

export type TrackerEntryVersionRow    = typeof trackerEntryVersions.$inferSelect;
export type NewTrackerEntryVersionRow = typeof trackerEntryVersions.$inferInsert;

export type TrackerAuditLogRow        = typeof trackerAuditLog.$inferSelect;
export type NewTrackerAuditLogRow     = typeof trackerAuditLog.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Zod enums (shared between client & server).
//
// `trackerEntryStatusSchema` and the shift enum are canonically defined in
// shared/tracker-schemas/tracker-types.ts (Phase B's config-system source of
// truth). They are re-exported here so existing server-side imports from
// "../trackerSchema" continue to resolve. Per fix M7 (review tracker), there
// must be exactly one `z.enum(...)` definition for each of these — see
// shared/tracker-schemas/tracker-types.ts.
//
// Note: the canonical name for the shift enum is `shiftSchema` (with type
// `Shift`). We re-export it under that name here. The legacy alias
// `trackerShiftSchema` / `TrackerShift` was removed; call sites import
// `shiftSchema` directly.
// ─────────────────────────────────────────────────────────────────────────────

export {
  shiftSchema,
  trackerEntryStatusSchema,
  type Shift,
  type TrackerEntryStatus,
} from "@shared/tracker-schemas";

// Audit-log action vocabulary. Open enum on the DB side (just TEXT) so future
// actions don't require a migration; Zod here is the source of truth at runtime.
export const trackerAuditActionSchema = z.enum([
  "create",
  "update",
  "delete",
  "restore",
]);
export type TrackerAuditAction = z.infer<typeof trackerAuditActionSchema>;

// Audit-log entity_type vocabulary. Same open-enum-on-DB pattern.
export const trackerAuditEntityTypeSchema = z.enum([
  "tracker_entry",
  "tracker_definition",
]);
export type TrackerAuditEntityType = z.infer<typeof trackerAuditEntityTypeSchema>;
