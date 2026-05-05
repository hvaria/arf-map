import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  SlidersHorizontal, X, ChevronDown, ChevronRight,
  Building2, MapPin, Activity, Users, Briefcase,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { FacilitiesMeta } from "@shared/schema";
import {
  DOMAINS,
  DOMAIN_PALETTE,
  groupsForDomain,
  typesForGroup,
  normalizeRawType,
  getByCode,
  type FacilityDomain,
  type TaxonomyEntry,
} from "@shared/taxonomy";

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Quick-filter ids correspond to taxonomy `code` values. We narrow the type
 * union to a curated subset that's surfaced as chips at the top of the panel.
 */
export type QuickFilterId = "ARF" | "RCFE" | "CCC" | "GH" | "FCCH" | "HCO" | "";

export interface FacilityFilters {
  search: string;
  county: string;
  /** Domain (top of hierarchy). Stored as the canonical CCLD domain name. */
  facilityGroup: string;
  /** Single facility type (the API contract is single-valued). Canonical official label. */
  facilityType: string;
  statuses: Set<string>;
  hiringOnly: boolean;
  minCapacity: number | null;
  maxCapacity: number | null;
  quickFilter: QuickFilterId;
}

export const DEFAULT_FILTERS: FacilityFilters = {
  search: "",
  county: "",
  facilityGroup: "",
  facilityType: "",
  statuses: new Set(["LICENSED", "PENDING", "ON PROBATION"]),
  hiringOnly: false,
  minCapacity: null,
  maxCapacity: null,
  quickFilter: "",
};

export function countActiveFilters(f: FacilityFilters): number {
  let n = 0;
  if (f.search) n++;
  if (f.county) n++;
  // quickFilter is a single selection that syncs group + type — count it as 1.
  // When it's cleared, count group/type independently.
  if (f.quickFilter) {
    n++;
  } else {
    if (f.facilityGroup) n++;
    if (f.facilityType) n++;
  }
  // Default statuses don't count — only non-default combos
  const defaultStatuses = new Set(["LICENSED", "PENDING", "ON PROBATION"]);
  if (
    f.statuses.size !== defaultStatuses.size ||
    !Array.from(f.statuses).every((s) => defaultStatuses.has(s))
  ) n++;
  if (f.hiringOnly) n++;
  if (f.minCapacity != null || f.maxCapacity != null) n++;
  return n;
}

// ── Quick filters (curated taxonomy subset) ───────────────────────────────────

interface QuickFilterChip {
  id: QuickFilterId;
  /** Taxonomy code this chip resolves to. */
  code: string;
  /** Short label shown on the chip. */
  label: string;
  /** Sub-line description. */
  description: string;
  colorActive: string;
  colorBorder: string;
}

/**
 * Curated set of quick-filter chips. Each one resolves to a single taxonomy
 * entry — so the chip's `code` drives `facilityGroup` (the entry's domain)
 * AND `facilityType` (the entry's officialLabel) when activated.
 *
 * Selection criteria: highest-volume / most-recognizable types in each
 * of the four CCLD domains — ARF + RCFE for Adult & Senior Care, GH for
 * Children's Residential, CCC + FCCH for Child Care, HCO for Home Care.
 *
 * Tailwind JIT requires fully-spelled class strings — do not concatenate.
 */
const QUICK_FILTER_CHIPS: QuickFilterChip[] = [
  {
    id: "ARF",
    code: "ARF",
    label: "ARF",
    description: "Adult Residential",
    colorActive: "bg-teal-600 text-white border-teal-600",
    colorBorder: "border-teal-400 text-teal-700 dark:text-teal-400",
  },
  {
    id: "RCFE",
    code: "RCFE",
    label: "RCFE",
    description: "Senior Living",
    colorActive: "bg-blue-600 text-white border-blue-600",
    colorBorder: "border-blue-400 text-blue-700 dark:text-blue-400",
  },
  {
    id: "CCC",
    code: "CCC",
    label: "Day Care Center",
    description: "Child Care",
    colorActive: "bg-green-600 text-white border-green-600",
    colorBorder: "border-green-400 text-green-700 dark:text-green-400",
  },
  {
    id: "GH",
    code: "GH",
    label: "Group Home (Children's)",
    description: "Children's Residential",
    colorActive: "bg-purple-600 text-white border-purple-600",
    colorBorder: "border-purple-400 text-purple-700 dark:text-purple-400",
  },
  {
    id: "FCCH",
    code: "FCCH",
    label: "Family Child Care",
    description: "Home-based",
    colorActive: "bg-emerald-600 text-white border-emerald-600",
    colorBorder: "border-emerald-400 text-emerald-700 dark:text-emerald-400",
  },
  {
    id: "HCO",
    code: "HCO",
    label: "Home Care",
    description: "In-home services",
    colorActive: "bg-orange-600 text-white border-orange-600",
    colorBorder: "border-orange-400 text-orange-700 dark:text-orange-400",
  },
];

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string }> = {
  LICENSED:       { label: "Licensed" },
  PENDING:        { label: "Pending" },
  "ON PROBATION": { label: "Probation" },
  CLOSED:         { label: "Closed" },
  REVOKED:        { label: "Revoked" },
};

function isDomain(value: string): value is FacilityDomain {
  return (DOMAINS as readonly string[]).includes(value);
}

// ── Main component ────────────────────────────────────────────────────────────

interface FilterPanelProps {
  filters: FacilityFilters;
  onChange: (filters: FacilityFilters) => void;
  totalShowing: number;
  /**
   * Controlled-mode props. When `open` is provided, the component renders
   * only the popup panel (no internal trigger button) and reports open/close
   * intent via `onOpenChange`. This lets callers embed their own trigger
   * elsewhere (e.g. inside the search bar) while keeping the panel layout
   * here.
   */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

export function FilterPanel({ filters, onChange, totalShowing, open: openProp, onOpenChange }: FilterPanelProps) {
  const isControlled = openProp !== undefined;
  const [openInternal, setOpenInternal] = useState(false);
  const open = isControlled ? !!openProp : openInternal;
  const setOpen = (next: boolean | ((prev: boolean) => boolean)) => {
    const resolved = typeof next === "function" ? next(open) : next;
    if (isControlled) onOpenChange?.(resolved);
    else setOpenInternal(resolved);
  };
  const [countySearch, setCountySearch] = useState("");

  const { data: meta } = useQuery<FacilitiesMeta>({
    queryKey: ["/api/facilities/meta"],
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const activeCount = countActiveFilters(filters);

  const filteredCounties = useMemo(() => {
    if (!meta?.counties) return [];
    if (!countySearch) return meta.counties;
    const q = countySearch.toLowerCase();
    return meta.counties.filter((c) => c.toLowerCase().includes(q));
  }, [meta?.counties, countySearch]);

  /**
   * Taxonomy entries available under the currently selected domain, grouped
   * by their search-group. When no domain is selected we don't render the
   * type list at all — the user must pick a domain first to avoid an
   * unwieldy 30+ checkbox flat list.
   */
  const typesByGroup = useMemo(() => {
    if (!filters.facilityGroup || !isDomain(filters.facilityGroup)) return null;
    const groups = groupsForDomain(filters.facilityGroup);
    return groups.map((g) => ({
      group: g,
      entries: typesForGroup(g),
    }));
  }, [filters.facilityGroup]);

  const update = (patch: Partial<FacilityFilters>) =>
    onChange({ ...filters, ...patch });

  const toggleStatus = (s: string) => {
    const next = new Set(filters.statuses);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    update({ statuses: next });
  };

  // Reset spreads DEFAULT_FILTERS (which includes quickFilter: "") so all fields clear.
  const reset = () => onChange({ ...DEFAULT_FILTERS, statuses: new Set(["LICENSED", "PENDING", "ON PROBATION"]) });

  return (
    <div className={isControlled ? "contents" : "relative"}>
      {/* Internal trigger — only when uncontrolled. In controlled mode the
          caller renders its own trigger (e.g. inside the search bar). */}
      {!isControlled && (
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close filters" : "Open filters"}
          aria-expanded={open}
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-all border shadow-sm",
            open || activeCount > 0
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-background/95 backdrop-blur-sm border-border/60 text-foreground hover:bg-muted"
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          Filters
          {activeCount > 0 && (
            <span className="bg-primary-foreground/20 text-primary-foreground rounded-full px-1.5 py-0.5 text-[10px] font-bold min-w-[18px] text-center">
              {activeCount}
            </span>
          )}
        </button>
      )}

      {/* Panel */}
      {open && (
        <div className="absolute top-full left-0 right-0 mt-2 z-30 w-full sm:w-80 sm:right-auto bg-background border rounded-2xl shadow-2xl overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Filters</span>
              {meta && (
                <span className="text-xs text-muted-foreground">
                  {totalShowing.toLocaleString()} of {meta.totalCount.toLocaleString()}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {activeCount > 0 && (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground" onClick={reset}>
                  Reset
                </Button>
              )}
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)} aria-label="Close filters">
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="overflow-y-auto max-h-[70vh]">
            {/* Domain → Facility Type hierarchy */}
            <FilterSection icon={Building2} title="Facility Type">
              {/* Domain radio group */}
              <fieldset>
                <legend className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                  Domain
                </legend>
                <div className="space-y-0.5 mb-2">
                  <DomainRadio
                    label="All domains"
                    active={!filters.facilityGroup}
                    onClick={() => update({ facilityGroup: "", facilityType: "", quickFilter: "" })}
                  />
                  {DOMAINS.map((d) => {
                    const palette = DOMAIN_PALETTE[d];
                    const count = meta?.countByGroup?.[d];
                    return (
                      <DomainRadio
                        key={d}
                        label={d}
                        active={filters.facilityGroup === d}
                        dotClass={palette.dot}
                        textClass={cn(palette.text, palette.textDark)}
                        activeBgClass={palette.bg}
                        activeBorderClass={palette.activeBorder}
                        count={count}
                        onClick={() => update({
                          facilityGroup: filters.facilityGroup === d ? "" : d,
                          facilityType: "",
                          quickFilter: "",
                        })}
                      />
                    );
                  })}
                </div>
              </fieldset>

              {/* Type checklist (only when a domain is selected) */}
              {typesByGroup && typesByGroup.length > 0 && (
                <fieldset className="mt-2 pt-2 border-t">
                  <legend className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    Type ({filters.facilityGroup})
                  </legend>
                  <div className="space-y-2">
                    {typesByGroup.map(({ group, entries }) => (
                      <div key={group}>
                        <div className="text-[10px] font-medium text-muted-foreground/80 uppercase mb-0.5 px-1">
                          {group}
                        </div>
                        <div className="space-y-0.5">
                          {entries.map((entry) => {
                            const active = filters.facilityType === entry.officialLabel;
                            const count = meta?.countByType?.[entry.officialLabel];
                            return (
                              <TypeCheckbox
                                key={entry.code}
                                entry={entry}
                                active={active}
                                count={count}
                                onClick={() => update({
                                  facilityType: active ? "" : entry.officialLabel,
                                  quickFilter: "",
                                })}
                              />
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </fieldset>
              )}
            </FilterSection>

            {/* County */}
            <FilterSection icon={MapPin} title="County">
              <Input
                value={countySearch}
                onChange={(e) => setCountySearch(e.target.value)}
                placeholder="Search counties…"
                className="h-7 text-xs mb-2"
                aria-label="Search counties"
              />
              <div className="max-h-36 overflow-y-auto space-y-0.5 pr-1">
                {filteredCounties.map((c) => (
                  <button
                    key={c}
                    onClick={() => update({ county: filters.county === c ? "" : c })}
                    className={cn(
                      "w-full text-left flex items-center justify-between px-2.5 py-1 rounded-lg text-xs transition-all",
                      filters.county === c
                        ? "bg-primary/10 text-primary font-medium"
                        : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                    )}
                  >
                    {c}
                    {meta?.countByCounty[c] && (
                      <span className="opacity-60">{meta.countByCounty[c].toLocaleString()}</span>
                    )}
                  </button>
                ))}
              </div>
            </FilterSection>

            {/* Status */}
            <FilterSection icon={Activity} title="License Status">
              <div className="space-y-0.5 pr-1">
                {Object.entries(STATUS_CONFIG).map(([key, { label }]) => {
                  const active = filters.statuses.has(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleStatus(key)}
                      aria-pressed={active}
                      className={cn(
                        "w-full text-left flex items-center justify-between px-2.5 py-1 rounded-lg text-xs transition-colors duration-150",
                        active
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </FilterSection>

            {/* Capacity */}
            <FilterSection icon={Users} title="Capacity (beds)">
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={0}
                  placeholder="Min"
                  aria-label="Minimum capacity"
                  value={filters.minCapacity ?? ""}
                  onChange={(e) => update({ minCapacity: e.target.value ? parseInt(e.target.value, 10) : null })}
                  className="h-8 text-xs"
                />
                <span className="text-muted-foreground text-xs">–</span>
                <Input
                  type="number"
                  min={0}
                  placeholder="Max"
                  aria-label="Maximum capacity"
                  value={filters.maxCapacity ?? ""}
                  onChange={(e) => update({ maxCapacity: e.target.value ? parseInt(e.target.value, 10) : null })}
                  className="h-8 text-xs"
                />
              </div>
              <div className="flex flex-wrap gap-1 mt-1.5">
                {[
                  { label: "≤6", min: null, max: 6 },
                  { label: "7–25", min: 7, max: 25 },
                  { label: "26–100", min: 26, max: 100 },
                  { label: "100+", min: 100, max: null },
                ].map(({ label, min, max }) => (
                  <button
                    key={label}
                    onClick={() => update({ minCapacity: min, maxCapacity: max })}
                    className={cn(
                      "px-2 py-0.5 rounded-full text-[11px] border transition-all",
                      filters.minCapacity === min && filters.maxCapacity === max
                        ? "bg-primary/10 border-primary/40 text-primary"
                        : "border-border text-muted-foreground hover:border-primary/30"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </FilterSection>

            {/* Hiring */}
            <FilterSection icon={Briefcase} title="Job Openings">
              <button
                onClick={() => update({ hiringOnly: !filters.hiringOnly })}
                aria-pressed={filters.hiringOnly}
                className={cn(
                  "flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-medium transition-all w-full",
                  filters.hiringOnly
                    ? "bg-blue-50 dark:bg-blue-950 border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300"
                    : "border-border text-muted-foreground hover:bg-muted/50"
                )}
              >
                <span className={cn(
                  "w-3.5 h-3.5 rounded border-2 flex items-center justify-center shrink-0 transition-all",
                  filters.hiringOnly ? "bg-blue-500 border-blue-500" : "border-muted-foreground/40"
                )}>
                  {filters.hiringOnly && <span className="block w-1.5 h-1.5 bg-white rounded-sm" />}
                </span>
                Currently Hiring Only
              </button>
            </FilterSection>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function FilterSection({
  icon: Icon,
  title,
  children,
}: {
  icon: any;
  title: string;
  children: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <div className="border-b last:border-0">
      <button
        className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-muted/30 transition-colors"
        onClick={() => setExpanded((e) => !e)}
        aria-expanded={expanded}
      >
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-xs font-semibold text-foreground">{title}</span>
        </div>
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />
        )}
      </button>
      {expanded && <div className="px-4 pb-3">{children}</div>}
    </div>
  );
}

function DomainRadio({
  label,
  active,
  onClick,
  count,
  dotClass,
  textClass,
  activeBgClass,
  activeBorderClass,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
  dotClass?: string;
  textClass?: string;
  /** Domain-tinted background applied when active (e.g. bg-teal-50). */
  activeBgClass?: string;
  /** Domain-tinted border for the active radio dot (e.g. border-teal-500). */
  activeBorderClass?: string;
}) {
  return (
    <button
      role="radio"
      aria-checked={active}
      onClick={onClick}
      className={cn(
        "w-full flex items-center justify-between px-2 py-1.5 rounded-lg text-xs transition-colors duration-150",
        active
          ? cn("font-semibold", activeBgClass ?? "bg-primary/10", textClass ?? "text-primary")
          : "text-foreground/80 hover:bg-muted/60 hover:text-foreground"
      )}
    >
      <span className="flex items-center gap-2">
        <span
          className={cn(
            "w-3.5 h-3.5 rounded-full border-2 flex items-center justify-center shrink-0 transition-colors",
            active ? (activeBorderClass ?? "border-primary") : "border-muted-foreground/40"
          )}
        >
          {active && <span className={cn("w-1.5 h-1.5 rounded-full", dotClass ?? "bg-primary")} />}
        </span>
        {dotClass && !active && <span className={cn("w-2 h-2 rounded-full shrink-0", dotClass)} />}
        <span className={cn(!active && textClass)}>{label}</span>
      </span>
      {count != null && count > 0 && (
        <span className="text-[10px] opacity-60 tabular-nums">
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

function TypeCheckbox({
  entry,
  active,
  count,
  onClick,
}: {
  entry: TaxonomyEntry;
  active: boolean;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      role="checkbox"
      aria-checked={active}
      title={entry.officialLabel}
      className={cn(
        "w-full flex items-center justify-between px-2 py-1 rounded-lg text-xs transition-all",
        active
          ? "bg-primary/10 text-primary font-medium"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
      )}
    >
      <span className="flex items-center gap-2 min-w-0">
        <span
          className={cn(
            "w-3 h-3 rounded-sm border flex items-center justify-center shrink-0 transition-all",
            active ? "bg-primary border-primary" : "border-muted-foreground/40"
          )}
        >
          {active && <span className="block w-1 h-1 bg-primary-foreground rounded-[1px]" />}
        </span>
        <span className="truncate">{entry.displayLabel}</span>
        <span className="text-[10px] opacity-60 shrink-0">({entry.acronym})</span>
      </span>
      {count != null && count > 0 && (
        <span className="text-[10px] opacity-60 shrink-0 ml-1 tabular-nums">
          {count.toLocaleString()}
        </span>
      )}
    </button>
  );
}

// ── QuickFilterBar ────────────────────────────────────────────────────────────

export function QuickFilterBar({
  filters,
  meta,
  onChange,
}: {
  filters: FacilityFilters;
  meta: FacilitiesMeta | undefined;
  onChange: (f: FacilityFilters) => void;
}) {
  const handleQuickFilter = (id: QuickFilterId) => {
    if (filters.quickFilter === id) {
      // Deselect — clear everything this chip synced
      onChange({ ...filters, quickFilter: "", facilityGroup: "", facilityType: "" });
      return;
    }
    const chip = QUICK_FILTER_CHIPS.find((q) => q.id === id);
    if (!chip) return;
    const entry = getByCode(chip.code);
    if (!entry) {
      // Taxonomy out of sync — fall back to id-only update
      onChange({ ...filters, quickFilter: id });
      return;
    }
    onChange({
      ...filters,
      quickFilter: id,
      facilityGroup: entry.domain,
      facilityType: entry.officialLabel,
    });
  };

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1">
      {QUICK_FILTER_CHIPS.map((chip) => {
        const isActive = filters.quickFilter === chip.id;
        const entry = getByCode(chip.code);
        const count = entry ? meta?.countByType?.[entry.officialLabel] : undefined;

        return (
          <button
            key={chip.id}
            onClick={() => handleQuickFilter(chip.id)}
            aria-pressed={isActive}
            className={cn(
              "flex-shrink-0 flex flex-col items-center px-3 py-1.5 rounded-full border text-xs font-semibold transition-all",
              isActive ? chip.colorActive : chip.colorBorder + " bg-background"
            )}
          >
            <span>{chip.label}</span>
            <span className={cn("text-[10px] font-normal", isActive ? "opacity-80" : "opacity-60")}>
              {chip.description}
              {count ? ` · ${count.toLocaleString()}` : ""}
            </span>
          </button>
        );
      })}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Resolve a stored `facility_type` string to a taxonomy entry. The DB now
 * stores the canonical official label, so `normalizeRawType` (which checks
 * both raw CCL strings and official labels) is the right helper.
 *
 * Exposed so other components can keep label/acronym rendering consistent.
 */
export function lookupFacilityType(facilityType: string | null | undefined) {
  return normalizeRawType(facilityType);
}
