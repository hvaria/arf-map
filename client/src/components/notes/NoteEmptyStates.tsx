/**
 * NoteEmptyStates — empty / loading / error wrappers used by the dedicated
 * Notes page. The original `EmptyState` strings live inline in
 * `operations/NotesContent.tsx` — we mirror that copy here so the embedded
 * feed and the dedicated page tell the user the same story.
 */
import { MessageSquare } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import type { GroupKey } from "./shared";

const GROUP_EMPTY_COPY: Record<GroupKey, string> = {
  all: "No notes yet. Click “New note” to start the conversation.",
  residents:
    "No resident notes yet. Pick a resident in the composer to add the first one.",
  staff: "No staff notes yet. Share a quick update with the team.",
  memos:
    "No internal memos yet. Use the composer to post an announcement or operational note.",
  providers:
    "No provider notes yet. Log a visit, instruction, or follow-up using the composer.",
};

export function ListEmptyState({
  group,
  hasSearch,
  onClearSearch,
}: {
  group: GroupKey;
  hasSearch: boolean;
  onClearSearch?: () => void;
}) {
  if (hasSearch) {
    return (
      <div
        className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground space-y-2"
        data-testid="notes-empty-no-results"
      >
        <p>No notes match your search.</p>
        {onClearSearch && (
          <button
            type="button"
            onClick={onClearSearch}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            Clear search
          </button>
        )}
      </div>
    );
  }
  return (
    <div
      className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground"
      data-testid="notes-empty-list"
    >
      {GROUP_EMPTY_COPY[group]}
    </div>
  );
}

export function ListErrorState() {
  return (
    <div
      className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive"
      data-testid="notes-empty-list-error"
    >
      Failed to load notes. Please refresh.
    </div>
  );
}

export function ListLoadingState({ rows = 8 }: { rows?: number }) {
  return (
    <div className="divide-y divide-border" data-testid="notes-empty-list-loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="px-4 py-3 space-y-2">
          <div className="flex items-center gap-2">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-3 w-12" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-3/4" />
        </div>
      ))}
    </div>
  );
}

export function DetailEmptyState({ message }: { message?: string }) {
  return (
    <div
      className="h-full flex items-center justify-center p-8"
      data-testid="notes-empty-no-selection"
    >
      <div className="text-center space-y-2 max-w-xs">
        <div className="mx-auto h-10 w-10 rounded-full bg-indigo-50 flex items-center justify-center">
          <MessageSquare className="h-5 w-5 text-indigo-500" />
        </div>
        <p className="text-sm font-medium text-foreground">
          {message ?? "Select a note to read"}
        </p>
        <p className="text-xs text-muted-foreground">
          Choose a note from the list.
        </p>
      </div>
    </div>
  );
}

export function DetailLoadingState() {
  return (
    <div className="p-6 space-y-4" data-testid="notes-empty-detail-loading">
      <div className="space-y-2">
        <Skeleton className="h-3 w-32" />
        <Skeleton className="h-5 w-3/4" />
      </div>
      <div className="space-y-2 pt-2">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    </div>
  );
}

export function DetailErrorState({ onBack }: { onBack?: () => void }) {
  return (
    <div
      className="h-full flex items-center justify-center p-8"
      data-testid="notes-empty-detail-error"
    >
      <div className="text-center space-y-2 max-w-xs">
        <p className="text-sm font-medium text-destructive">
          Couldn&rsquo;t load this note
        </p>
        <p className="text-xs text-muted-foreground">
          It may have been deleted, or the link is no longer valid.
        </p>
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
          >
            Back to list
          </button>
        )}
      </div>
    </div>
  );
}
