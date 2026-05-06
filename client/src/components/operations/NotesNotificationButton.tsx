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

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { NotesContent } from "@/components/operations/NotesContent";
import { MessageSquare } from "lucide-react";

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

export function NotesNotificationButton({
  facilityNumber,
}: {
  facilityNumber: string;
}) {
  const [open, setOpen] = useState(false);
  const enabled = !!facilityNumber;

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

  return (
    <Sheet open={open} onOpenChange={setOpen}>
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
        <div
          className="flex items-center gap-2 px-5 py-3 border-b shrink-0"
          style={{
            background: "linear-gradient(120deg, #EEF2FF 0%, #FFF0F6 100%)",
            borderColor: "#E0E7FF",
          }}
        >
          <MessageSquare className="h-5 w-5" style={{ color: "#818CF8" }} />
          <div className="min-w-0">
            <h2
              className="text-base font-semibold leading-tight"
              style={{ color: "#1E1B4B" }}
            >
              Team notes
            </h2>
            <p className="text-xs text-muted-foreground">
              {urgentCount > 0
                ? `${urgentCount} urgent · awaiting acknowledgement`
                : "Shift handoffs, memos, and follow-ups"}
            </p>
          </div>
        </div>

        {enabled && (
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <NotesContent facilityNumber={facilityNumber} embedded />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
