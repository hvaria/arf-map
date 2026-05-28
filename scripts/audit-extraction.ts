/**
 * scripts/audit-extraction.ts
 *
 * Read-only data-quality audit focused on the **extraction merge step** —
 * the part of the pipeline that combines 7 CHHS CCL feeds + the GEO feed
 * + the CDSS Transparency API gap-fill into the `facilities` table.
 *
 * Where `audit-facilities.ts` reports on taxonomy/field-level health, this
 * script answers questions like:
 *   - Did every CCL feed's facilities actually land in the DB?
 *   - Are there facility numbers appearing in multiple CCL feeds (and did the
 *     "first-write wins" merge pick the freshest data)?
 *   - For a random sample of facilities, does the live CDSS Transparency API
 *     show data we don't have yet (status change, newer inspection date,
 *     capacity change)?
 *   - How many facilities are missing coordinates, and where?
 *
 * Usage:
 *   npx tsx scripts/audit-extraction.ts                # quick mode (DB-only + CCL totals)
 *   npx tsx scripts/audit-extraction.ts --duplicates   # +re-fetch all CCL feeds, find multi-feed dupes
 *   npx tsx scripts/audit-extraction.ts --deep         # +sample 100 LICENSED facilities, diff vs CDSS
 *   npx tsx scripts/audit-extraction.ts --deep --sample 250
 *
 * Requires DATABASE_URL env var.
 */

import "dotenv/config";
import { Pool } from "pg";
import {
  fetchCdssFacilityDetail,
  rateLimiter,
} from "./cdss-facility-detail";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set — check .env or $env:DATABASE_URL");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

const CHHS_BASE = "https://data.chhs.ca.gov/api/3/action/datastore_search";
const PAGE_SIZE = 5000;

interface CclFeed {
  label:      string;
  resourceId: string;
  /** Domain (`facility_group`) this feed maps to in our DB. */
  domain:     string;
}

const CCL_FEEDS: CclFeed[] = [
  { label: "ARF",       resourceId: "9f5d1d00-6b24-4f44-a158-9cbe4b43f117", domain: "Adult & Senior Care" },
  { label: "RCFE",      resourceId: "744d1583-f9eb-45b6-b0f8-b9a9dab936a6", domain: "Adult & Senior Care" },
  { label: "FFA",       resourceId: "5f5f7124-1a38-4b61-93b9-4e4be3b3b07d", domain: "Children's Residential" },
  { label: "RES_CHILD", resourceId: "c9df723a-437f-4dcd-be37-ec73ae518bb9", domain: "Children's Residential" },
  { label: "CCC",       resourceId: "7aed8063-cea7-4367-8651-c81643164ae0", domain: "Child Care" },
  { label: "FCCH",      resourceId: "4b5cc48d-03b1-4f42-a7d1-b9816903eb2b", domain: "Child Care" },
  { label: "HCO",       resourceId: "b4d78b7f-12df-4b0c-a81a-ff40b949bc75", domain: "Home Care" },
];

const GEO_RESOURCE = "f9c77b0d-9711-4f34-8c7f-90f542fbc24a";

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[audit ${ts}] ${msg}`);
}

function header(title: string) {
  console.log();
  console.log("═".repeat(72));
  console.log(`  ${title}`);
  console.log("═".repeat(72));
}

function row(label: string, value: string | number) {
  const lbl = label.padEnd(48);
  console.log(`  ${lbl} ${value}`);
}

function pct(n: number, total: number): string {
  if (total === 0) return "0.0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

async function fetchTotal(resourceId: string): Promise<number> {
  const url = `${CHHS_BASE}?resource_id=${resourceId}&limit=1`;
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) return -1;
  const j: any = await res.json();
  return Number(j?.result?.total ?? -1);
}

async function fetchAllNumbers(resourceId: string, field: string): Promise<Set<string>> {
  const out = new Set<string>();
  let offset = 0;
  while (true) {
    const url = `${CHHS_BASE}?resource_id=${resourceId}&limit=${PAGE_SIZE}&offset=${offset}`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) break;
    const j: any = await res.json();
    const records: any[] = j?.result?.records ?? [];
    for (const r of records) {
      const v = String(r[field] ?? "").trim();
      if (v) out.add(v);
    }
    if (records.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }
  return out;
}

async function sectionCclCoverage() {
  header("1. CCL feed coverage — CHHS totals vs. our DB");

  // We can't perfectly separate per-feed counts (e.g., ARF vs RCFE) in the DB
  // without a source_feed column, so we sum CHHS totals to the domain level
  // and compare against DB counts grouped by facility_group.
  const byDomain = new Map<string, number>();
  for (const feed of CCL_FEEDS) {
    const t = await fetchTotal(feed.resourceId);
    byDomain.set(feed.domain, (byDomain.get(feed.domain) ?? 0) + t);
  }

  console.log();
  console.log(`  ${"domain".padEnd(28)} ${"chhs total".padStart(11)} ${"in DB".padStart(11)} ${"diff".padStart(8)}`);
  console.log("  " + "-".repeat(64));
  for (const [domain, chhsTotal] of byDomain.entries()) {
    const dbRow = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM facilities WHERE facility_group = $1`,
      [domain],
    );
    const dbN = Number(dbRow.rows[0]?.n ?? 0);
    const diff = dbN - chhsTotal;
    const flag = Math.abs(diff) > Math.max(20, chhsTotal * 0.01) ? " ⚠️" : "";
    console.log(
      `  ${domain.padEnd(28)} ${chhsTotal.toLocaleString().padStart(11)} ` +
      `${dbN.toLocaleString().padStart(11)} ${(diff >= 0 ? "+" : "") + diff}${flag}`,
    );
  }
}

async function sectionDbHealth() {
  header("2. DB health snapshot");

  const total = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM facilities`)).rows[0].n);
  row("Total facilities", total.toLocaleString());

  // By status
  const byStatus = await pool.query<{ status: string; n: number }>(
    `SELECT status, COUNT(*)::int AS n FROM facilities GROUP BY status ORDER BY n DESC`,
  );
  console.log();
  console.log("  Status breakdown:");
  for (const r of byStatus.rows) {
    console.log(`    ${(r.status || "(empty)").padEnd(30)} ${Number(r.n).toLocaleString().padStart(8)}  ${pct(Number(r.n), total).padStart(6)}`);
  }

  // By group
  const byGroup = await pool.query<{ facility_group: string; n: number }>(
    `SELECT facility_group, COUNT(*)::int AS n FROM facilities GROUP BY facility_group ORDER BY n DESC`,
  );
  console.log();
  console.log("  Group breakdown:");
  for (const r of byGroup.rows) {
    console.log(`    ${(r.facility_group || "(empty)").padEnd(30)} ${Number(r.n).toLocaleString().padStart(8)}  ${pct(Number(r.n), total).padStart(6)}`);
  }
}

async function sectionGeoCoverage() {
  header("3. Geocoding coverage");

  const total = Number((await pool.query(`SELECT COUNT(*)::int AS n FROM facilities`)).rows[0].n);
  const withCoords = Number(
    (await pool.query(`SELECT COUNT(*)::int AS n FROM facilities WHERE lat IS NOT NULL AND lng IS NOT NULL`)).rows[0].n,
  );
  const licensedTotal = Number(
    (await pool.query(`SELECT COUNT(*)::int AS n FROM facilities WHERE status = 'LICENSED'`)).rows[0].n,
  );
  const licensedWithCoords = Number(
    (await pool.query(`SELECT COUNT(*)::int AS n FROM facilities WHERE status = 'LICENSED' AND lat IS NOT NULL AND lng IS NOT NULL`)).rows[0].n,
  );

  row("With coordinates (all)", `${withCoords.toLocaleString()} / ${total.toLocaleString()} (${pct(withCoords, total)})`);
  row("With coordinates (LICENSED only)", `${licensedWithCoords.toLocaleString()} / ${licensedTotal.toLocaleString()} (${pct(licensedWithCoords, licensedTotal)})`);

  // By geocode_quality
  const byQuality = await pool.query<{ geocode_quality: string; n: number }>(
    `SELECT COALESCE(NULLIF(geocode_quality, ''), '(empty)') AS geocode_quality,
            COUNT(*)::int AS n
     FROM facilities GROUP BY 1 ORDER BY n DESC`,
  );
  console.log();
  console.log("  geocode_quality breakdown:");
  for (const r of byQuality.rows) {
    console.log(`    ${r.geocode_quality.padEnd(30)} ${Number(r.n).toLocaleString().padStart(8)}  ${pct(Number(r.n), total).padStart(6)}`);
  }

  // Missing-coords by group (so we know where geocoding is weak)
  const missingByGroup = await pool.query<{ facility_group: string; n: number }>(
    `SELECT facility_group, COUNT(*)::int AS n
     FROM facilities WHERE lat IS NULL OR lng IS NULL
     GROUP BY 1 ORDER BY n DESC`,
  );
  console.log();
  console.log("  Missing coords by group:");
  for (const r of missingByGroup.rows) {
    console.log(`    ${(r.facility_group || "(empty)").padEnd(30)} ${Number(r.n).toLocaleString().padStart(8)}`);
  }
}

async function sectionCriticalFields() {
  header("4. Critical-field completeness (LICENSED facilities only)");

  const total = Number(
    (await pool.query(`SELECT COUNT(*)::int AS n FROM facilities WHERE status = 'LICENSED'`)).rows[0].n,
  );

  const checks: Array<{ label: string; sql: string }> = [
    { label: "empty name",          sql: `name IS NULL OR name = ''` },
    { label: "empty address",       sql: `address IS NULL OR address = ''` },
    { label: "empty city",          sql: `city IS NULL OR city = ''` },
    { label: "empty county",        sql: `county IS NULL OR county = ''` },
    { label: "empty zip",           sql: `zip IS NULL OR zip = ''` },
    { label: "empty phone",         sql: `phone IS NULL OR phone = ''` },
    { label: "empty licensee",      sql: `licensee IS NULL OR licensee = ''` },
    { label: "empty administrator", sql: `administrator IS NULL OR administrator = ''` },
    { label: "zero capacity",       sql: `capacity = 0` },
    { label: "no first_license_date", sql: `first_license_date IS NULL OR first_license_date = ''` },
    { label: "no last_inspection_date", sql: `last_inspection_date IS NULL OR last_inspection_date = ''` },
  ];

  for (const c of checks) {
    const r = await pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM facilities WHERE status = 'LICENSED' AND (${c.sql})`,
    );
    const n = Number(r.rows[0].n);
    const flag = n / total > 0.5 ? " ⚠️" : "";
    row(c.label, `${n.toLocaleString()}  (${pct(n, total)})${flag}`);
  }
}

async function sectionFreshness() {
  header("5. Row freshness (updated_at)");

  const r1 = await pool.query<{ max_dt: number | null; min_dt: number | null }>(
    `SELECT MAX(updated_at) AS max_dt, MIN(updated_at) AS min_dt FROM facilities`,
  );
  const maxDt = Number(r1.rows[0]?.max_dt ?? 0);
  const minDt = Number(r1.rows[0]?.min_dt ?? 0);
  row("Newest updated_at", maxDt ? new Date(maxDt).toISOString() : "(none)");
  row("Oldest updated_at", minDt ? new Date(minDt).toISOString() : "(none)");

  // Bucket: how stale are rows relative to the newest?
  if (maxDt) {
    const day = 24 * 60 * 60 * 1000;
    const buckets = [
      { label: "fresh (<24h since newest run)", cutoff: maxDt - day },
      { label: "<7 days behind newest run",     cutoff: maxDt - 7 * day },
      { label: "<30 days behind newest run",    cutoff: maxDt - 30 * day },
    ];
    console.log();
    console.log("  Staleness buckets:");
    for (const b of buckets) {
      const r = await pool.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM facilities WHERE updated_at >= $1`,
        [b.cutoff],
      );
      console.log(`    ${b.label.padEnd(34)} ${Number(r.rows[0].n).toLocaleString().padStart(8)}`);
    }
  }
}

async function sectionDuplicates() {
  header("6. Multi-feed duplicates (re-fetching all 7 CCL feeds)");

  log("Fetching all CCL feeds (~10–15s)…");
  const feedNumbers = new Map<string, Set<string>>();
  for (const feed of CCL_FEEDS) {
    const nums = await fetchAllNumbers(feed.resourceId, "facility_number");
    feedNumbers.set(feed.label, nums);
    log(`  ${feed.label}: ${nums.size.toLocaleString()} unique numbers`);
  }

  // For each number, which feeds contain it?
  const numberToFeeds = new Map<string, string[]>();
  for (const [feedLabel, nums] of feedNumbers.entries()) {
    for (const n of nums) {
      const arr = numberToFeeds.get(n) ?? [];
      arr.push(feedLabel);
      numberToFeeds.set(n, arr);
    }
  }

  const dupes: Array<{ number: string; feeds: string[] }> = [];
  for (const [num, feeds] of numberToFeeds.entries()) {
    if (feeds.length > 1) dupes.push({ number: num, feeds });
  }

  console.log();
  row("Facility numbers across multiple feeds", dupes.length.toLocaleString());

  if (dupes.length === 0) return;

  // Pair frequency
  const pairCounts = new Map<string, number>();
  for (const d of dupes) {
    const key = d.feeds.sort().join(" + ");
    pairCounts.set(key, (pairCounts.get(key) ?? 0) + 1);
  }
  console.log();
  console.log("  Pair frequency (which feeds overlap):");
  const sorted = [...pairCounts.entries()].sort((a, b) => b[1] - a[1]);
  for (const [pair, n] of sorted) {
    console.log(`    ${pair.padEnd(50)} ${n.toLocaleString().padStart(6)}`);
  }

  // First 10 examples
  console.log();
  console.log("  Sample (first 10):");
  for (const d of dupes.slice(0, 10)) {
    const dbRow = await pool.query<{ name: string; facility_type: string; facility_group: string }>(
      `SELECT name, facility_type, facility_group FROM facilities WHERE number = $1`,
      [d.number],
    );
    const r = dbRow.rows[0];
    const dbInfo = r ? `${r.name} | ${r.facility_type} | ${r.facility_group}` : "(not in DB)";
    console.log(`    ${d.number}  [${d.feeds.join(", ")}]  →  ${dbInfo}`);
  }
}

async function sectionGeoOnly() {
  header("7. GEO-only facilities (in GEO feed, not in any CCL feed)");

  log("Fetching CCL feed numbers (~6s)…");
  const cclNumbers = new Set<string>();
  for (const feed of CCL_FEEDS) {
    const nums = await fetchAllNumbers(feed.resourceId, "facility_number");
    for (const n of nums) cclNumbers.add(n);
  }
  log(`  CCL union: ${cclNumbers.size.toLocaleString()} unique numbers`);

  log("Fetching GEO numbers (~3s)…");
  const geoNumbers = await fetchAllNumbers(GEO_RESOURCE, "FAC_NBR");
  log(`  GEO: ${geoNumbers.size.toLocaleString()} unique numbers`);

  const geoOnly = [...geoNumbers].filter((n) => !cclNumbers.has(n));
  console.log();
  row("GEO-only facility numbers", geoOnly.length.toLocaleString());

  // How many of these are in our DB already? (Means a previous gap-fill ran)
  const inDb = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM facilities WHERE number = ANY($1::text[])`,
    [geoOnly],
  );
  const inDbN = Number(inDb.rows[0].n);
  row("  → already in our DB (prev gap-fill)", `${inDbN.toLocaleString()} (${pct(inDbN, geoOnly.length)})`);
  row("  → missing from DB",                   `${(geoOnly.length - inDbN).toLocaleString()}`);

  if (geoOnly.length - inDbN > 0) {
    console.log();
    console.log("  → Run the extract again (with gap-fill enabled) to pull these from CDSS.");
  }
}

async function sectionCdssSpotCheck(sampleSize: number) {
  header(`8. CDSS Transparency API spot-check (sample ${sampleSize} LICENSED facilities)`);

  log(`Picking ${sampleSize} random LICENSED facilities with last_inspection_date set…`);
  const sample = await pool.query<{
    number: string;
    name: string;
    status: string;
    capacity: number;
    last_inspection_date: string;
    updated_at: number;
  }>(
    `SELECT number, name, status, capacity, last_inspection_date, updated_at
     FROM facilities
     WHERE status = 'LICENSED'
     ORDER BY random()
     LIMIT $1`,
    [sampleSize],
  );

  if (sample.rows.length === 0) {
    log("  No LICENSED rows to sample. Skipping.");
    return;
  }

  const throttle = rateLimiter(3); // 3 req/s
  let nameMismatch = 0;
  let statusMismatch = 0;
  let capacityMismatch = 0;
  let cdssNewerInspection = 0;
  let cdssNoData = 0;
  const examples: string[] = [];

  for (let i = 0; i < sample.rows.length; i++) {
    const r = sample.rows[i];
    await throttle();
    const cdss = await fetchCdssFacilityDetail(r.number);
    if (!cdss) { cdssNoData++; continue; }

    const cdssName = String(cdss.FACILITYNAME ?? "").trim();
    const cdssStatus = String(cdss.STATUS ?? "").toUpperCase();
    const cdssCapacity = parseInt(String(cdss.CAPACITY ?? "0"), 10) || 0;
    const cdssInspRaw = String(cdss.VSTDATEINSP ?? cdss.LASTVISITDATE ?? "");
    const cdssInspNorm = normalizeMdyToIso(cdssInspRaw);

    let mismatched = false;
    if (cdssName && cdssName.toUpperCase() !== r.name.toUpperCase()) {
      nameMismatch++;
      mismatched = true;
    }
    if (cdssStatus && cdssStatus !== r.status) {
      statusMismatch++;
      mismatched = true;
    }
    if (cdssCapacity && cdssCapacity !== r.capacity) {
      capacityMismatch++;
      mismatched = true;
    }
    if (cdssInspNorm && r.last_inspection_date && cdssInspNorm > r.last_inspection_date) {
      cdssNewerInspection++;
      mismatched = true;
    }
    if (mismatched && examples.length < 10) {
      examples.push(
        `    ${r.number}: db=[${r.name} | ${r.status} | cap ${r.capacity} | insp ${r.last_inspection_date}] cdss=[${cdssName} | ${cdssStatus} | cap ${cdssCapacity} | insp ${cdssInspNorm}]`,
      );
    }

    if ((i + 1) % 25 === 0 || i === sample.rows.length - 1) {
      process.stdout.write(`\r  checked ${i + 1}/${sample.rows.length}…`);
    }
  }
  process.stdout.write("\n");

  console.log();
  row("CDSS had no record",         `${cdssNoData}  (${pct(cdssNoData, sample.rows.length)})`);
  row("Name mismatch",              `${nameMismatch}  (${pct(nameMismatch, sample.rows.length)})`);
  row("Status mismatch",            `${statusMismatch}  (${pct(statusMismatch, sample.rows.length)})`);
  row("Capacity mismatch",          `${capacityMismatch}  (${pct(capacityMismatch, sample.rows.length)})`);
  row("CDSS has newer inspection",  `${cdssNewerInspection}  (${pct(cdssNewerInspection, sample.rows.length)})`);

  if (examples.length > 0) {
    console.log();
    console.log("  Sample mismatches (up to 10):");
    for (const e of examples) console.log(e);
  }

  if (cdssNewerInspection / sample.rows.length > 0.1) {
    console.log();
    console.log("  ⚠️  >10% of sampled facilities have a newer inspection date in CDSS.");
    console.log("     Consider running `npx tsx scripts/enrich-from-transparency.ts` to refresh.");
  }
}

function normalizeMdyToIso(raw: string): string {
  if (!raw) return "";
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return raw;
}

async function main() {
  const argv = process.argv.slice(2);
  const runDupes = argv.includes("--duplicates");
  const runDeep = argv.includes("--deep");
  const sampleIdx = argv.indexOf("--sample");
  const sampleSize = sampleIdx >= 0 ? parseInt(argv[sampleIdx + 1] ?? "100", 10) : 100;

  log(`Audit modes: quick${runDupes ? " +duplicates" : ""}${runDeep ? ` +deep(${sampleSize})` : ""}`);

  await sectionDbHealth();
  await sectionGeoCoverage();
  await sectionCriticalFields();
  await sectionFreshness();
  await sectionCclCoverage();
  await sectionGeoOnly();

  if (runDupes) {
    await sectionDuplicates();
  } else {
    console.log();
    console.log("  (skipping multi-feed duplicates — pass --duplicates to enable; takes ~10–15s extra)");
  }

  if (runDeep) {
    await sectionCdssSpotCheck(sampleSize);
  } else {
    console.log();
    console.log(`  (skipping CDSS spot-check — pass --deep to enable; takes ~${Math.ceil(sampleSize / 3 / 60)} min for ${sampleSize} samples)`);
  }

  console.log();
  log("━━━ Audit complete ━━━");
  await pool.end();
}

main().catch((err) => {
  console.error("[audit] Fatal:", err);
  pool.end();
  process.exit(1);
});
