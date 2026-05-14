import { eq, and, gte, lte, desc, sql, or } from "drizzle-orm";
import { db, pool } from "../db/index";
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
  opsTemperatureFixtures,
  opsTemperatureLogs,
  opsDrillLogs,
  opsVendors,
  opsComplaints,
  opsComplaintInvestigationNotes,
  opsInspections,
  opsInspectionCitations,
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
  type OpsTemperatureFixture,
  type InsertOpsTemperatureFixture,
  type OpsTemperatureLog,
  type InsertOpsTemperatureLog,
  type OpsDrillLog,
  type InsertOpsDrillLog,
  type OpsVendor,
  type InsertOpsVendor,
  type OpsComplaint,
  type InsertOpsComplaint,
  type OpsComplaintInvestigationNote,
  type OpsInspection,
  type InsertOpsInspection,
  type OpsInspectionCitation,
} from "./opsSchema";
import { recordAudit } from "./auditStorage";
import { listEvidence } from "./evidenceStorage";

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap — create all ops_ tables in PostgreSQL on startup
// ─────────────────────────────────────────────────────────────────────────────

// Bootstrap is idempotent (CREATE TABLE IF NOT EXISTS / CREATE INDEX IF
// NOT EXISTS), but concurrent invocations across vitest forks can still
// race on Postgres' internal type creation and produce
// `duplicate key value violates unique constraint "pg_type_typname_nsp_index"`.
// Wrap the DDL in a Postgres session-level advisory lock so only one
// caller at a time runs the bootstrap. Within a single process, also
// cache the promise so repeat callers no-op.
const OPS_BOOTSTRAP_LOCK_KEY = 0x6f70735f626f6f74; // 'ops_boot' (low 64 bits)
let opsBootstrapPromise: Promise<void> | null = null;

export async function bootstrapOpsSchema(): Promise<void> {
  if (!opsBootstrapPromise) {
    opsBootstrapPromise = (async () => {
      const client = await pool.connect();
      try {
        // pg_advisory_lock blocks until the lock is acquired; the
        // pg_advisory_unlock at the bottom releases it. Cross-fork
        // contention serializes here without spamming retries.
        await client.query(`SELECT pg_advisory_lock($1)`, [OPS_BOOTSTRAP_LOCK_KEY]);
        try {
          await client.query(OPS_PG_SCHEMA_SQL);
        } finally {
          await client.query(`SELECT pg_advisory_unlock($1)`, [OPS_BOOTSTRAP_LOCK_KEY]);
        }
        console.log("[ops] PostgreSQL tables bootstrapped");
      } finally {
        client.release();
      }
    })();
  }
  return opsBootstrapPromise;
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

  const [residents, countRows] = await Promise.all([
    db.select().from(opsResidents).where(conditions).limit(limit).offset(offset).orderBy(desc(opsResidents.createdAt)),
    db.select({ count: sql<number>`count(*)::int` }).from(opsResidents).where(conditions),
  ]);
  return { residents, total: countRows[0]?.count ?? 0 };
}

export async function getResident(id: number, facilityNumber: string): Promise<OpsResident | undefined> {
  const cond = and(eq(opsResidents.id, id), eq(opsResidents.facilityNumber, facilityNumber));
  return pgFirst(db.select().from(opsResidents).where(cond));
}

export async function createResident(data: InsertOpsResident): Promise<OpsResident> {
  const now = Date.now();
  const rows = await db.insert(opsResidents).values({ ...data, createdAt: now, updatedAt: now }).returning();
  return rows[0] as OpsResident;
}

export async function updateResident(id: number, facilityNumber: string, data: Partial<InsertOpsResident>): Promise<OpsResident | undefined> {
  const now = Date.now();
  const cond = and(eq(opsResidents.id, id), eq(opsResidents.facilityNumber, facilityNumber));
  const rows = await db.update(opsResidents).set({ ...data, updatedAt: now }).where(cond).returning();
  return rows[0] as OpsResident | undefined;
}

export async function softDeleteResident(id: number, facilityNumber: string): Promise<boolean> {
  const now = Date.now();
  const cond = and(eq(opsResidents.id, id), eq(opsResidents.facilityNumber, facilityNumber));
  const rows = await db.update(opsResidents).set({ status: "discharged", dischargeDate: now, updatedAt: now }).where(cond).returning({ id: opsResidents.id });
  return rows.length > 0;
}

// Assessments

export async function listAssessments(residentId: number, facilityNumber: string): Promise<OpsResidentAssessment[]> {
  const cond = and(eq(opsResidentAssessments.residentId, residentId), eq(opsResidentAssessments.facilityNumber, facilityNumber));
  return db.select().from(opsResidentAssessments).where(cond).orderBy(desc(opsResidentAssessments.assessedAt));
}

export async function createAssessment(data: InsertOpsResidentAssessment): Promise<OpsResidentAssessment> {
  const now = Date.now();
  const rows = await db.insert(opsResidentAssessments).values({ ...data, createdAt: now }).returning();
  return rows[0] as OpsResidentAssessment;
}

export async function updateAssessment(id: number, data: Partial<InsertOpsResidentAssessment>): Promise<OpsResidentAssessment | undefined> {
  const rows = await db.update(opsResidentAssessments).set(data).where(eq(opsResidentAssessments.id, id)).returning();
  return rows[0] as OpsResidentAssessment | undefined;
}

// Care Plans

export async function getActiveCarePlan(residentId: number, facilityNumber: string): Promise<OpsCarePlan | undefined> {
  const cond = and(eq(opsCarePlans.residentId, residentId), eq(opsCarePlans.facilityNumber, facilityNumber));
  const rows = await db.select().from(opsCarePlans).where(cond).orderBy(desc(opsCarePlans.createdAt)).limit(1);
  return rows[0] as OpsCarePlan | undefined;
}

export async function createCarePlan(data: InsertOpsCarePlan): Promise<OpsCarePlan> {
  const now = Date.now();
  const rows = await db.insert(opsCarePlans).values({ ...data, createdAt: now, updatedAt: now }).returning();
  return rows[0] as OpsCarePlan;
}

export async function updateCarePlan(id: number, data: Partial<InsertOpsCarePlan>): Promise<OpsCarePlan | undefined> {
  const now = Date.now();
  const rows = await db.update(opsCarePlans).set({ ...data, updatedAt: now }).where(eq(opsCarePlans.id, id)).returning();
  return rows[0] as OpsCarePlan | undefined;
}

export async function signCarePlan(id: number, signerType: "resident" | "family", signature: string): Promise<boolean> {
  const now = Date.now();
  const updateData = signerType === "resident"
    ? { digitalSignatureResident: signature, signatureDate: now, updatedAt: now }
    : { digitalSignatureFamily: signature, signatureDate: now, updatedAt: now };

  const rows = await db.update(opsCarePlans).set(updateData).where(eq(opsCarePlans.id, id)).returning({ id: opsCarePlans.id });
  return rows.length > 0;
}

// Daily Tasks

export async function getDailyTasks(residentId: number, facilityNumber: string, taskDate: number, shift?: string): Promise<OpsDailyTask[]> {
  const conditions = shift
    ? and(eq(opsDailyTasks.residentId, residentId), eq(opsDailyTasks.facilityNumber, facilityNumber), eq(opsDailyTasks.taskDate, taskDate), eq(opsDailyTasks.shift, shift))
    : and(eq(opsDailyTasks.residentId, residentId), eq(opsDailyTasks.facilityNumber, facilityNumber), eq(opsDailyTasks.taskDate, taskDate));

  return db.select().from(opsDailyTasks).where(conditions);
}

// Facility-wide aggregator for the dashboard "Overdue Tasks" sub-view.
// Mirrors the dashboard count's overdue rule (status='pending' AND
// task_date < todayStart) and joins resident names so the UI can render
// each row without a second round-trip per resident.
export interface OverdueTaskRow {
  id: number;
  residentId: number;
  residentName: string;
  roomNumber: string | null;
  taskName: string;
  taskType: string;
  scheduledTime: string | null;
  shift: string | null;
  assignedTo: string | null;
  status: string;
  taskDate: number;
}

export async function getOverdueTasksForFacility(facilityNumber: string): Promise<OverdueTaskRow[]> {
  const todayStart = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); })();
  const result = await pool.query<{
    id: number;
    resident_id: number;
    first_name: string | null;
    last_name: string | null;
    room_number: string | null;
    task_name: string;
    task_type: string;
    scheduled_time: string | null;
    shift: string | null;
    assigned_to: string | null;
    status: string;
    task_date: number;
  }>(
    `SELECT t.id, t.resident_id, t.task_name, t.task_type, t.scheduled_time,
            t.shift, t.assigned_to, t.status, t.task_date,
            r.first_name, r.last_name, r.room_number
       FROM ops_daily_tasks t
       LEFT JOIN ops_residents r ON t.resident_id = r.id
      WHERE t.facility_number = $1
        AND t.status = 'pending'
        AND t.task_date < $2
      ORDER BY t.task_date ASC, t.scheduled_time ASC NULLS LAST, t.id ASC`,
    [facilityNumber, todayStart],
  );
  return result.rows.map((row) => ({
    id: row.id,
    residentId: row.resident_id,
    residentName: row.first_name
      ? `${row.first_name} ${row.last_name ?? ""}`.trim()
      : "Unknown resident",
    roomNumber: row.room_number,
    taskName: row.task_name,
    taskType: row.task_type,
    scheduledTime: row.scheduled_time,
    shift: row.shift,
    assignedTo: row.assigned_to,
    status: row.status,
    taskDate: row.task_date,
  }));
}

export async function completeTask(id: number, notes: string, completedAt: number): Promise<boolean> {
  const rows = await db.update(opsDailyTasks).set({ status: "completed", completionNotes: notes, completedAt }).where(eq(opsDailyTasks.id, id)).returning({ id: opsDailyTasks.id });
  return rows.length > 0;
}

export async function refuseTask(id: number, reason: string): Promise<boolean> {
  const rows = await db.update(opsDailyTasks).set({ status: "refused", refused: 1, refuseReason: reason }).where(eq(opsDailyTasks.id, id)).returning({ id: opsDailyTasks.id });
  return rows.length > 0;
}

// Direct task creation — independent of a care plan. Lets the manual
// "Add Task" form put one row on the calendar without the user having to
// build a whole care plan. Returns the inserted row.
export async function createManualDailyTask(input: {
  facilityNumber: string;
  residentId: number;
  taskName: string;
  taskType: string;
  taskDate: number;
  scheduledTime?: string;
  shift?: string;
  assignedTo?: string;
}): Promise<OpsDailyTask> {
  const now = Date.now();
  const row: InsertOpsDailyTask = {
    carePlanId: 0,                    // 0 = "manual / no care plan"
    residentId: input.residentId,
    facilityNumber: input.facilityNumber,
    taskName: input.taskName,
    taskType: input.taskType,
    scheduledTime: input.scheduledTime,
    shift: input.shift,
    assignedTo: input.assignedTo,
    status: "pending",
    taskDate: input.taskDate,
    createdAt: now,
  };
  const [inserted] = await db.insert(opsDailyTasks).values(row).returning();
  return inserted;
}

export async function createDailyTasksFromCarePlan(carePlanId: number, residentId: number, facilityNumber: string): Promise<number> {
  const cpRows = await db.select().from(opsCarePlans).where(eq(opsCarePlans.id, carePlanId));
  const carePlan = cpRows[0] as OpsCarePlan | undefined;
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

  await db.insert(opsDailyTasks).values(taskData);
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 2 — Medications / eMAR
// ─────────────────────────────────────────────────────────────────────────────

export async function listMedications(residentId: number, facilityNumber: string, status?: string): Promise<OpsMedication[]> {
  const conditions = status
    ? and(eq(opsMedications.residentId, residentId), eq(opsMedications.facilityNumber, facilityNumber), eq(opsMedications.status, status))
    : and(eq(opsMedications.residentId, residentId), eq(opsMedications.facilityNumber, facilityNumber));

  return db.select().from(opsMedications).where(conditions);
}

export async function getMedication(id: number, facilityNumber: string): Promise<OpsMedication | undefined> {
  const rows = await db
    .select()
    .from(opsMedications)
    .where(and(eq(opsMedications.id, id), eq(opsMedications.facilityNumber, facilityNumber)))
    .limit(1);
  return rows[0];
}

export async function createMedication(data: InsertOpsMedication): Promise<OpsMedication> {
  const now = Date.now();
  const rows = await db.insert(opsMedications).values({ ...data, createdAt: now, updatedAt: now }).returning();
  return rows[0] as OpsMedication;
}

export async function updateMedication(id: number, facilityNumber: string, data: Partial<InsertOpsMedication>): Promise<OpsMedication | undefined> {
  const now = Date.now();
  const cond = and(eq(opsMedications.id, id), eq(opsMedications.facilityNumber, facilityNumber));
  const rows = await db.update(opsMedications).set({ ...data, updatedAt: now }).where(cond).returning();
  return rows[0] as OpsMedication | undefined;
}

export async function discontinueMedication(id: number, facilityNumber: string, reason: string, by: string): Promise<boolean> {
  const now = Date.now();
  const cond = and(eq(opsMedications.id, id), eq(opsMedications.facilityNumber, facilityNumber));
  const updateData = { status: "discontinued", discontinuedReason: reason, discontinuedBy: by, discontinuedAt: now, updatedAt: now };
  const discRows = await db.update(opsMedications).set(updateData).where(cond).returning({ id: opsMedications.id });
  return discRows.length > 0;
}

// Med pass queue

export async function generateDailyMedPassEntries(facilityNumber: string, date: number): Promise<void> {
  const dayStart = date;
  const dayEnd = date + 86400000;

  const medsResult = await pool.query<{
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
      await pool.query(
        `INSERT INTO ops_med_passes (medication_id, resident_id, facility_number, scheduled_datetime, status, created_at)
         VALUES ($1, $2, $3, $4, 'pending', $5)
         ON CONFLICT (medication_id, scheduled_datetime) DO NOTHING`,
        [med.medication_id, med.resident_id, facilityNumber, scheduledDatetime, Date.now()]
      );
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

  const result = await pool.query(
    `SELECT mp.id, mp.medication_id, mp.resident_id, mp.facility_number,
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
     ORDER BY mp.scheduled_datetime ASC`,
    [facilityNumber, dayStart, dayEnd]
  );
  return result.rows as MedPassRawRow[];
}

export async function getResidentMedPassQueue(
  residentId: number,
  facilityNumber: string,
  date: number
): Promise<Array<OpsMedPass & { drug_name: string }>> {
  const dayStart = date;
  const dayEnd = date + 86400000;

  const result = await pool.query(
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

export async function recordMedPass(data: InsertOpsMedPass): Promise<OpsMedPass> {
  const now = Date.now();
  const rows = await db.insert(opsMedPasses).values({ ...data, createdAt: now }).returning();
  return rows[0] as OpsMedPass;
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
  const rows = await db.update(opsMedPasses).set(data).where(eq(opsMedPasses.id, id)).returning({ id: opsMedPasses.id });
  return rows.length > 0;
}

export async function updatePrnFollowup(id: number, effectivenessNotes: string, notedAt: number): Promise<boolean> {
  const updateData = { prnEffectivenessNotes: effectivenessNotes, prnEffectivenessNotedAt: notedAt };
  const rows = await db.update(opsMedPasses).set(updateData).where(eq(opsMedPasses.id, id)).returning({ id: opsMedPasses.id });
  return rows.length > 0;
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
  fromMs: number,
  toMs: number,
): Promise<DaySummary[]> {
  const res = await pool.query<DaySummary>(
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

  const pg = (col: string) => `TO_CHAR(TO_TIMESTAMP(${col}/1000.0),'YYYY-MM-DD')`;
  const [r1, r2, r3, r4, r5, r6] = await Promise.all([
    pool.query<MedRow>(`SELECT ${pg('scheduled_datetime')} AS date,COUNT(*)::int AS total,SUM(CASE WHEN status='given' THEN 1 ELSE 0 END)::int AS given,SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END)::int AS pending,SUM(CASE WHEN status='late' THEN 1 ELSE 0 END)::int AS late,SUM(CASE WHEN status='missed' THEN 1 ELSE 0 END)::int AS missed FROM ops_med_passes WHERE facility_number=$1 AND scheduled_datetime>=$2 AND scheduled_datetime<$3 GROUP BY 1`, [facilityNumber, fromMs, toMs]),
    pool.query<TaskRow>(`SELECT ${pg('task_date')} AS date,COUNT(*)::int AS total,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)::int AS completed,SUM(CASE WHEN status='pending' AND task_date < $4 THEN 1 ELSE 0 END)::int AS overdue FROM ops_daily_tasks WHERE facility_number=$1 AND task_date>=$2 AND task_date<$3 GROUP BY 1`, [facilityNumber, fromMs, toMs, Date.now()]),
    pool.query<IncRow>(`SELECT ${pg('incident_date')} AS date,COUNT(*)::int AS total,SUM(CASE WHEN status='open' THEN 1 ELSE 0 END)::int AS open FROM ops_incidents WHERE facility_number=$1 AND incident_date>=$2 AND incident_date<$3 GROUP BY 1`, [facilityNumber, fromMs, toMs]),
    pool.query<LRow>(`SELECT ${pg('next_follow_up_date')} AS date,COUNT(*)::int AS followups FROM ops_leads WHERE facility_number=$1 AND next_follow_up_date IS NOT NULL AND next_follow_up_date>=$2 AND next_follow_up_date<$3 AND stage NOT IN ('admitted','lost') GROUP BY 1`, [facilityNumber, fromMs, toMs]),
    pool.query<BRow>(`SELECT ${pg('due_date')} AS date,COUNT(*)::int AS due FROM ops_invoices WHERE facility_number=$1 AND due_date>=$2 AND due_date<$3 AND status NOT IN ('paid','void') AND balance_due>0 GROUP BY 1`, [facilityNumber, fromMs, toMs]),
    pool.query<CRow>(`SELECT ${pg('due_date')} AS date,COUNT(*)::int AS due FROM ops_compliance_calendar WHERE facility_number=$1 AND due_date>=$2 AND due_date<$3 AND status='pending' GROUP BY 1`, [facilityNumber, fromMs, toMs]),
  ]);

  const map = new Map<string, DayOpsEvent>();
  const get = (d: string): DayOpsEvent => {
    if (!map.has(d)) map.set(d, { date: d, medsTotal:0, medsGiven:0, medsPending:0, medsLate:0, medsMissed:0, tasksTotal:0, tasksCompleted:0, tasksOverdue:0, incidentsTotal:0, incidentsOpen:0, leadsFollowups:0, billingDue:0, complianceDue:0 });
    return map.get(d)!;
  };
  for (const r of r1.rows) { const e = get(r.date); e.medsTotal=r.total; e.medsGiven=r.given; e.medsPending=r.pending; e.medsLate=r.late; e.medsMissed=r.missed; }
  for (const r of r2.rows) { const e = get(r.date); e.tasksTotal=r.total; e.tasksCompleted=r.completed; e.tasksOverdue=r.overdue; }
  for (const r of r3.rows) { const e = get(r.date); e.incidentsTotal=r.total; e.incidentsOpen=r.open; }
  for (const r of r4.rows) { get(r.date).leadsFollowups = r.followups; }
  for (const r of r5.rows) { get(r.date).billingDue = r.due; }
  for (const r of r6.rows) { get(r.date).complianceDue = r.due; }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// Controlled substances

export async function recordControlledSubCount(data: InsertOpsControlledSubCount): Promise<OpsControlledSubCount> {
  const now = Date.now();
  const rows = await db.insert(opsControlledSubCounts).values({ ...data, createdAt: now }).returning();
  return rows[0] as OpsControlledSubCount;
}

export async function recordMedDestruction(data: InsertOpsMedDestruction): Promise<OpsMedDestruction> {
  const now = Date.now();
  const rows = await db.insert(opsMedDestruction).values({ ...data, createdAt: now }).returning();
  return rows[0] as OpsMedDestruction;
}

// Reports

export async function getMedPassDashboard(
  facilityNumber: string,
  date: number
): Promise<{ overdue: number; late: number; missed: number; given: number; pending: number }> {
  const dayStart = date;
  const dayEnd = date + 86400000;
  const now = Date.now();

  const result = await pool.query<{ status: string; cnt: string; overdue_cnt: string }>(
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

export async function getMedRefusals(facilityNumber: string, startDate: number, endDate: number): Promise<OpsMedPass[]> {
  const cond = and(eq(opsMedPasses.facilityNumber, facilityNumber), eq(opsMedPasses.status, "refused"), gte(opsMedPasses.scheduledDatetime, startDate), lte(opsMedPasses.scheduledDatetime, endDate));
  return db.select().from(opsMedPasses).where(cond);
}

export async function getPrnReport(
  facilityNumber: string,
  startDate: number,
  endDate: number
): Promise<Array<OpsMedPass & { drug_name: string; resident_name: string }>> {
  const result = await pool.query(
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

// ─────────────────────────────────────────────────────────────────────────────
// Module 3 — Incidents
// ─────────────────────────────────────────────────────────────────────────────

export async function listIncidents(
  facilityNumber: string,
  opts: { page: number; limit: number; type?: string; residentId?: number }
): Promise<{ incidents: OpsIncident[]; total: number }> {
  const { page, limit, type, residentId } = opts;
  const offset = (page - 1) * limit;

  // Use Drizzle so the returned rows come back in camelCase
  // (incidentDate, incidentType, supervisorNotified, …) — matching the
  // frontend interface. The earlier raw pool.query returned snake_case
  // fields, which silently turned every incidentDate into undefined and
  // crashed downstream `relativeTime(inc.incidentDate)` calls with
  // "Invalid time value".
  const conds = [eq(opsIncidents.facilityNumber, facilityNumber)];
  if (type) conds.push(eq(opsIncidents.incidentType, type));
  if (residentId !== undefined) conds.push(eq(opsIncidents.residentId, residentId));
  const where = conds.length === 1 ? conds[0] : and(...conds);

  const [rows, countRows] = await Promise.all([
    db.select().from(opsIncidents).where(where!).orderBy(desc(opsIncidents.incidentDate)).limit(limit).offset(offset),
    db.select({ count: sql<number>`COUNT(*)::int` }).from(opsIncidents).where(where!),
  ]);
  return { incidents: rows as OpsIncident[], total: countRows[0]?.count ?? 0 };
}

export async function createIncident(data: InsertOpsIncident): Promise<OpsIncident> {
  const now = Date.now();
  const rows = await db.insert(opsIncidents).values({ ...data, createdAt: now, updatedAt: now }).returning();
  return rows[0] as OpsIncident;
}

export async function updateIncident(id: number, facilityNumber: string, data: Partial<InsertOpsIncident>): Promise<OpsIncident | undefined> {
  const now = Date.now();
  const cond = and(eq(opsIncidents.id, id), eq(opsIncidents.facilityNumber, facilityNumber));
  const rows = await db.update(opsIncidents).set({ ...data, updatedAt: now }).where(cond).returning();
  return rows[0] as OpsIncident | undefined;
}

export async function getIncidentTrends(
  facilityNumber: string,
  days: number
): Promise<Array<{ incident_type: string; count: number; date: string }>> {
  const since = Date.now() - days * 86400000;

  const result = await pool.query<{ incident_type: string; count: string; date: string }>(
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

  const [leads, countRows] = await Promise.all([
    db.select().from(opsLeads).where(conditions).limit(limit).offset(offset).orderBy(desc(opsLeads.createdAt)),
    db.select({ count: sql<number>`count(*)::int` }).from(opsLeads).where(conditions),
  ]);
  return { leads, total: countRows[0]?.count ?? 0 };
}

export async function getLead(id: number, facilityNumber: string): Promise<OpsLead | undefined> {
  const cond = and(eq(opsLeads.id, id), eq(opsLeads.facilityNumber, facilityNumber));
  return pgFirst(db.select().from(opsLeads).where(cond));
}

export async function createLead(data: InsertOpsLead): Promise<OpsLead> {
  const now = Date.now();
  const rows = await db.insert(opsLeads).values({ ...data, createdAt: now, updatedAt: now }).returning();
  return rows[0] as OpsLead;
}

export async function updateLead(id: number, facilityNumber: string, data: Partial<InsertOpsLead>): Promise<OpsLead | undefined> {
  const now = Date.now();
  const cond = and(eq(opsLeads.id, id), eq(opsLeads.facilityNumber, facilityNumber));
  const rows = await db.update(opsLeads).set({ ...data, updatedAt: now }).where(cond).returning();
  return rows[0] as OpsLead | undefined;
}

export async function scheduleTour(data: InsertOpsTour): Promise<OpsTour> {
  const now = Date.now();
  const rows = await db.insert(opsTours).values({ ...data, createdAt: now }).returning();
  return rows[0] as OpsTour;
}

export async function updateTour(id: number, data: Partial<InsertOpsTour>): Promise<OpsTour | undefined> {
  const rows = await db.update(opsTours).set(data).where(eq(opsTours.id, id)).returning();
  return rows[0] as OpsTour | undefined;
}

export async function startAdmission(data: InsertOpsAdmission): Promise<OpsAdmission> {
  const now = Date.now();
  const rows = await db.insert(opsAdmissions).values({ ...data, createdAt: now, updatedAt: now }).returning();
  return rows[0] as OpsAdmission;
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
  const result = await pool.query(
    `UPDATE ops_admissions SET ${mapping.completedCol} = $1, ${mapping.dateCol} = $2, updated_at = $3 WHERE id = $4`,
    [completed ? 1 : 0, completed ? now : null, now, admissionId]
  );
  return (result.rowCount ?? 0) > 0;
}

export async function convertAdmissionToResident(admissionId: number): Promise<OpsResident | undefined> {
  const admRows = await db.select().from(opsAdmissions).where(eq(opsAdmissions.id, admissionId));
  const admission = admRows[0] as OpsAdmission | undefined;
  if (!admission) return undefined;

  const leadRows = await db.select().from(opsLeads).where(eq(opsLeads.id, admission.leadId));
  const lead = leadRows[0] as OpsLead | undefined;
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

  const resRows = await db.insert(opsResidents).values(residentData).returning();
  const resident = resRows[0] as OpsResident;
  await db.update(opsAdmissions).set({ residentId: resident.id, updatedAt: now }).where(eq(opsAdmissions.id, admissionId));

  return resident;
}

export async function getOccupancy(facilityNumber: string): Promise<{
  total: number; active: number; beds_available: number; occupancy_rate: number;
}> {
  const [settingResult, activeResult] = await Promise.all([
    pool.query<{ setting_value: string }>(
      `SELECT setting_value FROM ops_facility_settings WHERE facility_number = $1 AND setting_key = 'bed_capacity'`,
      [facilityNumber]
    ),
    pool.query<{ count: string }>(
      `SELECT COUNT(*)::int as count FROM ops_residents WHERE facility_number = $1 AND status = 'active'`,
      [facilityNumber]
    ),
  ]);
  const total = settingResult.rows[0] ? parseInt(settingResult.rows[0].setting_value, 10) : 6;
  const active = Number(activeResult.rows[0]?.count ?? 0);
  return { total, active, beds_available: Math.max(0, total - active), occupancy_rate: total > 0 ? Math.round((active / total) * 100) : 0 };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 5 — Billing
// ─────────────────────────────────────────────────────────────────────────────

export async function listCharges(facilityNumber: string, residentId: number): Promise<OpsBillingCharge[]> {
  const cond = and(eq(opsBillingCharges.facilityNumber, facilityNumber), eq(opsBillingCharges.residentId, residentId));
  return db.select().from(opsBillingCharges).where(cond).orderBy(desc(opsBillingCharges.createdAt));
}

export async function createCharge(data: InsertOpsBillingCharge): Promise<OpsBillingCharge> {
  const now = Date.now();
  const rows = await db.insert(opsBillingCharges).values({ ...data, createdAt: now }).returning();
  return rows[0] as OpsBillingCharge;
}

export async function deleteCharge(id: number, facilityNumber: string): Promise<boolean> {
  const cond = and(eq(opsBillingCharges.id, id), eq(opsBillingCharges.facilityNumber, facilityNumber));
  const rows = await db.delete(opsBillingCharges).where(cond).returning({ id: opsBillingCharges.id });
  return rows.length > 0;
}

export async function generateInvoice(facilityNumber: string, residentId: number, periodStart: number, periodEnd: number): Promise<OpsInvoice> {
  const chargesResult = await pool.query<{ subtotal: string }>(
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
  const subtotal = parseFloat(chargesResult.rows[0]?.subtotal ?? "0");

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

  const rows = await db.insert(opsInvoices).values(invoiceData).returning();
  return rows[0] as OpsInvoice;
}

export async function getInvoice(id: number): Promise<OpsInvoice | undefined> {
  return pgFirst(db.select().from(opsInvoices).where(eq(opsInvoices.id, id)));
}

export async function markInvoiceSent(id: number): Promise<boolean> {
  const now = Date.now();
  const rows = await db.update(opsInvoices).set({ status: "sent", sentAt: now, updatedAt: now }).where(eq(opsInvoices.id, id)).returning({ id: opsInvoices.id });
  return rows.length > 0;
}

export async function recordPayment(data: InsertOpsPayment): Promise<OpsPayment> {
  const now = Date.now();
  const payRows = await db.insert(opsPayments).values({ ...data, createdAt: now }).returning();
  const payment = payRows[0] as OpsPayment;

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

  return payment;
}

export async function getArAging(facilityNumber: string): Promise<{
  current: number; days_30: number; days_60: number; days_90: number; over_90: number;
}> {
  const now = Date.now();
  const d30 = now - 30 * 86400000;
  const d60 = now - 60 * 86400000;
  const d90 = now - 90 * 86400000;

  const result = await pool.query<{
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

export async function getBillingSummary(
  facilityNumber: string,
  periodStart: number,
  periodEnd: number
): Promise<{ total_billed: number; total_paid: number; total_outstanding: number }> {
  const result = await pool.query<{ total_billed: string; total_paid: string; total_outstanding: string }>(
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

// ─────────────────────────────────────────────────────────────────────────────
// Module 6 — Staff / Scheduling / Compliance
// ─────────────────────────────────────────────────────────────────────────────

export async function listStaff(facilityNumber: string, status?: string): Promise<OpsStaffMember[]> {
  const conditions = status
    ? and(eq(opsStaff.facilityNumber, facilityNumber), eq(opsStaff.status, status))
    : eq(opsStaff.facilityNumber, facilityNumber);
  return db.select().from(opsStaff).where(conditions).orderBy(desc(opsStaff.createdAt));
}

export async function createStaff(data: InsertOpsStaffMember): Promise<OpsStaffMember> {
  const now = Date.now();
  const rows = await db.insert(opsStaff).values({ ...data, createdAt: now, updatedAt: now }).returning();
  return rows[0] as OpsStaffMember;
}

export async function updateStaff(id: number, facilityNumber: string, data: Partial<InsertOpsStaffMember>): Promise<OpsStaffMember | undefined> {
  const now = Date.now();
  const cond = and(eq(opsStaff.id, id), eq(opsStaff.facilityNumber, facilityNumber));
  const rows = await db.update(opsStaff).set({ ...data, updatedAt: now }).where(cond).returning();
  return rows[0] as OpsStaffMember | undefined;
}

export async function deactivateStaff(id: number, facilityNumber: string): Promise<boolean> {
  const now = Date.now();
  const cond = and(eq(opsStaff.id, id), eq(opsStaff.facilityNumber, facilityNumber));
  const rows = await db.update(opsStaff).set({ status: "inactive", terminationDate: now, updatedAt: now }).where(cond).returning({ id: opsStaff.id });
  return rows.length > 0;
}

export async function listShifts(facilityNumber: string, weekStart: number): Promise<OpsShift[]> {
  const weekEnd = weekStart + 7 * 86400000;
  const cond = and(eq(opsShifts.facilityNumber, facilityNumber), gte(opsShifts.shiftDate, weekStart), lte(opsShifts.shiftDate, weekEnd));
  return db.select().from(opsShifts).where(cond).orderBy(opsShifts.shiftDate);
}

export async function createShift(data: InsertOpsShift): Promise<OpsShift> {
  const now = Date.now();
  const rows = await db.insert(opsShifts).values({ ...data, createdAt: now }).returning();
  return rows[0] as OpsShift;
}

export async function updateShift(id: number, data: Partial<InsertOpsShift>): Promise<OpsShift | undefined> {
  const rows = await db.update(opsShifts).set(data).where(eq(opsShifts.id, id)).returning();
  return rows[0] as OpsShift | undefined;
}

export async function listComplianceItems(facilityNumber: string, status?: string): Promise<OpsComplianceItem[]> {
  const conditions = status
    ? and(eq(opsComplianceCalendar.facilityNumber, facilityNumber), eq(opsComplianceCalendar.status, status))
    : eq(opsComplianceCalendar.facilityNumber, facilityNumber);
  return db.select().from(opsComplianceCalendar).where(conditions).orderBy(opsComplianceCalendar.dueDate);
}

export async function createComplianceItem(data: InsertOpsComplianceItem): Promise<OpsComplianceItem> {
  const now = Date.now();
  const rows = await db.insert(opsComplianceCalendar).values({ ...data, createdAt: now }).returning();
  return rows[0] as OpsComplianceItem;
}

export async function completeComplianceItem(id: number, facilityNumber: string, completedDate: number): Promise<boolean> {
  const cond = and(eq(opsComplianceCalendar.id, id), eq(opsComplianceCalendar.facilityNumber, facilityNumber));
  const rows = await db.update(opsComplianceCalendar).set({ status: "completed", completedDate }).where(cond).returning({ id: opsComplianceCalendar.id });
  return rows.length > 0;
}

export async function getOverdueCompliance(facilityNumber: string): Promise<OpsComplianceItem[]> {
  const now = Date.now();
  const cond = and(eq(opsComplianceCalendar.facilityNumber, facilityNumber), eq(opsComplianceCalendar.status, "pending"), lte(opsComplianceCalendar.dueDate, now));
  return db.select().from(opsComplianceCalendar).where(cond).orderBy(opsComplianceCalendar.dueDate);
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

  const [r1, r2, r3, r4, r5, r6, r7] = await Promise.all([
    pool.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_residents WHERE facility_number = $1 AND status = 'active'`, [facilityNumber]),
    pool.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_med_passes WHERE facility_number = $1 AND status = 'pending' AND scheduled_datetime >= $2 AND scheduled_datetime < $3`, [facilityNumber, todayStart, todayEnd]),
    pool.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_daily_tasks WHERE facility_number = $1 AND status = 'pending' AND task_date < $2`, [facilityNumber, todayStart]),
    pool.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_incidents WHERE facility_number = $1 AND status = 'open'`, [facilityNumber]),
    pool.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_leads WHERE facility_number = $1 AND stage NOT IN ('admitted', 'lost')`, [facilityNumber]),
    pool.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_invoices WHERE facility_number = $1 AND status NOT IN ('paid', 'void') AND balance_due > 0 AND due_date < $2`, [facilityNumber, now]),
    pool.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_compliance_calendar WHERE facility_number = $1 AND status = 'pending' AND due_date < $2`, [facilityNumber, now]),
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

// ─────────────────────────────────────────────────────────────────────────────
// Unified calendar events
//
// Returns one normalized row per scheduled item across six source modules
// (meds, tasks, incidents, leads, billing, compliance) for the requested
// date window. The Day and Week time grids consume this so that anything
// the user fills in elsewhere in the portal — a new incident, a tour, an
// invoice due date, a compliance item — automatically shows up on the
// calendar without per-source plumbing.
//
// Time-of-day handling:
//   • Meds, tours — already carry an exact timestamp.
//   • Tasks, incidents — date timestamp + free-text "HH:MM" (combined here).
//   • Invoices, compliance — date-only; pinned to 09:00 local and flagged
//     allDay so the UI can render them differently if desired.
// ─────────────────────────────────────────────────────────────────────────────

export type CalendarEventType =
  | "meds"
  | "tasks"
  | "incidents"
  | "leads"
  | "billing"
  | "compliance";

export interface CalendarEventRow {
  id: string;             // namespaced: "meds-123", "tasks-45"
  type: CalendarEventType;
  title: string;
  subtitle: string;
  date: string;           // YYYY-MM-DD (local to the server)
  scheduledAt: number;    // Unix ms — used for hour-grid placement
  scheduledTime: string;  // "HH:MM" 24h
  status: string;
  allDay: boolean;
}

// Note: there is no per-event `href` anymore. The client (OperationsTab) is
// the only consumer and navigates via in-app sub-view state keyed off the
// event `type`, not a URL — `/facility-portal` is the only canonical route.

function isoLocalDate(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function timeOfDay(ts: number): string {
  const d = new Date(ts);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// Combine a date timestamp with an optional "HH:MM" text and return a fresh
// timestamp anchored to that local time. If the text is missing or malformed
// the event is treated as all-day and pinned to 09:00 so it still surfaces
// in the operational hour grid.
function combineDateAndTime(dateMs: number, timeStr: string | null | undefined): { ts: number; allDay: boolean } {
  const m = timeStr ? timeStr.match(/^(\d{1,2}):(\d{2})/) : null;
  const d = new Date(dateMs);
  if (m) {
    d.setHours(parseInt(m[1], 10), parseInt(m[2], 10), 0, 0);
    return { ts: d.getTime(), allDay: false };
  }
  d.setHours(9, 0, 0, 0);
  return { ts: d.getTime(), allDay: true };
}

export async function getFacilityCalendarEvents(
  facilityNumber: string,
  fromMs: number,
  toMs: number,
  types?: ReadonlyArray<CalendarEventType>,
): Promise<CalendarEventRow[]> {
  const want = (t: CalendarEventType) => !types || types.length === 0 || types.includes(t);

  const queries: Array<Promise<CalendarEventRow[]>> = [];

  // ── Meds ─────────────────────────────────────────────────────────────────
  if (want("meds")) {
    queries.push(
      pool.query<{
        id: number; scheduled_datetime: number; status: string;
        drug_name: string; dosage: string;
        first_name: string; last_name: string; room_number: string | null;
      }>(
        `SELECT mp.id, mp.scheduled_datetime, mp.status,
                m.drug_name, m.dosage,
                r.first_name, r.last_name, r.room_number
         FROM ops_med_passes mp
         JOIN ops_medications m ON mp.medication_id = m.id
         JOIN ops_residents   r ON mp.resident_id = r.id
         WHERE mp.facility_number = $1
           AND mp.scheduled_datetime >= $2
           AND mp.scheduled_datetime <  $3
         ORDER BY mp.scheduled_datetime ASC`,
        [facilityNumber, fromMs, toMs],
      ).then((res) => res.rows.map((row): CalendarEventRow => ({
        id: `meds-${row.id}`,
        type: "meds",
        title: `${row.drug_name}${row.dosage ? ` ${row.dosage}` : ""}`.trim(),
        subtitle: `${row.first_name} ${row.last_name}${row.room_number ? ` · Rm ${row.room_number}` : ""}`,
        date: isoLocalDate(row.scheduled_datetime),
        scheduledAt: row.scheduled_datetime,
        scheduledTime: timeOfDay(row.scheduled_datetime),
        status: row.status,
        allDay: false,
      }))),
    );
  }

  // ── Tasks ────────────────────────────────────────────────────────────────
  if (want("tasks")) {
    queries.push(
      pool.query<{
        id: number; task_date: number; scheduled_time: string | null;
        task_name: string; status: string;
        first_name: string | null; last_name: string | null; room_number: string | null;
      }>(
        `SELECT t.id, t.task_date, t.scheduled_time, t.task_name, t.status,
                r.first_name, r.last_name, r.room_number
         FROM ops_daily_tasks t
         LEFT JOIN ops_residents r ON t.resident_id = r.id
         WHERE t.facility_number = $1
           AND t.task_date >= $2
           AND t.task_date <  $3
         ORDER BY t.task_date ASC`,
        [facilityNumber, fromMs, toMs],
      ).then((res) => res.rows.map((row): CalendarEventRow => {
        const { ts, allDay } = combineDateAndTime(row.task_date, row.scheduled_time);
        const resident = row.first_name ? `${row.first_name} ${row.last_name ?? ""}`.trim() : "Facility-wide";
        return {
          id: `tasks-${row.id}`,
          type: "tasks",
          title: row.task_name,
          subtitle: `${resident}${row.room_number ? ` · Rm ${row.room_number}` : ""}`,
          date: isoLocalDate(ts),
          scheduledAt: ts,
          scheduledTime: timeOfDay(ts),
          status: row.status,
          allDay,
        };
      })),
    );
  }

  // ── Incidents ────────────────────────────────────────────────────────────
  if (want("incidents")) {
    queries.push(
      pool.query<{
        id: number; incident_date: number; incident_time: string | null;
        incident_type: string; status: string;
        first_name: string | null; last_name: string | null;
      }>(
        `SELECT i.id, i.incident_date, i.incident_time, i.incident_type, i.status,
                r.first_name, r.last_name
         FROM ops_incidents i
         LEFT JOIN ops_residents r ON i.resident_id = r.id
         WHERE i.facility_number = $1
           AND i.incident_date >= $2
           AND i.incident_date <  $3
         ORDER BY i.incident_date ASC`,
        [facilityNumber, fromMs, toMs],
      ).then((res) => res.rows.map((row): CalendarEventRow => {
        const { ts, allDay } = combineDateAndTime(row.incident_date, row.incident_time);
        const resident = row.first_name ? `${row.first_name} ${row.last_name ?? ""}`.trim() : "Facility-wide";
        return {
          id: `incidents-${row.id}`,
          type: "incidents",
          title: row.incident_type.replace(/_/g, " "),
          subtitle: resident,
          date: isoLocalDate(ts),
          scheduledAt: ts,
          scheduledTime: timeOfDay(ts),
          status: row.status,
          allDay,
        };
      })),
    );
  }

  // ── Leads (tours) ────────────────────────────────────────────────────────
  if (want("leads")) {
    queries.push(
      pool.query<{
        id: number; scheduled_at: number; outcome: string | null; completed_at: number | null;
        prospect_name: string; contact_name: string;
      }>(
        `SELECT t.id, t.scheduled_at, t.outcome, t.completed_at,
                l.prospect_name, l.contact_name
         FROM ops_tours t
         JOIN ops_leads l ON t.lead_id = l.id
         WHERE t.facility_number = $1
           AND t.scheduled_at >= $2
           AND t.scheduled_at <  $3
         ORDER BY t.scheduled_at ASC`,
        [facilityNumber, fromMs, toMs],
      ).then((res) => res.rows.map((row): CalendarEventRow => ({
        id: `leads-${row.id}`,
        type: "leads",
        title: `Tour · ${row.prospect_name}`,
        subtitle: `Contact: ${row.contact_name}`,
        date: isoLocalDate(row.scheduled_at),
        scheduledAt: row.scheduled_at,
        scheduledTime: timeOfDay(row.scheduled_at),
        status: row.completed_at ? (row.outcome ?? "completed") : "scheduled",
        allDay: false,
      }))),
    );
  }

  // ── Billing (invoice due dates) ──────────────────────────────────────────
  if (want("billing")) {
    queries.push(
      pool.query<{
        id: number; due_date: number; invoice_number: string;
        total: number; balance_due: number; status: string;
        first_name: string | null; last_name: string | null;
      }>(
        `SELECT i.id, i.due_date, i.invoice_number, i.total, i.balance_due, i.status,
                r.first_name, r.last_name
         FROM ops_invoices i
         LEFT JOIN ops_residents r ON i.resident_id = r.id
         WHERE i.facility_number = $1
           AND i.due_date IS NOT NULL
           AND i.due_date >= $2
           AND i.due_date <  $3
         ORDER BY i.due_date ASC`,
        [facilityNumber, fromMs, toMs],
      ).then((res) => res.rows.map((row): CalendarEventRow => {
        const { ts, allDay } = combineDateAndTime(row.due_date, null);
        const resident = row.first_name ? `${row.first_name} ${row.last_name ?? ""}`.trim() : "Resident";
        const amount = (row.balance_due ?? row.total).toFixed(2);
        return {
          id: `billing-${row.id}`,
          type: "billing",
          title: `Invoice ${row.invoice_number} due · $${amount}`,
          subtitle: resident,
          date: isoLocalDate(ts),
          scheduledAt: ts,
          scheduledTime: timeOfDay(ts),
          status: row.status,
          allDay,
        };
      })),
    );
  }

  // ── Compliance ───────────────────────────────────────────────────────────
  if (want("compliance")) {
    queries.push(
      pool.query<{
        id: number; due_date: number; item_type: string; description: string;
        status: string; assigned_to: string | null;
      }>(
        `SELECT c.id, c.due_date, c.item_type, c.description, c.status, c.assigned_to
         FROM ops_compliance_calendar c
         WHERE c.facility_number = $1
           AND c.due_date >= $2
           AND c.due_date <  $3
         ORDER BY c.due_date ASC`,
        [facilityNumber, fromMs, toMs],
      ).then((res) => res.rows.map((row): CalendarEventRow => {
        const { ts, allDay } = combineDateAndTime(row.due_date, null);
        return {
          id: `compliance-${row.id}`,
          type: "compliance",
          title: row.description || row.item_type.replace(/_/g, " "),
          subtitle: row.assigned_to ? `Assigned: ${row.assigned_to}` : "Unassigned",
          date: isoLocalDate(ts),
          scheduledAt: ts,
          scheduledTime: timeOfDay(ts),
          status: row.status,
          allDay,
        };
      })),
    );
  }

  // Run all source queries in parallel; merge and sort by absolute time.
  const results = await Promise.all(queries);
  const merged = results.flat();
  merged.sort((a, b) => a.scheduledAt - b.scheduledAt);
  return merged;
}

// ─────────────────────────────────────────────────────────────────────────────
// Demo seed
//
// Populates a facility with a small, realistic set of residents +
// medications + med-pass entries for today, with a deterministic mix of
// statuses (given / late / missed / refused / held / pending) so the
// calendar's color states are all visible.
//
// Idempotent at the resident layer: skips entirely if the facility already
// has any resident on file, so it can never overwrite real data.
// ─────────────────────────────────────────────────────────────────────────────

interface DemoResidentSpec {
  firstName: string;
  lastName: string;
  roomNumber: string;
  meds: Array<{
    drugName: string;
    dosage: string;
    route: string;
    frequency: string;
    scheduledTimes: string; // comma-separated HH:MM (24h)
    prescriberName?: string;
  }>;
}

const DEMO_RESIDENTS: DemoResidentSpec[] = [
  {
    firstName: "Margaret", lastName: "Chen", roomNumber: "101",
    meds: [
      { drugName: "Lisinopril",   dosage: "10 mg",   route: "PO", frequency: "Daily",  scheduledTimes: "08:00",          prescriberName: "Dr. Patel" },
      { drugName: "Atorvastatin", dosage: "20 mg",   route: "PO", frequency: "Daily",  scheduledTimes: "20:00",          prescriberName: "Dr. Patel" },
    ],
  },
  {
    firstName: "Robert",   lastName: "Hayes", roomNumber: "102",
    meds: [
      { drugName: "Metformin",    dosage: "500 mg",  route: "PO", frequency: "BID",    scheduledTimes: "08:00,18:00",    prescriberName: "Dr. Singh" },
      { drugName: "Aspirin",      dosage: "81 mg",   route: "PO", frequency: "Daily",  scheduledTimes: "08:00",          prescriberName: "Dr. Singh" },
    ],
  },
  {
    firstName: "Eleanor",  lastName: "Diaz",  roomNumber: "103",
    meds: [
      { drugName: "Sertraline",   dosage: "50 mg",   route: "PO", frequency: "Daily",  scheduledTimes: "09:00",          prescriberName: "Dr. Lee" },
      { drugName: "Vitamin D3",   dosage: "1000 IU", route: "PO", frequency: "Daily",  scheduledTimes: "08:00",          prescriberName: "Dr. Lee" },
      { drugName: "Tramadol",     dosage: "50 mg",   route: "PO", frequency: "TID",    scheduledTimes: "08:00,14:00,20:00", prescriberName: "Dr. Lee" },
    ],
  },
  {
    firstName: "James",    lastName: "Walker", roomNumber: "104",
    meds: [
      { drugName: "Donepezil",    dosage: "10 mg",   route: "PO", frequency: "Daily",  scheduledTimes: "21:00",          prescriberName: "Dr. Patel" },
      { drugName: "Furosemide",   dosage: "40 mg",   route: "PO", frequency: "Daily",  scheduledTimes: "09:00",          prescriberName: "Dr. Patel" },
    ],
  },
  {
    firstName: "Helen",    lastName: "Brooks", roomNumber: "105",
    meds: [
      { drugName: "Levothyroxine", dosage: "50 mcg", route: "PO", frequency: "Daily",  scheduledTimes: "07:00",          prescriberName: "Dr. Singh" },
      { drugName: "Omeprazole",    dosage: "20 mg",  route: "PO", frequency: "Daily",  scheduledTimes: "07:30",          prescriberName: "Dr. Singh" },
    ],
  },
];

// Status assignment for already-passed scheduled times. The order is
// deterministic so reseeding a fresh facility produces the same color mix.
// Picked to ensure all six status colors appear on a typical day.
const PAST_STATUSES: Array<"given" | "late" | "missed" | "refused" | "held" | "pending"> = [
  "given", "given", "given", "given",
  "late",
  "given", "given", "given",
  "missed",
  "given", "given",
  "refused",
  "given",
  "held",
  "given", "given", "pending",
];

export interface DemoSeedResult {
  skipped: boolean;
  reason?: string;
  residentsCreated: number;
  medicationsCreated: number;
  medPassesGenerated: number;
  medPassesUpdated: number;
}

export async function seedFacilityDemoData(facilityNumber: string): Promise<DemoSeedResult> {
  // Skip if any resident already exists for this facility — never clobber
  // real data.
  const existing = await pool.query<{ c: string }>(
    `SELECT COUNT(*)::text AS c FROM ops_residents WHERE facility_number = $1`,
    [facilityNumber],
  );
  if ((Number(existing.rows[0]?.c ?? 0)) > 0) {
    return {
      skipped: true,
      reason: "Facility already has resident data",
      residentsCreated: 0,
      medicationsCreated: 0,
      medPassesGenerated: 0,
      medPassesUpdated: 0,
    };
  }

  const now = Date.now();
  let residentsCreated = 0;
  let medicationsCreated = 0;

  for (const r of DEMO_RESIDENTS) {
    const ins = await pool.query<{ id: number }>(
      `INSERT INTO ops_residents (facility_number, first_name, last_name, room_number, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, 'active', $5, $5)
       RETURNING id`,
      [facilityNumber, r.firstName, r.lastName, r.roomNumber, now],
    );
    const residentId = ins.rows[0].id;
    residentsCreated += 1;

    for (const m of r.meds) {
      await pool.query(
        `INSERT INTO ops_medications (
           resident_id, facility_number, drug_name, dosage, route, frequency,
           scheduled_times, prescriber_name, status, created_at, updated_at
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9, $9)`,
        [
          residentId, facilityNumber, m.drugName, m.dosage, m.route, m.frequency,
          m.scheduledTimes, m.prescriberName ?? null, now,
        ],
      );
      medicationsCreated += 1;
    }
  }

  // Generate today's pending med-pass rows from the seeded medications.
  const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
  await generateDailyMedPassEntries(facilityNumber, dayStart.getTime());

  // Pull what we just generated, sort by scheduled time, then mark
  // already-past entries with a deterministic status mix.
  const generated = await pool.query<{ id: number; scheduled_datetime: number }>(
    `SELECT id, scheduled_datetime
     FROM ops_med_passes
     WHERE facility_number = $1
       AND scheduled_datetime >= $2
       AND scheduled_datetime <  $3
     ORDER BY scheduled_datetime ASC, id ASC`,
    [facilityNumber, dayStart.getTime(), dayStart.getTime() + 86400000],
  );

  let updated = 0;
  let pastIdx = 0;
  for (const row of generated.rows) {
    if (row.scheduled_datetime > now) continue; // future row → leave as pending
    const status = PAST_STATUSES[pastIdx % PAST_STATUSES.length];
    pastIdx += 1;
    if (status === "pending") continue; // already pending by default

    const administered = status === "given" ? row.scheduled_datetime + 5 * 60_000 : null;
    await pool.query(
      `UPDATE ops_med_passes
       SET status = $1, administered_datetime = $2, administered_by = $3
       WHERE id = $4`,
      [
        status,
        administered,
        status === "given" || status === "late" ? "Demo Caregiver" : null,
        row.id,
      ],
    );
    updated += 1;
  }

  return {
    skipped: false,
    residentsCreated,
    medicationsCreated,
    medPassesGenerated: generated.rows.length,
    medPassesUpdated: updated,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 7 — Audit Readiness (Wave 1, Epic B)
//
// Pattern reused from Modules 1–6: module-level async functions, shared `db`
// + `pool` from server/db/index, Drizzle for typed CRUD, raw SQL only where a
// JOIN buys us a single round-trip (controlled-sub list).
//
// Every mutation calls `recordAudit({...})` wrapped in try/catch so an audit
// emit failure does not roll back the user-visible mutation. The entity_type
// tag must match the resource string in `permissions.ts` so a Wave-2 audit
// viewer can filter by resource directly.
// ─────────────────────────────────────────────────────────────────────────────

interface AuditActor {
  id: string;
  role: string;
}

async function safeAudit(args: {
  facilityNumber: string;
  actor: AuditActor;
  action: "create" | "update" | "delete" | "resolve" | "close" | "reopen";
  entityType: string;
  entityId: number;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  try {
    await recordAudit({
      facilityNumber: args.facilityNumber,
      actorId: args.actor.id,
      actorRole: args.actor.role,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      before: args.before,
      after: args.after,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[ops] audit emit failed for ${args.entityType}#${args.entityId}`, err);
  }
}

// JSON column helpers — write side stringifies, read side parses with a
// try/catch fallback to [] so a malformed legacy row never crashes a list
// response.
function jsonArrayToText(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return JSON.stringify(Array.isArray(v) ? v : []);
}

function parseJsonArray<T = unknown>(text: string | null | undefined): T[] {
  if (!text) return [];
  try {
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

// ── W7 Temperature fixtures ──────────────────────────────────────────────────

export async function listTemperatureFixtures(
  facilityNumber: string,
  opts: { includeInactive?: boolean } = {},
): Promise<OpsTemperatureFixture[]> {
  const cond = opts.includeInactive
    ? eq(opsTemperatureFixtures.facilityNumber, facilityNumber)
    : and(
        eq(opsTemperatureFixtures.facilityNumber, facilityNumber),
        eq(opsTemperatureFixtures.status, "active"),
      );
  return db
    .select()
    .from(opsTemperatureFixtures)
    .where(cond)
    .orderBy(desc(opsTemperatureFixtures.createdAt));
}

export async function getTemperatureFixture(
  id: number,
  facilityNumber: string,
): Promise<OpsTemperatureFixture | undefined> {
  return pgFirst(
    db
      .select()
      .from(opsTemperatureFixtures)
      .where(
        and(
          eq(opsTemperatureFixtures.id, id),
          eq(opsTemperatureFixtures.facilityNumber, facilityNumber),
        ),
      ),
  );
}

export async function createTemperatureFixture(
  data: InsertOpsTemperatureFixture,
  actor: AuditActor,
): Promise<OpsTemperatureFixture> {
  const now = Date.now();
  const rows = await db
    .insert(opsTemperatureFixtures)
    .values({ ...data, createdAt: now, updatedAt: now })
    .returning();
  const row = rows[0] as OpsTemperatureFixture;
  await safeAudit({
    facilityNumber: row.facilityNumber,
    actor,
    action: "create",
    entityType: "ops_temperature_fixture",
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateTemperatureFixture(
  id: number,
  facilityNumber: string,
  data: Partial<InsertOpsTemperatureFixture>,
  actor: AuditActor,
): Promise<OpsTemperatureFixture | undefined> {
  const before = await getTemperatureFixture(id, facilityNumber);
  if (!before) return undefined;
  const now = Date.now();
  const rows = await db
    .update(opsTemperatureFixtures)
    .set({ ...data, updatedAt: now })
    .where(
      and(
        eq(opsTemperatureFixtures.id, id),
        eq(opsTemperatureFixtures.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const after = rows[0] as OpsTemperatureFixture | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "update",
      entityType: "ops_temperature_fixture",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

export async function softInactivateTemperatureFixture(
  id: number,
  facilityNumber: string,
  actor: AuditActor,
): Promise<boolean> {
  const before = await getTemperatureFixture(id, facilityNumber);
  if (!before) return false;
  const now = Date.now();
  const rows = await db
    .update(opsTemperatureFixtures)
    .set({ status: "inactive", updatedAt: now })
    .where(
      and(
        eq(opsTemperatureFixtures.id, id),
        eq(opsTemperatureFixtures.facilityNumber, facilityNumber),
      ),
    )
    .returning({ id: opsTemperatureFixtures.id });
  if (rows.length > 0) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "delete",
      entityType: "ops_temperature_fixture",
      entityId: id,
      before,
      after: { ...before, status: "inactive" },
    });
  }
  return rows.length > 0;
}

// ── W7 Temperature logs ─────────────────────────────────────────────────────

const TEMP_FOLLOW_UP_MS = 24 * 60 * 60 * 1000;

function isOutOfRange(reading: number, min: number | null, max: number | null): boolean {
  if (min !== null && reading < min) return true;
  if (max !== null && reading > max) return true;
  return false;
}

export async function listTemperatureLogs(
  facilityNumber: string,
  opts: {
    fixtureKey?: string;
    sinceMs?: number;
    outOfRangeOnly?: boolean;
    page: number;
    limit: number;
  },
): Promise<{ logs: OpsTemperatureLog[]; total: number }> {
  const conds = [eq(opsTemperatureLogs.facilityNumber, facilityNumber)];
  if (opts.fixtureKey) {
    conds.push(eq(opsTemperatureLogs.fixtureKey, opts.fixtureKey));
  }
  if (typeof opts.sinceMs === "number") {
    conds.push(gte(opsTemperatureLogs.readingAt, opts.sinceMs));
  }
  if (opts.outOfRangeOnly) {
    conds.push(eq(opsTemperatureLogs.outOfRange, 1));
  }
  const where = and(...conds);
  const offset = (opts.page - 1) * opts.limit;
  const [logs, countRows] = await Promise.all([
    db
      .select()
      .from(opsTemperatureLogs)
      .where(where)
      .orderBy(desc(opsTemperatureLogs.readingAt), desc(opsTemperatureLogs.id))
      .limit(opts.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsTemperatureLogs)
      .where(where),
  ]);
  return { logs, total: countRows[0]?.count ?? 0 };
}

export async function getTemperatureLog(
  id: number,
  facilityNumber: string,
): Promise<OpsTemperatureLog | undefined> {
  return pgFirst(
    db
      .select()
      .from(opsTemperatureLogs)
      .where(
        and(
          eq(opsTemperatureLogs.id, id),
          eq(opsTemperatureLogs.facilityNumber, facilityNumber),
        ),
      ),
  );
}

/**
 * Create a temperature reading. Implements the §9 out-of-range hook:
 *  - Reads the fixture, copies requiredMin/Max into the log row as
 *    threshold_min/max for evidentiary stability (a future threshold
 *    edit must not retroactively change what was "out of range" when
 *    this reading was taken).
 *  - Sets out_of_range=1 + follow_up_due_at = now + 24h on violation.
 *  - Emits a `create` audit event.
 *
 * `recordedBy` is free-text (Phase 5 §6.A.1): kitchen staff log temps
 * before they have logins. Trimmed and capped by the route's zod schema.
 */
export async function createTemperatureLog(
  input: {
    facilityNumber: string;
    fixtureId: number;
    readingValue: number;
    readingAt: number;
    recordedBy: string;
    note?: string | null;
  },
  actor: AuditActor,
): Promise<OpsTemperatureLog> {
  const fixture = await getTemperatureFixture(input.fixtureId, input.facilityNumber);
  if (!fixture) {
    throw new Error("Fixture not found");
  }
  if (fixture.status !== "active") {
    throw new Error("Fixture is not active");
  }
  const oor = isOutOfRange(
    input.readingValue,
    fixture.requiredMin ?? null,
    fixture.requiredMax ?? null,
  );
  const now = Date.now();
  const rows = await db
    .insert(opsTemperatureLogs)
    .values({
      facilityNumber: input.facilityNumber,
      fixtureId: fixture.id,
      fixtureKey: fixture.fixtureKey,
      readingValue: input.readingValue,
      unit: fixture.unit,
      thresholdMin: fixture.requiredMin ?? null,
      thresholdMax: fixture.requiredMax ?? null,
      outOfRange: oor ? 1 : 0,
      readingAt: input.readingAt,
      recordedBy: input.recordedBy,
      note: input.note ?? null,
      followUpDueAt: oor ? now + TEMP_FOLLOW_UP_MS : null,
      createdAt: now,
    })
    .returning();
  const row = rows[0] as OpsTemperatureLog;
  await safeAudit({
    facilityNumber: row.facilityNumber,
    actor,
    action: "create",
    entityType: "ops_temperature_log",
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function resolveTemperatureFollowUp(
  id: number,
  facilityNumber: string,
  actor: AuditActor,
  note: string,
): Promise<OpsTemperatureLog | undefined> {
  const before = await getTemperatureLog(id, facilityNumber);
  if (!before) return undefined;
  if (!before.outOfRange) {
    throw new Error("Log is not out of range");
  }
  if (before.followUpResolvedAt) {
    throw new Error("Follow-up already resolved");
  }
  const now = Date.now();
  const rows = await db
    .update(opsTemperatureLogs)
    .set({
      followUpResolvedAt: now,
      followUpResolvedBy: actor.id,
      followUpResolutionNote: note,
    })
    .where(
      and(
        eq(opsTemperatureLogs.id, id),
        eq(opsTemperatureLogs.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const after = rows[0] as OpsTemperatureLog | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "resolve",
      entityType: "ops_temperature_log",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

// ── W5 Drill logs ────────────────────────────────────────────────────────────

// Soft-delete approach: we use `status='deleted'` and a list-filter that
// hides deleted rows by default. This matches `ops_vendors.status='archived'`
// and avoids adding a deleted_at column to ops_drill_logs. List filters
// also accept an `includeDeleted` opt for audit/admin recovery views.

function rowToDrillLog(row: OpsDrillLog): OpsDrillLog & {
  participants: string[];
  residentsInvolved: string[];
  correctiveActions: string[];
} {
  return {
    ...row,
    participants: parseJsonArray<string>(row.participantsJson),
    residentsInvolved: parseJsonArray<string>(row.residentsInvolvedJson),
    correctiveActions: parseJsonArray<string>(row.correctiveActionsJson),
  };
}

export async function listDrillLogs(
  facilityNumber: string,
  opts: {
    kind?: string;
    sinceMs?: number;
    includeDeleted?: boolean;
    page: number;
    limit: number;
  },
): Promise<{ logs: OpsDrillLog[]; total: number }> {
  const conds = [eq(opsDrillLogs.facilityNumber, facilityNumber)];
  if (opts.kind) {
    conds.push(eq(opsDrillLogs.drillKind, opts.kind));
  }
  if (typeof opts.sinceMs === "number") {
    conds.push(gte(opsDrillLogs.executedAt, opts.sinceMs));
  }
  if (!opts.includeDeleted) {
    // sql.notEq across nullable status — defensive: any non-'deleted' value
    conds.push(sql`${opsDrillLogs.status} <> 'deleted'`);
  }
  const where = and(...conds);
  const offset = (opts.page - 1) * opts.limit;
  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(opsDrillLogs)
      .where(where)
      .orderBy(desc(opsDrillLogs.executedAt), desc(opsDrillLogs.id))
      .limit(opts.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsDrillLogs)
      .where(where),
  ]);
  return { logs: rows as OpsDrillLog[], total: countRows[0]?.count ?? 0 };
}

export async function getDrillLog(
  id: number,
  facilityNumber: string,
): Promise<OpsDrillLog | undefined> {
  return pgFirst(
    db
      .select()
      .from(opsDrillLogs)
      .where(
        and(
          eq(opsDrillLogs.id, id),
          eq(opsDrillLogs.facilityNumber, facilityNumber),
        ),
      ),
  );
}

// Helper exported for FE-side decoding parity tests.
export function decodeDrillLog(row: OpsDrillLog) {
  return rowToDrillLog(row);
}

export async function createDrillLog(
  input: {
    facilityNumber: string;
    drillKind: string;
    scenario?: string | null;
    shift?: string | null;
    executedAt: number;
    leader?: string | null;
    participants?: unknown[];
    residentsInvolved?: unknown[];
    evacuationSeconds?: number | null;
    debriefNotes?: string | null;
    correctiveActions?: unknown[];
    status?: string;
    createdBy: string;
  },
  actor: AuditActor,
): Promise<OpsDrillLog> {
  const now = Date.now();
  const rows = await db
    .insert(opsDrillLogs)
    .values({
      facilityNumber: input.facilityNumber,
      drillKind: input.drillKind,
      scenario: input.scenario ?? null,
      shift: input.shift ?? null,
      executedAt: input.executedAt,
      leader: input.leader ?? null,
      participantsJson: jsonArrayToText(input.participants),
      residentsInvolvedJson: jsonArrayToText(input.residentsInvolved),
      evacuationSeconds: input.evacuationSeconds ?? null,
      debriefNotes: input.debriefNotes ?? null,
      correctiveActionsJson: jsonArrayToText(input.correctiveActions),
      status: input.status ?? "executed",
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const row = rows[0] as OpsDrillLog;
  await safeAudit({
    facilityNumber: row.facilityNumber,
    actor,
    action: "create",
    entityType: "ops_drill_log",
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateDrillLog(
  id: number,
  facilityNumber: string,
  data: Partial<{
    drillKind: string;
    scenario: string | null;
    shift: string | null;
    executedAt: number;
    leader: string | null;
    participants: unknown[];
    residentsInvolved: unknown[];
    evacuationSeconds: number | null;
    debriefNotes: string | null;
    correctiveActions: unknown[];
    status: string;
  }>,
  actor: AuditActor,
): Promise<OpsDrillLog | undefined> {
  const before = await getDrillLog(id, facilityNumber);
  if (!before) return undefined;
  if (before.status === "deleted") {
    throw new Error("Drill log is deleted");
  }
  // Storage-layer status transition validation. The only legal transitions
  // for drills are executed → completed (debrief filed) or executed/completed
  // → deleted (handled by softDeleteDrillLog). Reject anything else so a
  // misbehaving route can't put the row into a junk state.
  if (data.status !== undefined) {
    const allowed = new Set(["executed", "completed", "deleted"]);
    if (!allowed.has(data.status)) {
      throw new Error(`Invalid drill status: ${data.status}`);
    }
  }
  const now = Date.now();
  const updateSet: Record<string, unknown> = { updatedAt: now };
  if (data.drillKind !== undefined) updateSet.drillKind = data.drillKind;
  if (data.scenario !== undefined) updateSet.scenario = data.scenario;
  if (data.shift !== undefined) updateSet.shift = data.shift;
  if (data.executedAt !== undefined) updateSet.executedAt = data.executedAt;
  if (data.leader !== undefined) updateSet.leader = data.leader;
  if (data.participants !== undefined) updateSet.participantsJson = jsonArrayToText(data.participants);
  if (data.residentsInvolved !== undefined) updateSet.residentsInvolvedJson = jsonArrayToText(data.residentsInvolved);
  if (data.evacuationSeconds !== undefined) updateSet.evacuationSeconds = data.evacuationSeconds;
  if (data.debriefNotes !== undefined) updateSet.debriefNotes = data.debriefNotes;
  if (data.correctiveActions !== undefined) updateSet.correctiveActionsJson = jsonArrayToText(data.correctiveActions);
  if (data.status !== undefined) updateSet.status = data.status;

  const rows = await db
    .update(opsDrillLogs)
    .set(updateSet)
    .where(
      and(
        eq(opsDrillLogs.id, id),
        eq(opsDrillLogs.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const after = rows[0] as OpsDrillLog | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "update",
      entityType: "ops_drill_log",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

export async function softDeleteDrillLog(
  id: number,
  facilityNumber: string,
  actor: AuditActor,
): Promise<boolean> {
  const before = await getDrillLog(id, facilityNumber);
  if (!before) return false;
  if (before.status === "deleted") return false;
  const now = Date.now();
  const rows = await db
    .update(opsDrillLogs)
    .set({ status: "deleted", updatedAt: now })
    .where(
      and(
        eq(opsDrillLogs.id, id),
        eq(opsDrillLogs.facilityNumber, facilityNumber),
      ),
    )
    .returning({ id: opsDrillLogs.id });
  if (rows.length > 0) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "delete",
      entityType: "ops_drill_log",
      entityId: id,
      before,
      after: { ...before, status: "deleted" },
    });
  }
  return rows.length > 0;
}

// ── W9 Vendors ───────────────────────────────────────────────────────────────

export async function listVendors(
  facilityNumber: string,
  opts: {
    expiringWithinDays?: number;
    vendorType?: string;
    status?: string;
    page: number;
    limit: number;
  },
): Promise<{ vendors: OpsVendor[]; total: number }> {
  const conds = [eq(opsVendors.facilityNumber, facilityNumber)];
  if (opts.vendorType) conds.push(eq(opsVendors.vendorType, opts.vendorType));
  if (opts.status) {
    conds.push(eq(opsVendors.status, opts.status));
  } else {
    // Default list view hides archived rows; pass status=archived explicitly
    // to surface them.
    conds.push(sql`${opsVendors.status} <> 'archived'`);
  }
  if (typeof opts.expiringWithinDays === "number" && opts.expiringWithinDays > 0) {
    const cutoff = Date.now() + opts.expiringWithinDays * 24 * 60 * 60 * 1000;
    // Filter applies to EITHER coi_expires_at OR license_expires_at falling
    // on/before the cutoff. Whichever is earliest qualifies the vendor.
    const expiryCond = or(
      and(
        sql`${opsVendors.coiExpiresAt} IS NOT NULL`,
        lte(opsVendors.coiExpiresAt, cutoff),
      ),
      and(
        sql`${opsVendors.licenseExpiresAt} IS NOT NULL`,
        lte(opsVendors.licenseExpiresAt, cutoff),
      ),
    );
    if (expiryCond) conds.push(expiryCond);
  }
  const where = and(...conds);
  const offset = (opts.page - 1) * opts.limit;
  const [vendors, countRows] = await Promise.all([
    db
      .select()
      .from(opsVendors)
      .where(where)
      .orderBy(opsVendors.vendorName)
      .limit(opts.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsVendors)
      .where(where),
  ]);
  return { vendors, total: countRows[0]?.count ?? 0 };
}

export async function getVendor(
  id: number,
  facilityNumber: string,
): Promise<OpsVendor | undefined> {
  return pgFirst(
    db
      .select()
      .from(opsVendors)
      .where(
        and(eq(opsVendors.id, id), eq(opsVendors.facilityNumber, facilityNumber)),
      ),
  );
}

export async function createVendor(
  data: InsertOpsVendor,
  actor: AuditActor,
): Promise<OpsVendor> {
  const now = Date.now();
  const rows = await db
    .insert(opsVendors)
    .values({ ...data, createdAt: now, updatedAt: now })
    .returning();
  const row = rows[0] as OpsVendor;
  await safeAudit({
    facilityNumber: row.facilityNumber,
    actor,
    action: "create",
    entityType: "ops_vendor",
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateVendor(
  id: number,
  facilityNumber: string,
  data: Partial<InsertOpsVendor>,
  actor: AuditActor,
): Promise<OpsVendor | undefined> {
  const before = await getVendor(id, facilityNumber);
  if (!before) return undefined;
  if (data.status !== undefined) {
    const allowed = new Set(["active", "archived"]);
    if (!allowed.has(data.status)) {
      throw new Error(`Invalid vendor status: ${data.status}`);
    }
  }
  const now = Date.now();
  const rows = await db
    .update(opsVendors)
    .set({ ...data, updatedAt: now })
    .where(
      and(eq(opsVendors.id, id), eq(opsVendors.facilityNumber, facilityNumber)),
    )
    .returning();
  const after = rows[0] as OpsVendor | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "update",
      entityType: "ops_vendor",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

export async function archiveVendor(
  id: number,
  facilityNumber: string,
  actor: AuditActor,
): Promise<OpsVendor | undefined> {
  const before = await getVendor(id, facilityNumber);
  if (!before) return undefined;
  if (before.status === "archived") return before;
  const now = Date.now();
  const rows = await db
    .update(opsVendors)
    .set({ status: "archived", updatedAt: now })
    .where(
      and(eq(opsVendors.id, id), eq(opsVendors.facilityNumber, facilityNumber)),
    )
    .returning();
  const after = rows[0] as OpsVendor | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "delete",
      entityType: "ops_vendor",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

// ── W10 Complaints ───────────────────────────────────────────────────────────

const COMPLAINT_STATUSES = new Set(["open", "investigating", "resolved", "closed"]);

// Status transition map. Resolved + close are terminal except for a single
// "reopen" from investigating → open (clerical correction). Reverse moves
// from resolved/closed are blocked at the storage layer so a misbehaving
// route can't silently corrupt the audit trail.
const COMPLAINT_TRANSITIONS: Record<string, Set<string>> = {
  open:          new Set(["investigating", "resolved", "closed"]),
  investigating: new Set(["open", "resolved", "closed"]),
  resolved:      new Set(["closed"]),
  closed:        new Set(),
};

function assertComplaintTransition(from: string, to: string): void {
  if (from === to) return;
  if (!COMPLAINT_STATUSES.has(to)) {
    throw new Error(`Invalid complaint status: ${to}`);
  }
  const allowed = COMPLAINT_TRANSITIONS[from];
  if (!allowed || !allowed.has(to)) {
    throw new Error(`Illegal complaint transition: ${from} -> ${to}`);
  }
}

export async function listComplaints(
  facilityNumber: string,
  opts: { status?: string; page: number; limit: number },
): Promise<{ complaints: OpsComplaint[]; total: number }> {
  const conds = [eq(opsComplaints.facilityNumber, facilityNumber)];
  if (opts.status) conds.push(eq(opsComplaints.status, opts.status));
  const where = and(...conds);
  const offset = (opts.page - 1) * opts.limit;
  const [complaints, countRows] = await Promise.all([
    db
      .select()
      .from(opsComplaints)
      .where(where)
      .orderBy(desc(opsComplaints.receivedAt), desc(opsComplaints.id))
      .limit(opts.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsComplaints)
      .where(where),
  ]);
  return { complaints, total: countRows[0]?.count ?? 0 };
}

export async function getComplaint(
  id: number,
  facilityNumber: string,
): Promise<
  | {
      complaint: OpsComplaint;
      investigationNotes: OpsComplaintInvestigationNote[];
      evidence: Awaited<ReturnType<typeof listEvidence>>;
    }
  | undefined
> {
  const complaint = await pgFirst(
    db
      .select()
      .from(opsComplaints)
      .where(
        and(
          eq(opsComplaints.id, id),
          eq(opsComplaints.facilityNumber, facilityNumber),
        ),
      ),
  );
  if (!complaint) return undefined;
  const [investigationNotes, evidence] = await Promise.all([
    db
      .select()
      .from(opsComplaintInvestigationNotes)
      .where(
        and(
          eq(opsComplaintInvestigationNotes.complaintId, complaint.id),
          eq(opsComplaintInvestigationNotes.facilityNumber, facilityNumber),
        ),
      )
      .orderBy(opsComplaintInvestigationNotes.notedAt),
    listEvidence(facilityNumber, "ops_complaint", complaint.id),
  ]);
  return { complaint, investigationNotes, evidence };
}

export async function createComplaint(
  data: InsertOpsComplaint,
  actor: AuditActor,
): Promise<OpsComplaint> {
  // Anonymous handling (Phase 5 §6.A.3): blank/null complainant fields are
  // legal when complainant_type='anonymous'. We do NOT force a placeholder
  // name on intake — the UI renders an em-dash. For any other type, name
  // must be non-empty.
  const type = data.complainantType;
  if (type !== "anonymous") {
    if (!data.complainantName || data.complainantName.trim() === "") {
      throw new Error("complainantName is required for non-anonymous complaints");
    }
  }
  if (!COMPLAINT_STATUSES.has(data.status ?? "open")) {
    throw new Error(`Invalid complaint status: ${data.status}`);
  }
  const now = Date.now();
  const rows = await db
    .insert(opsComplaints)
    .values({
      ...data,
      complainantName: data.complainantName?.trim() || null,
      complainantRelation: data.complainantRelation?.trim() || null,
      status: data.status ?? "open",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const row = rows[0] as OpsComplaint;
  await safeAudit({
    facilityNumber: row.facilityNumber,
    actor,
    action: "create",
    entityType: "ops_complaint",
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateComplaint(
  id: number,
  facilityNumber: string,
  data: Partial<InsertOpsComplaint>,
  actor: AuditActor,
): Promise<OpsComplaint | undefined> {
  const before = await pgFirst(
    db
      .select()
      .from(opsComplaints)
      .where(
        and(
          eq(opsComplaints.id, id),
          eq(opsComplaints.facilityNumber, facilityNumber),
        ),
      ),
  );
  if (!before) return undefined;
  if (data.status !== undefined && data.status !== before.status) {
    assertComplaintTransition(before.status, data.status);
  }
  const now = Date.now();
  const rows = await db
    .update(opsComplaints)
    .set({ ...data, updatedAt: now })
    .where(
      and(
        eq(opsComplaints.id, id),
        eq(opsComplaints.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const after = rows[0] as OpsComplaint | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "update",
      entityType: "ops_complaint",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

export async function addInvestigationNote(
  complaintId: number,
  facilityNumber: string,
  actor: AuditActor,
  note: string,
): Promise<OpsComplaintInvestigationNote | undefined> {
  const complaint = await pgFirst(
    db
      .select({ id: opsComplaints.id })
      .from(opsComplaints)
      .where(
        and(
          eq(opsComplaints.id, complaintId),
          eq(opsComplaints.facilityNumber, facilityNumber),
        ),
      ),
  );
  if (!complaint) return undefined;
  const now = Date.now();
  const rows = await db
    .insert(opsComplaintInvestigationNotes)
    .values({
      complaintId,
      facilityNumber,
      notedAt: now,
      notedBy: actor.id,
      note,
    })
    .returning();
  const row = rows[0] as OpsComplaintInvestigationNote;
  await safeAudit({
    facilityNumber,
    actor,
    action: "create",
    entityType: "ops_complaint_investigation_note",
    entityId: row.id,
    after: row,
  });
  // Bump the parent complaint's updatedAt so list ordering / cache invalidation
  // reflects the most recent activity. Wrapped so any failure here doesn't
  // shadow the successful note insert.
  try {
    await db
      .update(opsComplaints)
      .set({ updatedAt: now })
      .where(eq(opsComplaints.id, complaintId));
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[ops] complaint updatedAt bump failed", err);
  }
  return row;
}

export async function resolveComplaint(
  id: number,
  facilityNumber: string,
  actor: AuditActor,
  resolutionNote: string,
): Promise<OpsComplaint | undefined> {
  const before = await pgFirst(
    db
      .select()
      .from(opsComplaints)
      .where(
        and(
          eq(opsComplaints.id, id),
          eq(opsComplaints.facilityNumber, facilityNumber),
        ),
      ),
  );
  if (!before) return undefined;
  if (before.status === "resolved" || before.status === "closed") {
    throw new Error(`Cannot resolve complaint in status: ${before.status}`);
  }
  assertComplaintTransition(before.status, "resolved");
  const now = Date.now();
  const rows = await db
    .update(opsComplaints)
    .set({
      status: "resolved",
      resolutionNote,
      resolvedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(opsComplaints.id, id),
        eq(opsComplaints.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const after = rows[0] as OpsComplaint | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "resolve",
      entityType: "ops_complaint",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

export async function closeComplaint(
  id: number,
  facilityNumber: string,
  actor: AuditActor,
): Promise<OpsComplaint | undefined> {
  const before = await pgFirst(
    db
      .select()
      .from(opsComplaints)
      .where(
        and(
          eq(opsComplaints.id, id),
          eq(opsComplaints.facilityNumber, facilityNumber),
        ),
      ),
  );
  if (!before) return undefined;
  if (before.status !== "resolved") {
    throw new Error("Complaint must be resolved before it can be closed");
  }
  const now = Date.now();
  const rows = await db
    .update(opsComplaints)
    .set({ status: "closed", closedAt: now, updatedAt: now })
    .where(
      and(
        eq(opsComplaints.id, id),
        eq(opsComplaints.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const after = rows[0] as OpsComplaint | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "close",
      entityType: "ops_complaint",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

// ── W13 Inspections + citations ──────────────────────────────────────────────

export async function listInspections(
  facilityNumber: string,
  opts: { page: number; limit: number; sinceMs?: number },
): Promise<{ inspections: OpsInspection[]; total: number }> {
  const conds = [eq(opsInspections.facilityNumber, facilityNumber)];
  if (typeof opts.sinceMs === "number") {
    conds.push(gte(opsInspections.visitAt, opts.sinceMs));
  }
  const where = and(...conds);
  const offset = (opts.page - 1) * opts.limit;
  const [inspections, countRows] = await Promise.all([
    db
      .select()
      .from(opsInspections)
      .where(where)
      .orderBy(desc(opsInspections.visitAt), desc(opsInspections.id))
      .limit(opts.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsInspections)
      .where(where),
  ]);
  return { inspections, total: countRows[0]?.count ?? 0 };
}

export async function getInspection(
  id: number,
  facilityNumber: string,
): Promise<
  | {
      inspection: OpsInspection;
      citations: OpsInspectionCitation[];
      evidence: Awaited<ReturnType<typeof listEvidence>>;
    }
  | undefined
> {
  const inspection = await pgFirst(
    db
      .select()
      .from(opsInspections)
      .where(
        and(
          eq(opsInspections.id, id),
          eq(opsInspections.facilityNumber, facilityNumber),
        ),
      ),
  );
  if (!inspection) return undefined;
  const [citations, evidence] = await Promise.all([
    db
      .select()
      .from(opsInspectionCitations)
      .where(
        and(
          eq(opsInspectionCitations.inspectionId, inspection.id),
          eq(opsInspectionCitations.facilityNumber, facilityNumber),
        ),
      )
      .orderBy(opsInspectionCitations.createdAt),
    listEvidence(facilityNumber, "ops_inspection", inspection.id),
  ]);
  return { inspection, citations, evidence };
}

export async function createInspection(
  data: InsertOpsInspection,
  actor: AuditActor,
): Promise<OpsInspection> {
  const now = Date.now();
  const rows = await db
    .insert(opsInspections)
    .values({ ...data, createdAt: now, updatedAt: now })
    .returning();
  const row = rows[0] as OpsInspection;
  await safeAudit({
    facilityNumber: row.facilityNumber,
    actor,
    action: "create",
    entityType: "ops_inspection",
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateInspection(
  id: number,
  facilityNumber: string,
  data: Partial<InsertOpsInspection>,
  actor: AuditActor,
): Promise<OpsInspection | undefined> {
  const before = await pgFirst(
    db
      .select()
      .from(opsInspections)
      .where(
        and(
          eq(opsInspections.id, id),
          eq(opsInspections.facilityNumber, facilityNumber),
        ),
      ),
  );
  if (!before) return undefined;
  if (data.status !== undefined) {
    const allowed = new Set(["open", "closed"]);
    if (!allowed.has(data.status)) {
      throw new Error(`Invalid inspection status: ${data.status}`);
    }
  }
  const now = Date.now();
  const rows = await db
    .update(opsInspections)
    .set({ ...data, updatedAt: now })
    .where(
      and(
        eq(opsInspections.id, id),
        eq(opsInspections.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const after = rows[0] as OpsInspection | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "update",
      entityType: "ops_inspection",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

/**
 * Close an inspection. Gated on every linked citation being closed — this is
 * the Phase 4 §12 test plan acceptance criterion ("cannot close inspection
 * while any citation is open"). Returns undefined if the inspection doesn't
 * exist; throws if there are open citations so the route can surface a 400.
 */
export async function closeInspection(
  id: number,
  facilityNumber: string,
  actor: AuditActor,
): Promise<OpsInspection | undefined> {
  const before = await pgFirst(
    db
      .select()
      .from(opsInspections)
      .where(
        and(
          eq(opsInspections.id, id),
          eq(opsInspections.facilityNumber, facilityNumber),
        ),
      ),
  );
  if (!before) return undefined;
  if (before.status === "closed") return before;

  const openCitations = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(opsInspectionCitations)
    .where(
      and(
        eq(opsInspectionCitations.inspectionId, id),
        eq(opsInspectionCitations.facilityNumber, facilityNumber),
        eq(opsInspectionCitations.status, "open"),
      ),
    );
  const openCount = openCitations[0]?.count ?? 0;
  if (openCount > 0) {
    throw new Error("Cannot close inspection — open citations remain");
  }
  const now = Date.now();
  const rows = await db
    .update(opsInspections)
    .set({ status: "closed", closedAt: now, updatedAt: now })
    .where(
      and(
        eq(opsInspections.id, id),
        eq(opsInspections.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const after = rows[0] as OpsInspection | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "close",
      entityType: "ops_inspection",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

export async function addCitation(
  inspectionId: number,
  facilityNumber: string,
  data: {
    citationTitle: string;
    detail?: string | null;
    dueAt?: number | null;
  },
  actor: AuditActor,
): Promise<OpsInspectionCitation | undefined> {
  // Validate the parent inspection exists and is in this tenant. Otherwise
  // we'd happily orphan a citation under a foreign inspection_id.
  const inspection = await pgFirst(
    db
      .select({ id: opsInspections.id, status: opsInspections.status })
      .from(opsInspections)
      .where(
        and(
          eq(opsInspections.id, inspectionId),
          eq(opsInspections.facilityNumber, facilityNumber),
        ),
      ),
  );
  if (!inspection) return undefined;
  if (inspection.status === "closed") {
    throw new Error("Cannot add citation to a closed inspection");
  }
  const now = Date.now();
  const rows = await db
    .insert(opsInspectionCitations)
    .values({
      inspectionId,
      facilityNumber,
      citationTitle: data.citationTitle,
      detail: data.detail ?? null,
      dueAt: data.dueAt ?? null,
      status: "open",
      createdAt: now,
      updatedAt: now,
    })
    .returning();
  const row = rows[0] as OpsInspectionCitation;
  await safeAudit({
    facilityNumber,
    actor,
    action: "create",
    entityType: "ops_inspection_citation",
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function closeCitation(
  citationId: number,
  facilityNumber: string,
  actor: AuditActor,
  closureNote: string,
): Promise<OpsInspectionCitation | undefined> {
  const before = await pgFirst(
    db
      .select()
      .from(opsInspectionCitations)
      .where(
        and(
          eq(opsInspectionCitations.id, citationId),
          eq(opsInspectionCitations.facilityNumber, facilityNumber),
        ),
      ),
  );
  if (!before) return undefined;
  if (before.status === "closed") return before;
  const now = Date.now();
  const rows = await db
    .update(opsInspectionCitations)
    .set({
      status: "closed",
      closedAt: now,
      closedBy: actor.id,
      closureNote,
      updatedAt: now,
    })
    .where(
      and(
        eq(opsInspectionCitations.id, citationId),
        eq(opsInspectionCitations.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const after = rows[0] as OpsInspectionCitation | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "close",
      entityType: "ops_inspection_citation",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

// ── W11 Controlled-sub reconciliation ────────────────────────────────────────

export interface ControlledSubDiscrepancyRow {
  id: number;
  facilityNumber: string;
  medicationId: number;
  drugName: string | null;
  residentId: number | null;
  residentFirstName: string | null;
  residentLastName: string | null;
  countDate: number;
  shift: string;
  countedBy: string;
  witnessedBy: string;
  openingCount: number;
  closingCount: number;
  administeredCount: number;
  wastedCount: number;
  discrepancy: number | null;
  discrepancyNotes: string | null;
  resolved: number | null;
  ageMs: number;
}

/**
 * List controlled-sub counts that recorded a non-zero discrepancy, joined
 * with the medication + resident so the FE can render "Lorazepam — for
 * Margaret Chen" without a second round-trip. Tenant-scoped on `c.facility_number`
 * AT the SQL layer (defence in depth — Drizzle helps but a raw join lets us
 * avoid N+1).
 *
 * The `resolved` filter is the W11 list's primary UX axis: discrepancies
 * default to unresolved (the work the DON cares about); a separate query
 * with `resolved: true` powers the "resolved history" accordion.
 *
 * Indexes hit: idx_ops_csc_count_date for the ORDER BY, idx_ops_csc_medication
 * for the FK join. EXPLAIN reviewed for the 100-user / ~1k-rows-per-facility
 * scale — single hash join + index scan, no full-table scan.
 */
export async function listControlledSubDiscrepancies(
  facilityNumber: string,
  opts: { resolved?: boolean; page: number; limit: number },
): Promise<{ rows: ControlledSubDiscrepancyRow[]; total: number }> {
  const offset = (opts.page - 1) * opts.limit;
  const now = Date.now();
  const resolvedClause =
    opts.resolved === undefined
      ? ""
      : opts.resolved
        ? "AND COALESCE(c.resolved, 0) = 1"
        : "AND COALESCE(c.resolved, 0) = 0";

  // We deliberately list explicit columns rather than SELECT * — projecting
  // through the join expands shape (resident may be null on legacy rows
  // where the medication was deleted) and the explicit list documents what
  // the FE sees.
  const dataSql = `
    SELECT
      c.id,
      c.facility_number,
      c.medication_id,
      m.drug_name,
      m.resident_id,
      r.first_name AS resident_first_name,
      r.last_name  AS resident_last_name,
      c.count_date,
      c.shift,
      c.counted_by,
      c.witnessed_by,
      c.opening_count,
      c.closing_count,
      c.administered_count,
      c.wasted_count,
      c.discrepancy,
      c.discrepancy_notes,
      c.resolved
    FROM ops_controlled_sub_counts c
    LEFT JOIN ops_medications m ON c.medication_id = m.id
    LEFT JOIN ops_residents   r ON m.resident_id   = r.id
    WHERE c.facility_number = $1
      AND COALESCE(c.discrepancy, 0) <> 0
      ${resolvedClause}
    ORDER BY c.count_date DESC, c.id DESC
    LIMIT $2 OFFSET $3
  `;
  const countSql = `
    SELECT COUNT(*)::int AS c
    FROM ops_controlled_sub_counts c
    WHERE c.facility_number = $1
      AND COALESCE(c.discrepancy, 0) <> 0
      ${resolvedClause}
  `;
  const [dataRes, countRes] = await Promise.all([
    pool.query(dataSql, [facilityNumber, opts.limit, offset]),
    pool.query<{ c: number }>(countSql, [facilityNumber]),
  ]);
  const rows: ControlledSubDiscrepancyRow[] = dataRes.rows.map((row) => ({
    id: Number(row.id),
    facilityNumber: row.facility_number,
    medicationId: Number(row.medication_id),
    drugName: row.drug_name ?? null,
    residentId: row.resident_id !== null ? Number(row.resident_id) : null,
    residentFirstName: row.resident_first_name ?? null,
    residentLastName: row.resident_last_name ?? null,
    countDate: Number(row.count_date),
    shift: row.shift,
    countedBy: row.counted_by,
    witnessedBy: row.witnessed_by,
    openingCount: Number(row.opening_count),
    closingCount: Number(row.closing_count),
    administeredCount: Number(row.administered_count),
    wastedCount: Number(row.wasted_count),
    discrepancy: row.discrepancy !== null ? Number(row.discrepancy) : null,
    discrepancyNotes: row.discrepancy_notes,
    resolved: row.resolved !== null ? Number(row.resolved) : 0,
    ageMs: now - Number(row.count_date),
  }));
  return { rows, total: Number(countRes.rows[0]?.c ?? 0) };
}

/**
 * Resolve one controlled-sub discrepancy. Appends the resolution note to the
 * existing `discrepancy_notes` (does not overwrite — auditors need the
 * intake note + the resolution note both present). Optional `witnessedBy`
 * captures the second-signature required by Title 22 for controlled-sub
 * reconciliation.
 *
 * Evidence attachment (e.g. photo of the count log) is done by the FE via
 * the existing POST /api/ops/evidence with entityType='ops_controlled_sub_count'
 * — no separate endpoint here.
 */
export async function resolveControlledSubDiscrepancy(
  countId: number,
  facilityNumber: string,
  actor: AuditActor,
  args: { note: string; witnessedBy: string },
): Promise<OpsControlledSubCount | undefined> {
  const before = await pgFirst(
    db
      .select()
      .from(opsControlledSubCounts)
      .where(
        and(
          eq(opsControlledSubCounts.id, countId),
          eq(opsControlledSubCounts.facilityNumber, facilityNumber),
        ),
      ),
  );
  if (!before) return undefined;
  if (before.resolved) {
    throw new Error("Discrepancy is already resolved");
  }
  const nowIso = new Date().toISOString();
  const trailer = `\n[resolved by ${actor.id} on ${nowIso} witnessed by ${args.witnessedBy}]: ${args.note}`;
  const newNotes = (before.discrepancyNotes ?? "") + trailer;

  const rows = await db
    .update(opsControlledSubCounts)
    .set({ resolved: 1, discrepancyNotes: newNotes })
    .where(
      and(
        eq(opsControlledSubCounts.id, countId),
        eq(opsControlledSubCounts.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const after = rows[0] as OpsControlledSubCount | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "resolve",
      entityType: "ops_controlled_sub_count",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

/**
 * Recent destructions accordion (Phase 5 §6.B.1). Reads `ops_med_destruction`
 * joined with `ops_medications` so the FE can render "Lorazepam — destroyed
 * 2 days ago" without N+1. Surfaces alongside the W11 discrepancy list.
 */
export async function listRecentDestructions(
  facilityNumber: string,
  opts: { sinceMs?: number; limit?: number } = {},
): Promise<
  Array<OpsMedDestruction & { drugName: string | null }>
> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 25));
  const params: unknown[] = [facilityNumber];
  let sinceClause = "";
  if (typeof opts.sinceMs === "number") {
    params.push(opts.sinceMs);
    sinceClause = `AND d.destruction_date >= $${params.length}`;
  }
  params.push(limit);
  const limitParamIdx = params.length;
  const res = await pool.query(
    `SELECT d.*, m.drug_name
     FROM ops_med_destruction d
     LEFT JOIN ops_medications m ON d.medication_id = m.id
     WHERE d.facility_number = $1
       ${sinceClause}
     ORDER BY d.destruction_date DESC, d.id DESC
     LIMIT $${limitParamIdx}`,
    params,
  );
  return res.rows.map((row) => ({
    id: Number(row.id),
    medicationId: Number(row.medication_id),
    facilityNumber: row.facility_number,
    quantity: Number(row.quantity),
    unit: row.unit,
    destructionMethod: row.destruction_method,
    destroyedBy: row.destroyed_by,
    witnessedBy: row.witnessed_by,
    destructionDate: Number(row.destruction_date),
    reason: row.reason,
    createdAt: Number(row.created_at),
    drugName: row.drug_name ?? null,
  })) as Array<OpsMedDestruction & { drugName: string | null }>;
}
