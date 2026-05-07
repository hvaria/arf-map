/**
 * NoteDetailHeader — title + author/role + timestamp + urgent/archived
 * markers + kebab menu (Archive/Unarchive · Delete) for the dedicated
 * Notes page's detail pane.
 */
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  Archive,
  ArrowLeft,
  MoreHorizontal,
  RotateCcw,
  Trash2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { NoteListItem } from "./shared";

export interface NoteDetailHeaderProps {
  note: NoteListItem;
  isArchived: boolean;
  archiveBusy: boolean;
  deleteBusy: boolean;
  onArchive: () => void;
  onDelete: () => void;
  /** When set, renders a back chevron — used in the mobile push-to-detail layout. */
  onBack?: () => void;
}

export function NoteDetailHeader({
  note,
  isArchived,
  archiveBusy,
  deleteBusy,
  onArchive,
  onDelete,
  onBack,
}: NoteDetailHeaderProps) {
  const isUrgent = note.priority === "urgent";

  return (
    <div className="border-b border-border bg-card px-5 py-4">
      <div className="flex items-start gap-2">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            aria-label="Back to list"
            className="-ml-1 mr-1 mt-0.5 p-1 rounded hover:bg-muted text-muted-foreground"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 text-xs text-muted-foreground flex-wrap">
            <span className="font-semibold text-foreground">
              {note.authorDisplayName}
            </span>
            {note.authorRole && (
              <span className="capitalize">{note.authorRole.replace(/_/g, " ")}</span>
            )}
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
          </div>
          <h2
            className={cn(
              "mt-1 text-lg font-semibold leading-tight break-words",
              isArchived && "text-muted-foreground",
            )}
          >
            {note.title?.trim() || firstLine(note.body) || "(no title)"}
          </h2>
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            {isUrgent && (
              <Badge
                variant="outline"
                className="bg-red-50 text-red-700 border-red-200 h-5 text-[10px] gap-1"
              >
                <AlertCircle className="h-3 w-3" />
                Urgent
              </Badge>
            )}
            {isArchived && (
              <Badge variant="outline" className="h-5 text-[10px]">
                Archived
              </Badge>
            )}
          </div>
        </div>
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
            <DropdownMenuItem
              onClick={onArchive}
              disabled={archiveBusy}
              data-testid="notes-detail-archive"
            >
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
              data-testid="notes-detail-delete"
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

function firstLine(body: string): string {
  const trimmed = body.split("\n")[0]?.trim() ?? "";
  return trimmed.length > 100 ? `${trimmed.slice(0, 97)}…` : trimmed;
}
