/**
 * NotesContent — Operations > Notes view.
 *
 * Caring-Data-style group model:
 *   All • Residents • Staff • Internal Memos • Providers
 *
 * Each group maps to one or more backend note categories (see GROUP_CATEGORIES).
 * Composing inside a group implicitly picks the right category + visibility
 * scope; the Residents and Providers groups additionally require a resident.
 *
 * Urgent / archived have moved off the primary axis: urgent notes are still
 * flagged inline (red border), and a "Show archived" toggle in the secondary
 * controls row replaces the old Archived chip.
 *
 * Rendered as a sub-view of OperationsTab. Auth + facilityNumber are already
 * guaranteed by the parent.
 */

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import {
  ArrowLeft,
  AlertCircle,
  MoreHorizontal,
  Archive,
  Trash2,
  RotateCcw,
  CheckCheck,
  MessageSquare,
  Search,
  X,
  Users,
  UserCog,
  Megaphone,
  Stethoscope,
  Layers,
  ExternalLink,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { useResidents } from "@/hooks/useResidents";
import { track, type NotesSurface } from "@/lib/telemetry";

// Lifted shared model + composer pieces. The dedicated Notes page at
// /facility-portal/notes consumes the same shared module + composer/* set.
import {
  GROUP_LABEL,
  GROUP_REQUIRES_RESIDENT,
  buildListUrl,
  categoryToGroup,
  type DetailResponse,
  type GroupKey,
  type ListResponse,
  type NoteListItem,
  type Resident,
} from "@/components/notes/shared";
import { Composer } from "@/components/notes/composer/Composer";
import { ReplyBox } from "@/components/notes/composer/ReplyBox";
import { ReplyItem } from "@/components/notes/composer/ReplyItem";
import { NoteCardSkeleton } from "@/components/notes/composer/NoteCardSkeleton";

// ─────────────────────────────────────────────────────────────────────────────
// Top-level component
// ─────────────────────────────────────────────────────────────────────────────

export function NotesContent({
  facilityNumber,
  onBack,
  embedded = false,
  surface = "drawer",
  onStateChange,
}: {
  facilityNumber: string;
  onBack?: () => void;
  /**
   * When true, renders without the gradient page header and back link.
   * Used by OperationsTab to inline the notes feed inside the overview.
   */
  embedded?: boolean;
  /**
   * Telemetry surface tag for note view/ack events. Defaults to "drawer"
   * since the only current consumer using `embedded` is the bell drawer.
   */
  surface?: NotesSurface;
  /**
   * Optional callback fired when the active filter (group/search/archived)
   * changes. Used by the bell drawer to build deep-link URLs to the
   * dedicated /facility-portal/notes page.
   */
  onStateChange?: (s: { group: GroupKey; q: string; archived: boolean }) => void;
}) {
  const [group, setGroup] = useState<GroupKey>("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [showArchived, setShowArchived] = useState(false);

  // Debounce the search input → query param.
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(t);
  }, [searchInput]);

  // Surface filter state to a parent (drawer) so it can build deep-link
  // URLs to the dedicated page. Fires whenever any of the three tracked
  // bits change.
  useEffect(() => {
    onStateChange?.({ group, q: search, archived: showArchived });
  }, [group, search, showArchived, onStateChange]);

  const queryUrl = useMemo(
    () => buildListUrl(group, search, showArchived),
    [group, search, showArchived],
  );

  const {
    data: envelope,
    isLoading,
    error,
  } = useQuery<ListResponse | null>({
    queryKey: [queryUrl],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 15_000,
  });

  // Lazy-load residents only when the active group needs them (compose box
  // dropdown). The picker also re-uses this list.
  const needsResidents =
    GROUP_REQUIRES_RESIDENT[group] || group === "all";
  const { residents } = useResidents(facilityNumber, {
    activeOnly: false,
    enabled: needsResidents,
  });

  const items = envelope?.data?.items ?? [];

  return (
    <div className={cn("space-y-4", !embedded && "max-w-3xl mx-auto pb-12")}>
      {/* ── Header ───────────────────────────────────────────────── */}
      {!embedded && onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Overview
        </button>
      )}

      {!embedded && (
        <div
          className="flex items-center gap-2 px-4 py-3 rounded-xl"
          style={{
            background: "linear-gradient(120deg, #EEF2FF 0%, #FFF0F6 100%)",
            border: "1px solid #E0E7FF",
          }}
        >
          <MessageSquare className="h-5 w-5" style={{ color: "#818CF8" }} />
          <div>
            <h2
              className="text-base font-semibold leading-tight"
              style={{ color: "#1E1B4B" }}
            >
              Notes
            </h2>
            <p className="text-xs" style={{ color: "#6B7280" }}>
              Operational communication for Facility #{facilityNumber}
            </p>
          </div>
        </div>
      )}

      {/* ── Composer (always visible) ────────────────────────────── */}
      <Composer activeGroup={group} residents={residents} />

      {/* ── Primary group chips + "View all" deep link ───────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex-1 min-w-0">
          <GroupChips value={group} onChange={setGroup} />
        </div>
        <a
          href="#/facility-portal/notes"
          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline shrink-0"
          aria-label="Open the dedicated Notes page"
        >
          View all notes
          <ExternalLink className="h-3 w-3" />
        </a>
      </div>

      {/* ── Secondary controls: search + archived toggle ─────────── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search notes…"
            className="h-9 pl-8 pr-8 text-sm"
          />
          {searchInput && (
            <button
              onClick={() => setSearchInput("")}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-muted text-muted-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setShowArchived((v) => !v)}
          className={cn(
            "text-xs font-medium px-3 py-1.5 rounded-full border transition-colors h-9",
            showArchived
              ? "bg-foreground text-background border-foreground"
              : "bg-card text-muted-foreground border-border hover:text-foreground",
          )}
          aria-pressed={showArchived}
        >
          {showArchived ? "Showing archived" : "Show archived"}
        </button>
      </div>

      {/* ── Feed ─────────────────────────────────────────────────── */}
      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
          Failed to load notes. Please refresh.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <NoteCardSkeleton key={i} />
          ))}
        </div>
      ) : items.length === 0 ? (
        <EmptyState group={group} hasSearch={search.length > 0} />
      ) : (
        <div className="space-y-3">
          {items.map((note) => (
            <NoteCard
              key={note.id}
              note={note}
              showGroupBadge={group === "all"}
              residents={residents}
              surface={surface}
              facilityNumber={facilityNumber}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Group chips (primary filter)
// ─────────────────────────────────────────────────────────────────────────────

function GroupChips({
  value,
  onChange,
}: {
  value: GroupKey;
  onChange: (v: GroupKey) => void;
}) {
  const chips: Array<{ key: GroupKey; label: string; icon: typeof Layers }> = [
    { key: "all", label: GROUP_LABEL.all, icon: Layers },
    { key: "residents", label: GROUP_LABEL.residents, icon: Users },
    { key: "staff", label: GROUP_LABEL.staff, icon: UserCog },
    { key: "memos", label: GROUP_LABEL.memos, icon: Megaphone },
    { key: "providers", label: GROUP_LABEL.providers, icon: Stethoscope },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {chips.map((c) => {
        const Icon = c.icon;
        const active = value === c.key;
        return (
          <button
            key={c.key}
            onClick={() => onChange(c.key)}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors",
              active
                ? "bg-foreground text-background border-foreground"
                : "bg-card text-muted-foreground border-border hover:text-foreground",
            )}
            aria-pressed={active}
          >
            <Icon className="h-3.5 w-3.5" />
            {c.label}
          </button>
        );
      })}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Note card — collapsed by default; click to expand thread + reply box.
// ─────────────────────────────────────────────────────────────────────────────

function NoteCard({
  note,
  showGroupBadge,
  residents,
  surface,
  facilityNumber,
}: {
  note: NoteListItem;
  showGroupBadge: boolean;
  residents: Resident[];
  surface: NotesSurface;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [optimisticAcked, setOptimisticAcked] = useState(false);
  const [optimisticArchived, setOptimisticArchived] = useState(false);

  // Lazy-load full thread only when card is expanded.
  const detailQuery = useQuery<DetailResponse | null>({
    queryKey: [`/api/ops/notes/${note.id}`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: expanded,
    staleTime: 5_000,
  });

  const detail = detailQuery.data?.data;
  const ackCount = detail?.acknowledgments.length ?? 0;

  const ackMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/notes/${note.id}/ack`, {});
      return res.json();
    },
    onSuccess: () => {
      setOptimisticAcked(true);
      queryClient.invalidateQueries({ queryKey: [`/api/ops/notes/${note.id}`] });
      track("notes.note.acked", {
        surface,
        noteId: note.id,
        group: categoryToGroup(note.category),
        facilityNumber,
      });
    },
    onError: (e: Error) =>
      toast({ title: "Ack failed", description: e.message, variant: "destructive" }),
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      const path = note.archivedAt
        ? `/api/ops/notes/${note.id}/unarchive`
        : `/api/ops/notes/${note.id}/archive`;
      const res = await apiRequest("POST", path, {});
      return res.json();
    },
    onSuccess: () => {
      setOptimisticArchived(true);
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && k.startsWith("/api/ops/notes");
        },
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Archive failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/ops/notes/${note.id}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && k.startsWith("/api/ops/notes");
        },
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Delete failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const isUrgent = note.priority === "urgent";
  const isArchived = !!note.archivedAt || optimisticArchived;
  const showAcked = optimisticAcked;
  const noteGroup = categoryToGroup(note.category);
  const resident =
    note.residentId !== null
      ? residents.find((r) => r.id === note.residentId)
      : null;

  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm transition-shadow",
        isUrgent && "border-l-4 border-l-red-500",
        isArchived && "opacity-70",
      )}
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-1 flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
        <span className="font-medium text-foreground">
          {note.authorDisplayName}
        </span>
        <span>·</span>
        <span title={new Date(note.createdAt).toLocaleString()}>
          {formatDistanceToNow(new Date(note.createdAt), { addSuffix: true })}
        </span>
        {note.editCount > 0 && (
          <>
            <span>·</span>
            <span className="italic">edited</span>
          </>
        )}
        {showGroupBadge && (
          <Badge variant="outline" className="ml-1 h-5 text-[10px]">
            {GROUP_LABEL[noteGroup]}
          </Badge>
        )}
        {resident && (
          <Badge
            variant="outline"
            className="h-5 text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200"
          >
            {resident.firstName} {resident.lastName}
          </Badge>
        )}
        {isUrgent && (
          <Badge
            variant="outline"
            className="bg-red-50 text-red-700 border-red-200 ml-1 h-5 text-[10px] gap-1"
          >
            <AlertCircle className="h-3 w-3" />
            Urgent
          </Badge>
        )}
        {isArchived && (
          <Badge variant="outline" className="ml-1 h-5 text-[10px]">
            Archived
          </Badge>
        )}
        <div className="ml-auto">
          <CardMenu
            note={note}
            onArchive={() => archiveMutation.mutate()}
            onDelete={() => {
              if (
                window.confirm(
                  "Delete this note? It can still be recovered from the audit log.",
                )
              ) {
                deleteMutation.mutate();
              }
            }}
            archiveBusy={archiveMutation.isPending}
            deleteBusy={deleteMutation.isPending}
            isArchived={isArchived}
          />
        </div>
      </div>

      {/* Body */}
      <div className="px-4 pb-2">
        <p className="text-sm whitespace-pre-wrap break-words">{note.body}</p>
        {note.tags.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {note.tags.map((t) => (
              <span
                key={t}
                className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5"
              >
                #{t}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Action row */}
      <div className="px-3 pb-2 flex items-center gap-1">
        <Button
          variant="ghost"
          size="sm"
          className="h-8 text-xs gap-1.5"
          onClick={() =>
            setExpanded((v) => {
              // Fire telemetry only on the false → true transition (a real
              // "view"). Collapsing back is not interesting.
              if (!v) {
                track("notes.note.viewed", {
                  surface,
                  noteId: note.id,
                  group: categoryToGroup(note.category),
                  facilityNumber,
                });
              }
              return !v;
            })
          }
        >
          <MessageSquare className="h-3.5 w-3.5" />
          {expanded ? "Hide thread" : "Reply"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className={cn(
            "h-8 text-xs gap-1.5",
            showAcked && "text-green-600",
          )}
          onClick={() => {
            if (!showAcked) ackMutation.mutate();
          }}
          disabled={ackMutation.isPending || showAcked}
        >
          <CheckCheck className="h-3.5 w-3.5" />
          {showAcked
            ? "Acked"
            : expanded && ackCount > 0
              ? `Ack · ${ackCount}`
              : "Ack"}
        </Button>
      </div>

      {/* Expanded thread */}
      {expanded && (
        <div className="border-t border-border px-4 py-3 space-y-3 bg-muted/20">
          {detailQuery.isLoading ? (
            <Skeleton className="h-12" />
          ) : detail ? (
            <>
              {detail.replies.length === 0 ? (
                <p className="text-xs text-muted-foreground italic">
                  No replies yet.
                </p>
              ) : (
                <div className="space-y-2">
                  {detail.replies.map((r) => (
                    <ReplyItem key={r.id} reply={r} />
                  ))}
                </div>
              )}
              <ReplyBox parentNoteId={note.id} />
            </>
          ) : (
            <p className="text-xs text-destructive">Failed to load thread.</p>
          )}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Card menu (… → Archive / Delete)
// ─────────────────────────────────────────────────────────────────────────────

function CardMenu({
  onArchive,
  onDelete,
  archiveBusy,
  deleteBusy,
  isArchived,
}: {
  note: NoteListItem;
  onArchive: () => void;
  onDelete: () => void;
  archiveBusy: boolean;
  deleteBusy: boolean;
  isArchived: boolean;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Note actions"
          className="p-1 rounded-md hover:bg-muted text-muted-foreground"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-40">
        <DropdownMenuItem onClick={onArchive} disabled={archiveBusy}>
          {isArchived ? (
            <>
              <RotateCcw className="h-4 w-4 mr-2" />
              Unarchive
            </>
          ) : (
            <>
              <Archive className="h-4 w-4 mr-2" />
              Archive
            </>
          )}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={onDelete}
          disabled={deleteBusy}
          className="text-destructive focus:text-destructive"
        >
          <Trash2 className="h-4 w-4 mr-2" />
          Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Empty state
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({
  group,
  hasSearch,
}: {
  group: GroupKey;
  hasSearch: boolean;
}) {
  if (hasSearch) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
        No notes match your search.
      </div>
    );
  }
  const message: Record<GroupKey, string> = {
    all: "No notes yet. Use the composer above to start.",
    residents:
      "No resident notes yet. Pick a resident in the composer to add the first one.",
    staff: "No staff notes yet. Share a quick update with the team above.",
    memos:
      "No internal memos yet. Use the composer to post an announcement or operational note.",
    providers:
      "No provider notes yet. Log a visit, instruction, or follow-up using the composer.",
  };
  return (
    <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
      {message[group]}
    </div>
  );
}

