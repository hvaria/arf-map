/**
 * NoteCardSkeleton — loading placeholder used by the embedded notes feed.
 *
 * Lifted verbatim from `client/src/components/operations/NotesContent.tsx`
 * during the Slice 1 split-pane redesign. Behavior unchanged.
 */
import { Skeleton } from "@/components/ui/skeleton";

export function NoteCardSkeleton() {
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
