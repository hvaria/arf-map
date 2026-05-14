/**
 * <ChartCompletenessChip /> + <ChartCompletenessPanel /> — Wave 2 W8.
 *
 * Single-source FE renderer for the chart-completeness result returned by
 * the server's W8 endpoints. The aggregate is computed server-side via the
 * shared `evaluateChartCompleteness` evaluator from
 *   shared/chart-completeness.ts (CHART_REQUIREMENTS, CHART_REQUIREMENT_LABELS,
 *   ChartItemStatus). The FE does NOT re-evaluate; it only renders the
 *   server payload with the shared `CHART_REQUIREMENT_LABELS` map.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Tone palette (emerald / amber / red, "bg-…-100 text-…-700 border-…-200"):
 *       AuditTrailButton.tsx:65-75 + EmarContent.tsx:55-62
 *   - Real <button> trigger with aria-label:
 *       AuditTrailButton.tsx:266-278
 *   - Inline popover usage:
 *       client/src/components/tracker/CellNotePopover.tsx (Popover + Trigger + Content)
 *   - Loading slim skeleton:
 *       AuditTrailButton.tsx:294-301 (Skeleton + h-N w-N rounded)
 *   - Status text label (not color only) per a11y §7:
 *       AuditTrailButton.tsx:147-150 (chip label text inside the chip)
 *
 * No new design tokens — reuses shadcn <Popover>, <Skeleton>, lucide icons.
 */
import { useState } from "react";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Check, AlertTriangle, AlertOctagon, Clock } from "lucide-react";
import {
  CHART_REQUIREMENT_LABELS,
  type ChartItemStatus,
  type ChartRequirementKey,
} from "@shared/chart-completeness";

// ── Shared types — mirror the server envelope payload ───────────────────────

export interface ChartItemPayload {
  key: ChartRequirementKey;
  status: ChartItemStatus;
  asOf?: number | null;
  daysUntilStale?: number;
}

export interface ChartCompletenessPayload {
  residentId: number;
  residentFirstName?: string;
  residentLastName?: string;
  residentRoomNumber?: string | null;
  residentStatus?: string | null;
  admissionId?: number | null;
  items: ChartItemPayload[];
  completedCount: number;
  totalCount: number;
  missing: ChartRequirementKey[];
  stale: ChartRequirementKey[];
  worst: ChartItemStatus;
}

// ── Tone palette (mirrors AuditTrailButton.tsx:65-75 / EmarContent.tsx:55-62) ─

const WORST_TONE: Record<ChartItemStatus, string> = {
  ok: "bg-emerald-100 text-emerald-700 border-emerald-200",
  stale: "bg-amber-100 text-amber-700 border-amber-200",
  missing: "bg-red-100 text-red-700 border-red-200",
};

const ITEM_ICON: Record<ChartItemStatus, JSX.Element> = {
  ok: <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden />,
  stale: <Clock className="h-3.5 w-3.5 text-amber-600" aria-hidden />,
  missing: (
    <AlertOctagon className="h-3.5 w-3.5 text-red-600" aria-hidden />
  ),
};

function chipLabel(result: ChartCompletenessPayload): string {
  if (result.worst === "ok") return "Chart ok";
  if (result.worst === "missing") {
    const n = result.missing.length;
    return `Chart incomplete · ${n} missing`;
  }
  return "Chart stale";
}

// ── Small skeleton chip (slim — 5×16 row height) ────────────────────────────

export function ChartCompletenessChipSkeleton() {
  return (
    <Skeleton
      className="inline-block h-5 w-24 rounded-full"
      data-testid="chart-chip-skeleton"
    />
  );
}

// ── Compact chip + popover for list rows ────────────────────────────────────

export function ChartCompletenessChip({
  result,
}: {
  result: ChartCompletenessPayload;
}) {
  const [open, setOpen] = useState(false);
  const label = chipLabel(result);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={(e) => {
            // Stop the row's parent <tr> / <button> click from firing
            // (resident profile drill-in).
            e.stopPropagation();
          }}
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
            WORST_TONE[result.worst],
          )}
          aria-label={`${label}. Click for details.`}
          data-testid={`chart-chip-${result.residentId}`}
          data-worst={result.worst}
        >
          {result.worst === "missing" && (
            <AlertOctagon className="h-3 w-3" aria-hidden />
          )}
          {result.worst === "stale" && (
            <AlertTriangle className="h-3 w-3" aria-hidden />
          )}
          {result.worst === "ok" && <Check className="h-3 w-3" aria-hidden />}
          <span>{label}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 p-3"
        onClick={(e) => e.stopPropagation()}
      >
        <ChartCompletenessItemList result={result} />
      </PopoverContent>
    </Popover>
  );
}

// ── Full panel for the resident profile drill-in view ───────────────────────

export function ChartCompletenessPanel({
  result,
  isLoading,
  className,
}: {
  result?: ChartCompletenessPayload | null;
  isLoading?: boolean;
  className?: string;
}) {
  if (isLoading) {
    return (
      <div
        className={cn("rounded-lg border p-3 space-y-2", className)}
        data-testid="chart-panel-loading"
      >
        <Skeleton className="h-4 w-48" />
        <Skeleton className="h-3 w-64" />
        <div className="space-y-1.5 pt-1">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full" />
          ))}
        </div>
      </div>
    );
  }
  if (!result) return null;

  return (
    <section
      className={cn("rounded-lg border bg-white p-3", className)}
      aria-label="Chart completeness"
      data-testid="chart-panel"
    >
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-sm font-medium" style={{ color: "#1E1B4B" }}>
          Chart completeness
        </h2>
        <span
          className={cn(
            "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium border",
            WORST_TONE[result.worst],
          )}
          aria-label={`Worst status: ${result.worst}`}
        >
          {result.worst === "missing" && (
            <AlertOctagon className="h-3 w-3" aria-hidden />
          )}
          {result.worst === "stale" && (
            <AlertTriangle className="h-3 w-3" aria-hidden />
          )}
          {result.worst === "ok" && <Check className="h-3 w-3" aria-hidden />}
          <span className="capitalize">{result.worst}</span>
        </span>
      </header>
      <p className="text-xs text-muted-foreground mt-0.5">
        {result.completedCount} of {result.totalCount} required items on file
      </p>
      <div className="mt-2">
        <ChartCompletenessItemList result={result} />
      </div>
    </section>
  );
}

// ── Shared list of items (used by both chip popover + full panel) ───────────

function fmtDate(ms?: number | null): string | null {
  if (!ms) return null;
  try {
    return new Date(ms).toLocaleDateString();
  } catch {
    return null;
  }
}

function itemSuffix(item: ChartItemPayload): string {
  if (item.status === "missing") return "missing";
  if (item.status === "stale") {
    if (typeof item.daysUntilStale === "number" && item.daysUntilStale < 0) {
      return `${Math.abs(item.daysUntilStale)}d overdue`;
    }
    return "stale";
  }
  const d = fmtDate(item.asOf ?? undefined);
  return d ? d : "on file";
}

function ChartCompletenessItemList({
  result,
}: {
  result: ChartCompletenessPayload;
}) {
  return (
    <ul className="space-y-1.5" data-testid="chart-item-list">
      {result.items.map((item) => (
        <li
          key={item.key}
          className="flex items-start gap-2 text-[12px]"
          data-testid={`chart-item-${item.key}`}
          data-status={item.status}
        >
          <span className="mt-0.5 shrink-0">{ITEM_ICON[item.status]}</span>
          <span className="flex-1 min-w-0">
            <span className="text-gray-800">
              {CHART_REQUIREMENT_LABELS[item.key]}
            </span>
            <span
              className={cn(
                "ml-1 text-[11px]",
                item.status === "missing"
                  ? "text-red-600"
                  : item.status === "stale"
                    ? "text-amber-600"
                    : "text-muted-foreground",
              )}
            >
              · {itemSuffix(item)}
            </span>
          </span>
        </li>
      ))}
    </ul>
  );
}
