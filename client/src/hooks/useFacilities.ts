import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Facility } from "@shared/schema";
import type { FacilityFilters } from "@/components/FilterPanel";

/**
 * Single source of truth for facility data.
 * React Query deduplicates the fetch — only ONE network request is made
 * regardless of how many components call this hook simultaneously.
 *
 * Pass filters to apply server-side filtering (county, type, status, etc.)
 * When no filters are passed, returns all facilities (backward compat).
 */
export function useFacilities(filters?: FacilityFilters) {
  // Build query params from filters
  const params = useMemo(() => {
    if (!filters) return "";
    const p = new URLSearchParams();
    if (filters.search) p.set("search", filters.search);
    if (filters.county) p.set("county", filters.county);
    if (filters.facilityGroup) p.set("facilityGroup", filters.facilityGroup);
    if (filters.facilityType) p.set("facilityType", filters.facilityType);
    if (filters.statuses.size > 0) p.set("status", Array.from(filters.statuses).join(","));
    if (filters.hiringOnly) p.set("isHiring", "true");
    if (filters.minCapacity != null) p.set("minCapacity", String(filters.minCapacity));
    if (filters.maxCapacity != null) p.set("maxCapacity", String(filters.maxCapacity));
    return p.toString();
  }, [filters]);

  const queryKey = params ? [`/api/facilities`, params] : [`/api/facilities`];
  const url = params ? `/api/facilities?${params}` : `/api/facilities`;

  const query = useQuery<Facility[]>({
    queryKey,
    queryFn: () => fetch(url).then((r) => r.json()),
    staleTime: 60 * 60 * 1000,       // 1 hour client-side (server caches 24 h)
    gcTime: 2 * 60 * 60 * 1000,      // keep in memory 2 h after last use
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 2,
  });

  const facilities = query.data ?? [];

  const facilityByNumber = useMemo(
    () => new Map(facilities.map((f) => [f.number, f])),
    [facilities],
  );

  return {
    facilities,
    facilityByNumber,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
