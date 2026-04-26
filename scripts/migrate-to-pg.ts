#!/usr/bin/env tsx
/**
 * scripts/migrate-to-pg.ts
 *
 * SQLite → PostgreSQL one-shot data migration script.
 *
 * Usage:
 *   DATABASE_URL=postgres://... npx tsx scripts/migrate-to-pg.ts [--dry-run] [--table=name] [--batch-size=500]
 *
 * Phase 1: Pre-flight checks
 * Phase 2: Transfer rows in FK-dependency order
 * Phase 3: Reset SERIAL sequences
 * Phase 4: Verification (count comparison)
 *
 * Sessions are NOT migrated (ephemeral; connect-pg-simple creates a fresh table).
 *
 * Exit 0 = all tables PASSED
 * Exit 1 = any table FAILED or pre-flight error
 */

import Database from "better-sqlite3";
import { Pool } from "pg";
import path from "path";

// ── CLI argument parsing ──────────────────────────────────────────────────────

const args = process.argv.slice(2);
const DRY_RUN = args.includes("--dry-run");
const TABLE_FILTER = args.find((a) => a.startsWith("--table="))?.split("=")[1];
const BATCH_SIZE = parseInt(
  args.find((a) => a.startsWith("--batch-size="))?.split("=")[1] ?? "500",
  10
);

// ── DB connections ────────────────────────────────────────────────────────────

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("[migrate] ERROR: DATABASE_URL environment variable is not set.");
  process.exit(1);
}

const DB_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, "data.db")
  : path.join(process.cwd(), "data.db");

console.log(`[migrate] SQLite source: ${DB_PATH}`);
console.log(`[migrate] PostgreSQL target: ${DATABASE_URL.replace(/:([^:@]*@)/, ":***@")}`);
if (DRY_RUN) console.log("[migrate] DRY RUN: no data will be written to PostgreSQL");

// ── Boolean column registry ───────────────────────────────────────────────────
// Maps table_name → set of column names that store boolean values as 0/1 in SQLite
// and must be converted to true/false for PostgreSQL.

const BOOLEAN_COLS: Record<string, Set<string>> = {
  job_seeker_accounts:        new Set(["email_verified"]),
  facility_accounts:          new Set(["email_verified"]),
  login_attempts:             new Set(["success"]),
  ops_resident_assessments:   new Set(["bathing","dressing","grooming","toileting","continence","eating","mobility","transfers","meal_prep","housekeeping","laundry","transportation","finances","communication","self_administer_meds"]),
  ops_daily_tasks:            new Set(["refused"]),
  ops_medications:            new Set(["is_prn","is_controlled","is_psychotropic","is_hazardous","requires_vitals_before","auto_refill_request"]),
  ops_med_passes:             new Set(["right_resident","right_medication","right_dose","right_route","right_time","right_reason","right_documentation","right_to_refuse"]),
  ops_controlled_sub_counts:  new Set(["discrepancy","resolved"]),
  ops_incidents:              new Set(["injury_involved","hospitalization_required","supervisor_notified","family_notified","physician_notified","lic_624_required","lic_624_submitted","soc_341_required","soc_341_submitted","follow_up_completed"]),
  ops_admissions:             new Set(["lic_601_completed","lic_602a_completed","lic_603_completed","lic_604a_completed","lic_605a_completed","lic_610d_completed","admission_agreement_signed","physician_report_received","tb_test_results_received","move_in_completed","welcome_completed"]),
  ops_billing_charges:        new Set(["is_recurring","prorated"]),
  ops_shifts:                 new Set(["is_overtime"]),
};

// Tables with SERIAL PKs (need OVERRIDING SYSTEM VALUE + sequence reset)
const SERIAL_TABLES = new Set([
  "users",
  "job_seeker_accounts",
  "job_seeker_profiles",
  "facility_accounts",
  "facility_overrides",
  "job_postings",
  "applicant_interests",
  "login_attempts",
  "enrichment_runs",
  "ops_residents",
  "ops_resident_assessments",
  "ops_care_plans",
  "ops_daily_tasks",
  "ops_medications",
  "ops_med_passes",
  "ops_controlled_sub_counts",
  "ops_med_destruction",
  "ops_incidents",
  "ops_leads",
  "ops_tours",
  "ops_admissions",
  "ops_billing_charges",
  "ops_invoices",
  "ops_payments",
  "ops_staff",
  "ops_shifts",
  "ops_facility_settings",
  "ops_compliance_calendar",
]);

// Table migration order (FK dependencies)
const TABLE_ORDER = [
  "users",
  "job_seeker_accounts",
  "job_seeker_profiles",
  "facilities",
  "facility_accounts",
  "facility_overrides",
  "applicant_interests",
  "job_postings",
  "login_attempts",
  "enrichment_runs",
  "ops_residents",
  "ops_resident_assessments",
  "ops_care_plans",
  "ops_daily_tasks",
  "ops_medications",
  "ops_med_passes",
  "ops_controlled_sub_counts",
  "ops_med_destruction",
  "ops_incidents",
  "ops_leads",
  "ops_tours",
  "ops_admissions",
  "ops_billing_charges",
  "ops_invoices",
  "ops_payments",
  "ops_staff",
  "ops_shifts",
  "ops_facility_settings",
  "ops_compliance_calendar",
];

// Sequence names for SERIAL tables (Postgres auto-names them tablename_id_seq)
function getSeqName(table: string): string {
  return `${table}_id_seq`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function coerceRow(tableName: string, row: Record<string, unknown>): Record<string, unknown> {
  const boolCols = BOOLEAN_COLS[tableName];
  if (!boolCols) return row;
  const result: Record<string, unknown> = { ...row };
  for (const col of boolCols) {
    if (col in result) {
      result[col] = result[col] === 1 ? true : false;
    }
  }
  return result;
}

function validateJsonCols(tableName: string, rows: Record<string, unknown>[]): void {
  const JSON_COLS: Record<string, string[]> = {
    job_seeker_profiles:     ["job_types"],
    job_postings:            ["requirements"],
    ops_resident_assessments:["raw_json"],
    ops_medications:         ["scheduled_times"],
  };
  const cols = JSON_COLS[tableName];
  if (!cols) return;
  for (const row of rows) {
    for (const col of cols) {
      const val = row[col];
      if (val !== null && val !== undefined && typeof val === "string") {
        try { JSON.parse(val); } catch {
          console.warn(`[migrate] WARNING: ${tableName}.${col} contains invalid JSON for row id=${row.id}: ${String(val).slice(0, 80)}`);
        }
      }
    }
  }
}

async function pgTableExists(pg: Pool, tableName: string): Promise<boolean> {
  const result = await pg.query(
    "SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=$1",
    [tableName]
  );
  return result.rows.length > 0;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  // Open SQLite
  let sq: Database.Database;
  try {
    sq = new Database(DB_PATH, { readonly: true });
    sq.pragma("journal_mode = WAL");
  } catch (err) {
    console.error(`[migrate] ERROR: Cannot open SQLite at ${DB_PATH}: ${String(err)}`);
    process.exit(1);
  }

  // Open Postgres pool
  const pg = new Pool({ connectionString: DATABASE_URL, max: 5 });
  try {
    const client = await pg.connect();
    client.release();
    console.log("[migrate] PostgreSQL connection: OK");
  } catch (err) {
    console.error(`[migrate] ERROR: Cannot connect to PostgreSQL: ${String(err)}`);
    await pg.end();
    process.exit(1);
  }

  // ── Phase 1: Pre-flight ───────────────────────────────────────────────────

  const tablesToMigrate = TABLE_FILTER
    ? TABLE_ORDER.filter((t) => t === TABLE_FILTER)
    : TABLE_ORDER;

  if (TABLE_FILTER && tablesToMigrate.length === 0) {
    console.error(`[migrate] ERROR: Table "${TABLE_FILTER}" not found in migration list.`);
    await pg.end();
    process.exit(1);
  }

  // Check target tables exist in Postgres
  const missingTables: string[] = [];
  for (const tbl of tablesToMigrate) {
    if (!(await pgTableExists(pg, tbl))) {
      missingTables.push(tbl);
    }
  }
  if (missingTables.length > 0) {
    console.error(
      `[migrate] ERROR: The following tables do not exist in PostgreSQL (run drizzle-kit migrations first):\n` +
      missingTables.map((t) => `  - ${t}`).join("\n")
    );
    await pg.end();
    process.exit(1);
  }

  // Capture SQLite row counts
  const sqliteCounts: Record<string, number> = {};
  console.log("\n[migrate] Pre-flight row counts (SQLite):");
  for (const tbl of tablesToMigrate) {
    try {
      const row = sq.prepare(`SELECT COUNT(*) as n FROM ${tbl}`).get() as { n: number } | undefined;
      sqliteCounts[tbl] = row?.n ?? 0;
      console.log(`  ${tbl}: ${sqliteCounts[tbl]}`);
    } catch {
      sqliteCounts[tbl] = 0;
      console.log(`  ${tbl}: (table not found in SQLite, will skip)`);
    }
  }

  // ── Phase 2: Transfer ─────────────────────────────────────────────────────

  const results: { table: string; status: "PASS" | "FAIL" | "SKIP"; sqliteCount: number; pgCount: number; message?: string }[] = [];

  for (const tableName of tablesToMigrate) {
    const sqliteCount = sqliteCounts[tableName] ?? 0;
    if (sqliteCount === 0) {
      console.log(`\n[migrate] Skipping ${tableName} (0 rows in SQLite)`);
      results.push({ table: tableName, status: "SKIP", sqliteCount: 0, pgCount: 0 });
      continue;
    }

    console.log(`\n[migrate] Migrating ${tableName} (${sqliteCount} rows)…`);

    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would insert ${sqliteCount} rows into ${tableName}`);
      results.push({ table: tableName, status: "PASS", sqliteCount, pgCount: sqliteCount });
      continue;
    }

    try {
      // Read all rows from SQLite
      let allRows: Record<string, unknown>[];
      try {
        allRows = sq.prepare(`SELECT * FROM ${tableName}`).all() as Record<string, unknown>[];
      } catch (err) {
        console.warn(`  (table not found in SQLite — skipping): ${String(err)}`);
        results.push({ table: tableName, status: "SKIP", sqliteCount: 0, pgCount: 0, message: "Table missing in SQLite" });
        continue;
      }

      validateJsonCols(tableName, allRows);

      // Get column names from first row
      if (allRows.length === 0) {
        results.push({ table: tableName, status: "SKIP", sqliteCount: 0, pgCount: 0 });
        continue;
      }

      const columns = Object.keys(allRows[0]);
      const isSerial = SERIAL_TABLES.has(tableName);
      const overridingClause = isSerial ? "OVERRIDING SYSTEM VALUE" : "";
      const conflictTarget = tableName === "facilities" ? "(number)" : isSerial ? "(id)" : "";
      const conflictAction = conflictTarget ? "ON CONFLICT " + conflictTarget + " DO NOTHING" : "";

      const placeholders = columns.map((_, i) => `$${i + 1}`).join(", ");
      const colNames = columns.map((c) => `"${c}"`).join(", ");
      const insertSql = `INSERT INTO "${tableName}" (${colNames}) ${overridingClause} VALUES (${placeholders}) ${conflictAction}`;

      let inserted = 0;
      // Process in batches
      for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
        const batch = allRows.slice(i, i + BATCH_SIZE).map((r) => coerceRow(tableName, r));
        for (const row of batch) {
          const values = columns.map((c) => {
            const v = row[c];
            // Convert undefined → null
            return v === undefined ? null : v;
          });
          await pg.query(insertSql, values);
          inserted++;
        }
        if (i + BATCH_SIZE < allRows.length) {
          process.stdout.write(`  inserted ${inserted}/${allRows.length}…\r`);
        }
      }

      console.log(`  inserted ${inserted}/${allRows.length} rows into ${tableName}`);
      results.push({ table: tableName, status: "PASS", sqliteCount: allRows.length, pgCount: inserted });
    } catch (err) {
      console.error(`  ERROR migrating ${tableName}: ${String(err)}`);
      results.push({ table: tableName, status: "FAIL", sqliteCount, pgCount: 0, message: String(err) });
    }
  }

  // ── Phase 3: Reset SERIAL sequences ────────────────────────────────────────

  if (!DRY_RUN) {
    console.log("\n[migrate] Resetting SERIAL sequences…");
    for (const tableName of tablesToMigrate) {
      if (!SERIAL_TABLES.has(tableName)) continue;
      const seqName = getSeqName(tableName);
      try {
        await pg.query(
          `SELECT setval('${seqName}', COALESCE((SELECT MAX(id) FROM "${tableName}"), 1))`
        );
        console.log(`  reset ${seqName}`);
      } catch (err) {
        console.warn(`  WARNING: Could not reset sequence ${seqName}: ${String(err)}`);
      }
    }
  }

  // ── Phase 4: Verification ─────────────────────────────────────────────────

  console.log("\n[migrate] Verification:");
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  if (!DRY_RUN) {
    for (const r of results) {
      if (r.status === "SKIP") {
        skipped++;
        continue;
      }
      if (r.status === "FAIL") {
        failed++;
        console.log(`  FAIL  ${r.table}: migration error — ${r.message}`);
        continue;
      }
      try {
        const pgRow = await pg.query(`SELECT COUNT(*) as n FROM "${r.table}"`);
        const pgCount = parseInt(pgRow.rows[0].n as string, 10);
        if (pgCount >= r.sqliteCount) {
          passed++;
          console.log(`  PASS  ${r.table}: SQLite=${r.sqliteCount} Postgres=${pgCount}`);
        } else {
          failed++;
          console.log(`  FAIL  ${r.table}: SQLite=${r.sqliteCount} Postgres=${pgCount} (mismatch)`);
        }
      } catch (err) {
        failed++;
        console.log(`  FAIL  ${r.table}: verification error — ${String(err)}`);
      }
    }
  } else {
    console.log("  [DRY RUN] Skipping verification — no data was written.");
    passed = results.filter((r) => r.status === "PASS").length;
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log("\n─────────────────────────────────────────────────");
  if (DRY_RUN) {
    console.log(`DRY RUN: ${passed} tables would be migrated, ${skipped} skipped.`);
  } else {
    console.log(`${passed} tables PASSED | ${failed} tables FAILED | ${skipped} tables SKIPPED`);
  }

  await pg.end();
  sq.close();

  if (failed > 0) {
    console.error("\n[migrate] Migration completed with FAILURES. Check output above.");
    process.exit(1);
  }

  console.log("\n[migrate] Migration completed successfully.");
  process.exit(0);
}

main().catch((err) => {
  console.error("[migrate] Unhandled error:", err);
  process.exit(1);
});
