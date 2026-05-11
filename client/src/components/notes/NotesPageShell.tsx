/**
 * NotesPageShell — sticky page header (title + facility crumb + back to portal)
 * wrapping toolbar + group tabs + responsive split pane.
 *
 * Holds the page-level orchestration:
 *   - Reads URL state via `useNotesUrlState` and is the single source of truth.
 *   - Forwards selection / mutation hooks down to the panes. Stale-selection
 *     clearing is owned by `NotesListPane` itself (gated on settled query
 *     state) so it doesn't race a just-clicked selection.
 *
 * Slice 2 of the Notes module redesign:
 *   - Replaces the plain page-header heading block with the shared
 *     `NotesIdentityHeader` (variant="expanded") so the bell drawer and
 *     this page render byte-identical chrome.
 *   - Subscribes to the same urgent-count query the bell drawer uses
 *     (`?status=open&limit=50`) — React Query dedupes, no extra network.
 *   - Fires `notes.surface.opened` once on mount.
 *   - Provides a "Quick triage drawer" button to round-trip back to the
 *     portal + open the bell drawer (filter context intentionally dropped).
 *
 * Slice 2.5: an optional `mode="modal"` rendering used by the bell drawer's
 * "Open full view" affordance. In modal mode the shell uses local state
 * (seeded from `initialFilterState`) instead of URL state so opening the
 * modal doesn't pollute the address bar; the `leftSlot` (Back to portal) and
 * `rightSlot` (Quick triage drawer) affordances are replaced by a single
 * Close (X) button in the rightSlot. Outer container drops `min-h-screen`
 * for `h-full` so the shell fills the modal's height.
 */
import { useEffect, useState } from "react";
import { ArrowLeft, ExternalLink, X } from "lucide-react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { useNotesUrlState } from "@/hooks/useNotesUrlState";
import { track } from "@/lib/telemetry";
import { NotesIdentityHeader } from "./NotesIdentityHeader";
import { NotesToolbar } from "./NotesToolbar";
import { NoteGroupTabs } from "./NoteGroupTabs";
import { NotesListPane } from "./NotesListPane";
import { NoteDetailPane } from "./NoteDetailPane";
import { NotesSplitPane } from "./NotesSplitPane";
import type { GroupKey, ListResponse } from "./shared";

export type NotesPageShellMode = "page" | "modal";

export interface NotesPageShellInitialState {
  group: GroupKey;
  q: string;
  archived: 0 | 1;
}

export interface NotesPageShellProps {
  facilityNumber: string;
  /** "page" (default) reads/writes URL state; "modal" uses local state only. */
  mode?: NotesPageShellMode;
  /** Seed value when `mode="modal"`. Ignored in "page" mode (URL is the source of truth). */
  initialFilterState?: NotesPageShellInitialState;
  /** Close handler. Required in modal mode; ignored in page mode. */
  onClose?: () => void;
}

// Match the bell drawer + OperationsTab notes-count query so RQ dedupes.
const URGENT_QUERY_KEY = `/api/ops/notes?status=open&limit=50`;

export function NotesPageShell({
  facilityNumber,
  mode = "page",
  initialFilterState,
  onClose,
}: NotesPageShellProps) {
  const urlState = useNotesUrlState();
  const [, navigate] = useLocation();

  // Modal-mode local state. Seeded from `initialFilterState` (typically the
  // bell drawer's live filter), but never written back to the drawer or the
  // URL — closing the modal discards everything.
  const [modalState, setModalState] = useState({
    group: (initialFilterState?.group ?? "all") as GroupKey,
    q: initialFilterState?.q ?? "",
    archived: (initialFilterState?.archived ?? 0) as 0 | 1,
    noteId: null as number | null,
  });

  // Adapter that exposes the same shape as `useNotesUrlState` for both modes.
  // The inner panes/toolbar/tabs only need group/q/archived/noteId + setters.
  const url =
    mode === "page"
      ? urlState
      : {
          group: modalState.group,
          q: modalState.q,
          archived: modalState.archived,
          noteId: modalState.noteId,
          setGroup: (g: GroupKey) =>
            setModalState((s) => ({ ...s, group: g, noteId: null })),
          setNoteId: (id: number | null) =>
            setModalState((s) => ({ ...s, noteId: id })),
          setSearch: (q: string) => setModalState((s) => ({ ...s, q })),
          setArchived: (a: 0 | 1) => setModalState((s) => ({ ...s, archived: a })),
          patch: () => {
            // Modal mode never calls patch; included only to satisfy the
            // shared shape with useNotesUrlState's NotesUrlStateApi.
          },
        };

  // Same query the drawer uses → React Query dedupes; no extra network.
  const { data: urgentEnvelope } = useQuery<ListResponse | null>({
    queryKey: [URGENT_QUERY_KEY],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 30_000,
  });
  const urgentCount = (urgentEnvelope?.data?.items ?? []).filter(
    (n) => n.priority === "urgent" && n.status === "open",
  ).length;

  // One-shot surface-opened telemetry. The auth gate is upstream in
  // NotesPage, so by the time the shell mounts we know auth is resolved.
  useEffect(() => {
    track("notes.surface.opened", {
      surface: "page",
      facilityNumber,
    });
  }, [facilityNumber]);

  const handleQuickTriage = () => {
    // 1) Route back to the portal. 2) Pop the bell drawer. Filter context
    // is intentionally NOT preserved in this direction — the drawer is
    // for quick triage, the page is for deep work.
    navigate("/facility-portal", { replace: false });
    // Defer one tick so FacilityPortal mounts and NotesNotificationButton's
    // `arf:open-notes` listener attaches before we dispatch — a synchronous
    // dispatch fires into the void since the listener doesn't exist yet.
    setTimeout(() => {
      window.dispatchEvent(new Event("arf:open-notes"));
    }, 0);
  };

  const showDetailOnMobile = url.noteId !== null;
  const isModal = mode === "modal";

  const list = (
    <NotesListPane
      facilityNumber={facilityNumber}
      group={url.group}
      q={url.q}
      archived={url.archived}
      selectedNoteId={url.noteId}
      onSelect={(id) => url.setNoteId(id)}
      onClearSelection={() => url.setNoteId(null)}
      onClearSearch={() => url.setSearch("")}
      // Modal opens with no `noteId` (local state, never seeded from URL) so
      // the right pane would otherwise render "Select a note to read" until
      // the user clicks. Auto-selecting the first item is the actual fix —
      // page mode stays URL-driven and intentionally renders the empty state
      // when the URL has no `noteId`.
      autoSelectFirst={isModal}
    />
  );

  const detail = (
    <NoteDetailPane
      noteId={url.noteId}
      showBack={showDetailOnMobile}
      onBack={() => url.setNoteId(null)}
      onDeleted={() => url.setNoteId(null)}
    />
  );

  // In modal mode the leftSlot is empty (no "back to portal" — there's no
  // route to go back to) and the rightSlot is a Close X. In page mode the
  // existing "Back to portal" + "Quick triage drawer" pair is preserved.
  const leftSlot = isModal ? null : (
    <a href="#/facility-portal">
      <Button variant="ghost" size="sm" className="-ml-2">
        <ArrowLeft className="h-4 w-4 mr-1.5" />
        Back to portal
      </Button>
    </a>
  );
  const rightSlot = isModal ? (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClose}
      aria-label="Close full view"
      data-testid="notes-modal-close"
      className="text-xs"
    >
      Close
      <X className="h-3.5 w-3.5 ml-1" />
    </Button>
  ) : (
    <Button
      variant="ghost"
      size="sm"
      onClick={handleQuickTriage}
      aria-label="Open the quick triage drawer"
      data-testid="notes-page-quick-triage"
      className="text-xs"
    >
      Quick triage drawer
      <ExternalLink className="h-3 w-3 ml-1" />
    </Button>
  );

  return (
    <div
      className={
        isModal
          ? "h-full flex flex-col bg-background overflow-hidden"
          : "min-h-screen flex flex-col bg-background"
      }
    >
      {/* Sticky page header */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="px-4 pt-3 pb-2">
          <NotesIdentityHeader
            variant="expanded"
            facilityNumber={facilityNumber}
            urgentCount={urgentCount}
            leftSlot={leftSlot}
            rightSlot={rightSlot}
          />
        </div>

        <div className="px-4 pb-3 space-y-2">
          <NotesToolbar
            facilityNumber={facilityNumber}
            group={url.group}
            q={url.q}
            archived={url.archived}
            onSearchChange={url.setSearch}
            onArchivedChange={url.setArchived}
          />
          <NoteGroupTabs value={url.group} onChange={url.setGroup} />
        </div>
      </header>

      {/* Split pane */}
      <NotesSplitPane
        list={list}
        detail={detail}
        showDetailOnMobile={showDetailOnMobile}
      />
    </div>
  );
}
