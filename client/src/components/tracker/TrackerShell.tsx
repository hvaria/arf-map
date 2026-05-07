/**
 * TrackerShell — header + filter bar + tab strip + tab body.
 *
 * Fully controlled. The parent (OperationsTab) owns the active tab and the
 * filter state (date / shift / residentId) and is the one that responds to
 * back-navigation. The shell never reads location — there is no per-tracker
 * URL anymore.
 */
import { TrackerHeader } from "./TrackerHeader";
import { TrackerFilterBar, type TrackerFilters } from "./TrackerFilterBar";
import { QuickEntryGrid } from "./QuickEntryGrid";
import { DetailedEntryForm } from "./DetailedEntryForm";
import { HistoryTab } from "./HistoryTab";
import { Button } from "@/components/ui/button";
import { ArrowLeft, AlertOctagon } from "lucide-react";
import { cn } from "@/lib/utils";
import type {
  SerializedTrackerDefinition,
  TrackerMode,
  Shift,
} from "@shared/tracker-schemas";

const TAB_LABEL: Record<TrackerMode, string> = {
  quick: "Quick",
  detailed: "Detailed",
  history: "History",
};

export interface TrackerShellProps {
  definition: SerializedTrackerDefinition;
  tab: TrackerMode;
  onTabChange: (next: TrackerMode) => void;
  filters: TrackerFilters;
  onFiltersChange: (
    patch: Partial<{ date: number; shift: Shift; residentId: number | undefined }>,
  ) => void;
  /** Called when the user clicks the back-to-trackers chevron. */
  onBack: () => void;
  /**
   * Active alert count for this tracker. When > 0 the shell renders a banner
   * above the tab strip pointing to the Operations overview's alerts card.
   */
  activeAlertCount?: number;
  /**
   * Optional handler for the "view all" banner action. Defaults to onBack —
   * the OperationsTab's <TrackerAlertsCard /> lives on the overview, so
   * unwinding the tracker sub-view surfaces it.
   */
  onViewAllAlerts?: () => void;
}

export function TrackerShell({
  definition,
  tab,
  onTabChange,
  filters,
  onFiltersChange,
  onBack,
  activeAlertCount = 0,
  onViewAllAlerts,
}: TrackerShellProps) {
  const showResidentFilter = tab === "history";

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="gap-1.5 -ml-2 transition-transform active:scale-95"
        aria-label="Back to overview"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Overview
      </Button>

      <TrackerHeader
        definition={definition}
        onNewEntry={
          definition.modes.includes("detailed")
            ? () => onTabChange("detailed")
            : undefined
        }
      />

      <TrackerFilterBar
        date={filters.date}
        shift={filters.shift}
        residentId={filters.residentId}
        showResidentFilter={showResidentFilter}
        onChange={onFiltersChange}
      />

      {activeAlertCount > 0 && (
        <div
          className="rounded-md border border-red-200 bg-red-50/70 px-3 py-2 flex items-center justify-between gap-2 text-sm"
          role="status"
          aria-label={`${activeAlertCount} active alert${activeAlertCount === 1 ? "" : "s"} for ${definition.name}`}
        >
          <div className="flex items-center gap-2 text-red-800 min-w-0">
            <AlertOctagon className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="font-medium tabular-nums">
              {activeAlertCount} active alert{activeAlertCount === 1 ? "" : "s"}
            </span>
            <span className="text-red-700/80 truncate">
              for {definition.name}
            </span>
          </div>
          {onViewAllAlerts && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onViewAllAlerts}
              className="h-7 text-xs text-red-800 hover:bg-red-100"
            >
              View all
            </Button>
          )}
        </div>
      )}

      <div
        role="tablist"
        aria-label={`${definition.name} modes`}
        className="inline-flex items-center rounded-md border bg-white p-1"
      >
        {definition.modes.map((mode) => {
          const active = mode === tab;
          return (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`tracker-panel-${mode}`}
              id={`tracker-tab-${mode}`}
              onClick={() => onTabChange(mode)}
              className={cn(
                "min-h-[44px] px-4 rounded-sm text-sm font-medium transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-1 focus-visible:ring-indigo-400 active:scale-95",
                active
                  ? "bg-indigo-600 text-white shadow-sm"
                  : "text-muted-foreground hover:bg-indigo-50",
              )}
            >
              {TAB_LABEL[mode]}
            </button>
          );
        })}
      </div>

      <div
        role="tabpanel"
        id={`tracker-panel-${tab}`}
        aria-labelledby={`tracker-tab-${tab}`}
        className="animate-in fade-in duration-150"
      >
        {tab === "quick" && (
          <QuickEntryGrid
            definition={definition}
            date={filters.date}
            shift={filters.shift}
          />
        )}
        {tab === "detailed" && (
          <DetailedEntryForm
            definition={definition}
            date={filters.date}
            shift={filters.shift}
          />
        )}
        {tab === "history" && (
          <HistoryTab definition={definition} filters={filters} />
        )}
      </div>
    </div>
  );
}
