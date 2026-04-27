#!/usr/bin/env tsx
/**
 * scripts/enrich-facilities.ts
 *
 * Backfill enrichment for facilities already in the SQLite DB.
 * Calls the CCLD Transparency API for each facility and writes
 * targeted SQL UPDATE statements — never a full upsert.
 *
 * Uses the same fetchFacilityEnrichment + parseEvaluationReport logic
 * as etl.ts so the DB-seeded path and the ETL path produce identical data.
 *
 * Fields written:
 *   last_inspection_date  (FacilityInspections JSON)
 *   administrator         (FacilityReports HTML)
 *   licensee              (FacilityReports HTML)
 *   total_type_b          (FacilityReports HTML)
 *   citations             (FacilityReports HTML)
 *
 * Safe to re-run: already-populated fields are skipped unless --force is passed.
 *
 * Usage:
 *   npx tsx scripts/enrich-facilities.ts
 *   npx tsx scripts/enrich-facilities.ts --limit 20        # smoke test
 *   npx tsx scripts/enrich-facilities.ts --county "San Diego"
 *   npx tsx scripts/enrich-facilities.ts --rps 3           # slower rate
 *   npx tsx scripts/enrich-facilities.ts --force           # overwrite existing
 */

import { sqlite, logEnrichmentRun } from "./db-writer";
import { fetchFacilityEnrichment, rateLimiter } from "./etl-helpers";

// ── CLI args ──────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);

function getArg(flag: string): string | undefined {
  const i = args.indexOf(flag);
  return i !== -1 && args[i + 1] ? args[i + 1] : undefined;
}

const LIMIT   = parseInt(getArg("--limit") ?? "0", 10) || 0;
const COUNTY  = (getArg("--county") ?? "").trim();
const RPS     = parseFloat(getArg("--rps") ?? "5") || 5;
const FORCE   = args.includes("--force");
const TRIGGER = (getArg("--trigger") ?? "scheduled").trim();

// ── Candidate query ───────────────────────────────────────────────────────────

interface Candidate {
  number:               string;
  administrator:        string;
  licensee:             string;
  last_inspection_date: string;
  total_type_b:         number;
  citations:            number;
}

function loadCandidates(): Candidate[] {
  const clauses: string[] = [];
  const params: any[]     = [];

  if (COUNTY) {
    clauses.push("county = ?");
    params.push(COUNTY);
  }

  if (!FORCE) {
    // Only fetch facilities missing at least one enrichable field
    clauses.push(`(
      last_inspection_date IS NULL OR last_inspection_date = '' OR
      administrator IS NULL OR administrator = '' OR
      licensee IS NULL OR licensee = '' OR
      total_type_b IS NULL OR total_type_b = 0 OR
      citations IS NULL OR citations = 0
    )`);
  }

  const where    = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const limitSql = LIMIT > 0 ? `LIMIT ${LIMIT}` : "";

  return sqlite
    .prepare(
      `SELECT number, administrator, licensee, last_inspection_date, total_type_b, citations
       FROM facilities ${where} ORDER BY number ${limitSql}`,
    )
    .all(...params) as Candidate[];
}

// ── Targeted UPDATE statement ─────────────────────────────────────────────────

const stmtUpdate = sqlite.prepare(`
  UPDATE facilities SET
    last_inspection_date = CASE WHEN ? != '' THEN ? ELSE last_inspection_date END,
    administrator        = CASE WHEN ? != '' THEN ? ELSE administrator END,
    licensee             = CASE WHEN ? != '' THEN ? ELSE licensee END,
    total_type_b         = CASE WHEN ? > 0   THEN ? ELSE total_type_b END,
    citations            = CASE WHEN ? > 0   THEN ? ELSE citations END,
    enriched_at          = ?,
    updated_at           = ?
  WHERE number = ?
`);

function applyUpdate(
  fac: Candidate,
  data: Awaited<ReturnType<typeof fetchFacilityEnrichment>>,
  force: boolean,
): boolean {
  const date   = data.last_inspection_date ?? "";
  const admin  = data.administrator ?? "";
  const lic    = data.licensee ?? "";
  const typeB  = data.total_type_b ?? 0;
  const cit    = data.citations ?? 0;

  // Skip the UPDATE if nothing was found at all
  if (!date && !admin && !lic && !typeB && !cit) return false;

  // In force mode, write every field that came back regardless of existing value
  const effectiveDate  = force ? date  : (fac.last_inspection_date ? "" : date);
  const effectiveAdmin = force ? admin : (fac.administrator         ? "" : admin);
  const effectiveLic   = force ? lic   : (fac.licensee              ? "" : lic);
  const effectiveTypeB = force ? typeB : (fac.total_type_b          ? 0  : typeB);
  const effectiveCit   = force ? cit   : (fac.citations             ? 0  : cit);

  if (!effectiveDate && !effectiveAdmin && !effectiveLic && !effectiveTypeB && !effectiveCit)
    return false;

  const now = Date.now();
  stmtUpdate.run(
    effectiveDate,  effectiveDate,
    effectiveAdmin, effectiveAdmin,
    effectiveLic,   effectiveLic,
    effectiveTypeB, effectiveTypeB,
    effectiveCit,   effectiveCit,
    now,  // enriched_at
    now,  // updated_at
    fac.number,
  );
  return true;
}

// ── ETA formatter ─────────────────────────────────────────────────────────────

function fmtEta(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return `${m}m ${s}s`;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const startMs = Date.now();
  const startedAt = startMs;

  const dbTotal = (
    sqlite.prepare("SELECT COUNT(*) as n FROM facilities").get() as { n: number }
  ).n;

  if (dbTotal === 0) {
    console.error("❌ facilities table is empty — run seed-facilities-db.ts first");
    process.exit(1);
  }

  console.log("━━━ CCLD Facility Enrichment (backfill) ━━━");
  console.log(`DB total   : ${dbTotal.toLocaleString()} facilities`);
  console.log(`County     : ${COUNTY || "all counties"}`);
  console.log(`Rate limit : ${RPS} req/s`);
  console.log(`Force      : ${FORCE}`);
  console.log();

  const candidates = loadCandidates();
  console.log(`Candidates : ${candidates.length.toLocaleString()} facilities to process`);

  if (candidates.length === 0) {
    console.log("\n✓ Nothing to enrich — all fields already populated.");
    console.log("  Use --force to re-fetch and overwrite existing values.");
    return;
  }

  // Each facility makes up to 2 API calls (Inspections + Reports)
  const estSeconds = (candidates.length * 2) / RPS;
  console.log(`Est. time  : ~${fmtEta(estSeconds)} at ${RPS} req/s`);
  console.log();

  const throttle = rateLimiter(RPS);
  let written    = 0;
  let noData     = 0;
  let failed     = 0;

  for (let i = 0; i < candidates.length; i++) {
    const fac = candidates[i];
    try {
      const data = await fetchFacilityEnrichment(fac.number, throttle);
      const didWrite = applyUpdate(fac, data, FORCE);
      if (didWrite) written++; else noData++;
    } catch (err: any) {
      failed++;
      process.stdout.write("\n");
      console.warn(`  ⚠  ${fac.number}: ${err?.message ?? err}`);
    }

    if ((i + 1) % 10 === 0 || i === candidates.length - 1) {
      const elapsed = (Date.now() - startMs) / 1000;
      const rate    = (i + 1) / Math.max(elapsed, 0.001);
      const eta     = (candidates.length - i - 1) / Math.max(rate, 0.001);
      process.stdout.write(
        `\r  ${(i + 1).toLocaleString()} / ${candidates.length.toLocaleString()}` +
        `   written: ${written}   no data: ${noData}   failed: ${failed}` +
        `   eta: ~${fmtEta(eta)}` +
        " ".repeat(4),
      );
    }
  }

  process.stdout.write("\n\n");

  const finishedAt = Date.now();
  const elapsed = ((finishedAt - startMs) / 1000).toFixed(1);
  console.log(`━━━ Done in ${elapsed}s ━━━`);
  console.log(`  Updated : ${written.toLocaleString()}`);
  console.log(`  No data : ${noData.toLocaleString()}`);
  console.log(`  Failed  : ${failed.toLocaleString()}`);

  logEnrichmentRun({
    startedAt,
    finishedAt,
    trigger: TRIGGER,
    totalProcessed: candidates.length,
    totalEnriched: written,
    totalNoData: noData,
    totalFailed: failed,
  });
}

main().catch((err) => {
  console.error("\nFatal:", err);
  process.exit(1);
});
