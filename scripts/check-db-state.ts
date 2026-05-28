import "dotenv/config";
import { Pool } from "pg";

if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const r1 = await pool.query<{ n: number }>(`SELECT COUNT(*)::int AS n FROM facilities`);
  console.log(`Total facilities: ${Number(r1.rows[0].n).toLocaleString()}`);

  const r2 = await pool.query<{ max_dt: number; min_dt: number; n_today: number }>(
    `SELECT MAX(updated_at) AS max_dt,
            MIN(updated_at) AS min_dt,
            COUNT(*) FILTER (WHERE updated_at > $1)::int AS n_today
     FROM facilities`,
    [Date.now() - 7 * 24 * 60 * 60 * 1000],
  );
  const row = r2.rows[0];
  console.log(`Newest updated_at: ${new Date(Number(row.max_dt)).toISOString()}`);
  console.log(`Oldest updated_at: ${new Date(Number(row.min_dt)).toISOString()}`);
  console.log(`Updated in last 7 days: ${row.n_today.toLocaleString()}`);

  const r3 = await pool.query<{ facility_group: string; n: number }>(
    `SELECT facility_group, COUNT(*)::int AS n FROM facilities GROUP BY 1 ORDER BY n DESC`,
  );
  console.log(`\nBy group:`);
  for (const row of r3.rows) console.log(`  ${(row.facility_group || "(empty)").padEnd(28)} ${Number(row.n).toLocaleString()}`);

  // Check for any rows with source_feed = CDSS_GAPFILL — would only exist if Fix B ran
  const r4 = await pool.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM facilities
     WHERE updated_at > $1 AND geocode_quality = 'chhs_geo'`,
    [Date.now() - 7 * 24 * 60 * 60 * 1000],
  );
  console.log(`\nWith chhs_geo coords, updated in last 7 days: ${Number(r4.rows[0].n).toLocaleString()}`);

  await pool.end();
})().catch((e: any) => { console.error("ERR", e.code || e.message); pool.end(); process.exit(1); });
