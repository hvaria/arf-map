import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { db, sqlite, pool, usingPostgres } from "../db/index";
import { OPS_PG_SCHEMA_SQL } from "./opsSchema";
import {
  opsResidents,
  opsResidentAssessments,
  opsCarePlans,
  opsDailyTasks,
  opsMedications,
  opsMedPasses,
  opsControlledSubCounts,
  opsMedDestruction,
  opsIncidents,
  opsLeads,
  opsTours,
  opsAdmissions,
  opsBillingCharges,
  opsInvoices,
  opsPayments,
  opsStaff,
  opsShifts,
  opsComplianceCalendar,
  type OpsResident,
  type InsertOpsResident,
  type OpsResidentAssessment,
  type InsertOpsResidentAssessment,
  type OpsCarePlan,
  type InsertOpsCarePlan,
  type OpsDailyTask,
  type InsertOpsDailyTask,
  type OpsMedication,
  type InsertOpsMedication,
  type OpsMedPass,
  type InsertOpsMedPass,
  type OpsControlledSubCount,
  type InsertOpsControlledSubCount,
  type OpsMedDestruction,
  type InsertOpsMedDestruction,
  type OpsIncident,
  type InsertOpsIncident,
  type OpsLead,
  type InsertOpsLead,
  type OpsTour,
  type InsertOpsTour,
  type OpsAdmission,
  type InsertOpsAdmission,
  type OpsBillingCharge,
  type InsertOpsBillingCharge,
  type OpsInvoice,
  type InsertOpsInvoice,
  type OpsPayment,
  type InsertOpsPayment,
  type OpsStaffMember,
  type InsertOpsStaffMember,
  type OpsShift,
  type InsertOpsShift,
  type OpsComplianceItem,
  type InsertOpsComplianceItem,
} from "./opsSchema";

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap — create all ops_ tables in PostgreSQL mode on startup
// ─────────────────────────────────────────────────────────────────────────────

export async function bootstrapOpsSchema(): Promise<void> {
  if (!usingPostgres) return;
  await pool!.query(OPS_PG_SCHEMA_SQL);
  console.log("[ops] PostgreSQL tables bootstrapped");
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function pgFirst<T>(q: Promise<T[]>): Promise<T | undefined> {
  return (await q)[0];
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 1 — Residents / EHR
// ─────────────────────────────────────────────────────────────────────────────

export async function listResidents(
  facilityNumber: string,
  opts: { page: number; limit: number; status?: string }
): Promise<{ residents: OpsResident[]; total: number }> {
  const { page, limit, status } = opts;
  const offset = (page - 1) * limit;

  const conditions = status
    ? and(eq(opsResidents.facilityNumber, facilityNumber), eq(opsResidents.status, status))
    : eq(opsResidents.facilityNumber, facilityNumber);

  if (usingPostgres) {
    const [residents, countRows] = await Promise.all([
      db.select().from(opsResidents).where(conditions).limit(limit).offset(offset).orderBy(desc(opsResidents.createdAt)),
      db.select({ count: sql<number>`count(*)::int` }).from(opsResidents).where(conditions),
    ]);
    return { residents, total: countRows[0]?.count ?? 0 };
  }

  const residents = db.select().from(opsResidents).where(conditions).limit(limit).offset(offset).orderBy(desc(opsResidents.createdAt)).all();
  const countRow = db.select({ count: sql<number>`count(*)` }).from(opsResidents).where(conditions).get();
  return { residents, total: countRow?.count ?? 0 };
}

export async function getResident(id: number, facilityNumber: string): Promise<OpsResident | undefined> {
  const cond = and(eq(opsResidents.id, id), eq(opsResidents.facilityNumber, facilityNumber));
  if (usingPostgres) return pgFirst(db.select().from(opsResidents).where(cond));
  return db.select().from(opsResidents).where(cond).get();
}

export async function createResident(data: InsertOpsResident): Promise<OpsResident> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.insert(opsResidents).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return rows[0] as OpsResident;
  }
  return db.insert(opsResidents).values({ ...data, createdAt: now, updatedAt: now }).returning().get();
}

export async function updateResident(id: number, facilityNumber: string, data: Partial<InsertOpsResident>): Promise<OpsResident | undefined> {
  const now = Date.now();
  const cond = and(eq(opsResidents.id, id), eq(opsResidents.facilityNumber, facilityNumber));
  if (usingPostgres) {
    const rows = await db.update(opsResidents).set({ ...data, updatedAt: now }).where(cond).returning();
    return rows[0] as OpsResident | undefined;
  }
  return db.update(opsResidents).set({ ...data, updatedAt: now }).where(cond).returning().get();
}

export async function softDeleteResident(id: number, facilityNumber: string): Promise<boolean> {
  const now = Date.now();
  const cond = and(eq(opsResidents.id, id), eq(opsResidents.facilityNumber, facilityNumber));
  if (usingPostgres) {
    const rows = await db.update(opsResidents).set({ status: "discharged", dischargeDate: now, updatedAt: now }).where(cond).returning({ id: opsResidents.id });
    return rows.length > 0;
  }
  const result = db.update(opsResidents).set({ status: "discharged", dischargeDate: now, updatedAt: now }).where(cond).run();
  return result.changes > 0;
}

// Assessments

export async function listAssessments(residentId: number, facilityNumber: string): Promise<OpsResidentAssessment[]> {
  const cond = and(eq(opsResidentAssessments.residentId, residentId), eq(opsResidentAssessments.facilityNumber, facilityNumber));
  if (usingPostgres) {
    return db.select().from(opsResidentAssessments).where(cond).orderBy(desc(opsResidentAssessments.assessedAt));
  }
  return db.select().from(opsResidentAssessments).where(cond).orderBy(desc(opsResidentAssessments.assessedAt)).all();
}

export async function createAssessment(data: InsertOpsResidentAssessment): Promise<OpsResidentAssessment> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.insert(opsResidentAssessments).values({ ...data, createdAt: now }).returning();
    return rows[0] as OpsResidentAssessment;
  }
  return db.insert(opsResidentAssessments).values({ ...data, createdAt: now }).returning().get();
}

export async function updateAssessment(id: number, data: Partial<InsertOpsResidentAssessment>): Promise<OpsResidentAssessment | undefined> {
  if (usingPostgres) {
    const rows = await db.update(opsResidentAssessments).set(data).where(eq(opsResidentAssessments.id, id)).returning();
    return rows[0] as OpsResidentAssessment | undefined;
  }
  return db.update(opsResidentAssessments).set(data).where(eq(opsResidentAssessments.id, id)).returning().get();
}

// Care Plans

export async function getActiveCarePlan(residentId: number, facilityNumber: string): Promise<OpsCarePlan | undefined> {
  const cond = and(eq(opsCarePlans.residentId, residentId), eq(opsCarePlans.facilityNumber, facilityNumber));
  if (usingPostgres) {
    const rows = await db.select().from(opsCarePlans).where(cond).orderBy(desc(opsCarePlans.createdAt)).limit(1);
    return rows[0] as OpsCarePlan | undefined;
  }
  return db.select().from(opsCarePlans).where(cond).orderBy(desc(opsCarePlans.createdAt)).limit(1).get();
}

export async function createCarePlan(data: InsertOpsCarePlan): Promise<OpsCarePlan> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.insert(opsCarePlans).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return rows[0] as OpsCarePlan;
  }
  return db.insert(opsCarePlans).values({ ...data, createdAt: now, updatedAt: now }).returning().get();
}

export async function updateCarePlan(id: number, data: Partial<InsertOpsCarePlan>): Promise<OpsCarePlan | undefined> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.update(opsCarePlans).set({ ...data, updatedAt: now }).where(eq(opsCarePlans.id, id)).returning();
    return rows[0] as OpsCarePlan | undefined;
  }
  return db.update(opsCarePlans).set({ ...data, updatedAt: now }).where(eq(opsCarePlans.id, id)).returning().get();
}

export async function signCarePlan(id: number, signerType: "resident" | "family", signature: string): Promise<boolean> {
  const now = Date.now();
  const updateData = signerType === "resident"
    ? { digitalSignatureResident: signature, signatureDate: now, updatedAt: now }
    : { digitalSignatureFamily: signature, signatureDate: now, updatedAt: now };

  if (usingPostgres) {
    const rows = await db.update(opsCarePlans).set(updateData).where(eq(opsCarePlans.id, id)).returning({ id: opsCarePlans.id });
    return rows.length > 0;
  }
  const result = db.update(opsCarePlans).set(updateData).where(eq(opsCarePlans.id, id)).run();
  return result.changes > 0;
}

// Daily Tasks

export async function getDailyTasks(residentId: number, facilityNumber: string, taskDate: number, shift?: string): Promise<OpsDailyTask[]> {
  const conditions = shift
    ? and(eq(opsDailyTasks.residentId, residentId), eq(opsDailyTasks.facilityNumber, facilityNumber), eq(opsDailyTasks.taskDate, taskDate), eq(opsDailyTasks.shift, shift))
    : and(eq(opsDailyTasks.residentId, residentId), eq(opsDailyTasks.facilityNumber, facilityNumber), eq(opsDailyTasks.taskDate, taskDate));

  if (usingPostgres) return db.select().from(opsDailyTasks).where(conditions);
  return db.select().from(opsDailyTasks).where(conditions).all();
}

export async function completeTask(id: number, notes: string, completedAt: number): Promise<boolean> {
  if (usingPostgres) {
    const rows = await db.update(opsDailyTasks).set({ status: "completed", completionNotes: notes, completedAt }).where(eq(opsDailyTasks.id, id)).returning({ id: opsDailyTasks.id });
    return rows.length > 0;
  }
  const result = db.update(opsDailyTasks).set({ status: "completed", completionNotes: notes, completedAt }).where(eq(opsDailyTasks.id, id)).run();
  return result.changes > 0;
}

export async function refuseTask(id: number, reason: string): Promise<boolean> {
  if (usingPostgres) {
    const rows = await db.update(opsDailyTasks).set({ status: "refused", refused: 1, refuseReason: reason }).where(eq(opsDailyTasks.id, id)).returning({ id: opsDailyTasks.id });
    return rows.length > 0;
  }
  const result = db.update(opsDailyTasks).set({ status: "refused", refused: 1, refuseReason: reason }).where(eq(opsDailyTasks.id, id)).run();
  return result.changes > 0;
}

export async function createDailyTasksFromCarePlan(carePlanId: number, residentId: number, facilityNumber: string): Promise<number> {
  let carePlan: OpsCarePlan | undefined;
  if (usingPostgres) {
    const rows = await db.select().from(opsCarePlans).where(eq(opsCarePlans.id, carePlanId));
    carePlan = rows[0] as OpsCarePlan | undefined;
  } else {
    carePlan = db.select().from(opsCarePlans).where(eq(opsCarePlans.id, carePlanId)).get();
  }

  if (!carePlan) return 0;

  const now = Date.now();
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const taskDate = today.getTime();

  const taskData: InsertOpsDailyTask = {
    carePlanId,
    residentId,
    facilityNumber,
    taskName: carePlan.goal,
    taskType: "care_plan",
    shift: "day",
    assignedTo: carePlan.responsibleStaff ?? undefined,
    status: "pending",
    taskDate,
    createdAt: now,
  };

  if (usingPostgres) {
    await db.insert(opsDailyTasks).values(taskData);
  } else {
    db.insert(opsDailyTasks).values(taskData).run();
  }
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 2 — Medications / eMAR
// ─────────────────────────────────────────────────────────────────────────────

export async function listMedications(residentId: number, facilityNumber: string, status?: string): Promise<OpsMedication[]> {
  const conditions = status
    ? and(eq(opsMedications.residentId, residentId), eq(opsMedications.facilityNumber, facilityNumber), eq(opsMedications.status, status))
    : and(eq(opsMedications.residentId, residentId), eq(opsMedications.facilityNumber, facilityNumber));

  if (usingPostgres) return db.select().from(opsMedications).where(conditions);
  return db.select().from(opsMedications).where(conditions).all();
}

export async function createMedication(data: InsertOpsMedication): Promise<OpsMedication> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.insert(opsMedications).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return rows[0] as OpsMedication;
  }
  return db.insert(opsMedications).values({ ...data, createdAt: now, updatedAt: now }).returning().get();
}

export async function updateMedication(id: number, facilityNumber: string, data: Partial<InsertOpsMedication>): Promise<OpsMedication | undefined> {
  const now = Date.now();
  const cond = and(eq(opsMedications.id, id), eq(opsMedications.facilityNumber, facilityNumber));
  if (usingPostgres) {
    const rows = await db.update(opsMedications).set({ ...data, updatedAt: now }).where(cond).returning();
    return rows[0] as OpsMedication | undefined;
  }
  return db.update(opsMedications).set({ ...data, updatedAt: now }).where(cond).returning().get();
}

export async function discontinueMedication(id: number, facilityNumber: string, reason: string, by: string): Promise<boolean> {
  const now = Date.now();
  const cond = and(eq(opsMedications.id, id), eq(opsMedications.facilityNumber, facilityNumber));
  const updateData = { status: "discontinued", discontinuedReason: reason, discontinuedBy: by, discontinuedAt: now, updatedAt: now };
  if (usingPostgres) {
    const rows = await db.update(opsMedications).set(updateData).where(cond).returning({ id: opsMedications.id });
    return rows.length > 0;
  }
  const result = db.update(opsMedications).set(updateData).where(cond).run();
  return result.changes > 0;
}

// Med pass queue

export async function generateDailyMedPassEntries(facilityNumber: string, date: number): Promise<void> {
  const dayStart = date;
  const dayEnd = date + 86400000;

  if (usingPostgres) {
    const medsResult = await pool!.query<{
      medication_id: number; resident_id: number; scheduled_times: string | null; is_prn: number;
    }>(
      `SELECT m.id AS medication_id, m.resident_id, m.scheduled_times, m.is_prn
       FROM ops_medications m
       JOIN ops_residents r ON m.resident_id = r.id
       WHERE m.facility_number = $1 AND m.status = 'active'
         AND (m.start_date IS NULL OR m.start_date <= $2)
         AND (m.end_date IS NULL OR m.end_date >= $3)
         AND r.status = 'active'`,
      [facilityNumber, dayEnd, dayStart]
    );
    for (const med of medsResult.rows) {
      if (med.is_prn) continue;
      const times = med.scheduled_times
        ? med.scheduled_times.split(",").map((t) => t.trim()).filter(Boolean)
        : ["08:00"];
      for (const time of times) {
        const [h, m] = time.split(":").map(Number);
        if (isNaN(h) || isNaN(m)) continue;
        const dt = new Date(date);
        dt.setHours(h, m, 0, 0);
        const scheduledDatetime = dt.getTime();
        await pool!.query(
          `INSERT INTO ops_med_passes (medication_id, resident_id, facility_number, scheduled_datetime, status, created_at)
           SELECT $1, $2, $3, $4, 'pending', $5
           WHERE NOT EXISTS (SELECT 1 FROM ops_med_passes WHERE medication_id = $1 AND scheduled_datetime = $4)`,
          [med.medication_id, med.resident_id, facilityNumber, scheduledDatetime, Date.now()]
        );
      }
    }
    return;
  }

  const meds = sqlite!.prepare(
    `SELECT m.id AS medication_id, m.resident_id, m.scheduled_times, m.is_prn
     FROM ops_medications m
     JOIN ops_residents r ON m.resident_id = r.id
     WHERE m.facility_number = ?
       AND m.status = 'active'
       AND (m.start_date IS NULL OR m.start_date <= ?)
       AND (m.end_date IS NULL OR m.end_date >= ?)
       AND r.status = 'active'`
  ).all(facilityNumber, dayEnd, dayStart) as Array<{
    medication_id: number; resident_id: number; scheduled_times: string | null; is_prn: number;
  }>;

  const insert = sqlite!.prepare(
    `INSERT INTO ops_med_passes (medication_id, resident_id, facility_number, scheduled_datetime, status, created_at)
     SELECT ?, ?, ?, ?, 'pending', ?
     WHERE NOT EXISTS (SELECT 1 FROM ops_med_passes WHERE medication_id = ? AND scheduled_datetime = ?)`
  );

  for (const med of meds) {
    if (med.is_prn) continue;
    const times = med.scheduled_times
      ? med.scheduled_times.split(",").map((t) => t.trim()).filter(Boolean)
      : ["08:00"];
    for (const time of times) {
      const [h, m] = time.split(":").map(Number);
      if (isNaN(h) || isNaN(m)) continue;
      const dt = new Date(date);
      dt.setHours(h, m, 0, 0);
      const scheduledDatetime = dt.getTime();
      insert.run(med.medication_id, med.resident_id, facilityNumber, scheduledDatetime, Date.now(), med.medication_id, scheduledDatetime);
    }
  }
}

export interface MedPassRawRow {
  id: number;
  medication_id: number;
  resident_id: number;
  facility_number: string;
  scheduled_datetime: number;
  administered_datetime: number | null;
  administered_by: string | null;
  status: string;
  refusal_reason: string | null;
  hold_reason: string | null;
  notes: string | null;
  drug_name: string;
  dosage: string;
  route: string;
  prescriber_name: string | null;
  resident_first_name: string;
  resident_last_name: string;
  room_number: string | null;
}

export async function getFacilityMedPassQueue(
  facilityNumber: string,
  date: number
): Promise<MedPassRawRow[]> {
  const dayStart = date;
  const dayEnd = date + 86400000;

  const pgSql = `SELECT mp.id, mp.medication_id, mp.resident_id, mp.facility_number,
       mp.scheduled_datetime, mp.administered_datetime, mp.administered_by,
       mp.status, mp.refusal_reason, mp.hold_reason, mp.notes,
       m.drug_name, m.dosage, m.route, m.prescriber_name,
       r.first_name AS resident_first_name, r.last_name AS resident_last_name, r.room_number
       FROM ops_med_passes mp
       JOIN ops_medications m ON mp.medication_id = m.id
       JOIN ops_residents r ON mp.resident_id = r.id
       WHERE mp.facility_number = $1
         AND mp.scheduled_datetime >= $2
         AND mp.scheduled_datetime < $3
       ORDER BY mp.scheduled_datetime ASC`;

  const sqliteSql = pgSql.replace("$1", "?").replace("$2", "?").replace("$3", "?");

  if (usingPostgres) {
    const result = await pool!.query(pgSql, [facilityNumber, dayStart, dayEnd]);
    return result.rows as MedPassRawRow[];
  }

  return sqlite!.prepare(sqliteSql).all(facilityNumber, dayStart, dayEnd) as MedPassRawRow[];
}

export async function getResidentMedPassQueue(
  residentId: number,
  facilityNumber: string,
  date: number
): Promise<Array<OpsMedPass & { drug_name: string }>> {
  const dayStart = date;
  const dayEnd = date + 86400000;

  if (usingPostgres) {
    const result = await pool!.query(
      `SELECT mp.*, m.drug_name
       FROM ops_med_passes mp
       JOIN ops_medications m ON mp.medication_id = m.id
       WHERE mp.resident_id = $1
         AND mp.facility_number = $2
         AND mp.scheduled_datetime >= $3
         AND mp.scheduled_datetime < $4
       ORDER BY mp.scheduled_datetime ASC`,
      [residentId, facilityNumber, dayStart, dayEnd]
    );
    return result.rows;
  }

  return sqlite!
    .prepare(
      `SELECT mp.*, m.drug_name
       FROM ops_med_passes mp
       JOIN ops_medications m ON mp.medication_id = m.id
       WHERE mp.resident_id = ?
         AND mp.facility_number = ?
         AND mp.scheduled_datetime >= ?
         AND mp.scheduled_datetime < ?
       ORDER BY mp.scheduled_datetime ASC`
    )
    .all(residentId, facilityNumber, dayStart, dayEnd) as Array<OpsMedPass & { drug_name: string }>;
}

export async function recordMedPass(data: InsertOpsMedPass): Promise<OpsMedPass> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.insert(opsMedPasses).values({ ...data, createdAt: now }).returning();
    return rows[0] as OpsMedPass;
  }
  return db.insert(opsMedPasses).values({ ...data, createdAt: now }).returning().get();
}

export async function updateMedPassRecord(
  id: number,
  data: Partial<{
    status: string;
    administeredDatetime: number;
    administeredBy: string;
    notes: string;
    refusalReason: string;
    holdReason: string;
    rightResident: number;
    rightMedication: number;
    rightDose: number;
    rightRoute: number;
    rightTime: number;
    rightReason: number;
    rightDocumentation: number;
    rightToRefuse: number;
  }>
): Promise<boolean> {
  if (usingPostgres) {
    const rows = await db
      .update(opsMedPasses)
      .set(data)
      .where(eq(opsMedPasses.id, id))
      .returning({ id: opsMedPasses.id });
    return rows.length > 0;
  }
  const result = db.update(opsMedPasses).set(data).where(eq(opsMedPasses.id, id)).run();
  return result.changes > 0;
}

export async function updatePrnFollowup(id: number, effectivenessNotes: string, notedAt: number): Promise<boolean> {
  const updateData = { prnEffectivenessNotes: effectivenessNotes, prnEffectivenessNotedAt: notedAt };
  if (usingPostgres) {
    const rows = await db.update(opsMedPasses).set(updateData).where(eq(opsMedPasses.id, id)).returning({ id: opsMedPasses.id });
    return rows.length > 0;
  }
  const result = db.update(opsMedPasses).set(updateData).where(eq(opsMedPasses.id, id)).run();
  return result.changes > 0;
}

// Med-pass calendar summary

export interface DaySummary {
  date: string;   // YYYY-MM-DD
  total: number;
  given: number;
  pending: number;
  late: number;
  missed: number;
  refused: number;
  held: number;
}

export async function getMedPassSummary(
  facilityNumber: string,
  fromMs: number,  // inclusive, epoch ms at 00:00 UTC of from-date
  toMs: number,    // exclusive, epoch ms at 00:00 UTC of day-after to-date
): Promise<DaySummary[]> {
  if (usingPostgres) {
    const res = await pool!.query<DaySummary>(
      `SELECT
         TO_CHAR(TO_TIMESTAMP(scheduled_datetime / 1000.0), 'YYYY-MM-DD') AS date,
         COUNT(*)::int                                                     AS total,
         SUM(CASE WHEN status='given'   THEN 1 ELSE 0 END)::int           AS given,
         SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END)::int           AS pending,
         SUM(CASE WHEN status='late'    THEN 1 ELSE 0 END)::int           AS late,
         SUM(CASE WHEN status='missed'  THEN 1 ELSE 0 END)::int           AS missed,
         SUM(CASE WHEN status='refused' THEN 1 ELSE 0 END)::int           AS refused,
         SUM(CASE WHEN status='held'    THEN 1 ELSE 0 END)::int           AS held
       FROM ops_med_passes
       WHERE facility_number = $1
         AND scheduled_datetime >= $2
         AND scheduled_datetime <  $3
       GROUP BY 1 ORDER BY 1`,
      [facilityNumber, fromMs, toMs],
    );
    return res.rows;
  }
  return (sqlite!
    .prepare(
      `SELECT
         date(scheduled_datetime / 1000, 'unixepoch', 'localtime') AS date,
         COUNT(*)                                      AS total,
         SUM(CASE WHEN status='given'   THEN 1 ELSE 0 END) AS given,
         SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status='late'    THEN 1 ELSE 0 END) AS late,
         SUM(CASE WHEN status='missed'  THEN 1 ELSE 0 END) AS missed,
         SUM(CASE WHEN status='refused' THEN 1 ELSE 0 END) AS refused,
         SUM(CASE WHEN status='held'    THEN 1 ELSE 0 END) AS held
       FROM ops_med_passes
       WHERE facility_number = ?
         AND scheduled_datetime >= ?
         AND scheduled_datetime <  ?
       GROUP BY date(scheduled_datetime / 1000, 'unixepoch', 'localtime')
       ORDER BY 1`,
    )
    .all(facilityNumber, fromMs, toMs) as DaySummary[]);
}

// Unified operations calendar summary

export interface DayOpsEvent {
  date: string;
  medsTotal:      number;
  medsGiven:      number;
  medsPending:    number;
  medsLate:       number;
  medsMissed:     number;
  tasksTotal:     number;
  tasksCompleted: number;
  tasksOverdue:   number;
  incidentsTotal: number;
  incidentsOpen:  number;
  leadsFollowups: number;
  billingDue:     number;
  complianceDue:  number;
}

export async function getCalendarSummary(
  facilityNumber: string,
  fromMs: number,
  toMs: number,
): Promise<DayOpsEvent[]> {
  type MedRow  = { date: string; total: number; given: number; pending: number; late: number; missed: number };
  type TaskRow = { date: string; total: number; completed: number; overdue: number };
  type IncRow  = { date: string; total: number; open: number };
  type LRow    = { date: string; followups: number };
  type BRow    = { date: string; due: number };
  type CRow    = { date: string; due: number };

  let medRows: MedRow[], taskRows: TaskRow[], incRows: IncRow[], leadRows: LRow[], billRows: BRow[], compRows: CRow[];

  if (usingPostgres) {
    const pg = (col: string) => `TO_CHAR(TO_TIMESTAMP(${col}/1000.0),'YYYY-MM-DD')`;
    const [r1, r2, r3, r4, r5, r6] = await Promise.all([
      pool!.query<MedRow>(`SELECT ${pg('scheduled_datetime')} AS date,COUNT(*)::int AS total,SUM(CASE WHEN status='given' THEN 1 ELSE 0 END)::int AS given,SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END)::int AS pending,SUM(CASE WHEN status='late' THEN 1 ELSE 0 END)::int AS late,SUM(CASE WHEN status='missed' THEN 1 ELSE 0 END)::int AS missed FROM ops_med_passes WHERE facility_number=$1 AND scheduled_datetime>=$2 AND scheduled_datetime<$3 GROUP BY 1`, [facilityNumber, fromMs, toMs]),
      pool!.query<TaskRow>(`SELECT ${pg('task_date')} AS date,COUNT(*)::int AS total,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)::int AS completed,SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END)::int AS overdue FROM ops_daily_tasks WHERE facility_number=$1 AND task_date>=$2 AND task_date<$3 GROUP BY 1`, [facilityNumber, fromMs, toMs]),
      pool!.query<IncRow>(`SELECT ${pg('incident_date')} AS date,COUNT(*)::int AS total,SUM(CASE WHEN status='open' THEN 1 ELSE 0 END)::int AS open FROM ops_incidents WHERE facility_number=$1 AND incident_date>=$2 AND incident_date<$3 GROUP BY 1`, [facilityNumber, fromMs, toMs]),
      pool!.query<LRow>(`SELECT ${pg('next_follow_up_date')} AS date,COUNT(*)::int AS followups FROM ops_leads WHERE facility_number=$1 AND next_follow_up_date IS NOT NULL AND next_follow_up_date>=$2 AND next_follow_up_date<$3 AND stage NOT IN ('admitted','lost') GROUP BY 1`, [facilityNumber, fromMs, toMs]),
      pool!.query<BRow>(`SELECT ${pg('due_date')} AS date,COUNT(*)::int AS due FROM ops_invoices WHERE facility_number=$1 AND due_date>=$2 AND due_date<$3 AND status NOT IN ('paid','void') AND balance_due>0 GROUP BY 1`, [facilityNumber, fromMs, toMs]),
      pool!.query<CRow>(`SELECT ${pg('due_date')} AS date,COUNT(*)::int AS due FROM ops_compliance_calendar WHERE facility_number=$1 AND due_date>=$2 AND due_date<$3 AND status='pending' GROUP BY 1`, [facilityNumber, fromMs, toMs]),
    ]);
    medRows = r1.rows; taskRows = r2.rows; incRows = r3.rows; leadRows = r4.rows; billRows = r5.rows; compRows = r6.rows;
  } else {
    const dt = (col: string) => `date(${col}/1000,'unixepoch','localtime')`;
    const q = (sql: string, ...p: unknown[]) => sqlite!.prepare(sql).all(...p) as any[];
    medRows  = q(`SELECT ${dt('scheduled_datetime')} AS date,COUNT(*) AS total,SUM(CASE WHEN status='given' THEN 1 ELSE 0 END) AS given,SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending,SUM(CASE WHEN status='late' THEN 1 ELSE 0 END) AS late,SUM(CASE WHEN status='missed' THEN 1 ELSE 0 END) AS missed FROM ops_med_passes WHERE facility_number=? AND scheduled_datetime>=? AND scheduled_datetime<? GROUP BY 1`, facilityNumber, fromMs, toMs);
    taskRows = q(`SELECT ${dt('task_date')} AS date,COUNT(*) AS total,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS completed,SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS overdue FROM ops_daily_tasks WHERE facility_number=? AND task_date>=? AND task_date<? GROUP BY 1`, facilityNumber, fromMs, toMs);
    incRows  = q(`SELECT ${dt('incident_date')} AS date,COUNT(*) AS total,SUM(CASE WHEN status='open' THEN 1 ELSE 0 END) AS open FROM ops_incidents WHERE facility_number=? AND incident_date>=? AND incident_date<? GROUP BY 1`, facilityNumber, fromMs, toMs);
    leadRows = q(`SELECT ${dt('next_follow_up_date')} AS date,COUNT(*) AS followups FROM ops_leads WHERE facility_number=? AND next_follow_up_date IS NOT NULL AND next_follow_up_date>=? AND next_follow_up_date<? AND stage NOT IN ('admitted','lost') GROUP BY 1`, facilityNumber, fromMs, toMs);
    billRows = q(`SELECT ${dt('due_date')} AS date,COUNT(*) AS due FROM ops_invoices WHERE facility_number=? AND due_date>=? AND due_date<? AND status NOT IN ('paid','void') AND balance_due>0 GROUP BY 1`, facilityNumber, fromMs, toMs);
    compRows = q(`SELECT ${dt('due_date')} AS date,COUNT(*) AS due FROM ops_compliance_calendar WHERE facility_number=? AND due_date>=? AND due_date<? AND status='pending' GROUP BY 1`, facilityNumber, fromMs, toMs);
  }

  const map = new Map<string, DayOpsEvent>();
  const get = (d: string): DayOpsEvent => {
    if (!map.has(d)) map.set(d, { date: d, medsTotal:0, medsGiven:0, medsPending:0, medsLate:0, medsMissed:0, tasksTotal:0, tasksCompleted:0, tasksOverdue:0, incidentsTotal:0, incidentsOpen:0, leadsFollowups:0, billingDue:0, complianceDue:0 });
    return map.get(d)!;
  };
  for (const r of medRows)  { const e = get(r.date); e.medsTotal=r.total; e.medsGiven=r.given; e.medsPending=r.pending; e.medsLate=r.late; e.medsMissed=r.missed; }
  for (const r of taskRows) { const e = get(r.date); e.tasksTotal=r.total; e.tasksCompleted=r.completed; e.tasksOverdue=r.overdue; }
  for (const r of incRows)  { const e = get(r.date); e.incidentsTotal=r.total; e.incidentsOpen=r.open; }
  for (const r of leadRows) { get(r.date).leadsFollowups = r.followups; }
  for (const r of billRows) { get(r.date).billingDue = r.due; }
  for (const r of compRows) { get(r.date).complianceDue = r.due; }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// Controlled substances

export async function recordControlledSubCount(data: InsertOpsControlledSubCount): Promise<OpsControlledSubCount> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.insert(opsControlledSubCounts).values({ ...data, createdAt: now }).returning();
    return rows[0] as OpsControlledSubCount;
  }
  return db.insert(opsControlledSubCounts).values({ ...data, createdAt: now }).returning().get();
}

export async function recordMedDestruction(data: InsertOpsMedDestruction): Promise<OpsMedDestruction> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.insert(opsMedDestruction).values({ ...data, createdAt: now }).returning();
    return rows[0] as OpsMedDestruction;
  }
  return db.insert(opsMedDestruction).values({ ...data, createdAt: now }).returning().get();
}

// Reports

export async function getMedPassDashboard(
  facilityNumber: string,
  date: number
): Promise<{ overdue: number; late: number; missed: number; given: number; pending: number }> {
  const dayStart = date;
  const dayEnd = date + 86400000;
  const now = Date.now();

  if (usingPostgres) {
    const result = await pool!.query<{ status: string; cnt: string; overdue_cnt: string }>(
      `SELECT status,
              COUNT(*)::int as cnt,
              SUM(CASE WHEN status = 'pending' AND scheduled_datetime < $1 THEN 1 ELSE 0 END)::int as overdue_cnt
       FROM ops_med_passes
       WHERE facility_number = $2
         AND scheduled_datetime >= $3
         AND scheduled_datetime < $4
       GROUP BY status`,
      [now, facilityNumber, dayStart, dayEnd]
    );
    const out = { overdue: 0, late: 0, missed: 0, given: 0, pending: 0 };
    for (const row of result.rows) {
      const cnt = Number(row.cnt);
      if (row.status === "given") out.given = cnt;
      else if (row.status === "missed") out.missed = cnt;
      else if (row.status === "late") out.late = cnt;
      else if (row.status === "pending") { out.pending = cnt; out.overdue = Number(row.overdue_cnt) ?? 0; }
    }
    return out;
  }

  const rows = sqlite!
    .prepare(
      `SELECT status,
              COUNT(*) as cnt,
              SUM(CASE WHEN status = 'pending' AND scheduled_datetime < ? THEN 1 ELSE 0 END) as overdue_cnt
       FROM ops_med_passes
       WHERE facility_number = ?
         AND scheduled_datetime >= ?
         AND scheduled_datetime < ?
       GROUP BY status`
    )
    .all(now, facilityNumber, dayStart, dayEnd) as Array<{ status: string; cnt: number; overdue_cnt: number }>;

  const result = { overdue: 0, late: 0, missed: 0, given: 0, pending: 0 };
  for (const row of rows) {
    if (row.status === "given") result.given = row.cnt;
    else if (row.status === "missed") result.missed = row.cnt;
    else if (row.status === "late") result.late = row.cnt;
    else if (row.status === "pending") { result.pending = row.cnt; result.overdue = row.overdue_cnt ?? 0; }
  }
  return result;
}

export async function getMedRefusals(facilityNumber: string, startDate: number, endDate: number): Promise<OpsMedPass[]> {
  const cond = and(eq(opsMedPasses.facilityNumber, facilityNumber), eq(opsMedPasses.status, "refused"), gte(opsMedPasses.scheduledDatetime, startDate), lte(opsMedPasses.scheduledDatetime, endDate));
  if (usingPostgres) return db.select().from(opsMedPasses).where(cond);
  return db.select().from(opsMedPasses).where(cond).all();
}

export async function getPrnReport(
  facilityNumber: string,
  startDate: number,
  endDate: number
): Promise<Array<OpsMedPass & { drug_name: string; resident_name: string }>> {
  if (usingPostgres) {
    const result = await pool!.query(
      `SELECT mp.*, m.drug_name, (r.first_name || ' ' || r.last_name) AS resident_name
       FROM ops_med_passes mp
       JOIN ops_medications m ON mp.medication_id = m.id
       JOIN ops_residents r ON mp.resident_id = r.id
       WHERE mp.facility_number = $1
         AND mp.prn_reason IS NOT NULL
         AND mp.scheduled_datetime >= $2
         AND mp.scheduled_datetime <= $3
       ORDER BY mp.scheduled_datetime DESC`,
      [facilityNumber, startDate, endDate]
    );
    return result.rows;
  }
  return sqlite!
    .prepare(
      `SELECT mp.*, m.drug_name, (r.first_name || ' ' || r.last_name) AS resident_name
       FROM ops_med_passes mp
       JOIN ops_medications m ON mp.medication_id = m.id
       JOIN ops_residents r ON mp.resident_id = r.id
       WHERE mp.facility_number = ?
         AND mp.prn_reason IS NOT NULL
         AND mp.scheduled_datetime >= ?
         AND mp.scheduled_datetime <= ?
       ORDER BY mp.scheduled_datetime DESC`
    )
    .all(facilityNumber, startDate, endDate) as Array<OpsMedPass & { drug_name: string; resident_name: string }>;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 3 — Incidents
// ─────────────────────────────────────────────────────────────────────────────

export async function listIncidents(
  facilityNumber: string,
  opts: { page: number; limit: number; type?: string; residentId?: number }
): Promise<{ incidents: OpsIncident[]; total: number }> {
  const { page, limit, type, residentId } = opts;
  const offset = (page - 1) * limit;

  if (usingPostgres) {
    const params: (string | number)[] = [facilityNumber];
    let where = "facility_number = $1";
    if (type) { params.push(type); where += ` AND incident_type = $${params.length}`; }
    if (residentId !== undefined) { params.push(residentId); where += ` AND resident_id = $${params.length}`; }

    const [rowsResult, countResult] = await Promise.all([
      pool!.query(`SELECT * FROM ops_incidents WHERE ${where} ORDER BY incident_date DESC LIMIT ${limit} OFFSET ${offset}`, params),
      pool!.query(`SELECT COUNT(*)::int as count FROM ops_incidents WHERE ${where}`, params),
    ]);
    return { incidents: rowsResult.rows, total: countResult.rows[0]?.count ?? 0 };
  }

  const whereParts: string[] = ["facility_number = ?"];
  const params: (string | number)[] = [facilityNumber];
  if (type) { whereParts.push("incident_type = ?"); params.push(type); }
  if (residentId !== undefined) { whereParts.push("resident_id = ?"); params.push(residentId); }
  const whereClause = whereParts.join(" AND ");

  const incidents = sqlite!
    .prepare(`SELECT * FROM ops_incidents WHERE ${whereClause} ORDER BY incident_date DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as OpsIncident[];
  const countRow = sqlite!
    .prepare(`SELECT COUNT(*) as count FROM ops_incidents WHERE ${whereClause}`)
    .get(...params) as { count: number };
  return { incidents, total: countRow?.count ?? 0 };
}

export async function createIncident(data: InsertOpsIncident): Promise<OpsIncident> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.insert(opsIncidents).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return rows[0] as OpsIncident;
  }
  return db.insert(opsIncidents).values({ ...data, createdAt: now, updatedAt: now }).returning().get();
}

export async function updateIncident(id: number, facilityNumber: string, data: Partial<InsertOpsIncident>): Promise<OpsIncident | undefined> {
  const now = Date.now();
  const cond = and(eq(opsIncidents.id, id), eq(opsIncidents.facilityNumber, facilityNumber));
  if (usingPostgres) {
    const rows = await db.update(opsIncidents).set({ ...data, updatedAt: now }).where(cond).returning();
    return rows[0] as OpsIncident | undefined;
  }
  return db.update(opsIncidents).set({ ...data, updatedAt: now }).where(cond).returning().get();
}

export async function getIncidentTrends(
  facilityNumber: string,
  days: number
): Promise<Array<{ incident_type: string; count: number; date: string }>> {
  const since = Date.now() - days * 86400000;

  if (usingPostgres) {
    const result = await pool!.query<{ incident_type: string; count: string; date: string }>(
      `SELECT incident_type,
              COUNT(*)::int as count,
              to_char(to_timestamp(incident_date / 1000.0), 'YYYY-MM-DD') as date
       FROM ops_incidents
       WHERE facility_number = $1 AND incident_date >= $2
       GROUP BY incident_type, to_char(to_timestamp(incident_date / 1000.0), 'YYYY-MM-DD')
       ORDER BY date DESC`,
      [facilityNumber, since]
    );
    return result.rows.map((r) => ({ incident_type: r.incident_type, count: Number(r.count), date: r.date }));
  }

  return sqlite!
    .prepare(
      `SELECT incident_type,
              COUNT(*) as count,
              date(incident_date / 1000, 'unixepoch') as date
       FROM ops_incidents
       WHERE facility_number = ? AND incident_date >= ?
       GROUP BY incident_type, date(incident_date / 1000, 'unixepoch')
       ORDER BY date DESC`
    )
    .all(facilityNumber, since) as Array<{ incident_type: string; count: number; date: string }>;
}

export function determineLic624Required(incidentType: string, injuryInvolved: boolean, hospitalizationRequired: boolean): boolean {
  if (incidentType === "death" || incidentType === "abuse_allegation" || incidentType === "elopement") return true;
  if (incidentType === "fall" && injuryInvolved) return true;
  if (hospitalizationRequired) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 4 — CRM / Admissions
// ─────────────────────────────────────────────────────────────────────────────

export async function listLeads(
  facilityNumber: string,
  opts: { page: number; limit: number; stage?: string }
): Promise<{ leads: OpsLead[]; total: number }> {
  const { page, limit, stage } = opts;
  const offset = (page - 1) * limit;

  const conditions = stage
    ? and(eq(opsLeads.facilityNumber, facilityNumber), eq(opsLeads.stage, stage))
    : eq(opsLeads.facilityNumber, facilityNumber);

  if (usingPostgres) {
    const [leads, countRows] = await Promise.all([
      db.select().from(opsLeads).where(conditions).limit(limit).offset(offset).orderBy(desc(opsLeads.createdAt)),
      db.select({ count: sql<number>`count(*)::int` }).from(opsLeads).where(conditions),
    ]);
    return { leads, total: countRows[0]?.count ?? 0 };
  }

  const leads = db.select().from(opsLeads).where(conditions).limit(limit).offset(offset).orderBy(desc(opsLeads.createdAt)).all();
  const countRow = db.select({ count: sql<number>`count(*)` }).from(opsLeads).where(conditions).get();
  return { leads, total: countRow?.count ?? 0 };
}

export async function getLead(id: number, facilityNumber: string): Promise<OpsLead | undefined> {
  const cond = and(eq(opsLeads.id, id), eq(opsLeads.facilityNumber, facilityNumber));
  if (usingPostgres) return pgFirst(db.select().from(opsLeads).where(cond));
  return db.select().from(opsLeads).where(cond).get();
}

export async function createLead(data: InsertOpsLead): Promise<OpsLead> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.insert(opsLeads).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return rows[0] as OpsLead;
  }
  return db.insert(opsLeads).values({ ...data, createdAt: now, updatedAt: now }).returning().get();
}

export async function updateLead(id: number, facilityNumber: string, data: Partial<InsertOpsLead>): Promise<OpsLead | undefined> {
  const now = Date.now();
  const cond = and(eq(opsLeads.id, id), eq(opsLeads.facilityNumber, facilityNumber));
  if (usingPostgres) {
    const rows = await db.update(opsLeads).set({ ...data, updatedAt: now }).where(cond).returning();
    return rows[0] as OpsLead | undefined;
  }
  return db.update(opsLeads).set({ ...data, updatedAt: now }).where(cond).returning().get();
}

export async function scheduleTour(data: InsertOpsTour): Promise<OpsTour> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.insert(opsTours).values({ ...data, createdAt: now }).returning();
    return rows[0] as OpsTour;
  }
  return db.insert(opsTours).values({ ...data, createdAt: now }).returning().get();
}

export async function updateTour(id: number, data: Partial<InsertOpsTour>): Promise<OpsTour | undefined> {
  if (usingPostgres) {
    const rows = await db.update(opsTours).set(data).where(eq(opsTours.id, id)).returning();
    return rows[0] as OpsTour | undefined;
  }
  return db.update(opsTours).set(data).where(eq(opsTours.id, id)).returning().get();
}

export async function startAdmission(data: InsertOpsAdmission): Promise<OpsAdmission> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.insert(opsAdmissions).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return rows[0] as OpsAdmission;
  }
  return db.insert(opsAdmissions).values({ ...data, createdAt: now, updatedAt: now }).returning().get();
}

export async function updateAdmissionLicForm(admissionId: number, form: string, completed: boolean): Promise<boolean> {
  const validForms: Record<string, { completedCol: string; dateCol: string }> = {
    lic_601:  { completedCol: "lic_601_completed",  dateCol: "lic_601_date" },
    lic_602a: { completedCol: "lic_602a_completed", dateCol: "lic_602a_date" },
    lic_603:  { completedCol: "lic_603_completed",  dateCol: "lic_603_date" },
    lic_604a: { completedCol: "lic_604a_completed", dateCol: "lic_604a_date" },
    lic_605a: { completedCol: "lic_605a_completed", dateCol: "lic_605a_date" },
    lic_610d: { completedCol: "lic_610d_completed", dateCol: "lic_610d_date" },
  };

  const mapping = validForms[form];
  if (!mapping) return false;

  const now = Date.now();

  if (usingPostgres) {
    const result = await pool!.query(
      `UPDATE ops_admissions SET ${mapping.completedCol} = $1, ${mapping.dateCol} = $2, updated_at = $3 WHERE id = $4`,
      [completed ? 1 : 0, completed ? now : null, now, admissionId]
    );
    return (result.rowCount ?? 0) > 0;
  }

  const result = sqlite!
    .prepare(`UPDATE ops_admissions SET ${mapping.completedCol} = ?, ${mapping.dateCol} = ?, updated_at = ? WHERE id = ?`)
    .run(completed ? 1 : 0, completed ? now : null, now, admissionId);
  return result.changes > 0;
}

export async function convertAdmissionToResident(admissionId: number): Promise<OpsResident | undefined> {
  let admission: OpsAdmission | undefined;
  if (usingPostgres) {
    const rows = await db.select().from(opsAdmissions).where(eq(opsAdmissions.id, admissionId));
    admission = rows[0] as OpsAdmission | undefined;
  } else {
    admission = db.select().from(opsAdmissions).where(eq(opsAdmissions.id, admissionId)).get();
  }
  if (!admission) return undefined;

  let lead: OpsLead | undefined;
  if (usingPostgres) {
    const rows = await db.select().from(opsLeads).where(eq(opsLeads.id, admission.leadId));
    lead = rows[0] as OpsLead | undefined;
  } else {
    lead = db.select().from(opsLeads).where(eq(opsLeads.id, admission.leadId)).get();
  }
  if (!lead) return undefined;

  const now = Date.now();
  const nameParts = lead.prospectName.trim().split(/\s+/);
  const firstName = nameParts[0] ?? lead.prospectName;
  const lastName = nameParts.slice(1).join(" ") || "Unknown";

  const residentData = {
    facilityNumber: lead.facilityNumber,
    firstName,
    lastName,
    dob: lead.prospectDob ?? undefined,
    gender: lead.prospectGender ?? undefined,
    admissionDate: admission.moveInDate ?? now,
    roomNumber: admission.assignedRoom ?? undefined,
    fundingSource: lead.fundingSource ?? undefined,
    status: "active" as const,
    createdAt: now,
    updatedAt: now,
  };

  let resident: OpsResident;
  if (usingPostgres) {
    const rows = await db.insert(opsResidents).values(residentData).returning();
    resident = rows[0] as OpsResident;
    await db.update(opsAdmissions).set({ residentId: resident.id, updatedAt: now }).where(eq(opsAdmissions.id, admissionId));
  } else {
    resident = db.insert(opsResidents).values(residentData).returning().get();
    db.update(opsAdmissions).set({ residentId: resident.id, updatedAt: now }).where(eq(opsAdmissions.id, admissionId)).run();
  }

  return resident;
}

export async function getOccupancy(facilityNumber: string): Promise<{
  total: number; active: number; beds_available: number; occupancy_rate: number;
}> {
  if (usingPostgres) {
    const [settingResult, activeResult] = await Promise.all([
      pool!.query<{ setting_value: string }>(
        `SELECT setting_value FROM ops_facility_settings WHERE facility_number = $1 AND setting_key = 'bed_capacity'`,
        [facilityNumber]
      ),
      pool!.query<{ count: string }>(
        `SELECT COUNT(*)::int as count FROM ops_residents WHERE facility_number = $1 AND status = 'active'`,
        [facilityNumber]
      ),
    ]);
    const total = settingResult.rows[0] ? parseInt(settingResult.rows[0].setting_value, 10) : 6;
    const active = Number(activeResult.rows[0]?.count ?? 0);
    return { total, active, beds_available: Math.max(0, total - active), occupancy_rate: total > 0 ? Math.round((active / total) * 100) : 0 };
  }

  const settingRow = sqlite!
    .prepare(`SELECT setting_value FROM ops_facility_settings WHERE facility_number = ? AND setting_key = 'bed_capacity'`)
    .get(facilityNumber) as { setting_value: string } | undefined;
  const total = settingRow ? parseInt(settingRow.setting_value, 10) : 6;
  const activeRow = sqlite!
    .prepare(`SELECT COUNT(*) as count FROM ops_residents WHERE facility_number = ? AND status = 'active'`)
    .get(facilityNumber) as { count: number };
  const active = activeRow?.count ?? 0;
  return { total, active, beds_available: Math.max(0, total - active), occupancy_rate: total > 0 ? Math.round((active / total) * 100) : 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 5 — Billing
// ─────────────────────────────────────────────────────────────────────────────

export async function listCharges(facilityNumber: string, residentId: number): Promise<OpsBillingCharge[]> {
  const cond = and(eq(opsBillingCharges.facilityNumber, facilityNumber), eq(opsBillingCharges.residentId, residentId));
  if (usingPostgres) return db.select().from(opsBillingCharges).where(cond).orderBy(desc(opsBillingCharges.createdAt));
  return db.select().from(opsBillingCharges).where(cond).orderBy(desc(opsBillingCharges.createdAt)).all();
}

export async function createCharge(data: InsertOpsBillingCharge): Promise<OpsBillingCharge> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.insert(opsBillingCharges).values({ ...data, createdAt: now }).returning();
    return rows[0] as OpsBillingCharge;
  }
  return db.insert(opsBillingCharges).values({ ...data, createdAt: now }).returning().get();
}

export async function deleteCharge(id: number, facilityNumber: string): Promise<boolean> {
  const cond = and(eq(opsBillingCharges.id, id), eq(opsBillingCharges.facilityNumber, facilityNumber));
  if (usingPostgres) {
    const rows = await db.delete(opsBillingCharges).where(cond).returning({ id: opsBillingCharges.id });
    return rows.length > 0;
  }
  const result = db.delete(opsBillingCharges).where(cond).run();
  return result.changes > 0;
}

export async function generateInvoice(facilityNumber: string, residentId: number, periodStart: number, periodEnd: number): Promise<OpsInvoice> {
  let subtotal = 0;

  if (usingPostgres) {
    const chargesResult = await pool!.query<{ subtotal: string }>(
      `SELECT COALESCE(SUM(amount * quantity), 0) as subtotal
       FROM ops_billing_charges
       WHERE facility_number = $1 AND resident_id = $2
         AND (
           (billing_period_start >= $3 AND billing_period_start <= $4)
           OR (billing_period_end >= $3 AND billing_period_end <= $4)
           OR (billing_period_start IS NULL)
         )`,
      [facilityNumber, residentId, periodStart, periodEnd]
    );
    subtotal = parseFloat(chargesResult.rows[0]?.subtotal ?? "0");
  } else {
    const chargesRow = sqlite!
      .prepare(
        `SELECT COALESCE(SUM(amount * quantity), 0) as subtotal
         FROM ops_billing_charges
         WHERE facility_number = ? AND resident_id = ?
           AND (
             (billing_period_start >= ? AND billing_period_start <= ?)
             OR (billing_period_end >= ? AND billing_period_end <= ?)
             OR (billing_period_start IS NULL)
           )`
      )
      .get(facilityNumber, residentId, periodStart, periodEnd, periodStart, periodEnd) as { subtotal: number };
    subtotal = chargesRow?.subtotal ?? 0;
  }

  const tax = 0;
  const total = subtotal + tax;
  const now = Date.now();
  const dueDate = now + 30 * 86400000;

  const invoiceData = {
    facilityNumber,
    residentId,
    invoiceNumber: `INV-${facilityNumber}-${now}`,
    billingPeriodStart: periodStart,
    billingPeriodEnd: periodEnd,
    subtotal,
    tax,
    total,
    amountPaid: 0,
    balanceDue: total,
    status: "draft" as const,
    dueDate,
    createdAt: now,
    updatedAt: now,
  };

  if (usingPostgres) {
    const rows = await db.insert(opsInvoices).values(invoiceData).returning();
    return rows[0] as OpsInvoice;
  }
  return db.insert(opsInvoices).values(invoiceData).returning().get();
}

export async function getInvoice(id: number): Promise<OpsInvoice | undefined> {
  if (usingPostgres) return pgFirst(db.select().from(opsInvoices).where(eq(opsInvoices.id, id)));
  return db.select().from(opsInvoices).where(eq(opsInvoices.id, id)).get();
}

export async function markInvoiceSent(id: number): Promise<boolean> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.update(opsInvoices).set({ status: "sent", sentAt: now, updatedAt: now }).where(eq(opsInvoices.id, id)).returning({ id: opsInvoices.id });
    return rows.length > 0;
  }
  const result = db.update(opsInvoices).set({ status: "sent", sentAt: now, updatedAt: now }).where(eq(opsInvoices.id, id)).run();
  return result.changes > 0;
}

export async function recordPayment(data: InsertOpsPayment): Promise<OpsPayment> {
  const now = Date.now();
  let payment: OpsPayment;

  if (usingPostgres) {
    const rows = await db.insert(opsPayments).values({ ...data, createdAt: now }).returning();
    payment = rows[0] as OpsPayment;
    const invRows = await db.select().from(opsInvoices).where(eq(opsInvoices.id, data.invoiceId));
    const invoice = invRows[0] as OpsInvoice | undefined;
    if (invoice) {
      const newAmountPaid = (invoice.amountPaid ?? 0) + data.amount;
      const newBalanceDue = Math.max(0, (invoice.total ?? 0) - newAmountPaid);
      const newStatus = newBalanceDue <= 0 ? "paid" : invoice.status === "draft" ? "sent" : invoice.status;
      await db.update(opsInvoices)
        .set({ amountPaid: newAmountPaid, balanceDue: newBalanceDue, status: newStatus, paidAt: newBalanceDue <= 0 ? now : invoice.paidAt, updatedAt: now })
        .where(eq(opsInvoices.id, data.invoiceId));
    }
  } else {
    payment = db.insert(opsPayments).values({ ...data, createdAt: now }).returning().get();
    const invoice = db.select().from(opsInvoices).where(eq(opsInvoices.id, data.invoiceId)).get() as OpsInvoice | undefined;
    if (invoice) {
      const newAmountPaid = (invoice.amountPaid ?? 0) + data.amount;
      const newBalanceDue = Math.max(0, (invoice.total ?? 0) - newAmountPaid);
      const newStatus = newBalanceDue <= 0 ? "paid" : invoice.status === "draft" ? "sent" : invoice.status;
      db.update(opsInvoices)
        .set({ amountPaid: newAmountPaid, balanceDue: newBalanceDue, status: newStatus, paidAt: newBalanceDue <= 0 ? now : invoice.paidAt, updatedAt: now })
        .where(eq(opsInvoices.id, data.invoiceId))
        .run();
    }
  }

  return payment;
}

export async function getArAging(facilityNumber: string): Promise<{
  current: number; days_30: number; days_60: number; days_90: number; over_90: number;
}> {
  const now = Date.now();
  const d30 = now - 30 * 86400000;
  const d60 = now - 60 * 86400000;
  const d90 = now - 90 * 86400000;

  if (usingPostgres) {
    const result = await pool!.query<{
      current_amt: string | null; days_30_amt: string | null; days_60_amt: string | null; days_90_amt: string | null; over_90_amt: string | null;
    }>(
      `SELECT
         SUM(CASE WHEN due_date >= $1 THEN balance_due ELSE 0 END) as current_amt,
         SUM(CASE WHEN due_date >= $2 AND due_date < $1 THEN balance_due ELSE 0 END) as days_30_amt,
         SUM(CASE WHEN due_date >= $3 AND due_date < $2 THEN balance_due ELSE 0 END) as days_60_amt,
         SUM(CASE WHEN due_date >= $4 AND due_date < $3 THEN balance_due ELSE 0 END) as days_90_amt,
         SUM(CASE WHEN due_date < $4 THEN balance_due ELSE 0 END) as over_90_amt
       FROM ops_invoices
       WHERE facility_number = $5 AND status NOT IN ('paid', 'void') AND balance_due > 0`,
      [now, d30, d60, d90, facilityNumber]
    );
    const r = result.rows[0];
    return {
      current: parseFloat(r?.current_amt ?? "0"),
      days_30: parseFloat(r?.days_30_amt ?? "0"),
      days_60: parseFloat(r?.days_60_amt ?? "0"),
      days_90: parseFloat(r?.days_90_amt ?? "0"),
      over_90: parseFloat(r?.over_90_amt ?? "0"),
    };
  }

  const rows = sqlite!
    .prepare(
      `SELECT
         SUM(CASE WHEN due_date >= ? THEN balance_due ELSE 0 END) as current_amt,
         SUM(CASE WHEN due_date >= ? AND due_date < ? THEN balance_due ELSE 0 END) as days_30_amt,
         SUM(CASE WHEN due_date >= ? AND due_date < ? THEN balance_due ELSE 0 END) as days_60_amt,
         SUM(CASE WHEN due_date >= ? AND due_date < ? THEN balance_due ELSE 0 END) as days_90_amt,
         SUM(CASE WHEN due_date < ? THEN balance_due ELSE 0 END) as over_90_amt
       FROM ops_invoices
       WHERE facility_number = ? AND status NOT IN ('paid', 'void') AND balance_due > 0`
    )
    .get(now, d30, now, d60, d30, d90, d60, d90, facilityNumber) as {
    current_amt: number | null; days_30_amt: number | null; days_60_amt: number | null; days_90_amt: number | null; over_90_amt: number | null;
  };

  return {
    current: rows?.current_amt ?? 0,
    days_30: rows?.days_30_amt ?? 0,
    days_60: rows?.days_60_amt ?? 0,
    days_90: rows?.days_90_amt ?? 0,
    over_90: rows?.over_90_amt ?? 0,
  };
}

export async function getBillingSummary(
  facilityNumber: string,
  periodStart: number,
  periodEnd: number
): Promise<{ total_billed: number; total_paid: number; total_outstanding: number }> {
  if (usingPostgres) {
    const result = await pool!.query<{ total_billed: string; total_paid: string; total_outstanding: string }>(
      `SELECT
         COALESCE(SUM(total), 0) as total_billed,
         COALESCE(SUM(amount_paid), 0) as total_paid,
         COALESCE(SUM(balance_due), 0) as total_outstanding
       FROM ops_invoices
       WHERE facility_number = $1
         AND billing_period_start >= $2
         AND billing_period_end <= $3`,
      [facilityNumber, periodStart, periodEnd]
    );
    const r = result.rows[0];
    return {
      total_billed: parseFloat(r?.total_billed ?? "0"),
      total_paid: parseFloat(r?.total_paid ?? "0"),
      total_outstanding: parseFloat(r?.total_outstanding ?? "0"),
    };
  }

  const row = sqlite!
    .prepare(
      `SELECT
         COALESCE(SUM(total), 0) as total_billed,
         COALESCE(SUM(amount_paid), 0) as total_paid,
         COALESCE(SUM(balance_due), 0) as total_outstanding
       FROM ops_invoices
       WHERE facility_number = ?
         AND billing_period_start >= ?
         AND billing_period_end <= ?`
    )
    .get(facilityNumber, periodStart, periodEnd) as { total_billed: number; total_paid: number; total_outstanding: number };

  return {
    total_billed: row?.total_billed ?? 0,
    total_paid: row?.total_paid ?? 0,
    total_outstanding: row?.total_outstanding ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 6 — Staff / Scheduling / Compliance
// ─────────────────────────────────────────────────────────────────────────────

export async function listStaff(facilityNumber: string, status?: string): Promise<OpsStaffMember[]> {
  const conditions = status
    ? and(eq(opsStaff.facilityNumber, facilityNumber), eq(opsStaff.status, status))
    : eq(opsStaff.facilityNumber, facilityNumber);
  if (usingPostgres) return db.select().from(opsStaff).where(conditions).orderBy(desc(opsStaff.createdAt));
  return db.select().from(opsStaff).where(conditions).orderBy(desc(opsStaff.createdAt)).all();
}

export async function createStaff(data: InsertOpsStaffMember): Promise<OpsStaffMember> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.insert(opsStaff).values({ ...data, createdAt: now, updatedAt: now }).returning();
    return rows[0] as OpsStaffMember;
  }
  return db.insert(opsStaff).values({ ...data, createdAt: now, updatedAt: now }).returning().get();
}

export async function updateStaff(id: number, facilityNumber: string, data: Partial<InsertOpsStaffMember>): Promise<OpsStaffMember | undefined> {
  const now = Date.now();
  const cond = and(eq(opsStaff.id, id), eq(opsStaff.facilityNumber, facilityNumber));
  if (usingPostgres) {
    const rows = await db.update(opsStaff).set({ ...data, updatedAt: now }).where(cond).returning();
    return rows[0] as OpsStaffMember | undefined;
  }
  return db.update(opsStaff).set({ ...data, updatedAt: now }).where(cond).returning().get();
}

export async function deactivateStaff(id: number, facilityNumber: string): Promise<boolean> {
  const now = Date.now();
  const cond = and(eq(opsStaff.id, id), eq(opsStaff.facilityNumber, facilityNumber));
  if (usingPostgres) {
    const rows = await db.update(opsStaff).set({ status: "inactive", terminationDate: now, updatedAt: now }).where(cond).returning({ id: opsStaff.id });
    return rows.length > 0;
  }
  const result = db.update(opsStaff).set({ status: "inactive", terminationDate: now, updatedAt: now }).where(cond).run();
  return result.changes > 0;
}

export async function listShifts(facilityNumber: string, weekStart: number): Promise<OpsShift[]> {
  const weekEnd = weekStart + 7 * 86400000;
  const cond = and(eq(opsShifts.facilityNumber, facilityNumber), gte(opsShifts.shiftDate, weekStart), lte(opsShifts.shiftDate, weekEnd));
  if (usingPostgres) return db.select().from(opsShifts).where(cond).orderBy(opsShifts.shiftDate);
  return db.select().from(opsShifts).where(cond).orderBy(opsShifts.shiftDate).all();
}

export async function createShift(data: InsertOpsShift): Promise<OpsShift> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.insert(opsShifts).values({ ...data, createdAt: now }).returning();
    return rows[0] as OpsShift;
  }
  return db.insert(opsShifts).values({ ...data, createdAt: now }).returning().get();
}

export async function updateShift(id: number, data: Partial<InsertOpsShift>): Promise<OpsShift | undefined> {
  if (usingPostgres) {
    const rows = await db.update(opsShifts).set(data).where(eq(opsShifts.id, id)).returning();
    return rows[0] as OpsShift | undefined;
  }
  return db.update(opsShifts).set(data).where(eq(opsShifts.id, id)).returning().get();
}

export async function listComplianceItems(facilityNumber: string, status?: string): Promise<OpsComplianceItem[]> {
  const conditions = status
    ? and(eq(opsComplianceCalendar.facilityNumber, facilityNumber), eq(opsComplianceCalendar.status, status))
    : eq(opsComplianceCalendar.facilityNumber, facilityNumber);
  if (usingPostgres) return db.select().from(opsComplianceCalendar).where(conditions).orderBy(opsComplianceCalendar.dueDate);
  return db.select().from(opsComplianceCalendar).where(conditions).orderBy(opsComplianceCalendar.dueDate).all();
}

export async function createComplianceItem(data: InsertOpsComplianceItem): Promise<OpsComplianceItem> {
  const now = Date.now();
  if (usingPostgres) {
    const rows = await db.insert(opsComplianceCalendar).values({ ...data, createdAt: now }).returning();
    return rows[0] as OpsComplianceItem;
  }
  return db.insert(opsComplianceCalendar).values({ ...data, createdAt: now }).returning().get();
}

export async function completeComplianceItem(id: number, facilityNumber: string, completedDate: number): Promise<boolean> {
  const cond = and(eq(opsComplianceCalendar.id, id), eq(opsComplianceCalendar.facilityNumber, facilityNumber));
  if (usingPostgres) {
    const rows = await db.update(opsComplianceCalendar).set({ status: "completed", completedDate }).where(cond).returning({ id: opsComplianceCalendar.id });
    return rows.length > 0;
  }
  const result = db.update(opsComplianceCalendar).set({ status: "completed", completedDate }).where(cond).run();
  return result.changes > 0;
}

export async function getOverdueCompliance(facilityNumber: string): Promise<OpsComplianceItem[]> {
  const now = Date.now();
  const cond = and(eq(opsComplianceCalendar.facilityNumber, facilityNumber), eq(opsComplianceCalendar.status, "pending"), lte(opsComplianceCalendar.dueDate, now));
  if (usingPostgres) return db.select().from(opsComplianceCalendar).where(cond).orderBy(opsComplianceCalendar.dueDate);
  return db.select().from(opsComplianceCalendar).where(cond).orderBy(opsComplianceCalendar.dueDate).all();
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard aggregate
// ─────────────────────────────────────────────────────────────────────────────

export async function getFacilityDashboard(facilityNumber: string): Promise<{
  activeResidents: number;
  pendingMedPasses: number;
  overdueTasks: number;
  openIncidents: number;
  pendingLeads: number;
  overdueInvoices: number;
  overdueCompliance: number;
}> {
  const now = Date.now();
  const todayStart = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); })();
  const todayEnd = todayStart + 86400000;

  if (usingPostgres) {
    const [r1, r2, r3, r4, r5, r6, r7] = await Promise.all([
      pool!.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_residents WHERE facility_number = $1 AND status = 'active'`, [facilityNumber]),
      pool!.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_med_passes WHERE facility_number = $1 AND status = 'pending' AND scheduled_datetime >= $2 AND scheduled_datetime < $3`, [facilityNumber, todayStart, todayEnd]),
      pool!.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_daily_tasks WHERE facility_number = $1 AND status = 'pending' AND task_date < $2`, [facilityNumber, todayStart]),
      pool!.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_incidents WHERE facility_number = $1 AND status = 'open'`, [facilityNumber]),
      pool!.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_leads WHERE facility_number = $1 AND stage NOT IN ('admitted', 'lost')`, [facilityNumber]),
      pool!.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_invoices WHERE facility_number = $1 AND status NOT IN ('paid', 'void') AND balance_due > 0 AND due_date < $2`, [facilityNumber, now]),
      pool!.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_compliance_calendar WHERE facility_number = $1 AND status = 'pending' AND due_date < $2`, [facilityNumber, now]),
    ]);
    return {
      activeResidents:   r1.rows[0]?.c ?? 0,
      pendingMedPasses:  r2.rows[0]?.c ?? 0,
      overdueTasks:      r3.rows[0]?.c ?? 0,
      openIncidents:     r4.rows[0]?.c ?? 0,
      pendingLeads:      r5.rows[0]?.c ?? 0,
      overdueInvoices:   r6.rows[0]?.c ?? 0,
      overdueCompliance: r7.rows[0]?.c ?? 0,
    };
  }

  const q = (sql: string, ...params: unknown[]) =>
    (sqlite!.prepare(sql).get(...params) as { c: number })?.c ?? 0;

  return {
    activeResidents:   q(`SELECT COUNT(*) as c FROM ops_residents WHERE facility_number = ? AND status = 'active'`, facilityNumber),
    pendingMedPasses:  q(`SELECT COUNT(*) as c FROM ops_med_passes WHERE facility_number = ? AND status = 'pending' AND scheduled_datetime >= ? AND scheduled_datetime < ?`, facilityNumber, todayStart, todayEnd),
    overdueTasks:      q(`SELECT COUNT(*) as c FROM ops_daily_tasks WHERE facility_number = ? AND status = 'pending' AND task_date < ?`, facilityNumber, todayStart),
    openIncidents:     q(`SELECT COUNT(*) as c FROM ops_incidents WHERE facility_number = ? AND status = 'open'`, facilityNumber),
    pendingLeads:      q(`SELECT COUNT(*) as c FROM ops_leads WHERE facility_number = ? AND stage NOT IN ('admitted', 'lost')`, facilityNumber),
    overdueInvoices:   q(`SELECT COUNT(*) as c FROM ops_invoices WHERE facility_number = ? AND status NOT IN ('paid', 'void') AND balance_due > 0 AND due_date < ?`, facilityNumber, now),
    overdueCompliance: q(`SELECT COUNT(*) as c FROM ops_compliance_calendar WHERE facility_number = ? AND status = 'pending' AND due_date < ?`, facilityNumber, now),
  };
}
