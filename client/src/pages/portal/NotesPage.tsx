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
  Send,
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
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

// ─────────────────────────────────────────────────────────────────────────────
// Types — minimal client-side mirrors of the API response shapes.
// ─────────────────────────────────────────────────────────────────────────────

type NoteListItem = {
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

type NoteDetail = {
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

type ListResponse = {
  success: boolean;
  data: { items: NoteListItem[]; nextCursor: string | null };
};

type DetailResponse = {
  success: boolean;
  data: NoteDetail;
};

type Resident = {
  id: number;
  firstName: string;
  lastName: string;
  status?: string;
};

type ResidentsResponse = {
  success: boolean;
  data: Resident[];
};

// ─────────────────────────────────────────────────────────────────────────────
// Group model
// ─────────────────────────────────────────────────────────────────────────────

type GroupKey = "all" | "residents" | "staff" | "memos" | "providers";

const GROUP_LABEL: Record<GroupKey, string> = {
  all: "All",
  residents: "Residents",
  staff: "Staff",
  memos: "Internal Memos",
  providers: "Providers",
};

// Backend categories that belong to each group. "All" sends no category filter.
const GROUP_CATEGORIES: Record<GroupKey, string[]> = {
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
const GROUP_DEFAULT_POST_CATEGORY: Record<GroupKey, string> = {
  all: "general",
  residents: "resident_update",
  staff: "general",
  memos: "facility_announcement",
  providers: "provider_followup",
};

const GROUP_VISIBILITY: Record<GroupKey, string> = {
  all: "facility_wide",
  residents: "resident_specific",
  staff: "facility_wide",
  memos: "admin_only",
  providers: "provider",
};

const GROUP_REQUIRES_RESIDENT: Record<GroupKey, boolean> = {
  all: false,
  residents: true,
  staff: false,
  memos: false,
  providers: true,
};

// Map a note's backend category back to the group it should appear under in
// the UI — used only for the inline group badge on note cards in the All view.
function categoryToGroup(category: string): GroupKey {
  for (const g of ["residents", "staff", "memos", "providers"] as GroupKey[]) {
    if (GROUP_CATEGORIES[g].includes(category)) return g;
  }
  return "staff";
}

// ─────────────────────────────────────────────────────────────────────────────
// Top-level component
// ─────────────────────────────────────────────────────────────────────────────

export function NotesContent({
  facilityNumber,
  onBack,
  embedded = false,
}: {
  facilityNumber: string;
  onBack?: () => void;
  /**
   * When true, renders without the gradient page header and back link.
   * Used by OperationsTab to inline the notes feed inside the overview.
   */
  embedded?: boolean;
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
  const { data: residentsEnvelope } = useQuery<ResidentsResponse | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/residents`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber && needsResidents,
    staleTime: 60_000,
  });
  const residents = residentsEnvelope?.data ?? [];

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

      {/* ── Primary group chips ──────────────────────────────────── */}
      <GroupChips value={group} onChange={setGroup} />

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
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Composer — always visible, no modal.
// ─────────────────────────────────────────────────────────────────────────────

function Composer({
  activeGroup,
  residents,
}: {
  activeGroup: GroupKey;
  residents: Resident[];
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  // The composer's own group selector — defaults to whatever filter is active,
  // or "staff" when the user is on the "all" lens (since you can't post to
  // "all"). Re-syncs when the user changes the primary filter.
  const [composerGroup, setComposerGroup] = useState<GroupKey>(
    activeGroup === "all" ? "staff" : activeGroup,
  );
  useEffect(() => {
    setComposerGroup(activeGroup === "all" ? "staff" : activeGroup);
  }, [activeGroup]);

  const [residentId, setResidentId] = useState<number | null>(null);
  const [body, setBody] = useState("");
  const [urgent, setUrgent] = useState(false);

  const requiresResident = GROUP_REQUIRES_RESIDENT[composerGroup];

  // Reset resident when group switches off a resident-required group.
  useEffect(() => {
    if (!requiresResident) setResidentId(null);
  }, [requiresResident]);

  const createMutation = useMutation({
    mutationFn: async () => {
      const category = GROUP_DEFAULT_POST_CATEGORY[composerGroup];
      const visibilityScope = GROUP_VISIBILITY[composerGroup];
      const payload: Record<string, unknown> = {
        category,
        body: body.trim(),
        priority: urgent ? "urgent" : "normal",
        visibilityScope,
        ackRequired: urgent,
      };
      if (requiresResident && residentId) payload.residentId = residentId;
      const res = await apiRequest("POST", "/api/ops/notes", payload);
      return res.json();
    },
    onSuccess: () => {
      setBody("");
      setUrgent(false);
      setResidentId(null);
      queryClient.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return typeof k === "string" && k.startsWith("/api/ops/notes");
        },
      });
    },
    onError: (e: Error) => {
      toast({
        title: "Failed to post note",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const trimmed = body.trim();
  const canSubmit =
    trimmed.length > 0 &&
    !createMutation.isPending &&
    (!requiresResident || residentId !== null);

  const submit = () => {
    if (!canSubmit) return;
    createMutation.mutate();
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm p-3 space-y-3">
      {/* Row 1: group + (optional) resident picker */}
      <div className="flex items-center gap-2 flex-wrap">
        <Select
          value={composerGroup}
          onValueChange={(v) => setComposerGroup(v as GroupKey)}
        >
          <SelectTrigger className="h-8 text-xs w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="staff">Staff</SelectItem>
            <SelectItem value="residents">Residents</SelectItem>
            <SelectItem value="memos">Internal Memo</SelectItem>
            <SelectItem value="providers">Providers</SelectItem>
          </SelectContent>
        </Select>

        {requiresResident && (
          <Select
            value={residentId !== null ? String(residentId) : ""}
            onValueChange={(v) => setResidentId(v ? Number(v) : null)}
          >
            <SelectTrigger className="h-8 text-xs w-[200px]">
              <SelectValue placeholder="Select resident…" />
            </SelectTrigger>
            <SelectContent>
              {residents.length === 0 ? (
                <div className="px-2 py-1.5 text-xs text-muted-foreground">
                  No residents found
                </div>
              ) : (
                residents.map((r) => (
                  <SelectItem key={r.id} value={String(r.id)}>
                    {r.firstName} {r.lastName}
                  </SelectItem>
                ))
              )}
            </SelectContent>
          </Select>
        )}
      </div>

      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder={composerPlaceholder(composerGroup)}
        rows={2}
        className="resize-none border-0 focus-visible:ring-0 p-0 shadow-none text-base"
      />

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setUrgent((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors",
            urgent
              ? "bg-red-100 text-red-700 border-red-200"
              : "bg-muted text-muted-foreground border-border hover:bg-muted/70",
          )}
          aria-pressed={urgent}
        >
          <AlertCircle className="h-3.5 w-3.5" />
          {urgent ? "Urgent" : "Mark urgent"}
        </button>
        <Button
          onClick={submit}
          disabled={!canSubmit}
          size="sm"
          className="gap-1.5"
        >
          <Send className="h-4 w-4" />
          {createMutation.isPending ? "Posting…" : "Post"}
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground -mt-1">
        Tip: ⌘/Ctrl + Enter to post.
        {requiresResident &&
          residentId === null &&
          " Pick a resident before posting."}
      </p>
    </div>
  );
}

function composerPlaceholder(group: GroupKey): string {
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
}: {
  note: NoteListItem;
  showGroupBadge: boolean;
  residents: Resident[];
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
          onClick={() => setExpanded((v) => !v)}
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
// Reply
// ─────────────────────────────────────────────────────────────────────────────

function ReplyItem({ reply }: { reply: NoteListItem }) {
  return (
    <div className="rounded-md bg-card border border-border px-3 py-2">
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-0.5">
        <span className="font-medium text-foreground">
          {reply.authorDisplayName}
        </span>
        <span>·</span>
        <span>
          {formatDistanceToNow(new Date(reply.createdAt), { addSuffix: true })}
        </span>
      </div>
      <p className="text-sm whitespace-pre-wrap break-words">{reply.body}</p>
    </div>
  );
}

function ReplyBox({ parentNoteId }: { parentNoteId: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");

  const replyMutation = useMutation({
    mutationFn: async (text: string) => {
      const res = await apiRequest(
        "POST",
        `/api/ops/notes/${parentNoteId}/replies`,
        { body: text },
      );
      return res.json();
    },
    onSuccess: () => {
      setBody("");
      queryClient.invalidateQueries({
        queryKey: [`/api/ops/notes/${parentNoteId}`],
      });
    },
    onError: (e: Error) =>
      toast({
        title: "Reply failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const trimmed = body.trim();
  const canSubmit = trimmed.length > 0 && !replyMutation.isPending;

  return (
    <div className="flex items-end gap-2">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
            e.preventDefault();
            replyMutation.mutate(trimmed);
          }
        }}
        placeholder="Reply…"
        rows={1}
        className="resize-none text-sm min-h-9"
      />
      <Button
        size="sm"
        className="shrink-0 h-9 gap-1.5"
        disabled={!canSubmit}
        onClick={() => replyMutation.mutate(trimmed)}
      >
        <Send className="h-3.5 w-3.5" />
        Send
      </Button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Skeletons + empty state
// ─────────────────────────────────────────────────────────────────────────────

function NoteCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card shadow-sm p-4 space-y-2">
      <div className="flex items-center gap-2">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}

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

// ─────────────────────────────────────────────────────────────────────────────
// URL helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildListUrl(
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

  // Preserve the canonical "All + open" URL shape (no extra params) so it
  // dedupes with OperationsTab's notes-count query.
  return `/api/ops/notes?${params.toString()}`;
}
