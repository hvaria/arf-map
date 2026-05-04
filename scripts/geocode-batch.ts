/**
 * scripts/geocode-batch.ts
 *
 * Geocodes facilities missing lat/lng using the US Census Geocoder batch API.
 * Free, no API key, ~30-60 min for ~40k addresses.
 *
 * Endpoint: https://geocoding.geo.census.gov/geocoder/locations/addressbatch
 * Limit: 10,000 addresses per batch.
 *
 * Strategy:
 *   1. Select facilities WHERE lat IS NULL AND address != '' AND city != ''
 *   2. Submit in batches of 5,000 (margin under 10k limit)
 *   3. Parse response CSV; matched rows get coords + geocode_quality='census_batch'
 *   4. Unmatched rows get geocode_quality='census_no_match' so we skip them next run
 *
 * Re-runnable — the WHERE clause excludes anything already attempted.
 *
 * Usage: npx tsx scripts/geocode-batch.ts
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set — check .env");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const ENDPOINT = "https://geocoding.geo.census.gov/geocoder/locations/addressbatch";
const BENCHMARK = "Public_AR_Current";
const BATCH_SIZE = 5000;
const MAX_RETRIES = 3;

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[geocode ${ts}] ${msg}`);
}

interface PendingRow {
  number: string;
  address: string;
  city: string;
  zip: string;
}

async function fetchPending(): Promise<PendingRow[]> {
  const r = await pool.query<PendingRow>(`
    SELECT number, address, city, zip
    FROM facilities
    WHERE lat IS NULL
      AND address <> ''
      AND city <> ''
      AND geocode_quality NOT IN ('census_no_match', 'census_error')
    ORDER BY number
  `);
  return r.rows;
}

/**
 * Escape a CSV field. Census wants commas in addresses to be quoted.
 */
function csvField(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) {
    return `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function buildCsv(rows: PendingRow[]): string {
  // Format: id, street, city, state, zip — no header row
  return rows
    .map((r) => [r.number, r.address, r.city, "CA", r.zip].map(csvField).join(","))
    .join("\n");
}

interface CensusResult {
  id: string;
  matched: boolean;
  lat: number | null;
  lng: number | null;
}

/**
 * Parse the CSV response from the Census batch geocoder.
 * Format per row: id, input_address, match_status, match_type, matched_address, coordinates, tiger_line_id, side
 *   - match_status: "Match" | "Tie" | "No_Match"
 *   - coordinates: "lng,lat" (note ordering is lng first)
 */
function parseCensusCsv(csv: string): CensusResult[] {
  const out: CensusResult[] = [];
  // Census CSV uses simple CRLF; some rows have quoted fields with commas inside
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  for (const line of lines) {
    const fields = parseCsvLine(line);
    // Match rows have 8 fields; No_Match rows have 3 (id, input, status).
    if (fields.length < 3) continue;
    const id = fields[0];
    const status = fields[2];
    const coords = fields[5] ?? "";
    if (status === "Match" && coords.includes(",")) {
      const [lng, lat] = coords.split(",").map((s) => parseFloat(s));
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        out.push({ id, matched: true, lat, lng });
        continue;
      }
    }
    out.push({ id, matched: false, lat: null, lng: null });
  }
  return out;
}

/** Minimal RFC4180-ish CSV line parser (handles quoted fields, escaped quotes). */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let i = 0;
  let cur = "";
  let inQuotes = false;
  while (i < line.length) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 2;
      } else if (c === '"') {
        inQuotes = false;
        i++;
      } else {
        cur += c;
        i++;
      }
    } else {
      if (c === ",") {
        out.push(cur);
        cur = "";
        i++;
      } else if (c === '"' && cur === "") {
        inQuotes = true;
        i++;
      } else {
        cur += c;
        i++;
      }
    }
  }
  out.push(cur);
  return out;
}

async function postBatch(csv: string): Promise<string> {
  const fd = new FormData();
  const blob = new Blob([csv], { type: "text/csv" });
  fd.append("addressFile", blob, "batch.csv");
  fd.append("benchmark", BENCHMARK);

  const res = await fetch(ENDPOINT, { method: "POST", body: fd });
  if (!res.ok) {
    throw new Error(`Census API ${res.status}: ${await res.text().catch(() => "")}`);
  }
  return res.text();
}

async function postWithRetry(csv: string, attempt = 1): Promise<string> {
  try {
    return await postBatch(csv);
  } catch (err) {
    if (attempt >= MAX_RETRIES) throw err;
    const wait = 5000 * attempt;
    log(`  batch failed (attempt ${attempt}/${MAX_RETRIES}): ${(err as Error).message}`);
    log(`  retrying in ${wait / 1000}s…`);
    await new Promise((r) => setTimeout(r, wait));
    return postWithRetry(csv, attempt + 1);
  }
}

async function applyResults(results: CensusResult[]): Promise<{ matched: number; unmatched: number }> {
  let matched = 0;
  let unmatched = 0;
  const matchedRows = results.filter((r) => r.matched);
  const unmatchedIds = results.filter((r) => !r.matched).map((r) => r.id);

  // Update matched rows in chunks
  const CHUNK = 500;
  for (let i = 0; i < matchedRows.length; i += CHUNK) {
    const chunk = matchedRows.slice(i, i + CHUNK);
    if (chunk.length === 0) break;
    // Build a single VALUES expression and JOIN-update
    const params: unknown[] = [];
    const tuples: string[] = [];
    for (const r of chunk) {
      const start = params.length;
      params.push(r.id, r.lat, r.lng);
      tuples.push(`($${start + 1}, $${start + 2}::double precision, $${start + 3}::double precision)`);
    }
    const sql = `
      UPDATE facilities AS f
      SET lat = v.lat, lng = v.lng, geocode_quality = 'census_batch'
      FROM (VALUES ${tuples.join(",")}) AS v(num, lat, lng)
      WHERE f.number = v.num
    `;
    const r = await pool.query(sql, params);
    matched += r.rowCount ?? 0;
  }

  // Mark unmatched rows so we don't retry them next time
  if (unmatchedIds.length > 0) {
    const r = await pool.query(
      `UPDATE facilities SET geocode_quality = 'census_no_match' WHERE number = ANY($1::text[])`,
      [unmatchedIds],
    );
    unmatched = r.rowCount ?? 0;
  }

  return { matched, unmatched };
}

async function main() {
  const startMs = Date.now();
  log("━━━ Census batch geocoder ━━━");

  const pending = await fetchPending();
  log(`Pending rows (no coords yet, has address+city): ${pending.length.toLocaleString()}`);

  if (pending.length === 0) {
    log("Nothing to do. Exiting.");
    await pool.end();
    return;
  }

  let totalMatched = 0;
  let totalUnmatched = 0;
  let totalErrors = 0;

  const totalBatches = Math.ceil(pending.length / BATCH_SIZE);
  for (let bi = 0; bi < totalBatches; bi++) {
    const batch = pending.slice(bi * BATCH_SIZE, (bi + 1) * BATCH_SIZE);
    log(`Batch ${bi + 1}/${totalBatches} — ${batch.length} addresses…`);
    const csv = buildCsv(batch);

    // Optional: stash the batch CSV for debugging the first time
    if (bi === 0) {
      const debugPath = path.resolve(process.cwd(), "data", "_geocode-batch1.csv");
      fs.mkdirSync(path.dirname(debugPath), { recursive: true });
      fs.writeFileSync(debugPath, csv);
    }

    let response: string;
    try {
      response = await postWithRetry(csv);
    } catch (err) {
      log(`  batch ${bi + 1} failed permanently: ${(err as Error).message}`);
      // Mark these rows so we don't retry forever
      const ids = batch.map((b) => b.number);
      await pool.query(
        `UPDATE facilities SET geocode_quality = 'census_error' WHERE number = ANY($1::text[])`,
        [ids],
      );
      totalErrors += batch.length;
      continue;
    }

    const results = parseCensusCsv(response);
    const { matched, unmatched } = await applyResults(results);
    totalMatched += matched;
    totalUnmatched += unmatched;

    log(`  → matched ${matched}, unmatched ${unmatched}, parsed ${results.length} of ${batch.length}`);
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log();
  log(`━━━ Done in ${elapsed}s ━━━`);
  log(`Matched   : ${totalMatched.toLocaleString()}`);
  log(`Unmatched : ${totalUnmatched.toLocaleString()}`);
  log(`Errors    : ${totalErrors.toLocaleString()}`);

  // Final coverage summary
  const cov = await pool.query<{ withCoords: number; total: number }>(`
    SELECT
      COUNT(*) FILTER (WHERE lat IS NOT NULL)::int AS "withCoords",
      COUNT(*)::int AS total
    FROM facilities
  `);
  const c = cov.rows[0];
  log(`Coverage  : ${c.withCoords.toLocaleString()} / ${c.total.toLocaleString()} (${((c.withCoords / c.total) * 100).toFixed(1)}%)`);

  await pool.end();
}

main().catch((err) => {
  console.error("\n[geocode] Fatal:", err);
  pool.end();
  process.exit(1);
});
