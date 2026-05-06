/**
 * Generic Quick-Mode grid for any tracker whose definition declares a
 * `quickGrid` config. Rows = goals (from `quickGrid.rows`); columns =
 * residents (`/api/ops/residents`).
 *
 * Cells cycle through `quickGrid.cellCycle` on tap. Each tap optimistically
 * updates the local "displayed value" map and POSTs a single entry. The
 * `clientId` is generated once per cell and reused across retries — that's
 * how the backend dedupes. On error we roll back the displayed value to its
 * pre-tap state, surface a toast, and leave the user on the same screen so
 * they can retry.
 *
 * The grid layout switches to a per-resident card stack on phones (<768 px).
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useResidents } from "./selectors/ResidentSelector";
import {
  useCreateTrackerEntry,
  makeClientId,
} from "@/lib/tracker/useTrackerMutation";
import {
  useTrackerEntries,
  type TrackerEntryRow,
} from "@/lib/tracker/useTrackerEntries";
import { TrackerLoading } from "./TrackerLoading";
import { TrackerEmpty } from "./TrackerEmpty";
import type {
  QuickGridCellColor,
  Shift,
  SerializedTrackerDefinition,
} from "@shared/tracker-schemas";

const COLOR_STYLES: Record<QuickGridCellColor, string> = {
  success: "bg-emerald-100 text-emerald-800 hover:bg-emerald-200",
  warn: "bg-amber-100 text-amber-800 hover:bg-amber-200",
  muted: "bg-slate-100 text-slate-700 hover:bg-slate-200",
  danger: "bg-red-100 text-red-800 hover:bg-red-200",
};

const EMPTY_CELL =
  "bg-white text-muted-foreground border-dashed hover:bg-indigo-50";

/** Compose a cell-key from goal + resident — used in the cellId-tracking maps. */
function key(goalId: string, residentId: number): string {
  return `${goalId}|${residentId}`;
}

interface CellState {
  /** What we currently display in the grid (may be optimistic). */
  value: string | null;
  /** Persisted clientId for retry-stable idempotency (same UUID per cell). */
  clientId: string;
  /** "Save in flight" → disable extra clicks. */
  pending: boolean;
}

export function QuickEntryGrid({
  definition,
  date,
  shift,
}: {
  definition: SerializedTrackerDefinition;
  /** Local-day epoch ms (midnight). Used as `from` filter for the entries query. */
  date: number;
  shift: Shift;
}) {
  const grid = definition.quickGrid;
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: residentsEnv, isLoading: residentsLoading } = useResidents();
  const dayFrom = date;
  const dayTo = date + 86_400_000 - 1;

  const {
    data: entriesData,
    isLoading: entriesLoading,
    isError: entriesError,
  } = useTrackerEntries({
    slug: definition.slug,
    from: dayFrom,
    to: dayTo,
    shift,
    limit: 200,
  });

  const createMutation = useCreateTrackerEntry(definition.slug);
  const [cellMap, setCellMap] = useState<Record<string, CellState>>({});
  // Track which cells we've initialized from server data so successive
  // re-renders don't clobber an optimistic update mid-flight.
  const seedSignatureRef = useRef<string | null>(null);

  const residents = useMemo(
    () =>
      (residentsEnv?.data ?? []).filter((r) => r.status !== "discharged"),
    [residentsEnv],
  );

  const allEntries: TrackerEntryRow[] = useMemo(() => {
    if (!entriesData) return [];
    return entriesData.pages.flatMap((p) => p.data.items);
  }, [entriesData]);

  // Seed the displayed-value map from the latest persisted entry per
  // (goal, resident). When the filter changes (date/shift), the entries
  // query refetches and we reseed; we keep cells with `pending=true` so
  // an in-flight save doesn't get clobbered.
  useEffect(() => {
    if (!grid) return;
    const sig = `${dayFrom}|${shift}|${allEntries.length}`;
    if (sig === seedSignatureRef.current) return;
    seedSignatureRef.current = sig;

    // Latest entry per (goal_id, resident_id) wins.
    const latest = new Map<string, TrackerEntryRow>();
    for (const e of allEntries) {
      if (e.residentId == null) continue;
      const payload = e.payload as { goal_id?: string; status?: string };
      if (!payload || typeof payload.goal_id !== "string") continue;
      const k = key(payload.goal_id, e.residentId);
      const prev = latest.get(k);
      if (!prev || prev.occurredAt < e.occurredAt) latest.set(k, e);
    }

    setCellMap((existing) => {
      const next: Record<string, CellState> = {};
      for (const goal of grid.rows ?? []) {
        for (const r of residents) {
          const k = key(goal.id, r.id);
          const persistedEntry = latest.get(k);
          const persisted =
            (persistedEntry?.payload as { status?: string } | undefined)
              ?.status ?? null;
          const prev = existing[k];
          if (prev?.pending) {
            // Keep optimistic state; reuse the same clientId.
            next[k] = prev;
          } else {
            next[k] = {
              value: persisted,
              clientId: prev?.clientId ?? makeClientId(),
              pending: false,
            };
          }
        }
      }
      return next;
    });
  }, [grid, residents, allEntries, dayFrom, shift]);

  if (!grid) {
    return (
      <TrackerEmpty
        title="No quick grid configured"
        hint="This tracker doesn't expose a quick-entry grid."
      />
    );
  }

  if (residentsLoading || entriesLoading) {
    return <TrackerLoading rows={5} />;
  }
  if (entriesError) {
    return (
      <TrackerEmpty
        title="Couldn't load entries"
        hint="Try refreshing — your filters are still in place."
      />
    );
  }
  if (residents.length === 0) {
    return (
      <TrackerEmpty
        title="No active residents"
        hint="Add residents from the Residents page to start charting."
      />
    );
  }

  const cycle = grid.cellCycle;
  const labels = grid.cellLabels ?? {};
  const colors = grid.cellColors ?? {};

  function nextValue(current: string | null): string {
    if (current == null) return cycle[0];
    const idx = cycle.indexOf(current);
    if (idx === -1) return cycle[0];
    return cycle[(idx + 1) % cycle.length];
  }

  function onCellTap(goalId: string, residentId: number) {
    const k = key(goalId, residentId);
    const state = cellMap[k];
    if (!state || state.pending) return;
    const nv = nextValue(state.value);
    const previous = state.value;

    setCellMap((m) => ({
      ...m,
      [k]: { ...state, value: nv, pending: true },
    }));

    createMutation.mutate(
      {
        clientId: state.clientId,
        residentId,
        shift,
        occurredAt: Date.now(),
        payload: { goal_id: goalId, shift, status: nv },
      },
      {
        onSuccess: (resp) => {
          if (resp.duplicate) {
            // Server already had a row for this clientId and short-circuited
            // — our optimistic `nv` never landed. Reconcile the cell to the
            // server's authoritative status and rotate the clientId so the
            // next tap is treated as a brand-new write.
            const serverPayload = resp.data.payload as
              | { status?: string }
              | null
              | undefined;
            const serverStatus =
              typeof serverPayload?.status === "string"
                ? serverPayload.status
                : previous;
            setCellMap((m) => ({
              ...m,
              [k]: {
                ...m[k],
                value: serverStatus,
                pending: false,
                clientId: makeClientId(),
              },
            }));
            toast({
              title: "Already recorded",
              description: "This entry was already saved — value unchanged.",
            });
          } else {
            // Fresh write succeeded — rotate the clientId so the NEXT tap
            // posts a new entry rather than re-hitting the idempotency
            // short-circuit on the row we just created.
            setCellMap((m) => ({
              ...m,
              [k]: {
                ...m[k],
                value: nv,
                pending: false,
                clientId: makeClientId(),
              },
            }));
          }
          // Refresh the day's list so other tabs (history) stay current.
          qc.invalidateQueries({
            queryKey: ["/api/ops/trackers", definition.slug, "entries"],
          });
        },
        onError: (err) => {
          // Network / server error — the write never landed (or its outcome
          // is unknown). Keep the SAME clientId so a retry is idempotent: if
          // the original request eventually reaches the DB, the retry maps
          // to the same row instead of creating a duplicate.
          setCellMap((m) => ({
            ...m,
            [k]: {
              ...m[k],
              value: previous,
              pending: false,
            },
          }));
          toast({
            title: "Couldn't save",
            description: err.message || "Try tapping again.",
            variant: "destructive",
          });
        },
      },
    );
  }

  return (
    <div>
      {/* Desktop / tablet — sticky-headered table. */}
      <div className="hidden md:block">
        <div className="rounded-md border bg-white overflow-auto">
          <table className="w-full border-collapse">
            <thead>
              <tr>
                <th className="sticky top-0 left-0 z-20 bg-white border-b border-r px-3 py-2 text-left text-xs font-semibold text-muted-foreground min-w-[140px]">
                  Goal
                </th>
                {residents.map((r) => (
                  <th
                    key={r.id}
                    className="sticky top-0 z-10 bg-white border-b px-3 py-2 text-left text-xs font-semibold whitespace-nowrap"
                  >
                    <div>{r.lastName}, {r.firstName}</div>
                    {r.roomNumber && (
                      <div className="text-[10px] font-normal text-muted-foreground">
                        Rm {r.roomNumber}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.rows?.map((goal) => (
                <tr key={goal.id} className="border-b last:border-0">
                  <th
                    scope="row"
                    className="sticky left-0 z-10 bg-white border-r px-3 py-2 text-left text-sm font-medium"
                  >
                    {goal.label}
                  </th>
                  {residents.map((r) => {
                    const k = key(goal.id, r.id);
                    const state = cellMap[k];
                    const value = state?.value ?? null;
                    const colorKey = value
                      ? colors[value]
                      : undefined;
                    const cellClass = value
                      ? COLOR_STYLES[colorKey ?? "muted"]
                      : EMPTY_CELL;
                    return (
                      <td key={r.id} className="px-1.5 py-1 align-top">
                        <button
                          type="button"
                          onClick={() => onCellTap(goal.id, r.id)}
                          disabled={!state || state.pending}
                          aria-label={`${goal.label} for ${r.firstName} ${r.lastName}: ${
                            value ? labels[value] ?? value : "not set"
                          }`}
                          title={value ? labels[value] ?? value : "Tap to set"}
                          className={cn(
                            "w-full min-h-[44px] rounded-md border text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                            cellClass,
                            state?.pending && "opacity-60",
                          )}
                        >
                          {value ?? "—"}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile — stack of resident cards with a row per goal. */}
      <div className="md:hidden space-y-3">
        {residents.map((r) => (
          <div
            key={r.id}
            className="rounded-md border bg-white p-3"
            aria-label={`${r.firstName} ${r.lastName}`}
          >
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-sm font-semibold">
                {r.lastName}, {r.firstName}
              </p>
              {r.roomNumber && (
                <span className="text-xs text-muted-foreground">
                  Rm {r.roomNumber}
                </span>
              )}
            </div>
            <ul className="space-y-1.5">
              {grid.rows?.map((goal) => {
                const k = key(goal.id, r.id);
                const state = cellMap[k];
                const value = state?.value ?? null;
                const colorKey = value ? colors[value] : undefined;
                const cellClass = value
                  ? COLOR_STYLES[colorKey ?? "muted"]
                  : EMPTY_CELL;
                return (
                  <li
                    key={goal.id}
                    className="flex items-center justify-between gap-2"
                  >
                    <span className="text-sm">{goal.label}</span>
                    <button
                      type="button"
                      onClick={() => onCellTap(goal.id, r.id)}
                      disabled={!state || state.pending}
                      aria-label={`${goal.label}: ${
                        value ? labels[value] ?? value : "not set"
                      }`}
                      className={cn(
                        "min-h-[44px] min-w-[64px] px-3 rounded-md border text-sm font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                        cellClass,
                        state?.pending && "opacity-60",
                      )}
                    >
                      {value ?? "—"}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium">Tap a cell to cycle:</span>
        {cycle.map((v) => (
          <span
            key={v}
            className={cn(
              "px-2 py-0.5 rounded border font-semibold",
              COLOR_STYLES[colors[v] ?? "muted"],
            )}
          >
            {v}
            {labels[v] && (
              <span className="ml-1 font-normal">· {labels[v]}</span>
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
