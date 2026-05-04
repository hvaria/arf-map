/**
 * scripts/extract-all-ccld.ts
 *
 * Unified extractor + loader. Fetches all 6 CHHS CCL category feeds plus the
 * GEO feed (for coordinates), normalizes `facility_type` via the canonical
 * taxonomy in shared/taxonomy.ts, and upserts to PostgreSQL.
 *
 * Usage:
 *   npx tsx scripts/extract-all-ccld.ts
 *
 * Idempotent — upserts by facility number (PK).
 *
 * Skips Nominatim geocoding (separate phase). Coordinates come from the GEO
 * source; CCL rows without a GEO match will have null lat/lng.
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import { normalizeRawType, resolveGeoTypeCode } from "../shared/taxonomy";
import { formatPhone } from "../shared/etl-types";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set — check .env");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── CHHS sources ─────────────────────────────────────────────────────────────

const CHHS_BASE = "https://data.chhs.ca.gov/api/3/action/datastore_search";
const PAGE_SIZE = 5000;

interface CclSource {
  label: string;
  resourceId: string;
}

const CCL_FEEDS: CclSource[] = [
  { label: "ARF",       resourceId: "9f5d1d00-6b24-4f44-a158-9cbe4b43f117" },
  { label: "RCFE",      resourceId: "744d1583-f9eb-45b6-b0f8-b9a9dab936a6" },
  { label: "FFA",       resourceId: "5f5f7124-1a38-4b61-93b9-4e4be3b3b07d" },
  { label: "RES_CHILD", resourceId: "c9df723a-437f-4dcd-be37-ec73ae518bb9" },
  { label: "CCC",       resourceId: "7aed8063-cea7-4367-8651-c81643164ae0" },
  { label: "FCCH",      resourceId: "4b5cc48d-03b1-4f42-a7d1-b9816903eb2b" },
  { label: "HCO",       resourceId: "b4d78b7f-12df-4b0c-a81a-ff40b949bc75" },
];

const GEO_RESOURCE = "f9c77b0d-9711-4f34-8c7f-90f542fbc24a";

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[etl ${ts}] ${msg}`);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchAllPages(resourceId: string, label: string): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;
  let page = 1;
  while (true) {
    const params = new URLSearchParams({
      resource_id: resourceId,
      limit: String(PAGE_SIZE),
      offset: String(offset),
    });
    const res = await fetch(`${CHHS_BASE}?${params}`, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`CHHS ${res.status} for ${label} (${resourceId})`);
    const json: any = await res.json();
    const records: any[] = json.result?.records ?? [];
    rows.push(...records);
    if (records.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
    page++;
    await sleep(500);
  }
  return rows;
}

function cleanString(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  // CCL feeds use the literal string "Unavailable" for missing fields
  if (s.toLowerCase() === "unavailable") return "";
  return s;
}

function parseCapacity(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : 0;
}

function normalizeStatus(v: unknown): string {
  const s = cleanString(v).toUpperCase();
  if (!s) return "LICENSED";
  // Reject obvious bad values (e.g., a date string leaking into the status column)
  if (/^\d/.test(s)) return "LICENSED";
  return s;
}

interface BuiltRow {
  number: string;
  name: string;
  facility_type: string;
  facility_group: string;
  status: string;
  address: string;
  city: string;
  county: string;
  zip: string;
  phone: string;
  licensee: string;
  administrator: string;
  capacity: number;
  first_license_date: string;
  closed_date: string;
  last_inspection_date: string;
  total_visits: number;
  total_type_b: number;
  citations: number;
  lat: number | null;
  lng: number | null;
  geocode_quality: string;
  updated_at: number;
  source_feed: string;
  raw_facility_type: string;
}

async function main() {
  const startMs = Date.now();
  log("━━━ Unified CCLD ETL — fetching all 6 CCL feeds + GEO ━━━");

  // ── Step 1: fetch all CCL feeds ─────────────────────────────────────────
  const allCclRows: { row: any; sourceFeed: string }[] = [];
  for (const feed of CCL_FEEDS) {
    log(`Fetching ${feed.label} (${feed.resourceId})…`);
    const rows = await fetchAllPages(feed.resourceId, feed.label);
    log(`  → ${rows.length.toLocaleString()} rows`);
    for (const r of rows) allCclRows.push({ row: r, sourceFeed: feed.label });
  }
  log(`Total CCL rows across all feeds: ${allCclRows.length.toLocaleString()}`);
  console.log();

  // ── Step 2: fetch GEO feed for lat/lng ──────────────────────────────────
  log(`Fetching GEO source (${GEO_RESOURCE})…`);
  const geoRows = await fetchAllPages(GEO_RESOURCE, "GEO");
  log(`  → ${geoRows.length.toLocaleString()} GEO rows`);
  console.log();

  // ── Step 3: index GEO by FAC_NBR ────────────────────────────────────────
  const geoByNumber = new Map<string, any>();
  for (const g of geoRows) {
    const num = cleanString(g.FAC_NBR);
    if (!num) continue;
    geoByNumber.set(num, g);
  }
  log(`GEO index: ${geoByNumber.size.toLocaleString()} unique facility numbers`);

  // ── Step 4: build canonical rows + dedupe by facility number ────────────
  const builtByNumber = new Map<string, BuiltRow>();
  const unnormalized: { number: string; raw_facility_type: string; source_feed: string; name: string }[] = [];
  let withGeoCoords = 0;
  let cclSkipped = 0;

  const now = Date.now();

  for (const { row, sourceFeed } of allCclRows) {
    const num = cleanString(row.facility_number);
    if (!num) {
      cclSkipped++;
      continue;
    }

    const rawType = cleanString(row.facility_type);
    const tax = normalizeRawType(rawType);

    if (!tax) {
      unnormalized.push({
        number: num,
        raw_facility_type: rawType,
        source_feed: sourceFeed,
        name: cleanString(row.facility_name),
      });
    }

    const facilityType  = tax?.officialLabel ?? rawType;
    const facilityGroup = tax?.domain ?? "Unknown";

    // Lookup GEO match for coordinates (and as a fallback for type)
    const geo = geoByNumber.get(num);
    let lat: number | null = null;
    let lng: number | null = null;
    let geocodeQuality = "";
    if (geo) {
      const rawLat = parseFloat(geo.FAC_LATITUDE);
      const rawLng = parseFloat(geo.FAC_LONGITUDE);
      if (Number.isFinite(rawLat) && Number.isFinite(rawLng) && rawLat !== 0 && rawLng !== 0) {
        lat = rawLat;
        lng = rawLng;
        geocodeQuality = "chhs_geo";
        withGeoCoords++;
      }
    }

    const built: BuiltRow = {
      number: num,
      name: cleanString(row.facility_name),
      facility_type: facilityType,
      facility_group: facilityGroup,
      status: normalizeStatus(row.facility_status),
      address: cleanString(row.facility_address),
      city: cleanString(row.facility_city).toUpperCase(),
      county: cleanString(row.county_name).toUpperCase(),
      zip: cleanString(row.facility_zip),
      phone: formatPhone(cleanString(row.facility_telephone_number)),
      licensee: cleanString(row.licensee),
      administrator: cleanString(row.facility_administrator),
      capacity: parseCapacity(row.facility_capacity),
      first_license_date: cleanString(row.license_first_date),
      closed_date: cleanString(row.closed_date),
      last_inspection_date: "",
      total_visits: 0,
      total_type_b: 0,
      citations: 0,
      lat,
      lng,
      geocode_quality: geocodeQuality,
      updated_at: now,
      source_feed: sourceFeed,
      raw_facility_type: rawType,
    };

    // If a facility number appears in multiple feeds, prefer the first occurrence.
    // (Real-world: the same FAC_NBR shouldn't appear across categories, but
    // CHHS reuses some adoption-agency numbers in FFA. First-write wins is
    // sufficient for now and we report duplicates in stats.)
    if (!builtByNumber.has(num)) {
      builtByNumber.set(num, built);
    }
  }

  log(`Built ${builtByNumber.size.toLocaleString()} unique facilities (skipped ${cclSkipped} rows with no facility_number)`);
  log(`  → ${withGeoCoords.toLocaleString()} have GEO coordinates`);
  log(`  → ${unnormalized.length.toLocaleString()} rows have unrecognized facility_type (will be written with raw label)`);
  console.log();

  // ── Step 5: write unnormalized report ───────────────────────────────────
  if (unnormalized.length > 0) {
    const unmappedPath = path.resolve(process.cwd(), "data", "unnormalized.csv");
    fs.mkdirSync(path.dirname(unmappedPath), { recursive: true });
    const csv = [
      "number,raw_facility_type,source_feed,name",
      ...unnormalized.map((u) =>
        [u.number, u.raw_facility_type, u.source_feed, u.name]
          .map((s) => `"${String(s).replace(/"/g, '""')}"`)
          .join(","),
      ),
    ].join("\n");
    fs.writeFileSync(unmappedPath, csv);
    log(`Wrote ${unnormalized.length} unnormalized rows to ${unmappedPath}`);
  }

  // ── Step 6: upsert to PG in chunks ──────────────────────────────────────
  const rows = [...builtByNumber.values()];
  const CHUNK = 500;
  let written = 0;

  log(`Upserting ${rows.length.toLocaleString()} facilities to PostgreSQL…`);

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await upsertChunk(chunk);
    written += chunk.length;
    process.stdout.write(`\r    ${written.toLocaleString()} / ${rows.length.toLocaleString()}`);
  }
  process.stdout.write("\n");

  // ── Step 7: summary ─────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log();
  log(`━━━ Done in ${elapsed}s ━━━`);

  // Quick sanity check
  const r = await pool.query(`SELECT COUNT(*)::int AS n FROM facilities`);
  log(`facilities table now has ${Number(r.rows[0].n).toLocaleString()} rows`);

  await pool.end();
}

async function upsertChunk(chunk: BuiltRow[]): Promise<void> {
  if (chunk.length === 0) return;

  const cols = [
    "number", "name", "facility_type", "facility_group", "status",
    "address", "city", "county", "zip", "phone",
    "licensee", "administrator", "capacity",
    "first_license_date", "closed_date", "last_inspection_date",
    "total_visits", "total_type_b", "citations",
    "lat", "lng", "geocode_quality", "updated_at",
  ];

  const params: unknown[] = [];
  const valuesSql: string[] = [];

  for (const r of chunk) {
    const start = params.length;
    params.push(
      r.number, r.name, r.facility_type, r.facility_group, r.status,
      r.address, r.city, r.county, r.zip, r.phone,
      r.licensee, r.administrator, r.capacity,
      r.first_license_date, r.closed_date, r.last_inspection_date,
      r.total_visits, r.total_type_b, r.citations,
      r.lat, r.lng, r.geocode_quality, r.updated_at,
    );
    const placeholders = cols.map((_, i) => `$${start + i + 1}`).join(",");
    valuesSql.push(`(${placeholders})`);
  }

  const updateAssignments = cols
    .filter((c) => c !== "number")
    .map((c) => `${c} = EXCLUDED.${c}`)
    .join(", ");

  const sql = `
    INSERT INTO facilities (${cols.join(",")})
    VALUES ${valuesSql.join(",")}
    ON CONFLICT (number) DO UPDATE SET ${updateAssignments}
  `;

  await pool.query(sql, params);
}

main().catch((err) => {
  console.error("\n[etl] Fatal:", err);
  pool.end();
  process.exit(1);
});
