/**
 * NotesListItem — single row in the dedicated Notes list pane.
 *
 * Per the Slice 1 product decision, the attachment icon is intentionally NOT
 * shown here — the list endpoint doesn't return `hasAttachment`. We surface
 * attachments in the detail pane only.
 */
import { formatDistanceToNow } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import {
  GROUP_LABEL,
  categoryToGroup,
  type NoteListItem as NoteListItemT,
  type Resident,
} from "./shared";

export interface NotesListItemProps {
  note: NoteListItemT;
  residents: Resident[];
  selected: boolean;
  showGroupBadge: boolean;
  onClick: () => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export function NotesListItem({
  note,
  residents,
  selected,
  showGroupBadge,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: NotesListItemProps) {
  const isUrgent = note.priority === "urgent";
  const isArchived = !!note.archivedAt;
  const noteGroup = categoryToGroup(note.category);
  const resident =
    note.residentId !== null
      ? residents.find((r) => r.id === note.residentId)
      : null;

  // Title for the row: backend `title` if present, otherwise the first ~80
  // chars of body (single-line) so the user always has a scannable headline.
  const headline =
    note.title?.trim() ||
    note.body.replace(/\s+/g, " ").slice(0, 90).trim() ||
    "(no content)";

  // Excerpt: only if we used the body for the headline AND there's more
  // content; otherwise show body directly.
  const excerptSource = note.title?.trim() ? note.body : "";
  const excerpt = excerptSource.replace(/\s+/g, " ").slice(0, 140).trim();

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onFocus={onMouseEnter}
      onBlur={onMouseLeave}
      aria-current={selected ? "true" : undefined}
      aria-label={`Note by ${note.authorDisplayName}: ${headline}`}
      data-testid={`notes-row-${note.id}`}
      className={cn(
        "relative w-full text-left px-4 py-3 border-l-2 transition-colors focus:outline-none focus-visible:bg-muted/40",
        selected
          ? "bg-indigo-50/60 border-l-indigo-500"
          : "bg-card border-l-transparent hover:bg-muted/40",
        isArchived && "opacity-70",
      )}
    >
      {/* Header row: author · time · markers */}
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground flex-wrap">
        {isUrgent && (
          <span
            aria-label="Urgent"
            className="h-1.5 w-1.5 rounded-full bg-red-500 shrink-0"
          />
        )}
        <span className="font-medium text-foreground truncate">
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
        {isArchived && (
          <Badge variant="outline" className="ml-1 h-4 text-[10px] px-1">
            Archived
          </Badge>
        )}
      </div>

      {/* Headline */}
      <p
        className={cn(
          "mt-1 text-sm leading-snug line-clamp-2 break-words",
          selected ? "font-semibold text-foreground" : "font-medium text-foreground",
        )}
      >
        {headline}
      </p>

      {/* Optional body excerpt under the headline */}
      {excerpt && (
        <p className="mt-0.5 text-xs text-muted-foreground line-clamp-1 break-words">
          {excerpt}
        </p>
      )}

      {/* Footer: badges */}
      {(showGroupBadge || resident) && (
        <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
          {showGroupBadge && (
            <Badge variant="outline" className="h-4 text-[10px] px-1.5">
              {GROUP_LABEL[noteGroup]}
            </Badge>
          )}
          {resident && (
            <Badge
              variant="outline"
              className="h-4 text-[10px] px-1.5 bg-indigo-50 text-indigo-700 border-indigo-200"
            >
              {resident.firstName} {resident.lastName}
            </Badge>
          )}
        </div>
      )}
    </button>
  );
}
