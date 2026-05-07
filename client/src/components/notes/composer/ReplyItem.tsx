/**
 * ReplyItem — single reply bubble inside an expanded note thread.
 *
 * Lifted verbatim from `client/src/components/operations/NotesContent.tsx`
 * during the Slice 1 split-pane redesign. Behavior unchanged.
 */
import { formatDistanceToNow } from "date-fns";
import type { NoteListItem } from "../shared";

export function ReplyItem({ reply }: { reply: NoteListItem }) {
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
