/**
 * scripts/extract-ccld-data.ts
 *
 * Fetches ALL California CCLD facility types from the CCL CHHS open-data resource,
 * geocodes each address via Nominatim/OpenStreetMap, and writes:
 *   data/ccld_all_facilities.json
 *
 * Usage:
 *   npx tsx scripts/extract-ccld-data.ts
 *
 * Then seed the DB:
 *   npx tsx scripts/seed-facilities-db.ts
 *
 * Note: Nominatim rate-limits to 1 req/sec. Geocoding ~60k facilities takes time.
 * Previously geocoded facilities are read from existing JSON (if present) and skipped.
 */

import * as fs from "fs";
import * as path from "path";

// ── CHHS API config ────────────────────────────────────────────────────────────

const CHHS_BASE    = "https://data.chhs.ca.gov/api/3/action/datastore_search";
const CCL_RESOURCE = "9f5d1d00-6b24-4f44-a158-9cbe4b43f117";
const PAGE_SIZE    = 5000;

// ── Nominatim config ──────────────────────────────────────────────────────────

const NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search";
const NOMINATIM_UA   = "arf-map-geocoder/1.0 (himanshu.a.varia@gmail.com)";
const GEOCODE_DELAY  = 1100; // ms

// ── Facility type helpers ─────────────────────────────────────────────────────

function typeToGroup(facilityType: string): string {
  const t = facilityType.toLowerCase();
  if (t.includes("child care center") || t.includes("family child care")) return "Child Care";
  if (
    t.includes("group home") ||
    t.includes("short-term residential") ||
    t.includes("community treatment") ||
    t.includes("foster family agency")
  ) return "Children's Residential";
  if (t.includes("home care organization")) return "Home Care";
  return "Adult & Senior Care";
}

function formatPhone(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1") return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw ?? "";
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ── CHHS fetch ────────────────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchAllPages(resourceId: string): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;
  let page = 1;

  while (true) {
    const params = new URLSearchParams({
      resource_id: resourceId,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });

    console.log(`  Page ${page} (offset ${offset})…`);
    const res = await fetch(`${CHHS_BASE}?${params}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`CHHS API ${res.status} for resource ${resourceId}`);

    const json = await res.json();
    const records: any[] = json.result?.records ?? [];
    rows.push(...records);

    if (records.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    page++;
    await sleep(1000);
  }

  return rows;
}

// ── Nominatim geocoder ────────────────────────────────────────────────────────

async function geocode(name: string, address: string, city: string, zip: string): Promise<{ lat: number; lng: number } | null> {
  // Try: facility name + address + city + CA + zip
  for (const q of [
    `${name} ${address} ${city} CA ${zip}`,
    `${address} ${city} CA ${zip}`,
  ]) {
    const params = new URLSearchParams({ q: q.trim(), format: "json", limit: "1", countrycodes: "us" });
    try {
      const res = await fetch(`${NOMINATIM_BASE}?${params}`, {
        headers: { "User-Agent": NOMINATIM_UA, Accept: "application/json" },
      });
      await sleep(GEOCODE_DELAY);
      if (!res.ok) continue;
      const json = await res.json();
      if (!Array.isArray(json) || json.length === 0) continue;
      const lat = parseFloat(json[0].lat);
      const lng = parseFloat(json[0].lon);
      if (!isNaN(lat) && !isNaN(lng)) return { lat, lng };
    } catch {
      await sleep(GEOCODE_DELAY);
    }
  }
  return null;
}

// ── Main ───────────────────────────────────────────────────────────────────────

async function main() {
  console.log("=== CCLD California Facility Extractor ===\n");

  // Load existing output to skip already-geocoded facilities
  const outDir  = path.resolve(process.cwd(), "data");
  const outPath = path.join(outDir, "ccld_all_facilities.json");
  const existing = new Map<string, { lat: number | null; lng: number | null; geocodeQuality: string }>();

  if (fs.existsSync(outPath)) {
    try {
      const prev: any[] = JSON.parse(fs.readFileSync(outPath, "utf-8"));
      for (const f of prev) {
        if (f.number && (f.lat || f.geocodeQuality === "geocode_failed")) {
          existing.set(f.number, { lat: f.lat, lng: f.lng, geocodeQuality: f.geocodeQuality });
        }
      }
      console.log(`Loaded ${existing.size} previously geocoded entries from ${outPath}\n`);
    } catch {
      console.log("Could not parse existing output — starting fresh\n");
    }
  }

  // Step 1: fetch CCL data
  console.log("Fetching CCL dataset (names, addresses, types, statuses)…");
  const cclRows = await fetchAllPages(CCL_RESOURCE);
  console.log(`  → ${cclRows.length} CCL rows\n`);

  // Step 2: map CCL rows → facility objects
  const facilities: any[] = cclRows
    .filter((row) => row.facility_number)
    .map((row) => {
      const num        = String(row.facility_number).trim();
      const rawType    = (row.facility_type ?? "").trim();
      const facilityType  = titleCase(rawType) || "Adult Residential Facility";
      const facilityGroup = typeToGroup(facilityType);
      const prev       = existing.get(num);

      return {
        number:            num,
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
        totalTypeB:        0,
        citations:         0,
        lat:               prev?.lat ?? null,
        lng:               prev?.lng ?? null,
        geocodeQuality:    prev?.geocodeQuality ?? "",
      };
    });

  console.log(`Mapped ${facilities.length} facilities\n`);

  // Step 3: geocode facilities that don't have coordinates yet
  const needsGeocode = facilities.filter(
    (f) => f.lat === null && f.geocodeQuality !== "geocode_failed" && f.address && f.city,
  );
  console.log(`Geocoding ${needsGeocode.length} facilities via Nominatim (${Math.ceil(needsGeocode.length / 1000 * (GEOCODE_DELAY / 60000)).toFixed(0)}+ minutes)…`);
  console.log("Tip: Re-run the script to resume — already-geocoded entries are cached.\n");

  let geocoded = 0;
  let failed = 0;
  const facilityByNumber = new Map(facilities.map((f) => [f.number, f]));

  for (const f of needsGeocode) {
    const coords = await geocode(f.name, f.address, f.city, f.zip);
    const entry  = facilityByNumber.get(f.number)!;

    if (coords) {
      entry.lat            = coords.lat;
      entry.lng            = coords.lng;
      entry.geocodeQuality = "nominatim";
      geocoded++;
    } else {
      entry.geocodeQuality = "geocode_failed";
      failed++;
    }

    if ((geocoded + failed) % 500 === 0) {
      // Checkpoint: save progress so far
      if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
      fs.writeFileSync(outPath, JSON.stringify(facilities, null, 2));
      console.log(`  checkpoint: ${geocoded} geocoded, ${failed} failed (${needsGeocode.length - geocoded - failed} remaining)`);
    }
  }

  // Stats
  const byGroup: Record<string, number> = {};
  for (const f of facilities) byGroup[f.facilityGroup] = (byGroup[f.facilityGroup] ?? 0) + 1;
  console.log("\n=== Facility Groups ===");
  for (const [group, count] of Object.entries(byGroup).sort())
    console.log(`  ${group}: ${count}`);

  const withCoords = facilities.filter((f) => f.lat !== null).length;
  console.log(`\n=== Geocoding Summary ===`);
  console.log(`  With coordinates: ${withCoords} / ${facilities.length}`);
  console.log(`  Geocoded this run: ${geocoded}`);
  console.log(`  Failed this run: ${failed}`);

  // Step 4: write output
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(facilities, null, 2));
  console.log(`\n✓ Saved ${facilities.length} facilities to ${outPath}`);
  console.log(`\nNext step: npx tsx scripts/seed-facilities-db.ts`);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
