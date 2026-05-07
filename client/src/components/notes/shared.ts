/**
 * Shared types, group model, and URL helpers used by both:
 *   - the embedded Notes feed in OperationsTab (`NotesContent`)
 *   - the dedicated Notes page at `/facility-portal/notes`
 *
 * Lifted verbatim from `client/src/components/operations/NotesContent.tsx`
 * during the Slice 1 split-pane redesign — behavior unchanged.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Types — minimal client-side mirrors of the API response shapes.
// ─────────────────────────────────────────────────────────────────────────────

export type NoteListItem = {
  id: number;
  facilityNumber: string;
  parentNoteId: number | null;
  category: string;
  residentId: number | null;
  title: string | null;
  body: string;
  visibilityScope: string;
  priority: "normal" | "urgent";
  status: "open" | "archived" | "deleted";
  ackRequired: number;
  authorFacilityAccountId: number;
  authorDisplayName: string;
  authorRole: string;
  archivedAt: number | null;
  deletedAt: number | null;
  createdAt: number;
  updatedAt: number;
  editCount: number;
  tags: string[];
};

export type NoteDetail = {
  note: NoteListItem;
  tags: string[];
  attachments: Array<{ id: number; filename: string }>;
  mentions: Array<{ id: number }>;
  acknowledgments: Array<{
    id: number;
    acknowledgerFacilityAccountId: number;
    acknowledgedAt: number;
  }>;
  replies: NoteListItem[];
  versions: Array<{ id: number; version: number }>;
};

export type ListResponse = {
  success: boolean;
  data: { items: NoteListItem[]; nextCursor: string | null };
};

export type DetailResponse = {
  success: boolean;
  data: NoteDetail;
};

export type Resident = {
  id: number;
  firstName: string;
  lastName: string;
  status?: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Group model
// ─────────────────────────────────────────────────────────────────────────────

export type GroupKey = "all" | "residents" | "staff" | "memos" | "providers";

export type ArchivedFlag = 0 | 1;

export const GROUP_LABEL: Record<GroupKey, string> = {
  all: "All",
  residents: "Residents",
  staff: "Staff",
  memos: "Internal Memos",
  providers: "Providers",
};

// Backend categories that belong to each group. "All" sends no category filter.
export const GROUP_CATEGORIES: Record<GroupKey, string[]> = {
  all: [],
  residents: [
    "resident_update",
    "care_instruction",
    "behavioral_observation",
    "family_communication",
    "medication_followup",
    "incident_followup",
  ],
  staff: ["general", "shift_handoff"],
  memos: ["facility_announcement", "compliance_note"],
  providers: ["provider_followup"],
};

// When composing inside a group, this is the category the new note posts as.
// `all` defaults to Staff (since "all" isn't a real bucket to write to).
export const GROUP_DEFAULT_POST_CATEGORY: Record<GroupKey, string> = {
  all: "general",
  residents: "resident_update",
  staff: "general",
  memos: "facility_announcement",
  providers: "provider_followup",
};

export const GROUP_VISIBILITY: Record<GroupKey, string> = {
  all: "facility_wide",
  residents: "resident_specific",
  staff: "facility_wide",
  memos: "admin_only",
  providers: "provider",
};

export const GROUP_REQUIRES_RESIDENT: Record<GroupKey, boolean> = {
  all: false,
  residents: true,
  staff: false,
  memos: false,
  providers: true,
};

// Map a note's backend category back to the group it should appear under in
// the UI — used for the inline group badge on note cards in the All view.
export function categoryToGroup(category: string): GroupKey {
  for (const g of ["residents", "staff", "memos", "providers"] as GroupKey[]) {
    if (GROUP_CATEGORIES[g].includes(category)) return g;
  }
  return "staff";
}

export function composerPlaceholder(group: GroupKey): string {
  switch (group) {
    case "residents":
      return "Update about this resident…";
    case "memos":
      return "Internal memo for the team…";
    case "providers":
      return "Note for a provider visit, instruction, or follow-up…";
    case "staff":
    default:
      return "Quick note for the team…";
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// URL helper for the list query — same shape used by both the embedded feed
// and the dedicated Notes page so React Query dedupes the cache hit with
// OperationsTab's `["/api/ops/notes?status=open&limit=50"]` query.
// ─────────────────────────────────────────────────────────────────────────────

export function buildListUrl(
  group: GroupKey,
  search: string,
  showArchived: boolean,
): string {
  const params = new URLSearchParams();

  // Status: open by default. When "Show archived" is toggled, include archived
  // alongside open so the user can see both.
  params.set("status", showArchived ? "open,archived" : "open");

  // Category filter, when the group narrows it.
  const cats = GROUP_CATEGORIES[group];
  if (cats.length > 0) params.set("category", cats.join(","));

  if (search) params.set("q", search);
  params.set("limit", "50");

  return `/api/ops/notes?${params.toString()}`;
}
