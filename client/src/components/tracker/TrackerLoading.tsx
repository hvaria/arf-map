/** Skeleton placeholder for tracker async surfaces. */
import { Skeleton } from "@/components/ui/skeleton";

export function TrackerLoading({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function TrackerCardSkeleton() {
  return <Skeleton className="h-32 w-full rounded-lg" />;
}
