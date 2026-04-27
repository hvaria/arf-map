import { SlidersHorizontal, X } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";

interface FilterBarProps {
  activeFilters: Set<string>;
  onToggle: (status: string) => void;
  hiringOnly: boolean;
  onToggleHiring: () => void;
  capacityFilters: Set<string>;
  onToggleCapacity: (cap: string) => void;
  facilityType: "small" | "large" | null;
  onSetFacilityType: (type: "small" | "large" | null) => void;
  onClearAdvanced: () => void;
  totalCount: number;
  filteredCount: number;
}

const STATUSES = [
  { key: "LICENSED", label: "Licensed", color: "bg-green-500", count: 618 },
  { key: "CLOSED", label: "Closed", color: "bg-red-500", count: 191 },
  { key: "PENDING", label: "Pending", color: "bg-amber-500", count: 51 },
  { key: "ON PROBATION", label: "Probation", color: "bg-purple-500", count: 1 },
];

const CAPACITY_OPTIONS = [
  { key: "4", label: "4 beds", count: 459 },
  { key: "5", label: "5 beds", count: 24 },
  { key: "6", label: "6 beds", count: 310 },
  { key: "7+", label: "7+ beds", count: 68 },
];

const FACILITY_TYPES = [
  { key: null, label: "All sizes" },
  { key: "small" as const, label: "Small (≤6 beds)" },
  { key: "large" as const, label: "Large (7+ beds)" },
];

export function FilterBar({
  activeFilters,
  onToggle,
  hiringOnly,
  onToggleHiring,
  capacityFilters,
  onToggleCapacity,
  facilityType,
  onSetFacilityType,
  onClearAdvanced,
  totalCount,
  filteredCount,
}: FilterBarProps) {
  const advancedActive = capacityFilters.size > 0 || facilityType !== null;

  return (
    <div className="flex items-center gap-1.5 flex-wrap" data-testid="filter-bar">
      {STATUSES.map((s) => {
        const active = activeFilters.has(s.key);
        return (
          <button
            key={s.key}
            onClick={() => onToggle(s.key)}
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all border shadow-sm",
              active
                ? "bg-background/95 backdrop-blur-sm border-border/60 text-foreground"
                : "bg-background/60 backdrop-blur-sm border-transparent text-muted-foreground opacity-60"
            )}
            data-testid={`button-filter-${s.key.toLowerCase().replace(' ', '-')}`}
          >
            <span className={cn("w-2 h-2 rounded-full shrink-0", s.color, !active && "opacity-40")} />
            {s.label}
          </button>
        );
      })}

      <button
        onClick={onToggleHiring}
        className={cn(
          "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all border shadow-sm",
          hiringOnly
            ? "bg-blue-50 dark:bg-blue-950 backdrop-blur-sm border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300"
            : "bg-background/60 backdrop-blur-sm border-transparent text-muted-foreground opacity-60"
        )}
        data-testid="button-filter-hiring"
      >
        <span className={cn("w-2 h-2 rounded-full shrink-0 bg-blue-500", !hiringOnly && "opacity-40")} />
        Hiring
      </button>

      {/* Advanced Filters popover */}
      <Popover>
        <PopoverTrigger asChild>
          <button
            className={cn(
              "flex items-center gap-1.5 px-2.5 py-1.5 rounded-full text-xs font-medium transition-all border shadow-sm",
              advancedActive
                ? "bg-violet-50 dark:bg-violet-950 backdrop-blur-sm border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300"
                : "bg-background/80 backdrop-blur-sm border-border/60 text-foreground"
            )}
            data-testid="button-advanced-filters"
          >
            <SlidersHorizontal className="h-3.5 w-3.5 shrink-0" />
            Advanced
            {advancedActive && (
              <span className="ml-0.5 bg-violet-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[10px] font-bold">
                {capacityFilters.size + (facilityType ? 1 : 0)}
              </span>
            )}
          </button>
        </PopoverTrigger>

        <PopoverContent className="w-64 p-4" align="start" sideOffset={6}>
          <div className="flex items-center justify-between mb-3">
            <span className="text-sm font-semibold">Advanced Filters</span>
            {advancedActive && (
              <button
                onClick={onClearAdvanced}
                className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
                Clear all
              </button>
            )}
          </div>

          {/* Capacity */}
          <div className="mb-4">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Capacity
            </p>
            <div className="flex flex-wrap gap-1.5">
              {CAPACITY_OPTIONS.map((opt) => {
                const active = capacityFilters.has(opt.key);
                return (
                  <button
                    key={opt.key}
                    onClick={() => onToggleCapacity(opt.key)}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                      active
                        ? "bg-violet-100 dark:bg-violet-900 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300"
                        : "bg-muted/50 border-transparent text-muted-foreground hover:border-border"
                    )}
                  >
                    {opt.label}
                    <span className="ml-1 opacity-60">({opt.count})</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Facility Type */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Facility Type
            </p>
            <div className="space-y-1.5">
              {FACILITY_TYPES.map((ft) => {
                const active = facilityType === ft.key;
                return (
                  <button
                    key={String(ft.key)}
                    onClick={() => onSetFacilityType(ft.key)}
                    className={cn(
                      "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs text-left transition-all border",
                      active
                        ? "bg-violet-100 dark:bg-violet-900 border-violet-300 dark:border-violet-700 text-violet-700 dark:text-violet-300"
                        : "border-transparent text-muted-foreground hover:bg-muted/50"
                    )}
                  >
                    <span className={cn(
                      "w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all",
                      active ? "border-violet-500" : "border-muted-foreground/40"
                    )}>
                      {active && <span className="w-1.5 h-1.5 rounded-full bg-violet-500" />}
                    </span>
                    {ft.label}
                  </button>
                );
              })}
            </div>
          </div>
        </PopoverContent>
      </Popover>

      <span className="text-xs text-muted-foreground ml-1 bg-background/80 backdrop-blur-sm px-2 py-1 rounded-full shadow-sm border border-border/40">
        {filteredCount} of {totalCount}
      </span>
    </div>
  );
}
