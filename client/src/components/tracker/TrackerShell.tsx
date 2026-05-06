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
import { ArrowLeft } from "lucide-react";
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
}

export function TrackerShell({
  definition,
  tab,
  onTabChange,
  filters,
  onFiltersChange,
  onBack,
}: TrackerShellProps) {
  const showResidentFilter = tab === "history";

  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="gap-1.5 -ml-2"
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
                "min-h-[40px] px-4 rounded-sm text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
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
