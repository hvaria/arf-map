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
import {
  getFacilityDbCountAsync,
  bulkUpsertFacilities,
  updateFacilityCoords,
} from "../storage";
import { sqlite, pool, usingPostgres } from "../db/index";
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
  if (_seeding) return;
  if (usingPostgres) {
    // In Postgres mode, check the DB count asynchronously
    try {
      const count = await getFacilityDbCountAsync();
      if (count > 0) {
        _isDatabaseSeededCache = true;
        return;
      }
    } catch {
      // DB not ready yet — proceed with seeding
    }
  } else {
    if (isDatabaseSeeded()) return;
  }
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
 * Whether the `facilities` table has been seeded with data.
 * When true, routes should query the DB directly instead of the live-fetch.
 *
 * NOTE: This function is called synchronously from routes.ts (isDatabaseSeeded()).
 * In Postgres mode it always returns false so the live-fetch path is used —
 * which is safe because Postgres routes must be migrated to async Async variants
 * anyway. See agents/05-blockers.md.
 */
export function isDatabaseSeeded(): boolean {
  if (usingPostgres) {
    // Cannot do a synchronous Postgres query.
    // Return false to fall back to the in-memory live-fetch path.
    // This is safe: the async seedFromCCL() path still populates Postgres,
    // and _isDatabaseSeededCache is updated after successful seeding.
    return _isDatabaseSeededCache;
  }
  try {
    // Synchronous SQLite path — safe because better-sqlite3 is synchronous
    const row = sqlite!.prepare("SELECT COUNT(*) as n FROM facilities").get() as { n: number };
    return row.n > 0;
  } catch {
    return false;
  }
}

// Cache for Postgres mode: updated after successful seedFromCCL()
let _isDatabaseSeededCache = false;

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

    // Upsert into DB in chunks of 1000
    const CHUNK = 1000;
    for (let i = 0; i < facilities.length; i += CHUNK) {
      const chunk = facilities.slice(i, i + CHUNK);
      await bulkUpsertFacilities(
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

    // Update the Postgres-mode seeded cache so isDatabaseSeeded() returns true
    _isDatabaseSeededCache = true;
    console.log(`[facilitiesService] seeded ${facilities.length} facilities into ${usingPostgres ? "PostgreSQL" : "SQLite"}`);
  } finally {
    _seeding = false;
  }

  // Geocode in background after seed — don't await, don't block startup
  geocodeMissingCoords().catch((err) =>
    console.error("[facilitiesService] geocoder error:", err),
  );
}

// ── Geocoding helpers ─────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Minimal CSV line parser that handles double-quoted fields containing commas. */
function parseCsvLine(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      cols.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

/** Normalize an ALL-CAPS city name to Title Case for geocoder queries. */
function toTitleCase(s: string): string {
  return s
    .split(" ")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

/** Returns true only when coordinates fall within California's bounding box. */
function isInCalifornia(lat: number, lng: number): boolean {
  return lat >= 32.5 && lat <= 42.0 && lng >= -124.5 && lng <= -114.1;
}

/**
 * Nominatim (OpenStreetMap) geocoder.
 * Returns `{ lat, lng }` on a genuine match, `null` on genuine no-result,
 * or throws a `TransientGeocoderError` on network / HTTP errors so the
 * caller can distinguish transient from permanent failures.
 */
class TransientGeocoderError extends Error {}

async function nominatimLookup(
  q: string,
): Promise<{ lat: number; lng: number } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const params = new URLSearchParams({
      q,
      format: "json",
      limit: "1",
      countrycodes: "us",
    });
    const res = await fetch(`${NOMINATIM_BASE}?${params}`, {
      headers: { "User-Agent": NOMINATIM_UA, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new TransientGeocoderError(`Nominatim HTTP ${res.status}`);
    }
    const json: unknown = await res.json();
    if (!Array.isArray(json) || json.length === 0) return null;
    const lat = parseFloat((json[0] as Record<string, string>).lat);
    const lng = parseFloat((json[0] as Record<string, string>).lon);
    if (isNaN(lat) || isNaN(lng)) return null;
    if (!isInCalifornia(lat, lng)) return null;
    return { lat, lng };
  } catch (err) {
    if (err instanceof TransientGeocoderError) throw err;
    // AbortError or network error → transient
    throw new TransientGeocoderError(`Nominatim network error: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * US Census Bureau geocoder (primary, free, no API key).
 * Uses the structured single-address endpoint.
 */
const CENSUS_BASE =
  "https://geocoding.geo.census.gov/geocoder/locations/address";

async function censusBureauLookup(
  address: string,
  city: string,
  zip: string,
): Promise<{ lat: number; lng: number } | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const params = new URLSearchParams({
      street: address,
      city: toTitleCase(city),
      state: "CA",
      zip,
      benchmark: "Public_AR_Current",
      format: "json",
    });
    const res = await fetch(`${CENSUS_BASE}?${params}`, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new TransientGeocoderError(`Census Bureau HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      result?: {
        addressMatches?: Array<{
          coordinates?: { x: number; y: number };
        }>;
      };
    };
    const match = json.result?.addressMatches?.[0];
    if (!match?.coordinates) return null;
    const lng = match.coordinates.x;
    const lat = match.coordinates.y;
    if (isNaN(lat) || isNaN(lng)) return null;
    if (!isInCalifornia(lat, lng)) return null;
    return { lat, lng };
  } catch (err) {
    if (err instanceof TransientGeocoderError) throw err;
    throw new TransientGeocoderError(`Census Bureau network error: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * US Census Bureau batch geocoder.
 * POSTs up to 1,000 addresses at once and returns a map of facilityNumber → coords.
 * No rate limit — the Census API accepts as many batches as needed.
 * Docs: https://geocoding.geo.census.gov/geocoder/Geocoding_Services_API.html
 */
const CENSUS_BATCH_BASE =
  "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";

async function censusBatchLookup(
  facilities: Array<{ number: string; address: string; city: string; zip: string }>,
): Promise<Map<string, { lat: number; lng: number }>> {
  const results = new Map<string, { lat: number; lng: number }>();
  if (facilities.length === 0) return results;

  // Input CSV: Unique ID, Street Address, City, State, ZIP
  const csv = facilities
    .map((f) => `${f.number},"${f.address}","${toTitleCase(f.city)}","CA","${f.zip}"`)
    .join("\n");

  const formData = new FormData();
  formData.append(
    "addressFile",
    new Blob([csv], { type: "text/plain" }),
    "addresses.csv",
  );
  formData.append("benchmark", "Public_AR_Current");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 120_000); // 2 min for large batches
  try {
    const res = await fetch(CENSUS_BATCH_BASE, {
      method: "POST",
      body: formData,
      signal: controller.signal,
    });
    if (!res.ok) {
      console.error(`[facilitiesService] Census Batch HTTP ${res.status}`);
      return results;
    }
    const text = await res.text();
    // Response CSV: ID,InputAddress,Match,MatchType,MatchedAddress,"Lng,Lat",TigerLineId,Side
    for (const raw of text.split("\n")) {
      const line = raw.trim();
      if (!line) continue;
      const cols = parseCsvLine(line);
      if (cols.length < 6) continue;
      const id = cols[0].trim();
      if (cols[2].trim() !== "Match") continue;
      const coordStr = cols[5].trim();
      const [lngStr, latStr] = coordStr.split(",");
      const lng = parseFloat(lngStr);
      const lat = parseFloat(latStr);
      if (isNaN(lat) || isNaN(lng)) continue;
      if (!isInCalifornia(lat, lng)) continue;
      results.set(id, { lat, lng });
    }
  } catch (err) {
    console.error(`[facilitiesService] Census Batch error: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }
  return results;
}

/**
 * OpenCage geocoder — optional second fallback.
 * Only called when `OPENCAGE_API_KEY` env var is set.
 */
async function openCageLookup(
  address: string,
  city: string,
  zip: string,
): Promise<{ lat: number; lng: number } | null> {
  const apiKey = process.env.OPENCAGE_API_KEY;
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const q = encodeURIComponent(
      `${address}, ${toTitleCase(city)}, CA ${zip}, USA`,
    );
    const url = `https://api.opencagedata.com/geocode/v1/json?q=${q}&key=${apiKey}&countrycode=us&limit=1`;
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new TransientGeocoderError(`OpenCage HTTP ${res.status}`);
    }
    const json = (await res.json()) as {
      results?: Array<{
        geometry?: { lat: number; lng: number };
      }>;
    };
    const geo = json.results?.[0]?.geometry;
    if (!geo) return null;
    if (isNaN(geo.lat) || isNaN(geo.lng)) return null;
    if (!isInCalifornia(geo.lat, geo.lng)) return null;
    return { lat: geo.lat, lng: geo.lng };
  } catch (err) {
    if (err instanceof TransientGeocoderError) throw err;
    throw new TransientGeocoderError(`OpenCage network error: ${String(err)}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Background loop: geocodes facilities that have no coordinates yet.
 *
 * Geocoding cascade:
 *   1. Census Batch API (1,000 addresses/POST — fast, no rate limit)
 *   2. Nominatim single-address (1 req/sec rate limit — only for batch misses)
 *   3. OpenCage (optional — only if OPENCAGE_API_KEY is set)
 *
 * Transient network errors leave geocode_quality unchanged so the facility
 * is retried on the next server restart. Only genuine "no match" responses
 * from all geocoders write "geocode_failed".
 */
async function geocodeMissingCoords(): Promise<void> {
  console.log("[facilitiesService] starting background geocoder (Census batch → Nominatim → OpenCage)…");
  let processed = 0;

  const GEOCODER_SQL = `
    SELECT number, name, address, city, zip
    FROM facilities
    WHERE (lat IS NULL OR lat = 0)
      AND geocode_quality NOT IN ('census_exact', 'census_non_exact', 'census', 'nominatim', 'opencage', 'api')
    LIMIT 1000
  `;

  while (true) {
    let batch: { number: string; name: string; address: string; city: string; zip: string }[];

    if (usingPostgres) {
      const result = await pool!.query(GEOCODER_SQL);
      batch = result.rows as typeof batch;
    } else {
      batch = sqlite!
        .prepare(GEOCODER_SQL)
        .all() as typeof batch;
    }

    if (batch.length === 0) {
      console.log(
        `[facilitiesService] geocoder done — ${processed} facilities geocoded`,
      );
      break;
    }

    // ── 1. Census Batch (entire 1,000-record batch in one POST) ──────────────
    const censusResults = await censusBatchLookup(batch);
    const needsFallback: typeof batch = [];

    for (const fac of batch) {
      const coords = censusResults.get(fac.number);
      if (coords) {
        await updateFacilityCoords(fac.number, coords.lat, coords.lng, "census");
        processed++;
        if (processed % 500 === 0) {
          console.log(`[facilitiesService] geocoded ${processed} facilities so far…`);
        }
      } else {
        needsFallback.push(fac);
      }
    }

    console.log(
      `[facilitiesService] Census batch: ${censusResults.size}/${batch.length} matched, ` +
      `${needsFallback.length} sent to Nominatim fallback`,
    );

    // ── 2. Nominatim + OpenCage for Census misses (rate-limited) ─────────────
    for (const fac of needsFallback) {
      let coords: { lat: number; lng: number } | null = null;
      let quality = "";
      let transientError = false;

      // Nominatim attempt 1: name + address
      try {
        const titleCity = toTitleCase(fac.city);
        const q1 = `${fac.name} ${fac.address} ${titleCity} CA ${fac.zip}`.trim();
        coords = await nominatimLookup(q1);
        if (coords) {
          quality = "nominatim";
        } else {
          // Nominatim attempt 2: address only
          await sleep(GEOCODE_DELAY);
          const q2 = `${fac.address} ${titleCity} CA ${fac.zip}`.trim();
          coords = await nominatimLookup(q2);
          if (coords) quality = "nominatim";
        }
      } catch {
        transientError = true;
      }
      await sleep(GEOCODE_DELAY);

      // OpenCage (optional second fallback)
      if (!coords && !transientError && process.env.OPENCAGE_API_KEY) {
        try {
          coords = await openCageLookup(fac.address, fac.city, fac.zip);
          if (coords) quality = "opencage";
        } catch {
          transientError = true;
        }
        await sleep(GEOCODE_DELAY);
      }

      if (coords) {
        await updateFacilityCoords(fac.number, coords.lat, coords.lng, quality);
        processed++;
        if (processed % 100 === 0) {
          console.log(`[facilitiesService] geocoded ${processed} facilities so far…`);
        }
      } else if (!transientError) {
        // All geocoders returned genuine no-match — mark permanently failed
        await updateFacilityCoords(fac.number, null, null, "geocode_failed");
      }
      // transientError: leave geocode_quality unchanged → row retried next run
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
