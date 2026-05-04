/**
 * scripts/geocode-nominatim-fallback.ts
 *
 * Retries the rows that the Census batch geocoder couldn't match
 * (geocode_quality='census_no_match'), using Nominatim/OpenStreetMap.
 *
 * Nominatim's ToS requires ≥1 req/sec — so 841 rows takes ~15 min.
 *
 * Usage: npx tsx scripts/geocode-nominatim-fallback.ts
 */

import "dotenv/config";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set — check .env");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const NOMINATIM = "https://nominatim.openstreetmap.org/search";
const UA = "arf-map-geocoder/1.0 (himanshu.varia@xlncexotic.com)";
const DELAY_MS = 1100;

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[nominatim ${ts}] ${msg}`);
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

interface Row {
  number: string;
  name: string;
  address: string;
  city: string;
  zip: string;
}

async function geocode(name: string, address: string, city: string, zip: string): Promise<{ lat: number; lng: number } | null> {
  // Try progressively more permissive queries
  const queries = [
    `${name}, ${address}, ${city}, CA, ${zip}`,
    `${address}, ${city}, CA, ${zip}`,
    `${address}, ${city}, CA`,
  ];
  for (const q of queries) {
    const params = new URLSearchParams({
      q: q.trim(),
      format: "json",
      limit: "1",
      countrycodes: "us",
    });
    try {
      const res = await fetch(`${NOMINATIM}?${params}`, {
        headers: { "User-Agent": UA, Accept: "application/json" },
      });
      await sleep(DELAY_MS);
      if (!res.ok) continue;
      const json: any = await res.json();
      if (!Array.isArray(json) || json.length === 0) continue;
      const lat = parseFloat(json[0].lat);
      const lng = parseFloat(json[0].lon);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    } catch {
      await sleep(DELAY_MS);
    }
  }
  return null;
}

async function main() {
  const startMs = Date.now();
  log("━━━ Nominatim fallback geocoder ━━━");

  const r = await pool.query<Row>(`
    SELECT number, name, address, city, zip
    FROM facilities
    WHERE geocode_quality = 'census_no_match'
      AND address <> ''
      AND city <> ''
    ORDER BY number
  `);
  const rows = r.rows;
  log(`Pending (census_no_match with address): ${rows.length.toLocaleString()}`);

  if (rows.length === 0) {
    log("Nothing to do.");
    await pool.end();
    return;
  }

  let matched = 0;
  let failed = 0;
  const startedAt = Date.now();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const coords = await geocode(row.name, row.address, row.city, row.zip);
    if (coords) {
      await pool.query(
        `UPDATE facilities SET lat=$1, lng=$2, geocode_quality='nominatim_fallback' WHERE number=$3`,
        [coords.lat, coords.lng, row.number],
      );
      matched++;
    } else {
      await pool.query(
        `UPDATE facilities SET geocode_quality='nominatim_no_match' WHERE number=$1`,
        [row.number],
      );
      failed++;
    }

    if ((i + 1) % 50 === 0 || i === rows.length - 1) {
      const elapsed = (Date.now() - startedAt) / 1000;
      const eta = ((rows.length - i - 1) * (elapsed / (i + 1))).toFixed(0);
      log(`  ${i + 1}/${rows.length} — matched ${matched}, failed ${failed} — ETA ${eta}s`);
    }
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log();
  log(`━━━ Done in ${elapsed}s ━━━`);
  log(`Matched: ${matched} | Failed: ${failed}`);

  const cov = await pool.query<{ withCoords: number; total: number }>(`
    SELECT
      COUNT(*) FILTER (WHERE lat IS NOT NULL)::int AS "withCoords",
      COUNT(*)::int AS total
    FROM facilities
  `);
  const c = cov.rows[0];
  log(`Coverage: ${c.withCoords.toLocaleString()} / ${c.total.toLocaleString()} (${((c.withCoords / c.total) * 100).toFixed(1)}%)`);

  await pool.end();
}

main().catch((err) => {
  console.error("\nFatal:", err);
  pool.end();
  process.exit(1);
});
