import { useMemo } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import type { FacilityPin } from "@shared/schema";
import type { FacilityFilters } from "@/components/FilterPanel";

/**
 * Same grid snap + bbox-string helpers as useFacilities — kept local so the
 * two hooks can evolve independently.
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
  radiusMiles: number;
}

export interface BBox {
  minLat: number;
  minLng: number;
  maxLat: number;
  maxLng: number;
}

function bboxStringFromArea(area: NearbyArea): string {
  const dLat = area.radiusMiles / 69;
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

function hasActiveFilter(f?: FacilityFilters): boolean {
  if (!f) return false;
  return Boolean(
    f.search?.trim() ||
    f.county ||
    f.facilityGroup ||
    f.facilityType ||
    (f.statuses && f.statuses.size > 0) ||
    f.hiringOnly ||
    f.minCapacity != null ||
    f.maxCapacity != null,
  );
}

/**
 * Slim facilities feed for the map. Returns only the columns the cluster,
 * pin, hover tooltip and JobsPanel actually read — about a quarter the wire
 * size of useFacilities.
 *
 * Query is gated: it does NOT fire until at least one of bbox / nearby /
 * search / filters is set. The cold-start MapPage mount used to issue a
 * statewide unbounded request; now it waits for the map to report its
 * viewport (or for geolocation / search / a filter to engage).
 */
export function useFacilityPins(
  filters?: FacilityFilters,
  nearby?: NearbyArea | null,
  bbox?: BBox | null,
) {
  const filterActive = hasActiveFilter(filters);
  const searchActive = !!filters?.search?.trim();

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
    if (!searchActive) {
      if (bbox) p.set("bbox", bboxString(snapBboxToGrid(bbox)));
      else if (nearby) p.set("bbox", bboxStringFromArea(nearby));
    }
    return p.toString();
  }, [filters, nearby, bbox, searchActive]);

  const enabled = !!(bbox || nearby || searchActive || filterActive);

  const queryKey = params ? [`/api/facilities/pins`, params] : [`/api/facilities/pins`];
  const url = params ? `/api/facilities/pins?${params}` : `/api/facilities/pins`;

  const query = useQuery<FacilityPin[]>({
    queryKey,
    queryFn: () => fetch(url).then((r) => r.json()),
    enabled,
    staleTime: 60 * 60 * 1000,
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: 2,
    placeholderData: keepPreviousData,
  });

  const pins = query.data ?? [];

  const pinByNumber = useMemo(
    () => new Map(pins.map((p) => [p.number, p])),
    [pins],
  );

  return {
    pins,
    pinByNumber,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isError: query.isError,
  };
}
