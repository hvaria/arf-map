/**
 * Facility Operations Module — storage layer
 *
 * All database access for the ops module goes through this file.
 * Uses the shared sqlite/db singletons from server/db/index.ts.
 * Never log PHI (names, DOB, SSN, diagnoses, medications).
 */

import { eq, and, gte, lte, desc, sql } from "drizzle-orm";
import { db, sqlite, usingPostgres } from "../db/index";
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
// Module 1 — Residents / EHR
// ─────────────────────────────────────────────────────────────────────────────

export function listResidents(
  facilityNumber: string,
  opts: { page: number; limit: number; status?: string }
): { residents: OpsResident[]; total: number } {
  const { page, limit, status } = opts;
  const offset = (page - 1) * limit;

  const conditions = status
    ? and(
        eq(opsResidents.facilityNumber, facilityNumber),
        eq(opsResidents.status, status)
      )
    : eq(opsResidents.facilityNumber, facilityNumber);

  const residents = db
    .select()
    .from(opsResidents)
    .where(conditions)
    .limit(limit)
    .offset(offset)
    .orderBy(desc(opsResidents.createdAt))
    .all();

  const countRow = db
    .select({ count: sql<number>`count(*)` })
    .from(opsResidents)
    .where(conditions)
    .get();

  return { residents, total: countRow?.count ?? 0 };
}

export function getResident(
  id: number,
  facilityNumber: string
): OpsResident | undefined {
  return db
    .select()
    .from(opsResidents)
    .where(
      and(eq(opsResidents.id, id), eq(opsResidents.facilityNumber, facilityNumber))
    )
    .get();
}

export function createResident(data: InsertOpsResident): OpsResident {
  const now = Date.now();
  const result = db
    .insert(opsResidents)
    .values({ ...data, createdAt: now, updatedAt: now })
    .returning()
    .get();
  return result;
}

export function updateResident(
  id: number,
  facilityNumber: string,
  data: Partial<InsertOpsResident>
): OpsResident | undefined {
  const now = Date.now();
  const result = db
    .update(opsResidents)
    .set({ ...data, updatedAt: now })
    .where(
      and(eq(opsResidents.id, id), eq(opsResidents.facilityNumber, facilityNumber))
    )
    .returning()
    .get();
  return result;
}

export function softDeleteResident(id: number, facilityNumber: string): boolean {
  const now = Date.now();
  const result = db
    .update(opsResidents)
    .set({ status: "discharged", dischargeDate: now, updatedAt: now })
    .where(
      and(eq(opsResidents.id, id), eq(opsResidents.facilityNumber, facilityNumber))
    )
    .run();
  return result.changes > 0;
}

// Assessments

export function listAssessments(
  residentId: number,
  facilityNumber: string
): OpsResidentAssessment[] {
  return db
    .select()
    .from(opsResidentAssessments)
    .where(
      and(
        eq(opsResidentAssessments.residentId, residentId),
        eq(opsResidentAssessments.facilityNumber, facilityNumber)
      )
    )
    .orderBy(desc(opsResidentAssessments.assessedAt))
    .all();
}

export function createAssessment(
  data: InsertOpsResidentAssessment
): OpsResidentAssessment {
  const now = Date.now();
  return db
    .insert(opsResidentAssessments)
    .values({ ...data, createdAt: now })
    .returning()
    .get();
}

export function updateAssessment(
  id: number,
  data: Partial<InsertOpsResidentAssessment>
): OpsResidentAssessment | undefined {
  return db
    .update(opsResidentAssessments)
    .set(data)
    .where(eq(opsResidentAssessments.id, id))
    .returning()
    .get();
}

// Care Plans

export function getActiveCarePlan(
  residentId: number,
  facilityNumber: string
): OpsCarePlan | undefined {
  return db
    .select()
    .from(opsCarePlans)
    .where(
      and(
        eq(opsCarePlans.residentId, residentId),
        eq(opsCarePlans.facilityNumber, facilityNumber)
      )
    )
    .orderBy(desc(opsCarePlans.createdAt))
    .limit(1)
    .get();
}

export function createCarePlan(data: InsertOpsCarePlan): OpsCarePlan {
  const now = Date.now();
  return db
    .insert(opsCarePlans)
    .values({ ...data, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function updateCarePlan(
  id: number,
  data: Partial<InsertOpsCarePlan>
): OpsCarePlan | undefined {
  const now = Date.now();
  return db
    .update(opsCarePlans)
    .set({ ...data, updatedAt: now })
    .where(eq(opsCarePlans.id, id))
    .returning()
    .get();
}

export function signCarePlan(
  id: number,
  signerType: "resident" | "family",
  signature: string
): boolean {
  const now = Date.now();
  const updateData =
    signerType === "resident"
      ? { digitalSignatureResident: signature, signatureDate: now, updatedAt: now }
      : { digitalSignatureFamily: signature, signatureDate: now, updatedAt: now };

  const result = db
    .update(opsCarePlans)
    .set(updateData)
    .where(eq(opsCarePlans.id, id))
    .run();
  return result.changes > 0;
}

// Daily Tasks

export function getDailyTasks(
  residentId: number,
  facilityNumber: string,
  taskDate: number,
  shift?: string
): OpsDailyTask[] {
  const conditions = shift
    ? and(
        eq(opsDailyTasks.residentId, residentId),
        eq(opsDailyTasks.facilityNumber, facilityNumber),
        eq(opsDailyTasks.taskDate, taskDate),
        eq(opsDailyTasks.shift, shift)
      )
    : and(
        eq(opsDailyTasks.residentId, residentId),
        eq(opsDailyTasks.facilityNumber, facilityNumber),
        eq(opsDailyTasks.taskDate, taskDate)
      );

  return db.select().from(opsDailyTasks).where(conditions).all();
}

export function completeTask(
  id: number,
  notes: string,
  completedAt: number
): boolean {
  const result = db
    .update(opsDailyTasks)
    .set({ status: "completed", completionNotes: notes, completedAt })
    .where(eq(opsDailyTasks.id, id))
    .run();
  return result.changes > 0;
}

export function refuseTask(id: number, reason: string): boolean {
  const result = db
    .update(opsDailyTasks)
    .set({ status: "refused", refused: 1, refuseReason: reason })
    .where(eq(opsDailyTasks.id, id))
    .run();
  return result.changes > 0;
}

export function createDailyTasksFromCarePlan(
  carePlanId: number,
  residentId: number,
  facilityNumber: string
): number {
  const carePlan = db
    .select()
    .from(opsCarePlans)
    .where(eq(opsCarePlans.id, carePlanId))
    .get();

  if (!carePlan) return 0;

  const now = Date.now();
  // Normalize to start-of-day UTC timestamp for the task date
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

  db.insert(opsDailyTasks).values(taskData).run();
  return 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 2 — Medications / eMAR
// ─────────────────────────────────────────────────────────────────────────────

export function listMedications(
  residentId: number,
  facilityNumber: string,
  status?: string
): OpsMedication[] {
  const conditions = status
    ? and(
        eq(opsMedications.residentId, residentId),
        eq(opsMedications.facilityNumber, facilityNumber),
        eq(opsMedications.status, status)
      )
    : and(
        eq(opsMedications.residentId, residentId),
        eq(opsMedications.facilityNumber, facilityNumber)
      );

  return db.select().from(opsMedications).where(conditions).all();
}

export function createMedication(data: InsertOpsMedication): OpsMedication {
  const now = Date.now();
  return db
    .insert(opsMedications)
    .values({ ...data, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function updateMedication(
  id: number,
  facilityNumber: string,
  data: Partial<InsertOpsMedication>
): OpsMedication | undefined {
  const now = Date.now();
  return db
    .update(opsMedications)
    .set({ ...data, updatedAt: now })
    .where(
      and(
        eq(opsMedications.id, id),
        eq(opsMedications.facilityNumber, facilityNumber)
      )
    )
    .returning()
    .get();
}

export function discontinueMedication(
  id: number,
  facilityNumber: string,
  reason: string,
  by: string
): boolean {
  const now = Date.now();
  const result = db
    .update(opsMedications)
    .set({
      status: "discontinued",
      discontinuedReason: reason,
      discontinuedBy: by,
      discontinuedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(opsMedications.id, id),
        eq(opsMedications.facilityNumber, facilityNumber)
      )
    )
    .run();
  return result.changes > 0;
}

// Med pass queue

export function generateDailyMedPassEntries(facilityNumber: string, date: number): void {
  if (usingPostgres) {
    throw new Error("[opsStorage] generateDailyMedPassEntries: not implemented for Postgres mode. See agents/05-blockers.md.");
  }
  const dayStart = date;
  const dayEnd = date + 86400000;

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
    medication_id: number;
    resident_id: number;
    scheduled_times: string | null;
    is_prn: number;
  }>;

  const insert = sqlite!.prepare(
    `INSERT INTO ops_med_passes (medication_id, resident_id, facility_number, scheduled_datetime, status)
     SELECT ?, ?, ?, ?, 'pending'
     WHERE NOT EXISTS (
       SELECT 1 FROM ops_med_passes WHERE medication_id = ? AND scheduled_datetime = ?
     )`
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
      insert.run(med.medication_id, med.resident_id, facilityNumber, scheduledDatetime, med.medication_id, scheduledDatetime);
    }
  }
}

export function getFacilityMedPassQueue(
  facilityNumber: string,
  date: number
): Array<OpsMedPass & { drug_name: string; resident_first_name: string; resident_last_name: string; room_number: string | null }> {
  if (usingPostgres) {
    throw new Error("[opsStorage] getFacilityMedPassQueue: not implemented for Postgres mode. See agents/05-blockers.md.");
  }
  const dayStart = date;
  const dayEnd = date + 86400000; // +24h in ms

  return sqlite!
    .prepare(
      `SELECT mp.*, m.drug_name, r.first_name AS resident_first_name, r.last_name AS resident_last_name, r.room_number
       FROM ops_med_passes mp
       JOIN ops_medications m ON mp.medication_id = m.id
       JOIN ops_residents r ON mp.resident_id = r.id
       WHERE mp.facility_number = ?
         AND mp.scheduled_datetime >= ?
         AND mp.scheduled_datetime < ?
       ORDER BY mp.scheduled_datetime ASC`
    )
    .all(facilityNumber, dayStart, dayEnd) as Array<
    OpsMedPass & { drug_name: string; resident_first_name: string; resident_last_name: string; room_number: string | null }
  >;
}

export function getResidentMedPassQueue(
  residentId: number,
  facilityNumber: string,
  date: number
): Array<OpsMedPass & { drug_name: string }> {
  if (usingPostgres) {
    throw new Error("[opsStorage] getResidentMedPassQueue: not implemented for Postgres mode. See agents/05-blockers.md.");
  }
  const dayStart = date;
  const dayEnd = date + 86400000;

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
    .all(residentId, facilityNumber, dayStart, dayEnd) as Array<
    OpsMedPass & { drug_name: string }
  >;
}

export function recordMedPass(data: InsertOpsMedPass): OpsMedPass {
  const now = Date.now();
  return db
    .insert(opsMedPasses)
    .values({ ...data, createdAt: now })
    .returning()
    .get();
}

export function updatePrnFollowup(
  id: number,
  effectivenessNotes: string,
  notedAt: number
): boolean {
  const result = db
    .update(opsMedPasses)
    .set({
      prnEffectivenessNotes: effectivenessNotes,
      prnEffectivenessNotedAt: notedAt,
    })
    .where(eq(opsMedPasses.id, id))
    .run();
  return result.changes > 0;
}

// Controlled substances

export function recordControlledSubCount(
  data: InsertOpsControlledSubCount
): OpsControlledSubCount {
  const now = Date.now();
  return db
    .insert(opsControlledSubCounts)
    .values({ ...data, createdAt: now })
    .returning()
    .get();
}

export function recordMedDestruction(
  data: InsertOpsMedDestruction
): OpsMedDestruction {
  const now = Date.now();
  return db
    .insert(opsMedDestruction)
    .values({ ...data, createdAt: now })
    .returning()
    .get();
}

// Reports

export function getMedPassDashboard(
  facilityNumber: string,
  date: number
): { overdue: number; late: number; missed: number; given: number; pending: number } {
  if (usingPostgres) {
    throw new Error("[opsStorage] getMedPassDashboard: not implemented for Postgres mode. See agents/05-blockers.md.");
  }
  const dayStart = date;
  const dayEnd = date + 86400000;
  const now = Date.now();

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
    .all(now, facilityNumber, dayStart, dayEnd) as Array<{
    status: string;
    cnt: number;
    overdue_cnt: number;
  }>;

  const result = { overdue: 0, late: 0, missed: 0, given: 0, pending: 0 };
  for (const row of rows) {
    if (row.status === "given") result.given = row.cnt;
    else if (row.status === "missed") result.missed = row.cnt;
    else if (row.status === "late") result.late = row.cnt;
    else if (row.status === "pending") {
      result.pending = row.cnt;
      result.overdue = row.overdue_cnt ?? 0;
    }
  }
  return result;
}

export function getMedRefusals(
  facilityNumber: string,
  startDate: number,
  endDate: number
): OpsMedPass[] {
  return db
    .select()
    .from(opsMedPasses)
    .where(
      and(
        eq(opsMedPasses.facilityNumber, facilityNumber),
        eq(opsMedPasses.status, "refused"),
        gte(opsMedPasses.scheduledDatetime, startDate),
        lte(opsMedPasses.scheduledDatetime, endDate)
      )
    )
    .all();
}

export function getPrnReport(
  facilityNumber: string,
  startDate: number,
  endDate: number
): Array<OpsMedPass & { drug_name: string; resident_name: string }> {
  if (usingPostgres) {
    throw new Error("[opsStorage] getPrnReport: not implemented for Postgres mode. See agents/05-blockers.md.");
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
    .all(facilityNumber, startDate, endDate) as Array<
    OpsMedPass & { drug_name: string; resident_name: string }
  >;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 3 — Incidents
// ─────────────────────────────────────────────────────────────────────────────

export function listIncidents(
  facilityNumber: string,
  opts: { page: number; limit: number; type?: string; residentId?: number }
): { incidents: OpsIncident[]; total: number } {
  const { page, limit, type, residentId } = opts;
  const offset = (page - 1) * limit;

  // Build conditions dynamically using raw SQL to avoid complex Drizzle and() chains
  const whereParts: string[] = ["facility_number = ?"];
  const params: (string | number)[] = [facilityNumber];

  if (type) {
    whereParts.push("incident_type = ?");
    params.push(type);
  }
  if (residentId !== undefined) {
    whereParts.push("resident_id = ?");
    params.push(residentId);
  }

  const whereClause = whereParts.join(" AND ");

  if (usingPostgres) {
    throw new Error("[opsStorage] listIncidents: not implemented for Postgres mode. See agents/05-blockers.md.");
  }

  const incidents = sqlite!
    .prepare(
      `SELECT * FROM ops_incidents WHERE ${whereClause} ORDER BY incident_date DESC LIMIT ? OFFSET ?`
    )
    .all(...params, limit, offset) as OpsIncident[];

  const countRow = sqlite!
    .prepare(`SELECT COUNT(*) as count FROM ops_incidents WHERE ${whereClause}`)
    .get(...params) as { count: number };

  return { incidents, total: countRow?.count ?? 0 };
}

export function createIncident(data: InsertOpsIncident): OpsIncident {
  const now = Date.now();
  return db
    .insert(opsIncidents)
    .values({ ...data, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function updateIncident(
  id: number,
  facilityNumber: string,
  data: Partial<InsertOpsIncident>
): OpsIncident | undefined {
  const now = Date.now();
  return db
    .update(opsIncidents)
    .set({ ...data, updatedAt: now })
    .where(
      and(
        eq(opsIncidents.id, id),
        eq(opsIncidents.facilityNumber, facilityNumber)
      )
    )
    .returning()
    .get();
}

export function getIncidentTrends(
  facilityNumber: string,
  days: number
): Array<{ incident_type: string; count: number; date: string }> {
  if (usingPostgres) {
    throw new Error("[opsStorage] getIncidentTrends: not implemented for Postgres mode. See agents/05-blockers.md.");
  }
  const since = Date.now() - days * 86400000;
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
    .all(facilityNumber, since) as Array<{
    incident_type: string;
    count: number;
    date: string;
  }>;
}

export function determineLic624Required(
  incidentType: string,
  injuryInvolved: boolean,
  hospitalizationRequired: boolean
): boolean {
  if (
    incidentType === "death" ||
    incidentType === "abuse_allegation" ||
    incidentType === "elopement"
  ) {
    return true;
  }
  if (incidentType === "fall" && injuryInvolved) return true;
  if (hospitalizationRequired) return true;
  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 4 — CRM / Admissions
// ─────────────────────────────────────────────────────────────────────────────

export function listLeads(
  facilityNumber: string,
  opts: { page: number; limit: number; stage?: string }
): { leads: OpsLead[]; total: number } {
  const { page, limit, stage } = opts;
  const offset = (page - 1) * limit;

  const conditions = stage
    ? and(eq(opsLeads.facilityNumber, facilityNumber), eq(opsLeads.stage, stage))
    : eq(opsLeads.facilityNumber, facilityNumber);

  const leads = db
    .select()
    .from(opsLeads)
    .where(conditions)
    .limit(limit)
    .offset(offset)
    .orderBy(desc(opsLeads.createdAt))
    .all();

  const countRow = db
    .select({ count: sql<number>`count(*)` })
    .from(opsLeads)
    .where(conditions)
    .get();

  return { leads, total: countRow?.count ?? 0 };
}

export function getLead(
  id: number,
  facilityNumber: string
): OpsLead | undefined {
  return db
    .select()
    .from(opsLeads)
    .where(and(eq(opsLeads.id, id), eq(opsLeads.facilityNumber, facilityNumber)))
    .get();
}

export function createLead(data: InsertOpsLead): OpsLead {
  const now = Date.now();
  return db
    .insert(opsLeads)
    .values({ ...data, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function updateLead(
  id: number,
  facilityNumber: string,
  data: Partial<InsertOpsLead>
): OpsLead | undefined {
  const now = Date.now();
  return db
    .update(opsLeads)
    .set({ ...data, updatedAt: now })
    .where(and(eq(opsLeads.id, id), eq(opsLeads.facilityNumber, facilityNumber)))
    .returning()
    .get();
}

export function scheduleTour(data: InsertOpsTour): OpsTour {
  const now = Date.now();
  return db
    .insert(opsTours)
    .values({ ...data, createdAt: now })
    .returning()
    .get();
}

export function updateTour(
  id: number,
  data: Partial<InsertOpsTour>
): OpsTour | undefined {
  return db
    .update(opsTours)
    .set(data)
    .where(eq(opsTours.id, id))
    .returning()
    .get();
}

export function startAdmission(data: InsertOpsAdmission): OpsAdmission {
  const now = Date.now();
  return db
    .insert(opsAdmissions)
    .values({ ...data, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function updateAdmissionLicForm(
  admissionId: number,
  form: string,
  completed: boolean
): boolean {
  // form param is like "lic_601", "lic_602a", etc.
  // Map to column names
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

  if (usingPostgres) {
    throw new Error("[opsStorage] updateAdmissionLicForm: not implemented for Postgres mode. See agents/05-blockers.md.");
  }

  const now = Date.now();
  const result = sqlite!
    .prepare(
      `UPDATE ops_admissions
       SET ${mapping.completedCol} = ?, ${mapping.dateCol} = ?, updated_at = ?
       WHERE id = ?`
    )
    .run(completed ? 1 : 0, completed ? now : null, now, admissionId);

  return result.changes > 0;
}

export function convertAdmissionToResident(
  admissionId: number
): OpsResident | undefined {
  const admission = db
    .select()
    .from(opsAdmissions)
    .where(eq(opsAdmissions.id, admissionId))
    .get();

  if (!admission) return undefined;

  const lead = db
    .select()
    .from(opsLeads)
    .where(eq(opsLeads.id, admission.leadId))
    .get();

  if (!lead) return undefined;

  const now = Date.now();

  // Split prospect name into first/last (best effort)
  const nameParts = lead.prospectName.trim().split(/\s+/);
  const firstName = nameParts[0] ?? lead.prospectName;
  const lastName = nameParts.slice(1).join(" ") || "Unknown";

  const resident = db
    .insert(opsResidents)
    .values({
      facilityNumber: lead.facilityNumber,
      firstName,
      lastName,
      dob: lead.prospectDob ?? undefined,
      gender: lead.prospectGender ?? undefined,
      admissionDate: admission.moveInDate ?? now,
      roomNumber: admission.assignedRoom ?? undefined,
      fundingSource: lead.fundingSource ?? undefined,
      status: "active",
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();

  // Link resident back to admission
  db.update(opsAdmissions)
    .set({ residentId: resident.id, updatedAt: now })
    .where(eq(opsAdmissions.id, admissionId))
    .run();

  return resident;
}

export function getOccupancy(facilityNumber: string): {
  total: number;
  active: number;
  beds_available: number;
  occupancy_rate: number;
} {
  if (usingPostgres) {
    throw new Error("[opsStorage] getOccupancy: not implemented for Postgres mode. See agents/05-blockers.md.");
  }

  // Total capacity: count all non-discharged residents as a proxy,
  // and use a facility setting if available, else default 6 (typical ARF).
  const settingRow = sqlite!
    .prepare(
      `SELECT setting_value FROM ops_facility_settings WHERE facility_number = ? AND setting_key = 'bed_capacity'`
    )
    .get(facilityNumber) as { setting_value: string } | undefined;

  const total = settingRow ? parseInt(settingRow.setting_value, 10) : 6;

  const activeRow = sqlite!
    .prepare(
      `SELECT COUNT(*) as count FROM ops_residents WHERE facility_number = ? AND status = 'active'`
    )
    .get(facilityNumber) as { count: number };

  const active = activeRow?.count ?? 0;
  const beds_available = Math.max(0, total - active);
  const occupancy_rate = total > 0 ? Math.round((active / total) * 100) : 0;

  return { total, active, beds_available, occupancy_rate };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 5 — Billing
// ─────────────────────────────────────────────────────────────────────────────

export function listCharges(
  facilityNumber: string,
  residentId: number
): OpsBillingCharge[] {
  return db
    .select()
    .from(opsBillingCharges)
    .where(
      and(
        eq(opsBillingCharges.facilityNumber, facilityNumber),
        eq(opsBillingCharges.residentId, residentId)
      )
    )
    .orderBy(desc(opsBillingCharges.createdAt))
    .all();
}

export function createCharge(data: InsertOpsBillingCharge): OpsBillingCharge {
  const now = Date.now();
  return db
    .insert(opsBillingCharges)
    .values({ ...data, createdAt: now })
    .returning()
    .get();
}

export function deleteCharge(id: number, facilityNumber: string): boolean {
  const result = db
    .delete(opsBillingCharges)
    .where(
      and(
        eq(opsBillingCharges.id, id),
        eq(opsBillingCharges.facilityNumber, facilityNumber)
      )
    )
    .run();
  return result.changes > 0;
}

export function generateInvoice(
  facilityNumber: string,
  residentId: number,
  periodStart: number,
  periodEnd: number
): OpsInvoice {
  if (usingPostgres) {
    throw new Error("[opsStorage] generateInvoice: not implemented for Postgres mode. See agents/05-blockers.md.");
  }

  // Sum charges in the billing period
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
    .get(facilityNumber, residentId, periodStart, periodEnd, periodStart, periodEnd) as {
    subtotal: number;
  };

  const subtotal = chargesRow?.subtotal ?? 0;
  const tax = 0; // ARFs typically don't charge tax on room and board
  const total = subtotal + tax;
  const now = Date.now();
  const dueDate = now + 30 * 86400000; // net-30

  return db
    .insert(opsInvoices)
    .values({
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
      status: "draft",
      dueDate,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
}

export function getInvoice(id: number): OpsInvoice | undefined {
  return db
    .select()
    .from(opsInvoices)
    .where(eq(opsInvoices.id, id))
    .get();
}

export function markInvoiceSent(id: number): boolean {
  const now = Date.now();
  const result = db
    .update(opsInvoices)
    .set({ status: "sent", sentAt: now, updatedAt: now })
    .where(eq(opsInvoices.id, id))
    .run();
  return result.changes > 0;
}

export function recordPayment(data: InsertOpsPayment): OpsPayment {
  const now = Date.now();
  const payment = db
    .insert(opsPayments)
    .values({ ...data, createdAt: now })
    .returning()
    .get();

  // Update invoice balance
  const invoice = db
    .select()
    .from(opsInvoices)
    .where(eq(opsInvoices.id, data.invoiceId))
    .get();

  if (invoice) {
    const newAmountPaid = (invoice.amountPaid ?? 0) + data.amount;
    const newBalanceDue = Math.max(0, (invoice.total ?? 0) - newAmountPaid);
    const newStatus =
      newBalanceDue <= 0 ? "paid" : invoice.status === "draft" ? "sent" : invoice.status;

    db.update(opsInvoices)
      .set({
        amountPaid: newAmountPaid,
        balanceDue: newBalanceDue,
        status: newStatus,
        paidAt: newBalanceDue <= 0 ? now : invoice.paidAt,
        updatedAt: now,
      })
      .where(eq(opsInvoices.id, data.invoiceId))
      .run();
  }

  return payment;
}

export function getArAging(facilityNumber: string): {
  current: number;
  days_30: number;
  days_60: number;
  days_90: number;
  over_90: number;
} {
  if (usingPostgres) {
    throw new Error("[opsStorage] getArAging: not implemented for Postgres mode. See agents/05-blockers.md.");
  }

  const now = Date.now();
  const d30 = now - 30 * 86400000;
  const d60 = now - 60 * 86400000;
  const d90 = now - 90 * 86400000;

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
    current_amt: number | null;
    days_30_amt: number | null;
    days_60_amt: number | null;
    days_90_amt: number | null;
    over_90_amt: number | null;
  };

  return {
    current: rows?.current_amt ?? 0,
    days_30: rows?.days_30_amt ?? 0,
    days_60: rows?.days_60_amt ?? 0,
    days_90: rows?.days_90_amt ?? 0,
    over_90: rows?.over_90_amt ?? 0,
  };
}

export function getBillingSummary(
  facilityNumber: string,
  periodStart: number,
  periodEnd: number
): { total_billed: number; total_paid: number; total_outstanding: number } {
  if (usingPostgres) {
    throw new Error("[opsStorage] getBillingSummary: not implemented for Postgres mode. See agents/05-blockers.md.");
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
    .get(facilityNumber, periodStart, periodEnd) as {
    total_billed: number;
    total_paid: number;
    total_outstanding: number;
  };

  return {
    total_billed: row?.total_billed ?? 0,
    total_paid: row?.total_paid ?? 0,
    total_outstanding: row?.total_outstanding ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 6 — Staff / Scheduling / Compliance
// ─────────────────────────────────────────────────────────────────────────────

export function listStaff(
  facilityNumber: string,
  status?: string
): OpsStaffMember[] {
  const conditions = status
    ? and(eq(opsStaff.facilityNumber, facilityNumber), eq(opsStaff.status, status))
    : eq(opsStaff.facilityNumber, facilityNumber);

  return db
    .select()
    .from(opsStaff)
    .where(conditions)
    .orderBy(desc(opsStaff.createdAt))
    .all();
}

export function createStaff(data: InsertOpsStaffMember): OpsStaffMember {
  const now = Date.now();
  return db
    .insert(opsStaff)
    .values({ ...data, createdAt: now, updatedAt: now })
    .returning()
    .get();
}

export function updateStaff(
  id: number,
  facilityNumber: string,
  data: Partial<InsertOpsStaffMember>
): OpsStaffMember | undefined {
  const now = Date.now();
  return db
    .update(opsStaff)
    .set({ ...data, updatedAt: now })
    .where(
      and(eq(opsStaff.id, id), eq(opsStaff.facilityNumber, facilityNumber))
    )
    .returning()
    .get();
}

export function deactivateStaff(id: number, facilityNumber: string): boolean {
  const now = Date.now();
  const result = db
    .update(opsStaff)
    .set({ status: "inactive", terminationDate: now, updatedAt: now })
    .where(
      and(eq(opsStaff.id, id), eq(opsStaff.facilityNumber, facilityNumber))
    )
    .run();
  return result.changes > 0;
}

export function listShifts(facilityNumber: string, weekStart: number): OpsShift[] {
  const weekEnd = weekStart + 7 * 86400000;
  return db
    .select()
    .from(opsShifts)
    .where(
      and(
        eq(opsShifts.facilityNumber, facilityNumber),
        gte(opsShifts.shiftDate, weekStart),
        lte(opsShifts.shiftDate, weekEnd)
      )
    )
    .orderBy(opsShifts.shiftDate)
    .all();
}

export function createShift(data: InsertOpsShift): OpsShift {
  const now = Date.now();
  return db
    .insert(opsShifts)
    .values({ ...data, createdAt: now })
    .returning()
    .get();
}

export function updateShift(
  id: number,
  data: Partial<InsertOpsShift>
): OpsShift | undefined {
  return db
    .update(opsShifts)
    .set(data)
    .where(eq(opsShifts.id, id))
    .returning()
    .get();
}

export function listComplianceItems(
  facilityNumber: string,
  status?: string
): OpsComplianceItem[] {
  const conditions = status
    ? and(
        eq(opsComplianceCalendar.facilityNumber, facilityNumber),
        eq(opsComplianceCalendar.status, status)
      )
    : eq(opsComplianceCalendar.facilityNumber, facilityNumber);

  return db
    .select()
    .from(opsComplianceCalendar)
    .where(conditions)
    .orderBy(opsComplianceCalendar.dueDate)
    .all();
}

export function createComplianceItem(
  data: InsertOpsComplianceItem
): OpsComplianceItem {
  const now = Date.now();
  return db
    .insert(opsComplianceCalendar)
    .values({ ...data, createdAt: now })
    .returning()
    .get();
}

export function completeComplianceItem(
  id: number,
  facilityNumber: string,
  completedDate: number
): boolean {
  const result = db
    .update(opsComplianceCalendar)
    .set({ status: "completed", completedDate })
    .where(
      and(
        eq(opsComplianceCalendar.id, id),
        eq(opsComplianceCalendar.facilityNumber, facilityNumber)
      )
    )
    .run();
  return result.changes > 0;
}

export function getOverdueCompliance(facilityNumber: string): OpsComplianceItem[] {
  const now = Date.now();
  return db
    .select()
    .from(opsComplianceCalendar)
    .where(
      and(
        eq(opsComplianceCalendar.facilityNumber, facilityNumber),
        eq(opsComplianceCalendar.status, "pending"),
        lte(opsComplianceCalendar.dueDate, now)
      )
    )
    .orderBy(opsComplianceCalendar.dueDate)
    .all();
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard aggregate
// ─────────────────────────────────────────────────────────────────────────────

export function getFacilityDashboard(facilityNumber: string): {
  activeResidents: number;
  pendingMedPasses: number;
  overdueTasks: number;
  openIncidents: number;
  pendingLeads: number;
  overdueInvoices: number;
  overdueCompliance: number;
} {
  if (usingPostgres) {
    throw new Error("[opsStorage] getFacilityDashboard: not implemented for Postgres mode. See agents/05-blockers.md.");
  }

  const now = Date.now();
  const todayStart = (() => {
    const d = new Date();
    d.setUTCHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const todayEnd = todayStart + 86400000;

  const activeResidents =
    (
      sqlite!
        .prepare(
          `SELECT COUNT(*) as c FROM ops_residents WHERE facility_number = ? AND status = 'active'`
        )
        .get(facilityNumber) as { c: number }
    )?.c ?? 0;

  const pendingMedPasses =
    (
      sqlite!
        .prepare(
          `SELECT COUNT(*) as c FROM ops_med_passes WHERE facility_number = ? AND status = 'pending' AND scheduled_datetime >= ? AND scheduled_datetime < ?`
        )
        .get(facilityNumber, todayStart, todayEnd) as { c: number }
    )?.c ?? 0;

  const overdueTasks =
    (
      sqlite!
        .prepare(
          `SELECT COUNT(*) as c FROM ops_daily_tasks WHERE facility_number = ? AND status = 'pending' AND task_date < ?`
        )
        .get(facilityNumber, todayStart) as { c: number }
    )?.c ?? 0;

  const openIncidents =
    (
      sqlite!
        .prepare(
          `SELECT COUNT(*) as c FROM ops_incidents WHERE facility_number = ? AND status = 'open'`
        )
        .get(facilityNumber) as { c: number }
    )?.c ?? 0;

  const pendingLeads =
    (
      sqlite!
        .prepare(
          `SELECT COUNT(*) as c FROM ops_leads WHERE facility_number = ? AND stage NOT IN ('admitted', 'lost')`
        )
        .get(facilityNumber) as { c: number }
    )?.c ?? 0;

  const overdueInvoices =
    (
      sqlite!
        .prepare(
          `SELECT COUNT(*) as c FROM ops_invoices WHERE facility_number = ? AND status NOT IN ('paid', 'void') AND balance_due > 0 AND due_date < ?`
        )
        .get(facilityNumber, now) as { c: number }
    )?.c ?? 0;

  const overdueCompliance =
    (
      sqlite!
        .prepare(
          `SELECT COUNT(*) as c FROM ops_compliance_calendar WHERE facility_number = ? AND status = 'pending' AND due_date < ?`
        )
        .get(facilityNumber, now) as { c: number }
    )?.c ?? 0;

  return {
    activeResidents,
    pendingMedPasses,
    overdueTasks,
    openIncidents,
    pendingLeads,
    overdueInvoices,
    overdueCompliance,
  };
}
