/**
 * TrackerShell — header + filter bar + tab strip + tab body.
 *
 * Tabs are controlled via the route's `:tab` segment. We do not store
 * shell-local tab state; the URL is the source of truth so deep-linking
 * works ("/portal/tracker/adl/history" lands directly on history).
 */
import { useLocation } from "wouter";
import { TrackerHeader } from "./TrackerHeader";
import {
  TrackerFilterBar,
  useTrackerFilters,
} from "./TrackerFilterBar";
import { QuickEntryGrid } from "./QuickEntryGrid";
import { DetailedEntryForm } from "./DetailedEntryForm";
import { HistoryTab } from "./HistoryTab";
import { cn } from "@/lib/utils";
import { splitLocation } from "@/lib/tracker/urlState";
import type {
  SerializedTrackerDefinition,
  TrackerMode,
} from "@shared/tracker-schemas";

const TAB_LABEL: Record<TrackerMode, string> = {
  quick: "Quick",
  detailed: "Detailed",
  history: "History",
};

function isTrackerMode(s: string | undefined): s is TrackerMode {
  return s === "quick" || s === "detailed" || s === "history";
}

export function TrackerShell({
  definition,
  tab,
}: {
  definition: SerializedTrackerDefinition;
  tab: string | undefined;
}) {
  const [location, setLocation] = useLocation();
  const { path, queryString } = splitLocation(location);
  const activeTab: TrackerMode = isTrackerMode(tab)
    ? tab
    : (definition.defaultMode as TrackerMode);

  const {
    filters,
    setDate,
    setShift,
    setResident,
    showResidentFilter,
  } = useTrackerFilters({
    showResidentFilter: activeTab === "history",
  });

  function selectTab(next: TrackerMode) {
    // Replace the trailing tab segment in `path` while preserving the
    // current query string (date / shift / residentId) intact.
    const segments = path.split("/").filter(Boolean);
    // Expected shapes:
    //   ["portal", "tracker", "<slug>"]                  → append next
    //   ["portal", "tracker", "<slug>", "<tab>"]         → replace last
    if (segments.length === 3) {
      segments.push(next);
    } else if (segments.length >= 4) {
      segments[3] = next;
    }
    const nextPath = `/${segments.join("/")}`;
    setLocation(queryString ? `${nextPath}?${queryString}` : nextPath);
  }

  return (
    <div className="space-y-4">
      <TrackerHeader
        definition={definition}
        onNewEntry={
          definition.modes.includes("detailed")
            ? () => selectTab("detailed")
            : undefined
        }
      />

      <TrackerFilterBar
        filters={filters}
        setDate={setDate}
        setShift={setShift}
        setResident={setResident}
        showResidentFilter={showResidentFilter}
      />

      <div
        role="tablist"
        aria-label={`${definition.name} modes`}
        className="inline-flex items-center rounded-md border bg-white p-1"
      >
        {definition.modes.map((mode) => {
          const active = mode === activeTab;
          return (
            <button
              key={mode}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={`tracker-panel-${mode}`}
              id={`tracker-tab-${mode}`}
              onClick={() => selectTab(mode)}
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
        id={`tracker-panel-${activeTab}`}
        aria-labelledby={`tracker-tab-${activeTab}`}
      >
        {activeTab === "quick" && (
          <QuickEntryGrid
            definition={definition}
            date={filters.date}
            shift={filters.shift}
          />
        )}
        {activeTab === "detailed" && (
          <DetailedEntryForm
            definition={definition}
            date={filters.date}
            shift={filters.shift}
          />
        )}
        {activeTab === "history" && (
          <HistoryTab definition={definition} filters={filters} />
        )}
      </div>
    </div>
  );
}
