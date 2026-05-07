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
import {
  classifyVitalRange,
  RANGE_CLASSES,
  RANGE_LABEL,
  type VitalRange,
} from "@/lib/tracker/useVitalRange";
import { cn } from "@/lib/utils";
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
  /** Backend slice — denormalized actor name for display. */
  changedByDisplayName: string;
  /** Backend slice — denormalized role label, e.g. "Caregiver". */
  changedByRole: string;
}

interface VersionsEnvelope {
  success: boolean;
  data: VersionRow[];
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const seconds = Math.round(diff / 1000);
  if (seconds < 60) return `${Math.max(seconds, 1)}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatTime(ms);
}

/**
 * Compute a shallow key-level diff between two payload snapshots. Returns
 * an array of `{ key, prev, next, kind }` entries — used by the Versions
 * drawer to render a tiny "what changed" summary. Only top-level keys are
 * compared; nested object diffs are deferred (Phase 2).
 */
function diffSnapshots(
  prev: unknown,
  next: unknown,
): Array<{ key: string; prev: unknown; next: unknown; kind: "added" | "removed" | "changed" }> {
  if (
    !next ||
    typeof next !== "object" ||
    Array.isArray(next)
  ) {
    return [];
  }
  const a = (prev && typeof prev === "object" && !Array.isArray(prev)
    ? (prev as Record<string, unknown>)
    : {}) as Record<string, unknown>;
  const b = next as Record<string, unknown>;
  const keys: string[] = [];
  const seen: Record<string, true> = {};
  for (const k of Object.keys(a)) {
    if (!seen[k]) {
      seen[k] = true;
      keys.push(k);
    }
  }
  for (const k of Object.keys(b)) {
    if (!seen[k]) {
      seen[k] = true;
      keys.push(k);
    }
  }
  const out: Array<{ key: string; prev: unknown; next: unknown; kind: "added" | "removed" | "changed" }> = [];
  for (const k of keys) {
    const av = a[k];
    const bv = b[k];
    if (av === undefined && bv !== undefined) {
      out.push({ key: k, prev: av, next: bv, kind: "added" });
    } else if (bv === undefined && av !== undefined) {
      out.push({ key: k, prev: av, next: bv, kind: "removed" });
    } else if (JSON.stringify(av) !== JSON.stringify(bv)) {
      out.push({ key: k, prev: av, next: bv, kind: "changed" });
    }
  }
  return out;
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

/**
 * For the Vitals tracker, classify the row's payload to colorize the detail
 * cell. Returns `undefined` for any other tracker — the caller falls back to
 * the plain summary.
 */
function vitalsRangeFromPayload(payload: unknown): VitalRange | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const p = payload as Record<string, unknown>;
  const t = p.vital_type;
  if (typeof t !== "string") return undefined;
  if (t === "bp") {
    return classifyVitalRange("bp", p.systolic as number | undefined, {
      secondary: p.diastolic as number | undefined,
    });
  }
  if (
    t === "pulse" ||
    t === "weight" ||
    t === "oxygen" ||
    t === "glucose" ||
    t === "respiratory" ||
    t === "pain"
  ) {
    return classifyVitalRange(t, p.value as number | undefined);
  }
  if (t === "temperature") {
    return classifyVitalRange("temperature", p.value as number | undefined, {
      unit: p.unit === "C" ? "C" : "F",
    });
  }
  return undefined;
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
                  <span className="inline-flex items-center gap-1.5 flex-wrap">
                    {(() => {
                      const range =
                        definition.slug === "vitals"
                          ? vitalsRangeFromPayload(e.payload)
                          : undefined;
                      if (range && range !== "unknown") {
                        return (
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[10px]",
                              RANGE_CLASSES[range].badge,
                            )}
                          >
                            {RANGE_LABEL[range]}
                          </Badge>
                        );
                      }
                      return null;
                    })()}
                    <span>
                      {summarizePayload(definition.slug, e.payload)}
                    </span>
                    {e.status === "edited" && (
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-amber-50 text-amber-800 border-amber-200"
                      >
                        edited
                      </Badge>
                    )}
                  </span>
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

  // Sort by versionNumber DESC so the newest sits at the top.
  const versions = useMemo(() => {
    const list = [...(data?.data ?? [])];
    list.sort((a, b) => b.versionNumber - a.versionNumber);
    return list;
  }, [data]);

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>
            Version history {entry ? `· entry #${entry.id}` : ""}
          </DrawerTitle>
        </DrawerHeader>
        <div className="px-4 pb-6 max-h-[60vh] overflow-y-auto">
          {isLoading ? (
            <TrackerLoading rows={3} />
          ) : versions.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No prior versions — this entry hasn't been edited.
            </p>
          ) : (
            <ol className="space-y-3" aria-label="Version history">
              {versions.map((v, idx) => {
                // The next-older version (idx + 1 because we're sorted DESC)
                // is the diff baseline. The very last item has no baseline.
                const baseline =
                  idx + 1 < versions.length ? versions[idx + 1] : undefined;
                const diff = baseline
                  ? diffSnapshots(baseline.payloadSnapshot, v.payloadSnapshot)
                  : [];
                return (
                  <li
                    key={v.id}
                    className="rounded-md border p-3 bg-white text-sm"
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold">
                        v{v.versionNumber}
                        <span className="ml-2 text-xs font-normal text-muted-foreground tabular-nums">
                          · {relativeTime(v.changedAt)}
                        </span>
                      </span>
                      <span className="text-[11px] text-muted-foreground tabular-nums">
                        {formatTime(v.changedAt)}
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground">Edited by</span>
                      <span className="font-medium">
                        {v.changedByDisplayName}
                      </span>
                      <Badge
                        variant="outline"
                        className="text-[10px] bg-indigo-50 text-indigo-700 border-indigo-200"
                      >
                        {v.changedByRole}
                      </Badge>
                    </div>
                    {v.changeReason && (
                      <p className="text-xs italic text-muted-foreground mt-1.5">
                        “{v.changeReason}”
                      </p>
                    )}
                    {diff.length > 0 ? (
                      <ul className="mt-2 space-y-0.5 text-xs font-mono">
                        {diff.map((d) => (
                          <li
                            key={d.key}
                            className="rounded bg-slate-50 px-2 py-0.5"
                          >
                            <span className="text-muted-foreground">
                              {d.key}:{" "}
                            </span>
                            {d.kind !== "added" && (
                              <span className="text-red-700 line-through">
                                {JSON.stringify(d.prev)}
                              </span>
                            )}
                            {d.kind === "changed" && (
                              <span className="text-muted-foreground"> → </span>
                            )}
                            {d.kind !== "removed" && (
                              <span className="text-emerald-700">
                                {JSON.stringify(d.next)}
                              </span>
                            )}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-xs text-muted-foreground mt-1.5">
                        {summarizePayload(slug, v.payloadSnapshot)}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
