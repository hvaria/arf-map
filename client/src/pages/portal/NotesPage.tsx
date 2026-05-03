/**
 * NotesContent — Operations > Notes view.
 *
 * Single-feed timeline with always-visible inline composer at the top.
 * Designed for the lowest possible click count on the most common
 * actions: posting a note (2 taps), acking (1 tap), filtering (1 tap).
 *
 * No sub-tabs, no modals, no detail page — replies expand inline.
 *
 * Rendered as a sub-view of OperationsTab. Auth + facilityNumber are
 * already guaranteed by the parent.
 */

import { useState, useMemo } from "react";
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
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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

type FilterKey = "all" | "urgent" | "archived";

// ─────────────────────────────────────────────────────────────────────────────
// Top-level component
// ─────────────────────────────────────────────────────────────────────────────

export function NotesContent({
  facilityNumber,
  onBack,
}: {
  facilityNumber: string;
  onBack?: () => void;
}) {
  const [filter, setFilter] = useState<FilterKey>("all");

  const queryUrl = useMemo(() => buildListUrl(filter), [filter]);

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

  const items = envelope?.data?.items ?? [];

  return (
    <div className="space-y-4 max-w-3xl mx-auto pb-12">
      {/* ── Header ───────────────────────────────────────────────── */}
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Overview
        </button>
      )}

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

      {/* ── Composer (always visible) ────────────────────────────── */}
      <Composer />

      {/* ── Filter chips ─────────────────────────────────────────── */}
      <FilterChips value={filter} onChange={setFilter} />

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
        <EmptyState filter={filter} />
      ) : (
        <div className="space-y-3">
          {items.map((note) => (
            <NoteCard key={note.id} note={note} />
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Composer — always visible, no modal.
// ─────────────────────────────────────────────────────────────────────────────

function Composer() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [urgent, setUrgent] = useState(false);

  const createMutation = useMutation({
    mutationFn: async (vars: { body: string; urgent: boolean }) => {
      const res = await apiRequest("POST", "/api/ops/notes", {
        category: "general",
        body: vars.body,
        priority: vars.urgent ? "urgent" : "normal",
        visibilityScope: "facility_wide",
        ackRequired: vars.urgent,
      });
      return res.json();
    },
    onSuccess: () => {
      setBody("");
      setUrgent(false);
      // Invalidate every list query (catches all filter variants).
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
  const canSubmit = trimmed.length > 0 && !createMutation.isPending;

  const submit = () => {
    if (!canSubmit) return;
    createMutation.mutate({ body: trimmed, urgent });
  };

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm p-3 space-y-3">
      <Textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            submit();
          }
        }}
        placeholder="Quick note for the team…"
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
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Filter chips
// ─────────────────────────────────────────────────────────────────────────────

function FilterChips({
  value,
  onChange,
}: {
  value: FilterKey;
  onChange: (v: FilterKey) => void;
}) {
  const chips: Array<{ key: FilterKey; label: string }> = [
    { key: "all", label: "All" },
    { key: "urgent", label: "Urgent" },
    { key: "archived", label: "Archived" },
  ];
  return (
    <div className="flex items-center gap-2 flex-wrap">
      {chips.map((c) => (
        <button
          key={c.key}
          onClick={() => onChange(c.key)}
          className={cn(
            "text-xs font-medium px-3 py-1 rounded-full border transition-colors",
            value === c.key
              ? "bg-foreground text-background border-foreground"
              : "bg-card text-muted-foreground border-border hover:text-foreground",
          )}
        >
          {c.label}
        </button>
      ))}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Note card — collapsed by default; click to expand thread + reply box.
// ─────────────────────────────────────────────────────────────────────────────

function NoteCard({ note }: { note: NoteListItem }) {
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

  return (
    <div
      className={cn(
        "rounded-xl border bg-card shadow-sm transition-shadow",
        isUrgent && "border-l-4 border-l-red-500",
        isArchived && "opacity-70",
      )}
    >
      {/* Header */}
      <div className="px-4 pt-3 pb-1 flex items-center gap-2 text-xs text-muted-foreground">
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

function EmptyState({ filter }: { filter: FilterKey }) {
  const message =
    filter === "archived"
      ? "No archived notes."
      : filter === "urgent"
        ? "No urgent notes — nice."
        : "No notes yet. Use the composer above to start.";
  return (
    <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
      {message}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// URL helpers
// ─────────────────────────────────────────────────────────────────────────────

function buildListUrl(filter: FilterKey): string {
  const params = new URLSearchParams();
  if (filter === "urgent") {
    params.set("priority", "urgent");
    params.set("status", "open");
  } else if (filter === "archived") {
    params.set("status", "archived");
  } else {
    params.set("status", "open");
  }
  params.set("limit", "50");
  return `/api/ops/notes?${params.toString()}`;
}
