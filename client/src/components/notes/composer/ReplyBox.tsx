/**
 * ReplyBox — inline reply textarea for an expanded note thread.
 *
 * Lifted from `client/src/components/operations/NotesContent.tsx` during the
 * Slice 1 split-pane redesign. Invalidation matches the pre-extraction
 * behavior: only the parent note's detail query is refreshed on success, so
 * we don't refetch list queries for callers that don't need it. If a
 * specific consumer (e.g., the dedicated Notes page) needs broader
 * invalidation, it should run that itself rather than baking it in here.
 */
import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

export function ReplyBox({ parentNoteId }: { parentNoteId: number }) {
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
