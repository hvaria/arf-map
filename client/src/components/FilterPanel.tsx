import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  SlidersHorizontal, X, ChevronDown, ChevronRight,
  Building2, MapPin, Activity, Users, Briefcase, Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { FacilitiesMeta } from "@shared/schema";

// ── Types ──────────────────────────────────────────────────────────────────────

export type QuickFilterId = "ARF" | "RCFE" | "DAYCARE" | "GROUP_HOME" | "";

export interface FacilityFilters {
  search: string;
  county: string;
  facilityGroup: string;
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

// ── Quick filters ─────────────────────────────────────────────────────────────

// Colors are spelled out fully as string literals so Tailwind JIT detects them.
const QUICK_FILTERS: Array<{
  id: QuickFilterId;
  label: string;
  description: string;
  group: string;
  type: string; // exact facility_type value, or "" for group-only (Daycare)
  colorActive: string;
  colorBorder: string;
}> = [
  {
    id: "ARF",
    label: "ARF",
    description: "Adult Residential",
    group: "Adult & Senior Care",
    type: "Adult Residential Facility",
    colorActive: "bg-teal-600 text-white border-teal-600",
    colorBorder: "border-teal-400 text-teal-700 dark:text-teal-400",
  },
  {
    id: "RCFE",
    label: "RCFE",
    description: "Senior Care",
    group: "Adult & Senior Care",
    type: "Residential Care Facility for the Elderly",
    colorActive: "bg-blue-600 text-white border-blue-600",
    colorBorder: "border-blue-400 text-blue-700 dark:text-blue-400",
  },
  {
    id: "DAYCARE",
    label: "Daycare",
    description: "Child Day Care",
    group: "Child Care",
    type: "", // group-only — no facilityType filter
    colorActive: "bg-green-600 text-white border-green-600",
    colorBorder: "border-green-400 text-green-700 dark:text-green-400",
  },
  {
    id: "GROUP_HOME",
    label: "Group Home",
    description: "Children's Residential",
    group: "Children's Residential",
    type: "Group Home",
    colorActive: "bg-purple-600 text-white border-purple-600",
    colorBorder: "border-purple-400 text-purple-700 dark:text-purple-400",
  },
];

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  LICENSED: { label: "Licensed", color: "bg-green-500" },
  PENDING: { label: "Pending", color: "bg-amber-500" },
  "ON PROBATION": { label: "Probation", color: "bg-purple-500" },
  CLOSED: { label: "Closed", color: "bg-red-500" },
  REVOKED: { label: "Revoked", color: "bg-red-800" },
};

// ── Group colors ──────────────────────────────────────────────────────────────

const GROUP_COLORS: Record<string, string> = {
  "Adult & Senior Care": "text-teal-600 dark:text-teal-400",
  "Child Care": "text-green-600 dark:text-green-400",
  "Children's Residential": "text-purple-600 dark:text-purple-400",
  "Home Care": "text-orange-600 dark:text-orange-400",
};

// ── Main component ────────────────────────────────────────────────────────────

interface FilterPanelProps {
  filters: FacilityFilters;
  onChange: (filters: FacilityFilters) => void;
  totalShowing: number;
}

export function FilterPanel({ filters, onChange, totalShowing }: FilterPanelProps) {
  const [open, setOpen] = useState(false);
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

  // Group types by their group for the collapsible tree.
  // Uses inferGroup() directly — avoids the find()+fallback bug where every type
  // could match "Adult & Senior Care" before specific groups are checked.
  const typesByGroup = useMemo(() => {
    if (!meta) return {};
    const map: Record<string, string[]> = {};
    for (const t of meta.facilityTypes) {
      const group = inferGroup(t);
      if (!map[group]) map[group] = [];
      map[group].push(t);
    }
    return map;
  }, [meta]);

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
    <div className="relative">
      {/* Toggle button */}
      <button
        onClick={() => setOpen((o) => !o)}
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

      {/* Panel */}
      {open && (
        <div className="absolute top-full left-0 mt-2 z-30 w-80 bg-background border rounded-2xl shadow-2xl overflow-hidden">
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
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
                <X className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="overflow-y-auto max-h-[70vh]">
            {/* Search */}
            <FilterSection icon={Search} title="Search">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  value={filters.search}
                  onChange={(e) => update({ search: e.target.value })}
                  placeholder="Name, city, license #, licensee…"
                  className="pl-8 h-8 text-xs"
                />
                {filters.search && (
                  <button
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    onClick={() => update({ search: "" })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </div>
            </FilterSection>

            {/* Quick Filters — rendered above the Facility Group & Type section */}
            <div className="px-4 py-3 border-b">
              <QuickFilterBar filters={filters} meta={meta} onChange={onChange} />
            </div>

            {/* Facility Group & Type */}
            <FilterSection icon={Building2} title="Facility Type">
              {/* Group pills — clearing quickFilter on manual selection */}
              <div className="flex flex-wrap gap-1 mb-2">
                <Pill
                  active={!filters.facilityGroup}
                  onClick={() => update({ facilityGroup: "", facilityType: "", quickFilter: "" })}
                >
                  All Groups
                </Pill>
                {(meta?.facilityGroups ?? []).map((g) => (
                  <Pill
                    key={g}
                    active={filters.facilityGroup === g}
                    onClick={() => update({
                      facilityGroup: filters.facilityGroup === g ? "" : g,
                      facilityType: "",
                      quickFilter: "",
                    })}
                    className={GROUP_COLORS[g]}
                  >
                    {g}
                    {meta?.countByGroup[g] && (
                      <span className="opacity-60 ml-0.5">({meta.countByGroup[g].toLocaleString()})</span>
                    )}
                  </Pill>
                ))}
              </div>

              {/* Individual types (when group selected) */}
              {filters.facilityGroup && typesByGroup[filters.facilityGroup] && (
                <div className="space-y-0.5 mt-1">
                  <Pill
                    active={!filters.facilityType}
                    onClick={() => update({ facilityType: "", quickFilter: "" })}
                    className="mb-1"
                  >
                    All in {filters.facilityGroup}
                  </Pill>
                  {typesByGroup[filters.facilityGroup].map((t) => (
                    <button
                      key={t}
                      onClick={() => update({
                        facilityType: filters.facilityType === t ? "" : t,
                        quickFilter: "",
                      })}
                      className={cn(
                        "w-full text-left flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs transition-all",
                        filters.facilityType === t
                          ? "bg-primary/10 text-primary font-medium"
                          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                      )}
                    >
                      <span className="flex items-center gap-1.5">
                        <ChevronRight className="h-3 w-3 opacity-40" />
                        {t}
                      </span>
                      {meta?.countByType[t] && (
                        <span className="text-[10px] opacity-60">{meta.countByType[t].toLocaleString()}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </FilterSection>

            {/* County */}
            <FilterSection icon={MapPin} title="County">
              <Input
                value={countySearch}
                onChange={(e) => setCountySearch(e.target.value)}
                placeholder="Search counties…"
                className="h-7 text-xs mb-2"
              />
              {filters.county && (
                <div className="flex items-center gap-1 mb-1.5">
                  <Badge variant="secondary" className="text-xs gap-1">
                    {filters.county}
                    <button onClick={() => update({ county: "" })}>
                      <X className="h-3 w-3" />
                    </button>
                  </Badge>
                </div>
              )}
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
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(STATUS_CONFIG).map(([key, { label, color }]) => {
                  const active = filters.statuses.has(key);
                  return (
                    <button
                      key={key}
                      onClick={() => toggleStatus(key)}
                      className={cn(
                        "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-all",
                        active
                          ? "bg-foreground/5 border-foreground/20 text-foreground"
                          : "border-transparent text-muted-foreground opacity-50 hover:opacity-75"
                      )}
                    >
                      <span className={cn("w-2 h-2 rounded-full shrink-0", color, !active && "opacity-40")} />
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
                  value={filters.minCapacity ?? ""}
                  onChange={(e) => update({ minCapacity: e.target.value ? parseInt(e.target.value, 10) : null })}
                  className="h-8 text-xs"
                />
                <span className="text-muted-foreground text-xs">–</span>
                <Input
                  type="number"
                  min={0}
                  placeholder="Max"
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

function Pill({
  active,
  onClick,
  children,
  className,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "px-2.5 py-1 rounded-full text-[11px] font-medium border transition-all",
        active
          ? "bg-primary text-primary-foreground border-primary"
          : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
        className
      )}
    >
      {children}
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
    const qf = QUICK_FILTERS.find((q) => q.id === id)!;
    onChange({
      ...filters,
      quickFilter: id,
      facilityGroup: qf.group,
      facilityType: qf.type, // "" for Daycare (group-only), specific string otherwise
    });
  };

  return (
    <div className="flex gap-2 overflow-x-auto scrollbar-hide pb-1 -mx-1 px-1">
      {QUICK_FILTERS.map((qf) => {
        const isActive = filters.quickFilter === qf.id;
        // type="" means Daycare → use group count; otherwise use per-type count
        const count = qf.type
          ? meta?.countByType?.[qf.type]
          : meta?.countByGroup?.[qf.group];

        return (
          <button
            key={qf.id}
            onClick={() => handleQuickFilter(qf.id)}
            className={cn(
              "flex-shrink-0 flex flex-col items-center px-3 py-1.5 rounded-full border text-xs font-semibold transition-all",
              isActive ? qf.colorActive : qf.colorBorder + " bg-background"
            )}
          >
            <span>{qf.label}</span>
            <span className={cn("text-[10px] font-normal", isActive ? "opacity-80" : "opacity-60")}>
              {qf.description}
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
 * Infer the facility group from a type name string.
 * Checks specific groups first; Adult & Senior Care is the catch-all last.
 * Mirrors server-side typeToGroup() in facilitiesService.ts.
 *
 * Previous implementation used find()+typeMatchesGroup() which had a bug:
 * if "Adult & Senior Care" appeared before "Child Care" in the groups array,
 * its `return true` catch-all would claim every type before Child Care could match.
 */
function inferGroup(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("child care") || t.includes("family child"))
    return "Child Care";
  if (
    t.includes("group home") ||
    t.includes("short-term") ||
    t.includes("community treatment") ||
    t.includes("foster family") ||
    t.includes("strtp") ||
    t.includes("enhanced behavioral")
  )
    return "Children's Residential";
  if (t.includes("home care"))
    return "Home Care";
  return "Adult & Senior Care"; // catch-all last
}
