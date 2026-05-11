import { pool } from "../server/db/index.js";

async function main() {
  const fac = "374604513";
  console.log("\n=== ops_incidents (full shape) ===");
  const inc = await pool.query(`SELECT * FROM ops_incidents WHERE facility_number=$1`, [fac]);
  console.log(JSON.stringify(inc.rows, null, 2));

  console.log("\n=== ops_med_passes today (with full medication join) ===");
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = dayStart.getTime() + 86400000;
  const mp = await pool.query(
    `SELECT mp.*, m.drug_name, m.dosage, m.route, m.scheduled_times
     FROM ops_med_passes mp
     LEFT JOIN ops_medications m ON m.id = mp.medication_id
     WHERE mp.facility_number=$1 AND mp.scheduled_datetime >= $2 AND mp.scheduled_datetime < $3
     LIMIT 5`,
    [fac, dayStart.getTime(), dayEnd],
  );
  console.log(JSON.stringify(mp.rows, null, 2));

  console.log("\n=== compliance overdue ===");
  const co = await pool.query(
    `SELECT * FROM ops_compliance_calendar WHERE facility_number=$1 AND status='pending' AND due_date<$2`,
    [fac, Date.now()],
  );
  console.log(JSON.stringify(co.rows, null, 2));

  console.log("\n=== ops_notes (any status) ===");
  const no = await pool.query(`SELECT * FROM ops_notes WHERE facility_number=$1 ORDER BY created_at DESC LIMIT 5`, [fac]);
  console.log(JSON.stringify(no.rows, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
