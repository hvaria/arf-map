/**
 * NoteDetailBody — body text + tags + read-only attachment list for the
 * dedicated Notes page's detail pane.
 *
 * Per Slice 1, the attachment icon is rendered ONLY here (the list endpoint
 * doesn't return `hasAttachment`, so we don't try to surface it in rows).
 */
import { Paperclip } from "lucide-react";
import type { NoteDetail } from "./shared";

export interface NoteDetailBodyProps {
  detail: NoteDetail;
}

export function NoteDetailBody({ detail }: NoteDetailBodyProps) {
  const { note, attachments, tags } = detail;

  return (
    <div className="px-5 py-4 space-y-4">
      <p className="text-sm whitespace-pre-wrap break-words leading-relaxed">
        {note.body}
      </p>

      {tags.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {tags.map((t) => (
            <span
              key={t}
              className="text-[10px] text-muted-foreground bg-muted rounded px-1.5 py-0.5"
            >
              #{t}
            </span>
          ))}
        </div>
      )}

      {attachments.length > 0 && (
        <div className="border-t border-border pt-3">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1.5">
            Attachments
          </p>
          <ul className="space-y-1">
            {attachments.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 text-xs text-muted-foreground"
              >
                <Paperclip className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span className="truncate">{a.filename}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
