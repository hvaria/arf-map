/**
 * Outlook-style notes notification button.
 *
 * Lives in the FacilityPortal header. Shows a messages icon with a red count
 * badge when urgent open notes exist; clicking opens the canonical Notes
 * overlay — a near-fullscreen, in-place modal hosted directly inside
 * Operations. There is no drawer / Sheet step — every Notes trigger
 * (bell click, alert "Open notes" action, work-queue references, keyboard
 * shortcut g+n) opens this same modal in the same place.
 *
 * Query key alignment: uses `?status=open&limit=50` to match
 * OperationsTab's notes-count query and the FacilityPortal Operations-tab
 * indicator. React Query dedupes the request across the app.
 *
 * Listens for `arf:open-notes` window events so OperationsTab keyboard
 * shortcuts and "Open" actions on note alerts open the modal without
 * coupling to local state.
 */

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { NotesPageShell } from "@/components/notes/NotesPageShell";
import { MessageSquare } from "lucide-react";
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

interface NotesFilterState {
  group: GroupKey;
  q: string;
  archived: boolean;
}

/**
 * Build the deep-link URL for the dedicated /facility-portal/notes page.
 * Retained for the external-arrival surface (email links, bookmarks)
 * called out in the brief's §4 / §9 carve-out — not used by any control
 * inside Operations.
 */
export function buildDedicatedPageUrl(state: NotesFilterState): string {
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
  const enabled = !!facilityNumber;

  // OperationsTab keyboard shortcut g+n + alert "Open notes" actions
  // dispatch this event; we open the canonical modal in response.
  useEffect(() => {
    function onOpen() {
      setOpen(true);
    }
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

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (next) {
      track("notes.surface.opened", {
        surface: "page",
        facilityNumber,
      });
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => handleOpenChange(true)}
        aria-label={
          urgentCount > 0
            ? `Team notes — ${urgentCount} urgent`
            : "Team notes"
        }
        data-testid="notes-bell-trigger"
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

      {/* Canonical Notes overlay — near-fullscreen with a 16px (1rem /
          Tailwind 4) margin from each viewport edge so the modal-shape is
          clearly visible against the underlying Operations screen. The
          dedicated /facility-portal/notes route is unchanged and remains
          the shareable-URL surface for external arrival only. */}
      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent
          // Override shadcn's centered defaults (left-[50%]/top-[50%]/translate
          // tricks + max-w-lg) so the modal sits 16px in from each viewport
          // edge — clearly modal, but near-fullscreen.
          className="p-0 gap-0 left-4 top-4 right-4 bottom-4 translate-x-0 translate-y-0 w-auto h-auto max-w-none sm:max-w-none rounded-xl flex flex-col overflow-hidden"
          data-testid="notes-overlay"
        >
          {enabled && (
            <NotesPageShell
              facilityNumber={facilityNumber}
              mode="modal"
              onClose={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
