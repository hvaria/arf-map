import { pgTable, text, integer, serial, bigint } from "drizzle-orm/pg-core";
import { z } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// PostgreSQL DDL — created at startup via bootstrapNotesSchema() in
// notesStorage.ts. Mirrors the opsSchema.ts pattern: BIGSERIAL ids, BIGINT
// epoch-ms timestamps, INTEGER 0/1 booleans, TEXT enums (validated in Zod),
// no DB-level FKs (consistent with the rest of the ops_* tables).
//
// MVP slice 1 = 7 tables. Categories / templates / saved views /
// visibility_overrides / read receipts / linked_tasks / linked_incidents /
// resident-link junction are deferred to later phases per the Notes blueprint.
// ─────────────────────────────────────────────────────────────────────────────

export const NOTES_PG_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS ops_notes (
    id                          BIGSERIAL PRIMARY KEY,
    facility_number             TEXT NOT NULL,
    parent_note_id              BIGINT,
    category                    TEXT NOT NULL,
    resident_id                 BIGINT,
    shift_id                    BIGINT,
    title                       TEXT,
    body                        TEXT NOT NULL,
    visibility_scope            TEXT NOT NULL DEFAULT 'facility_wide',
    priority                    TEXT NOT NULL DEFAULT 'normal',
    status                      TEXT NOT NULL DEFAULT 'open',
    ack_required                INTEGER NOT NULL DEFAULT 0,
    ack_required_role           TEXT,
    follow_up_by                BIGINT,
    effective_until             BIGINT,
    is_quick                    INTEGER NOT NULL DEFAULT 0,
    author_facility_account_id  BIGINT NOT NULL,
    author_staff_id             BIGINT,
    author_display_name         TEXT NOT NULL,
    author_role                 TEXT NOT NULL,
    edit_count                  INTEGER NOT NULL DEFAULT 0,
    last_edited_at              BIGINT,
    last_edited_by_account_id   BIGINT,
    archived_at                 BIGINT,
    archived_by_account_id      BIGINT,
    deleted_at                  BIGINT,
    deleted_by_account_id       BIGINT,
    created_at                  BIGINT NOT NULL,
    updated_at                  BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_notes_facility_created
    ON ops_notes(facility_number, created_at DESC)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_ops_notes_resident_created
    ON ops_notes(resident_id, created_at DESC)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_ops_notes_parent
    ON ops_notes(parent_note_id)
    WHERE parent_note_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_ops_notes_status
    ON ops_notes(facility_number, status)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_ops_notes_author
    ON ops_notes(author_facility_account_id, created_at DESC)
    WHERE deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_ops_notes_urgent_open
    ON ops_notes(facility_number, created_at DESC)
    WHERE priority = 'urgent' AND status = 'open' AND deleted_at IS NULL;
  CREATE INDEX IF NOT EXISTS idx_ops_notes_follow_up
    ON ops_notes(facility_number, follow_up_by)
    WHERE follow_up_by IS NOT NULL AND status = 'open' AND deleted_at IS NULL;

  CREATE TABLE IF NOT EXISTS ops_note_versions (
    id                    BIGSERIAL PRIMARY KEY,
    note_id               BIGINT NOT NULL,
    version               INTEGER NOT NULL,
    title                 TEXT,
    body                  TEXT NOT NULL,
    edited_by_account_id  BIGINT NOT NULL,
    edit_reason           TEXT,
    edited_at             BIGINT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_ops_note_versions_note_version
    ON ops_note_versions(note_id, version);
  CREATE INDEX IF NOT EXISTS idx_ops_note_versions_note
    ON ops_note_versions(note_id, version DESC);

  CREATE TABLE IF NOT EXISTS ops_note_attachments (
    id                       BIGSERIAL PRIMARY KEY,
    note_id                  BIGINT NOT NULL,
    uploaded_by_account_id   BIGINT NOT NULL,
    storage_key              TEXT NOT NULL,
    filename                 TEXT NOT NULL,
    mime_type                TEXT NOT NULL,
    size_bytes               BIGINT NOT NULL,
    scan_status              TEXT NOT NULL DEFAULT 'pending',
    scanned_at               BIGINT,
    removed_at               BIGINT,
    removed_by_account_id    BIGINT,
    removed_reason           TEXT,
    created_at               BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_note_attachments_note
    ON ops_note_attachments(note_id);
  CREATE INDEX IF NOT EXISTS idx_ops_note_attachments_pending
    ON ops_note_attachments(scan_status)
    WHERE scan_status = 'pending';

  CREATE TABLE IF NOT EXISTS ops_note_mentions (
    id                  BIGSERIAL PRIMARY KEY,
    note_id             BIGINT NOT NULL,
    mentioned_staff_id  BIGINT,
    mentioned_role      TEXT,
    read_at             BIGINT,
    created_at          BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_note_mentions_note
    ON ops_note_mentions(note_id);
  CREATE INDEX IF NOT EXISTS idx_ops_note_mentions_staff_unread
    ON ops_note_mentions(mentioned_staff_id)
    WHERE read_at IS NULL;
  -- Application layer enforces: mentioned_staff_id IS NOT NULL OR mentioned_role IS NOT NULL.

  CREATE TABLE IF NOT EXISTS ops_note_acknowledgments (
    id                                BIGSERIAL PRIMARY KEY,
    note_id                           BIGINT NOT NULL,
    acknowledger_facility_account_id  BIGINT NOT NULL,
    acknowledger_staff_id             BIGINT,
    acknowledged_at                   BIGINT NOT NULL,
    device_info                       TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_ops_note_acks_note_account
    ON ops_note_acknowledgments(note_id, acknowledger_facility_account_id);
  CREATE INDEX IF NOT EXISTS idx_ops_note_acks_note
    ON ops_note_acknowledgments(note_id);

  CREATE TABLE IF NOT EXISTS ops_note_tags (
    note_id   BIGINT NOT NULL,
    tag       TEXT NOT NULL,
    PRIMARY KEY (note_id, tag)
  );
  CREATE INDEX IF NOT EXISTS idx_ops_note_tags_tag ON ops_note_tags(tag);

  CREATE TABLE IF NOT EXISTS ops_note_audit_log (
    id                          BIGSERIAL PRIMARY KEY,
    note_id                     BIGINT NOT NULL,
    actor_facility_account_id   BIGINT,
    action                      TEXT NOT NULL,
    payload_diff                TEXT,
    ip_address                  TEXT,
    user_agent                  TEXT,
    occurred_at                 BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ops_note_audit_note
    ON ops_note_audit_log(note_id, occurred_at DESC);
  CREATE INDEX IF NOT EXISTS idx_ops_note_audit_actor
    ON ops_note_audit_log(actor_facility_account_id, occurred_at DESC);
`;

// ─────────────────────────────────────────────────────────────────────────────
// Drizzle table definitions (PostgreSQL)
// ─────────────────────────────────────────────────────────────────────────────

const ts = (col: string) => bigint(col, { mode: "number" });
const fk = (col: string) => bigint(col, { mode: "number" });

export const opsNotes = pgTable("ops_notes", {
  id:                       serial("id").primaryKey(),
  facilityNumber:           text("facility_number").notNull(),
  parentNoteId:             fk("parent_note_id"),
  category:                 text("category").notNull(),
  residentId:               fk("resident_id"),
  shiftId:                  fk("shift_id"),
  title:                    text("title"),
  body:                     text("body").notNull(),
  visibilityScope:          text("visibility_scope").notNull().default("facility_wide"),
  priority:                 text("priority").notNull().default("normal"),
  status:                   text("status").notNull().default("open"),
  ackRequired:              integer("ack_required").notNull().default(0),
  ackRequiredRole:          text("ack_required_role"),
  followUpBy:               ts("follow_up_by"),
  effectiveUntil:           ts("effective_until"),
  isQuick:                  integer("is_quick").notNull().default(0),
  authorFacilityAccountId:  fk("author_facility_account_id").notNull(),
  authorStaffId:            fk("author_staff_id"),
  authorDisplayName:        text("author_display_name").notNull(),
  authorRole:               text("author_role").notNull(),
  editCount:                integer("edit_count").notNull().default(0),
  lastEditedAt:             ts("last_edited_at"),
  lastEditedByAccountId:    fk("last_edited_by_account_id"),
  archivedAt:               ts("archived_at"),
  archivedByAccountId:      fk("archived_by_account_id"),
  deletedAt:                ts("deleted_at"),
  deletedByAccountId:       fk("deleted_by_account_id"),
  createdAt:                ts("created_at").notNull(),
  updatedAt:                ts("updated_at").notNull(),
});

export const opsNoteVersions = pgTable("ops_note_versions", {
  id:                  serial("id").primaryKey(),
  noteId:              fk("note_id").notNull(),
  version:             integer("version").notNull(),
  title:               text("title"),
  body:                text("body").notNull(),
  editedByAccountId:   fk("edited_by_account_id").notNull(),
  editReason:          text("edit_reason"),
  editedAt:            ts("edited_at").notNull(),
});

export const opsNoteAttachments = pgTable("ops_note_attachments", {
  id:                     serial("id").primaryKey(),
  noteId:                 fk("note_id").notNull(),
  uploadedByAccountId:    fk("uploaded_by_account_id").notNull(),
  storageKey:             text("storage_key").notNull(),
  filename:               text("filename").notNull(),
  mimeType:               text("mime_type").notNull(),
  sizeBytes:              bigint("size_bytes", { mode: "number" }).notNull(),
  scanStatus:             text("scan_status").notNull().default("pending"),
  scannedAt:              ts("scanned_at"),
  removedAt:              ts("removed_at"),
  removedByAccountId:     fk("removed_by_account_id"),
  removedReason:          text("removed_reason"),
  createdAt:              ts("created_at").notNull(),
});

export const opsNoteMentions = pgTable("ops_note_mentions", {
  id:                serial("id").primaryKey(),
  noteId:            fk("note_id").notNull(),
  mentionedStaffId:  fk("mentioned_staff_id"),
  mentionedRole:     text("mentioned_role"),
  readAt:            ts("read_at"),
  createdAt:         ts("created_at").notNull(),
});

export const opsNoteAcknowledgments = pgTable("ops_note_acknowledgments", {
  id:                                serial("id").primaryKey(),
  noteId:                            fk("note_id").notNull(),
  acknowledgerFacilityAccountId:     fk("acknowledger_facility_account_id").notNull(),
  acknowledgerStaffId:               fk("acknowledger_staff_id"),
  acknowledgedAt:                    ts("acknowledged_at").notNull(),
  deviceInfo:                        text("device_info"),
});

export const opsNoteTags = pgTable("ops_note_tags", {
  noteId: fk("note_id").notNull(),
  tag:    text("tag").notNull(),
});

export const opsNoteAuditLog = pgTable("ops_note_audit_log", {
  id:                       serial("id").primaryKey(),
  noteId:                   fk("note_id").notNull(),
  actorFacilityAccountId:   fk("actor_facility_account_id"),
  action:                   text("action").notNull(),
  payloadDiff:              text("payload_diff"),
  ipAddress:                text("ip_address"),
  userAgent:                text("user_agent"),
  occurredAt:               ts("occurred_at").notNull(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Inferred TypeScript types
// ─────────────────────────────────────────────────────────────────────────────

export type OpsNote                    = typeof opsNotes.$inferSelect;
export type InsertOpsNote              = typeof opsNotes.$inferInsert;

export type OpsNoteVersion             = typeof opsNoteVersions.$inferSelect;
export type InsertOpsNoteVersion       = typeof opsNoteVersions.$inferInsert;

export type OpsNoteAttachment          = typeof opsNoteAttachments.$inferSelect;
export type InsertOpsNoteAttachment    = typeof opsNoteAttachments.$inferInsert;

export type OpsNoteMention             = typeof opsNoteMentions.$inferSelect;
export type InsertOpsNoteMention       = typeof opsNoteMentions.$inferInsert;

export type OpsNoteAcknowledgment      = typeof opsNoteAcknowledgments.$inferSelect;
export type InsertOpsNoteAcknowledgment = typeof opsNoteAcknowledgments.$inferInsert;

export type OpsNoteTag                 = typeof opsNoteTags.$inferSelect;
export type InsertOpsNoteTag           = typeof opsNoteTags.$inferInsert;

export type OpsNoteAuditEntry          = typeof opsNoteAuditLog.$inferSelect;
export type InsertOpsNoteAuditEntry    = typeof opsNoteAuditLog.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas (input validation, shared between client & server)
// ─────────────────────────────────────────────────────────────────────────────

export const noteCategorySchema = z.enum([
  "general",
  "resident_update",
  "care_instruction",
  "shift_handoff",
  "behavioral_observation",
  "family_communication",
  "provider_followup",
  "facility_announcement",
  "medication_followup",
  "incident_followup",
  "compliance_note",
]);
export type NoteCategory = z.infer<typeof noteCategorySchema>;

export const noteVisibilitySchema = z.enum([
  "facility_wide",
  "resident_specific",
  "shift",
  "admin_only",
  "compliance",
  "provider",
]);
export type NoteVisibility = z.infer<typeof noteVisibilitySchema>;

export const notePrioritySchema = z.enum(["normal", "urgent"]);
export type NotePriority = z.infer<typeof notePrioritySchema>;

export const noteStatusSchema = z.enum(["open", "archived", "deleted"]);
export type NoteStatus = z.infer<typeof noteStatusSchema>;

export const ackRequiredRoleSchema = z.enum([
  "caregivers_on_shift",
  "med_techs",
  "supervisors",
  "all_staff",
]);
export type AckRequiredRole = z.infer<typeof ackRequiredRoleSchema>;

export const attachmentScanStatusSchema = z.enum([
  "pending",
  "clean",
  "infected",
  "failed",
]);
export type AttachmentScanStatus = z.infer<typeof attachmentScanStatusSchema>;

// Tag rules: lowercased, alphanumeric + _ + -, 1–32 chars. The transform makes
// .parse() output the canonical lowercased form so callers don't need to.
export const noteTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(32)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "tags must be alphanumeric, _ or -")
  .transform((s) => s.toLowerCase());

// Categories that REQUIRE a residentId. Mirrors §8 of the Notes blueprint.
const RESIDENT_REQUIRED_CATEGORIES: NoteCategory[] = [
  "resident_update",
  "care_instruction",
  "behavioral_observation",
  "family_communication",
  "provider_followup",
  "medication_followup",
  "incident_followup",
];

export const createNoteInputSchema = z
  .object({
    category:           noteCategorySchema,
    residentId:         z.number().int().positive().optional(),
    shiftId:            z.number().int().positive().optional(),
    parentNoteId:       z.number().int().positive().optional(),
    title:              z.string().trim().max(200).optional(),
    body:               z.string().trim().min(1).max(10_000),
    visibilityScope:    noteVisibilitySchema.default("facility_wide"),
    priority:           notePrioritySchema.default("normal"),
    ackRequired:        z.boolean().default(false),
    ackRequiredRole:    ackRequiredRoleSchema.optional(),
    followUpBy:         z.number().int().nonnegative().optional(),
    effectiveUntil:     z.number().int().nonnegative().optional(),
    isQuick:            z.boolean().default(false),
    tags:               z.array(noteTagSchema).max(20).default([]),
    mentionedStaffIds:  z.array(z.number().int().positive()).max(50).default([]),
    mentionedRoles:     z.array(z.string().trim().min(1).max(32)).max(10).default([]),
  })
  .superRefine((val, ctx) => {
    if (RESIDENT_REQUIRED_CATEGORIES.includes(val.category) && !val.residentId) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["residentId"],
        message: `residentId is required for category "${val.category}"`,
      });
    }
    if (val.effectiveUntil !== undefined && val.category !== "care_instruction") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effectiveUntil"],
        message: `effectiveUntil is only valid for category "care_instruction"`,
      });
    }
    if (val.ackRequiredRole !== undefined && !val.ackRequired) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ackRequiredRole"],
        message: `ackRequiredRole has no effect when ackRequired is false`,
      });
    }
  });
export type CreateNoteInput = z.infer<typeof createNoteInputSchema>;

export const updateNoteInputSchema = z.object({
  title:           z.string().trim().max(200).nullable().optional(),
  body:            z.string().trim().min(1).max(10_000).optional(),
  priority:        notePrioritySchema.optional(),
  followUpBy:      z.number().int().nonnegative().nullable().optional(),
  effectiveUntil:  z.number().int().nonnegative().nullable().optional(),
  tags:            z.array(noteTagSchema).max(20).optional(),
  editReason:      z.string().trim().max(500).optional(),
});
export type UpdateNoteInput = z.infer<typeof updateNoteInputSchema>;

export const replyNoteInputSchema = z.object({
  body:               z.string().trim().min(1).max(10_000),
  mentionedStaffIds:  z.array(z.number().int().positive()).max(50).default([]),
  mentionedRoles:     z.array(z.string().trim().min(1).max(32)).max(10).default([]),
});
export type ReplyNoteInput = z.infer<typeof replyNoteInputSchema>;

export const acknowledgeNoteInputSchema = z.object({
  deviceInfo: z.record(z.unknown()).optional(),
});
export type AcknowledgeNoteInput = z.infer<typeof acknowledgeNoteInputSchema>;

// CSV-or-array helper for query params: ?category=a,b OR ?category=a&category=b
const csvOrArray = <T extends z.ZodTypeAny>(item: T) =>
  z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : v.split(",")))
    .transform((arr) => arr.map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(item));

export const listNotesQuerySchema = z.object({
  residentId:        z.coerce.number().int().positive().optional(),
  shiftId:           z.coerce.number().int().positive().optional(),
  authorAccountId:   z.coerce.number().int().positive().optional(),
  category:          csvOrArray(noteCategorySchema).optional(),
  status:            csvOrArray(noteStatusSchema).optional(),
  priority:          notePrioritySchema.optional(),
  needsMyAck:        z.coerce.boolean().optional(),
  mentionsMe:        z.coerce.boolean().optional(),
  hasAttachment:     z.coerce.boolean().optional(),
  tag:               z.string().trim().min(1).max(32).optional(),
  q:                 z.string().trim().min(1).max(200).optional(),
  since:             z.coerce.number().int().nonnegative().optional(),
  until:             z.coerce.number().int().nonnegative().optional(),
  cursor:            z.string().min(1).max(200).optional(),
  limit:             z.coerce.number().int().min(1).max(100).default(25),
  sort:              z
    .enum(["created_at:desc", "created_at:asc", "follow_up_by:asc"])
    .default("created_at:desc"),
  rootsOnly:         z.coerce.boolean().default(true),
});
export type ListNotesQuery = z.infer<typeof listNotesQuerySchema>;

// Audit-log action vocabulary. Open enum on the DB side (just TEXT) so future
// actions don't require a migration; Zod here is the source of truth at runtime.
export const noteAuditActionSchema = z.enum([
  "created",
  "edited",
  "replied",
  "acked",
  "archived",
  "unarchived",
  "deleted",
  "attachment_added",
  "attachment_removed",
  "mention_added",
  "follow_up_set",
  "follow_up_cleared",
  "exported",
  "viewed_sensitive",
]);
export type NoteAuditAction = z.infer<typeof noteAuditActionSchema>;
