/**
 * scripts/extract-all-ccld.ts
 *
 * Unified extractor + loader. Fetches all 6 CHHS CCL category feeds plus the
 * GEO feed (for coordinates), normalizes `facility_type` via the canonical
 * taxonomy in shared/taxonomy.ts, and upserts to PostgreSQL.
 *
 * After CCL rows are committed, runs a CDSS Transparency API gap-fill for
 * every facility number in GEO but missing from all CCL feeds — this catches
 * freshly-licensed facilities that CHHS hasn't yet published in its CCL feeds.
 *
 * Usage:
 *   npx tsx scripts/extract-all-ccld.ts
 *
 * Idempotent — upserts by facility number (PK).
 *
 * Env knobs:
 *   DATABASE_URL          (required) Postgres connection string
 *   SKIP_GAP_FILL=1       Bypass the CDSS gap-fill phase
 *   GAP_FILL_LIMIT=N      Cap CDSS calls (smoke test)
 *   GAP_FILL_RPS=N        CDSS requests per second (default 3)
 *   GAP_FILL_FLUSH=N      DB flush batch during gap-fill (default 50)
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import { normalizeRawType, resolveGeoTypeCode } from "../shared/taxonomy";
import { formatPhone } from "../shared/etl-types";
import {
  fetchCdssFacilityDetail,
  buildRowFromCdss,
  rateLimiter,
  type GeoCoords,
} from "./cdss-facility-detail";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set — check .env");
  process.exit(1);
}

// keepAlive keeps the TCP socket alive across the long CDSS gap-fill phase
// (typically 20+ minutes) so the Fly proxy doesn't drop the connection.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  keepAlive: true,
  keepAliveInitialDelayMillis: 30_000,
  idleTimeoutMillis: 0,
});

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

  // ── Step 0: verify DB reachable BEFORE doing 13s of CHHS API work ───────
  try {
    await pool.query("SELECT 1");
    log("DB reachable ✓");
  } catch (err: any) {
    console.error("\n[etl] DB ping failed:", err?.code ?? err?.message);
    console.error("\nIf you're running through `fly proxy 15432:5432 -a ncu-db`,");
    console.error("the proxy's upstream session may have gone stale. Stop it");
    console.error("(Ctrl-C in the proxy window) and restart it, then try again.\n");
    await pool.end();
    process.exit(1);
  }

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

  // ── Step 6: upsert CCL rows to PG in chunks ─────────────────────────────
  // Write CCL data FIRST, before the long-running gap-fill phase, so we
  // never lose a working CCL extract to a late-stage network blip.
  const rows = [...builtByNumber.values()];
  const CHUNK = 500;
  let written = 0;

  log(`Upserting ${rows.length.toLocaleString()} CCL facilities to PostgreSQL…`);

  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    await upsertChunk(chunk);
    written += chunk.length;
    process.stdout.write(`\r    ${written.toLocaleString()} / ${rows.length.toLocaleString()}`);
  }
  process.stdout.write("\n");
  console.log();

  // ── Step 7: gap-fill from CDSS Transparency API ─────────────────────────
  // CHHS publishes the CCL category feeds with a lag — newly-licensed
  // facilities may appear in the GEO feed (coordinates) before they appear
  // in any CCL feed (license metadata). For each GEO-only facility number,
  // ask CDSS directly. Skip ones already in our DB.
  //
  // Each fetched row is upserted immediately in small batches so a late
  // network blip doesn't waste 20+ minutes of CDSS API calls.
  //
  // Disable with SKIP_GAP_FILL=1 if you need to bypass the extra API calls.
  if (process.env.SKIP_GAP_FILL !== "1") {
    const geoOnlyNumbers = [...geoByNumber.keys()].filter((n) => !builtByNumber.has(n));
    log(`Gap-fill candidates (in GEO, not in any CCL feed): ${geoOnlyNumbers.length.toLocaleString()}`);

    // Skip facilities already in the DB — most GEO-only numbers persist for
    // weeks before CHHS catches up, so we'd waste calls re-fetching them.
    let toFetch: string[] = geoOnlyNumbers;
    if (geoOnlyNumbers.length > 0) {
      const existing = await pool.query<{ number: string }>(
        `SELECT number FROM facilities WHERE number = ANY($1::text[])`,
        [geoOnlyNumbers],
      );
      const existingSet = new Set(existing.rows.map((r) => r.number));
      toFetch = geoOnlyNumbers.filter((n) => !existingSet.has(n));
      log(`  already in DB (skipped): ${(geoOnlyNumbers.length - toFetch.length).toLocaleString()}`);
      log(`  to fetch from CDSS:      ${toFetch.length.toLocaleString()}`);
    }

    const limit = parseInt(process.env.GAP_FILL_LIMIT ?? "", 10);
    if (Number.isFinite(limit) && limit > 0 && toFetch.length > limit) {
      log(`  GAP_FILL_LIMIT=${limit} — capping fetch list`);
      toFetch = toFetch.slice(0, limit);
    }

    if (toFetch.length > 0) {
      const throttle = rateLimiter(parseFloat(process.env.GAP_FILL_RPS ?? "3"));
      const FLUSH_EVERY = parseInt(process.env.GAP_FILL_FLUSH ?? "50", 10);
      const startGap = Date.now();
      let gapAdded = 0;
      let gapMissing = 0;
      let pendingBatch: BuiltRow[] = [];
      const newNames: string[] = [];

      const flush = async (): Promise<void> => {
        if (pendingBatch.length === 0) return;
        await upsertChunk(pendingBatch);
        pendingBatch = [];
      };

      for (let i = 0; i < toFetch.length; i++) {
        const num = toFetch[i];
        await throttle();
        const cdss = await fetchCdssFacilityDetail(num);
        if (!cdss) {
          gapMissing++;
        } else {
          const geo = geoByNumber.get(num);
          const coords: GeoCoords | null = geo
            ? {
                lat:      parseFloat(geo.FAC_LATITUDE),
                lng:      parseFloat(geo.FAC_LONGITUDE),
                typeCode: cleanString(geo.FAC_TYPE_CODE),
              }
            : null;
          const row = buildRowFromCdss(num, cdss, coords);
          pendingBatch.push({
            ...row,
            source_feed:       "CDSS_GAPFILL",
            raw_facility_type: row.facility_type,
          } as BuiltRow);
          gapAdded++;
          if (newNames.length < 20) newNames.push(`${num} — ${row.name} (${row.city})`);

          if (pendingBatch.length >= FLUSH_EVERY) {
            await flush();
          }
        }

        if ((i + 1) % 50 === 0 || i === toFetch.length - 1) {
          process.stdout.write(
            `\r    gap-fill ${i + 1}/${toFetch.length} — added ${gapAdded}, missing ${gapMissing}, flushed ${gapAdded - pendingBatch.length}`,
          );
        }
      }

      // Final flush
      await flush();
      process.stdout.write("\n");

      const elapsedGap = ((Date.now() - startGap) / 1000).toFixed(1);
      log(`Gap-fill complete in ${elapsedGap}s — added ${gapAdded}, missing-in-CDSS ${gapMissing}`);
      if (newNames.length > 0) {
        log(`  sample of newly added:`);
        for (const n of newNames) log(`    + ${n}`);
      }
      console.log();
    }
  } else {
    log("Gap-fill skipped (SKIP_GAP_FILL=1)");
    console.log();
  }

  // ── Step 8: summary ─────────────────────────────────────────────────────
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

  // Retry transient connection errors — common when running through a long-
  // lived Fly proxy where the upstream socket can get reset between bursts.
  const TRANSIENT_CODES = new Set([
    "ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EPIPE", "ENOTFOUND",
    "57P01", // admin_shutdown
    "57P02", // crash_shutdown
    "57P03", // cannot_connect_now
    "08000", "08003", "08006", "08001", "08004", // connection_exception family
  ]);
  let attempt = 0;
  while (true) {
    try {
      await pool.query(sql, params);
      return;
    } catch (err: any) {
      const code = String(err?.code ?? "");
      if (!TRANSIENT_CODES.has(code) || attempt >= 4) throw err;
      attempt++;
      const waitMs = 1000 * Math.pow(2, attempt); // 2s, 4s, 8s, 16s
      console.error(`\n    upsert transient error (${code}) — attempt ${attempt}/4, waiting ${waitMs}ms…`);
      await new Promise((r) => setTimeout(r, waitMs));
    }
  }
}

main().catch((err) => {
  console.error("\n[etl] Fatal:", err);
  pool.end();
  process.exit(1);
});
