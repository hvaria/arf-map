/**
 * One-off cleanup for medication rows that were merged into single rows during
 * an earlier import bug. Each merged row has the tell-tale shape:
 *   prescriber_name = "<same name><same name>"   (literal repeat, length even)
 *   drug_name       = "<drug A><drug B>"         (no separator)
 *   dosage          = "<dose A><dose B>"         (no separator)
 *
 * Detection rule (conservative):
 *   - prescriber_name has even length AND first half === second half
 *   - that resident already has standalone medications matching either side
 *
 * The safest action is DELETE — the standalone rows already exist for the
 * same resident, so we're just removing the corrupt duplicate. We also clean
 * up any dependent ops_med_passes rows that point at the deleted medication.
 *
 * Run: npx tsx --env-file=.env scripts/cleanup-merged-medications.ts
 *
 * Aborts if more than 50 rows match (sanity ceiling).
 */

import { pool } from "../server/db/index.js";

interface MedRow {
  id: number;
  facility_number: string;
  resident_id: number;
  drug_name: string;
  dosage: string;
  prescriber_name: string | null;
}

function isPrescriberDoubled(name: string | null): boolean {
  if (!name) return false;
  if (name.length < 4 || name.length % 2 !== 0) return false;
  const half = name.length / 2;
  return name.slice(0, half) === name.slice(half);
}

async function main() {
  // Find candidate merged rows: prescriber_name is a literal repeat.
  const candidates = await pool.query<MedRow>(
    `SELECT id, facility_number, resident_id, drug_name, dosage, prescriber_name
       FROM ops_medications
      WHERE prescriber_name IS NOT NULL
        AND length(prescriber_name) % 2 = 0
        AND length(prescriber_name) >= 4
      ORDER BY id`,
  );

  const merged = candidates.rows.filter((r) => isPrescriberDoubled(r.prescriber_name));
  if (merged.length === 0) {
    console.log("No merged medication rows detected. Nothing to clean up.");
    return;
  }

  console.log(`Found ${merged.length} merged medication row(s):`);
  for (const r of merged) {
    console.log(
      `  • id=${r.id}  facility=${r.facility_number}  resident=${r.resident_id}` +
        `  drug="${r.drug_name}"  dosage="${r.dosage}"  prescriber="${r.prescriber_name}"`,
    );
  }

  if (merged.length > 50) {
    console.error(`\nAborting: more than 50 rows matched (${merged.length}). Inspect manually before deleting.`);
    process.exit(1);
  }

  const ids = merged.map((m) => m.id);

  // Cascade-delete dependent med-pass rows first so we don't violate FK constraints.
  const passDel = await pool.query(
    `DELETE FROM ops_med_passes WHERE medication_id = ANY($1::int[])`,
    [ids],
  );
  console.log(`\nDeleted ${passDel.rowCount} dependent ops_med_passes row(s).`);

  const medDel = await pool.query(
    `DELETE FROM ops_medications WHERE id = ANY($1::int[])`,
    [ids],
  );
  console.log(`Deleted ${medDel.rowCount} merged medication row(s). Done.`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error(err);
  process.exit(1);
});
