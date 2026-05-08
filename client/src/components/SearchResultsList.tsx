import { MapPin, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { normalizeRawType } from "@shared/taxonomy";
import type { Facility } from "@shared/schema";

const STATUS_DOT_COLORS: Record<string, string> = {
  LICENSED: "bg-emerald-500",
  PENDING: "bg-amber-500",
  "ON PROBATION": "bg-amber-600",
  CLOSED: "bg-red-500",
  REVOKED: "bg-red-700",
  INACTIVE: "bg-stone-400",
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
      <div
        className="px-4 py-3 shrink-0 flex items-center gap-2 border-b"
        style={{ borderColor: "var(--portal-border-subtle)" }}
      >
        <h2 className="text-[13px] font-semibold text-stone-900">Search results</h2>
        <span className="ml-auto text-[11px] text-muted-foreground portal-num bg-stone-50 border border-stone-200 rounded-full px-2 py-0.5">
          {total.toLocaleString()}
        </span>
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        {total === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 px-6 text-muted-foreground text-center">
            <MapPin className="h-7 w-7 mb-3 text-stone-300" />
            <p className="text-[13px] font-medium text-stone-700">No facilities match</p>
            <p className="text-[12px] mt-1 leading-relaxed">
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
              const dot = STATUS_DOT_COLORS[f.status] ?? "bg-stone-400";
              const statusLabel = STATUS_LABEL[f.status] ?? f.status;

              return (
                <li key={f.number}>
                  <button
                    type="button"
                    onClick={() => onSelectFacility(f)}
                    className={cn(
                      "w-full text-left rounded-md p-2.5 border transition-colors group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                      isActive
                        ? "bg-[var(--portal-accent-soft)]"
                        : "border-transparent hover:bg-stone-50",
                    )}
                    style={{
                      borderColor: isActive
                        ? "var(--portal-accent)"
                        : undefined,
                    }}
                    data-testid={`search-result-row-${f.number}`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-[13px] font-medium leading-tight truncate text-stone-900" title={f.name}>
                          {f.name}
                        </div>
                        <div className="text-[12px] text-muted-foreground flex items-center gap-1.5 mt-1">
                          <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", dot)} />
                          <span>{statusLabel}</span>
                          {f.city && (
                            <>
                              <span aria-hidden="true" className="text-stone-300">·</span>
                              <span className="truncate">{f.city}</span>
                            </>
                          )}
                        </div>
                        <div className="text-[11px] text-muted-foreground mt-0.5 portal-num">
                          #{f.number}
                        </div>
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1.5">
                        {acronym && (
                          <span
                            className="text-[10px] font-semibold tracking-wider px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 border border-stone-200"
                            title={f.facilityType}
                          >
                            {acronym}
                          </span>
                        )}
                        <ChevronRight className="h-3.5 w-3.5 text-stone-300 group-hover:text-stone-500 transition-colors" />
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
            {total > MAX_VISIBLE && (
              <li className="px-3 py-4 text-[11px] text-muted-foreground text-center leading-relaxed">
                Showing top <span className="portal-num">{MAX_VISIBLE.toLocaleString()}</span> of{" "}
                <span className="portal-num">{total.toLocaleString()}</span>. Refine filters or search to narrow.
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  );
}
