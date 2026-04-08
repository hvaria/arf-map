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
import { fetchAllPages, GEO_STATUS, TYPE_TO_NAME } from "./etl-helpers";

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
          skipMissingGeo, dryRun, limit } = ETL_CONFIG;

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

  // Guard: without GEO rows there is nothing to join on
  if (geoRows.length === 0) {
    log("No GEO rows to process. Exiting.");
    return;
  }

  // ── Step 3: Index CCL by facility number (O(1) lookup during merge) ────────
  const cclByNumber = new Map<string, any>();
  for (const row of cclRows) {
    const num = String(row[fm.fromCcl.number] ?? "").trim();
    if (num) cclByNumber.set(num, row);
  }
  log(`CCL index: ${cclByNumber.size.toLocaleString()} unique facility numbers`);

  // ── Step 4: Merge GEO + CCL and apply field map ────────────────────────────
  log("Merging sources and mapping fields…");

  const mapped: Omit<FacilityDbRow, "updated_at">[] = [];
  let skippedNoNumber = 0;
  let skippedNoGeo    = 0;
  let skippedGroup    = 0;
  let skippedCounty   = 0;

  for (const geo of geoRows) {
    // Extract facility number (primary key for the join)
    const num = String(geo[fm.fromGeo.number] ?? "").trim();
    if (!num) { skippedNoNumber++; continue; }

    // Parse coordinates
    const lat = parseFloat(geo[fm.fromGeo.lat] ?? "");
    const lng = parseFloat(geo[fm.fromGeo.lng] ?? "");
    const hasGeo = Number.isFinite(lat) && lat !== 0 &&
                   Number.isFinite(lng) && lng !== 0;

    if (skipMissingGeo && !hasGeo) { skippedNoGeo++; continue; }

    // Look up matching CCL row
    const ccl = cclByNumber.get(num);

    // ── Facility type & group ──────────────────────────────────────────────
    // Prefer CCL's human-readable string; fall back to GEO type-code lookup.
    const rawType = (
      ccl?.[fm.fromCcl.facilityType] ??
      TYPE_TO_NAME[String(geo[fm.fromGeo.typeCode])] ??
      "Adult Residential Facility"
    ).trim();
    const facilityType  = rawType || "Adult Residential Facility";
    const facilityGroup = typeToGroup(facilityType);

    // ── Group filter ───────────────────────────────────────────────────────
    if (filterByGroups.length > 0 && !filterByGroups.includes(facilityGroup)) {
      skippedGroup++; continue;
    }

    // ── County ────────────────────────────────────────────────────────────
    const county = (ccl?.[fm.fromCcl.county] ?? geo.COUNTY ?? "").trim();

    // ── County filter ──────────────────────────────────────────────────────
    if (filterByCounties.length > 0 && !filterByCounties.includes(county)) {
      skippedCounty++; continue;
    }

    // ── Status ────────────────────────────────────────────────────────────
    // Prefer CCL text status; fall back to GEO numeric code decode.
    const status = (
      ccl?.[fm.fromCcl.status] ??
      GEO_STATUS[String(geo[fm.fromGeo.status])] ??
      "LICENSED"
    ).toUpperCase();

    // ── Capacity: GEO value preferred, CCL as fallback ────────────────────
    const capacity =
      parseInt(geo[fm.fromGeo.capacity] ?? "", 10) ||
      parseInt(ccl?.[fm.fromCcl.capacity] ?? "0", 10) ||
      0;

    mapped.push({
      number:              num,
      name:                (ccl?.[fm.fromCcl.name] ?? geo[fm.fromGeo.name] ?? "").trim(),
      facility_type:       facilityType,
      facility_group:      facilityGroup,
      status,
      address:             (geo[fm.fromGeo.address]  ?? "").trim(),
      city:                (geo[fm.fromGeo.city]     ?? "").trim().toUpperCase(),
      county,
      zip:                 (geo[fm.fromGeo.zip]      ?? "").trim(),
      phone:               formatPhone(geo[fm.fromGeo.phone]),
      licensee:            (ccl?.[fm.fromCcl.licensee]       ?? "").trim(),
      administrator:       (ccl?.[fm.fromCcl.administrator]  ?? "").trim(),
      capacity,
      first_license_date:  ccl?.[fm.fromCcl.firstLicenseDate] ?? "",
      closed_date:         ccl?.[fm.fromCcl.closedDate]       ?? "",
      // Fields not in CHHS open data
      last_inspection_date: "",
      total_visits:         0,
      total_type_b:         0,
      citations:            0,
      lat:                  hasGeo ? lat : null,
      lng:                  hasGeo ? lng : null,
      geocode_quality:      hasGeo ? "api" : "",
    });
  }

  console.log();
  log(`Merge results:`);
  log(`  mapped        : ${mapped.length.toLocaleString()}`);
  log(`  skip (no num) : ${skippedNoNumber}`);
  log(`  skip (no geo) : ${skippedNoGeo}`);
  log(`  skip (group)  : ${skippedGroup}`);
  log(`  skip (county) : ${skippedCounty}`);

  // ── Step 5: Apply record limit ─────────────────────────────────────────────
  const toWrite = limit > 0 ? mapped.slice(0, limit) : mapped;
  if (limit > 0) {
    log(`Limit applied: ${toWrite.length.toLocaleString()} of ${mapped.length.toLocaleString()} records`);
  }

  console.log();

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
