/**
 * Outlook-style notes notification button.
 *
 * Lives in the FacilityPortal header. Shows a messages icon with a red count
 * badge when urgent open notes exist; clicking opens the full Notes feed
 * (composer + filters + thread) in a right-side drawer.
 *
 * Drawer hosts the existing NotesContent component in embedded mode so the
 * empty state, post flow, replies, and acknowledgements all work without
 * duplication.
 *
 * Query key alignment: uses `?status=open&limit=50` to match
 * OperationsTab's notes-count query and the FacilityPortal Operations-tab
 * indicator. React Query dedupes the request across the app.
 *
 * Listens for `arf:open-notes` window events so OperationsTab keyboard
 * shortcuts (g+n) and "Open" actions on note alerts can pop the drawer
 * without coupling to the bell's local state.
 */

import { useCallback, useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { NotesContent } from "@/components/operations/NotesContent";
import { NotesIdentityHeader } from "@/components/notes/NotesIdentityHeader";
import { MessageSquare, ExternalLink } from "lucide-react";
import { useFeatureFlag } from "@/lib/featureFlags";
import { track } from "@/lib/telemetry";
import type { GroupKey } from "@/components/notes/shared";

interface NoteListItem {
  id: number;
  priority: "normal" | "urgent";
  status: "open" | "archived" | "deleted";
}

interface ListResponse {
  success: boolean;
  data: { items: NoteListItem[]; nextCursor: string | null };
}

// Match OperationsTab's notes-count query so React Query dedupes.
const QUERY_KEY = `/api/ops/notes?status=open&limit=50`;

interface DrawerFilterState {
  group: GroupKey;
  q: string;
  archived: boolean;
}

/**
 * Build the deep-link URL for the dedicated /facility-portal/notes page,
 * preserving the drawer's current filter state. Defaults are omitted from
 * the query string so the canonical "All / open" shape stays minimal.
 */
export function buildDedicatedPageUrl(state: DrawerFilterState): string {
  const params = new URLSearchParams();
  if (state.group !== "all") params.set("group", state.group);
  if (state.q) params.set("q", state.q);
  if (state.archived) params.set("archived", "1");
  const qs = params.toString();
  return qs ? `#/facility-portal/notes?${qs}` : "#/facility-portal/notes";
}

export function NotesNotificationButton({
  facilityNumber,
}: {
  facilityNumber: string;
}) {
  const [open, setOpen] = useState(false);
  const [filterState, setFilterState] = useState<DrawerFilterState>({
    group: "all",
    q: "",
    archived: false,
  });
  const enabled = !!facilityNumber;
  const dedicatedPageEnabled = useFeatureFlag("notes_dedicated_page");

  // Allow OperationsTab keyboard shortcut g+n + alert actions to open the
  // drawer without lifting state.
  useEffect(() => {
    function onOpen() { setOpen(true); }
    window.addEventListener("arf:open-notes", onOpen);
    return () => window.removeEventListener("arf:open-notes", onOpen);
  }, []);

  const { data } = useQuery<ListResponse | null>({
    queryKey: [QUERY_KEY],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled,
    staleTime: 30_000,
  });

  const urgentCount = (data?.data?.items ?? []).filter(
    (n) => n.priority === "urgent" && n.status === "open",
  ).length;

  // Stable callback so NotesContent doesn't re-fire useEffect every render.
  const handleStateChange = useCallback((s: DrawerFilterState) => {
    setFilterState(s);
  }, []);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      track("notes.surface.opened", {
        surface: "drawer",
        facilityNumber,
      });
    }
  };

  const fullViewUrl = buildDedicatedPageUrl(filterState);

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <button
          type="button"
          aria-label={
            urgentCount > 0
              ? `Team notes — ${urgentCount} urgent`
              : "Team notes"
          }
          className="relative h-9 w-9 rounded-full flex items-center justify-center text-gray-600 hover:bg-white/70 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
        >
          <MessageSquare className="h-5 w-5" />
          {urgentCount > 0 && (
            <span
              className="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] px-1 rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center tabular-nums shadow-sm"
              aria-hidden
            >
              {urgentCount > 99 ? "99+" : urgentCount}
            </span>
          )}
        </button>
      </SheetTrigger>

      <SheetContent
        side="right"
        className="p-0 w-full sm:max-w-lg lg:max-w-xl flex flex-col"
      >
        <NotesIdentityHeader
          variant="compact"
          facilityNumber={facilityNumber}
          urgentCount={urgentCount}
          rightSlot={
            dedicatedPageEnabled ? (
              <a
                href={fullViewUrl}
                onClick={() => setOpen(false)}
                className="inline-flex items-center gap-1 text-xs font-medium text-indigo-700 hover:text-indigo-900 hover:underline"
                aria-label="Open the dedicated Notes page"
                data-testid="notes-drawer-open-full-view"
              >
                Open full view
                <ExternalLink className="h-3 w-3" />
              </a>
            ) : null
          }
        />

        {enabled && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <NotesContent
              facilityNumber={facilityNumber}
              embedded
              surface="drawer"
              onStateChange={handleStateChange}
            />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
