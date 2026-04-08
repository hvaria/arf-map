/**
 * scripts/etl.ts
 *
 * Standalone ETL — extracts California CCLD facility data from the CHHS open-
 * data API and loads it into the local SQLite database.
 *
 * Usage:
 *   npx tsx scripts/etl.ts
 *
 * No app server needed. Safe to re-run (idempotent upsert).
 * Edit scripts/etl-config.ts to change sources, fields, filters, or run mode.
 */

// ── 1. Bootstrap DB (creates all tables if they don't exist) ─────────────────
// Importing storage.ts is enough: its top-level sqlite.exec() calls are
// idempotent CREATE TABLE IF NOT EXISTS statements.
import { bulkUpsertFacilities, type FacilityDbRow } from "../server/storage";

// ── 2. Shared service helpers (exported from facilitiesService) ──────────────
import { typeToGroup, formatPhone } from "../server/services/facilitiesService";

// ── 3. ETL-specific helpers (fetchAllPages is not exported from the service) ──
import {
  fetchAllPages, GEO_STATUS, TYPE_TO_NAME, enrichFacilities,
  dedupeByNumber, mergeFacilityRow,
} from "./etl-helpers";

// ── 4. Config ─────────────────────────────────────────────────────────────────
import { ETL_CONFIG } from "./etl-config";

// ─────────────────────────────────────────────────────────────────────────────

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19); // HH:MM:SS
  console.log(`[etl ${ts}] ${msg}`);
}

async function main() {
  const startMs = Date.now();
  const { sources, fieldMap: fm, filterByGroups, filterByCounties,
          skipMissingGeo, includeCclOnly, dryRun, limit } = ETL_CONFIG;

  log("━━━ CCLD Facility ETL ━━━");
  log(`dry-run   : ${dryRun}`);
  log(`limit     : ${limit > 0 ? limit : "none (all records)"}`);
  log(`groups    : ${filterByGroups.length ? filterByGroups.join(", ") : "ALL"}`);
  log(`counties  : ${filterByCounties.length ? filterByCounties.join(", ") : "ALL"}`);
  log(`skip-no-geo: ${skipMissingGeo}`);
  console.log();

  // ── Step 1: Fetch GEO source ───────────────────────────────────────────────
  let geoRows: any[] = [];
  if (sources.geo.enabled) {
    log(`Fetching GEO source…  (resource: ${sources.geo.resourceId})`);
    geoRows = await fetchAllPages(sources.geo.resourceId, sources.geo.pageSize);
    log(`GEO: ${geoRows.length.toLocaleString()} rows fetched`);
  } else {
    log("GEO source disabled — skipping");
  }

  // ── Step 2: Fetch CCL source ───────────────────────────────────────────────
  let cclRows: any[] = [];
  if (sources.ccl.enabled) {
    log(`Fetching CCL source…  (resource: ${sources.ccl.resourceId})`);
    cclRows = await fetchAllPages(sources.ccl.resourceId, sources.ccl.pageSize);
    log(`CCL: ${cclRows.length.toLocaleString()} rows fetched`);
  } else {
    log("CCL source disabled — skipping");
  }

  console.log();

  // Guard: need at least one source
  if (geoRows.length === 0 && cclRows.length === 0) {
    log("No rows from either source. Exiting.");
    return;
  }

  // ── Step 3: Deduplicate each source by facility number ────────────────────
  const cclByNumber = dedupeByNumber(
    cclRows, (r) => String(r[fm.fromCcl.number] ?? ""), "CCL"
  );
  const geoByNumber = dedupeByNumber(
    geoRows, (r) => String(r[fm.fromGeo.number] ?? ""), "GEO"
  );
  log(`CCL index: ${cclByNumber.size.toLocaleString()} unique facility numbers`);
  log(`GEO index: ${geoByNumber.size.toLocaleString()} unique facility numbers`);

  // Build the union of all facility numbers (CCL ∪ GEO)
  const allNumbers = new Set([...cclByNumber.keys(), ...geoByNumber.keys()]);
  const cclOnly  = [...allNumbers].filter((n) =>  cclByNumber.has(n) && !geoByNumber.has(n)).length;
  const geoOnly  = [...allNumbers].filter((n) => !cclByNumber.has(n) &&  geoByNumber.has(n)).length;
  const matched  = [...allNumbers].filter((n) =>  cclByNumber.has(n) &&  geoByNumber.has(n)).length;
  log(`Union:      ${allNumbers.size.toLocaleString()} unique facilities total`);
  log(`  CCL-only: ${cclOnly.toLocaleString()}`);
  log(`  GEO-only: ${geoOnly.toLocaleString()}`);
  log(`  Matched:  ${matched.toLocaleString()}`);

  // ── Step 4: Merge CCL ∪ GEO and apply field map ───────────────────────────
  log("Merging sources and mapping fields…");

  const mapped: Omit<FacilityDbRow, "updated_at">[] = [];
  let skippedNoGeo    = 0;
  let skippedGroup    = 0;
  let skippedCounty   = 0;

  for (const num of allNumbers) {
    const ccl = cclByNumber.get(num);
    const geo = geoByNumber.get(num);

    const row = mergeFacilityRow(
      num, ccl, geo, fm as any,
      TYPE_TO_NAME, GEO_STATUS,
      skipMissingGeo, includeCclOnly,
      formatPhone, typeToGroup,
    );

    if (row === null) { skippedNoGeo++; continue; }

    // ── Group filter ───────────────────────────────────────────────────────
    if (filterByGroups.length > 0 && !filterByGroups.includes(row.facility_group)) {
      skippedGroup++; continue;
    }

    // ── County filter ──────────────────────────────────────────────────────
    if (filterByCounties.length > 0 && !filterByCounties.includes(row.county)) {
      skippedCounty++; continue;
    }

    mapped.push(row);
  }

  console.log();
  log(`Merge results:`);
  log(`  mapped        : ${mapped.length.toLocaleString()}`);
  log(`  skip (no geo) : ${skippedNoGeo}`);
  log(`  skip (group)  : ${skippedGroup}`);
  log(`  skip (county) : ${skippedCounty}`);

  // ── Step 5: Apply record limit ─────────────────────────────────────────────
  const toWrite = limit > 0 ? mapped.slice(0, limit) : mapped;
  if (limit > 0) {
    log(`Limit applied: ${toWrite.length.toLocaleString()} of ${mapped.length.toLocaleString()} records`);
  }

  console.log();

  // ── Step 5.5: Enrich via CCLD Transparency API ────────────────────────────
  if (ETL_CONFIG.enrichment.enabled) {
    const enCfg = ETL_CONFIG.enrichment;

    // Scope: apply optional county filter before hitting the API
    let enrichInput: typeof toWrite = toWrite;
    if (enCfg.enrichCounties.length > 0) {
      enrichInput = toWrite.filter((r) =>
        (enCfg.enrichCounties as readonly string[]).includes(r.county)
      );
      log(
        `Enrichment county filter: ${enrichInput.length.toLocaleString()} / ` +
        `${toWrite.length.toLocaleString()} facilities`
      );
    }

    log(`Enriching ${enrichInput.length.toLocaleString()} facilities via CCLD Transparency API…`);
    if (enCfg.enrichLimit > 0) {
      log(`  (enrichLimit=${enCfg.enrichLimit} — only first ${enCfg.enrichLimit} will be enriched)`);
    }

    const enrichMap = await enrichFacilities(enrichInput, enCfg);

    // Patch enriched values back onto the toWrite rows (objects are references)
    let datesFound = 0;
    let adminsFound = 0;
    for (const row of toWrite) {
      const patch = enrichMap.get(row.number);
      if (!patch) continue;
      if (patch.last_inspection_date) {
        row.last_inspection_date = patch.last_inspection_date;
        datesFound++;
      }
      if (patch.administrator) {
        row.administrator = patch.administrator;
        adminsFound++;
      }
      if (patch.licensee) {
        row.licensee = patch.licensee;
      }
    }

    log(`Enrichment complete:`);
    log(`  last_inspection_dates found : ${datesFound.toLocaleString()}`);
    log(`  administrators updated      : ${adminsFound.toLocaleString()}`);
    console.log();
  }

  // ── Step 6: Write to DB (or dry-run) ──────────────────────────────────────
  if (dryRun) {
    log("DRY RUN — DB write skipped");
    log(`Would upsert ${toWrite.length.toLocaleString()} facilities`);
  } else {
    log(`Writing ${toWrite.length.toLocaleString()} facilities to SQLite…`);
    const CHUNK = 1000;
    let done = 0;
    for (let i = 0; i < toWrite.length; i += CHUNK) {
      bulkUpsertFacilities(toWrite.slice(i, i + CHUNK));
      done += Math.min(CHUNK, toWrite.length - i);
      process.stdout.write(
        `\r    ${done.toLocaleString()} / ${toWrite.length.toLocaleString()} upserted…`
      );
    }
    process.stdout.write("\n");
    log(`Done. ${done.toLocaleString()} facilities written.`);
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log();
  log(`━━━ ETL complete in ${elapsed}s ━━━`);
}

main().catch((err) => {
  console.error("\n[etl] Fatal:", err);
  process.exit(1);
});
