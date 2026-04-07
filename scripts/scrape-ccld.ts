#!/usr/bin/env tsx
/**
 * scripts/scrape-ccld.ts
 *
 * Scrapes ALL Adult Residential Facilities (ARF, facType=735) from the
 * CCLD Transparency API for every California county, geocodes missing
 * coordinates via Nominatim, and writes client/src/data/facilities.json.
 *
 * Handles the 250-result cap by re-querying at the city level whenever a
 * county returns exactly 250 records (indicating truncation).
 *
 * Usage:
 *   npx tsx scripts/scrape-ccld.ts              # all counties
 *   npx tsx scripts/scrape-ccld.ts SAN_DIEGO    # single county (underscores → spaces)
 *
 * Runtime estimate: ~5-15 min (depends on geocoding volume)
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

// ── Config ────────────────────────────────────────────────────────────────────

const API_BASE = "https://www.ccld.dss.ca.gov/transparencyapi/api";
const FAC_TYPE = 735;
const OUTPUT_PATH = path.resolve("client/src/data/facilities.json");

/** Pause between CCLD API calls (ms) — stay polite */
const API_DELAY_MS = 400;
/** Pause between Nominatim geocode calls — must be ≥ 1 000 ms per ToS */
const GEOCODE_DELAY_MS = 1100;

// All 58 California counties (upper-case to match the CCLD county parameter)
const CA_COUNTIES = [
  "ALAMEDA", "ALPINE", "AMADOR", "BUTTE", "CALAVERAS", "COLUSA",
  "CONTRA COSTA", "DEL NORTE", "EL DORADO", "FRESNO", "GLENN", "HUMBOLDT",
  "IMPERIAL", "INYO", "KERN", "KINGS", "LAKE", "LASSEN", "LOS ANGELES",
  "MADERA", "MARIN", "MARIPOSA", "MENDOCINO", "MERCED", "MODOC", "MONO",
  "MONTEREY", "NAPA", "NEVADA", "ORANGE", "PLACER", "PLUMAS", "RIVERSIDE",
  "SACRAMENTO", "SAN BENITO", "SAN BERNARDINO", "SAN DIEGO", "SAN FRANCISCO",
  "SAN JOAQUIN", "SAN LUIS OBISPO", "SAN MATEO", "SANTA BARBARA",
  "SANTA CLARA", "SANTA CRUZ", "SHASTA", "SIERRA", "SISKIYOU", "SOLANO",
  "SONOMA", "STANISLAUS", "SUTTER", "TEHAMA", "TRINITY", "TULARE",
  "TUOLUMNE", "VENTURA", "YOLO", "YUBA",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

function safeNum(v: unknown): number {
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

function safeStr(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

// ── CCLD API ──────────────────────────────────────────────────────────────────

async function ccldFetch(params: Record<string, string>): Promise<any[]> {
  const qs = new URLSearchParams({ facType: String(FAC_TYPE), ...params });
  const url = `${API_BASE}/FacilitySearch?${qs}`;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "ARF-Map-Scraper/1.0 (public data collection)",
        },
      });
      if (!res.ok) {
        console.warn(`    HTTP ${res.status} for ${url}`);
        return [];
      }
      const data = await res.json();
      return Array.isArray(data) ? data : [];
    } catch (err: any) {
      if (attempt === 3) {
        console.warn(`    Fetch failed after 3 attempts: ${err.message}`);
        return [];
      }
      await sleep(1000 * attempt);
    }
  }
  return [];
}

/** Map one raw CCLD record to our Facility shape.
 *  We log the raw keys once so you can verify the mapping. */
let _rawKeysPrinted = false;
function mapRaw(raw: any): any {
  if (!_rawKeysPrinted) {
    _rawKeysPrinted = true;
    console.log("\n📋 CCLD raw field names (first record):");
    console.log("  Keys:", Object.keys(raw).join(", "));
    console.log("  Sample:", JSON.stringify(raw, null, 2).split("\n").slice(0, 30).join("\n"));
    console.log();
  }

  // Try multiple casing conventions in order: PascalCase, camelCase, lower
  const get = (pascal: string, camel: string, lower: string) =>
    raw[pascal] ?? raw[camel] ?? raw[lower] ?? "";

  return {
    name: safeStr(get("FacilityName", "facilityName", "facilityname")),
    number: safeStr(
      raw.FacilityNumber ?? raw.facilityNumber ?? raw.FacilityNo ?? raw.facilityNo ?? ""
    ),
    address: safeStr(get("FacilityAddress", "facilityAddress", "facilityaddress")),
    city: safeStr(get("FacilityCity", "facilityCity", "facilitycity")).toUpperCase(),
    zip: safeStr(get("FacilityZip", "facilityZip", "facilityzip")),
    phone: safeStr(get("FacilityPhone", "facilityPhone", "facilityphone")),
    licensee: safeStr(get("LicenseeName", "licenseeName", "licenseename")),
    administrator: safeStr(
      raw.AdministratorName ?? raw.administratorName ?? raw.Administrator ?? ""
    ),
    status: safeStr(
      raw.FacilityStatus ?? raw.facilityStatus ?? raw.Status ?? ""
    ).toUpperCase(),
    capacity: safeNum(
      raw.CapacityTotal ?? raw.capacityTotal ?? raw.Capacity ?? raw.capacity ?? 0
    ),
    firstLicenseDate: safeStr(
      raw.FirstLicenseDate ?? raw.firstLicenseDate ?? raw.LicenseDate ?? ""
    ),
    closedDate: safeStr(raw.ClosedDate ?? raw.closedDate ?? ""),
    lastInspectionDate: safeStr(
      raw.LastInspectionDate ?? raw.lastInspectionDate ?? raw.LastInspection ?? ""
    ),
    totalVisits: safeNum(raw.TotalVisits ?? raw.totalVisits ?? 0),
    inspectionVisits: safeNum(raw.InspectionVisits ?? raw.inspectionVisits ?? 0),
    complaintVisits: safeNum(raw.ComplaintVisits ?? raw.complaintVisits ?? 0),
    inspectTypeB: safeNum(raw.InspectTypeB ?? raw.inspectTypeB ?? 0),
    otherTypeB: safeNum(raw.OtherTypeB ?? raw.otherTypeB ?? 0),
    complaintTypeB: safeNum(raw.ComplaintTypeB ?? raw.complaintTypeB ?? 0),
    totalTypeB: safeNum(raw.TotalTypeB ?? raw.totalTypeB ?? 0),
    citations: safeStr(raw.Citations ?? raw.citations ?? ""),
    // Coordinates — may come from API; fallback added below
    lat: safeNum(raw.Latitude ?? raw.latitude ?? raw.Lat ?? raw.lat ?? 0),
    lng: safeNum(raw.Longitude ?? raw.longitude ?? raw.Lng ?? raw.lng ?? 0),
    geocodeQuality: "api",
    isHiring: false,
    jobPostings: [],
  };
}

// ── Geocoding (Nominatim / OSM) ───────────────────────────────────────────────

async function geocode(
  address: string,
  city: string,
  zip: string
): Promise<{ lat: number; lng: number; quality: string } | null> {
  const q = `${address}, ${city}, CA ${zip}, USA`;
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=us`;

  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": "ARF-Map-Scraper/1.0 contact@arfmap.example",
      },
    });
    if (!res.ok) return null;
    const data: any[] = await res.json();
    if (data.length === 0) return null;
    return {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      quality: data[0].type ?? "nominatim",
    };
  } catch {
    return null;
  }
}

// ── Per-county fetch (handles 250-cap via city re-queries) ────────────────────

async function fetchCounty(county: string): Promise<Map<string, any>> {
  const byNumber = new Map<string, any>();

  await sleep(API_DELAY_MS);
  const top = await ccldFetch({ county });
  for (const r of top) {
    const f = mapRaw(r);
    if (f.number) byNumber.set(f.number, f);
  }

  if (top.length < 250) {
    return byNumber; // no truncation
  }

  // ── Hit the cap: re-query each city that appeared in the top 250 ──
  console.log(
    `    ⚠️  ${county} returned ${top.length} (cap hit) — expanding by city…`
  );

  const cities = [...new Set(top.map((r: any) => safeStr(r.FacilityCity ?? r.facilityCity ?? r.City ?? "").toUpperCase()))].filter(Boolean);

  for (const city of cities) {
    await sleep(API_DELAY_MS);
    const cityRows = await ccldFetch({ county, city });
    for (const r of cityRows) {
      const f = mapRaw(r);
      if (f.number) byNumber.set(f.number, f);
    }
    if (cityRows.length >= 250) {
      console.warn(`    ⚠️  ${county}/${city} also hit 250 cap — data may be incomplete`);
    }
  }

  return byNumber;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // ── Parse CLI arg ──────────────────────────────────────────────────────────
  const arg = process.argv[2];
  const counties = arg
    ? [arg.replace(/_/g, " ").toUpperCase()]
    : CA_COUNTIES;

  // ── Load existing data (preserve geocodes + job postings) ─────────────────
  const existingMap = new Map<string, any>();
  if (fs.existsSync(OUTPUT_PATH) && !arg) {
    const existing: any[] = JSON.parse(fs.readFileSync(OUTPUT_PATH, "utf-8"));
    for (const f of existing) existingMap.set(f.number, f);
    console.log(`📂 Loaded ${existingMap.size} existing facilities (geocodes + job postings will be preserved)\n`);
  }

  const allFacilities: any[] = [];
  let totalGeocoded = 0;
  let totalSkippedGeo = 0;

  // ── County loop ────────────────────────────────────────────────────────────
  for (const county of counties) {
    process.stdout.write(`🔍 ${county.padEnd(22)}`);

    const byNumber = await fetchCounty(county);

    let geocodedThisCounty = 0;

    for (const [num, facility] of byNumber) {
      const prev = existingMap.get(num);

      // Preserve previous geocode if API returned 0,0
      if ((!facility.lat || !facility.lng) && prev?.lat) {
        facility.lat = prev.lat;
        facility.lng = prev.lng;
        facility.geocodeQuality = prev.geocodeQuality ?? "preserved";
      }

      // Preserve job postings
      if (prev?.jobPostings?.length > 0) {
        facility.jobPostings = prev.jobPostings;
        facility.isHiring = prev.isHiring ?? true;
      }

      // Geocode if still no coordinates
      if (!facility.lat || !facility.lng) {
        await sleep(GEOCODE_DELAY_MS);
        const geo = await geocode(facility.address, facility.city, facility.zip);
        if (geo) {
          facility.lat = geo.lat;
          facility.lng = geo.lng;
          facility.geocodeQuality = geo.quality;
          geocodedThisCounty++;
          totalGeocoded++;
        } else {
          totalSkippedGeo++;
          facility.geocodeQuality = "failed";
        }
      }

      allFacilities.push(facility);
    }

    const geo = geocodedThisCounty > 0 ? ` (${geocodedThisCounty} geocoded)` : "";
    console.log(`${byNumber.size} facilities${geo}`);
  }

  // ── Sort and write ─────────────────────────────────────────────────────────
  allFacilities.sort(
    (a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name)
  );

  // If we only scraped one county, merge with the rest of the existing file
  if (arg && existingMap.size > 0) {
    const scraped = new Set(allFacilities.map((f) => f.number));
    for (const [num, f] of existingMap) {
      if (!scraped.has(num)) allFacilities.push(f);
    }
    allFacilities.sort(
      (a, b) => a.city.localeCompare(b.city) || a.name.localeCompare(b.name)
    );
  }

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(allFacilities, null, 2));

  console.log(`\n✅ Done!`);
  console.log(`   Total facilities: ${allFacilities.length}`);
  console.log(`   Geocoded this run: ${totalGeocoded}`);
  console.log(`   Failed geocodes:   ${totalSkippedGeo}`);
  console.log(`   Output: ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
