/**
 * Facility Operations Module — Express Router
 *
 * Mounted at /api/ops by server/index.ts.
 * All routes require facility auth (Passport.js session).
 * Never log PHI in route handlers.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { sqlite } from "../db/index";
import * as ops from "./opsStorage";

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

const medicationSchema = z.object({
  drugName: z.string().min(1),
  genericName: z.string().optional(),
  dosage: z.string().min(1),
  route: z.string().min(1),
  frequency: z.string().min(1),
  scheduledTimes: z.string().optional(),
  prescriberName: z.string().optional(),
  prescriberNpi: z.string().optional(),
  rxNumber: z.string().optional(),
  pharmacyName: z.string().optional(),
  startDate: z.number().int().optional(),
  endDate: z.number().int().optional(),
  isPrn: z.number().int().optional(),
  prnIndication: z.string().optional(),
  isControlled: z.number().int().optional(),
  isPsychotropic: z.number().int().optional(),
  isHazardous: z.number().int().optional(),
  classification: z.string().optional(),
  requiresVitalsBefore: z.number().int().optional(),
  vitalType: z.string().optional(),
  refillThresholdDays: z.number().int().optional(),
  autoRefillRequest: z.number().int().optional(),
  status: z.string().optional(),
});

const discontinueMedSchema = z.object({
  reason: z.string().min(1),
  discontinuedBy: z.string().min(1),
});

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
opsRouter.get("/facilities/:facilityNumber/residents", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const status = req.query.status ? String(req.query.status) : undefined;
    const result = ops.listResidents(facilityNumber, { page, limit, status });
    res.json({ success: true, data: result.residents, meta: { total: result.total, page, limit } });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/residents/:id — facility-scoped single resident
opsRouter.get("/facilities/:facilityNumber/residents/:id", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const resident = ops.getResident(id, facilityNumber);
    if (!resident) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: resident });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/residents/:id/assessments
opsRouter.get("/facilities/:facilityNumber/residents/:id/assessments", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const assessments = ops.listAssessments(id, facilityNumber);
    res.json({ success: true, data: assessments });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/residents/:id/care-plan
opsRouter.get("/facilities/:facilityNumber/residents/:id/care-plan", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const plan = ops.getActiveCarePlan(id, facilityNumber);
    if (!plan) return res.status(404).json({ success: false, error: "No active care plan" });
    res.json({ success: true, data: plan });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/residents/:id/daily-tasks
opsRouter.get("/facilities/:facilityNumber/residents/:id/daily-tasks", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const dateParam = req.query.date ? parseInt(String(req.query.date), 10) : Date.now();
    const shift = req.query.shift ? String(req.query.shift) : undefined;
    const tasks = ops.getDailyTasks(residentId, facilityNumber, dateParam, shift);
    res.json({ success: true, data: tasks });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/residents/:id/medications
opsRouter.get("/facilities/:facilityNumber/residents/:id/medications", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const status = req.query.status ? String(req.query.status) : undefined;
    const meds = ops.listMedications(residentId, facilityNumber, status);
    res.json({ success: true, data: meds });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/residents/:id/incidents
opsRouter.get("/facilities/:facilityNumber/residents/:id/incidents", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const result = ops.listIncidents(facilityNumber, { page, limit, residentId });
    res.json({ success: true, data: result.incidents, meta: { total: result.total, page, limit } });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /residents
opsRouter.get("/residents", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const status = req.query.status ? String(req.query.status) : undefined;
    const result = ops.listResidents(facilityNumber, { page, limit, status });
    res.json({ success: true, data: result.residents, meta: { total: result.total, page, limit } });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /residents
opsRouter.post("/residents", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const parsed = residentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const resident = ops.createResident({
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
opsRouter.get("/residents/:id", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const resident = ops.getResident(id, facilityNumber);
    if (!resident) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: resident });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /residents/:id
opsRouter.put("/residents/:id", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = residentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const resident = ops.updateResident(id, facilityNumber, parsed.data);
    if (!resident) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: resident });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// DELETE /residents/:id (soft delete)
opsRouter.delete("/residents/:id", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const ok = ops.softDeleteResident(id, facilityNumber);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /residents/:id/assessments
opsRouter.get("/residents/:id/assessments", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const assessments = ops.listAssessments(id, facilityNumber);
    res.json({ success: true, data: assessments });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /residents/:id/assessments
opsRouter.post("/residents/:id/assessments", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });

    const parsed = assessmentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const now = Date.now();
    const assessment = ops.createAssessment({
      ...parsed.data,
      residentId,
      facilityNumber,
      createdAt: now,
    });

    // Auto-create a care plan draft derived from the assessment
    const user = req.user as { username?: string } | undefined;
    const carePlan = ops.createCarePlan({
      residentId,
      facilityNumber,
      createdBy: user?.username ?? "system",
      effectiveDate: now,
      reviewDate: now + 90 * 86400000, // review in 90 days
      goal: `Maintain or improve ADL independence based on ${parsed.data.assessmentType} assessment`,
      intervention: `Provide assistance per assessed needs. Fall risk: ${parsed.data.fallRiskLevel ?? "unspecified"}. Cognition score: ${parsed.data.cognitionScore ?? "N/A"}.`,
      frequency: "Daily",
      status: "draft",
      createdAt: now,
      updatedAt: now,
    });

    // Auto-create daily tasks from the new care plan
    ops.createDailyTasksFromCarePlan(carePlan.id, residentId, facilityNumber);

    res.status(201).json({ success: true, data: { assessment, carePlan } });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /assessments/:id
opsRouter.put("/assessments/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = assessmentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const assessment = ops.updateAssessment(id, parsed.data);
    if (!assessment) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: assessment });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /residents/:id/care-plan
opsRouter.get("/residents/:id/care-plan", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const plan = ops.getActiveCarePlan(id, facilityNumber);
    if (!plan) return res.status(404).json({ success: false, error: "No active care plan" });
    res.json({ success: true, data: plan });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /residents/:id/care-plan
opsRouter.post("/residents/:id/care-plan", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = carePlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const plan = ops.createCarePlan({
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
opsRouter.put("/care-plans/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = carePlanSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const plan = ops.updateCarePlan(id, parsed.data);
    if (!plan) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: plan });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /care-plans/:id/sign
opsRouter.post("/care-plans/:id/sign", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = signCarePlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = ops.signCarePlan(id, parsed.data.signerType, parsed.data.signature);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /residents/:id/tasks
opsRouter.get("/residents/:id/tasks", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });

    const dateParam = req.query.date ? parseInt(String(req.query.date), 10) : Date.now();
    const shift = req.query.shift ? String(req.query.shift) : undefined;

    const tasks = ops.getDailyTasks(residentId, facilityNumber, dateParam, shift);
    res.json({ success: true, data: tasks });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /tasks/:id/complete
opsRouter.put("/tasks/:id/complete", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = completeTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = ops.completeTask(id, parsed.data.notes, Date.now());
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /tasks/:id/refuse
opsRouter.put("/tasks/:id/refuse", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = refuseTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = ops.refuseTask(id, parsed.data.reason);
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
opsRouter.get("/residents/:id/medications", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const status = req.query.status ? String(req.query.status) : undefined;
    const meds = ops.listMedications(residentId, facilityNumber, status);
    res.json({ success: true, data: meds });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /residents/:id/medications
opsRouter.post("/residents/:id/medications", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = medicationSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const med = ops.createMedication({
      ...parsed.data,
      residentId,
      facilityNumber,
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ success: true, data: med });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /medications/:id
opsRouter.put("/medications/:id", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = medicationSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const med = ops.updateMedication(id, facilityNumber, parsed.data);
    if (!med) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: med });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// DELETE /medications/:id (discontinue)
opsRouter.delete("/medications/:id", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = discontinueMedSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = ops.discontinueMedication(id, facilityNumber, parsed.data.reason, parsed.data.discontinuedBy);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/med-pass
opsRouter.get("/facilities/:facilityNumber/med-pass", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const date = req.query.date ? parseInt(String(req.query.date), 10) : (() => {
      const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime();
    })();
    const queue = ops.getFacilityMedPassQueue(facilityNumber, date);
    res.json({ success: true, data: queue });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /residents/:id/med-pass
opsRouter.get("/residents/:id/med-pass", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const date = req.query.date ? parseInt(String(req.query.date), 10) : (() => {
      const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime();
    })();
    const queue = ops.getResidentMedPassQueue(residentId, facilityNumber, date);
    res.json({ success: true, data: queue });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /med-passes
opsRouter.post("/med-passes", (req, res) => {
  try {
    const parsed = medPassSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const medPass = ops.recordMedPass({ ...parsed.data, createdAt: Date.now() });
    res.status(201).json({ success: true, data: medPass });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /med-passes/:id/prn-followup
opsRouter.put("/med-passes/:id/prn-followup", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = prnFollowupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = ops.updatePrnFollowup(id, parsed.data.effectivenessNotes, parsed.data.notedAt);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/emar-dashboard
opsRouter.get("/facilities/:facilityNumber/emar-dashboard", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const date = req.query.date ? parseInt(String(req.query.date), 10) : (() => {
      const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime();
    })();
    const dashboard = ops.getMedPassDashboard(facilityNumber, date);
    res.json({ success: true, data: dashboard });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/med-refusals
opsRouter.get("/facilities/:facilityNumber/med-refusals", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const start = parseInt(String(req.query.start ?? "0"), 10);
    const end = parseInt(String(req.query.end ?? Date.now()), 10);
    const refusals = ops.getMedRefusals(facilityNumber, start, end);
    res.json({ success: true, data: refusals });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/prn-report
opsRouter.get("/facilities/:facilityNumber/prn-report", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const start = parseInt(String(req.query.start ?? "0"), 10);
    const end = parseInt(String(req.query.end ?? Date.now()), 10);
    const report = ops.getPrnReport(facilityNumber, start, end);
    res.json({ success: true, data: report });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /medications/:id/request-refill
opsRouter.post("/medications/:id/request-refill", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const med = ops.updateMedication(id, facilityNumber, {
      autoRefillRequest: 1,
    });
    if (!med) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: med });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /controlled-sub-counts
opsRouter.post("/controlled-sub-counts", (req, res) => {
  try {
    const parsed = controlledSubCountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const record = ops.recordControlledSubCount({ ...parsed.data, createdAt: Date.now() });
    res.status(201).json({ success: true, data: record });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /med-destruction
opsRouter.post("/med-destruction", (req, res) => {
  try {
    const parsed = medDestructionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const record = ops.recordMedDestruction({ ...parsed.data, createdAt: Date.now() });
    res.status(201).json({ success: true, data: record });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 3 — Incidents
// ─────────────────────────────────────────────────────────────────────────────

// GET /facilities/:facilityNumber/incidents
opsRouter.get("/facilities/:facilityNumber/incidents", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const type = req.query.type ? String(req.query.type) : undefined;
    const residentId = req.query.residentId
      ? parseInt(String(req.query.residentId), 10)
      : undefined;
    const result = ops.listIncidents(facilityNumber, { page, limit, type, residentId });
    res.json({ success: true, data: result.incidents, meta: { total: result.total, page, limit } });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /incidents
opsRouter.post("/incidents", (req, res) => {
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
    const incident = ops.createIncident({
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
opsRouter.put("/incidents/:id", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = incidentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const incident = ops.updateIncident(id, facilityNumber, parsed.data);
    if (!incident) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: incident });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /incidents/:id/lic624
opsRouter.get("/incidents/:id/lic624", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    // Return a structured form view for LIC 624
    const incident = sqlite
      .prepare(
        `SELECT * FROM ops_incidents WHERE id = ? AND facility_number = ?`
      )
      .get(id, facilityNumber) as Record<string, unknown> | undefined;
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
opsRouter.get("/facilities/:facilityNumber/incident-trends", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const days = parseInt(String(req.query.days ?? "30"), 10) || 30;
    const trends = ops.getIncidentTrends(facilityNumber, days);
    res.json({ success: true, data: trends });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 4 — CRM / Admissions
// ─────────────────────────────────────────────────────────────────────────────

// GET /facilities/:facilityNumber/leads
opsRouter.get("/facilities/:facilityNumber/leads", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const stage = req.query.stage ? String(req.query.stage) : undefined;
    const result = ops.listLeads(facilityNumber, { page, limit, stage });
    res.json({ success: true, data: result.leads, meta: { total: result.total, page, limit } });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /leads
opsRouter.post("/leads", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const parsed = leadSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const lead = ops.createLead({ ...parsed.data, facilityNumber, createdAt: now, updatedAt: now });
    res.status(201).json({ success: true, data: lead });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /leads/:id
opsRouter.put("/leads/:id", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = leadSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const lead = ops.updateLead(id, facilityNumber, parsed.data);
    if (!lead) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: lead });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /leads/:id
opsRouter.get("/leads/:id", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const lead = ops.getLead(id, facilityNumber);
    if (!lead) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: lead });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /leads/:id/tours
opsRouter.post("/leads/:id/tours", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const leadId = parseInt(req.params.id, 10);
    if (isNaN(leadId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = tourSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const tour = ops.scheduleTour({ ...parsed.data, leadId, facilityNumber, createdAt: now });
    res.status(201).json({ success: true, data: tour });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /tours/:id
opsRouter.put("/tours/:id", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = tourSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const tour = ops.updateTour(id, parsed.data);
    if (!tour) return res.status(404).json({ success: false, error: "Not found" });

    // Auto-advance lead stage to 'tour_completed' if tour has an outcome
    if (parsed.data.outcome && tour.leadId) {
      ops.updateLead(tour.leadId, facilityNumber, { stage: "tour_completed" });
    }
    res.json({ success: true, data: tour });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /leads/:id/admissions
opsRouter.post("/leads/:id/admissions", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const leadId = parseInt(req.params.id, 10);
    if (isNaN(leadId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = admissionSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const admission = ops.startAdmission({
      leadId,
      facilityNumber,
      ...parsed.data,
      createdAt: now,
      updatedAt: now,
    });
    // Advance lead stage
    ops.updateLead(leadId, facilityNumber, { stage: "admission_in_progress" });
    res.status(201).json({ success: true, data: admission });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/leads/:leadId/admissions
// Finds or creates the admission record for a lead, returns { lead, forms, admissionId }
opsRouter.get("/facilities/:facilityNumber/leads/:leadId/admissions", (req, res) => {
  try {
    const { facilityNumber, leadId: leadIdStr } = req.params;
    const leadId = parseInt(leadIdStr, 10);
    if (isNaN(leadId)) return res.status(400).json({ success: false, error: "Invalid leadId" });

    const lead = ops.getLead(leadId, facilityNumber);
    if (!lead) return res.status(404).json({ success: false, error: "Lead not found" });

    let admission = sqlite
      .prepare(`SELECT * FROM ops_admissions WHERE lead_id = ? LIMIT 1`)
      .get(leadId) as Record<string, unknown> | undefined;

    if (!admission) {
      const created = ops.startAdmission({ leadId, facilityNumber, createdAt: Date.now(), updatedAt: Date.now() });
      admission = sqlite
        .prepare(`SELECT * FROM ops_admissions WHERE id = ?`)
        .get(created.id) as Record<string, unknown>;
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
opsRouter.put("/leads/:leadId/lic/:form", (req, res) => {
  try {
    const leadId = parseInt(req.params.leadId, 10);
    if (isNaN(leadId)) return res.status(400).json({ success: false, error: "Invalid leadId" });

    const parsed = licFormSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }

    const row = sqlite
      .prepare(`SELECT id FROM ops_admissions WHERE lead_id = ? LIMIT 1`)
      .get(leadId) as { id: number } | undefined;
    if (!row) return res.status(404).json({ success: false, error: "Admission not found for this lead" });

    // Normalize frontend formId to storage column key: lic601 → lic_601, lic602a → lic_602a
    const rawForm = req.params.form;
    const normalizedForm = rawForm.replace(/^lic(\d)/, "lic_$1");
    const ok = ops.updateAdmissionLicForm(row.id, normalizedForm, parsed.data.completed);
    if (!ok) return res.status(404).json({ success: false, error: "Not found or invalid form" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /leads/:leadId/convert
// Convert the admission for this lead into a resident record
opsRouter.post("/leads/:leadId/convert", (req, res) => {
  try {
    const leadId = parseInt(req.params.leadId, 10);
    if (isNaN(leadId)) return res.status(400).json({ success: false, error: "Invalid leadId" });

    const row = sqlite
      .prepare(`SELECT id FROM ops_admissions WHERE lead_id = ? LIMIT 1`)
      .get(leadId) as { id: number } | undefined;
    if (!row) return res.status(404).json({ success: false, error: "Admission not found for this lead" });

    const resident = ops.convertAdmissionToResident(row.id);
    if (!resident) return res.status(404).json({ success: false, error: "Admission not found or lead missing" });
    res.status(201).json({ success: true, data: resident });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /admissions/:id/lic-checklist
opsRouter.get("/admissions/:id/lic-checklist", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const admission = sqlite
      .prepare(`SELECT * FROM ops_admissions WHERE id = ?`)
      .get(id) as Record<string, unknown> | undefined;
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
opsRouter.put("/admissions/:id/lic/:form", (req, res) => {
  try {
    const admissionId = parseInt(req.params.id, 10);
    if (isNaN(admissionId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const { form } = req.params;
    const parsed = licFormSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = ops.updateAdmissionLicForm(admissionId, form, parsed.data.completed);
    if (!ok) return res.status(404).json({ success: false, error: "Not found or invalid form" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /admissions/:id/convert
opsRouter.post("/admissions/:id/convert", (req, res) => {
  try {
    const admissionId = parseInt(req.params.id, 10);
    if (isNaN(admissionId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const resident = ops.convertAdmissionToResident(admissionId);
    if (!resident) return res.status(404).json({ success: false, error: "Admission not found or lead missing" });
    res.status(201).json({ success: true, data: resident });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/occupancy
opsRouter.get("/facilities/:facilityNumber/occupancy", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const occupancy = ops.getOccupancy(facilityNumber);
    res.json({ success: true, data: occupancy });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/crm-pipeline
opsRouter.get("/facilities/:facilityNumber/crm-pipeline", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const rows = sqlite
      .prepare(
        `SELECT stage, COUNT(*) as count FROM ops_leads WHERE facility_number = ? GROUP BY stage`
      )
      .all(facilityNumber) as Array<{ stage: string; count: number }>;

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
opsRouter.get("/residents/:id/billing", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(req.params.id, 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const charges = ops.listCharges(facilityNumber, residentId);

    const invoices = sqlite
      .prepare(
        `SELECT * FROM ops_invoices WHERE facility_number = ? AND resident_id = ? ORDER BY created_at DESC`
      )
      .all(facilityNumber, residentId);

    res.json({ success: true, data: { charges, invoices } });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /billing/charges
opsRouter.post("/billing/charges", (req, res) => {
  try {
    const parsed = chargeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const charge = ops.createCharge({ ...parsed.data, createdAt: Date.now() });
    res.status(201).json({ success: true, data: charge });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /billing/charges/:id
opsRouter.put("/billing/charges/:id", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = chargeSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    // Use raw sqlite for partial update; existing row has snake_case column names
    const existing = sqlite
      .prepare(`SELECT * FROM ops_billing_charges WHERE id = ? AND facility_number = ?`)
      .get(id, facilityNumber) as Record<string, unknown> | undefined;
    if (!existing) return res.status(404).json({ success: false, error: "Not found" });

    const d = parsed.data;
    sqlite
      .prepare(
        `UPDATE ops_billing_charges SET charge_type=?, description=?, amount=?, unit=?, quantity=?, billing_period_start=?, billing_period_end=?, is_recurring=?, recurrence_interval=?, prorated=?, prorate_from=?, prorate_to=?, source=?, clinical_ref_id=? WHERE id=?`
      )
      .run(
        d.chargeType           ?? existing["charge_type"],
        d.description          ?? existing["description"],
        d.amount               ?? existing["amount"],
        d.unit                 ?? existing["unit"],
        d.quantity             ?? existing["quantity"],
        d.billingPeriodStart   ?? existing["billing_period_start"],
        d.billingPeriodEnd     ?? existing["billing_period_end"],
        d.isRecurring          ?? existing["is_recurring"],
        d.recurrenceInterval   ?? existing["recurrence_interval"],
        d.prorated             ?? existing["prorated"],
        d.prorateFrom          ?? existing["prorate_from"],
        d.prorateTo            ?? existing["prorate_to"],
        d.source               ?? existing["source"],
        d.clinicalRefId        ?? existing["clinical_ref_id"],
        id
      );
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// DELETE /billing/charges/:id
opsRouter.delete("/billing/charges/:id", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const ok = ops.deleteCharge(id, facilityNumber);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /billing/invoices/generate
opsRouter.post("/billing/invoices/generate", (req, res) => {
  try {
    const parsed = generateInvoiceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const invoice = ops.generateInvoice(
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
opsRouter.get("/billing/invoices/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const invoice = ops.getInvoice(id);
    if (!invoice) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: invoice });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /billing/invoices/:id/send
opsRouter.put("/billing/invoices/:id/send", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const ok = ops.markInvoiceSent(id);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /billing/payments
opsRouter.post("/billing/payments", (req, res) => {
  try {
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const payment = ops.recordPayment({ ...parsed.data, createdAt: Date.now() });
    res.status(201).json({ success: true, data: payment });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/ar-aging
opsRouter.get("/facilities/:facilityNumber/ar-aging", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const aging = ops.getArAging(facilityNumber);
    res.json({ success: true, data: aging });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/billing-summary
opsRouter.get("/facilities/:facilityNumber/billing-summary", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const start = parseInt(String(req.query.start ?? "0"), 10);
    const end = parseInt(String(req.query.end ?? Date.now()), 10);
    const summary = ops.getBillingSummary(facilityNumber, start, end);
    res.json({ success: true, data: summary });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 6 — Staff / Scheduling / Compliance
// ─────────────────────────────────────────────────────────────────────────────

// GET /facilities/:facilityNumber/staff
opsRouter.get("/facilities/:facilityNumber/staff", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const status = req.query.status ? String(req.query.status) : undefined;
    const staff = ops.listStaff(facilityNumber, status);
    res.json({ success: true, data: staff });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /staff
opsRouter.post("/staff", (req, res) => {
  try {
    const parsed = staffSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const member = ops.createStaff({ ...parsed.data, createdAt: now, updatedAt: now });
    res.status(201).json({ success: true, data: member });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /staff/:id
opsRouter.put("/staff/:id", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = staffSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const member = ops.updateStaff(id, facilityNumber, parsed.data);
    if (!member) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: member });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// DELETE /staff/:id (deactivate)
opsRouter.delete("/staff/:id", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const ok = ops.deactivateStaff(id, facilityNumber);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/schedule
opsRouter.get("/facilities/:facilityNumber/schedule", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const weekStart = parseInt(String(req.query.weekStart ?? "0"), 10);
    const shifts = ops.listShifts(facilityNumber, weekStart);
    res.json({ success: true, data: shifts });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /shifts
opsRouter.post("/shifts", (req, res) => {
  try {
    const parsed = shiftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const shift = ops.createShift({ ...parsed.data, createdAt: Date.now() });
    res.status(201).json({ success: true, data: shift });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /shifts/:id
opsRouter.put("/shifts/:id", (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = shiftSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const shift = ops.updateShift(id, parsed.data);
    if (!shift) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: shift });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/compliance
opsRouter.get("/facilities/:facilityNumber/compliance", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const status = req.query.status ? String(req.query.status) : undefined;
    const items = ops.listComplianceItems(facilityNumber, status);
    res.json({ success: true, data: items });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// POST /compliance
opsRouter.post("/compliance", (req, res) => {
  try {
    const parsed = complianceItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const item = ops.createComplianceItem({ ...parsed.data, createdAt: Date.now() });
    res.status(201).json({ success: true, data: item });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// PUT /compliance/:id
opsRouter.put("/compliance/:id", (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = completeComplianceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = ops.completeComplianceItem(id, facilityNumber, parsed.data.completedDate);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /facilities/:facilityNumber/compliance/overdue
opsRouter.get("/facilities/:facilityNumber/compliance/overdue", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const items = ops.getOverdueCompliance(facilityNumber);
    res.json({ success: true, data: items });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

// GET /facilities/:facilityNumber/dashboard
opsRouter.get("/facilities/:facilityNumber/dashboard", (req, res) => {
  try {
    const { facilityNumber } = req.params;
    const dashboard = ops.getFacilityDashboard(facilityNumber);
    res.json({ success: true, data: dashboard });
  } catch (e) {
    res.status(500).json({ success: false, error: "Internal error" });
  }
});
