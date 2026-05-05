/**
 * scripts/cleanup-junk-jobs.ts
 *
 * Audits and (optionally) deletes job_postings rows whose fields look like
 * placeholder / seed / test data. Mirrors the same PLACEHOLDER_REGEX used
 * server-side in routes.ts and client-side in JobsPanel.tsx.
 *
 * Usage:
 *   npx tsx scripts/cleanup-junk-jobs.ts          # dry-run: list what would be deleted
 *   npx tsx scripts/cleanup-junk-jobs.ts --apply  # actually delete
 */

import "dotenv/config";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set — check .env");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const apply = process.argv.includes("--apply");

const PLACEHOLDER_REGEX = /^(test|placeholder|n\/a|na|todo|tbd|sample|asdf|x+|\.+|-+)$/i;

interface JobRow {
  id: number;
  facility_number: string;
  title: string;
  type: string;
  salary: string;
  description: string;
}

function isJunk(j: JobRow): { junk: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const title = (j.title ?? "").trim();
  const desc = (j.description ?? "").trim();
  const salary = (j.salary ?? "").trim();

  if (!title) reasons.push("empty title");
  if (!salary) reasons.push("empty salary");
  if (title && title.length < 3) reasons.push(`title too short (${title.length})`);
  if (desc && desc.length < 20) reasons.push(`description too short (${desc.length})`);
  if (title && PLACEHOLDER_REGEX.test(title)) reasons.push(`title="${title}"`);
  if (desc && PLACEHOLDER_REGEX.test(desc)) reasons.push(`description="${desc}"`);
  if (salary && PLACEHOLDER_REGEX.test(salary)) reasons.push(`salary="${salary}"`);

  return { junk: reasons.length > 0, reasons };
}

async function main() {
  console.log(`━━━ Junk job audit (${apply ? "APPLY" : "dry-run"}) ━━━\n`);

  const r = await pool.query<JobRow>(`
    SELECT id, facility_number, title, type, salary, description
    FROM job_postings
    ORDER BY id
  `);
  console.log(`Total job_postings: ${r.rows.length}`);

  const junk = r.rows
    .map((row) => ({ row, ...isJunk(row) }))
    .filter((x) => x.junk);

  console.log(`Flagged as junk: ${junk.length}\n`);

  if (junk.length === 0) {
    console.log("Nothing to clean up.");
    await pool.end();
    return;
  }

  for (const { row, reasons } of junk) {
    console.log(`  [#${row.id}] facility=${row.facility_number} type="${row.type}"`);
    console.log(`    reasons: ${reasons.join(", ")}`);
  }

  if (!apply) {
    console.log(`\nDry run only. Re-run with --apply to delete these ${junk.length} rows.`);
    await pool.end();
    return;
  }

  const ids = junk.map((x) => x.row.id);
  const result = await pool.query(
    `DELETE FROM job_postings WHERE id = ANY($1::int[]) RETURNING id`,
    [ids],
  );
  console.log(`\nDeleted ${result.rowCount} rows.`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  pool.end();
  process.exit(1);
});
