/**
 * Paginated history table for tracker entries.
 *
 * Filters from the bar (date / shift / residentId) feed straight into
 * `useTrackerEntries`. Per-row "View versions" opens a drawer fed by
 * `GET /api/ops/trackers/entries/:id/versions`.
 *
 * Backend already excludes soft-deleted rows from list responses, so we
 * don't need to filter `status === "deleted"` here.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { getQueryFn } from "@/lib/queryClient";
import {
  useTrackerEntries,
  type TrackerEntryRow,
} from "@/lib/tracker/useTrackerEntries";
import {
  useResidents,
  residentLabel,
} from "./selectors/ResidentSelector";
import { TrackerEmpty } from "./TrackerEmpty";
import { TrackerLoading } from "./TrackerLoading";
import { endOfDay, type TrackerFilters } from "./TrackerFilterBar";
import type { SerializedTrackerDefinition } from "@shared/tracker-schemas";

interface VersionRow {
  id: number;
  entryId: number;
  versionNumber: number;
  payloadSnapshot: unknown;
  changedByFacilityAccountId: number;
  changedByStaffId: number | null;
  changedAt: number;
  changeReason: string | null;
}

interface VersionsEnvelope {
  success: boolean;
  data: VersionRow[];
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/**
 * Generic payload summarizer — shows the first 3 key/value pairs.
 *
 * No slug-branching: the config-driven shell rule forbids per-slug
 * `if` ladders here. If a tracker needs a richer summary, add a
 * `historySummary` config to `TrackerDefinition` instead.
 */
function summarizePayload(_slug: string, payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  return Object.entries(p)
    .slice(0, 3)
    .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : String(v)}`)
    .join(", ");
}

export function HistoryTab({
  definition,
  filters,
}: {
  definition: SerializedTrackerDefinition;
  filters: TrackerFilters;
}) {
  const dayFrom = filters.date;
  const dayTo = endOfDay(filters.date);
  const {
    data,
    isLoading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useTrackerEntries({
    slug: definition.slug,
    from: dayFrom,
    to: dayTo,
    shift: filters.shift,
    residentId: filters.residentId,
  });

  const { data: residentsEnv } = useResidents();
  const residentMap = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of residentsEnv?.data ?? []) {
      map.set(r.id, residentLabel(r));
    }
    return map;
  }, [residentsEnv]);

  const [selectedEntry, setSelectedEntry] = useState<TrackerEntryRow | null>(
    null,
  );

  if (isLoading) return <TrackerLoading rows={4} />;
  if (isError)
    return (
      <TrackerEmpty
        title="Couldn't load history"
        hint="Try refreshing or adjusting your filters."
      />
    );

  const items = data?.pages.flatMap((p) => p.data.items) ?? [];

  if (items.length === 0) {
    return (
      <TrackerEmpty
        title="No entries on this date"
        hint="Try a different date or shift, or use Quick / Detailed mode to add one."
      />
    );
  }

  return (
    <div>
      <div className="rounded-md border bg-white overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs text-muted-foreground uppercase tracking-wide">
            <tr>
              <th className="px-3 py-2 text-left">When</th>
              <th className="px-3 py-2 text-left">Resident</th>
              <th className="px-3 py-2 text-left">Shift</th>
              <th className="px-3 py-2 text-left">Detail</th>
              <th className="px-3 py-2 text-left">Reported by</th>
              <th className="px-3 py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.map((e) => (
              <tr key={e.id} className="border-t hover:bg-indigo-50/40">
                <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                  {formatTime(e.occurredAt)}
                </td>
                <td className="px-3 py-2">
                  {e.residentId
                    ? residentMap.get(e.residentId) ?? `#${e.residentId}`
                    : "—"}
                </td>
                <td className="px-3 py-2">
                  {e.shift ? (
                    <Badge variant="outline" className="text-[10px]">
                      {e.shift}
                    </Badge>
                  ) : (
                    "—"
                  )}
                </td>
                <td className="px-3 py-2">
                  {summarizePayload(definition.slug, e.payload)}
                  {e.status === "edited" && (
                    <Badge
                      variant="outline"
                      className="ml-2 text-[10px] bg-amber-50 text-amber-800 border-amber-200"
                    >
                      edited
                    </Badge>
                  )}
                </td>
                <td className="px-3 py-2 text-muted-foreground">
                  <span className="truncate inline-block max-w-[140px] align-bottom">
                    {e.reportedByDisplayName}
                  </span>
                  <span className="text-[10px] text-muted-foreground/80 block">
                    {e.reportedByRole}
                  </span>
                </td>
                <td className="px-3 py-2 text-right">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedEntry(e)}
                    aria-label={`View versions for entry ${e.id}`}
                  >
                    Versions
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {hasNextPage && (
        <div className="mt-3 text-center">
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchNextPage()}
            disabled={isFetchingNextPage}
          >
            {isFetchingNextPage ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}

      <VersionsDrawer
        entry={selectedEntry}
        slug={definition.slug}
        onOpenChange={(open) => {
          if (!open) setSelectedEntry(null);
        }}
      />
    </div>
  );
}

function VersionsDrawer({
  entry,
  slug,
  onOpenChange,
}: {
  entry: TrackerEntryRow | null;
  slug: string;
  onOpenChange: (open: boolean) => void;
}) {
  const open = entry !== null;
  const { data, isLoading } = useQuery<VersionsEnvelope | null>({
    queryKey: [`/api/ops/trackers/entries/${entry?.id ?? 0}/versions`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: open,
    staleTime: 30_000,
  });

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            Versions {entry ? `· entry #${entry.id}` : ""}
          </DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-6 max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <TrackerLoading rows={3} />
          ) : !data?.data || data.data.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No prior versions — this entry hasn't been edited.
            </p>
          ) : (
            <ol className="space-y-3" aria-label="Version history">
              {data.data.map((v) => (
                <li
                  key={v.id}
                  className="rounded-md border p-3 bg-white text-sm"
                >
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-semibold">v{v.versionNumber}</span>
                    <span className="text-xs text-muted-foreground tabular-nums">
                      {formatTime(v.changedAt)}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {summarizePayload(slug, v.payloadSnapshot)}
                  </p>
                  {v.changeReason && (
                    <p className="text-xs italic text-muted-foreground mt-1">
                      “{v.changeReason}”
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
