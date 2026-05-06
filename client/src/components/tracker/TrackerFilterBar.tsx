/**
 * Filter bar for tracker pages — date + shift (+ optional resident filter).
 *
 * This is a fully controlled component. The parent owns date / shift /
 * residentId state and emits patches via `onChange`. There is no URL
 * coupling — trackers now render as a sub-view inside OperationsTab and
 * therefore have no per-tracker route.
 */
import { Calendar as CalendarIcon } from "lucide-react";
import { ShiftToggle } from "./selectors/ShiftToggle";
import {
  useResidents,
  residentLabel,
} from "./selectors/ResidentSelector";
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

export interface TrackerFilterBarProps {
  date: number;
  shift: Shift;
  residentId?: number;
  /** When true, render the resident dropdown (used by the History tab). */
  showResidentFilter?: boolean;
  /** Patch callback — keys not present in the patch are left unchanged. */
  onChange: (
    patch: Partial<{ date: number; shift: Shift; residentId: number | undefined }>,
  ) => void;
}

export function TrackerFilterBar({
  date,
  shift,
  residentId,
  showResidentFilter = false,
  onChange,
}: TrackerFilterBarProps) {
  const dateLabel = new Date(date).toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
  const { data: residentEnv } = useResidents();
  const selectedResident = residentEnv?.data.find((r) => r.id === residentId);

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
            value={dateToInputValue(date)}
            onChange={(e) =>
              onChange({ date: startOfDay(inputValueToDate(e.target.value)) })
            }
            className="h-9 px-2 rounded-md border border-input bg-background text-sm"
          />
        </PopoverContent>
      </Popover>

      <ShiftToggle
        value={shift}
        onChange={(s) => onChange({ shift: s })}
        size="sm"
        ariaLabel="Filter by shift"
      />

      {showResidentFilter && (
        <div className="flex items-center gap-2">
          <select
            aria-label="Filter by resident"
            value={residentId ?? ""}
            onChange={(e) =>
              onChange({
                residentId: e.target.value ? Number(e.target.value) : undefined,
              })
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
              onClick={() => onChange({ residentId: undefined })}
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
