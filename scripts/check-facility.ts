import "dotenv/config";
import { Pool } from "pg";

const facNum = process.argv[2];
if (!facNum) { console.error("usage: tsx scripts/check-facility.ts <number>"); process.exit(1); }
if (!process.env.DATABASE_URL) { console.error("DATABASE_URL not set"); process.exit(1); }

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

(async () => {
  const r = await pool.query(
    `SELECT number, name, facility_type, facility_group, status, address, city, county, zip,
            phone, licensee, administrator, capacity, first_license_date, closed_date,
            last_inspection_date, lat, lng, geocode_quality,
            to_timestamp(updated_at/1000) AT TIME ZONE 'UTC' AS updated_at_utc
     FROM facilities WHERE number = $1`,
    [facNum],
  );
  if (r.rows.length === 0) console.log(`NOT FOUND in DB: ${facNum}`);
  else console.log(JSON.stringify(r.rows[0], null, 2));
  await pool.end();
})().catch((e: any) => { console.error("ERR", e.code || e.message); pool.end(); process.exit(1); });
