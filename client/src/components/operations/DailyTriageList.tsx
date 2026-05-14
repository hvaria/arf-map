/**
 * DailyTriageList — Wave 3 W1.
 *
 * Live daily-triage drill-down list that lives below the existing 8 KPI
 * tiles on the Audit Readiness → Overview tab (replacing the Wave 1
 * placeholder welcome card). Reads `GET /api/ops/facilities/:fn/triage`
 * and groups the BE-prelisted items by section with severity chips +
 * deep-link buttons.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Page-section subheading style:                 RegSettingsContent.tsx:417
 *   - Section card / item-row layout:                RegSettingsContent.tsx:287-401
 *   - Status badge tone palette (red/amber/slate):   EmarContent.tsx:55-62
 *   - Loading skeleton row pattern:                  ComplianceContent.tsx:311-313
 *                                                    RegSettingsContent.tsx:540-547
 *   - Error banner (destructive/10 + AlertTriangle): ComplianceContent.tsx:305-307
 *                                                    RegSettingsContent.tsx:528-535
 *   - Empty state (emerald success card):            RegSettingsContent.tsx:518-526
 *   - shadcn <Select> for filter/sort dropdowns:     AuditTrailViewer.tsx:332-349
 *   - useQuery + getQueryFn returnNull + URL key:    AuditReadinessContent.tsx:155-160
 *   - TriagePayload / TriageItem / section labels:   shared/triage.ts
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  RefreshCw,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TRIAGE_SECTIONS,
  TRIAGE_SECTION_LABELS,
  compareTriageItems,
  type TriageItem,
  type TriagePayload,
  type TriageSection,
  type TriageSeverity,
} from "@shared/triage";

interface Props {
  facilityNumber: string;
  /** Open the Reg Settings ⚙ tab so the user can edit W14 preferences. */
  onOpenSettings: () => void;
  /**
   * Deep-link a triage row into the matching Audit Readiness sub-tab.
   * Implemented in the parent via `setTab(...)` — we keep this loose
   * so the row click degrades gracefully when no clean cross-sub-view
   * primitive exists yet (see OperationsTab.tsx:1272 `goToSubView` for
   * the cross-Operations target — this prop wraps the within-Audit-
   * Readiness equivalent).
   */
  onOpenDeepLink?: (item: TriageItem) => void;
}

type SortMode = "severity" | "age";
type FilterValue = "all" | TriageSection;

const SEVERITY_CHIP: Record<
  TriageSeverity,
  { label: string; cls: string }
> = {
  high: {
    label: "high",
    cls: "bg-red-100 text-red-700 border-red-200",
  },
  medium: {
    label: "medium",
    cls: "bg-amber-100 text-amber-700 border-amber-200",
  },
  low: {
    label: "low",
    cls: "bg-slate-100 text-slate-700 border-slate-200",
  },
};

/**
 * "Updated 12s ago" rendering — minimal hand-roll so we don't introduce a
 * new date helper. Mirrors what date-fns' formatDistanceToNow produces for
 * the small-window cases that matter for a 30s-stale query.
 */
function formatRelativeAge(generatedAt: number, nowMs = Date.now()): string {
  const deltaSec = Math.max(0, Math.floor((nowMs - generatedAt) / 1000));
  if (deltaSec < 5) return "just now";
  if (deltaSec < 60) return `${deltaSec}s ago`;
  const min = Math.floor(deltaSec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

function AgeBadge({ ageDays }: { ageDays?: number }) {
  if (ageDays === undefined || ageDays === null) return null;
  if (ageDays >= 0) {
    return (
      <span className="text-[11px] text-muted-foreground">
        {ageDays}d overdue
      </span>
    );
  }
  return (
    <span className="text-[11px] text-muted-foreground">
      due in {Math.abs(ageDays)}d
    </span>
  );
}

function TriageRow({
  item,
  onOpen,
}: {
  item: TriageItem;
  onOpen?: (item: TriageItem) => void;
}) {
  const chip = SEVERITY_CHIP[item.severity];
  return (
    <div
      className="rounded-md border bg-white p-3 flex items-start justify-between gap-3"
      data-testid={`triage-row-${item.itemKey}`}
    >
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border uppercase",
              chip.cls,
            )}
            aria-label={`severity ${chip.label}`}
          >
            {chip.label}
          </span>
          <span className="text-sm font-medium text-gray-800 truncate">
            {item.subject}
          </span>
        </div>
        <div className="flex items-center gap-2 flex-wrap text-[12px] text-muted-foreground">
          <span>{item.action}</span>
          <AgeBadge ageDays={item.ageDays} />
          {item.ownerLabel && (
            <span className="text-[11px]">owner: {item.ownerLabel}</span>
          )}
        </div>
      </div>
      <button
        type="button"
        onClick={() => onOpen?.(item)}
        className="inline-flex items-center gap-1 text-xs text-primary hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded px-1.5 py-1 shrink-0"
        aria-label={`Open ${item.subject}`}
        data-testid={`triage-row-open-${item.itemKey}`}
      >
        Open
        <ChevronRight className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}

export function DailyTriageList({
  facilityNumber,
  onOpenSettings,
  onOpenDeepLink,
}: Props) {
  const [sort, setSort] = useState<SortMode>("severity");
  const [filter, setFilter] = useState<FilterValue>("all");

  const queryKey = [
    `/api/ops/facilities/${facilityNumber}/triage?perSectionLimit=10`,
  ] as const;

  const { data, isLoading, error, refetch, isFetching } = useQuery<{
    success: boolean;
    data: TriagePayload;
  } | null>({
    queryKey,
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const payload = data?.data;
  const rawItems = payload?.items ?? [];

  // Client-side filter + sort. BE already pre-sorts severity-first; we
  // re-apply locally so the dropdown is responsive without a refetch.
  const visibleItems = useMemo(() => {
    const filtered = filter === "all"
      ? rawItems
      : rawItems.filter((i) => i.section === filter);
    const sorted = [...filtered].sort((a, b) => {
      if (sort === "severity") return compareTriageItems(a, b);
      // age desc — undefined ages sink
      const aAge = a.ageDays ?? Number.NEGATIVE_INFINITY;
      const bAge = b.ageDays ?? Number.NEGATIVE_INFINITY;
      if (aAge !== bAge) return bAge - aAge;
      return compareTriageItems(a, b);
    });
    return sorted;
  }, [rawItems, filter, sort]);

  // Visual grouping by section (using either BE order or our sorted order
  // — both keep section locality because severity buckets line up).
  const grouped = useMemo(() => {
    const map = new Map<TriageSection, TriageItem[]>();
    for (const item of visibleItems) {
      const arr = map.get(item.section) ?? [];
      arr.push(item);
      map.set(item.section, arr);
    }
    return Array.from(map.entries());
  }, [visibleItems]);

  const totalVisible = visibleItems.length;

  return (
    <section
      className="space-y-3"
      aria-label="Today's triage"
      data-testid="daily-triage-list"
    >
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h2 className="text-sm font-medium text-muted-foreground">
            Today's triage
            {!isLoading && !error && (
              <span className="ml-1.5 text-xs text-muted-foreground">
                · {payload?.totalItems ?? 0} items
              </span>
            )}
          </h2>
          {payload?.generatedAt && (
            <span
              className="text-[11px] text-muted-foreground"
              data-testid="triage-generated-at"
            >
              Updated {formatRelativeAge(payload.generatedAt)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-stone-50 transition-colors disabled:opacity-50"
            disabled={isFetching}
            aria-label="Refresh triage"
            data-testid="triage-refresh"
          >
            <RefreshCw
              className={cn("h-3 w-3", isFetching && "animate-spin")}
              aria-hidden
            />
            Refresh
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded border bg-white hover:bg-stone-50 transition-colors"
            aria-label="Open Reg Settings"
            data-testid="triage-open-settings"
          >
            <Settings className="h-3 w-3" aria-hidden />
            Settings
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Sort</span>
          <Select
            value={sort}
            onValueChange={(v) => setSort(v as SortMode)}
          >
            <SelectTrigger
              className="h-8 w-[180px] text-xs"
              aria-label="Sort triage"
              data-testid="triage-sort"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="severity">Severity desc</SelectItem>
              <SelectItem value="age">Age desc</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span>Filter</span>
          <Select
            value={filter}
            onValueChange={(v) => setFilter(v as FilterValue)}
          >
            <SelectTrigger
              className="h-8 w-[240px] text-xs"
              aria-label="Filter triage by section"
              data-testid="triage-filter"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All sections</SelectItem>
              {TRIAGE_SECTIONS.map((s) => (
                <SelectItem key={s} value={s}>
                  {TRIAGE_SECTION_LABELS[s]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {error && (
        <div
          className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive flex items-center gap-2"
          role="alert"
          data-testid="triage-error"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
          Couldn't load today's triage.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2" data-testid="triage-loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-md" />
          ))}
        </div>
      ) : !error && totalVisible === 0 ? (
        <div
          className="rounded-md bg-emerald-50 border border-emerald-200 p-4 text-sm text-emerald-800 flex items-center gap-2"
          data-testid="triage-empty"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
          Nothing needs attention right now.
        </div>
      ) : (
        <div className="space-y-4">
          {grouped.map(([section, items]) => (
            <div key={section} className="space-y-2">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {TRIAGE_SECTION_LABELS[section]}
                <span className="ml-1.5 text-[10px] font-normal opacity-70">
                  ({items.length})
                </span>
              </h3>
              <div className="space-y-2">
                {items.map((item) => (
                  <TriageRow
                    key={item.itemKey}
                    item={item}
                    onOpen={onOpenDeepLink}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
