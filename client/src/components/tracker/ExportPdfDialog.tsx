/**
 * ExportPdfDialog — date-range picker that generates a state-audit-ready PDF
 * report for the current tracker.
 *
 * Backend contract:
 *   GET /api/ops/trackers/:slug/entries/export.pdf
 *     ?from=<ms>&to=<ms>&shift=<AM|PM|NOC|OTHER>&residentId=<n>
 *
 * - `from` / `to` are required and clamped to a 92-day window server-side.
 * - The session cookie carries auth.
 * - Soft-deleted entries are excluded.
 * - Response sets `X-Tracker-Export-Count: <n>` for the success toast.
 *
 * Mirrors `ExportCsvDialog` near-identically — same date pickers, same
 * "include all" toggles, same default 7-day range, same validation. The only
 * differences are the endpoint, the success/empty/error copy, and a
 * truncation guard that checks the PDF tail for `%%EOF` (binary equivalent of
 * the CSV path's row-count by linebreak).
 */
import { useEffect, useMemo, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
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

function dateToInputValue(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

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

function daysInRange(fromStart: number, toStart: number): number {
  if (toStart < fromStart) return 0;
  return Math.round((toStart - fromStart) / DAY_MS) + 1;
}

/**
 * Read the last 6 bytes of the PDF blob and look for the `%%EOF` trailer.
 * If the renderer crashed mid-stream the trailer is missing — surface as a
 * retryable error rather than handing the user a corrupt file.
 */
async function isPdfComplete(blob: Blob): Promise<boolean> {
  if (blob.size < 8) return false;
  const tail = await blob.slice(blob.size - 6).text();
  return tail.includes("%%EOF");
}

export interface ExportPdfDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  definition: SerializedTrackerDefinition;
  shift: Shift;
  residentId: number | undefined;
}

export function ExportPdfDialog({
  open,
  onOpenChange,
  definition,
  shift,
  residentId,
}: ExportPdfDialogProps) {
  const { toast } = useToast();
  const { data: residentsEnv } = useResidents();

  const today = startOfDay(Date.now());
  const sevenDaysAgo = today - 6 * DAY_MS;

  const [fromValue, setFromValue] = useState<string>(dateToInputValue(sevenDaysAgo));
  const [toValue, setToValue] = useState<string>(dateToInputValue(today));
  const [includeAllShifts, setIncludeAllShifts] = useState(false);
  const [includeAllResidents, setIncludeAllResidents] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);

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

  async function handleGenerate() {
    if (!validation.ok || fromMs === null || toMs === null) return;
    setIsGenerating(true);

    const params = new URLSearchParams({
      from: String(fromMs),
      to: String(endOfDay(toMs)),
    });
    if (!includeAllShifts) params.set("shift", shift);
    if (!includeAllResidents && residentId !== undefined) {
      params.set("residentId", String(residentId));
    }

    const url = `/api/ops/trackers/${definition.slug}/entries/export.pdf?${params.toString()}`;
    const filename = `${definition.name}-${dateToInputValue(fromMs)}-${dateToInputValue(toMs)}.pdf`
      .replace(/\s+/g, "-");

    try {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        // The error response is JSON ({ success: false, error: "..." }).
        let message = `PDF generation failed (${res.status} ${res.statusText})`;
        try {
          const body = await res.json();
          if (body && typeof body.error === "string" && body.error.length < 500) {
            message = body.error;
          }
        } catch {
          // non-JSON body — keep the generic message
        }
        throw new Error(message);
      }

      const count = Number(res.headers.get("X-Tracker-Export-Count") ?? "0");
      const blob = await res.blob();

      if (!(await isPdfComplete(blob))) {
        throw new Error("PDF generation was interrupted — please retry.");
      }

      const objectUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objectUrl;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(objectUrl);

      if (count === 0) {
        toast({
          title: "Generated PDF for 0 entries",
          description:
            "The report header was downloaded — your filters might be too narrow.",
        });
      } else {
        toast({
          title: "PDF downloaded",
          description: `${count.toLocaleString()} entr${count === 1 ? "y" : "ies"} reported.`,
        });
      }
      onOpenChange(false);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unexpected error.";
      toast({
        title: "Couldn't generate PDF",
        description: message,
        variant: "destructive",
      });
      // Leave dialog open for retry without losing the range.
    } finally {
      setIsGenerating(false);
    }
  }

  const showShiftBadge = !includeAllShifts;
  const showResidentBadge = !includeAllResidents && selectedResident;

  return (
    <Dialog open={open} onOpenChange={(next) => !isGenerating && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate PDF report</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="pdf-from">From</Label>
              <input
                id="pdf-from"
                type="date"
                value={fromValue}
                max={toValue || undefined}
                onChange={(e) => setFromValue(e.target.value)}
                className="h-9 w-full px-2 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pdf-to">To</Label>
              <input
                id="pdf-to"
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
              <p role="alert" className="text-red-700 font-medium">
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
                  Reporting on all shifts and residents.
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
            disabled={isGenerating}
          >
            Cancel
          </Button>
          <Button
            onClick={handleGenerate}
            disabled={!validation.ok || isGenerating}
            aria-label="Generate PDF"
          >
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" aria-hidden="true" />
                Generating…
              </>
            ) : (
              <>
                <FileText className="h-4 w-4 mr-2" aria-hidden="true" />
                Generate
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
