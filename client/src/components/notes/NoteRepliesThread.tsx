/**
 * NoteRepliesThread — replies section for the dedicated Notes detail pane.
 * Renders existing replies via the moved `ReplyItem` and the inline composer
 * via the moved `ReplyBox`.
 */
import { ReplyItem } from "./composer/ReplyItem";
import { ReplyBox } from "./composer/ReplyBox";
import type { NoteListItem } from "./shared";

export interface NoteRepliesThreadProps {
  parentNoteId: number;
  replies: NoteListItem[];
}

export function NoteRepliesThread({
  parentNoteId,
  replies,
}: NoteRepliesThreadProps) {
  return (
    <div className="border-t border-border bg-muted/20 px-5 py-4 space-y-3">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Replies {replies.length > 0 && `(${replies.length})`}
      </p>
      {replies.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No replies yet.</p>
      ) : (
        <div className="space-y-2">
          {replies.map((r) => (
            <ReplyItem key={r.id} reply={r} />
          ))}
        </div>
      )}
      <ReplyBox parentNoteId={parentNoteId} />
    </div>
  );
}
