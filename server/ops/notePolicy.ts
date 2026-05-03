/**
 * Notes module — authorization policy.
 *
 * Pure functions. No DB calls, no req/res. Every route handler routes
 * through these checks before touching storage. Unit-tested in
 * server/__tests__/notePolicy.test.ts so any matrix change shows up
 * as a test failure.
 *
 * Role model
 * ──────────
 * The blueprint defines 8 roles. Today the only logged-in actor type
 * is a FacilityAccount, which we model as `facility_admin`. When
 * per-staff auth ships, NoteViewerContext.role gets populated from
 * the ops_staff record and these checks just start working — no
 * change to call sites required.
 */

import type {
  NoteCategory,
  NoteVisibility,
  CreateNoteInput,
  OpsNote,
} from "./notesSchema";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export type NoteRole =
  | "super_admin"
  | "facility_admin"
  | "supervisor"
  | "med_tech"
  | "caregiver"
  | "wellness_staff"
  | "provider"
  | "compliance_reviewer";

export type NoteViewerContext = {
  facilityAccountId: number;
  facilityNumber: string;
  staffId?: number | null;
  displayName: string;
  role: NoteRole;
  /**
   * Resident ids the viewer is currently assigned to (today's shift).
   * Empty array = not assigned to anyone. Populated from ops_shifts +
   * staff assignment once that data is available; for now callers
   * pass [] and resident_specific notes fall back to facility-wide
   * visibility for facility_admin.
   */
  assignedResidentIds?: number[];
};

export type EditWindow = {
  /** Minutes after creation that an author may still edit. */
  authorEditMinutes: number;
};

export const DEFAULT_EDIT_WINDOW: EditWindow = { authorEditMinutes: 15 };

// ─────────────────────────────────────────────────────────────────────────────
// Role groupings (small helpers — keep matrix readable)
// ─────────────────────────────────────────────────────────────────────────────

const ADMIN_ROLES: NoteRole[] = ["super_admin", "facility_admin"];
const SUPERVISORY_ROLES: NoteRole[] = [...ADMIN_ROLES, "supervisor"];
const CLINICAL_ROLES: NoteRole[] = [
  ...SUPERVISORY_ROLES,
  "med_tech",
  "caregiver",
];

function isAdmin(viewer: NoteViewerContext): boolean {
  return ADMIN_ROLES.includes(viewer.role);
}

function isSupervisory(viewer: NoteViewerContext): boolean {
  return SUPERVISORY_ROLES.includes(viewer.role);
}

function isAuthor(viewer: NoteViewerContext, note: OpsNote): boolean {
  return note.authorFacilityAccountId === viewer.facilityAccountId;
}

function sameFacility(viewer: NoteViewerContext, note: OpsNote): boolean {
  return viewer.facilityNumber === note.facilityNumber;
}

// Categories that may only be created by supervisory/admin roles.
const SUPERVISORY_CATEGORIES: NoteCategory[] = [
  "facility_announcement",
  "compliance_note",
  "incident_followup",
];

// Categories that require an active resident link.
const RESIDENT_REQUIRED_CATEGORIES: NoteCategory[] = [
  "resident_update",
  "care_instruction",
  "behavioral_observation",
  "family_communication",
  "provider_followup",
  "medication_followup",
  "incident_followup",
];

// ─────────────────────────────────────────────────────────────────────────────
// Visibility check — the most security-critical function in the module.
// ─────────────────────────────────────────────────────────────────────────────

export function canViewNote(
  viewer: NoteViewerContext,
  note: OpsNote,
): boolean {
  // Cross-facility reads are never allowed, period. (super_admin who needs
  // multi-facility access uses a dedicated admin endpoint, not this one.)
  if (!sameFacility(viewer, note)) return false;

  // Soft-deleted: only the author and admins see them, and they're shown as
  // tombstones in the audit view.
  if (note.deletedAt !== null) {
    return isAdmin(viewer) || isAuthor(viewer, note);
  }

  // Compliance reviewer is read-only across the facility, but never on
  // admin_only or provider-scoped notes (those have a tighter audience).
  if (viewer.role === "compliance_reviewer") {
    return note.visibilityScope !== "admin_only";
  }

  const scope = note.visibilityScope as NoteVisibility;

  switch (scope) {
    case "facility_wide":
      return true;

    case "resident_specific": {
      // Author always sees their own. Supervisory roles see any resident
      // note. Clinical staff see notes for residents they're assigned to;
      // when assignment data isn't populated yet, admins still see
      // (preserves usability during the auth-gap period).
      if (isAuthor(viewer, note)) return true;
      if (isSupervisory(viewer)) return true;
      if (note.residentId === null) return CLINICAL_ROLES.includes(viewer.role);
      const assigned = viewer.assignedResidentIds ?? [];
      if (assigned.length === 0) {
        // No assignment data yet — admin-only is the safe default. We let
        // facility_admin through (they're admin) but block lower roles.
        return isAdmin(viewer);
      }
      return assigned.includes(note.residentId);
    }

    case "shift": {
      // Shift-scoped: supervisors and admins always; clinical staff only
      // when shift assignment is populated (not yet — falls through to
      // false for them today).
      if (isSupervisory(viewer)) return true;
      // Future: check viewer.shiftIds.includes(note.shiftId)
      return false;
    }

    case "admin_only":
      return isSupervisory(viewer);

    case "compliance":
      // Author + admins + compliance_reviewer (handled above).
      return isAdmin(viewer) || isAuthor(viewer, note);

    case "provider":
      // Author + admins + the provider in question. With current auth,
      // collapses to author + admin.
      if (isAdmin(viewer) || isAuthor(viewer, note)) return true;
      return viewer.role === "provider";

    default:
      // Unknown scope = deny. Visibility is opt-in, never opt-out.
      return false;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Create
// ─────────────────────────────────────────────────────────────────────────────

export function canCreateNote(
  viewer: NoteViewerContext,
  draft: Pick<CreateNoteInput, "category" | "visibilityScope" | "residentId">,
): { ok: true } | { ok: false; reason: string } {
  // compliance_reviewer is read-only.
  if (viewer.role === "compliance_reviewer") {
    return { ok: false, reason: "compliance_reviewer cannot create notes" };
  }

  // Restricted categories require supervisory rank.
  if (
    SUPERVISORY_CATEGORIES.includes(draft.category) &&
    !isSupervisory(viewer)
  ) {
    return {
      ok: false,
      reason: `category "${draft.category}" requires supervisor or admin`,
    };
  }

  // Care instructions: supervisor+ or provider only (caregivers receive,
  // they don't author).
  if (
    draft.category === "care_instruction" &&
    !isSupervisory(viewer) &&
    viewer.role !== "provider" &&
    viewer.role !== "med_tech"
  ) {
    return {
      ok: false,
      reason: "care_instruction requires med_tech, supervisor, admin, or provider",
    };
  }

  // Visibility narrowing: a non-admin cannot post admin_only or compliance.
  if (
    (draft.visibilityScope === "admin_only" ||
      draft.visibilityScope === "compliance") &&
    !isSupervisory(viewer)
  ) {
    return {
      ok: false,
      reason: `visibility "${draft.visibilityScope}" requires supervisor or admin`,
    };
  }

  // Resident-required categories are validated at the Zod layer too, but we
  // double-check here so policy alone is auditable.
  if (
    RESIDENT_REQUIRED_CATEGORIES.includes(draft.category) &&
    !draft.residentId
  ) {
    return {
      ok: false,
      reason: `category "${draft.category}" requires residentId`,
    };
  }

  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Edit / delete / archive
// ─────────────────────────────────────────────────────────────────────────────

export function canEditNote(
  viewer: NoteViewerContext,
  note: OpsNote,
  now: number = Date.now(),
  editWindow: EditWindow = DEFAULT_EDIT_WINDOW,
): { ok: true; requiresEditReason: boolean } | { ok: false; reason: string } {
  if (!sameFacility(viewer, note)) {
    return { ok: false, reason: "cross-facility edit denied" };
  }
  if (note.deletedAt !== null) {
    return { ok: false, reason: "note is deleted" };
  }
  if (viewer.role === "compliance_reviewer") {
    return { ok: false, reason: "compliance_reviewer is read-only" };
  }

  // Admins can always edit; reason required if the note has any acks.
  if (isAdmin(viewer)) {
    return { ok: true, requiresEditReason: false };
  }

  // Author can edit their own within the edit window.
  if (isAuthor(viewer, note)) {
    const ageMs = now - note.createdAt;
    if (ageMs <= editWindow.authorEditMinutes * 60 * 1000) {
      return { ok: true, requiresEditReason: false };
    }
    return {
      ok: false,
      reason: `edit window of ${editWindow.authorEditMinutes} min has passed`,
    };
  }

  return { ok: false, reason: "only author or admin can edit" };
}

export function canDeleteNote(
  viewer: NoteViewerContext,
  note: OpsNote,
  now: number = Date.now(),
  editWindow: EditWindow = DEFAULT_EDIT_WINDOW,
): { ok: true } | { ok: false; reason: string } {
  if (!sameFacility(viewer, note)) {
    return { ok: false, reason: "cross-facility delete denied" };
  }
  if (note.deletedAt !== null) {
    return { ok: false, reason: "already deleted" };
  }
  if (viewer.role === "compliance_reviewer") {
    return { ok: false, reason: "compliance_reviewer is read-only" };
  }

  // Admins anytime. Authors within the edit window. Nobody else.
  if (isAdmin(viewer)) return { ok: true };
  if (isAuthor(viewer, note)) {
    const ageMs = now - note.createdAt;
    if (ageMs <= editWindow.authorEditMinutes * 60 * 1000) {
      return { ok: true };
    }
    return {
      ok: false,
      reason: `delete window of ${editWindow.authorEditMinutes} min has passed`,
    };
  }
  return { ok: false, reason: "only author or admin can delete" };
}

export function canArchiveNote(
  viewer: NoteViewerContext,
  note: OpsNote,
): { ok: true } | { ok: false; reason: string } {
  if (!sameFacility(viewer, note)) {
    return { ok: false, reason: "cross-facility archive denied" };
  }
  if (note.deletedAt !== null) {
    return { ok: false, reason: "note is deleted" };
  }
  // Supervisor+ can archive anything they can see. Authors can archive
  // their own. Caregivers cannot archive (avoids accidentally hiding
  // care instructions from their team).
  if (isSupervisory(viewer)) return { ok: true };
  if (isAuthor(viewer, note)) return { ok: true };
  return { ok: false, reason: "only author or supervisor+ can archive" };
}

// ─────────────────────────────────────────────────────────────────────────────
// Acknowledge / reply
// ─────────────────────────────────────────────────────────────────────────────

export function canAcknowledgeNote(
  viewer: NoteViewerContext,
  note: OpsNote,
): { ok: true } | { ok: false; reason: string } {
  if (!canViewNote(viewer, note)) {
    return { ok: false, reason: "cannot view this note" };
  }
  if (note.deletedAt !== null) {
    return { ok: false, reason: "note is deleted" };
  }
  if (viewer.role === "compliance_reviewer") {
    return { ok: false, reason: "compliance_reviewer is read-only" };
  }
  return { ok: true };
}

export function canReplyToNote(
  viewer: NoteViewerContext,
  note: OpsNote,
): { ok: true } | { ok: false; reason: string } {
  if (!canViewNote(viewer, note)) {
    return { ok: false, reason: "cannot view this note" };
  }
  if (note.deletedAt !== null) {
    return { ok: false, reason: "note is deleted" };
  }
  if (note.archivedAt !== null) {
    return { ok: false, reason: "note is archived" };
  }
  if (viewer.role === "compliance_reviewer") {
    return { ok: false, reason: "compliance_reviewer is read-only" };
  }
  // Replies are first-class notes. The category-restriction rules from
  // canCreateNote apply only to the root note; replies inherit visibility
  // and never set their own category.
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Convenience: a single function the route layer can call to enforce the
// "must be readable" check that gates almost every endpoint.
// ─────────────────────────────────────────────────────────────────────────────

export function assertCanView(
  viewer: NoteViewerContext,
  note: OpsNote,
): void | never {
  if (!canViewNote(viewer, note)) {
    const err = new Error("Forbidden") as Error & { status?: number };
    err.status = 403;
    throw err;
  }
}
