/**
 * Tracker alerts query — list & summary.
 *
 * Backend contract (already shipped):
 *   GET /api/ops/trackers/alerts?severity=&slug=&residentId=&status=&limit=&cursor=
 *     → { success, data: { items: AlertRow[], nextCursor? } }
 *   GET /api/ops/trackers/alerts/summary
 *     → { success, data: { active, critical, warn, info } }
 *
 * The list query defaults to `status=active`. We use `apiRequest("GET", ...)`
 * to stay consistent with `useTrackerEntries`. Cache keys are stable & nested
 * so prefix-invalidation hits every filter variant.
 */
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { AlertSeverity } from "@shared/tracker-schemas";

export type AlertStatus = "active" | "acknowledged" | "resolved";

export interface AlertRow {
  id: number;
  facilityNumber: string;
  trackerSlug: string;
  ruleId: string;
  severity: AlertSeverity;
  residentId: number | null;
  sourceEntryId: number;
  shift: string | null;
  message: string;
  detail: string | null;
  status: AlertStatus;
  acknowledgedByFacilityAccountId: number | null;
  acknowledgedByStaffId: number | null;
  acknowledgedAt: number | null;
  acknowledgedNote: string | null;
  resolvedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface AlertsListPage {
  items: AlertRow[];
  nextCursor?: { createdAt: number; id: number };
}

export interface AlertsListEnvelope {
  success: boolean;
  data: AlertsListPage;
}

export interface AlertSummary {
  active: number;
  critical: number;
  warn: number;
  info: number;
}

export interface AlertSummaryEnvelope {
  success: boolean;
  data: AlertSummary;
}

export interface TrackerAlertsFilters {
  severity?: AlertSeverity;
  slug?: string;
  residentId?: number;
  /** Defaults to "active" when omitted (matches backend). */
  status?: AlertStatus;
  /** Optional page size; backend default is 50. */
  limit?: number;
  enabled?: boolean;
}

function buildPath(filters: TrackerAlertsFilters): string {
  const params = new URLSearchParams();
  // Default to active when caller didn't pin a status — keeps the resolved
  // / acknowledged ones out of the default card.
  const status = filters.status ?? "active";
  params.set("status", status);
  if (filters.severity !== undefined) params.set("severity", filters.severity);
  if (filters.slug !== undefined) params.set("slug", filters.slug);
  if (filters.residentId !== undefined)
    params.set("residentId", String(filters.residentId));
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return `/api/ops/trackers/alerts${qs ? `?${qs}` : ""}`;
}

/**
 * Fetch the active (or filtered) tracker alerts list. The OperationsTab card
 * uses the default (`status=active`); per-tracker badges pass `slug`.
 */
export function useTrackerAlerts(
  filters: TrackerAlertsFilters = {},
  options?: Omit<
    UseQueryOptions<AlertsListEnvelope>,
    "queryKey" | "queryFn"
  >,
) {
  const { enabled = true, ...rest } = filters;
  return useQuery<AlertsListEnvelope>({
    // Stable, structured key. Prefix `["/api/ops/trackers/alerts"]` invalidates
    // every variant after a mutation.
    queryKey: ["/api/ops/trackers/alerts", rest],
    enabled,
    queryFn: async () => {
      const res = await apiRequest("GET", buildPath(filters));
      return (await res.json()) as AlertsListEnvelope;
    },
    staleTime: 30_000,
    ...options,
  });
}
