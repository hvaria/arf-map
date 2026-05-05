import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { Facility } from "@shared/schema";
import type { FacilityFilters } from "@/components/FilterPanel";

/**
 * Snap a bbox outward to a coarse lat/lng grid. Two viewports that differ by
 * less than the grid size collapse to the same snapped bbox, so React Query
 * reuses the same cache entry — panning within ~70 mi triggers no network.
 *
 * Default grid: 1° (~69 mi N/S, ~55 mi E/W in California).
 */
function snapBboxToGrid(b: BBox, gridDeg = 1): BBox {
  return {
    minLat: Math.floor(b.minLat / gridDeg) * gridDeg,
    maxLat: Math.ceil(b.maxLat / gridDeg) * gridDeg,
    minLng: Math.floor(b.minLng / gridDeg) * gridDeg,
    maxLng: Math.ceil(b.maxLng / gridDeg) * gridDeg,
  };
}

export interface NearbyArea {
  lat: number;
  lng: number;
  /** Radius in miles. Used to derive the lat/lng bbox sent to the API. */
  radiusMiles: number;
}

export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

/** Convert a point + radius into a bbox string the API understands. */
function bboxStringFromArea(area: NearbyArea): string {
  const dLat = area.radiusMiles / 69; // ~69 mi per degree of latitude
  const dLng = area.radiusMiles / (69 * Math.cos((area.lat * Math.PI) / 180));
  return bboxString({
    minLat: area.lat - dLat,
    maxLat: area.lat + dLat,
    minLng: area.lng - dLng,
    maxLng: area.lng + dLng,
  });
}

function bboxString(b: BBox): string {
  return [b.minLat, b.minLng, b.maxLat, b.maxLng].map((n) => n.toFixed(5)).join(",");
}

/**
 * Single source of truth for facility data.
 * React Query deduplicates the fetch — only ONE network request is made
 * regardless of how many components call this hook simultaneously.
 *
 * Pass `filters` to apply server-side filtering (county, type, status, etc.)
 * Pass `bbox` to bound the result to an arbitrary lat/lng box (e.g. the
 * current map viewport). Falls back to `nearby` (a point + radius) when no
 * explicit bbox is provided. Both are suppressed automatically when a search
 * query is active so name/license-# searches still match statewide.
 * When none of bbox/nearby/filters is set, returns the whole dataset.
 */
export function useFacilities(
  filters?: FacilityFilters,
  nearby?: NearbyArea | null,
  bbox?: BBox | null,
) {
  const params = useMemo(() => {
    const p = new URLSearchParams();
    if (filters) {
      if (filters.search) p.set("search", filters.search);
      if (filters.county) p.set("county", filters.county);
      if (filters.facilityGroup) p.set("facilityGroup", filters.facilityGroup);
      if (filters.facilityType) p.set("facilityType", filters.facilityType);
      if (filters.statuses.size > 0) p.set("status", Array.from(filters.statuses).join(","));
      if (filters.hiringOnly) p.set("isHiring", "true");
      if (filters.minCapacity != null) p.set("minCapacity", String(filters.minCapacity));
      if (filters.maxCapacity != null) p.set("maxCapacity", String(filters.maxCapacity));
    }
    const searchActive = !!filters?.search?.trim();
    if (!searchActive) {
      if (bbox) p.set("bbox", bboxString(snapBboxToGrid(bbox)));
      else if (nearby) p.set("bbox", bboxStringFromArea(nearby));
    }
    return p.toString();
  }, [filters, nearby, bbox]);

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
    // Show the previous result while a new bbox is loading instead of going
    // blank. Critical for pan/zoom — the map keeps its pins until the new
    // data arrives.
    placeholderData: keepPreviousData,
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
