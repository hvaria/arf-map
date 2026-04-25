/**
 * server/services/facilitiesService.ts
 *
 * Two modes:
 *  1. SQLite-first (DB is seeded): routes query `facilities` table directly.
 *  2. Auto-seed (DB is empty): fetches all facilities from the CCL CHHS resource
 *     on startup, upserts into SQLite, then geocodes lat/lng via Nominatim.
 *
 * Data sources:
 *  - CCL Facilities resource (9f5d1d00) → name, address, type, status, capacity, etc.
 *  - Nominatim / OpenStreetMap          → lat/lng from facility name + address
 */

import type { Facility } from "../../shared/schema";
import { getFacilityDbCount, bulkUpsertFacilities, updateFacilityCoords } from "../storage";
import { sqlite } from "../db/index";
import { typeToGroup, formatPhone } from "@shared/etl-types";

// Re-export so existing callers keep working without change.
export { typeToGroup, formatPhone };

// ── Types ─────────────────────────────────────────────────────────────────────

/** Facility shape without jobPostings / isHiring (added by the route). */
export type FacilityBase = Omit<Facility, "jobPostings" | "isHiring">;

// ── Constants ─────────────────────────────────────────────────────────────────

const CHHS_BASE    = "https://data.chhs.ca.gov/api/3/action/datastore_search";
const CCL_RESOURCE = "9f5d1d00-6b24-4f44-a158-9cbe4b43f117";
const PAGE_SIZE    = 5000;

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_UA   = "arf-map-geocoder/1.0 (himanshu.a.varia@gmail.com)";
const GEOCODE_DELAY  = 1100; // ms — Nominatim rate limit: 1 req/sec

// ── In-memory cache (used while DB is seeding or as live-fetch fallback) ──────

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let _cache: { data: FacilityBase[]; fetchedAt: number } | null = null;
let _seeding = false;

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Called once on server startup. If the DB is empty, kicks off a background
 * seed from the CCL CHHS resource followed by Nominatim geocoding.
 * Non-blocking — returns immediately.
 */
export async function autoSeedIfEmpty(): Promise<void> {
  if (isDatabaseSeeded() || _seeding) return;
  setImmediate(() => seedFromCCL().catch((err) => console.error("[facilitiesService] seed error:", err)));
}

/**
 * Returns facilities from the in-memory cache (populated during seeding or
 * by an explicit live-fetch). Used by routes when the DB is not yet seeded.
 */
export async function getCachedFacilities(): Promise<FacilityBase[]> {
  if (_cache && Date.now() - _cache.fetchedAt < CACHE_TTL_MS) return _cache.data;
  // If a seed is already running, return whatever is cached so far (may be empty)
  if (_seeding) return _cache?.data ?? [];
  // Otherwise trigger a fresh CCL fetch for the in-memory cache only
  const data = await buildFacilityList();
  _cache = { data, fetchedAt: Date.now() };
  return data;
}

/** Force-refresh the in-memory cache (e.g. from an admin route). */
export function invalidateFacilitiesCache(): void {
  _cache = null;
}

/**
 * Whether the `facilities` SQLite table has been seeded with data.
 * When true, routes should query SQLite directly instead of the live-fetch.
 */
export function isDatabaseSeeded(): boolean {
  try {
    return getFacilityDbCount() > 0;
  } catch {
    return false;
  }
}

// ── CHHS fetch helpers ────────────────────────────────────────────────────────

async function fetchAllPages(resourceId: string): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      resource_id: resourceId,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });

    const res = await fetch(`${CHHS_BASE}?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`CHHS API ${res.status} for ${resourceId}`);

    const json = await res.json();
    const records: any[] = json.result?.records ?? [];
    rows.push(...records);
    console.log(`[facilitiesService] fetched ${rows.length} rows (offset ${offset})…`);

    if (records.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return rows;
}

// ── CCL row → FacilityBase mapping ───────────────────────────────────────────

function mapCCLToFacility(row: any): FacilityBase {
  const rawType = (row.facility_type ?? "").trim();
  // CCL returns uppercase names like "ADULT RESIDENTIAL FACILITY" — title-case them
  const facilityType = rawType
    .toLowerCase()
    .replace(/\b\w/g, (c: string) => c.toUpperCase()) || "Adult Residential Facility";
  const facilityGroup = typeToGroup(facilityType);

  return {
    number:            String(row.facility_number ?? "").trim(),
    name:              (row.facility_name ?? "").trim(),
    facilityType,
    facilityGroup,
    status:            (row.facility_status ?? "LICENSED").toUpperCase(),
    address:           (row.facility_address ?? "").trim(),
    city:              (row.facility_city ?? "").trim().toUpperCase(),
    county:            (row.county_name ?? "").trim(),
    zip:               String(row.facility_zip ?? "").trim(),
    phone:             formatPhone(row.facility_telephone_number),
    licensee:          (row.licensee ?? "").trim(),
    administrator:     (row.facility_administrator ?? "").trim(),
    capacity:          parseInt(row.facility_capacity ?? "0", 10) || 0,
    firstLicenseDate:  row.license_first_date ?? "",
    closedDate:        row.closed_date ?? "",
    lastInspectionDate: "",
    totalVisits:       0,
    inspectionVisits:  0,
    complaintVisits:   0,
    inspectTypeB:      0,
    otherTypeB:        0,
    complaintTypeB:    0,
    totalTypeB:        0,
    citations:         "",
    // 0,0 = no coordinates yet; routes/map filter these out by checking lat !== 0
    lat:               0,
    lng:               0,
    geocodeQuality:    "",
  };
}

// ── Seed from CCL CHHS resource ───────────────────────────────────────────────

async function seedFromCCL(): Promise<void> {
  if (_seeding) return;
  _seeding = true;
  try {
    console.log("[facilitiesService] starting CCL seed…");
    const cclRows = await fetchAllPages(CCL_RESOURCE);
    const facilities = cclRows
      .map(mapCCLToFacility)
      .filter((f) => f.number); // skip rows without a facility number

    // Populate in-memory cache so requests during seeding get data immediately
    _cache = { data: facilities, fetchedAt: Date.now() };

    // Upsert into SQLite in chunks of 1000
    const CHUNK = 1000;
    for (let i = 0; i < facilities.length; i += CHUNK) {
      const chunk = facilities.slice(i, i + CHUNK);
      bulkUpsertFacilities(
        chunk.map((f) => ({
          number:               f.number,
          name:                 f.name,
          facility_type:        f.facilityType,
          facility_group:       f.facilityGroup,
          status:               f.status,
          address:              f.address,
          city:                 f.city,
          county:               f.county,
          zip:                  f.zip,
          phone:                f.phone,
          licensee:             f.licensee,
          administrator:        f.administrator,
          capacity:             f.capacity,
          first_license_date:   f.firstLicenseDate,
          closed_date:          f.closedDate,
          last_inspection_date: "",
          total_visits:         0,
          total_type_b:         0,
          citations:            0,
          lat:                  null,
          lng:                  null,
          geocode_quality:      "",
        })),
      );
    }

    console.log(`[facilitiesService] seeded ${facilities.length} facilities into SQLite`);
  } finally {
    _seeding = false;
  }

  // Geocode in background after seed — don't await, don't block startup
  geocodeMissingCoords().catch((err) =>
    console.error("[facilitiesService] geocoder error:", err),
  );
}

// ── Nominatim geocoder ────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function nominatimLookup(q: string): Promise<{ lat: number; lng: number } | null> {
  try {
    const params = new URLSearchParams({ q, format: "json", limit: "1", countrycodes: "us" });
    const res = await fetch(`${NOMINATIM_BASE}?${params}`, {
      headers: { "User-Agent": NOMINATIM_UA, Accept: "application/json" },
    });
    if (!res.ok) return null;
    const json = await res.json();
    if (!Array.isArray(json) || json.length === 0) return null;
    const lat = parseFloat(json[0].lat);
    const lng = parseFloat(json[0].lon);
    if (isNaN(lat) || isNaN(lng)) return null;
    return { lat, lng };
  } catch {
    return null;
  }
}

/**
 * Background loop: geocodes facilities that have no coordinates yet.
 * Respects Nominatim's 1 req/sec rate limit.
 * Marks permanently unfound addresses as "geocode_failed" to skip on re-runs.
 */
async function geocodeMissingCoords(): Promise<void> {
  console.log("[facilitiesService] starting background geocoder…");
  let processed = 0;

  while (true) {
    const batch = sqlite
      .prepare(
        `SELECT number, name, address, city, zip
         FROM facilities
         WHERE lat IS NULL AND geocode_quality != 'geocode_failed'
         LIMIT 50`,
      )
      .all() as { number: string; name: string; address: string; city: string; zip: string }[];

    if (batch.length === 0) {
      console.log(`[facilitiesService] geocoder done — ${processed} facilities geocoded`);
      break;
    }

    for (const fac of batch) {
      // Try: facility name + address + city + CA
      const q1 = `${fac.name} ${fac.address} ${fac.city} CA ${fac.zip}`.trim();
      let coords = await nominatimLookup(q1);
      await sleep(GEOCODE_DELAY);

      // Fallback: street address + city + CA
      if (!coords) {
        const q2 = `${fac.address} ${fac.city} CA ${fac.zip}`.trim();
        coords = await nominatimLookup(q2);
        await sleep(GEOCODE_DELAY);
      }

      if (coords) {
        updateFacilityCoords(fac.number, coords.lat, coords.lng, "nominatim");
        processed++;
        if (processed % 100 === 0) {
          console.log(`[facilitiesService] geocoded ${processed} facilities so far…`);
        }
      } else {
        // Mark as failed so we don't waste requests on it next time
        updateFacilityCoords(fac.number, null, null, "geocode_failed");
      }
    }
  }
}

// ── Live-fetch fallback (CCL only, no coordinates) ────────────────────────────

/**
 * Builds the facility list from the CCL CHHS resource.
 * Used by getCachedFacilities() when the DB is not seeded.
 * Facilities will have no coordinates until geocoding runs.
 */
export async function buildFacilityList(): Promise<FacilityBase[]> {
  const cclRows = await fetchAllPages(CCL_RESOURCE);
  console.log(`[facilitiesService] CCL rows: ${cclRows.length}`);
  return cclRows.map(mapCCLToFacility).filter((f) => f.number);
}
