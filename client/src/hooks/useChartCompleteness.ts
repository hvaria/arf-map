/**
 * useChartCompletenessForFacility — Wave 2 W8.
 *
 * Single query that aggregates chart completeness for every active resident
 * in a facility, then exposes a `byResidentId` lookup map for list rows.
 *
 * Endpoint:
 *   GET /api/ops/facilities/:fn/chart-completeness?limit=100
 *   → { success, data: { rows: ChartCompletenessPayload[], total, complete } }
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - useQuery + getQueryFn + on401 returnNull + URL-shaped key:
 *       client/src/hooks/useResidents.ts:43-53
 *   - 60s staleTime on aggregated reads:
 *       client/src/components/operations/AuditReadinessContent.tsx:144-147
 */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { ChartCompletenessPayload } from "@/components/operations/ChartCompletenessBanner";

export interface ChartCompletenessListEnvelope {
  success: boolean;
  data: {
    rows: ChartCompletenessPayload[];
    total: number;
    complete: number;
  };
}

export function useChartCompletenessForFacility(
  facilityNumber: string,
  opts: { limit?: number; enabled?: boolean } = {},
) {
  const { limit = 100, enabled = true } = opts;
  const queryKey = [
    `/api/ops/facilities/${facilityNumber}/chart-completeness?limit=${limit}`,
  ] as const;

  const query = useQuery<ChartCompletenessListEnvelope | null>({
    queryKey,
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: enabled && !!facilityNumber,
    staleTime: 60_000,
  });

  const byResidentId = useMemo(() => {
    const map = new Map<number, ChartCompletenessPayload>();
    for (const r of query.data?.data?.rows ?? []) {
      map.set(r.residentId, r);
    }
    return map;
  }, [query.data]);

  return {
    ...query,
    byResidentId,
    rows: query.data?.data?.rows ?? [],
    total: query.data?.data?.total ?? 0,
    complete: query.data?.data?.complete ?? 0,
  };
}

/**
 * useChartCompletenessForResident — single-resident detail, used by the
 * resident profile drill-in panel.
 */
export function useChartCompletenessForResident(
  residentId: number | string | null | undefined,
  opts: { enabled?: boolean } = {},
) {
  const { enabled = true } = opts;
  const queryKey = [
    `/api/ops/residents/${residentId}/chart-completeness`,
  ] as const;

  return useQuery<{ success: boolean; data: ChartCompletenessPayload } | null>({
    queryKey,
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: enabled && !!residentId,
    staleTime: 60_000,
  });
}
