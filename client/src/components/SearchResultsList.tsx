import { MapPin, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeRawType } from "@shared/taxonomy";
import { Separator } from "@/components/ui/separator";
import type { Facility } from "@shared/schema";

const STATUS_DOT_COLORS: Record<string, string> = {
  LICENSED: "bg-green-500",
  PENDING: "bg-amber-500",
  "ON PROBATION": "bg-purple-500",
  CLOSED: "bg-red-500",
  REVOKED: "bg-red-700",
  INACTIVE: "bg-zinc-400",
};

const STATUS_LABEL: Record<string, string> = {
  LICENSED: "Licensed",
  PENDING: "Pending",
  "ON PROBATION": "Probation",
  CLOSED: "Closed",
  REVOKED: "Revoked",
  INACTIVE: "Inactive",
};

const MAX_VISIBLE = 200;

interface SearchResultsListProps {
  facilities: Facility[];
  selectedFacility: Facility | null;
  onSelectFacility: (facility: Facility) => void;
  query: string;
}

export function SearchResultsList({
  facilities,
  selectedFacility,
  onSelectFacility,
  query,
}: SearchResultsListProps) {
  const total = facilities.length;
  const visible = facilities.slice(0, MAX_VISIBLE);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-4 py-3 shrink-0 flex items-center gap-2">
        <h2 className="text-sm font-semibold">Search results</h2>
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {total.toLocaleString()}
        </span>
      </div>

      <Separator />

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-muted-foreground text-center">
            <MapPin className="h-9 w-9 mb-3 opacity-25" />
            <p className="text-sm font-medium">No facilities match</p>
            <p className="text-xs mt-1 leading-relaxed">
              "{query}" returned no results. Try a different name, city, or
              license number.
            </p>
          </div>
        ) : (
          <ul className="p-2 space-y-1">
            {visible.map((f) => {
              const isActive = selectedFacility?.number === f.number;
              const tax = normalizeRawType(f.facilityType);
              const acronym = tax?.acronym ?? "";
              const dot =
                STATUS_DOT_COLORS[f.status] ?? "bg-muted-foreground";
              const statusLabel =
                STATUS_LABEL[f.status] ?? f.status;

              return (
                <li key={f.number}>
                  <button
                    type="button"
                    onClick={() => onSelectFacility(f)}
                    className={cn(
                      "w-full text-left rounded-lg p-2.5 text-sm border transition-colors group",
                      isActive
                        ? "border-primary/60 bg-primary/5"
                        : "border-transparent hover:border-border hover:bg-accent/60"
                    )}
                    data-testid={`search-result-row-${f.number}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium leading-tight truncate" title={f.name}>
                          {f.name}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-1.5 mt-0.5">
                          <span className={cn("h-2 w-2 rounded-full shrink-0", dot)} />
                          <span>{statusLabel}</span>
                          {f.city && (
                            <>
                              <span>·</span>
                              <span className="truncate">{f.city}</span>
                            </>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5">
                          #{f.number}
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1.5">
                        {acronym && (
                          <span
                            className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-muted text-muted-foreground"
                            title={f.facilityType}
                          >
                            {acronym}
                          </span>
                        )}
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
            {total > MAX_VISIBLE && (
              <li className="px-2 py-3 text-[11px] text-muted-foreground text-center leading-relaxed">
                Showing top {MAX_VISIBLE.toLocaleString()} of{" "}
                {total.toLocaleString()}. Refine filters or search to narrow.
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
