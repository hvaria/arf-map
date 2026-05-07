/**
 * Composer — always-visible note composer for the Notes feed.
 *
 * Lifted verbatim from `client/src/components/operations/NotesContent.tsx`
 * during the Slice 1 split-pane redesign. Behavior unchanged.
 */
import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

import {
  GROUP_DEFAULT_POST_CATEGORY,
  GROUP_REQUIRES_RESIDENT,
  GROUP_VISIBILITY,
  composerPlaceholder,
  type GroupKey,
  type Resident,
} from "../shared";

export function Composer({
  activeGroup,
  residents,
  onPosted,
}: {
  activeGroup: GroupKey;
  residents: Resident[];
  /** Optional callback fired after a successful post (for closing modals etc). */
  onPosted?: () => void;
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
      onPosted?.();
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
