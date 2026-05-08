/**
 * ExportCsvDialog — date-range picker that triggers the tracker CSV export.
 *
 * Backend contract:
 *   GET /api/ops/trackers/:slug/entries/export.csv
 *     ?from=<ms>&to=<ms>&shift=<AM|PM|NOC|OTHER>&residentId=<n>
 *
 * - `from` / `to` are required and are clamped to a 92-day window server-side
 *   (we mirror that here to keep the Download button in a sane state).
 * - The session cookie carries auth — no extra headers needed.
 * - Soft-deleted entries are excluded from the export by the server.
 *
 * The dialog is fully self-contained: open/close state lives in the parent
 * (`HistoryTab`), but every other piece of state — the date range, the
 * "include all" toggle, the in-flight indicator — stays here so the History
 * table render path is untouched.
 */
import { useEffect, useMemo, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { residentLabel, useResidents } from "./selectors/ResidentSelector";
import type {
  SerializedTrackerDefinition,
  Shift,
} from "@shared/tracker-schemas";

const MAX_DAYS = 92;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Format an epoch ms as `YYYY-MM-DD` in local time (matches `<input type=date>`). */
function dateToInputValue(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Parse `YYYY-MM-DD` into a local-time epoch ms anchored at start-of-day. */
function inputValueToStartOfDay(value: string): number | null {
  const parts = value.split("-").map(Number);
  if (parts.length !== 3) return null;
  const [y, m, d] = parts;
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function endOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(23, 59, 59, 999);
  return d.getTime();
}

/**
 * Compute the inclusive day count between two start-of-day ms values.
 * Both endpoints count, so 2026-05-01 → 2026-05-01 = 1 day.
 */
function daysInRange(fromStart: number, toStart: number): number {
  if (toStart < fromStart) return 0;
  return Math.round((toStart - fromStart) / DAY_MS) + 1;
}

export interface ExportCsvDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition: SerializedTrackerDefinition;
  /** Currently-selected shift in the History filter bar (always defined). */
  shift: Shift;
  /** Currently-selected resident in the History filter bar, if any. */
  residentId: number | undefined;
}

export function ExportCsvDialog({
  open,
  onOpenChange,
  definition,
  shift,
  residentId,
}: ExportCsvDialogProps) {
  const { toast } = useToast();
  const { data: residentsEnv } = useResidents();

  // Default range: 7 days ago → today (inclusive).
  const today = startOfDay(Date.now());
  const sevenDaysAgo = today - 6 * DAY_MS;

  const [fromValue, setFromValue] = useState<string>(dateToInputValue(sevenDaysAgo));
  const [toValue, setToValue] = useState<string>(dateToInputValue(today));
  const [includeAllShifts, setIncludeAllShifts] = useState(false);
  const [includeAllResidents, setIncludeAllResidents] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Reset to defaults whenever the dialog re-opens. We don't want the user
  // to come back tomorrow and find yesterday's stale range still in the form.
  useEffect(() => {
    if (open) {
      const t = startOfDay(Date.now());
      setFromValue(dateToInputValue(t - 6 * DAY_MS));
      setToValue(dateToInputValue(t));
      setIncludeAllShifts(false);
      setIncludeAllResidents(false);
    }
  }, [open]);

  const fromMs = inputValueToStartOfDay(fromValue);
  const toMs = inputValueToStartOfDay(toValue);

  const validation = useMemo(() => {
    if (fromMs === null || toMs === null) {
      return { ok: false as const, reason: "Pick both From and To dates." };
    }
    if (toMs < fromMs) {
      return { ok: false as const, reason: "End date must be on or after start date." };
    }
    const days = daysInRange(fromMs, toMs);
    if (days > MAX_DAYS) {
      return { ok: false as const, reason: `Maximum ${MAX_DAYS} days — please narrow the range.`, days };
    }
    return { ok: true as const, days };
  }, [fromMs, toMs]);

  const selectedResident = residentsEnv?.data.find((r) => r.id === residentId);

  async function handleDownload() {
    if (!validation.ok || fromMs === null || toMs === null) return;
    setIsExporting(true);

    const params = new URLSearchParams({
      from: String(fromMs),
      // Use end-of-day for the upper bound so a single-day range covers the
      // full day rather than the millisecond at midnight.
      to: String(endOfDay(toMs)),
    });
    if (!includeAllShifts) params.set("shift", shift);
    if (!includeAllResidents && residentId !== undefined) {
      params.set("residentId", String(residentId));
    }

    const url = `/api/ops/trackers/${definition.slug}/entries/export.csv?${params.toString()}`;
    const filename = `${definition.name}-${dateToInputValue(fromMs)}-${dateToInputValue(toMs)}.csv`
      .replace(/\s+/g, "-");

    try {
      // We fetch the body once, read it as text to count rows (for the empty
      // toast), then re-wrap as a Blob to drive the browser download. Re-using
      // `blob.text()` avoids a second network round-trip.
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(
          body && body.length < 500
            ? body
            : `Export failed (${res.status} ${res.statusText})`,
        );
      }
      const blob = await res.blob();
      const text = await blob.text();
      // CSV "row count" = total newlines minus 1 (the header). We tolerate
      // both `\n` and `\r\n` line endings.
      const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
      const rowCount = Math.max(0, lines.length - 1);

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);

      if (rowCount === 0) {
        toast({
          title: "Exported 0 rows for this range",
          description: "The CSV header was downloaded — your filters might be too narrow.",
        });
      } else {
        toast({
          title: "CSV downloaded",
          description: `${rowCount.toLocaleString()} row${rowCount === 1 ? "" : "s"} exported.`,
        });
      }
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error.";
      toast({
        title: "Couldn't export CSV",
        description: message,
        variant: "destructive",
      });
      // Leave dialog open so the user can retry without losing their range.
    } finally {
      setIsExporting(false);
    }
  }

  const showShiftBadge = !includeAllShifts;
  const showResidentBadge = !includeAllResidents && selectedResident;

  return (
    <Dialog open={open} onOpenChange={(next) => !isExporting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Export to CSV</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="export-from">From</Label>
              <input
                id="export-from"
                type="date"
                value={fromValue}
                max={toValue || undefined}
                onChange={(e) => setFromValue(e.target.value)}
                className="h-9 w-full px-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="export-to">To</Label>
              <input
                id="export-to"
                type="date"
                value={toValue}
                min={fromValue || undefined}
                onChange={(e) => setToValue(e.target.value)}
                className="h-9 w-full px-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div className="text-xs">
            {!validation.ok ? (
              <p
                role="alert"
                className="text-red-700 font-medium"
              >
                {validation.reason}
              </p>
            ) : (
              <p className="text-muted-foreground tabular-nums">
                {validation.days} day{validation.days === 1 ? "" : "s"} selected
              </p>
            )}
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
              Currently filtered
            </p>
            <div className="flex flex-wrap gap-1.5">
              {showShiftBadge && (
                <Badge variant="outline" className="text-[11px]">
                  Shift: {shift}
                </Badge>
              )}
              {showResidentBadge && selectedResident && (
                <Badge variant="outline" className="text-[11px]">
                  Resident: {residentLabel(selectedResident)}
                </Badge>
              )}
              {!showShiftBadge && !showResidentBadge && (
                <span className="text-xs text-muted-foreground italic">
                  Exporting all shifts and residents.
                </span>
              )}
            </div>

            <div className="flex flex-col gap-1.5 pt-1">
              <label className="inline-flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={includeAllShifts}
                  onChange={(e) => setIncludeAllShifts(e.target.checked)}
                  className="h-3.5 w-3.5"
                />
                <span>Include all shifts</span>
              </label>
              {residentId !== undefined && (
                <label className="inline-flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={includeAllResidents}
                    onChange={(e) => setIncludeAllResidents(e.target.checked)}
                    className="h-3.5 w-3.5"
                  />
                  <span>Include all residents</span>
                </label>
              )}
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={isExporting}
          >
            Cancel
          </Button>
          <Button
            onClick={handleDownload}
            disabled={!validation.ok || isExporting}
            aria-label="Download CSV"
          >
            {isExporting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                Exporting…
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" aria-hidden="true" />
                Download
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
