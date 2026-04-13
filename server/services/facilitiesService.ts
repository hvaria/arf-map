/**
 * server/services/facilitiesService.ts
 *
 * Two modes:
 *  1. SQLite-first (when DB is seeded via `npx tsx scripts/seed-facilities-db.ts`):
 *     Routes query the `facilities` table directly for fast, filterable responses.
 *
 *  2. CHHS live-fetch fallback (cold start / un-seeded DB):
 *     Fetches ALL California care facility types from two CHHS open-data endpoints,
 *     merges them, and caches in memory for 24 hours.
 *
 * Data sources:
 *  - GeoJSON/ArcGIS dataset  (resource f9c77b0d…) → coordinates + basic info + TYPE code
 *  - CCL Facilities CSV       (resource 9f5d1d00…) → licensee, admin, status, dates, facility_type
 */

import type { Facility } from "../../shared/schema";
import { getFacilityDbCount } from "../storage";
import {
  typeToGroup,
  formatPhone,
  GEO_STATUS,
  TYPE_TO_NAME,
} from "@shared/etl-types";

// Re-export so existing callers (scripts/etl.ts) keep working without change.
export { typeToGroup, formatPhone };

// ── Cache (live-fetch fallback only) ──────────────────────────────────────────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 h

let _cache: { data: FacilityBase[]; fetchedAt: number } | null = null;

/** Returns raw facility data (without job postings — those are merged in the route). */
export async function getCachedFacilities(): Promise<FacilityBase[]> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) {
    return _cache.data;
  }
  console.log("[facilitiesService] cache miss — fetching from CHHS…");
  const data = await buildFacilityList();
  _cache = { data, fetchedAt: Date.now() };
  console.log(`[facilitiesService] cached ${data.length} facilities`);
  return data;
}

/** Force-refresh the in-memory cache (e.g. from an admin route). */
export function invalidateFacilitiesCache(): void {
  _cache = null;
}

/**
 * Whether the `facilities` SQLite table has been seeded with data.
 * When true, routes should query SQLite directly instead of the CHHS live-fetch.
 */
export function isDatabaseSeeded(): boolean {
  try {
    return getFacilityDbCount() > 0;
  } catch {
    return false;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** Facility shape without jobPostings / isHiring (added by the route). */
export type FacilityBase = Omit<Facility, "jobPostings" | "isHiring">;

// ── CHHS API helpers ──────────────────────────────────────────────────────────

const CHHS_BASE = "https://data.chhs.ca.gov/api/3/action/datastore_search";
const GEO_RESOURCE = "f9c77b0d-9711-4f34-8c7f-90f542fbc24a";
const CCL_RESOURCE = "9f5d1d00-6b24-4f44-a158-9cbe4b43f117";
const PAGE_SIZE = 5000;

async function fetchAllPages(
  resourceId: string,
  filters?: Record<string, string>,
  q?: string,
): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      resource_id: resourceId,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    if (filters) params.set("filters", JSON.stringify(filters));
    if (q) params.set("q", q);

    const res = await fetch(`${CHHS_BASE}?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`CHHS API ${res.status} for ${resourceId}`);

    const json = await res.json();
    const records: any[] = json.result?.records ?? [];
    rows.push(...records);

    if (records.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

// ── Facility type mapping, status codes, phone formatter ─────────────────────
// All moved to shared/etl-types.ts and imported above.

// ── Main build (ALL facility types, ALL counties) ─────────────────────────────

export async function buildFacilityList(): Promise<FacilityBase[]> {
  // Fetch both sources concurrently — NO type filter → gets ALL facility types
  const [geoRows, cclRows] = await Promise.all([
    fetchAllPages(GEO_RESOURCE),          // all types
    fetchAllPages(CCL_RESOURCE),          // all types
  ]);

  console.log(`[facilitiesService] GEO rows: ${geoRows.length}, CCL rows: ${cclRows.length}`);

  // Index CCL rows by facility_number for O(1) lookup
  const cclByNumber = new Map<string, any>();
  for (const row of cclRows) {
    if (row.facility_number) cclByNumber.set(String(row.facility_number).trim(), row);
  }

  const facilities: FacilityBase[] = [];

  for (const geo of geoRows) {
    const num = String(geo.FAC_NBR ?? "").trim();
    if (!num) continue;

    const lat = parseFloat(geo.FAC_LATITUDE ?? "0");
    const lng = parseFloat(geo.FAC_LONGITUDE ?? "0");
    if (!lat || !lng) continue;

    const ccl = cclByNumber.get(num);

    // Derive facility type — prefer CCL's human-readable name, fall back to TYPE code map
    const rawType = (ccl?.facility_type ?? TYPE_TO_NAME[String(geo.TYPE)] ?? "Adult Residential Facility").trim();
    const facilityType = rawType || "Adult Residential Facility";
    const facilityGroup = typeToGroup(facilityType);

    // County — from CCL if available, else from GEO
    const county = (ccl?.county ?? geo.COUNTY ?? "").trim();

    facilities.push({
      number: num,
      name: (ccl?.facility_name ?? geo.NAME ?? "").trim(),
      facilityType,
      facilityGroup,
      county,
      address: (geo.RES_STREET_ADDR ?? "").trim(),
      city: (geo.RES_CITY ?? "").trim().toUpperCase(),
      zip: (geo.RES_ZIP_CODE ?? "").trim(),
      phone: formatPhone(geo.FAC_PHONE_NBR),
      licensee: (ccl?.licensee ?? "").trim(),
      administrator: (ccl?.facility_administrator ?? "").trim(),
      status: (ccl?.facility_status ?? GEO_STATUS[String(geo.STATUS)] ?? "LICENSED").toUpperCase(),
      capacity: parseInt(geo.CAPACITY ?? ccl?.facility_capacity ?? "0", 10) || 0,
      firstLicenseDate: ccl?.license_first_date ?? "",
      closedDate: ccl?.closed_date ?? "",
      // Fields not available from CHHS open data
      lastInspectionDate: "",
      totalVisits: 0,
      inspectionVisits: 0,
      complaintVisits: 0,
      inspectTypeB: 0,
      otherTypeB: 0,
      complaintTypeB: 0,
      totalTypeB: 0,
      citations: "",
      lat,
      lng,
      geocodeQuality: "api",
    });
  }

  return facilities;
}
