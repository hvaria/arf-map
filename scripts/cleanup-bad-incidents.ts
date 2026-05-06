/**
 * One-off cleanup for incidents that slipped through with empty / whitespace-only
 * descriptions before the form-level required-field validation was tightened.
 *
 * Run:  npx tsx scripts/cleanup-bad-incidents.ts
 *
 * Reports affected rows first, then deletes them. Aborts if more than 20 rows
 * match — a sanity ceiling so this script can never wipe real data by accident.
 */

import { pool } from "../server/db/index.js";

async function main() {
  const inspect = await pool.query<{
    id: number;
    facility_number: string;
    incident_type: string;
    description: string | null;
    created_at: number;
  }>(
    `SELECT id, facility_number, incident_type, description, created_at
       FROM ops_incidents
      WHERE description IS NULL
         OR btrim(description) = ''
      ORDER BY created_at DESC`,
  );

  if (inspect.rowCount === 0) {
    console.log("No incidents with empty descriptions. Nothing to clean up.");
    return;
  }

  console.log(`Found ${inspect.rowCount} incident(s) with empty description:`);
  for (const r of inspect.rows) {
    console.log(
      `  • id=${r.id}  facility=${r.facility_number}  type=${r.incident_type}  created=${new Date(
        r.created_at,
      ).toISOString()}`,
    );
  }

  if ((inspect.rowCount ?? 0) > 20) {
    console.error(`\nAborting: more than 20 rows matched (${inspect.rowCount}). Inspect manually before deleting.`);
    process.exit(1);
  }

  const ids = inspect.rows.map((r) => r.id);
  const del = await pool.query(
    `DELETE FROM ops_incidents WHERE id = ANY($1::int[])`,
    [ids],
  );
  console.log(`\nDeleted ${del.rowCount} incident(s). Operations should load cleanly now.`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
