/**
 * NotesListPane — left column on the dedicated Notes page.
 *
 * Owns:
 *  - The list query for the active group/search/archived combination.
 *  - Skeleton, empty, and error rendering.
 *  - Hover-prefetching of the per-note detail query (200ms debounce).
 *  - Best-effort scroll-position restore keyed by `group|archived|q`.
 *  - Clearing the selected `noteId` when the list query is settled and the
 *    selection is no longer present in `items[]` (e.g., after a group
 *    switch). The clear is gated on `!isFetching && isFetched` so a
 *    just-clicked note can't be deselected by an in-flight refetch
 *    resolving with stale items.
 */
import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { useResidents } from "@/hooks/useResidents";
import { cn } from "@/lib/utils";
import {
  GROUP_REQUIRES_RESIDENT,
  buildListUrl,
  type ArchivedFlag,
  type GroupKey,
  type ListResponse,
} from "./shared";
import { NotesListItem as NotesListItemRow } from "./NotesListItem";
import {
  ListEmptyState,
  ListErrorState,
  ListLoadingState,
} from "./NoteEmptyStates";

const PREFETCH_DELAY_MS = 200;

export interface NotesListPaneProps {
  facilityNumber: string;
  group: GroupKey;
  q: string;
  archived: ArchivedFlag;
  selectedNoteId: number | null;
  onSelect: (id: number) => void;
  /** Called when the list has settled and the selected id isn't present. */
  onClearSelection: () => void;
  onClearSearch: () => void;
  /**
   * When true, auto-select the first item once the list settles with no
   * current selection. Used by the modal surface so the right pane isn't
   * empty on open. Page mode leaves this false so the URL stays the source
   * of truth (an empty `noteId` param renders as "no selection").
   */
  autoSelectFirst?: boolean;
}

function scrollKey(group: GroupKey, archived: ArchivedFlag, q: string) {
  return `notes.scroll.${group}.${archived}.${q || ""}`;
}

export function NotesListPane({
  facilityNumber,
  group,
  q,
  archived,
  selectedNoteId,
  onSelect,
  onClearSelection,
  onClearSearch,
  autoSelectFirst = false,
}: NotesListPaneProps) {
  const queryClient = useQueryClient();
  const queryUrl = buildListUrl(group, q, archived === 1);

  const {
    data: envelope,
    isLoading,
    isFetching,
    isFetched,
    error,
  } = useQuery<ListResponse | null>({
    queryKey: [queryUrl],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 15_000,
  });

  // Resident list for the inline group/resident chip — same lazy pattern as
  // the embedded NotesContent so we don't fetch unless the active group can
  // surface a resident chip.
  const needsResidents =
    GROUP_REQUIRES_RESIDENT[group] || group === "all";
  const { residents } = useResidents(facilityNumber, {
    activeOnly: false,
    enabled: needsResidents,
  });

  const items = envelope?.data?.items ?? [];

  // Clear stale selection ONLY when the query has settled. Without the
  // `!isFetching` gate, an in-flight refetch resolving with the previous
  // items would race a just-clicked selection and silently drop it.
  const isSettled = !isFetching && isFetched;
  useEffect(() => {
    if (!isSettled) return;
    if (selectedNoteId === null) return;
    if (items.some((n) => n.id === selectedNoteId)) return;
    onClearSelection();
  }, [isSettled, selectedNoteId, items, onClearSelection]);

  // Auto-select the first item in modal mode so the right pane isn't empty on
  // open. Gated on `isSettled` so a still-loading list doesn't briefly pick a
  // stale first item before the real list arrives. Only fires when there's no
  // current selection — once the user picks something we never override.
  useEffect(() => {
    if (!autoSelectFirst) return;
    if (!isSettled) return;
    if (selectedNoteId !== null) return;
    if (items.length === 0) return;
    onSelect(items[0].id);
  }, [autoSelectFirst, isSettled, selectedNoteId, items, onSelect]);

  // ── Hover prefetch ────────────────────────────────────────────────────
  const prefetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelPrefetch = () => {
    if (prefetchTimerRef.current) {
      clearTimeout(prefetchTimerRef.current);
      prefetchTimerRef.current = null;
    }
  };
  const schedulePrefetch = (id: number) => {
    cancelPrefetch();
    prefetchTimerRef.current = setTimeout(() => {
      queryClient.prefetchQuery({
        queryKey: [`/api/ops/notes/${id}`],
        queryFn: getQueryFn({ on401: "returnNull" }),
        staleTime: 5_000,
      });
    }, PREFETCH_DELAY_MS);
  };
  useEffect(() => () => cancelPrefetch(), []);

  // ── Scroll-position restore ───────────────────────────────────────────
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const key = scrollKey(group, archived, q);

  // Restore on mount or whenever the query key changes (group/archived/q).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || isLoading) return;
    const stored = sessionStorage.getItem(key);
    if (stored) {
      const n = Number(stored);
      if (Number.isFinite(n)) el.scrollTop = n;
    } else {
      el.scrollTop = 0;
    }
  }, [key, isLoading]);

  // Persist on scroll (throttled by rAF).
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let raf = 0;
    const onScroll = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        sessionStorage.setItem(key, String(el.scrollTop));
      });
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [key]);

  return (
    <div
      ref={scrollRef}
      className={cn(
        "flex-1 min-h-0 overflow-y-auto",
        // Subtle background so the list pane reads as a container.
        "bg-card",
      )}
      role="region"
      aria-label="Notes list"
    >
      {error ? (
        <div className="p-3">
          <ListErrorState />
        </div>
      ) : isLoading ? (
        <ListLoadingState rows={8} />
      ) : items.length === 0 ? (
        <div className="p-3">
          <ListEmptyState
            group={group}
            hasSearch={q.length > 0}
            onClearSearch={q.length > 0 ? onClearSearch : undefined}
          />
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((note) => (
            <li key={note.id}>
              <NotesListItemRow
                note={note}
                residents={residents}
                selected={selectedNoteId === note.id}
                showGroupBadge={group === "all"}
                onClick={() => onSelect(note.id)}
                onMouseEnter={() => schedulePrefetch(note.id)}
                onMouseLeave={cancelPrefetch}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
