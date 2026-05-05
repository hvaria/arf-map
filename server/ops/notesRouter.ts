/**
 * Notes module — Express router.
 *
 * Mounted at /api/ops/notes by opsRouter (which already enforces facility
 * auth). Every handler:
 *   1. Pulls AuthorContext from req.user
 *   2. Validates input via Zod
 *   3. Loads the affected note (if any) and runs the policy check
 *   4. Calls notesStorage
 *   5. Returns { success, data } or { success, error }
 *
 * No PHI is logged. Errors are surfaced as 400/403/404/409/500.
 */

import { Router, type Request, type Response } from "express";
import {
  acknowledgeNote,
  archiveNote,
  createNote,
  getNoteById,
  getNoteDetail,
  listNotes,
  replyToNote,
  softDeleteNote,
  unarchiveNote,
  updateNote,
  type AuthorContext,
  type RequestContext,
} from "./notesStorage";
import {
  acknowledgeNoteInputSchema,
  createNoteInputSchema,
  listNotesQuerySchema,
  replyNoteInputSchema,
  updateNoteInputSchema,
  type OpsNote,
} from "./notesSchema";
import {
  canAcknowledgeNote,
  canArchiveNote,
  canCreateNote,
  canDeleteNote,
  canEditNote,
  canReplyToNote,
  canViewNote,
  type NoteRole,
  type NoteViewerContext,
} from "./notePolicy";
import type { FacilityAccount } from "@shared/schema";

export const notesRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Context helpers
// ─────────────────────────────────────────────────────────────────────────────

const VALID_NOTE_ROLES: ReadonlySet<NoteRole> = new Set<NoteRole>([
  "super_admin",
  "facility_admin",
  "supervisor",
  "med_tech",
  "caregiver",
  "wellness_staff",
  "provider",
  "compliance_reviewer",
]);

function toNoteRole(raw: string | null | undefined): NoteRole {
  // Anything unknown falls back to facility_admin so a stale DB value or a
  // mid-deploy state doesn't lock the user out of the portal.
  return raw && VALID_NOTE_ROLES.has(raw as NoteRole)
    ? (raw as NoteRole)
    : "facility_admin";
}

function getViewer(req: Request): NoteViewerContext {
  const user = req.user as FacilityAccount;
  return {
    facilityAccountId: user.id,
    facilityNumber: user.facilityNumber,
    staffId: null,
    displayName: user.username,
    role: toNoteRole(user.role),
    assignedResidentIds: [],
  };
}

function getAuthor(req: Request): AuthorContext {
  const v = getViewer(req);
  return {
    facilityAccountId: v.facilityAccountId,
    facilityNumber: v.facilityNumber,
    staffId: v.staffId ?? null,
    displayName: v.displayName,
    role: v.role,
  };
}

function getReqCtx(req: Request): RequestContext {
  return {
    ipAddress: (req.ip ?? req.socket.remoteAddress) ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

function parseId(raw: string | string[] | undefined): number | null {
  if (typeof raw !== "string") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Loader middleware: resolves :id, enforces same-facility, runs view check.
// Attaches the note to res.locals.note for the handler to use.
// ─────────────────────────────────────────────────────────────────────────────

async function loadVisibleNote(
  req: Request,
  res: Response,
): Promise<OpsNote | null> {
  const id = parseId(req.params.id);
  if (id === null) {
    res.status(400).json({ success: false, error: "Invalid id" });
    return null;
  }
  const viewer = getViewer(req);
  const note = await getNoteById(id, viewer.facilityNumber);
  if (!note) {
    res.status(404).json({ success: false, error: "Not found" });
    return null;
  }
  if (!canViewNote(viewer, note)) {
    // 404 (not 403) for visibility failures — don't leak existence to
    // unauthorized viewers.
    res.status(404).json({ success: false, error: "Not found" });
    return null;
  }
  return note;
}

function zodErrorMessage(err: { errors: Array<{ message: string; path: (string | number)[] }> }): string {
  const e = err.errors[0];
  return e ? `${e.path.join(".") || "input"}: ${e.message}` : "Invalid input";
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /  — create root note
// ─────────────────────────────────────────────────────────────────────────────

notesRouter.post("/", async (req, res) => {
  try {
    const parsed = createNoteInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: zodErrorMessage(parsed.error) });
    }
    if (parsed.data.parentNoteId !== undefined) {
      return res.status(400).json({
        success: false,
        error: "Use POST /:id/replies to create a reply",
      });
    }

    const viewer = getViewer(req);
    const policy = canCreateNote(viewer, parsed.data);
    if (!policy.ok) {
      return res.status(403).json({ success: false, error: policy.reason });
    }

    // If a residentId is provided, it must belong to this facility (the
    // resident table query happens inside ops.getResident; for slice 2 we
    // trust the Zod-validated number and rely on the facilityNumber join in
    // listNotes/getNote downstream — slice 3 will add the explicit check
    // when the resident lookup is wired through this router).

    const author = getAuthor(req);
    const note = await createNote(parsed.data, author, getReqCtx(req));
    return res.status(201).json({ success: true, data: note });
  } catch (e) {
    console.error("[notes] POST / failed", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /   — list with filters + cursor pagination
// ─────────────────────────────────────────────────────────────────────────────

notesRouter.get("/", async (req, res) => {
  try {
    const parsed = listNotesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: zodErrorMessage(parsed.error) });
    }
    const viewer = getViewer(req);
    const result = await listNotes(viewer.facilityNumber, parsed.data, {
      facilityAccountId: viewer.facilityAccountId,
    });

    // Filter the result through canViewNote in case a future scope is more
    // restrictive than the SQL filter. Today this is a no-op for the
    // facility_admin role but keeps the policy module as the single source of
    // truth for visibility.
    const items = result.items.filter((n) => canViewNote(viewer, n));
    return res.json({
      success: true,
      data: { items, nextCursor: result.nextCursor },
    });
  } catch (e) {
    console.error("[notes] GET / failed", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /:id   — note detail (thread, attachments, mentions, acks, versions)
// ─────────────────────────────────────────────────────────────────────────────

notesRouter.get("/:id", async (req, res) => {
  try {
    const note = await loadVisibleNote(req, res);
    if (!note) return;
    const viewer = getViewer(req);
    const detail = await getNoteDetail(note.id, viewer.facilityNumber);
    if (!detail) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    // Filter replies through visibility too (defense-in-depth).
    detail.replies = detail.replies.filter((r) => canViewNote(viewer, r));
    return res.json({ success: true, data: detail });
  } catch (e) {
    console.error("[notes] GET /:id failed", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /:id   — versioned edit
// ─────────────────────────────────────────────────────────────────────────────

notesRouter.patch("/:id", async (req, res) => {
  try {
    const note = await loadVisibleNote(req, res);
    if (!note) return;

    const parsed = updateNoteInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: zodErrorMessage(parsed.error) });
    }

    const viewer = getViewer(req);
    const policy = canEditNote(viewer, note);
    if (!policy.ok) {
      return res.status(403).json({ success: false, error: policy.reason });
    }

    const updated = await updateNote(note, parsed.data, getAuthor(req), getReqCtx(req));
    return res.json({ success: true, data: updated });
  } catch (e) {
    console.error("[notes] PATCH /:id failed", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /:id   — soft delete
// ─────────────────────────────────────────────────────────────────────────────

notesRouter.delete("/:id", async (req, res) => {
  try {
    const note = await loadVisibleNote(req, res);
    if (!note) return;

    const viewer = getViewer(req);
    const policy = canDeleteNote(viewer, note);
    if (!policy.ok) {
      return res.status(403).json({ success: false, error: policy.reason });
    }

    const deleted = await softDeleteNote(note, getAuthor(req), getReqCtx(req));
    return res.json({ success: true, data: deleted });
  } catch (e) {
    console.error("[notes] DELETE /:id failed", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/replies   — child note inheriting parent context
// ─────────────────────────────────────────────────────────────────────────────

notesRouter.post("/:id/replies", async (req, res) => {
  try {
    const note = await loadVisibleNote(req, res);
    if (!note) return;

    const parsed = replyNoteInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: zodErrorMessage(parsed.error) });
    }

    const viewer = getViewer(req);
    const policy = canReplyToNote(viewer, note);
    if (!policy.ok) {
      return res.status(403).json({ success: false, error: policy.reason });
    }

    const reply = await replyToNote(note, parsed.data, getAuthor(req), getReqCtx(req));
    return res.status(201).json({ success: true, data: reply });
  } catch (e) {
    console.error("[notes] POST /:id/replies failed", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/ack
// ─────────────────────────────────────────────────────────────────────────────

notesRouter.post("/:id/ack", async (req, res) => {
  try {
    const note = await loadVisibleNote(req, res);
    if (!note) return;

    const parsed = acknowledgeNoteInputSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: zodErrorMessage(parsed.error) });
    }

    const viewer = getViewer(req);
    const policy = canAcknowledgeNote(viewer, note);
    if (!policy.ok) {
      return res.status(403).json({ success: false, error: policy.reason });
    }

    const result = await acknowledgeNote(
      note,
      getAuthor(req),
      parsed.data.deviceInfo as Record<string, unknown> | undefined,
      getReqCtx(req),
    );
    return res
      .status(result.alreadyAcked ? 200 : 201)
      .json({ success: true, data: result });
  } catch (e) {
    console.error("[notes] POST /:id/ack failed", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/archive  &  POST /:id/unarchive
// (Not in the canonical "6 endpoints" set but cheap to add and listed in
// §7 of the blueprint. Hide a note from default views without deleting.)
// ─────────────────────────────────────────────────────────────────────────────

notesRouter.post("/:id/archive", async (req, res) => {
  try {
    const note = await loadVisibleNote(req, res);
    if (!note) return;

    const viewer = getViewer(req);
    const policy = canArchiveNote(viewer, note);
    if (!policy.ok) {
      return res.status(403).json({ success: false, error: policy.reason });
    }

    const archived = await archiveNote(note, getAuthor(req), getReqCtx(req));
    return res.json({ success: true, data: archived });
  } catch (e) {
    console.error("[notes] POST /:id/archive failed", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});

notesRouter.post("/:id/unarchive", async (req, res) => {
  try {
    const note = await loadVisibleNote(req, res);
    if (!note) return;

    const viewer = getViewer(req);
    const policy = canArchiveNote(viewer, note);
    if (!policy.ok) {
      return res.status(403).json({ success: false, error: policy.reason });
    }

    const unarchived = await unarchiveNote(note, getAuthor(req), getReqCtx(req));
    return res.json({ success: true, data: unarchived });
  } catch (e) {
    console.error("[notes] POST /:id/unarchive failed", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});
