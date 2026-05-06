/**
 * Filter bar for tracker pages — date + shift (+ optional resident filter).
 *
 * Hash-routing aware: filters live in the part of `location` after the `?`.
 * Selecting a value updates the URL via wouter's `setLocation` so refreshing
 * (or sharing the link) restores the same view.
 */
import { useEffect, useMemo } from "react";
import { Calendar as CalendarIcon } from "lucide-react";
import { ShiftToggle, deriveCurrentShift } from "./selectors/ShiftToggle";
import {
  ResidentSelector,
  useResidents,
  residentLabel,
} from "./selectors/ResidentSelector";
import { useQueryParams } from "@/lib/tracker/urlState";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import type { Shift } from "@shared/tracker-schemas";

export interface TrackerFilters {
  /** Local-day epoch ms (midnight). */
  date: number;
  shift: Shift;
  residentId?: number;
}

/** Convert an epoch-ms day to the start-of-day in local time. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function endOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

function dateToInputValue(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function inputValueToDate(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  if (!y || !m || !d) return startOfDay(Date.now());
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

const VALID_SHIFTS: readonly Shift[] = ["AM", "PM", "NOC", "OTHER"] as const;

function isShift(s: string): s is Shift {
  return (VALID_SHIFTS as readonly string[]).includes(s);
}

export function useTrackerFilters(opts: {
  /** When false, the resident parameter is omitted from the bar's UI. */
  showResidentFilter?: boolean;
}): {
  filters: TrackerFilters;
  setDate: (ms: number) => void;
  setShift: (s: Shift) => void;
  setResident: (id: number | undefined) => void;
  showResidentFilter: boolean;
} {
  const [params, setParams] = useQueryParams();

  const filters: TrackerFilters = useMemo(() => {
    const dateRaw = params.get("date");
    const shiftRaw = params.get("shift") ?? "";
    const residentRaw = params.get("residentId");

    const date = dateRaw
      ? Number.parseInt(dateRaw, 10)
      : startOfDay(Date.now());
    const shift: Shift = isShift(shiftRaw) ? shiftRaw : deriveCurrentShift();
    const residentId = residentRaw ? Number(residentRaw) : undefined;
    return {
      date: Number.isFinite(date) ? startOfDay(date) : startOfDay(Date.now()),
      shift,
      residentId: Number.isFinite(residentId) ? residentId : undefined,
    };
  }, [params]);

  // Backfill the URL with sensible defaults so the user-visible state is
  // always in the address bar (and shareable). We only write when missing.
  useEffect(() => {
    if (params.get("date") && params.get("shift")) return;
    setParams((next) => {
      if (!next.get("date")) next.set("date", String(startOfDay(Date.now())));
      if (!next.get("shift")) next.set("shift", deriveCurrentShift());
    });
    // We intentionally read params from closure; setParams is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return {
    filters,
    setDate: (ms) => setParams((p) => p.set("date", String(startOfDay(ms)))),
    setShift: (s) => setParams((p) => p.set("shift", s)),
    setResident: (id) =>
      setParams((p) => {
        if (id === undefined) p.delete("residentId");
        else p.set("residentId", String(id));
      }),
    showResidentFilter: opts.showResidentFilter ?? false,
  };
}

export function TrackerFilterBar({
  filters,
  setDate,
  setShift,
  setResident,
  showResidentFilter,
}: {
  filters: TrackerFilters;
  setDate: (ms: number) => void;
  setShift: (s: Shift) => void;
  setResident: (id: number | undefined) => void;
  showResidentFilter: boolean;
}) {
  const dateLabel = new Date(filters.date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const { data: residentEnv } = useResidents();
  const selectedResident = residentEnv?.data.find(
    (r) => r.id === filters.residentId,
  );

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border bg-white p-2"
      role="toolbar"
      aria-label="Tracker filters"
    >
      <Popover>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 min-h-[44px] sm:min-h-0"
            aria-label="Pick date"
          >
            <CalendarIcon className="h-4 w-4" />
            {dateLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-auto p-3">
          <input
            type="date"
            aria-label="Date"
            value={dateToInputValue(filters.date)}
            onChange={(e) => setDate(inputValueToDate(e.target.value))}
            className="h-9 px-2 rounded-md border border-input bg-background text-sm"
          />
        </PopoverContent>
      </Popover>

      <ShiftToggle
        value={filters.shift}
        onChange={setShift}
        size="sm"
        ariaLabel="Filter by shift"
      />

      {showResidentFilter && (
        <div className="flex items-center gap-2">
          <select
            aria-label="Filter by resident"
            value={filters.residentId ?? ""}
            onChange={(e) =>
              setResident(e.target.value ? Number(e.target.value) : undefined)
            }
            className="h-9 px-2 rounded-md border border-input bg-background text-sm min-w-[160px]"
          >
            <option value="">All residents</option>
            {(residentEnv?.data ?? []).map((r) => (
              <option key={r.id} value={r.id}>
                {residentLabel(r)}
              </option>
            ))}
          </select>
          {selectedResident && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setResident(undefined)}
              aria-label="Clear resident filter"
            >
              Clear
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
