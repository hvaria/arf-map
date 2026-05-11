/**
 * NoteDetailPane — right column on the dedicated Notes page.
 *
 * Owns:
 *  - The per-note detail query (lazy on `noteId`).
 *  - Ack, archive/unarchive, and soft-delete mutations.
 *  - The "Select a note" empty state when no note is selected.
 *  - Header + body + replies thread layout.
 *
 * Mutation invalidation matches the existing pattern in NotesContent.tsx:
 * `predicate: (q) => typeof q.queryKey[0] === "string" && q.queryKey[0].startsWith("/api/ops/notes")`
 * so the embedded feed and the dedicated page stay in sync.
 */
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { track } from "@/lib/telemetry";
import {
  DetailEmptyState,
  DetailErrorState,
  DetailLoadingState,
} from "./NoteEmptyStates";
import { NoteDetailBody } from "./NoteDetailBody";
import { NoteDetailHeader } from "./NoteDetailHeader";
import { NoteRepliesThread } from "./NoteRepliesThread";
import { categoryToGroup, type DetailResponse } from "./shared";

const NOTES_INVALIDATE_PREDICATE = (q: { queryKey: readonly unknown[] }) => {
  const k = q.queryKey[0];
  return typeof k === "string" && k.startsWith("/api/ops/notes");
};

export interface NoteDetailPaneProps {
  noteId: number | null;
  /** Render with a back chevron (mobile push-to-detail layout). */
  showBack?: boolean;
  onBack?: () => void;
  /** Called after a successful soft-delete so the parent can clear noteId. */
  onDeleted?: () => void;
}

export function NoteDetailPane({
  noteId,
  showBack,
  onBack,
  onDeleted,
}: NoteDetailPaneProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [optimisticAcked, setOptimisticAcked] = useState(false);

  const detailQuery = useQuery<DetailResponse | null>({
    queryKey: [`/api/ops/notes/${noteId}`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: noteId !== null,
    staleTime: 5_000,
  });

  // Reset optimistic ack when the selected note changes so prior optimism
  // doesn't leak into a different note's "Acked" state.
  useEffect(() => {
    setOptimisticAcked(false);
  }, [noteId]);

  // Fire `notes.note.viewed` once per note selection, AFTER detail resolves so
  // the payload includes group + facilityNumber (matching the drawer surface
  // shape). The ref dedups: we re-run when detail data refreshes for the same
  // noteId, but we only fire the event on the first resolution per noteId.
  const lastTrackedNoteId = useRef<number | null>(null);
  useEffect(() => {
    if (noteId === null) {
      lastTrackedNoteId.current = null;
      return;
    }
    if (lastTrackedNoteId.current === noteId) return;
    const note = detailQuery.data?.data?.note;
    if (!note) return; // wait for detail to resolve before tracking
    lastTrackedNoteId.current = noteId;
    track("notes.note.viewed", {
      surface: "page",
      noteId,
      group: categoryToGroup(note.category),
      facilityNumber: note.facilityNumber,
    });
  }, [noteId, detailQuery.data]);

  const ackMutation = useMutation({
    mutationFn: async () => {
      if (noteId === null) return;
      const res = await apiRequest("POST", `/api/ops/notes/${noteId}/ack`, {});
      return res.json();
    },
    onSuccess: () => {
      setOptimisticAcked(true);
      if (noteId !== null) {
        // Server auto-archives on a fresh ack — invalidate the list queries
        // (bell urgent count, modal list, embedded feed) so the acked note
        // drops out, alongside the per-note detail.
        queryClient.invalidateQueries({
          predicate: NOTES_INVALIDATE_PREDICATE,
        });
        // The Ack button only renders after detail loads, so `note` is
        // expected to be truthy here. Skip telemetry entirely if it isn't —
        // we'd rather drop an event than emit a degraded payload.
        const note = detailQuery.data?.data?.note;
        if (note) {
          track("notes.note.acked", {
            surface: "page",
            noteId,
            group: categoryToGroup(note.category),
            facilityNumber: note.facilityNumber,
          });
        }
      }
    },
    onError: (e: Error) =>
      toast({
        title: "Ack failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      if (noteId === null) return;
      const note = detailQuery.data?.data?.note;
      const path = note?.archivedAt
        ? `/api/ops/notes/${noteId}/unarchive`
        : `/api/ops/notes/${noteId}/archive`;
      const res = await apiRequest("POST", path, {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: NOTES_INVALIDATE_PREDICATE,
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
      if (noteId === null) return;
      const res = await apiRequest("DELETE", `/api/ops/notes/${noteId}`);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        predicate: NOTES_INVALIDATE_PREDICATE,
      });
      onDeleted?.();
    },
    onError: (e: Error) =>
      toast({
        title: "Delete failed",
        description: e.message,
        variant: "destructive",
      }),
  });

  // ── Render ────────────────────────────────────────────────────────────
  if (noteId === null) {
    return (
      <div className="h-full bg-card">
        <DetailEmptyState />
      </div>
    );
  }

  if (detailQuery.isLoading) {
    return (
      <div className="h-full bg-card">
        <DetailLoadingState />
      </div>
    );
  }

  if (detailQuery.error || !detailQuery.data?.data) {
    return (
      <div className="h-full bg-card">
        <DetailErrorState onBack={onBack} />
      </div>
    );
  }

  const detail = detailQuery.data.data;
  const note = detail.note;
  const isArchived = !!note.archivedAt;
  const ackCount = detail.acknowledgments.length;
  const showAcked = optimisticAcked || ackCount > 0;

  return (
    <div
      className={cn(
        "h-full bg-card overflow-y-auto",
        isArchived && "opacity-95",
      )}
      role="region"
      aria-label="Note detail"
    >
      <NoteDetailHeader
        note={note}
        isArchived={isArchived}
        archiveBusy={archiveMutation.isPending}
        deleteBusy={deleteMutation.isPending}
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
        onBack={showBack ? onBack : undefined}
      />

      <NoteDetailBody detail={detail} />

      {/* Action row */}
      <div className="px-5 pb-3 flex items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className={cn("h-8 text-xs gap-1.5", showAcked && "text-green-600")}
          onClick={() => {
            if (!optimisticAcked) ackMutation.mutate();
          }}
          disabled={ackMutation.isPending || optimisticAcked}
        >
          <CheckCheck className="h-3.5 w-3.5" />
          {showAcked ? `Acked${ackCount > 0 ? ` · ${ackCount}` : ""}` : "Ack"}
        </Button>
      </div>

      <NoteRepliesThread parentNoteId={note.id} replies={detail.replies} />
    </div>
  );
}
