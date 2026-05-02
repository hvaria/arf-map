/**
 * Facility Operations Module — Express Router
 *
 * Mounted at /api/ops by server/index.ts.
 * All routes require facility auth (Passport.js session).
 * Never log PHI in route handlers.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { pool } from "../db/index";
import * as ops from "./opsStorage";
import { notesRouter } from "./notesRouter";
import {
  MedicationCreateInput,
  MedicationUpdateInput,
  MEDICATION_DISCONTINUE_REASONS,
  joinScheduledTimes,
  normalizeMedicationRow,
  validateFrequencyTimesConsistency,
  parseLegacyFrequency,
  parseLegacyScheduledTimes,
  type MedicationFrequency,
} from "@shared/medication-constants";

export const opsRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Auth middleware
// ─────────────────────────────────────────────────────────────────────────────

function requireFacilityAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ success: false, error: "Not authenticated" });
  }
  next();
}

// Apply to all ops routes
opsRouter.use(requireFacilityAuth);

// Notes module — mounted under the auth middleware so handlers can rely on
// req.isAuthenticated() and req.user being populated.
opsRouter.use("/notes", notesRouter);

// ── IDOR guard: any route with `:facilityNumber` in the path must match the
// authenticated user's facility. Without this, facility A could read facility
// B's residents, medications, billing, etc. by changing the URL.
opsRouter.param("facilityNumber", (req: Request, res: Response, next: NextFunction, fnParam: string) => {
  const user = req.user as { facilityNumber?: string } | undefined;
  if (user?.facilityNumber !== fnParam) {
    return res.status(403).json({ success: false, error: "Forbidden" });
  }
  next();
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function parsePagination(query: Record<string, unknown>): { page: number; limit: number } {
  const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20));
  return { page, limit };
}

function getFacilityNumber(req: Request): string {
  // Passport user object has facilityNumber
  const user = req.user as { facilityNumber?: string } | undefined;
  return user?.facilityNumber ?? "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const residentSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dob: z.number().int().optional(),
  gender: z.string().optional(),
  ssnLast4: z.string().max(4).optional(),
  admissionDate: z.number().int().optional(),
  roomNumber: z.string().optional(),
  bedNumber: z.string().optional(),
  primaryDx: z.string().optional(),
  secondaryDx: z.string().optional(),
  levelOfCare: z.string().optional(),
  emergencyContactName: z.string().optional(),
  emergencyContactPhone: z.string().optional(),
  emergencyContactRelation: z.string().optional(),
  fundingSource: z.string().optional(),
  regionalCenterId: z.string().optional(),
  status: z.string().optional(),
});

const assessmentSchema = z.object({
  assessmentType: z.string().min(1),
  assessedBy: z.string().min(1),
  assessedAt: z.number().int(),
  bathing: z.number().int().optional(),
  dressing: z.number().int().optional(),
  grooming: z.number().int().optional(),
  toileting: z.number().int().optional(),
  continence: z.number().int().optional(),
  eating: z.number().int().optional(),
  mobility: z.number().int().optional(),
  transfers: z.number().int().optional(),
  mealPrep: z.number().int().optional(),
  housekeeping: z.number().int().optional(),
  laundry: z.number().int().optional(),
  transportation: z.number().int().optional(),
  finances: z.number().int().optional(),
  communication: z.number().int().optional(),
  cognitionScore: z.number().int().optional(),
  behaviorNotes: z.string().optional(),
  fallRiskLevel: z.string().optional(),
  vision: z.string().optional(),
  hearing: z.string().optional(),
  speech: z.string().optional(),
  ambulation: z.string().optional(),
  selfAdministerMeds: z.number().int().optional(),
  nextDueDate: z.number().int().optional(),
  licFormNumber: z.string().optional(),
  rawJson: z.string().optional(),
});

const carePlanSchema = z.object({
  createdBy: z.string().min(1),
  effectiveDate: z.number().int(),
  reviewDate: z.number().int(),
  goal: z.string().min(1),
  intervention: z.string().min(1),
  frequency: z.string().min(1),
  responsibleStaff: z.string().optional(),
  status: z.string().optional(),
});

const signCarePlanSchema = z.object({
  signerType: z.enum(["resident", "family"]),
  signature: z.string().min(1),
});

const completeTaskSchema = z.object({
  notes: z.string(),
});

const refuseTaskSchema = z.object({
  reason: z.string().min(1),
});

// Medication create/update Zod schemas live in @shared/medication-constants so
// the FE form and BE route share one contract. Both schemas accept legacy
// shapes (free-text frequency, comma-joined scheduledTimes) for back-compat.

// Frontend may send a canonical reason code from MEDICATION_DISCONTINUE_REASONS,
// or legacy free text from older clients. Reason and discontinuedBy are
// optional — if discontinuedBy is omitted we derive it from the session.
const discontinueMedSchema = z.object({
  reason: z
    .union([z.enum(MEDICATION_DISCONTINUE_REASONS), z.string().min(1)])
    .transform((v) => String(v))
    .optional(),
  reasonNote: z.string().optional(),
  discontinuedBy: z.string().min(1).optional(),
});

/**
 * Convert the validated form payload (scheduledTimes: string[]) to the storage
 * shape (scheduledTimes: string | null, frequency: string). Storage column
 * types are unchanged.
 */
function toStorageShape<T extends { frequency?: MedicationFrequency; scheduledTimes?: string[] }>(input: T) {
  const { frequency, scheduledTimes, ...rest } = input;
  const out: Record<string, unknown> = { ...rest };
  if (frequency !== undefined) out.frequency = frequency;
  if (scheduledTimes !== undefined) out.scheduledTimes = joinScheduledTimes(scheduledTimes);
  return out as T extends { frequency: MedicationFrequency }
    ? Omit<T, "frequency" | "scheduledTimes"> & { frequency: string; scheduledTimes: string | null }
    : Omit<T, "frequency" | "scheduledTimes"> & { frequency?: string; scheduledTimes?: string | null };
}

const medPassSchema = z.object({
  medicationId: z.number().int(),
  residentId: z.number().int(),
  facilityNumber: z.string().min(1),
  scheduledDatetime: z.number().int(),
  administeredDatetime: z.number().int().optional(),
  administeredBy: z.string().optional(),
  witnessBy: z.string().optional(),
  rightResident: z.number().int().optional(),
  rightMedication: z.number().int().optional(),
  rightDose: z.number().int().optional(),
  rightRoute: z.number().int().optional(),
  rightTime: z.number().int().optional(),
  rightReason: z.number().int().optional(),
  rightDocumentation: z.number().int().optional(),
  rightToRefuse: z.number().int().optional(),
  status: z.string().optional(),
  refusalReason: z.string().optional(),
  holdReason: z.string().optional(),
  notes: z.string().optional(),
  preVitalsBp: z.string().optional(),
  preVitalsPulse: z.number().int().optional(),
  preVitalsTemp: z.number().optional(),
  preVitalsSpo2: z.number().int().optional(),
  prnReason: z.string().optional(),
});

const prnFollowupSchema = z.object({
  effectivenessNotes: z.string().min(1),
  notedAt: z.number().int(),
});

const controlledSubCountSchema = z.object({
  medicationId: z.number().int(),
  facilityNumber: z.string().min(1),
  countDate: z.number().int(),
  shift: z.string().min(1),
  countedBy: z.string().min(1),
  witnessedBy: z.string().min(1),
  openingCount: z.number().int(),
  closingCount: z.number().int(),
  administeredCount: z.number().int().optional(),
  wastedCount: z.number().int().optional(),
  discrepancy: z.number().int().optional(),
  discrepancyNotes: z.string().optional(),
  resolved: z.number().int().optional(),
});

const medDestructionSchema = z.object({
  medicationId: z.number().int(),
  facilityNumber: z.string().min(1),
  quantity: z.number().int(),
  unit: z.string().min(1),
  destructionMethod: z.string().min(1),
  destroyedBy: z.string().min(1),
  witnessedBy: z.string().min(1),
  destructionDate: z.number().int(),
  reason: z.string().min(1),
});

const incidentSchema = z.object({
  residentId: z.number().int().optional(),
  incidentType: z.string().min(1),
  incidentDate: z.number().int(),
  incidentTime: z.string().optional(),
  location: z.string().optional(),
  description: z.string().min(1),
  immediateActionTaken: z.string().optional(),
  injuryInvolved: z.number().int().optional(),
  injuryDescription: z.string().optional(),
  hospitalizationRequired: z.number().int().optional(),
  hospitalName: z.string().optional(),
  reportedBy: z.string().min(1),
  supervisorNotified: z.number().int().optional(),
  supervisorNotifiedAt: z.number().int().optional(),
  familyNotified: z.number().int().optional(),
  familyNotifiedAt: z.number().int().optional(),
  physicianNotified: z.number().int().optional(),
  physicianNotifiedAt: z.number().int().optional(),
  lic624Submitted: z.number().int().optional(),
  lic624SubmittedAt: z.number().int().optional(),
  soc341Required: z.number().int().optional(),
  soc341Submitted: z.number().int().optional(),
  rootCause: z.string().optional(),
  correctiveAction: z.string().optional(),
  followUpDate: z.number().int().optional(),
  followUpCompleted: z.number().int().optional(),
  status: z.string().optional(),
});

const leadSchema = z.object({
  contactName: z.string().min(1),
  contactPhone: z.string().optional(),
  contactEmail: z.string().email().optional(),
  contactRelation: z.string().optional(),
  prospectName: z.string().min(1),
  prospectDob: z.number().int().optional(),
  prospectGender: z.string().optional(),
  careNeedsSummary: z.string().optional(),
  fundingSource: z.string().optional(),
  desiredMoveInDate: z.number().int().optional(),
  referralSource: z.string().optional(),
  assignedTo: z.string().optional(),
  stage: z.string().optional(),
  lostReason: z.string().optional(),
  notes: z.string().optional(),
  lastContactDate: z.number().int().optional(),
  nextFollowUpDate: z.number().int().optional(),
});

const tourSchema = z.object({
  scheduledAt: z.number().int(),
  conductedBy: z.string().optional(),
  outcome: z.string().optional(),
  notes: z.string().optional(),
  followUpAction: z.string().optional(),
  completedAt: z.number().int().optional(),
});

const admissionSchema = z.object({
  leadId: z.number().int(),
  facilityNumber: z.string().min(1),
  moveInDate: z.number().int().optional(),
  assignedRoom: z.string().optional(),
  notes: z.string().optional(),
});

const licFormSchema = z.object({
  completed: z.boolean(),
});

const chargeSchema = z.object({
  facilityNumber: z.string().min(1),
  residentId: z.number().int(),
  chargeType: z.string().min(1),
  description: z.string().min(1),
  amount: z.number(),
  unit: z.string().optional(),
  quantity: z.number().optional(),
  billingPeriodStart: z.number().int().optional(),
  billingPeriodEnd: z.number().int().optional(),
  isRecurring: z.number().int().optional(),
  recurrenceInterval: z.string().optional(),
  prorated: z.number().int().optional(),
  prorateFrom: z.number().int().optional(),
  prorateTo: z.number().int().optional(),
  source: z.string().optional(),
  clinicalRefId: z.number().int().optional(),
});

const generateInvoiceSchema = z.object({
  facilityNumber: z.string().min(1),
  residentId: z.number().int(),
  periodStart: z.number().int(),
  periodEnd: z.number().int(),
});

const paymentSchema = z.object({
  invoiceId: z.number().int(),
  facilityNumber: z.string().min(1),
  residentId: z.number().int(),
  amount: z.number(),
  paymentDate: z.number().int(),
  paymentMethod: z.string().min(1),
  referenceNumber: z.string().optional(),
  type: z.string().optional(),
  notes: z.string().optional(),
  recordedBy: z.string().optional(),
});

const staffSchema = z.object({
  facilityNumber: z.string().min(1),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email().optional(),
  phone: z.string().optional(),
  role: z.string().min(1),
  hireDate: z.number().int().optional(),
  licenseNumber: z.string().optional(),
  licenseExpiry: z.number().int().optional(),
  status: z.string().optional(),
});

const shiftSchema = z.object({
  facilityNumber: z.string().min(1),
  staffId: z.number().int(),
  shiftDate: z.number().int(),
  shiftType: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  isOvertime: z.number().int().optional(),
  status: z.string().optional(),
  coveredById: z.number().int().optional(),
  notes: z.string().optional(),
});

const complianceItemSchema = z.object({
  facilityNumber: z.string().min(1),
  itemType: z.string().min(1),
  description: z.string().min(1),
  dueDate: z.number().int(),
  assignedTo: z.string().optional(),
  status: z.string().optional(),
  reminderDaysBefore: z.number().int().optional(),
});

const completeComplianceSchema = z.object({
  completedDate: z.number().int(),
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 1 — Residents
// ─────────────────────────────────────────────────────────────────────────────

// GET /facilities/:facilityNumber/residents — facility-scoped list (used by portal pages)
opsRouter.get("/facilities/:facilityNumber/residents", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const status = req.query.status ? String(req.query.status) : undefined;
    const result = await ops.listResidents(facilityNumber, { page, limit, status });
    res.json({ success: true, data: result.residents, meta: { total: result.total, page, limit } });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/residents/:id — facility-scoped single resident
opsRouter.get("/facilities/:facilityNumber/residents/:id", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const resident = await ops.getResident(id, facilityNumber);
    if (!resident) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: resident });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/residents/:id/assessments
opsRouter.get("/facilities/:facilityNumber/residents/:id/assessments", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const assessments = await ops.listAssessments(id, facilityNumber);
    res.json({ success: true, data: assessments });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /facilities/:facilityNumber/residents/:id/assessments
opsRouter.post("/facilities/:facilityNumber/residents/:id/assessments", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = assessmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const assessment = await ops.createAssessment({ ...parsed.data, residentId, facilityNumber, createdAt: now });
    const user = req.user as { username?: string } | undefined;
    const carePlan = await ops.createCarePlan({
      residentId, facilityNumber,
      createdBy: user?.username ?? "system",
      effectiveDate: now,
      reviewDate: now + 90 * 86400000,
      goal: `Maintain or improve ADL independence based on ${parsed.data.assessmentType} assessment`,
      intervention: `Provide assistance per assessed needs. Fall risk: ${parsed.data.fallRiskLevel ?? "unspecified"}. Cognition score: ${parsed.data.cognitionScore ?? "N/A"}.`,
      frequency: "Daily",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });
    await ops.createDailyTasksFromCarePlan(carePlan.id, residentId, facilityNumber);
    res.status(201).json({ success: true, data: { assessment, carePlan } });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/residents/:id/care-plan
opsRouter.get("/facilities/:facilityNumber/residents/:id/care-plan", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const plan = await ops.getActiveCarePlan(id, facilityNumber);
    if (!plan) return res.status(404).json({ success: false, error: "No active care plan" });
    res.json({ success: true, data: plan });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/residents/:id/daily-tasks
opsRouter.get("/facilities/:facilityNumber/residents/:id/daily-tasks", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const dateParam = req.query.date ? parseInt(String(req.query.date), 10) : Date.now();
    const shift = req.query.shift ? String(req.query.shift) : undefined;
    const tasks = await ops.getDailyTasks(residentId, facilityNumber, dateParam, shift);
    res.json({ success: true, data: tasks });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/residents/:id/medications
opsRouter.get("/facilities/:facilityNumber/residents/:id/medications", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const status = req.query.status ? String(req.query.status) : undefined;
    const meds = await ops.listMedications(residentId, facilityNumber, status);
    res.json({ success: true, data: meds.map(normalizeMedicationRow) });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /facilities/:facilityNumber/residents/:id/medications
opsRouter.post("/facilities/:facilityNumber/residents/:id/medications", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = MedicationCreateInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const storagePayload = toStorageShape(parsed.data);
    const med = await ops.createMedication({ ...storagePayload, residentId, facilityNumber, createdAt: now, updatedAt: now });
    res.status(201).json({ success: true, data: normalizeMedicationRow(med) });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/residents/:id/incidents
opsRouter.get("/facilities/:facilityNumber/residents/:id/incidents", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const result = await ops.listIncidents(facilityNumber, { page, limit, residentId });
    res.json({ success: true, data: result.incidents, meta: { total: result.total, page, limit } });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /residents
opsRouter.get("/residents", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const status = req.query.status ? String(req.query.status) : undefined;
    const result = await ops.listResidents(facilityNumber, { page, limit, status });
    res.json({ success: true, data: result.residents, meta: { total: result.total, page, limit } });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /residents
opsRouter.post("/residents", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const parsed = residentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const resident = await ops.createResident({
      ...parsed.data,
      facilityNumber,
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ success: true, data: resident });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /residents/:id
opsRouter.get("/residents/:id", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const resident = await ops.getResident(id, facilityNumber);
    if (!resident) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: resident });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /residents/:id
opsRouter.put("/residents/:id", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = residentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const resident = await ops.updateResident(id, facilityNumber, parsed.data);
    if (!resident) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: resident });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// DELETE /residents/:id (soft delete)
opsRouter.delete("/residents/:id", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const ok = await ops.softDeleteResident(id, facilityNumber);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /residents/:id/assessments
opsRouter.get("/residents/:id/assessments", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const assessments = await ops.listAssessments(id, facilityNumber);
    res.json({ success: true, data: assessments });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /residents/:id/assessments
opsRouter.post("/residents/:id/assessments", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });

    const parsed = assessmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const now = Date.now();
    const assessment = await ops.createAssessment({
      ...parsed.data,
      residentId,
      facilityNumber,
      createdAt: now,
    });

    // Auto-create a care plan draft derived from the assessment
    const user = req.user as { username?: string } | undefined;
    const carePlan = await ops.createCarePlan({
      residentId,
      facilityNumber,
      createdBy: user?.username ?? "system",
      effectiveDate: now,
      reviewDate: now + 90 * 86400000, // review in 90 days
      goal: `Maintain or improve ADL independence based on ${parsed.data.assessmentType} assessment`,
      intervention: `Provide assistance per assessed needs. Fall risk: ${parsed.data.fallRiskLevel ?? "unspecified"}. Cognition score: ${parsed.data.cognitionScore ?? "N/A"}.`,
      frequency: "Daily",
      status: "active",
      createdAt: now,
      updatedAt: now,
    });

    // Auto-create daily tasks from the new care plan
    await ops.createDailyTasksFromCarePlan(carePlan.id, residentId, facilityNumber);

    res.status(201).json({ success: true, data: { assessment, carePlan } });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /assessments/:id
opsRouter.put("/assessments/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = assessmentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const assessment = await ops.updateAssessment(id, parsed.data);
    if (!assessment) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: assessment });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /residents/:id/care-plan
opsRouter.get("/residents/:id/care-plan", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const plan = await ops.getActiveCarePlan(id, facilityNumber);
    if (!plan) return res.status(404).json({ success: false, error: "No active care plan" });
    res.json({ success: true, data: plan });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /residents/:id/care-plan
opsRouter.post("/residents/:id/care-plan", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = carePlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const plan = await ops.createCarePlan({
      ...parsed.data,
      residentId,
      facilityNumber,
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ success: true, data: plan });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /care-plans/:id
opsRouter.put("/care-plans/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = carePlanSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const plan = await ops.updateCarePlan(id, parsed.data);
    if (!plan) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: plan });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /care-plans/:id/sign
opsRouter.post("/care-plans/:id/sign", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = signCarePlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = await ops.signCarePlan(id, parsed.data.signerType, parsed.data.signature);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /residents/:id/tasks
opsRouter.get("/residents/:id/tasks", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });

    const dateParam = req.query.date ? parseInt(String(req.query.date), 10) : Date.now();
    const shift = req.query.shift ? String(req.query.shift) : undefined;

    const tasks = await ops.getDailyTasks(residentId, facilityNumber, dateParam, shift);
    res.json({ success: true, data: tasks });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /tasks/:id/complete
opsRouter.put("/tasks/:id/complete", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = completeTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = await ops.completeTask(id, parsed.data.notes, Date.now());
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /tasks/:id/refuse
opsRouter.put("/tasks/:id/refuse", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = refuseTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = await ops.refuseTask(id, parsed.data.reason);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 2 — eMAR
// ─────────────────────────────────────────────────────────────────────────────

// GET /residents/:id/medications
opsRouter.get("/residents/:id/medications", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const status = req.query.status ? String(req.query.status) : undefined;
    const meds = await ops.listMedications(residentId, facilityNumber, status);
    res.json({ success: true, data: meds.map(normalizeMedicationRow) });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /residents/:id/medications
opsRouter.post("/residents/:id/medications", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = MedicationCreateInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const storagePayload = toStorageShape(parsed.data);
    const med = await ops.createMedication({
      ...storagePayload,
      residentId,
      facilityNumber,
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ success: true, data: normalizeMedicationRow(med) });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /medications/:id
opsRouter.put("/medications/:id", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = MedicationUpdateInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    // Cross-field rule (PRN ⇔ no scheduled times) does not survive .partial(),
    // so we evaluate it on the merged post-update state. Skips the load when
    // neither field is in the patch.
    const patch = parsed.data;
    if (patch.frequency !== undefined || patch.scheduledTimes !== undefined) {
      const existing = await ops.getMedication(id, facilityNumber);
      if (!existing) return res.status(404).json({ success: false, error: "Not found" });
      const mergedFrequency: MedicationFrequency =
        patch.frequency ?? parseLegacyFrequency(existing.frequency);
      const mergedTimes: string[] =
        patch.scheduledTimes ?? parseLegacyScheduledTimes(existing.scheduledTimes);
      const consistency = validateFrequencyTimesConsistency(mergedFrequency, mergedTimes);
      if (!consistency.ok) {
        return res.status(400).json({ success: false, error: consistency.message });
      }
    }

    const storagePayload = toStorageShape(patch);
    const med = await ops.updateMedication(id, facilityNumber, storagePayload);
    if (!med) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: normalizeMedicationRow(med) });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// DELETE /medications/:id (discontinue)
opsRouter.delete("/medications/:id", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = discontinueMedSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const sessionUser = req.user as { username?: string } | undefined;
    const reason = parsed.data.reasonNote
      ? `${parsed.data.reason ?? "other"}: ${parsed.data.reasonNote}`
      : (parsed.data.reason ?? "");
    const by = parsed.data.discontinuedBy ?? sessionUser?.username ?? "unknown";
    const ok = await ops.discontinueMedication(id, facilityNumber, reason, by);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

function medPassShift(scheduledDatetime: number): "AM" | "PM" | "NOC" {
  const hour = new Date(scheduledDatetime).getHours();
  if (hour >= 6 && hour < 14) return "AM";
  if (hour >= 14 && hour < 22) return "PM";
  return "NOC";
}

function formatScheduledTime(scheduledDatetime: number): string {
  const d = new Date(scheduledDatetime);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

// GET /facilities/:facilityNumber/med-pass/summary?from=YYYY-MM-DD&to=YYYY-MM-DD
opsRouter.get("/facilities/:facilityNumber/med-pass/summary", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    if (getFacilityNumber(req) !== facilityNumber) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    const { from, to } = req.query as { from?: string; to?: string };
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      return res.status(400).json({ success: false, error: "from and to (YYYY-MM-DD) are required" });
    }

    // Use local-midnight timestamps to match how generateDailyMedPassEntries stores records
    const localMidnight = (iso: string) => { const d = new Date(iso); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const fromMs = localMidnight(from);
    const toMs   = localMidnight(to) + 86_400_000; // exclusive: start of day after 'to'

    // Generate scheduled med-pass rows for every day in the range (idempotent WHERE NOT EXISTS).
    // Cap at 366 days so year view is covered; parallel for small ranges, sequential for large.
    const diffDays = Math.round((toMs - fromMs) / 86_400_000);
    const dayTimestamps = Array.from({ length: Math.min(diffDays, 366) }, (_, i) =>
      fromMs + i * 86_400_000
    );
    if (dayTimestamps.length <= 42) {
      await Promise.all(dayTimestamps.map((d) => ops.generateDailyMedPassEntries(facilityNumber, d)));
    } else {
      for (const d of dayTimestamps) await ops.generateDailyMedPassEntries(facilityNumber, d);
    }

    const data = await ops.getMedPassSummary(facilityNumber, fromMs, toMs);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
opsRouter.get("/facilities/:facilityNumber/calendar", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    if (getFacilityNumber(req) !== facilityNumber) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    const { from, to } = req.query as { from?: string; to?: string };
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
      return res.status(400).json({ success: false, error: "from and to (YYYY-MM-DD) are required" });
    }
    const localMidnight = (iso: string) => { const d = new Date(iso); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const fromMs = localMidnight(from);
    const toMs   = localMidnight(to) + 86_400_000;
    const diffDays = Math.min(Math.round((toMs - fromMs) / 86_400_000), 42);
    const days = Array.from({ length: diffDays }, (_, i) => fromMs + i * 86_400_000);
    await Promise.all(days.map((d) => ops.generateDailyMedPassEntries(facilityNumber, d)));
    const data = await ops.getCalendarSummary(facilityNumber, fromMs, toMs);
    return res.json({ success: true, data });
  } catch (e) {
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/med-pass
opsRouter.get("/facilities/:facilityNumber/med-pass", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const date = req.query.date
      ? new Date(String(req.query.date)).setHours(0, 0, 0, 0)
      : (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); })();
    await ops.generateDailyMedPassEntries(facilityNumber, date);
    const queue = await ops.getFacilityMedPassQueue(facilityNumber, date);
    const data = queue.map((row: ops.MedPassRawRow) => ({
      id: row.id,
      residentId: row.resident_id,
      residentName: `${row.resident_first_name} ${row.resident_last_name}`,
      roomNumber: row.room_number ?? "",
      medicationId: row.medication_id,
      drugName: row.drug_name,
      dosage: row.dosage ?? "",
      route: row.route ?? "",
      scheduledTime: formatScheduledTime(row.scheduled_datetime),
      prescriber: row.prescriber_name ?? "",
      status: row.status as "pending" | "given" | "late" | "missed" | "refused" | "held",
      shift: medPassShift(row.scheduled_datetime),
      notes: row.notes ?? undefined,
    }));
    res.json({ success: true, data });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /residents/:id/med-pass
opsRouter.get("/residents/:id/med-pass", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const date = req.query.date ? parseInt(String(req.query.date), 10) : (() => {
      const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime();
    })();
    const queue = await ops.getResidentMedPassQueue(residentId, facilityNumber, date);
    res.json({ success: true, data: queue });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /med-passes
opsRouter.post("/med-passes", async (req, res) => {
  try {
    const parsed = medPassSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const medPass = await ops.recordMedPass({ ...parsed.data, createdAt: Date.now() });
    res.status(201).json({ success: true, data: medPass });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /med-passes/:id — chart (update) an existing med-pass row
const chartMedPassSchema = z.object({
  status: z.enum(["given", "refused", "held"]),
  administeredDatetime: z.number().int().optional(),
  notes: z.string().optional(),
  refusalReason: z.string().optional(),
  holdReason: z.string().optional(),
  rightResident: z.number().int().optional(),
  rightMedication: z.number().int().optional(),
  rightDose: z.number().int().optional(),
  rightRoute: z.number().int().optional(),
  rightTime: z.number().int().optional(),
  rightReason: z.number().int().optional(),
  rightDocumentation: z.number().int().optional(),
  rightToRefuse: z.number().int().optional(),
});

opsRouter.put("/med-passes/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = chartMedPassSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = await ops.updateMedPassRecord(id, parsed.data);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /med-passes/:id/prn-followup
opsRouter.put("/med-passes/:id/prn-followup", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = prnFollowupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = await ops.updatePrnFollowup(id, parsed.data.effectivenessNotes, parsed.data.notedAt);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/emar-dashboard
opsRouter.get("/facilities/:facilityNumber/emar-dashboard", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const date = req.query.date ? parseInt(String(req.query.date), 10) : (() => {
      const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime();
    })();
    const dashboard = await ops.getMedPassDashboard(facilityNumber, date);
    res.json({ success: true, data: dashboard });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/med-refusals
opsRouter.get("/facilities/:facilityNumber/med-refusals", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const start = parseInt(String(req.query.start ?? "0"), 10);
    const end = parseInt(String(req.query.end ?? Date.now()), 10);
    const refusals = await ops.getMedRefusals(facilityNumber, start, end);
    res.json({ success: true, data: refusals });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/prn-report
opsRouter.get("/facilities/:facilityNumber/prn-report", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const start = parseInt(String(req.query.start ?? "0"), 10);
    const end = parseInt(String(req.query.end ?? Date.now()), 10);
    const report = await ops.getPrnReport(facilityNumber, start, end);
    res.json({ success: true, data: report });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /medications/:id/request-refill
opsRouter.post("/medications/:id/request-refill", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const existing = await ops.getMedication(id, facilityNumber);
    if (!existing) return res.status(404).json({ success: false, error: "Not found" });
    if (existing.status === "discontinued") {
      return res.status(409).json({ success: false, error: "Cannot request refill for a discontinued medication." });
    }
    const med = await ops.updateMedication(id, facilityNumber, {
      autoRefillRequest: 1,
    });
    if (!med) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: normalizeMedicationRow(med) });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /controlled-sub-counts
opsRouter.post("/controlled-sub-counts", async (req, res) => {
  try {
    const parsed = controlledSubCountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const record = await ops.recordControlledSubCount({ ...parsed.data, createdAt: Date.now() });
    res.status(201).json({ success: true, data: record });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /med-destruction
opsRouter.post("/med-destruction", async (req, res) => {
  try {
    const parsed = medDestructionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const record = await ops.recordMedDestruction({ ...parsed.data, createdAt: Date.now() });
    res.status(201).json({ success: true, data: record });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 3 — Incidents
// ─────────────────────────────────────────────────────────────────────────────

// GET /facilities/:facilityNumber/incidents
opsRouter.get("/facilities/:facilityNumber/incidents", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const type = req.query.type ? String(req.query.type) : undefined;
    const residentId = req.query.residentId
      ? parseInt(String(req.query.residentId), 10)
      : undefined;
    const result = await ops.listIncidents(facilityNumber, { page, limit, type, residentId });
    res.json({ success: true, data: result.incidents, meta: { total: result.total, page, limit } });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /incidents
opsRouter.post("/incidents", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const parsed = incidentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const injuryInvolved = (parsed.data.injuryInvolved ?? 0) === 1;
    const hospitalizationRequired = (parsed.data.hospitalizationRequired ?? 0) === 1;
    const lic624Required = ops.determineLic624Required(
      parsed.data.incidentType,
      injuryInvolved,
      hospitalizationRequired
    );
    const incident = await ops.createIncident({
      ...parsed.data,
      facilityNumber,
      lic624Required: lic624Required ? 1 : 0,
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ success: true, data: incident });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /incidents/:id
opsRouter.put("/incidents/:id", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = incidentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const incident = await ops.updateIncident(id, facilityNumber, parsed.data);
    if (!incident) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: incident });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /incidents/:id/lic624
opsRouter.get("/incidents/:id/lic624", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });

    const r = await pool.query<Record<string, unknown>>(
      `SELECT * FROM ops_incidents WHERE id = $1 AND facility_number = $2`,
      [id, facilityNumber]
    );
    const incident = r.rows[0];

    if (!incident) return res.status(404).json({ success: false, error: "Not found" });
    res.json({
      success: true,
      data: {
        lic624Required: Boolean(incident["lic_624_required"]),
        lic624Submitted: Boolean(incident["lic_624_submitted"]),
        lic624SubmittedAt: incident["lic_624_submitted_at"],
        incidentType: incident["incident_type"],
        incidentDate: incident["incident_date"],
        facilityNumber: incident["facility_number"],
        description: incident["description"],
        reportedBy: incident["reported_by"],
        injuryInvolved: Boolean(incident["injury_involved"]),
        hospitalizationRequired: Boolean(incident["hospitalization_required"]),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/incident-trends
opsRouter.get("/facilities/:facilityNumber/incident-trends", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const days = parseInt(String(req.query.days ?? "30"), 10) || 30;
    const trends = await ops.getIncidentTrends(facilityNumber, days);
    res.json({ success: true, data: trends });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 4 — CRM / Admissions
// ─────────────────────────────────────────────────────────────────────────────

// GET /facilities/:facilityNumber/leads
opsRouter.get("/facilities/:facilityNumber/leads", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const stage = req.query.stage ? String(req.query.stage) : undefined;
    const result = await ops.listLeads(facilityNumber, { page, limit, stage });
    res.json({ success: true, data: result.leads, meta: { total: result.total, page, limit } });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /leads
opsRouter.post("/leads", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const parsed = leadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const lead = await ops.createLead({ ...parsed.data, facilityNumber, createdAt: now, updatedAt: now });
    res.status(201).json({ success: true, data: lead });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /leads/:id
opsRouter.put("/leads/:id", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = leadSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const lead = await ops.updateLead(id, facilityNumber, parsed.data);
    if (!lead) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: lead });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /leads/:id
opsRouter.get("/leads/:id", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const lead = await ops.getLead(id, facilityNumber);
    if (!lead) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: lead });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /leads/:id/tours
opsRouter.post("/leads/:id/tours", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const leadId = parseInt(req.params.id, 10);
    if (isNaN(leadId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = tourSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const tour = await ops.scheduleTour({ ...parsed.data, leadId, facilityNumber, createdAt: now });
    res.status(201).json({ success: true, data: tour });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /tours/:id
opsRouter.put("/tours/:id", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = tourSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const tour = await ops.updateTour(id, parsed.data);
    if (!tour) return res.status(404).json({ success: false, error: "Not found" });

    // Auto-advance lead stage to 'tour_completed' if tour has an outcome
    if (parsed.data.outcome && tour.leadId) {
      await ops.updateLead(tour.leadId, facilityNumber, { stage: "tour_completed" });
    }
    res.json({ success: true, data: tour });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /leads/:id/admissions
opsRouter.post("/leads/:id/admissions", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const leadId = parseInt(req.params.id, 10);
    if (isNaN(leadId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = admissionSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const admission = await ops.startAdmission({
      leadId,
      facilityNumber,
      ...parsed.data,
      createdAt: now,
      updatedAt: now,
    });
    // Advance lead stage
    await ops.updateLead(leadId, facilityNumber, { stage: "admission_in_progress" });
    res.status(201).json({ success: true, data: admission });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/leads/:leadId/admissions
// Finds or creates the admission record for a lead, returns { lead, forms, admissionId }
opsRouter.get("/facilities/:facilityNumber/leads/:leadId/admissions", async (req, res) => {
  try {
    const { facilityNumber, leadId: leadIdStr } = req.params;
    const leadId = parseInt(leadIdStr, 10);
    if (isNaN(leadId)) return res.status(400).json({ success: false, error: "Invalid leadId" });

    const lead = await ops.getLead(leadId, facilityNumber);
    if (!lead) return res.status(404).json({ success: false, error: "Lead not found" });

    let admission: Record<string, unknown> | undefined;
    {
      const r = await pool.query<Record<string, unknown>>(
        `SELECT * FROM ops_admissions WHERE lead_id = $1 LIMIT 1`,
        [leadId]
      );
      admission = r.rows[0];
    }

    if (!admission) {
      const created = await ops.startAdmission({ leadId, facilityNumber, createdAt: Date.now(), updatedAt: Date.now() });
      const r = await pool.query<Record<string, unknown>>(
        `SELECT * FROM ops_admissions WHERE id = $1`,
        [created.id]
      );
      admission = r.rows[0] as Record<string, unknown>;
    }

    const FORM_DEFS = [
      { formId: "lic601",           label: "LIC 601 — Application for Licensure",  required: true,  col: "lic_601_completed",           dateCol: "lic_601_date" },
      { formId: "lic602a",          label: "LIC 602A — Facility Personnel Record", required: true,  col: "lic_602a_completed",          dateCol: "lic_602a_date" },
      { formId: "lic603",           label: "LIC 603 — Facility Liability",          required: true,  col: "lic_603_completed",           dateCol: "lic_603_date" },
      { formId: "lic604a",          label: "LIC 604A — Admission Agreement",        required: true,  col: "lic_604a_completed",          dateCol: "lic_604a_date" },
      { formId: "lic605a",          label: "LIC 605A — Personal Rights",            required: true,  col: "lic_605a_completed",          dateCol: "lic_605a_date" },
      { formId: "lic610d",          label: "LIC 610D — Resident Appraisal",         required: true,  col: "lic_610d_completed",          dateCol: "lic_610d_date" },
      { formId: "admission_agreement", label: "Admission Agreement",               required: true,  col: "admission_agreement_signed",  dateCol: null },
      { formId: "physician_report", label: "Physician Report",                     required: false, col: "physician_report_received",   dateCol: null },
      { formId: "tb_test",          label: "TB Test Results",                       required: false, col: "tb_test_results_received",    dateCol: null },
    ];

    const forms = FORM_DEFS.map((def) => ({
      formId: def.formId,
      label: def.label,
      required: def.required,
      completed: Boolean(admission![def.col]),
      completedAt: def.dateCol ? (admission![def.dateCol] as number | null) ?? null : null,
    }));

    res.json({
      success: true,
      data: {
        lead: {
          id: lead.id,
          prospectName: lead.prospectName,
          contactName: lead.contactName ?? "",
          contactPhone: lead.contactPhone ?? "",
          contactEmail: lead.contactEmail ?? "",
          careNeeds: lead.careNeedsSummary ?? "",
          stage: lead.stage,
        },
        forms,
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /leads/:leadId/lic/:form
// Update LIC form completion for the admission belonging to this lead
opsRouter.put("/leads/:leadId/lic/:form", async (req, res) => {
  try {
    const leadId = parseInt(req.params.leadId, 10);
    if (isNaN(leadId)) return res.status(400).json({ success: false, error: "Invalid leadId" });

    const parsed = licFormSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const r = await pool.query<{ id: number }>(
      `SELECT id FROM ops_admissions WHERE lead_id = $1 LIMIT 1`,
      [leadId]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ success: false, error: "Admission not found for this lead" });

    // Normalize frontend formId to storage column key: lic601 → lic_601, lic602a → lic_602a
    const rawForm = req.params.form;
    const normalizedForm = rawForm.replace(/^lic(\d)/, "lic_$1");
    const ok = await ops.updateAdmissionLicForm(row.id, normalizedForm, parsed.data.completed);
    if (!ok) return res.status(404).json({ success: false, error: "Not found or invalid form" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /leads/:leadId/convert
// Convert the admission for this lead into a resident record
opsRouter.post("/leads/:leadId/convert", async (req, res) => {
  try {
    const leadId = parseInt(req.params.leadId, 10);
    if (isNaN(leadId)) return res.status(400).json({ success: false, error: "Invalid leadId" });

    const r = await pool.query<{ id: number }>(
      `SELECT id FROM ops_admissions WHERE lead_id = $1 LIMIT 1`,
      [leadId]
    );
    const row = r.rows[0];
    if (!row) return res.status(404).json({ success: false, error: "Admission not found for this lead" });

    const resident = await ops.convertAdmissionToResident(row.id);
    if (!resident) return res.status(404).json({ success: false, error: "Admission not found or lead missing" });
    res.status(201).json({ success: true, data: resident });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /admissions/:id/lic-checklist
opsRouter.get("/admissions/:id/lic-checklist", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });

    const r = await pool.query<Record<string, unknown>>(
      `SELECT * FROM ops_admissions WHERE id = $1`,
      [id]
    );
    const admission = r.rows[0];

    if (!admission) return res.status(404).json({ success: false, error: "Not found" });
    res.json({
      success: true,
      data: {
        lic_601:  { completed: Boolean(admission["lic_601_completed"]),  date: admission["lic_601_date"] },
        lic_602a: { completed: Boolean(admission["lic_602a_completed"]), date: admission["lic_602a_date"] },
        lic_603:  { completed: Boolean(admission["lic_603_completed"]),  date: admission["lic_603_date"] },
        lic_604a: { completed: Boolean(admission["lic_604a_completed"]), date: admission["lic_604a_date"] },
        lic_605a: { completed: Boolean(admission["lic_605a_completed"]), date: admission["lic_605a_date"] },
        lic_610d: { completed: Boolean(admission["lic_610d_completed"]), date: admission["lic_610d_date"] },
        admissionAgreementSigned: Boolean(admission["admission_agreement_signed"]),
        physicianReportReceived:  Boolean(admission["physician_report_received"]),
        tbTestResultsReceived:    Boolean(admission["tb_test_results_received"]),
      },
    });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /admissions/:id/lic/:form
opsRouter.put("/admissions/:id/lic/:form", async (req, res) => {
  try {
    const admissionId = parseInt(req.params.id, 10);
    if (isNaN(admissionId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const { form } = req.params;
    const parsed = licFormSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = await ops.updateAdmissionLicForm(admissionId, form, parsed.data.completed);
    if (!ok) return res.status(404).json({ success: false, error: "Not found or invalid form" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /admissions/:id/convert
opsRouter.post("/admissions/:id/convert", async (req, res) => {
  try {
    const admissionId = parseInt(req.params.id, 10);
    if (isNaN(admissionId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const resident = await ops.convertAdmissionToResident(admissionId);
    if (!resident) return res.status(404).json({ success: false, error: "Admission not found or lead missing" });
    res.status(201).json({ success: true, data: resident });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/occupancy
opsRouter.get("/facilities/:facilityNumber/occupancy", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const occupancy = await ops.getOccupancy(facilityNumber);
    res.json({ success: true, data: occupancy });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/crm-pipeline
opsRouter.get("/facilities/:facilityNumber/crm-pipeline", async (req, res) => {
  try {
    const { facilityNumber } = req.params;

    const r = await pool.query<{ stage: string; count: number }>(
      `SELECT stage, COUNT(*)::int as count FROM ops_leads WHERE facility_number = $1 GROUP BY stage`,
      [facilityNumber]
    );
    const rows = r.rows;

    const pipeline: Record<string, number> = {};
    for (const row of rows) {
      pipeline[row.stage] = row.count;
    }
    res.json({ success: true, data: pipeline });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 5 — Billing
// ─────────────────────────────────────────────────────────────────────────────

// GET /residents/:id/billing
opsRouter.get("/residents/:id/billing", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const charges = await ops.listCharges(facilityNumber, residentId);

    const r = await pool.query(
      `SELECT * FROM ops_invoices WHERE facility_number = $1 AND resident_id = $2 ORDER BY created_at DESC`,
      [facilityNumber, residentId]
    );
    const invoices = r.rows;

    res.json({ success: true, data: { charges, invoices } });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /billing/charges
opsRouter.post("/billing/charges", async (req, res) => {
  try {
    const parsed = chargeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const charge = await ops.createCharge({ ...parsed.data, createdAt: Date.now() });
    res.status(201).json({ success: true, data: charge });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /billing/charges/:id
opsRouter.put("/billing/charges/:id", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = chargeSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const d = parsed.data;
    const existing = (await pool.query<Record<string, unknown>>(
      `SELECT * FROM ops_billing_charges WHERE id = $1 AND facility_number = $2`,
      [id, facilityNumber]
    )).rows[0];
    if (!existing) return res.status(404).json({ success: false, error: "Not found" });

    await pool.query(
      `UPDATE ops_billing_charges SET charge_type=$1, description=$2, amount=$3, unit=$4, quantity=$5, billing_period_start=$6, billing_period_end=$7, is_recurring=$8, recurrence_interval=$9, prorated=$10, prorate_from=$11, prorate_to=$12, source=$13, clinical_ref_id=$14 WHERE id=$15`,
      [
        d.chargeType         ?? existing["charge_type"],
        d.description        ?? existing["description"],
        d.amount             ?? existing["amount"],
        d.unit               ?? existing["unit"],
        d.quantity           ?? existing["quantity"],
        d.billingPeriodStart ?? existing["billing_period_start"],
        d.billingPeriodEnd   ?? existing["billing_period_end"],
        d.isRecurring        ?? existing["is_recurring"],
        d.recurrenceInterval ?? existing["recurrence_interval"],
        d.prorated           ?? existing["prorated"],
        d.prorateFrom        ?? existing["prorate_from"],
        d.prorateTo          ?? existing["prorate_to"],
        d.source             ?? existing["source"],
        d.clinicalRefId      ?? existing["clinical_ref_id"],
        id,
      ]
    );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// DELETE /billing/charges/:id
opsRouter.delete("/billing/charges/:id", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const ok = await ops.deleteCharge(id, facilityNumber);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /billing/invoices/generate
opsRouter.post("/billing/invoices/generate", async (req, res) => {
  try {
    const parsed = generateInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const invoice = await ops.generateInvoice(
      parsed.data.facilityNumber,
      parsed.data.residentId,
      parsed.data.periodStart,
      parsed.data.periodEnd
    );
    res.status(201).json({ success: true, data: invoice });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /billing/invoices/:id
opsRouter.get("/billing/invoices/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const invoice = await ops.getInvoice(id);
    if (!invoice) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: invoice });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /billing/invoices/:id/send
opsRouter.put("/billing/invoices/:id/send", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const ok = await ops.markInvoiceSent(id);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /billing/payments
opsRouter.post("/billing/payments", async (req, res) => {
  try {
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const payment = await ops.recordPayment({ ...parsed.data, createdAt: Date.now() });
    res.status(201).json({ success: true, data: payment });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/ar-aging
opsRouter.get("/facilities/:facilityNumber/ar-aging", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const aging = await ops.getArAging(facilityNumber);
    res.json({ success: true, data: aging });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/billing-summary
opsRouter.get("/facilities/:facilityNumber/billing-summary", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const start = parseInt(String(req.query.start ?? "0"), 10);
    const end = parseInt(String(req.query.end ?? Date.now()), 10);
    const summary = await ops.getBillingSummary(facilityNumber, start, end);
    res.json({ success: true, data: summary });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 6 — Staff / Scheduling / Compliance
// ─────────────────────────────────────────────────────────────────────────────

// GET /facilities/:facilityNumber/staff
opsRouter.get("/facilities/:facilityNumber/staff", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const status = req.query.status ? String(req.query.status) : undefined;
    const staff = await ops.listStaff(facilityNumber, status);
    res.json({ success: true, data: staff });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /staff
opsRouter.post("/staff", async (req, res) => {
  try {
    const parsed = staffSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const member = await ops.createStaff({ ...parsed.data, createdAt: now, updatedAt: now });
    res.status(201).json({ success: true, data: member });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /staff/:id
opsRouter.put("/staff/:id", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = staffSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const member = await ops.updateStaff(id, facilityNumber, parsed.data);
    if (!member) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: member });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// DELETE /staff/:id (deactivate)
opsRouter.delete("/staff/:id", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const ok = await ops.deactivateStaff(id, facilityNumber);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/schedule
opsRouter.get("/facilities/:facilityNumber/schedule", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const weekStart = parseInt(String(req.query.weekStart ?? "0"), 10);
    const shifts = await ops.listShifts(facilityNumber, weekStart);
    res.json({ success: true, data: shifts });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /shifts
opsRouter.post("/shifts", async (req, res) => {
  try {
    const parsed = shiftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const shift = await ops.createShift({ ...parsed.data, createdAt: Date.now() });
    res.status(201).json({ success: true, data: shift });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /shifts/:id
opsRouter.put("/shifts/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = shiftSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const shift = await ops.updateShift(id, parsed.data);
    if (!shift) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: shift });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/compliance
opsRouter.get("/facilities/:facilityNumber/compliance", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const status = req.query.status ? String(req.query.status) : undefined;
    const items = await ops.listComplianceItems(facilityNumber, status);
    res.json({ success: true, data: items });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /compliance
opsRouter.post("/compliance", async (req, res) => {
  try {
    const parsed = complianceItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const item = await ops.createComplianceItem({ ...parsed.data, createdAt: Date.now() });
    res.status(201).json({ success: true, data: item });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /compliance/:id
opsRouter.put("/compliance/:id", async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = completeComplianceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = await ops.completeComplianceItem(id, facilityNumber, parsed.data.completedDate);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/compliance/overdue
opsRouter.get("/facilities/:facilityNumber/compliance/overdue", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const items = await ops.getOverdueCompliance(facilityNumber);
    res.json({ success: true, data: items });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

// GET /facilities/:facilityNumber/dashboard
opsRouter.get("/facilities/:facilityNumber/dashboard", async (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const dashboard = await ops.getFacilityDashboard(facilityNumber);
    res.json({ success: true, data: dashboard });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});
