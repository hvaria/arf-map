/**
 * Notes module — repository / storage layer.
 *
 * Pure data access. No HTTP, no policy. Route handlers in notesRouter.ts
 * own auth + policy + Zod validation; this file just talks to Postgres.
 *
 * Every mutation writes a row to ops_note_audit_log via writeAudit().
 * Multi-table writes (note + tags + mentions) run inside a single
 * transaction so partial inserts can't leak.
 */

import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNull,
  lte,
  notExists,
  or,
  sql,
} from "drizzle-orm";
import { db, pool } from "../db/index";
import {
  NOTES_PG_SCHEMA_SQL,
  opsNotes,
  opsNoteVersions,
  opsNoteAttachments,
  opsNoteMentions,
  opsNoteAcknowledgments,
  opsNoteTags,
  opsNoteAuditLog,
  type OpsNote,
  type OpsNoteAttachment,
  type OpsNoteMention,
  type OpsNoteAcknowledgment,
  type OpsNoteVersion,
  type NoteAuditAction,
  type NoteCategory,
  type NoteVisibility,
  type NotePriority,
  type NoteStatus,
  type AckRequiredRole,
  type CreateNoteInput,
  type UpdateNoteInput,
  type ReplyNoteInput,
  type ListNotesQuery,
} from "./notesSchema";

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap (called from server/index.ts)
// ─────────────────────────────────────────────────────────────────────────────

export async function bootstrapNotesSchema(): Promise<void> {
  await pool.query(NOTES_PG_SCHEMA_SQL);
  console.log("[notes] PostgreSQL tables bootstrapped");
}

// ─────────────────────────────────────────────────────────────────────────────
// Author / actor context
// ─────────────────────────────────────────────────────────────────────────────

export type AuthorContext = {
  facilityAccountId: number;
  facilityNumber: string;
  staffId?: number | null;
  displayName: string;
  role: string;
};

export type RequestContext = {
  ipAddress?: string | null;
  userAgent?: string | null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function first<T>(rows: T[]): T | undefined {
  return rows[0];
}

function nullable<T>(v: T | undefined): T | null {
  return v === undefined ? null : v;
}

function toBool(n: number | null | undefined): boolean {
  return n === 1;
}

function fromBool(b: boolean): number {
  return b ? 1 : 0;
}

/** Cursor encodes (createdAt, id) so the keyset is stable across pages. */
function encodeCursor(c: { createdAt: number; id: number }): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(s: string): { createdAt: number; id: number } | null {
  try {
    const parsed = JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
    if (
      typeof parsed?.createdAt === "number" &&
      typeof parsed?.id === "number"
    ) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Audit log
// ─────────────────────────────────────────────────────────────────────────────

export async function writeAudit(
  noteId: number,
  action: NoteAuditAction,
  actor: AuthorContext | null,
  payloadDiff?: unknown,
  reqCtx?: RequestContext,
): Promise<void> {
  await db.insert(opsNoteAuditLog).values({
    noteId,
    actorFacilityAccountId: actor?.facilityAccountId ?? null,
    action,
    payloadDiff:
      payloadDiff === undefined ? null : JSON.stringify(payloadDiff),
    ipAddress: reqCtx?.ipAddress ?? null,
    userAgent: reqCtx?.userAgent ?? null,
    occurredAt: Date.now(),
  });
}

export async function listAuditEntries(
  noteId: number,
): Promise<Array<typeof opsNoteAuditLog.$inferSelect>> {
  return db
    .select()
    .from(opsNoteAuditLog)
    .where(eq(opsNoteAuditLog.noteId, noteId))
    .orderBy(desc(opsNoteAuditLog.occurredAt));
}

// ─────────────────────────────────────────────────────────────────────────────
// Tags + mentions (helpers used by create / reply / update)
// ─────────────────────────────────────────────────────────────────────────────

async function replaceTags(
  tx: typeof db,
  noteId: number,
  tags: string[],
): Promise<void> {
  await tx.delete(opsNoteTags).where(eq(opsNoteTags.noteId, noteId));
  if (tags.length === 0) return;
  // De-dup just in case the caller didn't.
  const unique = Array.from(new Set(tags.map((t) => t.toLowerCase())));
  await tx
    .insert(opsNoteTags)
    .values(unique.map((tag) => ({ noteId, tag })))
    .onConflictDoNothing();
}

async function addMentions(
  tx: typeof db,
  noteId: number,
  staffIds: number[],
  roles: string[],
): Promise<void> {
  const now = Date.now();
  const rows: Array<typeof opsNoteMentions.$inferInsert> = [];
  for (const staffId of Array.from(new Set(staffIds))) {
    rows.push({ noteId, mentionedStaffId: staffId, createdAt: now });
  }
  for (const role of Array.from(new Set(roles))) {
    rows.push({ noteId, mentionedRole: role, createdAt: now });
  }
  if (rows.length === 0) return;
  await tx.insert(opsNoteMentions).values(rows);
}

// ─────────────────────────────────────────────────────────────────────────────
// Read: get one note + related rows
// ─────────────────────────────────────────────────────────────────────────────

export type NoteDetail = {
  note: OpsNote;
  tags: string[];
  attachments: OpsNoteAttachment[];
  mentions: OpsNoteMention[];
  acknowledgments: OpsNoteAcknowledgment[];
  replies: OpsNote[];
  versions: OpsNoteVersion[];
};

export async function getNoteById(
  id: number,
  facilityNumber: string,
): Promise<OpsNote | undefined> {
  const rows = await db
    .select()
    .from(opsNotes)
    .where(
      and(
        eq(opsNotes.id, id),
        eq(opsNotes.facilityNumber, facilityNumber),
      ),
    );
  return first(rows);
}

export async function getNoteDetail(
  id: number,
  facilityNumber: string,
): Promise<NoteDetail | undefined> {
  const note = await getNoteById(id, facilityNumber);
  if (!note) return undefined;

  const [tagRows, attachments, mentions, acknowledgments, replies, versions] =
    await Promise.all([
      db
        .select({ tag: opsNoteTags.tag })
        .from(opsNoteTags)
        .where(eq(opsNoteTags.noteId, id)),
      db
        .select()
        .from(opsNoteAttachments)
        .where(eq(opsNoteAttachments.noteId, id))
        .orderBy(asc(opsNoteAttachments.createdAt)),
      db
        .select()
        .from(opsNoteMentions)
        .where(eq(opsNoteMentions.noteId, id))
        .orderBy(asc(opsNoteMentions.createdAt)),
      db
        .select()
        .from(opsNoteAcknowledgments)
        .where(eq(opsNoteAcknowledgments.noteId, id))
        .orderBy(asc(opsNoteAcknowledgments.acknowledgedAt)),
      db
        .select()
        .from(opsNotes)
        .where(
          and(
            eq(opsNotes.parentNoteId, id),
            eq(opsNotes.facilityNumber, facilityNumber),
            isNull(opsNotes.deletedAt),
          ),
        )
        .orderBy(asc(opsNotes.createdAt)),
      db
        .select()
        .from(opsNoteVersions)
        .where(eq(opsNoteVersions.noteId, id))
        .orderBy(desc(opsNoteVersions.version)),
    ]);

  return {
    note,
    tags: tagRows.map((r) => r.tag),
    attachments,
    mentions,
    acknowledgments,
    replies,
    versions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// List with cursor pagination + filters
// ─────────────────────────────────────────────────────────────────────────────

export type NoteListItem = OpsNote & { tags: string[] };

export type ListNotesResult = {
  items: NoteListItem[];
  nextCursor: string | null;
};

export async function listNotes(
  facilityNumber: string,
  query: ListNotesQuery,
  viewer: { facilityAccountId: number },
): Promise<ListNotesResult> {
  const conds = [
    eq(opsNotes.facilityNumber, facilityNumber),
    isNull(opsNotes.deletedAt),
  ];

  if (query.rootsOnly) {
    conds.push(isNull(opsNotes.parentNoteId));
  }

  if (query.residentId !== undefined) {
    conds.push(eq(opsNotes.residentId, query.residentId));
  }
  if (query.shiftId !== undefined) {
    conds.push(eq(opsNotes.shiftId, query.shiftId));
  }
  if (query.authorAccountId !== undefined) {
    conds.push(
      eq(opsNotes.authorFacilityAccountId, query.authorAccountId),
    );
  }
  if (query.priority !== undefined) {
    conds.push(eq(opsNotes.priority, query.priority));
  }
  if (query.category && query.category.length > 0) {
    conds.push(inArray(opsNotes.category, query.category as NoteCategory[]));
  }
  if (query.status && query.status.length > 0) {
    conds.push(inArray(opsNotes.status, query.status as NoteStatus[]));
  }
  if (query.since !== undefined) {
    conds.push(gte(opsNotes.createdAt, query.since));
  }
  if (query.until !== undefined) {
    conds.push(lte(opsNotes.createdAt, query.until));
  }
  if (query.q) {
    const like = `%${query.q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
    conds.push(
      or(
        ilike(opsNotes.body, like),
        ilike(opsNotes.title, like),
      )!,
    );
  }
  if (query.tag) {
    // Subquery: notes that have this tag.
    conds.push(
      sql`EXISTS (SELECT 1 FROM ${opsNoteTags} t WHERE t.note_id = ${opsNotes.id} AND t.tag = ${query.tag.toLowerCase()})`,
    );
  }
  if (query.needsMyAck) {
    conds.push(eq(opsNotes.ackRequired, 1));
    conds.push(
      notExists(
        db
          .select({ one: sql`1` })
          .from(opsNoteAcknowledgments)
          .where(
            and(
              eq(opsNoteAcknowledgments.noteId, opsNotes.id),
              eq(
                opsNoteAcknowledgments.acknowledgerFacilityAccountId,
                viewer.facilityAccountId,
              ),
            ),
          ),
      ),
    );
  }

  // Cursor (keyset on created_at desc, id desc).
  if (query.cursor) {
    const c = decodeCursor(query.cursor);
    if (c) {
      conds.push(
        sql`(${opsNotes.createdAt}, ${opsNotes.id}) < (${c.createdAt}, ${c.id})`,
      );
    }
  }

  const orderBy =
    query.sort === "created_at:asc"
      ? [asc(opsNotes.createdAt), asc(opsNotes.id)]
      : query.sort === "follow_up_by:asc"
        ? [asc(opsNotes.followUpBy), asc(opsNotes.id)]
        : [desc(opsNotes.createdAt), desc(opsNotes.id)];

  const rows = await db
    .select()
    .from(opsNotes)
    .where(and(...conds))
    .orderBy(...orderBy)
    .limit(query.limit + 1); // +1 to detect more

  const hasMore = rows.length > query.limit;
  const slice = hasMore ? rows.slice(0, query.limit) : rows;

  // Bulk-load tags for the page.
  const ids = slice.map((n) => n.id);
  const tagRows =
    ids.length === 0
      ? []
      : await db
          .select()
          .from(opsNoteTags)
          .where(inArray(opsNoteTags.noteId, ids));
  const tagsByNote = new Map<number, string[]>();
  for (const t of tagRows) {
    const arr = tagsByNote.get(t.noteId) ?? [];
    arr.push(t.tag);
    tagsByNote.set(t.noteId, arr);
  }

  const items: NoteListItem[] = slice.map((n) => ({
    ...n,
    tags: tagsByNote.get(n.id) ?? [],
  }));

  const nextCursor =
    hasMore && slice.length > 0
      ? encodeCursor({
          createdAt: slice[slice.length - 1].createdAt,
          id: slice[slice.length - 1].id,
        })
      : null;

  return { items, nextCursor };
}

// ─────────────────────────────────────────────────────────────────────────────
// Create (root note)
// ─────────────────────────────────────────────────────────────────────────────

export async function createNote(
  input: CreateNoteInput,
  author: AuthorContext,
  reqCtx?: RequestContext,
): Promise<OpsNote> {
  if (input.parentNoteId !== undefined) {
    throw new Error("createNote does not accept parentNoteId — use replyToNote");
  }
  const now = Date.now();

  const inserted = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(opsNotes)
      .values({
        facilityNumber: author.facilityNumber,
        category: input.category,
        residentId: input.residentId ?? null,
        shiftId: input.shiftId ?? null,
        title: input.title ?? null,
        body: input.body,
        visibilityScope: input.visibilityScope,
        priority: input.priority,
        ackRequired: fromBool(input.ackRequired),
        ackRequiredRole: input.ackRequiredRole ?? null,
        followUpBy: input.followUpBy ?? null,
        effectiveUntil: input.effectiveUntil ?? null,
        isQuick: fromBool(input.isQuick),
        authorFacilityAccountId: author.facilityAccountId,
        authorStaffId: author.staffId ?? null,
        authorDisplayName: author.displayName,
        authorRole: author.role,
        status: "open",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const note = rows[0]!;

    if (input.tags.length > 0) {
      await replaceTags(tx as unknown as typeof db, note.id, input.tags);
    }
    if (
      input.mentionedStaffIds.length > 0 ||
      input.mentionedRoles.length > 0
    ) {
      await addMentions(
        tx as unknown as typeof db,
        note.id,
        input.mentionedStaffIds,
        input.mentionedRoles,
      );
    }
    return note;
  });

  await writeAudit(
    inserted.id,
    "created",
    author,
    { category: input.category, priority: input.priority },
    reqCtx,
  );
  return inserted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reply (child note inheriting parent context)
// ─────────────────────────────────────────────────────────────────────────────

export async function replyToNote(
  parent: OpsNote,
  input: ReplyNoteInput,
  author: AuthorContext,
  reqCtx?: RequestContext,
): Promise<OpsNote> {
  const now = Date.now();
  const inserted = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(opsNotes)
      .values({
        facilityNumber: parent.facilityNumber,
        parentNoteId: parent.id,
        category: parent.category,
        residentId: parent.residentId,
        shiftId: parent.shiftId,
        title: null,
        body: input.body,
        visibilityScope: parent.visibilityScope,
        priority: "normal", // replies don't escalate priority
        ackRequired: 0,
        isQuick: 1,
        authorFacilityAccountId: author.facilityAccountId,
        authorStaffId: author.staffId ?? null,
        authorDisplayName: author.displayName,
        authorRole: author.role,
        status: "open",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    const reply = rows[0]!;

    if (
      input.mentionedStaffIds.length > 0 ||
      input.mentionedRoles.length > 0
    ) {
      await addMentions(
        tx as unknown as typeof db,
        reply.id,
        input.mentionedStaffIds,
        input.mentionedRoles,
      );
    }
    return reply;
  });

  await writeAudit(parent.id, "replied", author, { replyId: inserted.id }, reqCtx);
  return inserted;
}

// ─────────────────────────────────────────────────────────────────────────────
// Update (versioned edit)
// ─────────────────────────────────────────────────────────────────────────────

export async function updateNote(
  note: OpsNote,
  input: UpdateNoteInput,
  editor: AuthorContext,
  reqCtx?: RequestContext,
): Promise<OpsNote> {
  const now = Date.now();
  const nextVersion = note.editCount + 1;

  // Build the update object only with fields the caller actually set.
  const setFields: Partial<typeof opsNotes.$inferInsert> = {
    editCount: nextVersion,
    lastEditedAt: now,
    lastEditedByAccountId: editor.facilityAccountId,
    updatedAt: now,
  };
  const diff: Record<string, { from: unknown; to: unknown }> = {};

  if (input.title !== undefined) {
    setFields.title = input.title;
    diff.title = { from: note.title, to: input.title };
  }
  if (input.body !== undefined) {
    setFields.body = input.body;
    diff.body = { from: "(redacted in audit log)", to: "(updated)" };
  }
  if (input.priority !== undefined) {
    setFields.priority = input.priority;
    diff.priority = { from: note.priority, to: input.priority };
  }
  if (input.followUpBy !== undefined) {
    setFields.followUpBy = input.followUpBy;
    diff.followUpBy = { from: note.followUpBy, to: input.followUpBy };
  }
  if (input.effectiveUntil !== undefined) {
    setFields.effectiveUntil = input.effectiveUntil;
    diff.effectiveUntil = {
      from: note.effectiveUntil,
      to: input.effectiveUntil,
    };
  }

  const updated = await db.transaction(async (tx) => {
    // Snapshot the previous body+title into versions before we overwrite.
    if (input.body !== undefined || input.title !== undefined) {
      await tx.insert(opsNoteVersions).values({
        noteId: note.id,
        version: nextVersion,
        title: note.title,
        body: note.body,
        editedByAccountId: editor.facilityAccountId,
        editReason: input.editReason ?? null,
        editedAt: now,
      });
    }

    if (input.tags !== undefined) {
      await replaceTags(tx as unknown as typeof db, note.id, input.tags);
    }

    const rows = await tx
      .update(opsNotes)
      .set(setFields)
      .where(eq(opsNotes.id, note.id))
      .returning();
    return rows[0]!;
  });

  await writeAudit(
    note.id,
    "edited",
    editor,
    { version: nextVersion, fields: Object.keys(diff), reason: input.editReason ?? null },
    reqCtx,
  );
  return updated;
}

// ─────────────────────────────────────────────────────────────────────────────
// Acknowledge
// ─────────────────────────────────────────────────────────────────────────────

export type AcknowledgeResult = {
  acknowledgment: OpsNoteAcknowledgment;
  alreadyAcked: boolean;
};

export async function acknowledgeNote(
  note: OpsNote,
  acker: AuthorContext,
  deviceInfo?: Record<string, unknown>,
  reqCtx?: RequestContext,
): Promise<AcknowledgeResult> {
  const now = Date.now();
  const inserted = await db
    .insert(opsNoteAcknowledgments)
    .values({
      noteId: note.id,
      acknowledgerFacilityAccountId: acker.facilityAccountId,
      acknowledgerStaffId: acker.staffId ?? null,
      acknowledgedAt: now,
      deviceInfo: deviceInfo ? JSON.stringify(deviceInfo) : null,
    })
    .onConflictDoNothing({
      target: [
        opsNoteAcknowledgments.noteId,
        opsNoteAcknowledgments.acknowledgerFacilityAccountId,
      ],
    })
    .returning();

  if (inserted[0]) {
    await writeAudit(note.id, "acked", acker, undefined, reqCtx);
    return { acknowledgment: inserted[0], alreadyAcked: false };
  }

  // Already exists — fetch and return the existing row, no audit duplication.
  const existing = await db
    .select()
    .from(opsNoteAcknowledgments)
    .where(
      and(
        eq(opsNoteAcknowledgments.noteId, note.id),
        eq(
          opsNoteAcknowledgments.acknowledgerFacilityAccountId,
          acker.facilityAccountId,
        ),
      ),
    );
  return { acknowledgment: existing[0]!, alreadyAcked: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Archive / soft delete
// ─────────────────────────────────────────────────────────────────────────────

export async function archiveNote(
  note: OpsNote,
  actor: AuthorContext,
  reqCtx?: RequestContext,
): Promise<OpsNote> {
  const now = Date.now();
  const rows = await db
    .update(opsNotes)
    .set({
      archivedAt: now,
      archivedByAccountId: actor.facilityAccountId,
      status: "archived",
      updatedAt: now,
    })
    .where(eq(opsNotes.id, note.id))
    .returning();
  await writeAudit(note.id, "archived", actor, undefined, reqCtx);
  return rows[0]!;
}

export async function unarchiveNote(
  note: OpsNote,
  actor: AuthorContext,
  reqCtx?: RequestContext,
): Promise<OpsNote> {
  const now = Date.now();
  const rows = await db
    .update(opsNotes)
    .set({
      archivedAt: null,
      archivedByAccountId: null,
      status: "open",
      updatedAt: now,
    })
    .where(eq(opsNotes.id, note.id))
    .returning();
  await writeAudit(note.id, "unarchived", actor, undefined, reqCtx);
  return rows[0]!;
}

export async function softDeleteNote(
  note: OpsNote,
  actor: AuthorContext,
  reqCtx?: RequestContext,
): Promise<OpsNote> {
  const now = Date.now();
  const rows = await db
    .update(opsNotes)
    .set({
      deletedAt: now,
      deletedByAccountId: actor.facilityAccountId,
      status: "deleted",
      updatedAt: now,
    })
    .where(eq(opsNotes.id, note.id))
    .returning();
  await writeAudit(note.id, "deleted", actor, undefined, reqCtx);
  return rows[0]!;
}

// ─────────────────────────────────────────────────────────────────────────────
// Re-export common types for the router layer (avoids long import paths).
// ─────────────────────────────────────────────────────────────────────────────

export type {
  OpsNote,
  OpsNoteAttachment,
  OpsNoteMention,
  OpsNoteAcknowledgment,
  OpsNoteVersion,
  NoteCategory,
  NoteVisibility,
  NotePriority,
  NoteStatus,
  AckRequiredRole,
};
