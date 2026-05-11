import { pool } from "../server/db/index.js";

async function main() {
  console.log("\n=== Recent incidents (top 5) ===");
  const inc = await pool.query(
    `SELECT id, facility_number, incident_type, description, reported_by, status,
            supervisor_notified, family_notified, physician_notified,
            lic_624_required, lic_624_submitted, incident_date, created_at
     FROM ops_incidents
     ORDER BY created_at DESC
     LIMIT 5`,
  );
  console.log(JSON.stringify(inc.rows, null, 2));

  console.log("\n=== Recent meds (top 10) ===");
  const meds = await pool.query(
    `SELECT id, drug_name, dosage, route, frequency, scheduled_times, prescriber_name, status
     FROM ops_medications
     ORDER BY id DESC
     LIMIT 10`,
  );
  console.log(JSON.stringify(meds.rows, null, 2));

  console.log("\n=== Recent notes (top 5) ===");
  const notes = await pool.query(
    `SELECT id, body, author_display_name, priority, status, ack_required, created_at
     FROM ops_notes
     ORDER BY created_at DESC
     LIMIT 5`,
  );
  console.log(JSON.stringify(notes.rows, null, 2));

  console.log("\n=== Compliance calendar (top 5) ===");
  try {
    const comp = await pool.query(
      `SELECT id, item_type, description, due_date, status, assigned_to
       FROM ops_compliance_calendar
       ORDER BY due_date DESC
       LIMIT 5`,
    );
    console.log(JSON.stringify(comp.rows, null, 2));
  } catch (e) {
    console.log("(error:", (e as Error).message, ")");
  }

  console.log("\n=== Staff (top 5) ===");
  try {
    const st = await pool.query(
      `SELECT id, first_name, last_name, role, status, license_expiry
       FROM ops_staff
       ORDER BY id DESC
       LIMIT 5`,
    );
    console.log(JSON.stringify(st.rows, null, 2));
  } catch (e) {
    console.log("(error:", (e as Error).message, ")");
  }

  console.log("\n=== Med passes for today (sample) ===");
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  const dayEnd = dayStart.getTime() + 86400000;
  try {
    const mp = await pool.query(
      `SELECT mp.id, mp.scheduled_datetime, mp.status, m.drug_name, m.dosage
       FROM ops_med_passes mp
       LEFT JOIN ops_medications m ON m.id = mp.medication_id
       WHERE mp.scheduled_datetime >= $1 AND mp.scheduled_datetime < $2
       ORDER BY mp.scheduled_datetime ASC
       LIMIT 10`,
      [dayStart.getTime(), dayEnd],
    );
    console.log(JSON.stringify(mp.rows, null, 2));
  } catch (e) {
    console.log("(error:", (e as Error).message, ")");
  }

  console.log("\n=== Residents (top 10) ===");
  try {
    const r = await pool.query(
      `SELECT id, facility_number, first_name, last_name, status, level_of_care
       FROM ops_residents
       ORDER BY id DESC
       LIMIT 10`,
    );
    console.log(JSON.stringify(r.rows, null, 2));
  } catch (e) {
    console.log("(error:", (e as Error).message, ")");
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
