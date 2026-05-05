import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
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
// Bootstrap — create all ops_ tables in PostgreSQL on startup
// ─────────────────────────────────────────────────────────────────────────────

export async function bootstrapOpsSchema(): Promise<void> {
  await pool.query(OPS_PG_SCHEMA_SQL);
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

export async function completeTask(id: number, notes: string, completedAt: number): Promise<boolean> {
  const rows = await db.update(opsDailyTasks).set({ status: "completed", completionNotes: notes, completedAt }).where(eq(opsDailyTasks.id, id)).returning({ id: opsDailyTasks.id });
  return rows.length > 0;
}

export async function refuseTask(id: number, reason: string): Promise<boolean> {
  const rows = await db.update(opsDailyTasks).set({ status: "refused", refused: 1, refuseReason: reason }).where(eq(opsDailyTasks.id, id)).returning({ id: opsDailyTasks.id });
  return rows.length > 0;
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

  const params: (string | number)[] = [facilityNumber];
  let where = "facility_number = $1";
  if (type) { params.push(type); where += ` AND incident_type = $${params.length}`; }
  if (residentId !== undefined) { params.push(residentId); where += ` AND resident_id = $${params.length}`; }

  const [rowsResult, countResult] = await Promise.all([
    pool.query(`SELECT * FROM ops_incidents WHERE ${where} ORDER BY incident_date DESC LIMIT ${limit} OFFSET ${offset}`, params),
    pool.query(`SELECT COUNT(*)::int as count FROM ops_incidents WHERE ${where}`, params),
  ]);
  return { incidents: rowsResult.rows, total: countResult.rows[0]?.count ?? 0 };
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
