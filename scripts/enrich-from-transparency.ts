/**
 * scripts/enrich-from-transparency.ts
 *
 * Standalone enrichment script for the PostgreSQL `facilities` table.
 *
 * Reads LICENSED facilities that have not yet been enriched (last_inspection_date
 * is empty), fetches the most-recent CCLD evaluation report for each one via the
 * CCLD Transparency API, and updates the row with the parsed fields.
 *
 * Idempotent: rows already enriched are excluded by the SELECT WHERE clause, so
 * the script can be safely re-run after a crash or for incremental top-ups.
 *
 * Usage:
 *   npx tsx scripts/enrich-from-transparency.ts            # full run (47k+ rows)
 *   npx tsx scripts/enrich-from-transparency.ts --limit 20 # smoke test
 *   npx tsx scripts/enrich-from-transparency.ts --rps 3    # throttle to 3 req/s
 *
 * Notes:
 *   - This replaces the old SQLite-based enrichment phase in scripts/etl.ts
 *     (which is broken since the SQLite → PG migration removed db-writer.ts).
 *   - Reuses `enrichFacilities` from scripts/etl-helpers.ts unchanged.
 *   - Writes only to: last_inspection_date, total_type_b, citations, and
 *     (when currently empty) administrator + licensee. Sets enriched_at = now.
 */

import "dotenv/config";
import { Pool } from "pg";
import { enrichFacilities } from "./etl-helpers";
import type { EtlConfig } from "./etl-config";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set — check .env");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// ── CLI args ─────────────────────────────────────────────────────────────────

interface CliOpts {
  limit: number;
  requestsPerSecond: number;
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { limit: 0, requestsPerSecond: 5 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit" || a === "-n") {
      const v = argv[++i];
      const n = parseInt(v ?? "", 10);
      if (!Number.isFinite(n) || n < 0) {
        console.error(`Invalid --limit value: ${v}`);
        process.exit(2);
      }
      opts.limit = n;
    } else if (a === "--rps") {
      const v = argv[++i];
      const n = parseFloat(v ?? "");
      if (!Number.isFinite(n) || n <= 0) {
        console.error(`Invalid --rps value: ${v}`);
        process.exit(2);
      }
      opts.requestsPerSecond = n;
    } else if (a === "--help" || a === "-h") {
      console.log(
        `Usage: npx tsx scripts/enrich-from-transparency.ts [--limit N] [--rps N]`,
      );
      process.exit(0);
    }
  }
  return opts;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[enrich ${ts}] ${msg}`);
}

interface CandidateRow {
  number: string;
  administrator: string;
  licensee: string;
  last_inspection_date: string;
}

async function fetchCandidates(limit: number): Promise<CandidateRow[]> {
  // Re-runs are filtered by `last_inspection_date = ''`. The script never blanks
  // that column once set, so already-enriched rows are excluded automatically.
  const params: unknown[] = [];
  let sql = `
    SELECT number, administrator, licensee, last_inspection_date
    FROM facilities
    WHERE status = 'LICENSED'
      AND (last_inspection_date IS NULL OR last_inspection_date = '')
    ORDER BY number
  `;
  if (limit > 0) {
    sql += ` LIMIT $1`;
    params.push(limit);
  }
  const r = await pool.query(sql, params);
  return r.rows.map((row: any) => ({
    number: String(row.number),
    administrator: String(row.administrator ?? ""),
    licensee: String(row.licensee ?? ""),
    last_inspection_date: String(row.last_inspection_date ?? ""),
  }));
}

interface PatchRow {
  number: string;
  last_inspection_date?: string;
  administrator?: string;
  licensee?: string;
  total_type_b?: number;
  citations?: number;
}

/**
 * Apply a single facility's enrichment patch.
 *
 * - last_inspection_date / total_type_b / citations: always overwritten when the
 *   patch contains a value (the patch is built by enrichFacilities to include
 *   these only when the report had data).
 * - administrator / licensee: only updated when currently empty in the DB. This
 *   is a defensive guard in addition to enrichFacilities' skipIfPopulated check
 *   — both can read the value as empty when it's actually present (e.g. the
 *   row was repopulated by a parallel run between SELECT and UPDATE).
 * - enriched_at: stamped to "now" on every successful UPDATE so future audits
 *   can tell which rows have been visited even if the report had no data.
 */
async function applyPatch(patch: PatchRow): Promise<void> {
  const sets: string[] = [];
  const values: unknown[] = [];
  let p = 1;

  if (patch.last_inspection_date !== undefined) {
    sets.push(`last_inspection_date = $${p++}`);
    values.push(patch.last_inspection_date);
  }
  if (patch.total_type_b !== undefined) {
    sets.push(`total_type_b = $${p++}`);
    values.push(patch.total_type_b);
  }
  if (patch.citations !== undefined) {
    sets.push(`citations = $${p++}`);
    values.push(patch.citations);
  }
  if (patch.administrator !== undefined) {
    sets.push(`administrator = CASE WHEN administrator = '' THEN $${p} ELSE administrator END`);
    values.push(patch.administrator);
    p++;
  }
  if (patch.licensee !== undefined) {
    sets.push(`licensee = CASE WHEN licensee = '' THEN $${p} ELSE licensee END`);
    values.push(patch.licensee);
    p++;
  }

  // Always stamp enriched_at on a successful patch
  sets.push(`enriched_at = $${p++}`);
  values.push(Date.now());

  values.push(patch.number);
  const sql = `UPDATE facilities SET ${sets.join(", ")} WHERE number = $${p}`;
  await pool.query(sql, values);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const startMs = Date.now();

  log(
    `━━━ Enrichment via CCLD Transparency API ━━━` +
      `   limit=${opts.limit === 0 ? "all" : opts.limit}` +
      `   rps=${opts.requestsPerSecond}`,
  );

  // ── Step 1: pick candidates ────────────────────────────────────────────
  const candidates = await fetchCandidates(opts.limit);
  log(`Found ${candidates.length.toLocaleString()} LICENSED rows missing last_inspection_date`);
  if (candidates.length === 0) {
    log("Nothing to enrich. Exiting.");
    await pool.end();
    return;
  }

  // ── Step 2: fetch enrichment from CCLD Transparency API ─────────────────
  // We always pass enrichLimit=0 here because we already sliced via SQL LIMIT,
  // so enrichFacilities will process every row in `candidates`.
  const enrichmentConfig: EtlConfig["enrichment"] = {
    enabled: true,
    fields: {
      lastInspectionDate: true,
      administrator: true,
      licensee: true,
      totalTypeB: true,
      citations: true,
    },
    requestsPerSecond: opts.requestsPerSecond,
    skipIfPopulated: true,
    enrichLimit: 0,
    enrichCounties: [],
  };

  log(`Fetching CCLD reports (this is the slow step)…`);
  const patches = await enrichFacilities(candidates, enrichmentConfig);
  log(`enrichFacilities returned ${patches.size.toLocaleString()} patches`);

  // ── Step 3: write patches back to PG ────────────────────────────────────
  let updated = 0;
  let noData = 0;
  let failed = 0;
  let i = 0;

  for (const cand of candidates) {
    i++;
    const patch = patches.get(cand.number);
    if (!patch) {
      noData++;
      continue;
    }
    try {
      await applyPatch({
        number: cand.number,
        last_inspection_date: patch.last_inspection_date,
        administrator: patch.administrator,
        licensee: patch.licensee,
        total_type_b: patch.total_type_b,
        citations: patch.citations,
      });
      updated++;
    } catch (err) {
      failed++;
      console.warn(`\n[enrich] UPDATE failed for ${cand.number}: ${err}`);
    }
    if (i % 100 === 0) {
      log(
        `  progress: processed ${i.toLocaleString()} / ${candidates.length.toLocaleString()}` +
          `   updated=${updated}   no_data=${noData}   failed=${failed}`,
      );
    }
  }

  // ── Step 4: summary ─────────────────────────────────────────────────────
  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log();
  log(`━━━ Done in ${elapsed}s ━━━`);
  log(`  candidates:  ${candidates.length.toLocaleString()}`);
  log(`  updated:     ${updated.toLocaleString()}`);
  log(`  no_data:     ${noData.toLocaleString()}  (no report on file)`);
  log(`  failed:      ${failed.toLocaleString()}  (UPDATE errored)`);

  await pool.end();
}

main().catch((err) => {
  console.error("\n[enrich] Fatal:", err);
  pool.end().catch(() => {});
  process.exit(1);
});
