import { eq, and, gte, lt, lte, desc, sql, or } from "drizzle-orm";
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
  opsStaffCredentials,
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
  type OpsStaffCredential,
  type InsertOpsStaffCredential,
} from "./opsSchema";
import {
  CREDENTIAL_TYPES,
  CREDENTIAL_STATUSES,
  ROLE_REQUIRED_CREDENTIALS,
  credentialSeverity,
  type CredentialType,
  type CredentialStatus,
} from "@shared/staff-credentials";
import {
  classifyIncidentSeverity,
  type IncidentSeverity,
} from "@shared/incident-types";
import { recordAudit } from "./auditStorage";
import { listEvidence } from "./evidenceStorage";
import { getRegSetting } from "./regSettings";

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

// Audit-trail helper shared across modules. Moved up here (above Module 1)
// so the legacy retrofit on Residents/eMAR/Admissions (Phase 4.2) can use
// the same try/catch wrapper as Wave 1–4 modules below. AuditActor matches
// the `AuditActor` interface exported by ./auditStorage (kept as a local
// alias to avoid an import-rename across the file).
interface AuditActor {
  id: string;
  role: string;
}

// Phase 3 audit-attribution helper. INSERT sites set both created_by and
// updated_by; UPDATE sites set only updated_by (created_by is preserved).
// Falls back to 'system' when no actor is passed (cron jobs, ETL, etc.).
function actorId(actor?: AuditActor | null): string {
  return actor?.id ?? "system";
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

export async function createResident(
  data: InsertOpsResident,
  actor?: AuditActor,
): Promise<OpsResident> {
  const now = Date.now();
  const by = actorId(actor);
  const rows = await db.insert(opsResidents).values({ ...data, createdAt: now, updatedAt: now, createdBy: by, updatedBy: by }).returning();
  const row = rows[0] as OpsResident;
  if (actor) {
    await safeAudit({
      facilityNumber: row.facilityNumber,
      actor,
      action: "create",
      entityType: "ops_resident",
      entityId: row.id,
      after: row,
    });
  }
  return row;
}

export async function updateResident(
  id: number,
  facilityNumber: string,
  data: Partial<InsertOpsResident>,
  actor?: AuditActor,
): Promise<OpsResident | undefined> {
  const before = await getResident(id, facilityNumber);
  if (!before) return undefined;
  const now = Date.now();
  const cond = and(eq(opsResidents.id, id), eq(opsResidents.facilityNumber, facilityNumber));
  const rows = await db.update(opsResidents).set({ ...data, updatedAt: now, updatedBy: actorId(actor) }).where(cond).returning();
  const after = rows[0] as OpsResident | undefined;
  if (after && actor) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "update",
      entityType: "ops_resident",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

export async function softDeleteResident(
  id: number,
  facilityNumber: string,
  actor?: AuditActor,
): Promise<boolean> {
  const before = await getResident(id, facilityNumber);
  if (!before) return false;
  const now = Date.now();
  const cond = and(eq(opsResidents.id, id), eq(opsResidents.facilityNumber, facilityNumber));
  const rows = await db.update(opsResidents).set({ status: "discharged", dischargeDate: now, updatedAt: now, updatedBy: actorId(actor) }).where(cond).returning({ id: opsResidents.id });
  const ok = rows.length > 0;
  if (ok && actor) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "delete",
      entityType: "ops_resident",
      entityId: id,
      before,
      after: { ...before, status: "discharged", dischargeDate: now, updatedAt: now },
    });
  }
  return ok;
}

// Assessments

export async function listAssessments(residentId: number, facilityNumber: string): Promise<OpsResidentAssessment[]> {
  const cond = and(eq(opsResidentAssessments.residentId, residentId), eq(opsResidentAssessments.facilityNumber, facilityNumber));
  return db.select().from(opsResidentAssessments).where(cond).orderBy(desc(opsResidentAssessments.assessedAt));
}

export async function createAssessment(data: InsertOpsResidentAssessment): Promise<OpsResidentAssessment> {
  const now = Date.now();
  // Phase 3: assessedBy carries the clinical-actor on insert; the audit-
  // attribution column createdBy/updatedBy is the same value when no
  // separate audit actor is threaded. updated_at maintained by trigger on
  // subsequent UPDATEs.
  const by = data.assessedBy || "system";
  const rows = await db.insert(opsResidentAssessments).values({
    ...data,
    createdAt: now,
    updatedAt: now,
    createdBy: by,
    updatedBy: by,
  }).returning();
  return rows[0] as OpsResidentAssessment;
}

export async function updateAssessment(id: number, data: Partial<InsertOpsResidentAssessment>): Promise<OpsResidentAssessment | undefined> {
  // updatedBy defaults to 'system' since this signature doesn't accept an
  // actor; updated_at is maintained by the DB trigger on UPDATE.
  const rows = await db.update(opsResidentAssessments).set({ ...data, updatedBy: "system" }).where(eq(opsResidentAssessments.id, id)).returning();
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
  // createdBy is already a content column on ops_care_plans (NOT NULL — the
  // clinician owning the plan). Phase 3 adds updatedBy; no separate audit
  // actor on this signature, so default to the createdBy value or 'system'.
  const by = data.createdBy || "system";
  const rows = await db.insert(opsCarePlans).values({ ...data, createdAt: now, updatedAt: now, updatedBy: by }).returning();
  return rows[0] as OpsCarePlan;
}

export async function updateCarePlan(id: number, data: Partial<InsertOpsCarePlan>): Promise<OpsCarePlan | undefined> {
  const now = Date.now();
  const rows = await db.update(opsCarePlans).set({ ...data, updatedAt: now, updatedBy: "system" }).where(eq(opsCarePlans.id, id)).returning();
  return rows[0] as OpsCarePlan | undefined;
}

export async function signCarePlan(id: number, signerType: "resident" | "family", signature: string): Promise<boolean> {
  const now = Date.now();
  const updateData = signerType === "resident"
    ? { digitalSignatureResident: signature, signatureDate: now, updatedAt: now, updatedBy: "system" }
    : { digitalSignatureFamily: signature, signatureDate: now, updatedAt: now, updatedBy: "system" };

  const rows = await db.update(opsCarePlans).set(updateData).where(eq(opsCarePlans.id, id)).returning({ id: opsCarePlans.id });
  return rows.length > 0;
}

// Daily Tasks

/**
 * List a resident's daily tasks within a half-open `[start, end)` time
 * window. Callers typically pass a single-day window (start = local
 * midnight, end = next midnight) so a wall-clock timestamp like
 * Date.now() reliably finds tasks whose `task_date` is the canonical
 * start-of-day epoch.
 *
 * Range semantics matter: the legacy implementation used `eq(task_date,
 * Date.now())` which never matched anything in practice because
 * createDailyTasksFromCarePlan() normalizes `task_date` to start-of-day
 * but the route passed a mid-day clock value. This is the resident
 * profile "Today's Tasks" empty-state bug from the May fix batch.
 */
export async function getDailyTasks(
  residentId: number,
  facilityNumber: string,
  taskDateStart: number,
  taskDateEnd: number,
  shift?: string,
): Promise<OpsDailyTask[]> {
  const base = and(
    eq(opsDailyTasks.residentId, residentId),
    eq(opsDailyTasks.facilityNumber, facilityNumber),
    gte(opsDailyTasks.taskDate, taskDateStart),
    lt(opsDailyTasks.taskDate, taskDateEnd),
  );
  const conditions = shift ? and(base, eq(opsDailyTasks.shift, shift)) : base;
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
  // updated_at is maintained by the DB trigger on UPDATE; updatedBy defaults
  // to 'system' here (no actor on this signature).
  const rows = await db.update(opsDailyTasks).set({ status: "completed", completionNotes: notes, completedAt, updatedBy: "system" }).where(eq(opsDailyTasks.id, id)).returning({ id: opsDailyTasks.id });
  return rows.length > 0;
}

export async function refuseTask(id: number, reason: string): Promise<boolean> {
  const rows = await db.update(opsDailyTasks).set({ status: "refused", refused: 1, refuseReason: reason, updatedBy: "system" }).where(eq(opsDailyTasks.id, id)).returning({ id: opsDailyTasks.id });
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
  // Phase 3: audit columns default to 'system' here (no actor threaded).
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
    updatedAt: now,
    createdBy: "system",
    updatedBy: "system",
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

  // Phase 3: audit columns default to 'system' for cron-style autogeneration.
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
    updatedAt: now,
    createdBy: "system",
    updatedBy: "system",
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

export async function createMedication(
  data: InsertOpsMedication,
  actor?: AuditActor,
): Promise<OpsMedication> {
  const now = Date.now();
  const by = actorId(actor);
  const rows = await db.insert(opsMedications).values({ ...data, createdAt: now, updatedAt: now, createdBy: by, updatedBy: by }).returning();
  const row = rows[0] as OpsMedication;
  if (actor) {
    await safeAudit({
      facilityNumber: row.facilityNumber,
      actor,
      action: "create",
      entityType: "ops_medication",
      entityId: row.id,
      after: row,
    });
  }
  return row;
}

export async function updateMedication(
  id: number,
  facilityNumber: string,
  data: Partial<InsertOpsMedication>,
  actor?: AuditActor,
): Promise<OpsMedication | undefined> {
  const before = await getMedication(id, facilityNumber);
  if (!before) return undefined;
  const now = Date.now();
  const cond = and(eq(opsMedications.id, id), eq(opsMedications.facilityNumber, facilityNumber));
  const rows = await db.update(opsMedications).set({ ...data, updatedAt: now, updatedBy: actorId(actor) }).where(cond).returning();
  const after = rows[0] as OpsMedication | undefined;
  if (after && actor) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "update",
      entityType: "ops_medication",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

export async function discontinueMedication(
  id: number,
  facilityNumber: string,
  reason: string,
  by: string,
  actor?: AuditActor,
): Promise<boolean> {
  const before = await getMedication(id, facilityNumber);
  if (!before) return false;
  const now = Date.now();
  const cond = and(eq(opsMedications.id, id), eq(opsMedications.facilityNumber, facilityNumber));
  const updateData = { status: "discontinued", discontinuedReason: reason, discontinuedBy: by, discontinuedAt: now, updatedAt: now, updatedBy: actorId(actor) };
  const discRows = await db.update(opsMedications).set(updateData).where(cond).returning({ id: opsMedications.id });
  const ok = discRows.length > 0;
  if (ok && actor) {
    // Terminal-state transition — use 'delete' to align with the existing
    // softDeleteResident / softDeleteDrillLog convention (resource-level
    // delete = soft-deactivation in this codebase).
    await safeAudit({
      facilityNumber,
      actor,
      action: "delete",
      entityType: "ops_medication",
      entityId: id,
      before,
      after: { ...before, ...updateData },
    });
  }
  return ok;
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
      // Phase 3: includes created_at/updated_at + created_by/updated_by audit
      // columns. This is a cron-style scheduler — no per-row actor, default
      // both to 'system'. The DB trigger maintains updated_at on subsequent
      // UPDATEs (e.g. when a caregiver records administration).
      const _nowMs = Date.now();
      await pool.query(
        `INSERT INTO ops_med_passes (medication_id, resident_id, facility_number, scheduled_datetime, status, created_at, updated_at, created_by, updated_by)
         VALUES ($1, $2, $3, $4, 'pending', $5, $5, 'system', 'system')
         ON CONFLICT (medication_id, scheduled_datetime) DO NOTHING`,
        [med.medication_id, med.resident_id, facilityNumber, scheduledDatetime, _nowMs]
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

export async function recordMedPass(
  data: InsertOpsMedPass,
  actor?: AuditActor,
): Promise<OpsMedPass> {
  const now = Date.now();
  const by = actorId(actor);
  const rows = await db.insert(opsMedPasses).values({ ...data, createdAt: now, updatedAt: now, createdBy: by, updatedBy: by }).returning();
  const row = rows[0] as OpsMedPass;
  if (actor) {
    await safeAudit({
      facilityNumber: row.facilityNumber,
      actor,
      action: "create",
      entityType: "ops_med_pass",
      entityId: row.id,
      after: row,
    });
  }
  return row;
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
  }>,
  actor?: AuditActor,
): Promise<boolean> {
  // Read the before-state so audit emits a useful diff + so we can scope
  // the facility_number on the audit row without relying on the caller.
  const beforeRows = await db
    .select()
    .from(opsMedPasses)
    .where(eq(opsMedPasses.id, id))
    .limit(1);
  const before = beforeRows[0] as OpsMedPass | undefined;
  if (!before) return false;
  const rows = await db.update(opsMedPasses).set({ ...data, updatedBy: actorId(actor) }).where(eq(opsMedPasses.id, id)).returning({ id: opsMedPasses.id });
  const ok = rows.length > 0;
  if (ok && actor) {
    await safeAudit({
      facilityNumber: before.facilityNumber,
      actor,
      action: "update",
      entityType: "ops_med_pass",
      entityId: id,
      before,
      after: { ...before, ...data },
    });
  }
  return ok;
}

export async function updatePrnFollowup(id: number, effectivenessNotes: string, notedAt: number): Promise<boolean> {
  const updateData = { prnEffectivenessNotes: effectivenessNotes, prnEffectivenessNotedAt: notedAt, updatedBy: "system" };
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
  toursScheduled: number;
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
  type TourRow = { date: string; tours: number };
  type BRow    = { date: string; due: number };
  type CRow    = { date: string; due: number };

  const pg = (col: string) => `TO_CHAR(TO_TIMESTAMP(${col}/1000.0),'YYYY-MM-DD')`;
  const [r1, r2, r3, r4, rTours, r5, r6] = await Promise.all([
    pool.query<MedRow>(`SELECT ${pg('scheduled_datetime')} AS date,COUNT(*)::int AS total,SUM(CASE WHEN status='given' THEN 1 ELSE 0 END)::int AS given,SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END)::int AS pending,SUM(CASE WHEN status='late' THEN 1 ELSE 0 END)::int AS late,SUM(CASE WHEN status='missed' THEN 1 ELSE 0 END)::int AS missed FROM ops_med_passes WHERE facility_number=$1 AND scheduled_datetime>=$2 AND scheduled_datetime<$3 GROUP BY 1`, [facilityNumber, fromMs, toMs]),
    pool.query<TaskRow>(`SELECT ${pg('task_date')} AS date,COUNT(*)::int AS total,SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)::int AS completed,SUM(CASE WHEN status='pending' AND task_date < $4 THEN 1 ELSE 0 END)::int AS overdue FROM ops_daily_tasks WHERE facility_number=$1 AND task_date>=$2 AND task_date<$3 GROUP BY 1`, [facilityNumber, fromMs, toMs, Date.now()]),
    pool.query<IncRow>(`SELECT ${pg('incident_date')} AS date,COUNT(*)::int AS total,SUM(CASE WHEN status='open' THEN 1 ELSE 0 END)::int AS open FROM ops_incidents WHERE facility_number=$1 AND incident_date>=$2 AND incident_date<$3 GROUP BY 1`, [facilityNumber, fromMs, toMs]),
    pool.query<LRow>(`SELECT ${pg('next_follow_up_date')} AS date,COUNT(*)::int AS followups FROM ops_leads WHERE facility_number=$1 AND next_follow_up_date IS NOT NULL AND next_follow_up_date>=$2 AND next_follow_up_date<$3 AND stage NOT IN ('admitted','lost') GROUP BY 1`, [facilityNumber, fromMs, toMs]),
    pool.query<TourRow>(`SELECT ${pg('scheduled_at')} AS date,COUNT(*)::int AS tours FROM ops_tours WHERE facility_number=$1 AND scheduled_at>=$2 AND scheduled_at<$3 GROUP BY 1`, [facilityNumber, fromMs, toMs]),
    pool.query<BRow>(`SELECT ${pg('due_date')} AS date,COUNT(*)::int AS due FROM ops_invoices WHERE facility_number=$1 AND due_date>=$2 AND due_date<$3 AND status NOT IN ('paid','void') AND balance_due>0 GROUP BY 1`, [facilityNumber, fromMs, toMs]),
    pool.query<CRow>(`SELECT ${pg('due_date')} AS date,COUNT(*)::int AS due FROM ops_compliance_calendar WHERE facility_number=$1 AND due_date>=$2 AND due_date<$3 AND status='pending' GROUP BY 1`, [facilityNumber, fromMs, toMs]),
  ]);

  const map = new Map<string, DayOpsEvent>();
  const get = (d: string): DayOpsEvent => {
    if (!map.has(d)) map.set(d, { date: d, medsTotal:0, medsGiven:0, medsPending:0, medsLate:0, medsMissed:0, tasksTotal:0, tasksCompleted:0, tasksOverdue:0, incidentsTotal:0, incidentsOpen:0, leadsFollowups:0, toursScheduled:0, billingDue:0, complianceDue:0 });
    return map.get(d)!;
  };
  for (const r of r1.rows) { const e = get(r.date); e.medsTotal=r.total; e.medsGiven=r.given; e.medsPending=r.pending; e.medsLate=r.late; e.medsMissed=r.missed; }
  for (const r of r2.rows) { const e = get(r.date); e.tasksTotal=r.total; e.tasksCompleted=r.completed; e.tasksOverdue=r.overdue; }
  for (const r of r3.rows) { const e = get(r.date); e.incidentsTotal=r.total; e.incidentsOpen=r.open; }
  for (const r of r4.rows) { get(r.date).leadsFollowups = r.followups; }
  for (const r of rTours.rows) { get(r.date).toursScheduled = r.tours; }
  for (const r of r5.rows) { get(r.date).billingDue = r.due; }
  for (const r of r6.rows) { get(r.date).complianceDue = r.due; }
  return Array.from(map.values()).sort((a, b) => a.date.localeCompare(b.date));
}

// Controlled substances

export async function recordControlledSubCount(data: InsertOpsControlledSubCount): Promise<OpsControlledSubCount> {
  const now = Date.now();
  // Insert-only table; createdBy backfills from countedBy (the content actor).
  const rows = await db.insert(opsControlledSubCounts).values({ ...data, createdAt: now, createdBy: data.countedBy || "system" }).returning();
  return rows[0] as OpsControlledSubCount;
}

export async function recordMedDestruction(data: InsertOpsMedDestruction): Promise<OpsMedDestruction> {
  const now = Date.now();
  // Insert-only table; createdBy backfills from destroyedBy.
  const rows = await db.insert(opsMedDestruction).values({ ...data, createdAt: now, createdBy: data.destroyedBy || "system" }).returning();
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

/**
 * Wave 2 W4 — classify event severity from incident_type + flags. Pure
 * pass-through to the shared catalogue so the server is the single source of
 * truth (never accept event_severity from the wire). Returns 'serious' |
 * 'non_emergent'.
 */
function deriveEventSeverity(
  incidentType: string,
  injuryInvolvedFlag?: number | null,
  hospitalizationFlag?: number | null,
): IncidentSeverity {
  return classifyIncidentSeverity(incidentType, {
    injuryInvolved: (injuryInvolvedFlag ?? 0) === 1,
    hospitalizationRequired: (hospitalizationFlag ?? 0) === 1,
  });
}

export async function createIncident(data: InsertOpsIncident): Promise<OpsIncident> {
  const now = Date.now();
  // W4: derive event_severity server-side; never trust the client. The
  // shared classifier is the only writer of this column.
  const eventSeverity = deriveEventSeverity(
    data.incidentType,
    data.injuryInvolved as number | null | undefined,
    data.hospitalizationRequired as number | null | undefined,
  );
  // Phase 3: reportedBy is the content actor on incidents; backfill the audit
  // columns from it so the row carries a useful attribution. The trigger
  // maintains updated_at on subsequent UPDATEs.
  const by = data.reportedBy || "system";
  const rows = await db
    .insert(opsIncidents)
    .values({ ...data, eventSeverity, createdAt: now, updatedAt: now, createdBy: by, updatedBy: by })
    .returning();
  return rows[0] as OpsIncident;
}

export async function updateIncident(id: number, facilityNumber: string, data: Partial<InsertOpsIncident>): Promise<OpsIncident | undefined> {
  const now = Date.now();
  const cond = and(eq(opsIncidents.id, id), eq(opsIncidents.facilityNumber, facilityNumber));

  // W4: re-classify event_severity if any of the inputs to the classifier
  // change. The set of triggering fields is (incident_type, injury_involved,
  // hospitalization_required); narrow to a single SELECT only when needed.
  const needsReclassify =
    data.incidentType !== undefined ||
    data.injuryInvolved !== undefined ||
    data.hospitalizationRequired !== undefined;

  // Strip any client-supplied event_severity — server-derived only.
  const { eventSeverity: _ignored, ...safeData } = data as Partial<InsertOpsIncident> & {
    eventSeverity?: unknown;
  };

  let nextEventSeverity: IncidentSeverity | undefined;
  if (needsReclassify) {
    const before = await pgFirst(
      db
        .select({
          incidentType: opsIncidents.incidentType,
          injuryInvolved: opsIncidents.injuryInvolved,
          hospitalizationRequired: opsIncidents.hospitalizationRequired,
        })
        .from(opsIncidents)
        .where(cond),
    );
    if (!before) return undefined;
    nextEventSeverity = deriveEventSeverity(
      data.incidentType ?? before.incidentType,
      (data.injuryInvolved as number | null | undefined) ?? before.injuryInvolved,
      (data.hospitalizationRequired as number | null | undefined) ?? before.hospitalizationRequired,
    );
  }

  const rows = await db
    .update(opsIncidents)
    .set({
      ...safeData,
      ...(nextEventSeverity !== undefined ? { eventSeverity: nextEventSeverity } : {}),
      updatedAt: now,
      // Phase 3: no actor on this signature; default 'system'. The closeIncident /
      // reopenIncident paths (which DO take an actor) set updatedBy from
      // actor.id — see those handlers below.
      updatedBy: "system",
    })
    .where(cond)
    .returning();
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
  // No actor on this signature; default audit columns to 'system'.
  const rows = await db.insert(opsLeads).values({ ...data, createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }).returning();
  return rows[0] as OpsLead;
}

export async function updateLead(id: number, facilityNumber: string, data: Partial<InsertOpsLead>): Promise<OpsLead | undefined> {
  const now = Date.now();
  const cond = and(eq(opsLeads.id, id), eq(opsLeads.facilityNumber, facilityNumber));
  const rows = await db.update(opsLeads).set({ ...data, updatedAt: now, updatedBy: "system" }).where(cond).returning();
  return rows[0] as OpsLead | undefined;
}

export async function scheduleTour(data: InsertOpsTour): Promise<OpsTour> {
  const now = Date.now();
  const rows = await db.insert(opsTours).values({ ...data, createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }).returning();
  return rows[0] as OpsTour;
}

export async function updateTour(id: number, data: Partial<InsertOpsTour>): Promise<OpsTour | undefined> {
  const rows = await db.update(opsTours).set({ ...data, updatedBy: "system" }).where(eq(opsTours.id, id)).returning();
  return rows[0] as OpsTour | undefined;
}

export async function startAdmission(
  data: InsertOpsAdmission,
  actor?: AuditActor,
): Promise<OpsAdmission> {
  const now = Date.now();
  const by = actorId(actor);
  const rows = await db.insert(opsAdmissions).values({ ...data, createdAt: now, updatedAt: now, createdBy: by, updatedBy: by }).returning();
  const row = rows[0] as OpsAdmission;
  if (actor) {
    await safeAudit({
      facilityNumber: row.facilityNumber,
      actor,
      action: "create",
      entityType: "ops_admission",
      entityId: row.id,
      after: row,
    });
  }
  return row;
}

export async function updateAdmissionLicForm(
  admissionId: number,
  form: string,
  completed: boolean,
  actor?: AuditActor,
): Promise<boolean> {
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

  // Read before-state so the audit row carries the LIC flip diff (critical
  // because each flip moves the chart-completeness score for this resident).
  const beforeRes = await pool.query<Record<string, unknown>>(
    `SELECT * FROM ops_admissions WHERE id = $1`,
    [admissionId],
  );
  const before = beforeRes.rows[0];
  if (!before) return false;

  const now = Date.now();
  const result = await pool.query(
    `UPDATE ops_admissions SET ${mapping.completedCol} = $1, ${mapping.dateCol} = $2, updated_at = $3, updated_by = $4 WHERE id = $5`,
    [completed ? 1 : 0, completed ? now : null, now, actorId(actor), admissionId]
  );
  const ok = (result.rowCount ?? 0) > 0;
  if (ok && actor) {
    const facilityNumber = String(before.facility_number ?? "");
    if (facilityNumber) {
      await safeAudit({
        facilityNumber,
        actor,
        action: "update",
        entityType: "ops_admission",
        entityId: admissionId,
        before: { [mapping.completedCol]: before[mapping.completedCol], [mapping.dateCol]: before[mapping.dateCol] },
        after: { form, completed, [mapping.completedCol]: completed ? 1 : 0, [mapping.dateCol]: completed ? now : null },
      });
    }
  }
  return ok;
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
    // Phase 3: convert path is system-driven (no actor threaded through).
    createdBy: "system",
    updatedBy: "system",
  };

  const resRows = await db.insert(opsResidents).values(residentData).returning();
  const resident = resRows[0] as OpsResident;
  await db.update(opsAdmissions).set({ residentId: resident.id, updatedAt: now, updatedBy: "system" }).where(eq(opsAdmissions.id, admissionId));

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
  const rows = await db.insert(opsBillingCharges).values({ ...data, createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }).returning();
  return rows[0] as OpsBillingCharge;
}

export async function deleteCharge(id: number, facilityNumber: string): Promise<boolean> {
  const cond = and(eq(opsBillingCharges.id, id), eq(opsBillingCharges.facilityNumber, facilityNumber));
  const rows = await db.delete(opsBillingCharges).where(cond).returning({ id: opsBillingCharges.id });
  return rows.length > 0;
}

export async function generateInvoice(facilityNumber: string, residentId: number, periodStart: number, periodEnd: number): Promise<OpsInvoice> {
  // amount is BIGINT cents; quantity is DOUBLE PRECISION (fractional units).
  // ROUND to a single integer cent total so the BIGINT invoice columns
  // never see a fractional value. Storage stays in cents end-to-end —
  // dollars conversion happens at the route boundary (server/lib/money.ts).
  const chargesResult = await pool.query<{ subtotal_cents: string }>(
    `SELECT COALESCE(ROUND(SUM(amount * quantity))::BIGINT, 0)::TEXT AS subtotal_cents
     FROM ops_billing_charges
     WHERE facility_number = $1 AND resident_id = $2
       AND (
         (billing_period_start >= $3 AND billing_period_start <= $4)
         OR (billing_period_end >= $3 AND billing_period_end <= $4)
         OR (billing_period_start IS NULL)
       )`,
    [facilityNumber, residentId, periodStart, periodEnd]
  );
  const subtotalCents = Number(chargesResult.rows[0]?.subtotal_cents ?? "0");

  const taxCents = 0;
  const totalCents = subtotalCents + taxCents;
  const now = Date.now();
  const dueDate = now + 30 * 86400000;

  const invoiceData = {
    facilityNumber,
    residentId,
    invoiceNumber: `INV-${facilityNumber}-${now}`,
    billingPeriodStart: periodStart,
    billingPeriodEnd: periodEnd,
    subtotal:   subtotalCents,
    tax:        taxCents,
    total:      totalCents,
    amountPaid: 0,
    balanceDue: totalCents,
    status: "draft" as const,
    dueDate,
    createdAt: now,
    updatedAt: now,
    // Phase 3: generated by the billing engine, not a user action.
    createdBy: "system",
    updatedBy: "system",
  };

  const rows = await db.insert(opsInvoices).values(invoiceData).returning();
  return rows[0] as OpsInvoice;
}

export async function getInvoice(id: number): Promise<OpsInvoice | undefined> {
  return pgFirst(db.select().from(opsInvoices).where(eq(opsInvoices.id, id)));
}

export async function markInvoiceSent(id: number): Promise<boolean> {
  const now = Date.now();
  const rows = await db.update(opsInvoices).set({ status: "sent", sentAt: now, updatedAt: now, updatedBy: "system" }).where(eq(opsInvoices.id, id)).returning({ id: opsInvoices.id });
  return rows.length > 0;
}

export async function recordPayment(data: InsertOpsPayment): Promise<OpsPayment> {
  // All amounts are integer cents (BIGINT). Adding two BIGINT cents stays
  // an integer; no rounding needed. Storage never converts to/from dollars
  // — that happens in opsRouter at the request/response boundary.
  const now = Date.now();
  // Phase 3: recordedBy is the content actor; reuse it as the audit
  // attribution column. Trigger maintains updated_at on UPDATE.
  const by = data.recordedBy || "system";
  const payRows = await db.insert(opsPayments).values({ ...data, createdAt: now, updatedAt: now, createdBy: by, updatedBy: by }).returning();
  const payment = payRows[0] as OpsPayment;

  const invRows = await db.select().from(opsInvoices).where(eq(opsInvoices.id, data.invoiceId));
  const invoice = invRows[0] as OpsInvoice | undefined;
  if (invoice) {
    const newAmountPaidCents = (invoice.amountPaid ?? 0) + data.amount;
    const newBalanceDueCents = Math.max(0, (invoice.total ?? 0) - newAmountPaidCents);
    const newStatus = newBalanceDueCents <= 0 ? "paid" : invoice.status === "draft" ? "sent" : invoice.status;
    await db.update(opsInvoices)
      .set({
        amountPaid: newAmountPaidCents,
        balanceDue: newBalanceDueCents,
        status:     newStatus,
        paidAt:     newBalanceDueCents <= 0 ? now : invoice.paidAt,
        updatedAt:  now,
        updatedBy:  by,
      })
      .where(eq(opsInvoices.id, data.invoiceId));
  }

  return payment;
}

export async function getArAging(facilityNumber: string): Promise<{
  current: number; days_30: number; days_60: number; days_90: number; over_90: number;
}> {
  // Returns integer cents. Conversion to dollars happens in opsRouter.
  // SUMs of BIGINT cents stay integer; pg numeric BIGINT is parsed to
  // JS number via the global types.setTypeParser(20, ...) in db/index.ts.
  const now = Date.now();
  const d30 = now - 30 * 86400000;
  const d60 = now - 60 * 86400000;
  const d90 = now - 90 * 86400000;

  const result = await pool.query<{
    current_amt: string | null; days_30_amt: string | null; days_60_amt: string | null; days_90_amt: string | null; over_90_amt: string | null;
  }>(
    `SELECT
       COALESCE(SUM(CASE WHEN due_date >= $1 THEN balance_due ELSE 0 END), 0)::TEXT as current_amt,
       COALESCE(SUM(CASE WHEN due_date >= $2 AND due_date < $1 THEN balance_due ELSE 0 END), 0)::TEXT as days_30_amt,
       COALESCE(SUM(CASE WHEN due_date >= $3 AND due_date < $2 THEN balance_due ELSE 0 END), 0)::TEXT as days_60_amt,
       COALESCE(SUM(CASE WHEN due_date >= $4 AND due_date < $3 THEN balance_due ELSE 0 END), 0)::TEXT as days_90_amt,
       COALESCE(SUM(CASE WHEN due_date < $4 THEN balance_due ELSE 0 END), 0)::TEXT as over_90_amt
     FROM ops_invoices
     WHERE facility_number = $5 AND status NOT IN ('paid', 'void') AND balance_due > 0`,
    [now, d30, d60, d90, facilityNumber]
  );
  const r = result.rows[0];
  return {
    current: Number(r?.current_amt ?? "0"),
    days_30: Number(r?.days_30_amt ?? "0"),
    days_60: Number(r?.days_60_amt ?? "0"),
    days_90: Number(r?.days_90_amt ?? "0"),
    over_90: Number(r?.over_90_amt ?? "0"),
  };
}

export async function getBillingSummary(
  facilityNumber: string,
  periodStart: number,
  periodEnd: number
): Promise<{ total_billed: number; total_paid: number; total_outstanding: number }> {
  // Returns integer cents. Conversion to dollars happens in opsRouter.
  const result = await pool.query<{ total_billed: string; total_paid: string; total_outstanding: string }>(
    `SELECT
       COALESCE(SUM(total),       0)::TEXT as total_billed,
       COALESCE(SUM(amount_paid), 0)::TEXT as total_paid,
       COALESCE(SUM(balance_due), 0)::TEXT as total_outstanding
     FROM ops_invoices
     WHERE facility_number = $1
       AND billing_period_start >= $2
       AND billing_period_end <= $3`,
    [facilityNumber, periodStart, periodEnd]
  );
  const r = result.rows[0];
  return {
    total_billed:      Number(r?.total_billed ?? "0"),
    total_paid:        Number(r?.total_paid ?? "0"),
    total_outstanding: Number(r?.total_outstanding ?? "0"),
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
  const rows = await db.insert(opsStaff).values({ ...data, createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }).returning();
  return rows[0] as OpsStaffMember;
}

export async function updateStaff(id: number, facilityNumber: string, data: Partial<InsertOpsStaffMember>): Promise<OpsStaffMember | undefined> {
  const now = Date.now();
  const cond = and(eq(opsStaff.id, id), eq(opsStaff.facilityNumber, facilityNumber));
  const rows = await db.update(opsStaff).set({ ...data, updatedAt: now, updatedBy: "system" }).where(cond).returning();
  return rows[0] as OpsStaffMember | undefined;
}

export async function deactivateStaff(id: number, facilityNumber: string): Promise<boolean> {
  const now = Date.now();
  const cond = and(eq(opsStaff.id, id), eq(opsStaff.facilityNumber, facilityNumber));
  const rows = await db.update(opsStaff).set({ status: "inactive", terminationDate: now, updatedAt: now, updatedBy: "system" }).where(cond).returning({ id: opsStaff.id });
  return rows.length > 0;
}

// Shift rows joined with the staff member's name so the weekly grid can
// render the chip label in one network round-trip. The FE expects
// `staffName` on each row (StaffContent.tsx `interface Shift`); without
// the join every chip rendered as an empty bar.
export async function listShifts(
  facilityNumber: string,
  weekStart: number,
): Promise<Array<OpsShift & { staffName: string }>> {
  const weekEnd = weekStart + 7 * 86400000;
  const result = await pool.query<{
    id: number;
    facility_number: string;
    staff_id: number;
    shift_date: number;
    shift_type: string;
    start_time: string;
    end_time: string;
    is_overtime: number | null;
    status: string;
    covered_by_id: number | null;
    notes: string | null;
    created_at: number;
    updated_at: number | null;
    created_by: string | null;
    updated_by: string | null;
    staff_name: string;
  }>(
    `SELECT s.id, s.facility_number, s.staff_id, s.shift_date, s.shift_type,
            s.start_time, s.end_time, s.is_overtime, s.status, s.covered_by_id,
            s.notes, s.created_at, s.updated_at, s.created_by, s.updated_by,
            COALESCE(NULLIF(TRIM(st.first_name || ' ' || st.last_name), ''), 'Unknown') AS staff_name
       FROM ops_shifts s
       LEFT JOIN ops_staff st ON st.id = s.staff_id
      WHERE s.facility_number = $1
        AND s.shift_date >= $2
        AND s.shift_date <= $3
      ORDER BY s.shift_date ASC`,
    [facilityNumber, weekStart, weekEnd],
  );
  return result.rows.map((r) => ({
    id: r.id,
    facilityNumber: r.facility_number,
    staffId: r.staff_id,
    shiftDate: r.shift_date,
    shiftType: r.shift_type,
    startTime: r.start_time,
    endTime: r.end_time,
    isOvertime: r.is_overtime,
    status: r.status,
    coveredById: r.covered_by_id,
    notes: r.notes,
    createdAt: r.created_at,
    // Phase 3 audit columns surfaced for downstream consumers; the underlying
    // row never reads/writes them, the DB DEFAULT 'system' fills them on insert.
    updatedAt: r.updated_at,
    createdBy: r.created_by,
    updatedBy: r.updated_by,
    staffName: r.staff_name,
  }));
}

export async function createShift(data: InsertOpsShift): Promise<OpsShift> {
  const now = Date.now();
  const rows = await db.insert(opsShifts).values({ ...data, createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }).returning();
  return rows[0] as OpsShift;
}

export async function deleteShift(id: number, facilityNumber: string): Promise<boolean> {
  const cond = and(eq(opsShifts.id, id), eq(opsShifts.facilityNumber, facilityNumber));
  const rows = await db.delete(opsShifts).where(cond).returning({ id: opsShifts.id });
  return rows.length > 0;
}

export async function updateShift(id: number, data: Partial<InsertOpsShift>): Promise<OpsShift | undefined> {
  const rows = await db.update(opsShifts).set({ ...data, updatedBy: "system" }).where(eq(opsShifts.id, id)).returning();
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
  const rows = await db.insert(opsComplianceCalendar).values({ ...data, createdAt: now, updatedAt: now, createdBy: "system", updatedBy: "system" }).returning();
  return rows[0] as OpsComplianceItem;
}

export async function completeComplianceItem(id: number, facilityNumber: string, completedDate: number): Promise<boolean> {
  const cond = and(eq(opsComplianceCalendar.id, id), eq(opsComplianceCalendar.facilityNumber, facilityNumber));
  const rows = await db.update(opsComplianceCalendar).set({ status: "completed", completedDate, updatedBy: "system" }).where(cond).returning({ id: opsComplianceCalendar.id });
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
  todaysOpenTasks: number;
  openIncidents: number;
  pendingLeads: number;
  overdueInvoices: number;
  overdueCompliance: number;
}> {
  const now = Date.now();
  const todayStart = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime(); })();
  const todayEnd = todayStart + 86400000;

  // todaysOpenTasks: pending tasks whose task_date falls in today's window.
  // overdueTasks (legacy) counts only tasks whose task_date is strictly
  // before today — a task dated today isn't overdue, but it IS open work
  // the operator should see in the sidebar badge. Splitting the two
  // surfaces the right semantic for each: the Tasks-sub-view counter
  // (today's work) vs the overdue alert chip (truly late).
  const [r1, r2, r3, r3b, r4, r5, r6, r7] = await Promise.all([
    pool.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_residents WHERE facility_number = $1 AND status = 'active'`, [facilityNumber]),
    pool.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_med_passes WHERE facility_number = $1 AND status = 'pending' AND scheduled_datetime >= $2 AND scheduled_datetime < $3`, [facilityNumber, todayStart, todayEnd]),
    pool.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_daily_tasks WHERE facility_number = $1 AND status = 'pending' AND task_date < $2`, [facilityNumber, todayStart]),
    pool.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_daily_tasks WHERE facility_number = $1 AND status = 'pending' AND task_date >= $2 AND task_date < $3`, [facilityNumber, todayStart, todayEnd]),
    pool.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_incidents WHERE facility_number = $1 AND status = 'open'`, [facilityNumber]),
    pool.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_leads WHERE facility_number = $1 AND stage NOT IN ('admitted', 'lost')`, [facilityNumber]),
    pool.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_invoices WHERE facility_number = $1 AND status NOT IN ('paid', 'void') AND balance_due > 0 AND due_date < $2`, [facilityNumber, now]),
    pool.query<{ c: number }>(`SELECT COUNT(*)::int as c FROM ops_compliance_calendar WHERE facility_number = $1 AND status = 'pending' AND due_date < $2`, [facilityNumber, now]),
  ]);
  return {
    activeResidents:   r1.rows[0]?.c ?? 0,
    pendingMedPasses:  r2.rows[0]?.c ?? 0,
    overdueTasks:      r3.rows[0]?.c ?? 0,
    todaysOpenTasks:   r3b.rows[0]?.c ?? 0,
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

// AuditActor + safeAudit are defined above (near pgFirst) so the legacy
// retrofit on Residents/eMAR/Admissions can share the same wrapper as the
// Wave 1+ modules below.

// JSON column helpers — Phase 2 R2: the underlying columns are JSONB now,
// so the write side passes the array straight through to Drizzle (which
// JSON-encodes for JSONB) and the read side just normalises to an array.
// `parseJsonArray` retains the legacy text-row fallback path so a row
// written before the conversion completes does not throw.
function jsonArrayPassthrough<T = unknown>(v: unknown): T[] | null {
  if (v === undefined || v === null) return null;
  return Array.isArray(v) ? (v as T[]) : [];
}

function parseJsonArray<T = unknown>(value: unknown): T[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) return value as T[];
  if (typeof value === "string" && value.length > 0) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? (parsed as T[]) : [];
    } catch {
      return [];
    }
  }
  return [];
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
  const by = actorId(actor);
  const rows = await db
    .insert(opsTemperatureFixtures)
    .values({ ...data, createdAt: now, updatedAt: now, createdBy: by, updatedBy: by })
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
    .set({ ...data, updatedAt: now, updatedBy: actorId(actor) })
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
    .set({ status: "inactive", updatedAt: now, updatedBy: actorId(actor) })
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
  const by = actorId(actor);
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
      updatedAt: now,
      createdBy: by,
      updatedBy: by,
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
      updatedBy: actorId(actor),
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

// Strip the raw JSONB columns from the wire shape and replace with decoded
// arrays. Phase 2 R2 flipped these from TEXT (stringified JSON) to JSONB
// (arrays at rest). Leaving the *Json keys on the wire would leak raw arrays
// under names the FE types as `string | null` — confusing every consumer.
// The FE only ever needed the decoded `participants` / `residentsInvolved` /
// `correctiveActions` shape, so this drops the *Json keys entirely.
function rowToDrillLog(row: OpsDrillLog): Omit<
  OpsDrillLog,
  "participantsJson" | "residentsInvolvedJson" | "correctiveActionsJson"
> & {
  participants: string[];
  residentsInvolved: string[];
  correctiveActions: string[];
} {
  const {
    participantsJson,
    residentsInvolvedJson,
    correctiveActionsJson,
    ...rest
  } = row;
  return {
    ...rest,
    participants: parseJsonArray<string>(participantsJson),
    residentsInvolved: parseJsonArray<string>(residentsInvolvedJson),
    correctiveActions: parseJsonArray<string>(correctiveActionsJson),
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
      participantsJson: jsonArrayPassthrough(input.participants),
      residentsInvolvedJson: jsonArrayPassthrough(input.residentsInvolved),
      evacuationSeconds: input.evacuationSeconds ?? null,
      debriefNotes: input.debriefNotes ?? null,
      correctiveActionsJson: jsonArrayPassthrough(input.correctiveActions),
      status: input.status ?? "executed",
      createdBy: input.createdBy,
      createdAt: now,
      updatedAt: now,
      // Phase 3: createdBy is already a content column (the staff member who
      // ran the drill); updatedBy tracks the audit actor on subsequent edits.
      updatedBy: actorId(actor),
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
  const updateSet: Record<string, unknown> = { updatedAt: now, updatedBy: actorId(actor) };
  if (data.drillKind !== undefined) updateSet.drillKind = data.drillKind;
  if (data.scenario !== undefined) updateSet.scenario = data.scenario;
  if (data.shift !== undefined) updateSet.shift = data.shift;
  if (data.executedAt !== undefined) updateSet.executedAt = data.executedAt;
  if (data.leader !== undefined) updateSet.leader = data.leader;
  if (data.participants !== undefined) updateSet.participantsJson = jsonArrayPassthrough(data.participants);
  if (data.residentsInvolved !== undefined) updateSet.residentsInvolvedJson = jsonArrayPassthrough(data.residentsInvolved);
  if (data.evacuationSeconds !== undefined) updateSet.evacuationSeconds = data.evacuationSeconds;
  if (data.debriefNotes !== undefined) updateSet.debriefNotes = data.debriefNotes;
  if (data.correctiveActions !== undefined) updateSet.correctiveActionsJson = jsonArrayPassthrough(data.correctiveActions);
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
    .set({ status: "deleted", updatedAt: now, updatedBy: actorId(actor) })
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
  const by = actorId(actor);
  const rows = await db
    .insert(opsVendors)
    .values({ ...data, createdAt: now, updatedAt: now, createdBy: by, updatedBy: by })
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
    .set({ ...data, updatedAt: now, updatedBy: actorId(actor) })
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
    .set({ status: "archived", updatedAt: now, updatedBy: actorId(actor) })
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
  // Phase 3: createdBy is already a content column on ops_complaints (NOT NULL).
  // The audit-attribution updatedBy mirrors actor; createdBy keeps whatever the
  // caller supplied (the staff member receiving the complaint).
  const rows = await db
    .insert(opsComplaints)
    .values({
      ...data,
      complainantName: data.complainantName?.trim() || null,
      complainantRelation: data.complainantRelation?.trim() || null,
      status: data.status ?? "open",
      createdAt: now,
      updatedAt: now,
      updatedBy: actorId(actor),
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
    .set({ ...data, updatedAt: now, updatedBy: actorId(actor) })
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
      // Phase 3: standardized audit columns. createdAt mirrors notedAt;
      // createdBy mirrors notedBy. Append-only — no updated_*.
      createdAt: now,
      createdBy: actor.id,
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
      .set({ updatedAt: now, updatedBy: actor.id })
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
      updatedBy: actorId(actor),
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
    .set({ status: "closed", closedAt: now, updatedAt: now, updatedBy: actorId(actor) })
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
  // createdBy on ops_inspections is already NOT NULL — caller supplies it.
  // updatedBy is the new audit-attribution column.
  const rows = await db
    .insert(opsInspections)
    .values({ ...data, createdAt: now, updatedAt: now, updatedBy: actorId(actor) })
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
    .set({ ...data, updatedAt: now, updatedBy: actorId(actor) })
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
    .set({ status: "closed", closedAt: now, updatedAt: now, updatedBy: actorId(actor) })
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
  const by = actorId(actor);
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
      createdBy: by,
      updatedBy: by,
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
      updatedBy: actorId(actor),
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

  // ops_controlled_sub_counts is treated as insert-only at the application
  // contract layer (Phase 3 — corrections via a new row in a future refactor).
  // This single legacy UPDATE site stays, and intentionally does NOT touch
  // updated_at / updated_by (those columns aren't on this table — no trigger).
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

// ─────────────────────────────────────────────────────────────────────────────
// Module 8 — Staff Credentials (Wave 2, Epic C — W3)
//
// One row per credential per staff member; replaces the narrow
// `ops_staff.license_expiry` column for the per-credential matrix. Pattern
// reuses Module 7: module-level async functions, shared `db` + `pool`,
// Drizzle for typed CRUD, mandatory tenant filter on every query, soft-
// delete via `deleted_at IS NULL`, and `safeAudit()` wrapping every
// mutation. Source-of-truth for credential type enum and per-role required
// matrix is `shared/staff-credentials.ts`.
// ─────────────────────────────────────────────────────────────────────────────

const CREDENTIAL_TYPE_SET = new Set<string>(CREDENTIAL_TYPES);
const CREDENTIAL_STATUS_SET = new Set<string>(CREDENTIAL_STATUSES);

function assertCredentialType(t: string): void {
  if (!CREDENTIAL_TYPE_SET.has(t)) {
    throw new Error(`Invalid credential_type: ${t}`);
  }
}

function assertCredentialStatus(s: string): void {
  if (!CREDENTIAL_STATUS_SET.has(s)) {
    throw new Error(`Invalid credential status: ${s}`);
  }
}

export async function listStaffCredentials(
  facilityNumber: string,
  opts: {
    staffId?: number;
    credentialType?: CredentialType;
    status?: CredentialStatus;
    page: number;
    limit: number;
  },
): Promise<{ rows: OpsStaffCredential[]; total: number }> {
  const conds = [
    eq(opsStaffCredentials.facilityNumber, facilityNumber),
    sql`${opsStaffCredentials.deletedAt} IS NULL`,
  ];
  if (typeof opts.staffId === "number") {
    conds.push(eq(opsStaffCredentials.staffId, opts.staffId));
  }
  if (opts.credentialType) {
    conds.push(eq(opsStaffCredentials.credentialType, opts.credentialType));
  }
  if (opts.status) {
    conds.push(eq(opsStaffCredentials.status, opts.status));
  }
  const where = and(...conds);
  const offset = (opts.page - 1) * opts.limit;
  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(opsStaffCredentials)
      .where(where)
      // Most-relevant first: soonest expiry, then most-recently-updated. Rows
      // with NULL `expires_at` (non-expiring) sort last so the "what's about
      // to bite me" lives at the top of the list.
      .orderBy(
        sql`${opsStaffCredentials.expiresAt} IS NULL`,
        opsStaffCredentials.expiresAt,
        desc(opsStaffCredentials.updatedAt),
      )
      .limit(opts.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsStaffCredentials)
      .where(where),
  ]);
  return { rows, total: countRows[0]?.count ?? 0 };
}

export async function getStaffCredential(
  id: number,
  facilityNumber: string,
): Promise<OpsStaffCredential | undefined> {
  return pgFirst(
    db
      .select()
      .from(opsStaffCredentials)
      .where(
        and(
          eq(opsStaffCredentials.id, id),
          eq(opsStaffCredentials.facilityNumber, facilityNumber),
          sql`${opsStaffCredentials.deletedAt} IS NULL`,
        ),
      ),
  );
}

export async function createStaffCredential(
  data: InsertOpsStaffCredential,
  actor: AuditActor,
): Promise<OpsStaffCredential> {
  assertCredentialType(data.credentialType);
  if (data.status !== undefined) assertCredentialStatus(data.status);
  const now = Date.now();
  // createdBy on ops_staff_credentials is already NOT NULL (caller supplies).
  // updatedBy is the new audit-attribution column.
  const rows = await db
    .insert(opsStaffCredentials)
    .values({
      ...data,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
      updatedBy: actorId(actor),
    })
    .returning();
  const row = rows[0] as OpsStaffCredential;
  await safeAudit({
    facilityNumber: row.facilityNumber,
    actor,
    action: "create",
    entityType: "ops_staff_credential",
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateStaffCredential(
  id: number,
  facilityNumber: string,
  data: Partial<InsertOpsStaffCredential>,
  actor: AuditActor,
): Promise<OpsStaffCredential | undefined> {
  const before = await getStaffCredential(id, facilityNumber);
  if (!before) return undefined;
  if (data.credentialType !== undefined) assertCredentialType(data.credentialType);
  if (data.status !== undefined) assertCredentialStatus(data.status);
  const now = Date.now();
  const rows = await db
    .update(opsStaffCredentials)
    .set({ ...data, updatedAt: now, updatedBy: actorId(actor) })
    .where(
      and(
        eq(opsStaffCredentials.id, id),
        eq(opsStaffCredentials.facilityNumber, facilityNumber),
        sql`${opsStaffCredentials.deletedAt} IS NULL`,
      ),
    )
    .returning();
  const after = rows[0] as OpsStaffCredential | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "update",
      entityType: "ops_staff_credential",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

export async function softDeleteStaffCredential(
  id: number,
  facilityNumber: string,
  actor: AuditActor,
): Promise<boolean> {
  const before = await getStaffCredential(id, facilityNumber);
  if (!before) return false;
  const now = Date.now();
  const rows = await db
    .update(opsStaffCredentials)
    .set({ deletedAt: now, updatedAt: now, updatedBy: actorId(actor) })
    .where(
      and(
        eq(opsStaffCredentials.id, id),
        eq(opsStaffCredentials.facilityNumber, facilityNumber),
        sql`${opsStaffCredentials.deletedAt} IS NULL`,
      ),
    )
    .returning({ id: opsStaffCredentials.id });
  if (rows.length > 0) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "delete",
      entityType: "ops_staff_credential",
      entityId: id,
      before,
      after: { ...before, deletedAt: now },
    });
  }
  return rows.length > 0;
}

/**
 * Surfaces credentials whose expiry falls within `withinDays` of now.
 * - Excludes rows with `expires_at IS NULL` (non-expiring credentials —
 *   e.g. fingerprint clearance via DOJ subsequent-notification).
 * - Excludes already-expired rows by default; pass `includeExpired: true`
 *   to surface them too (the daily-triage screen wants them mixed in).
 * - Soft-deleted rows are always excluded.
 * - Joined with `ops_staff` so the FE can render "Jane Doe (Med Tech) — CPR
 *   expires Mar 15" without a follow-up fetch. LEFT JOIN guards against
 *   stale rows that reference a deleted staff member (legacy data).
 */
export async function listExpiringCredentials(
  facilityNumber: string,
  opts: { withinDays: number; includeExpired?: boolean; limit?: number },
): Promise<Array<OpsStaffCredential & { staffName?: string; staffRole?: string }>> {
  const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
  const now = Date.now();
  const cutoff = now + opts.withinDays * 24 * 60 * 60 * 1000;
  const includeExpired = opts.includeExpired ?? false;
  // Hits idx_ops_staff_cred_expiry (expires_at) + idx_ops_staff_cred_active
  // (partial index on deleted_at IS NULL). Tenant filter on c.facility_number
  // is mandatory — defense in depth even though the JOIN scopes via s too.
  const sql_ = `
    SELECT
      c.id, c.facility_number, c.staff_id, c.credential_type,
      c.issued_at, c.expires_at, c.verified_at, c.verified_by,
      c.status, c.note, c.created_by, c.created_at, c.updated_at, c.deleted_at,
      s.first_name AS staff_first_name,
      s.last_name  AS staff_last_name,
      s.role       AS staff_role
    FROM ops_staff_credentials c
    LEFT JOIN ops_staff s
      ON s.id = c.staff_id AND s.facility_number = c.facility_number
    WHERE c.facility_number = $1
      AND c.deleted_at IS NULL
      AND c.expires_at IS NOT NULL
      AND c.expires_at <= $2
      ${includeExpired ? "" : "AND c.expires_at >= $3"}
    ORDER BY c.expires_at ASC, c.id ASC
    LIMIT ${includeExpired ? "$3" : "$4"}
  `;
  const params: unknown[] = includeExpired
    ? [facilityNumber, cutoff, limit]
    : [facilityNumber, cutoff, now, limit];
  const res = await pool.query(sql_, params);
  return res.rows.map((row) => {
    const first = row.staff_first_name ?? null;
    const last = row.staff_last_name ?? null;
    const staffName =
      first || last ? `${first ?? ""}${first && last ? " " : ""}${last ?? ""}` : undefined;
    return {
      id: Number(row.id),
      facilityNumber: row.facility_number,
      staffId: Number(row.staff_id),
      credentialType: row.credential_type,
      issuedAt: row.issued_at !== null ? Number(row.issued_at) : null,
      expiresAt: row.expires_at !== null ? Number(row.expires_at) : null,
      verifiedAt: row.verified_at !== null ? Number(row.verified_at) : null,
      verifiedBy: row.verified_by ?? null,
      status: row.status,
      note: row.note ?? null,
      createdBy: row.created_by,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
      deletedAt: row.deleted_at !== null ? Number(row.deleted_at) : null,
      staffName,
      staffRole: row.staff_role ?? undefined,
    } as OpsStaffCredential & { staffName?: string; staffRole?: string };
  });
}

/**
 * Schedule-block helper for W3 acceptance criteria: given a staff member +
 * shift start, compute the worst credential severity across every cert their
 * role REQUIRES (per `ROLE_REQUIRED_CREDENTIALS` in shared). Used by the FE
 * shift-assignment dialog and any future server-side enforcement.
 *
 * Hot path — called per assignment. Two queries total (no N+1):
 *   1) ops_staff lookup (tenant-scoped, not terminated)
 *   2) one batched fetch of the latest active row per required credential
 *      type for this staff member
 *
 * `warningDays` is read upstream from `getRegSetting(facilityNumber,
 * 'CREDENTIAL_WARNING_DAYS')` — never trust a client-supplied value here.
 */
export async function evaluateStaffCredentialsForShift(
  facilityNumber: string,
  staffId: number,
  shiftAtMs: number,
  warningDays: number,
): Promise<{
  worst: "ok" | "warning" | "expired";
  missing: CredentialType[];
  expired: CredentialType[];
  warning: CredentialType[];
  ok: CredentialType[];
}> {
  // (1) staff lookup — tenant-scoped, must not be terminated. Throw a
  // domain error so the route layer can map to 404.
  const staffRow = await pgFirst(
    db
      .select({
        id: opsStaff.id,
        role: opsStaff.role,
        status: opsStaff.status,
      })
      .from(opsStaff)
      .where(
        and(
          eq(opsStaff.id, staffId),
          eq(opsStaff.facilityNumber, facilityNumber),
        ),
      ),
  );
  if (!staffRow) {
    throw new Error("Staff not found for this facility");
  }
  const role = staffRow.role;
  const required = ROLE_REQUIRED_CREDENTIALS[role] ?? ROLE_REQUIRED_CREDENTIALS.other;

  // (2) Batch-fetch all active rows for this staff member in one query.
  // The list is bounded by len(CREDENTIAL_TYPES) per staff member, so we
  // pull all credential rows and pick the best (latest-expiring) per type.
  const credRows = await db
    .select({
      credentialType: opsStaffCredentials.credentialType,
      expiresAt: opsStaffCredentials.expiresAt,
      status: opsStaffCredentials.status,
    })
    .from(opsStaffCredentials)
    .where(
      and(
        eq(opsStaffCredentials.facilityNumber, facilityNumber),
        eq(opsStaffCredentials.staffId, staffId),
        eq(opsStaffCredentials.status, "active"),
        sql`${opsStaffCredentials.deletedAt} IS NULL`,
      ),
    );

  // Pick the most-forgiving (latest expiry; null = non-expiring beats any
  // dated row) per credentialType.
  const bestByType = new Map<string, number | null>();
  for (const r of credRows) {
    const cur = bestByType.get(r.credentialType);
    const next = r.expiresAt;
    if (cur === undefined) {
      bestByType.set(r.credentialType, next);
      continue;
    }
    // null beats everything (non-expiring is always "ok")
    if (cur === null || next === null) {
      bestByType.set(r.credentialType, null);
      continue;
    }
    if (next > cur) bestByType.set(r.credentialType, next);
  }

  const missing: CredentialType[] = [];
  const expired: CredentialType[] = [];
  const warning: CredentialType[] = [];
  const okList: CredentialType[] = [];

  for (const reqType of required) {
    if (!bestByType.has(reqType)) {
      missing.push(reqType);
      continue;
    }
    const expiresAt = bestByType.get(reqType) ?? null;
    const sev = credentialSeverity(expiresAt, warningDays, shiftAtMs);
    if (sev === "expired") expired.push(reqType);
    else if (sev === "warning") warning.push(reqType);
    else okList.push(reqType);
  }

  let worst: "ok" | "warning" | "expired";
  if (missing.length > 0 || expired.length > 0) worst = "expired";
  else if (warning.length > 0) worst = "warning";
  else worst = "ok";

  return { worst, missing, expired, warning, ok: okList };
}

// ─────────────────────────────────────────────────────────────────────────────
// Module 3 — W4 Incident Lifecycle Closer
//   BA §5 W4 acceptance criteria + §6 state machine for `incident`.
//   Phase 3 §2.5 Implementation Contract:
//     - tenant-scoped at the storage layer on every query
//     - event_severity derived server-side via classifyIncidentSeverity()
//     - reg-setting reads cached per evaluation (one batched Promise.all)
//     - audit emitted via safeAudit (try/catch wrapped)
//   The columns this module consumes are pre-existing on ops_incidents
//   (per opsSchema.ts:678-695) — additive Wave 2 W4 schema only.
// ─────────────────────────────────────────────────────────────────────────────

const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

export type IncidentSlaSeverity = "ok" | "warning" | "overdue";

export interface IncidentChecklist {
  incidentId: number;
  status: string;
  eventSeverity: IncidentSeverity;
  required: {
    supervisor: boolean;
    family: boolean;
    physician: boolean;
    ccldVerbal: boolean;
    lic624: boolean;
    soc341: boolean;
    rootCause: boolean;
    correctiveAction: boolean;
    followUp: boolean;
  };
  done: {
    supervisor: boolean;
    family: boolean;
    physician: boolean;
    ccldVerbal: boolean;
    lic624: boolean;
    soc341: boolean;
    rootCause: boolean;
    correctiveAction: boolean;
    followUp: boolean;
  };
  sla: {
    ccldVerbalDueAt?: number;
    ccldVerbalSeverity?: IncidentSlaSeverity;
    lic624DueAt?: number;
    lic624Severity?: IncidentSlaSeverity;
    soc341DueAt?: number;
    soc341Severity?: IncidentSlaSeverity;
  };
  canClose: boolean;
  blockingReasons: string[];
}

// SLA severity rule (W4): three states based on the position of `now` in
// the window [incidentDate, dueAt]:
//   - if the obligation was satisfied (timestamp non-null) → ok
//   - now >= dueAt                                          → overdue
//   - dueAt - now <= 10% of the window                      → warning
//   - else                                                  → ok
function computeSlaSeverity(
  incidentDateMs: number,
  dueAtMs: number,
  completedAtMs: number | null | undefined,
  nowMs: number,
): IncidentSlaSeverity {
  if (completedAtMs && completedAtMs > 0) return "ok";
  if (nowMs >= dueAtMs) return "overdue";
  const windowMs = Math.max(1, dueAtMs - incidentDateMs);
  const remainingMs = dueAtMs - nowMs;
  if (remainingMs <= 0.1 * windowMs) return "warning";
  return "ok";
}

// Per-evaluation reg-setting batch. Reading via Promise.all so the four
// keys come back in one round-trip burst rather than four sequential awaits.
async function readW4RegSettings(facilityNumber: string): Promise<{
  seriousHours: number;
  nonEmergentHours: number;
  lic624Days: number;
  soc341Hours: number;
}> {
  const [serious, nonEmergent, lic624, soc341] = await Promise.all([
    getRegSetting(facilityNumber, "INCIDENT_VERBAL_SERIOUS_HOURS"),
    getRegSetting(facilityNumber, "INCIDENT_VERBAL_NON_EMERGENT_HOURS"),
    getRegSetting(facilityNumber, "LIC_624_WRITTEN_DAYS"),
    getRegSetting(facilityNumber, "SOC_341_VERBAL_HOURS"),
  ]);
  const toPositiveNumber = (raw: string, fallback: number): number => {
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  return {
    seriousHours: toPositiveNumber(serious, 2),
    nonEmergentHours: toPositiveNumber(nonEmergent, 24),
    lic624Days: toPositiveNumber(lic624, 7),
    soc341Hours: toPositiveNumber(soc341, 2),
  };
}

/**
 * One-shot backfill for legacy rows where `event_severity` was never set.
 * Called from `evaluateIncidentChecklist` (read-side) when the row is
 * missing the column. Single tenant-scoped UPDATE per row; the surrounding
 * read still returns the freshly-derived value without a re-fetch.
 */
async function backfillIncidentSeverityForRow(
  row: OpsIncident,
): Promise<IncidentSeverity> {
  const sev = deriveEventSeverity(
    row.incidentType,
    row.injuryInvolved,
    row.hospitalizationRequired,
  );
  try {
    await db
      .update(opsIncidents)
      .set({ eventSeverity: sev, updatedBy: "system" })
      .where(
        and(
          eq(opsIncidents.id, row.id),
          eq(opsIncidents.facilityNumber, row.facilityNumber),
          // Defensive: only update when still NULL so a concurrent writer
          // who already wrote a value doesn't get clobbered.
          sql`event_severity IS NULL`,
        ),
      );
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[ops] event_severity backfill failed", err);
  }
  return sev;
}

/**
 * Evaluate the W4 checklist + SLA timers for one incident.
 *
 * Performance: 1 SELECT for the row + 1 batched Promise.all of 4 reg
 * settings. No N+1; the rest is in-memory pure logic.
 *
 * Returns `undefined` when the incident doesn't exist for this tenant
 * (so the route can map to 404). Soft-side-effect: writes `event_severity`
 * on the row when null (one-shot backfill).
 */
export async function evaluateIncidentChecklist(
  facilityNumber: string,
  incidentId: number,
  nowMs: number = Date.now(),
): Promise<IncidentChecklist | undefined> {
  const row = await pgFirst(
    db
      .select()
      .from(opsIncidents)
      .where(
        and(
          eq(opsIncidents.id, incidentId),
          eq(opsIncidents.facilityNumber, facilityNumber),
        ),
      ),
  );
  if (!row) return undefined;

  // Resolve event_severity: prefer persisted, fall back to backfill.
  let eventSeverity: IncidentSeverity;
  if (row.eventSeverity === "serious" || row.eventSeverity === "non_emergent") {
    eventSeverity = row.eventSeverity;
  } else {
    eventSeverity = await backfillIncidentSeverityForRow(row);
  }

  const reg = await readW4RegSettings(facilityNumber);

  // Required-step matrix per the W4 spec.
  const required = {
    supervisor: true,
    family: true,
    physician:
      (row.injuryInvolved ?? 0) === 1 ||
      (row.hospitalizationRequired ?? 0) === 1,
    ccldVerbal: true,
    lic624: (row.lic624Required ?? 0) === 1,
    soc341: (row.soc341Required ?? 0) === 1,
    rootCause: true,
    correctiveAction: true,
    followUp: row.followUpDate !== null && row.followUpDate !== undefined,
  };

  // Done-step matrix — read from the existing notification + submission
  // timestamp columns. We treat presence of the timestamp as "done"; the
  // boolean flag column is informational only.
  const done = {
    supervisor: !!row.supervisorNotifiedAt,
    family: !!row.familyNotifiedAt,
    physician: !!row.physicianNotifiedAt,
    ccldVerbal: !!row.ccldVerbalNotifiedAt,
    lic624: !!row.lic624SubmittedAt,
    soc341: !!row.soc341SubmittedAt,
    rootCause: typeof row.rootCause === "string" && row.rootCause.trim().length > 0,
    correctiveAction:
      typeof row.correctiveAction === "string" && row.correctiveAction.trim().length > 0,
    followUp: (row.followUpCompleted ?? 0) === 1,
  };

  // SLA timers — only compute the ones whose obligation applies.
  const sla: IncidentChecklist["sla"] = {};

  // CCLD verbal: always required; window depends on severity.
  const ccldWindowMs =
    (eventSeverity === "serious" ? reg.seriousHours : reg.nonEmergentHours) *
    MS_PER_HOUR;
  const ccldDueAt = row.incidentDate + ccldWindowMs;
  sla.ccldVerbalDueAt = ccldDueAt;
  sla.ccldVerbalSeverity = computeSlaSeverity(
    row.incidentDate,
    ccldDueAt,
    row.ccldVerbalNotifiedAt,
    nowMs,
  );

  if (required.lic624) {
    const lic624DueAt = row.incidentDate + reg.lic624Days * MS_PER_DAY;
    sla.lic624DueAt = lic624DueAt;
    sla.lic624Severity = computeSlaSeverity(
      row.incidentDate,
      lic624DueAt,
      row.lic624SubmittedAt,
      nowMs,
    );
  }

  if (required.soc341) {
    const soc341DueAt = row.incidentDate + reg.soc341Hours * MS_PER_HOUR;
    sla.soc341DueAt = soc341DueAt;
    sla.soc341Severity = computeSlaSeverity(
      row.incidentDate,
      soc341DueAt,
      row.soc341SubmittedAt,
      nowMs,
    );
  }

  // Blocking-reason matrix. Order matches the UI surface order so the
  // first item is the most visually obvious "next step."
  const blockingReasons: string[] = [];
  if (required.supervisor && !done.supervisor) blockingReasons.push("Supervisor not notified");
  if (required.family && !done.family) blockingReasons.push("Family not notified");
  if (required.physician && !done.physician) blockingReasons.push("Physician not notified");
  if (required.ccldVerbal && !done.ccldVerbal) blockingReasons.push("CCLD verbal notification missing");
  if (required.lic624 && !done.lic624) blockingReasons.push("LIC 624 not submitted");
  if (required.soc341 && !done.soc341) blockingReasons.push("SOC 341 not submitted");
  if (required.rootCause && !done.rootCause) blockingReasons.push("Root cause not documented");
  if (required.correctiveAction && !done.correctiveAction) blockingReasons.push("Corrective action not documented");
  if (required.followUp && !done.followUp) blockingReasons.push("Follow-up not completed");

  return {
    incidentId: row.id,
    status: row.status,
    eventSeverity,
    required,
    done,
    sla,
    canClose: blockingReasons.length === 0,
    blockingReasons,
  };
}

/**
 * Close an incident. Gated on `evaluateIncidentChecklist` reporting
 * canClose=true AND closureNote being non-empty (>= 8 chars). Writes
 * status='closed', closed_at, closed_by, closure_note and emits an audit
 * row with action='close'.
 *
 * Returns `undefined` when the incident doesn't exist for this tenant.
 * Throws a domain Error on validation failure — the route maps to 400.
 */
export async function closeIncident(
  id: number,
  facilityNumber: string,
  by: string,
  closureNote: string,
  actor: AuditActor,
): Promise<OpsIncident | undefined> {
  if (typeof closureNote !== "string" || closureNote.trim().length < 8) {
    throw new Error("Closure note is required (at least 8 characters)");
  }
  const before = await pgFirst(
    db
      .select()
      .from(opsIncidents)
      .where(
        and(
          eq(opsIncidents.id, id),
          eq(opsIncidents.facilityNumber, facilityNumber),
        ),
      ),
  );
  if (!before) return undefined;
  if (before.status === "closed") {
    throw new Error("Incident is already closed");
  }

  const checklist = await evaluateIncidentChecklist(facilityNumber, id);
  if (!checklist) return undefined;
  if (!checklist.canClose) {
    // Surface the first blocking reason so the FE can show actionable copy.
    throw new Error(`Cannot close incident: ${checklist.blockingReasons[0]}`);
  }

  const now = Date.now();
  const rows = await db
    .update(opsIncidents)
    .set({
      status: "closed",
      closureNote: closureNote.trim(),
      closedAt: now,
      closedBy: by,
      updatedAt: now,
      updatedBy: actorId(actor),
    })
    .where(
      and(
        eq(opsIncidents.id, id),
        eq(opsIncidents.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const after = rows[0] as OpsIncident | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "close",
      entityType: "ops_incident",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

/**
 * Re-open a closed incident. Only valid on status='closed' — anything else
 * throws a domain error. Sets status='under_review' and records
 * reopened_at / reopened_by / reopen_reason. Prior closed_at / closed_by
 * are preserved so the audit history shows the full close → reopen cycle.
 *
 * Returns `undefined` when the incident doesn't exist for this tenant.
 */
export async function reopenIncident(
  id: number,
  facilityNumber: string,
  by: string,
  reason: string,
  actor: AuditActor,
): Promise<OpsIncident | undefined> {
  if (typeof reason !== "string" || reason.trim().length < 8) {
    throw new Error("Reopen reason is required (at least 8 characters)");
  }
  const before = await pgFirst(
    db
      .select()
      .from(opsIncidents)
      .where(
        and(
          eq(opsIncidents.id, id),
          eq(opsIncidents.facilityNumber, facilityNumber),
        ),
      ),
  );
  if (!before) return undefined;
  if (before.status !== "closed") {
    throw new Error(`Cannot reopen incident in status: ${before.status}`);
  }

  const now = Date.now();
  const rows = await db
    .update(opsIncidents)
    .set({
      status: "under_review",
      reopenedAt: now,
      reopenedBy: by,
      reopenReason: reason.trim(),
      // Preserve prior closed_at / closed_by — do NOT null them.
      updatedAt: now,
      updatedBy: actorId(actor),
    })
    .where(
      and(
        eq(opsIncidents.id, id),
        eq(opsIncidents.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const after = rows[0] as OpsIncident | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "reopen",
      entityType: "ops_incident",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

/**
 * List incidents that are still open AND past at least one SLA rule.
 * Designed for the Wave 3 daily triage screen. Tenant-scoped on every
 * query. Cheap: pulls open rows with the partial index
 * idx_ops_inc_status_severity, then evaluates SLA in-memory using the
 * single batched reg-setting read.
 *
 * Returns each row enriched with `breachedRules` (string[]) — the human-
 * readable names of the SLA timers currently in 'overdue' state.
 */
export async function listIncidentsPastSla(
  facilityNumber: string,
  opts: { limit?: number } = {},
): Promise<Array<OpsIncident & { breachedRules: string[] }>> {
  const limit = Math.min(200, Math.max(1, opts.limit ?? 50));
  const nowMs = Date.now();

  // Pull all non-closed incidents for this facility, newest first. The
  // 'open' / 'under_review' filter trims the SLA evaluation workload to
  // incidents whose timers actually matter.
  const candidates = await db
    .select()
    .from(opsIncidents)
    .where(
      and(
        eq(opsIncidents.facilityNumber, facilityNumber),
        or(
          eq(opsIncidents.status, "open"),
          eq(opsIncidents.status, "under_review"),
        ),
      ),
    )
    .orderBy(desc(opsIncidents.incidentDate))
    .limit(limit * 4); // over-fetch since some won't breach

  if (candidates.length === 0) return [];

  // Single reg-setting batch shared across every row in this facility.
  const reg = await readW4RegSettings(facilityNumber);

  const out: Array<OpsIncident & { breachedRules: string[] }> = [];
  for (const row of candidates) {
    const sev: IncidentSeverity =
      row.eventSeverity === "serious" || row.eventSeverity === "non_emergent"
        ? row.eventSeverity
        : deriveEventSeverity(
            row.incidentType,
            row.injuryInvolved,
            row.hospitalizationRequired,
          );

    const breached: string[] = [];

    // CCLD verbal always applies.
    const ccldDueAt =
      row.incidentDate +
      (sev === "serious" ? reg.seriousHours : reg.nonEmergentHours) * MS_PER_HOUR;
    if (
      computeSlaSeverity(row.incidentDate, ccldDueAt, row.ccldVerbalNotifiedAt, nowMs) ===
      "overdue"
    ) {
      breached.push("ccld_verbal");
    }

    if ((row.lic624Required ?? 0) === 1) {
      const lic624DueAt = row.incidentDate + reg.lic624Days * MS_PER_DAY;
      if (
        computeSlaSeverity(row.incidentDate, lic624DueAt, row.lic624SubmittedAt, nowMs) ===
        "overdue"
      ) {
        breached.push("lic_624");
      }
    }

    if ((row.soc341Required ?? 0) === 1) {
      const soc341DueAt = row.incidentDate + reg.soc341Hours * MS_PER_HOUR;
      if (
        computeSlaSeverity(row.incidentDate, soc341DueAt, row.soc341SubmittedAt, nowMs) ===
        "overdue"
      ) {
        breached.push("soc_341");
      }
    }

    if (breached.length > 0) {
      out.push({ ...row, breachedRules: breached });
      if (out.length >= limit) break;
    }
  }
  return out;
}
