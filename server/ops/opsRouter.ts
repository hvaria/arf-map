/**
 * Facility Operations Module — Express Router
 *
 * Mounted at /api/ops by server/index.ts.
 * All routes require facility auth (Passport.js session).
 * Never log PHI in route handlers.
 */

import { Router, type Request, type Response, type NextFunction } from "express";
import multer from "multer";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { pool } from "../db/index";
import { centsToDollars, dollarsToCents } from "../lib/money";
import * as ops from "./opsStorage";
import { notesRouter } from "./notesRouter";
import { reportsRouter } from "./reportsRouter";
import { trackerRouter } from "../trackers/routes";
import { requireActiveSubscription } from "../middleware/requireActiveSubscription";
import {
  requireOpsPermission,
  resolveRole,
  OPS_RESOURCES,
} from "./permissions";
import {
  isKnownRegSettingKey,
  listRegSettings,
  setRegSetting,
  seedDefaultsForFacility,
  getRegSetting,
} from "./regSettings";
import {
  CREDENTIAL_TYPES,
  CREDENTIAL_STATUSES,
} from "@shared/staff-credentials";
import {
  EVIDENCE_MAX_BYTES,
  EVIDENCE_ALLOWED_MIME,
  EVIDENCE_KIND_VALUES,
  EvidenceValidationError,
  attachEvidence,
  listEvidence,
  readEvidenceStream,
  softDeleteEvidence,
} from "./evidenceStorage";
import { listAuditForFacility } from "./auditStorage";
import * as obligations from "./obligationsStorage";
import { aggregateTriage } from "./triageAggregator";
import {
  createShareLink,
  listShareLinks,
  revokeShareLink,
  ShareLinkDurationError,
} from "./shareLinksStorage";
import {
  generatePreauditBundle,
  listPreauditPulls,
  persistAsReport,
  recordPreauditPull,
} from "./preauditPullsStorage";
import {
  archivePostingCatalogEntry,
  createPostingCatalogEntry,
  createPostingVerification,
  getPostingCatalogEntry,
  listPostingCatalog,
  listPostingVerifications,
  seedDefaultPostings,
  updatePostingCatalogEntry,
} from "./postingsStorage";
import {
  appendLedgerEntry,
  closeTrustAccount,
  ensureTrustAccount,
  generateMonthlyStatement,
  getTrustAccount,
  isTrustEnabled,
  listLedger,
  listStatements,
  listTrustAccounts,
  recordReversal,
  reconcileAccount,
  repairBalance,
  TrustDomainError,
} from "./residentTrustStorage";
import {
  TRUST_LEDGER_DIRECTIONS,
  TRUST_LEDGER_CATEGORIES,
} from "@shared/resident-trust";
import { getDrillCadence } from "./drillCadenceStorage";
import {
  POSTING_KEYS,
  POSTING_VERIFICATION_STATUSES,
} from "@shared/postings";
import {
  AUDITOR_AUDIENCES,
  SHARE_LINK_SCOPES,
  PREAUDIT_SECTIONS,
  DEFAULT_SHARE_LINK_DURATION_DAYS,
  MAX_SHARE_LINK_DURATION_DAYS,
} from "@shared/auditor";
import {
  listNotifications,
  type NotificationKind,
  type DeliveryStatus,
} from "./notificationStorage";
import { sendDailySummaryForFacility } from "./dailySummaryScheduler";
import {
  OBLIGATION_STATUSES,
  OBLIGATION_SEVERITIES,
  OBLIGATION_TARGETS,
  OBLIGATION_TYPES,
} from "@shared/obligations";
import {
  getChartCompletenessForResident,
  listChartCompleteness,
} from "./chartCompletenessStorage";
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

// Operations paywall gate (Phase 0). MUST run after requireFacilityAuth so
// req.user is populated. Returns 402 SUBSCRIPTION_REQUIRED unless the
// account's cached subscription_status is `active` or `trialing`. This is
// the single gating point for all of /api/ops/* — residents, eMAR,
// incidents, trackers, notes, etc. all inherit the gate via this router.
opsRouter.use(requireActiveSubscription);

// Notes module — mounted under the auth middleware so handlers can rely on
// req.isAuthenticated() and req.user being populated.
opsRouter.use("/notes", notesRouter);

// Tracker module — mounted here (not directly on `app`) so it inherits
// requireFacilityAuth instead of running its own auth middleware. Effective
// URL stays /api/ops/trackers/... (M4).
opsRouter.use("/trackers", trackerRouter);

// Reports Hub — Wave 5. Mounted under opsRouter so it inherits the
// auth + paywall chain. Routes hang off the root prefix (/api/ops/...)
// and use the same :facilityNumber IDOR guard via opsRouter.param below.
opsRouter.use(reportsRouter);

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

/**
 * Coerce every top-level `null` in an object to `undefined`. Used at the
 * route→storage boundary when a Zod schema is permissive (`.nullable()`
 * so the FE can send `null` for "user left blank") but the underlying
 * storage type is `T | undefined` only. Drizzle treats `null` and
 * `undefined` the same way when inserting into a nullable column, so
 * stripping nulls here is a no-op semantically but keeps TS happy.
 *
 * The return type strips `| null` from every property so the result can
 * be passed straight to a storage function whose signature only allows
 * `T | undefined` per field.
 */
type StripNull<T> = { [K in keyof T]: Exclude<T[K], null> };
function nullsToUndef<T extends Record<string, unknown>>(obj: T): StripNull<T> {
  const out: Record<string, unknown> = {};
  for (const k of Object.keys(obj)) {
    out[k] = obj[k] === null ? undefined : obj[k];
  }
  return out as StripNull<T>;
}

function getFacilityNumber(req: Request): string {
  // Passport user object has facilityNumber
  const user = req.user as { facilityNumber?: string } | undefined;
  return user?.facilityNumber ?? "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Money boundary helpers (Phase 2 R2)
// ─────────────────────────────────────────────────────────────────────────────
// Storage is BIGINT cents end-to-end (server/lib/money.ts). The wire/UI
// format is dollars (number). These helpers shape an outbound row by
// dividing the money columns by 100 before serializing. They tolerate
// `undefined`/missing columns so partial rows (raw SQL projections) flow
// through unchanged when a money column is absent.
//
// Inbound conversion (dollars -> cents) happens inline at each handler
// via `dollarsToCents(parsed.data.amount)`.

function chargeOut<T extends { amount?: number | null }>(row: T): T & { amount: number } {
  return { ...row, amount: row.amount == null ? 0 : centsToDollars(row.amount) };
}

// Invoice projections come from two paths — Drizzle (camelCase keys) for
// generated/fetched invoices, and raw pool.query("SELECT * FROM
// ops_invoices ...") (snake_case keys) on the resident billing endpoint.
// Convert whichever money keys are present; leave the rest unchanged.
const INVOICE_MONEY_KEYS = [
  "subtotal", "tax", "total",
  "amountPaid", "balanceDue",          // camelCase (Drizzle)
  "amount_paid", "balance_due",        // snake_case (raw SQL)
] as const;

function invoiceOut<T extends Record<string, unknown>>(row: T): T {
  const out: Record<string, unknown> = { ...row };
  for (const key of INVOICE_MONEY_KEYS) {
    const v = out[key];
    if (typeof v === "number") out[key] = centsToDollars(v);
  }
  return out as T;
}

function paymentOut<T extends { amount?: number | null }>(row: T): T & { amount: number } {
  return { ...row, amount: row.amount == null ? 0 : centsToDollars(row.amount) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

// All optional-fields use `.nullable().optional()` so FE forms that send
// `null` for "user left blank" pass validation. Drizzle treats null and
// undefined identically when inserting into a nullable column.
const residentSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  dob: z.number().int().nullable().optional(),
  gender: z.string().nullable().optional(),
  ssnLast4: z.string().max(4).nullable().optional(),
  admissionDate: z.number().int().nullable().optional(),
  roomNumber: z.string().nullable().optional(),
  bedNumber: z.string().nullable().optional(),
  primaryDx: z.string().nullable().optional(),
  secondaryDx: z.string().nullable().optional(),
  levelOfCare: z.string().nullable().optional(),
  emergencyContactName: z.string().nullable().optional(),
  emergencyContactPhone: z.string().nullable().optional(),
  emergencyContactRelation: z.string().nullable().optional(),
  fundingSource: z.string().nullable().optional(),
  regionalCenterId: z.string().nullable().optional(),
  status: z.string().optional(),
  dischargeDate: z.number().int().nullable().optional(),
});

const assessmentSchema = z.object({
  assessmentType: z.string().min(1),
  assessedBy: z.string().min(1),
  assessedAt: z.number().int(),
  bathing: z.number().int().nullable().optional(),
  dressing: z.number().int().nullable().optional(),
  grooming: z.number().int().nullable().optional(),
  toileting: z.number().int().nullable().optional(),
  continence: z.number().int().nullable().optional(),
  eating: z.number().int().nullable().optional(),
  mobility: z.number().int().nullable().optional(),
  transfers: z.number().int().nullable().optional(),
  mealPrep: z.number().int().nullable().optional(),
  housekeeping: z.number().int().nullable().optional(),
  laundry: z.number().int().nullable().optional(),
  transportation: z.number().int().nullable().optional(),
  finances: z.number().int().nullable().optional(),
  communication: z.number().int().nullable().optional(),
  cognitionScore: z.number().int().nullable().optional(),
  behaviorNotes: z.string().nullable().optional(),
  fallRiskLevel: z.string().nullable().optional(),
  vision: z.string().nullable().optional(),
  hearing: z.string().nullable().optional(),
  speech: z.string().nullable().optional(),
  ambulation: z.string().nullable().optional(),
  selfAdministerMeds: z.number().int().nullable().optional(),
  nextDueDate: z.number().int().nullable().optional(),
  licFormNumber: z.string().nullable().optional(),
  rawJson: z.string().nullable().optional(),
});

const carePlanSchema = z.object({
  createdBy: z.string().min(1),
  effectiveDate: z.number().int(),
  reviewDate: z.number().int(),
  goal: z.string().min(1),
  intervention: z.string().min(1),
  frequency: z.string().min(1),
  responsibleStaff: z.string().nullable().optional(),
  status: z.string().optional(),
});

// Below — `.strict()` on small, single-purpose schemas so any unknown field
// in the request surfaces as a 400 rather than being silently dropped. The
// only thing that breaks is sending fields nobody asked for; legitimate
// callers are unaffected.
const signCarePlanSchema = z.object({
  signerType: z.enum(["resident", "family"]),
  signature: z.string().min(1),
}).strict();

const completeTaskSchema = z.object({
  notes: z.string(),
}).strict();

const refuseTaskSchema = z.object({
  reason: z.string().min(1),
}).strict();

// Manual task creation — independent of a care plan. Used by the "Add Task"
// dialog so users can put a task on the calendar without having to create a
// full care plan first.
// `.strict()` so any unknown field surfaces as a 400 instead of being
// silently dropped (the same bug class that broke tour scheduling).
const manualTaskSchema = z.object({
  residentId: z.number().int().positive(),
  taskName:   z.string().min(1, "Task name is required"),
  taskType:   z.string().min(1).default("manual"),
  taskDate:   z.number().int().positive(),                    // Unix ms (start of local day)
  scheduledTime: z.string().regex(/^\d{1,2}:\d{2}$/).nullable().optional(), // "HH:MM" 24h
  shift:      z.enum(["day", "evening", "night", "AM", "PM", "NOC"]).nullable().optional(),
  assignedTo: z.string().nullable().optional(),
}).strict();

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
    .nullable()
    .optional(),
  reasonNote: z.string().nullable().optional(),
  discontinuedBy: z.string().min(1).nullable().optional(),
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
  administeredDatetime: z.number().int().nullable().optional(),
  administeredBy: z.string().nullable().optional(),
  witnessBy: z.string().nullable().optional(),
  rightResident: z.number().int().nullable().optional(),
  rightMedication: z.number().int().nullable().optional(),
  rightDose: z.number().int().nullable().optional(),
  rightRoute: z.number().int().nullable().optional(),
  rightTime: z.number().int().nullable().optional(),
  rightReason: z.number().int().nullable().optional(),
  rightDocumentation: z.number().int().nullable().optional(),
  rightToRefuse: z.number().int().nullable().optional(),
  status: z.string().optional(),
  refusalReason: z.string().nullable().optional(),
  holdReason: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  preVitalsBp: z.string().nullable().optional(),
  preVitalsPulse: z.number().int().nullable().optional(),
  preVitalsTemp: z.number().nullable().optional(),
  preVitalsSpo2: z.number().int().nullable().optional(),
  prnReason: z.string().nullable().optional(),
});

const prnFollowupSchema = z.object({
  effectivenessNotes: z.string().min(1),
  notedAt: z.number().int(),
}).strict();

const controlledSubCountSchema = z.object({
  medicationId: z.number().int(),
  facilityNumber: z.string().min(1),
  countDate: z.number().int(),
  shift: z.string().min(1),
  countedBy: z.string().min(1),
  witnessedBy: z.string().min(1),
  openingCount: z.number().int(),
  closingCount: z.number().int(),
  administeredCount: z.number().int().nullable().optional(),
  wastedCount: z.number().int().nullable().optional(),
  discrepancy: z.number().int().nullable().optional(),
  discrepancyNotes: z.string().nullable().optional(),
  resolved: z.number().int().nullable().optional(),
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
  residentId: z.number().int().nullable().optional(),
  incidentType: z.string().min(1),
  incidentDate: z.number().int(),
  incidentTime: z.string().nullable().optional(),
  location: z.string().nullable().optional(),
  description: z.string().min(1),
  immediateActionTaken: z.string().nullable().optional(),
  injuryInvolved: z.number().int().nullable().optional(),
  injuryDescription: z.string().nullable().optional(),
  hospitalizationRequired: z.number().int().nullable().optional(),
  hospitalName: z.string().nullable().optional(),
  reportedBy: z.string().min(1),
  supervisorNotified: z.number().int().nullable().optional(),
  supervisorNotifiedAt: z.number().int().nullable().optional(),
  familyNotified: z.number().int().nullable().optional(),
  familyNotifiedAt: z.number().int().nullable().optional(),
  physicianNotified: z.number().int().nullable().optional(),
  physicianNotifiedAt: z.number().int().nullable().optional(),
  lic624Submitted: z.number().int().nullable().optional(),
  lic624SubmittedAt: z.number().int().nullable().optional(),
  soc341Required: z.number().int().nullable().optional(),
  soc341Submitted: z.number().int().nullable().optional(),
  rootCause: z.string().nullable().optional(),
  correctiveAction: z.string().nullable().optional(),
  followUpDate: z.number().int().nullable().optional(),
  followUpCompleted: z.number().int().nullable().optional(),
  status: z.string().optional(),
});

const leadSchema = z.object({
  contactName: z.string().min(1),
  contactPhone: z.string().nullable().optional(),
  // Allow empty string ("") and literal null in addition to a valid email.
  contactEmail: z.union([z.string().email(), z.literal("")]).nullable().optional(),
  contactRelation: z.string().nullable().optional(),
  prospectName: z.string().min(1),
  prospectDob: z.number().int().nullable().optional(),
  prospectGender: z.string().nullable().optional(),
  careNeedsSummary: z.string().nullable().optional(),
  fundingSource: z.string().nullable().optional(),
  desiredMoveInDate: z.number().int().nullable().optional(),
  referralSource: z.string().nullable().optional(),
  assignedTo: z.string().nullable().optional(),
  stage: z.string().optional(),
  lostReason: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  lastContactDate: z.number().int().nullable().optional(),
  nextFollowUpDate: z.number().int().nullable().optional(),
});

const tourSchema = z.object({
  scheduledAt: z.number().int(),
  conductedBy: z.string().nullable().optional(),
  outcome: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  followUpAction: z.string().nullable().optional(),
  completedAt: z.number().int().nullable().optional(),
}).strict();

const admissionSchema = z.object({
  leadId: z.number().int(),
  facilityNumber: z.string().min(1),
  moveInDate: z.number().int().nullable().optional(),
  assignedRoom: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
});

const licFormSchema = z.object({
  completed: z.boolean(),
});

const chargeSchema = z.object({
  facilityNumber: z.string().min(1),
  residentId: z.number().int(),
  chargeType: z.string().min(1),
  description: z.string().min(1),
  // amount is dollars on the wire (Phase 2 R2). Converted to BIGINT cents
  // at the route boundary before passing to storage.
  amount: z.number(),
  unit: z.string().nullable().optional(),
  quantity: z.number().nullable().optional(),
  billingPeriodStart: z.number().int().nullable().optional(),
  billingPeriodEnd: z.number().int().nullable().optional(),
  isRecurring: z.number().int().nullable().optional(),
  recurrenceInterval: z.string().nullable().optional(),
  prorated: z.number().int().nullable().optional(),
  prorateFrom: z.number().int().nullable().optional(),
  prorateTo: z.number().int().nullable().optional(),
  source: z.string().optional(),
  clinicalRefId: z.number().int().nullable().optional(),
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
  // amount is dollars on the wire (Phase 2 R2). Converted to BIGINT cents
  // at the route boundary before passing to storage.
  amount: z.number(),
  paymentDate: z.number().int(),
  paymentMethod: z.string().min(1),
  referenceNumber: z.string().nullable().optional(),
  type: z.string().optional(),
  notes: z.string().nullable().optional(),
  recordedBy: z.string().nullable().optional(),
});

// facilityNumber is intentionally NOT in the body schema — the server pulls
// it from the authenticated session in the route handler. Letting clients
// claim a facility in the request body is a scope risk; before this fix
// the frontend never sent it, so the schema rejected every Add Staff /
// Add Shift submit (Group A latent contract bug).
const staffSchema = z.object({
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  // Allow empty string for the FE form's "left blank" state.
  email: z.union([z.string().email(), z.literal("")]).nullable().optional(),
  phone: z.string().nullable().optional(),
  role: z.string().min(1),
  hireDate: z.number().int().nullable().optional(),
  licenseNumber: z.string().nullable().optional(),
  licenseExpiry: z.number().int().nullable().optional(),
  status: z.string().optional(),
}).strict();

const shiftSchema = z.object({
  staffId: z.number().int(),
  shiftDate: z.number().int(),
  shiftType: z.string().min(1),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  isOvertime: z.number().int().nullable().optional(),
  status: z.string().optional(),
  coveredById: z.number().int().nullable().optional(),
  notes: z.string().nullable().optional(),
}).strict();

// Group A contract fix: facilityNumber pulled from session (not body),
// itemType kept permissive (the FE COMPLIANCE_TYPES list and the BE list
// don't overlap — aligning them is a separate BA-5 product decision),
// dueDate is required because ops_compliance_calendar.due_date is NOT NULL
// at the DB layer. BE-9 future-date refine applies on top.
const complianceItemSchema = z.object({
  itemType: z.string().min(1, "Pick a compliance type"),
  description: z.string().min(1, "Add a brief description"),
  dueDate: z.number().int({ message: "Pick a due date" }).refine(
    (ts) => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      return ts >= today.getTime();
    },
    { message: "Due date must be today or later" },
  ),
  assignedTo: z.string().nullable().optional(),
  status: z.string().optional(),
  reminderDaysBefore: z.number().int().nullable().optional(),
}).strict();

const completeComplianceSchema = z.object({
  completedDate: z.number().int(),
}).strict();

// ─────────────────────────────────────────────────────────────────────────────
// Module 1 — Residents
// ─────────────────────────────────────────────────────────────────────────────

// GET /facilities/:facilityNumber/residents — facility-scoped list (used by portal pages)
opsRouter.get("/facilities/:facilityNumber/residents", requireOpsPermission(OPS_RESOURCES.RESIDENT, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const status = req.query.status ? String(req.query.status) : undefined;
    const result = await ops.listResidents(facilityNumber, { page, limit, status });
    res.json({ success: true, data: result.residents, meta: { total: result.total, page, limit } });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/residents/:id — facility-scoped single resident
opsRouter.get("/facilities/:facilityNumber/residents/:id", requireOpsPermission(OPS_RESOURCES.RESIDENT, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const resident = await ops.getResident(id, facilityNumber);
    if (!resident) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: resident });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/residents/:id/assessments
opsRouter.get("/facilities/:facilityNumber/residents/:id/assessments", requireOpsPermission(OPS_RESOURCES.RESIDENT_ASSESSMENT, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const assessments = await ops.listAssessments(id, facilityNumber);
    res.json({ success: true, data: assessments });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /facilities/:facilityNumber/residents/:id/assessments
opsRouter.post("/facilities/:facilityNumber/residents/:id/assessments", requireOpsPermission(OPS_RESOURCES.RESIDENT_ASSESSMENT, "create"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const residentId = parseInt(String(req.params.id), 10);
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
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/residents/:id/care-plan
opsRouter.get("/facilities/:facilityNumber/residents/:id/care-plan", requireOpsPermission(OPS_RESOURCES.CARE_PLAN, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const plan = await ops.getActiveCarePlan(id, facilityNumber);
    if (!plan) return res.status(404).json({ success: false, error: "No active care plan" });
    res.json({ success: true, data: plan });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/residents/:id/daily-tasks
//
// `?date=` is interpreted as ANY clock value within the desired day.
// We normalize to the half-open `[startOfDay, startOfDay + 24h)`
// window before querying. The legacy implementation compared the
// raw clock value to ops_daily_tasks.task_date via equality, which
// never matched because task_date is normalized to start-of-day at
// insert time; the resident profile "Today's Tasks" tab was
// silently empty as a result.
opsRouter.get("/facilities/:facilityNumber/residents/:id/daily-tasks", requireOpsPermission(OPS_RESOURCES.DAILY_TASK, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const residentId = parseInt(String(req.params.id), 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const refClock = req.query.date ? parseInt(String(req.query.date), 10) : Date.now();
    const startOfDay = (() => {
      const d = new Date(refClock);
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime();
    })();
    const endOfDay = startOfDay + 86400000;
    const shift = req.query.shift ? String(req.query.shift) : undefined;
    const tasks = await ops.getDailyTasks(residentId, facilityNumber, startOfDay, endOfDay, shift);
    res.json({ success: true, data: tasks });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/overdue-tasks
// Facility-wide list of pending tasks whose task_date is before today.
// Drives the dashboard "Overdue Tasks" KPI sub-view so the user can act on
// each row without first picking a resident.
opsRouter.get("/facilities/:facilityNumber/overdue-tasks", requireOpsPermission(OPS_RESOURCES.DAILY_TASK, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const tasks = await ops.getOverdueTasksForFacility(facilityNumber);
    res.json({ success: true, data: tasks });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/residents/:id/medications
opsRouter.get("/facilities/:facilityNumber/residents/:id/medications", requireOpsPermission(OPS_RESOURCES.MEDICATION, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const residentId = parseInt(String(req.params.id), 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const status = req.query.status ? String(req.query.status) : undefined;
    const meds = await ops.listMedications(residentId, facilityNumber, status);
    res.json({ success: true, data: meds.map(normalizeMedicationRow) });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /facilities/:facilityNumber/residents/:id/medications
opsRouter.post("/facilities/:facilityNumber/residents/:id/medications", requireOpsPermission(OPS_RESOURCES.MEDICATION, "create"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const residentId = parseInt(String(req.params.id), 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = MedicationCreateInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const storagePayload = toStorageShape(parsed.data);
    const med = await ops.createMedication(
      { ...storagePayload, residentId, facilityNumber, createdAt: now, updatedAt: now },
      getActor(req),
    );
    res.status(201).json({ success: true, data: normalizeMedicationRow(med) });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/residents/:id/incidents
opsRouter.get("/facilities/:facilityNumber/residents/:id/incidents", requireOpsPermission(OPS_RESOURCES.INCIDENT, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const residentId = parseInt(String(req.params.id), 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const result = await ops.listIncidents(facilityNumber, { page, limit, residentId });
    res.json({ success: true, data: result.incidents, meta: { total: result.total, page, limit } });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /residents
opsRouter.get("/residents", requireOpsPermission(OPS_RESOURCES.RESIDENT, "read"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const status = req.query.status ? String(req.query.status) : undefined;
    const result = await ops.listResidents(facilityNumber, { page, limit, status });
    res.json({ success: true, data: result.residents, meta: { total: result.total, page, limit } });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /residents
opsRouter.post("/residents", requireOpsPermission(OPS_RESOURCES.RESIDENT, "create"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const parsed = residentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const resident = await ops.createResident(
      {
        ...parsed.data,
        facilityNumber,
        createdAt: now,
        updatedAt: now,
      },
      getActor(req),
    );
    res.status(201).json({ success: true, data: resident });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /residents/:id
opsRouter.get("/residents/:id", requireOpsPermission(OPS_RESOURCES.RESIDENT, "read"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const resident = await ops.getResident(id, facilityNumber);
    if (!resident) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: resident });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// PUT /residents/:id
opsRouter.put("/residents/:id", requireOpsPermission(OPS_RESOURCES.RESIDENT, "update"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = residentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const resident = await ops.updateResident(id, facilityNumber, parsed.data, getActor(req));
    if (!resident) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: resident });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// DELETE /residents/:id (soft delete)
opsRouter.delete("/residents/:id", requireOpsPermission(OPS_RESOURCES.RESIDENT, "delete"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const ok = await ops.softDeleteResident(id, facilityNumber, getActor(req));
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /residents/:id/assessments
opsRouter.get("/residents/:id/assessments", requireOpsPermission(OPS_RESOURCES.RESIDENT_ASSESSMENT, "read"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const assessments = await ops.listAssessments(id, facilityNumber);
    res.json({ success: true, data: assessments });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /residents/:id/assessments
opsRouter.post("/residents/:id/assessments", requireOpsPermission(OPS_RESOURCES.RESIDENT_ASSESSMENT, "create"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(String(req.params.id), 10);
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
    return handleRouteError(req, e, res);
  }
});

// PUT /assessments/:id
opsRouter.put("/assessments/:id", requireOpsPermission(OPS_RESOURCES.RESIDENT_ASSESSMENT, "update"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = assessmentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const assessment = await ops.updateAssessment(id, parsed.data);
    if (!assessment) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: assessment });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /residents/:id/care-plan
opsRouter.get("/residents/:id/care-plan", requireOpsPermission(OPS_RESOURCES.CARE_PLAN, "read"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const plan = await ops.getActiveCarePlan(id, facilityNumber);
    if (!plan) return res.status(404).json({ success: false, error: "No active care plan" });
    res.json({ success: true, data: plan });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /residents/:id/care-plan
opsRouter.post("/residents/:id/care-plan", requireOpsPermission(OPS_RESOURCES.CARE_PLAN, "create"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(String(req.params.id), 10);
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
    return handleRouteError(req, e, res);
  }
});

// PUT /care-plans/:id
opsRouter.put("/care-plans/:id", requireOpsPermission(OPS_RESOURCES.CARE_PLAN, "update"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = carePlanSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const plan = await ops.updateCarePlan(id, parsed.data);
    if (!plan) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: plan });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /care-plans/:id/sign
opsRouter.post("/care-plans/:id/sign", requireOpsPermission(OPS_RESOURCES.CARE_PLAN, "update"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = signCarePlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = await ops.signCarePlan(id, parsed.data.signerType, parsed.data.signature);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /residents/:id/tasks — same semantics as the /facilities/.../daily-tasks
// route above; `?date=` is treated as any clock value within the desired
// day and normalized to a half-open `[startOfDay, startOfDay + 24h)`
// window so callers passing `Date.now()` reliably get today's tasks.
opsRouter.get("/residents/:id/tasks", requireOpsPermission(OPS_RESOURCES.DAILY_TASK, "read"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(String(req.params.id), 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });

    const refClock = req.query.date ? parseInt(String(req.query.date), 10) : Date.now();
    const startOfDay = (() => {
      const d = new Date(refClock);
      d.setUTCHours(0, 0, 0, 0);
      return d.getTime();
    })();
    const endOfDay = startOfDay + 86400000;
    const shift = req.query.shift ? String(req.query.shift) : undefined;

    const tasks = await ops.getDailyTasks(residentId, facilityNumber, startOfDay, endOfDay, shift);
    res.json({ success: true, data: tasks });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /tasks — direct task creation (no care plan required).
opsRouter.post("/tasks", requireOpsPermission(OPS_RESOURCES.DAILY_TASK, "create"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const parsed = manualTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const task = await ops.createManualDailyTask({
      facilityNumber,
      residentId:   parsed.data.residentId,
      taskName:     parsed.data.taskName,
      taskType:     parsed.data.taskType,
      taskDate:     parsed.data.taskDate,
      // Storage expects `string | undefined`; coerce any FE-sent null.
      scheduledTime: parsed.data.scheduledTime ?? undefined,
      shift:         parsed.data.shift ?? undefined,
      assignedTo:    parsed.data.assignedTo ?? undefined,
    });
    res.status(201).json({ success: true, data: task });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// PUT /tasks/:id/complete
opsRouter.put("/tasks/:id/complete", requireOpsPermission(OPS_RESOURCES.DAILY_TASK, "update"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = completeTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = await ops.completeTask(id, parsed.data.notes, Date.now());
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// PUT /tasks/:id/refuse
opsRouter.put("/tasks/:id/refuse", requireOpsPermission(OPS_RESOURCES.DAILY_TASK, "update"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = refuseTaskSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = await ops.refuseTask(id, parsed.data.reason);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 2 — eMAR
// ─────────────────────────────────────────────────────────────────────────────

// GET /residents/:id/medications
opsRouter.get("/residents/:id/medications", requireOpsPermission(OPS_RESOURCES.MEDICATION, "read"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(String(req.params.id), 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const status = req.query.status ? String(req.query.status) : undefined;
    const meds = await ops.listMedications(residentId, facilityNumber, status);
    res.json({ success: true, data: meds.map(normalizeMedicationRow) });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /residents/:id/medications
opsRouter.post("/residents/:id/medications", requireOpsPermission(OPS_RESOURCES.MEDICATION, "create"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(String(req.params.id), 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = MedicationCreateInput.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const storagePayload = toStorageShape(parsed.data);
    const med = await ops.createMedication(
      {
        ...storagePayload,
        residentId,
        facilityNumber,
        createdAt: now,
        updatedAt: now,
      },
      getActor(req),
    );
    res.status(201).json({ success: true, data: normalizeMedicationRow(med) });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// PUT /medications/:id
opsRouter.put("/medications/:id", requireOpsPermission(OPS_RESOURCES.MEDICATION, "update"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
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
    const med = await ops.updateMedication(id, facilityNumber, storagePayload, getActor(req));
    if (!med) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: normalizeMedicationRow(med) });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// DELETE /medications/:id (discontinue)
opsRouter.delete("/medications/:id", requireOpsPermission(OPS_RESOURCES.MEDICATION, "delete"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
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
    const ok = await ops.discontinueMedication(id, facilityNumber, reason, by, getActor(req));
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    return handleRouteError(req, e, res);
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
opsRouter.get("/facilities/:facilityNumber/med-pass/summary", requireOpsPermission(OPS_RESOURCES.MED_PASS, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
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
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
opsRouter.get("/facilities/:facilityNumber/calendar", requireOpsPermission(OPS_RESOURCES.DASHBOARD, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
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
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/med-pass
opsRouter.get("/facilities/:facilityNumber/med-pass", requireOpsPermission(OPS_RESOURCES.MED_PASS, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
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
    return handleRouteError(req, e, res);
  }
});

// GET /residents/:id/med-pass
opsRouter.get("/residents/:id/med-pass", requireOpsPermission(OPS_RESOURCES.MED_PASS, "read"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(String(req.params.id), 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const date = req.query.date ? parseInt(String(req.query.date), 10) : (() => {
      const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime();
    })();
    const queue = await ops.getResidentMedPassQueue(residentId, facilityNumber, date);
    res.json({ success: true, data: queue });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /med-passes
opsRouter.post("/med-passes", requireOpsPermission(OPS_RESOURCES.MED_PASS, "create"), async (req, res) => {
  try {
    const parsed = medPassSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const medPass = await ops.recordMedPass({ ...parsed.data, createdAt: Date.now() }, getActor(req));
    res.status(201).json({ success: true, data: medPass });
  } catch (e) {
    return handleRouteError(req, e, res);
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

opsRouter.put("/med-passes/:id", requireOpsPermission(OPS_RESOURCES.MED_PASS, "update"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = chartMedPassSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = await ops.updateMedPassRecord(id, parsed.data, getActor(req));
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// PUT /med-passes/:id/prn-followup
opsRouter.put("/med-passes/:id/prn-followup", requireOpsPermission(OPS_RESOURCES.MED_PASS, "update"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = prnFollowupSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = await ops.updatePrnFollowup(id, parsed.data.effectivenessNotes, parsed.data.notedAt);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/emar-dashboard
opsRouter.get("/facilities/:facilityNumber/emar-dashboard", requireOpsPermission(OPS_RESOURCES.MED_PASS, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const date = req.query.date ? parseInt(String(req.query.date), 10) : (() => {
      const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d.getTime();
    })();
    const dashboard = await ops.getMedPassDashboard(facilityNumber, date);
    res.json({ success: true, data: dashboard });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/med-refusals
opsRouter.get("/facilities/:facilityNumber/med-refusals", requireOpsPermission(OPS_RESOURCES.MED_PASS, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const start = parseInt(String(req.query.start ?? "0"), 10);
    const end = parseInt(String(req.query.end ?? Date.now()), 10);
    const refusals = await ops.getMedRefusals(facilityNumber, start, end);
    res.json({ success: true, data: refusals });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/prn-report
opsRouter.get("/facilities/:facilityNumber/prn-report", requireOpsPermission(OPS_RESOURCES.MED_PASS, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const start = parseInt(String(req.query.start ?? "0"), 10);
    const end = parseInt(String(req.query.end ?? Date.now()), 10);
    const report = await ops.getPrnReport(facilityNumber, start, end);
    res.json({ success: true, data: report });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /medications/:id/request-refill
opsRouter.post("/medications/:id/request-refill", requireOpsPermission(OPS_RESOURCES.MEDICATION, "update"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const existing = await ops.getMedication(id, facilityNumber);
    if (!existing) return res.status(404).json({ success: false, error: "Not found" });
    if (existing.status === "discontinued") {
      return res.status(409).json({ success: false, error: "Cannot request refill for a discontinued medication." });
    }
    const med = await ops.updateMedication(
      id,
      facilityNumber,
      { autoRefillRequest: 1 },
      getActor(req),
    );
    if (!med) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: normalizeMedicationRow(med) });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /controlled-sub-counts
opsRouter.post("/controlled-sub-counts", requireOpsPermission(OPS_RESOURCES.CONTROLLED_SUB_COUNT, "resolve"), async (req, res) => {
  try {
    const parsed = controlledSubCountSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const record = await ops.recordControlledSubCount({ ...nullsToUndef(parsed.data), createdAt: Date.now() });
    res.status(201).json({ success: true, data: record });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /med-destruction
opsRouter.post("/med-destruction", requireOpsPermission(OPS_RESOURCES.MED_DESTRUCTION, "create"), async (req, res) => {
  try {
    const parsed = medDestructionSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const record = await ops.recordMedDestruction({ ...parsed.data, createdAt: Date.now() });
    res.status(201).json({ success: true, data: record });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 3 — Incidents
// ─────────────────────────────────────────────────────────────────────────────

// GET /facilities/:facilityNumber/incidents
opsRouter.get("/facilities/:facilityNumber/incidents", requireOpsPermission(OPS_RESOURCES.INCIDENT, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const type = req.query.type ? String(req.query.type) : undefined;
    const residentId = req.query.residentId
      ? parseInt(String(req.query.residentId), 10)
      : undefined;
    const result = await ops.listIncidents(facilityNumber, { page, limit, type, residentId });
    res.json({ success: true, data: result.incidents, meta: { total: result.total, page, limit } });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /incidents
opsRouter.post("/incidents", requireOpsPermission(OPS_RESOURCES.INCIDENT, "create"), async (req, res) => {
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
    return handleRouteError(req, e, res);
  }
});

// PUT /incidents/:id
opsRouter.put("/incidents/:id", requireOpsPermission(OPS_RESOURCES.INCIDENT, "update"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = incidentSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const incident = await ops.updateIncident(id, facilityNumber, parsed.data);
    if (!incident) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: incident });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /incidents/:id/lic624
opsRouter.get("/incidents/:id/lic624", requireOpsPermission(OPS_RESOURCES.INCIDENT, "read"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
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
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/incident-trends
opsRouter.get("/facilities/:facilityNumber/incident-trends", requireOpsPermission(OPS_RESOURCES.INCIDENT, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const days = parseInt(String(req.query.days ?? "30"), 10) || 30;
    const trends = await ops.getIncidentTrends(facilityNumber, days);
    res.json({ success: true, data: trends });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 4 — CRM / Admissions
// ─────────────────────────────────────────────────────────────────────────────

// GET /facilities/:facilityNumber/leads
opsRouter.get("/facilities/:facilityNumber/leads", requireOpsPermission(OPS_RESOURCES.LEAD, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const { page, limit } = parsePagination(req.query as Record<string, unknown>);
    const stage = req.query.stage ? String(req.query.stage) : undefined;
    const result = await ops.listLeads(facilityNumber, { page, limit, stage });
    res.json({ success: true, data: result.leads, meta: { total: result.total, page, limit } });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /leads
opsRouter.post("/leads", requireOpsPermission(OPS_RESOURCES.LEAD, "create"), async (req, res) => {
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
    return handleRouteError(req, e, res);
  }
});

// PUT /leads/:id
opsRouter.put("/leads/:id", requireOpsPermission(OPS_RESOURCES.LEAD, "update"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = leadSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const lead = await ops.updateLead(id, facilityNumber, parsed.data);
    if (!lead) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: lead });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /leads/:id
opsRouter.get("/leads/:id", requireOpsPermission(OPS_RESOURCES.LEAD, "read"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const lead = await ops.getLead(id, facilityNumber);
    if (!lead) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: lead });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /leads/:id/tours
// Creating a tour also advances the lead's stage to "tour_scheduled" so
// pipeline reports stay consistent. Both writes happen on the same DB
// connection so a frontend that only made a single call still gets
// atomic semantics — the FE is no longer responsible for sequencing.
opsRouter.post("/leads/:id/tours", requireOpsPermission(OPS_RESOURCES.TOUR, "create"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const leadId = parseInt(String(req.params.id), 10);
    if (isNaN(leadId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = tourSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const tour = await ops.scheduleTour({ ...parsed.data, leadId, facilityNumber, createdAt: now });
    // Best-effort stage bump; failure here doesn't roll back the tour, but
    // it does log so monitoring can catch drift.
    try {
      await ops.updateLead(leadId, facilityNumber, { stage: "tour_scheduled" });
    } catch (e) {
      console.warn("[ops] tour created but lead stage update failed", { leadId, e });
    }
    res.status(201).json({ success: true, data: tour });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// PUT /tours/:id
opsRouter.put("/tours/:id", requireOpsPermission(OPS_RESOURCES.TOUR, "update"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
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
    return handleRouteError(req, e, res);
  }
});

// POST /leads/:id/admissions
opsRouter.post("/leads/:id/admissions", requireOpsPermission(OPS_RESOURCES.ADMISSION, "create"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const leadId = parseInt(String(req.params.id), 10);
    if (isNaN(leadId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = admissionSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    const admission = await ops.startAdmission(
      {
        leadId,
        facilityNumber,
        ...parsed.data,
        createdAt: now,
        updatedAt: now,
      },
      getActor(req),
    );
    // Advance lead stage
    await ops.updateLead(leadId, facilityNumber, { stage: "admission_in_progress" });
    res.status(201).json({ success: true, data: admission });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/leads/:leadId/admissions
// Finds or creates the admission record for a lead, returns { lead, forms, admissionId }
opsRouter.get("/facilities/:facilityNumber/leads/:leadId/admissions", requireOpsPermission(OPS_RESOURCES.ADMISSION, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const leadIdStr = String(req.params.leadId);
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
      const created = await ops.startAdmission(
        { leadId, facilityNumber, createdAt: Date.now(), updatedAt: Date.now() },
        getActor(req),
      );
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
    return handleRouteError(req, e, res);
  }
});

// PUT /leads/:leadId/lic/:form
// Update LIC form completion for the admission belonging to this lead
opsRouter.put("/leads/:leadId/lic/:form", requireOpsPermission(OPS_RESOURCES.ADMISSION, "update"), async (req, res) => {
  try {
    const leadId = parseInt(String(req.params.leadId), 10);
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
    const rawForm = String(req.params.form);
    const normalizedForm = rawForm.replace(/^lic(\d)/, "lic_$1");
    const ok = await ops.updateAdmissionLicForm(row.id, normalizedForm, parsed.data.completed, getActor(req));
    if (!ok) return res.status(404).json({ success: false, error: "Not found or invalid form" });
    res.json({ success: true });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /leads/:leadId/convert
// Convert the admission for this lead into a resident record
opsRouter.post("/leads/:leadId/convert", requireOpsPermission(OPS_RESOURCES.ADMISSION, "update"), async (req, res) => {
  try {
    const leadId = parseInt(String(req.params.leadId), 10);
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
    return handleRouteError(req, e, res);
  }
});

// GET /admissions/:id/lic-checklist
opsRouter.get("/admissions/:id/lic-checklist", requireOpsPermission(OPS_RESOURCES.ADMISSION, "read"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
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
    return handleRouteError(req, e, res);
  }
});

// PUT /admissions/:id/lic/:form
opsRouter.put("/admissions/:id/lic/:form", requireOpsPermission(OPS_RESOURCES.ADMISSION, "update"), async (req, res) => {
  try {
    const admissionId = parseInt(String(req.params.id), 10);
    if (isNaN(admissionId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const form = String(req.params.form);
    const parsed = licFormSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = await ops.updateAdmissionLicForm(admissionId, form, parsed.data.completed, getActor(req));
    if (!ok) return res.status(404).json({ success: false, error: "Not found or invalid form" });
    res.json({ success: true });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /admissions/:id/convert
opsRouter.post("/admissions/:id/convert", requireOpsPermission(OPS_RESOURCES.ADMISSION, "update"), async (req, res) => {
  try {
    const admissionId = parseInt(String(req.params.id), 10);
    if (isNaN(admissionId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const resident = await ops.convertAdmissionToResident(admissionId);
    if (!resident) return res.status(404).json({ success: false, error: "Admission not found or lead missing" });
    res.status(201).json({ success: true, data: resident });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/occupancy
opsRouter.get("/facilities/:facilityNumber/occupancy", requireOpsPermission(OPS_RESOURCES.DASHBOARD, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const occupancy = await ops.getOccupancy(facilityNumber);
    res.json({ success: true, data: occupancy });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/crm-pipeline
opsRouter.get("/facilities/:facilityNumber/crm-pipeline", requireOpsPermission(OPS_RESOURCES.LEAD, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);

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
    return handleRouteError(req, e, res);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 5 — Billing
// ─────────────────────────────────────────────────────────────────────────────

// GET /residents/:id/billing
opsRouter.get("/residents/:id/billing", requireOpsPermission(OPS_RESOURCES.BILLING, "read"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const residentId = parseInt(String(req.params.id), 10);
    if (isNaN(residentId)) return res.status(400).json({ success: false, error: "Invalid id" });
    const charges = await ops.listCharges(facilityNumber, residentId);

    const r = await pool.query<Record<string, unknown>>(
      `SELECT * FROM ops_invoices WHERE facility_number = $1 AND resident_id = $2 ORDER BY created_at DESC`,
      [facilityNumber, residentId]
    );
    const invoices = r.rows.map(invoiceOut);

    // Cents -> dollars at the wire boundary (Phase 2 R2).
    res.json({ success: true, data: { charges: charges.map(chargeOut), invoices } });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /billing/charges
opsRouter.post("/billing/charges", requireOpsPermission(OPS_RESOURCES.BILLING, "create"), async (req, res) => {
  try {
    const parsed = chargeSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    // Dollars -> cents at the wire boundary (Phase 2 R2). Storage is cents.
    const stripped = nullsToUndef(parsed.data);
    const charge = await ops.createCharge({
      ...stripped,
      amount: dollarsToCents(parsed.data.amount),
      createdAt: Date.now(),
    });
    res.status(201).json({ success: true, data: chargeOut(charge) });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// PUT /billing/charges/:id
opsRouter.put("/billing/charges/:id", requireOpsPermission(OPS_RESOURCES.BILLING, "update"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
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

    // amount on the wire is dollars; existing["amount"] is already cents
    // (BIGINT) — only convert when the caller supplied a new value.
    const amountCents = d.amount !== undefined
      ? dollarsToCents(d.amount)
      : existing["amount"];

    await pool.query(
      `UPDATE ops_billing_charges SET charge_type=$1, description=$2, amount=$3, unit=$4, quantity=$5, billing_period_start=$6, billing_period_end=$7, is_recurring=$8, recurrence_interval=$9, prorated=$10, prorate_from=$11, prorate_to=$12, source=$13, clinical_ref_id=$14 WHERE id=$15`,
      [
        d.chargeType         ?? existing["charge_type"],
        d.description        ?? existing["description"],
        amountCents,
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
    return handleRouteError(req, e, res);
  }
});

// DELETE /billing/charges/:id
opsRouter.delete("/billing/charges/:id", requireOpsPermission(OPS_RESOURCES.BILLING, "delete"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const ok = await ops.deleteCharge(id, facilityNumber);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /billing/invoices/generate
opsRouter.post("/billing/invoices/generate", requireOpsPermission(OPS_RESOURCES.BILLING, "create"), async (req, res) => {
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
    // Cents -> dollars at the wire boundary (Phase 2 R2).
    res.status(201).json({ success: true, data: invoiceOut(invoice) });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /billing/invoices/:id
opsRouter.get("/billing/invoices/:id", requireOpsPermission(OPS_RESOURCES.BILLING, "read"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const invoice = await ops.getInvoice(id);
    if (!invoice) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: invoiceOut(invoice) });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// PUT /billing/invoices/:id/send
opsRouter.put("/billing/invoices/:id/send", requireOpsPermission(OPS_RESOURCES.BILLING, "update"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const ok = await ops.markInvoiceSent(id);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /billing/payments
opsRouter.post("/billing/payments", requireOpsPermission(OPS_RESOURCES.BILLING, "create"), async (req, res) => {
  try {
    const parsed = paymentSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    // Dollars -> cents at the wire boundary (Phase 2 R2). Storage is cents.
    const payment = await ops.recordPayment({
      ...parsed.data,
      amount: dollarsToCents(parsed.data.amount),
      createdAt: Date.now(),
    });
    res.status(201).json({ success: true, data: paymentOut(payment) });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/ar-aging
opsRouter.get("/facilities/:facilityNumber/ar-aging", requireOpsPermission(OPS_RESOURCES.BILLING, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const aging = await ops.getArAging(facilityNumber);
    // Storage returns cents; convert to dollars for the wire (Phase 2 R2).
    res.json({
      success: true,
      data: {
        current: centsToDollars(aging.current),
        days_30: centsToDollars(aging.days_30),
        days_60: centsToDollars(aging.days_60),
        days_90: centsToDollars(aging.days_90),
        over_90: centsToDollars(aging.over_90),
      },
    });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/billing-summary
opsRouter.get("/facilities/:facilityNumber/billing-summary", requireOpsPermission(OPS_RESOURCES.BILLING, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const start = parseInt(String(req.query.start ?? "0"), 10);
    const end = parseInt(String(req.query.end ?? Date.now()), 10);
    const summary = await ops.getBillingSummary(facilityNumber, start, end);
    // Storage returns cents; convert to dollars for the wire (Phase 2 R2).
    res.json({
      success: true,
      data: {
        total_billed:      centsToDollars(summary.total_billed),
        total_paid:        centsToDollars(summary.total_paid),
        total_outstanding: centsToDollars(summary.total_outstanding),
      },
    });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Module 6 — Staff / Scheduling / Compliance
// ─────────────────────────────────────────────────────────────────────────────

// GET /facilities/:facilityNumber/staff
opsRouter.get("/facilities/:facilityNumber/staff", requireOpsPermission(OPS_RESOURCES.STAFF, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const status = req.query.status ? String(req.query.status) : undefined;
    const staff = await ops.listStaff(facilityNumber, status);
    res.json({ success: true, data: staff });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /staff
opsRouter.post("/staff", requireOpsPermission(OPS_RESOURCES.STAFF, "create"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const parsed = staffSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const now = Date.now();
    // Inject facilityNumber from session — never trust client to claim a
    // facility in the body (Group A contract fix).
    const member = await ops.createStaff({
      ...parsed.data,
      facilityNumber,
      createdAt: now,
      updatedAt: now,
    });
    res.status(201).json({ success: true, data: member });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// PUT /staff/:id
opsRouter.put("/staff/:id", requireOpsPermission(OPS_RESOURCES.STAFF, "update"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = staffSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const member = await ops.updateStaff(id, facilityNumber, parsed.data);
    if (!member) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: member });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// DELETE /staff/:id (deactivate)
opsRouter.delete("/staff/:id", requireOpsPermission(OPS_RESOURCES.STAFF, "delete"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const ok = await ops.deactivateStaff(id, facilityNumber);
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/schedule
opsRouter.get("/facilities/:facilityNumber/schedule", requireOpsPermission(OPS_RESOURCES.SHIFT, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const weekStart = parseInt(String(req.query.weekStart ?? "0"), 10);
    const shifts = await ops.listShifts(facilityNumber, weekStart);
    res.json({ success: true, data: shifts });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /shifts
opsRouter.post("/shifts", requireOpsPermission(OPS_RESOURCES.SHIFT, "create"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const parsed = shiftSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const shift = await ops.createShift({
      ...parsed.data,
      facilityNumber,
      createdAt: Date.now(),
    });
    res.status(201).json({ success: true, data: shift });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// PUT /shifts/:id
opsRouter.put("/shifts/:id", requireOpsPermission(OPS_RESOURCES.SHIFT, "update"), async (req, res) => {
  try {
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = shiftSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const shift = await ops.updateShift(id, parsed.data);
    if (!shift) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true, data: shift });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Legacy /compliance shim (Wave 2 finale)
//
// The historic endpoints read/wrote `ops_compliance_calendar`. Phase 3
// (03-product-ia-and-flows §8.1) requires a backward-compatible API
// contract while the data migrates to `ops_obligations`.
//
// Shim contract:
//   - GET  /compliance              — backfills any unbackfilled legacy
//                                     rows for this facility, then reads
//                                     from `ops_obligations` projected
//                                     down to the legacy shape.
//   - POST /compliance              — writes a NEW row to
//                                     `ops_obligations` (target_type=
//                                     'facility', severity='medium').
//                                     Legacy table is read-only.
//   - PUT  /compliance/:id          — closes an obligation, with a
//                                     fallback lookup by legacy
//                                     source_entity_id for any row that
//                                     hadn't been backfilled yet.
//   - GET  /compliance/overdue      — projected from obligations.
//
// Response shapes + zod schemas unchanged so `ComplianceContent.tsx`
// keeps working without a frontend release.
// ─────────────────────────────────────────────────────────────────────────────

// GET /facilities/:facilityNumber/compliance
opsRouter.get("/facilities/:facilityNumber/compliance", requireOpsPermission(OPS_RESOURCES.OBLIGATION, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const status = req.query.status ? String(req.query.status) : undefined;
    // Best-effort backfill so any legacy row written by an older client
    // is visible through the obligation table. Wrapped in try/catch so a
    // backfill failure doesn't break the read.
    try {
      await obligations.backfillLegacyComplianceItems(facilityNumber, getActor(req));
    } catch (err) {
      console.error("[ops] legacy compliance backfill failed", err);
    }
    const items = await obligations.listObligationsAsLegacyCompliance(facilityNumber, status);
    res.json({ success: true, data: items });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /compliance — writes to ops_obligations
opsRouter.post("/compliance", requireOpsPermission(OPS_RESOURCES.OBLIGATION, "create"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const parsed = complianceItemSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const item = await obligations.createObligationFromLegacyShape(
      {
        facilityNumber,
        itemType: parsed.data.itemType,
        description: parsed.data.description,
        dueDate: parsed.data.dueDate,
        assignedTo: parsed.data.assignedTo,
        status: parsed.data.status,
        reminderDaysBefore: parsed.data.reminderDaysBefore,
      },
      getActor(req),
    );
    res.status(201).json({ success: true, data: item });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// PUT /compliance/:id — completes the matching obligation
opsRouter.put("/compliance/:id", requireOpsPermission(OPS_RESOURCES.OBLIGATION, "update"), async (req, res) => {
  try {
    const facilityNumber = getFacilityNumber(req);
    const id = parseInt(String(req.params.id), 10);
    if (isNaN(id)) return res.status(400).json({ success: false, error: "Invalid id" });
    const parsed = completeComplianceSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
    }
    const ok = await obligations.completeObligationFromLegacyShape(
      id,
      facilityNumber,
      parsed.data.completedDate,
      getActor(req),
    );
    if (!ok) return res.status(404).json({ success: false, error: "Not found" });
    res.json({ success: true });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/compliance/overdue
opsRouter.get("/facilities/:facilityNumber/compliance/overdue", requireOpsPermission(OPS_RESOURCES.OBLIGATION, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    try {
      await obligations.backfillLegacyComplianceItems(facilityNumber, getActor(req));
    } catch (err) {
      console.error("[ops] legacy compliance backfill failed", err);
    }
    const items = await obligations.listOverdueObligationsAsLegacy(facilityNumber);
    res.json({ success: true, data: items });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard
// ─────────────────────────────────────────────────────────────────────────────

// GET /facilities/:facilityNumber/calendar/events?from=YYYY-MM-DD&to=YYYY-MM-DD&type=meds,tasks,...
// Returns one normalized event row per scheduled item across all six source
// modules. Drives the Day/Week time-grid views and stays in sync with any
// data the user enters elsewhere in the portal.
opsRouter.get("/facilities/:facilityNumber/calendar/events", requireOpsPermission(OPS_RESOURCES.DASHBOARD, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
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
    const toMs   = localMidnight(to) + 86_400_000; // exclusive end-of-day

    // BE-8: hard caps so a malicious or careless client can't ask for a
    // 5-year window over a 10,000-resident facility.
    const MAX_RANGE_DAYS = 90;
    const MAX_ROWS = 5000;
    if (toMs <= fromMs) {
      return res.status(400).json({ success: false, error: "to must be on or after from" });
    }
    const totalDays = Math.round((toMs - fromMs) / 86_400_000);
    if (totalDays > MAX_RANGE_DAYS) {
      return res.status(400).json({
        success: false,
        error: `Date range too large (max ${MAX_RANGE_DAYS} days)`,
      });
    }

    // Optional type filter — accepts comma list or repeated query params.
    const VALID: ReadonlyArray<ops.CalendarEventType> = [
      "meds", "tasks", "incidents", "leads", "billing", "compliance",
    ];
    const rawType = req.query.type;
    let types: ops.CalendarEventType[] | undefined;
    if (typeof rawType === "string" && rawType.trim()) {
      types = rawType.split(",").map((s) => s.trim()).filter((t): t is ops.CalendarEventType =>
        (VALID as readonly string[]).includes(t),
      );
    }

    // Make sure today's pending med-pass rows exist before reading; mirrors
    // the behavior of /med-pass and /calendar so the calendar self-heals.
    // Cap the materialization loop to 42 days even when totalDays is larger
    // (already prevented by the range cap above, but kept defensive).
    const matDays = Math.min(totalDays, 42);
    const days = Array.from({ length: matDays }, (_, i) => fromMs + i * 86_400_000);
    await Promise.all(days.map((d) => ops.generateDailyMedPassEntries(facilityNumber, d)));

    const data = await ops.getFacilityCalendarEvents(facilityNumber, fromMs, toMs, types);
    // Defense in depth: cap the response so a single facility with an
    // unusual mix of recurring meds can't OOM the client.
    const truncated = data.length > MAX_ROWS;
    const payload = truncated ? data.slice(0, MAX_ROWS) : data;
    return res.json({
      success: true,
      data: payload,
      meta: { total: data.length, returned: payload.length, truncated },
    });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// GET /facilities/:facilityNumber/dashboard
opsRouter.get("/facilities/:facilityNumber/dashboard", requireOpsPermission(OPS_RESOURCES.DASHBOARD, "read"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    const dashboard = await ops.getFacilityDashboard(facilityNumber);
    res.json({ success: true, data: dashboard });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// POST /facilities/:facilityNumber/seed-demo
// Populates a fresh facility with a small, realistic set of residents +
// medications + today's med-pass entries (with a deterministic mix of
// statuses) so the calendar's color states are all visible. No-op if the
// facility already has any resident on file.
opsRouter.post("/facilities/:facilityNumber/seed-demo", requireOpsPermission(OPS_RESOURCES.DASHBOARD, "create"), async (req, res) => {
  try {
    const facilityNumber = String(req.params.facilityNumber);
    if (getFacilityNumber(req) !== facilityNumber) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    const result = await ops.seedFacilityDemoData(facilityNumber);
    return res.json({ success: true, data: result });
  } catch (e) {
    return handleRouteError(req, e, res);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Wave 0 — Foundations: Reg settings (F1), Evidence (F2), Audit trail (F3)
//
// Pattern reused: each route follows the existing
//   try { zod.safeParse → tenant/permission check → storage call → 200 envelope }
//   catch { 500 envelope }
// shape from the Module 1–6 routes above. Tenant scope is enforced TWICE —
// once by opsRouter.param("facilityNumber") at the top of the file (defense
// at the URL boundary) and once inside each storage function (defense in
// depth so a misplaced caller can't cross-tenant read).
// ─────────────────────────────────────────────────────────────────────────────

// ── Zod schemas ───────────────────────────────────────────────────────────────

const regSettingUpdateSchema = z.object({
  value: z.string().min(1, "value is required"),
  sourceNote: z.string().max(2000).optional(),
  validated: z.boolean().optional(),
}).strict();

const evidenceAttachSchema = z.object({
  entityType: z.string().min(1, "entityType is required"),
  entityId: z.coerce.number().int().positive("entityId must be a positive integer"),
  kind: z.enum(EVIDENCE_KIND_VALUES),
  externalUri: z.string().url().optional(),
}).strict();

const evidenceListQuerySchema = z.object({
  entityType: z.string().min(1, "entityType is required"),
  entityId: z.coerce.number().int().positive("entityId must be a positive integer"),
}).strict();

const auditTrailQuerySchema = z.object({
  entityType: z.string().max(200, "entityType too long").optional(),
  entityId: z.coerce.number().int().positive().optional(),
  // W15 — viewer filters. Strings capped to keep accidental large
  // payloads out of indexed-equality predicates.
  actor: z.string().max(200, "actor too long").optional(),
  action: z.string().max(200, "action too long").optional(),
  // sinceMs is inclusive, untilMs is exclusive (see storage docstring).
  sinceMs: z.coerce.number().int().nonnegative().optional(),
  untilMs: z.coerce.number().int().nonnegative().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();

// W8 — chart-completeness query schema. `worst` mirrors the
// ChartItemStatus union so callers can filter to incomplete charts only.
const chartCompletenessQuerySchema = z.object({
  worst: z.enum(["ok", "stale", "missing"]).optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
}).strict();

// W1 — triage aggregator query schema. perSectionLimit caps the drill-down
// rows returned per section so the JSON stays small even on a backlogged
// facility. `now` is an optional override used by tests; production
// callers should never set it.
const triageQuerySchema = z.object({
  perSectionLimit: z.coerce.number().int().positive().max(100).optional(),
  now: z.coerce.number().int().positive().optional(),
}).strict();

// W14 — notification-log query schema. Mirrors the audit-trail viewer's
// filter set so the UI can layer the same "by kind / by status / by
// time-range" affordances on top.
const notificationListQuerySchema = z.object({
  kind: z.enum(["daily_summary", "incident_sla_warning", "manual_test"]).optional(),
  deliveryStatus: z.enum(["queued", "sent", "failed"]).optional(),
  sinceMs: z.coerce.number().int().nonnegative().optional(),
  untilMs: z.coerce.number().int().nonnegative().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();

// W14 — admin "send test email" body schema. The override list is optional
// so an operator can either trigger to the stored recipients or aim at a
// throwaway inbox for a one-off verification.
const dailySummaryTestSendSchema = z.object({
  overrideRecipients: z
    .array(z.string().email().max(254))
    .max(10)
    .optional(),
}).strict();

// ── Multer + per-session rate limiter for evidence upload ────────────────────

// In-memory storage so we sniff/validate the buffer before touching disk.
const evidenceUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: EVIDENCE_MAX_BYTES,
    files: 1,
    fields: 20,
  },
});

// 10 uploads / minute / facility account. Comfortably handles the 100-
// facility concurrent target without exposing a DOS surface. Pattern
// reused: shape mirrors `billingRateLimiter` at
// `server/middleware/rateLimiter.ts:34-50`.
const evidenceUploadLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: "Too many uploads — please wait a minute and try again.",
  },
  keyGenerator: (req: Request) => {
    const u = req.user as { id?: number; facilityNumber?: string } | undefined;
    return u?.id ? `evidence:${u.id}` : "evidence:unauthenticated";
  },
});

// Helper — extract the actor identity in the shape the audit/storage
// layer expects. Username is the human-readable id we want in audit rows.
function getActor(req: Request): { id: string; role: string } {
  const u = req.user as { username?: string } | undefined;
  return { id: u?.username ?? "unknown", role: resolveRole(req) };
}

// ── F1 — Reg settings ────────────────────────────────────────────────────────

// GET /facilities/:facilityNumber/reg-settings
opsRouter.get(
  "/facilities/:facilityNumber/reg-settings",
  requireOpsPermission(OPS_RESOURCES.REG_SETTING, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const data = await listRegSettings(facilityNumber);
      return res.json({ success: true, data });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// PUT /reg-settings/:key — body { value, sourceNote?, validated? }
// Facility derived from the session (the key is global to the catalogue;
// the per-facility scope comes from req.user.facilityNumber).
opsRouter.put(
  "/reg-settings/:key",
  requireOpsPermission(OPS_RESOURCES.REG_SETTING, "manage_settings"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const keyParam = String(req.params.key);
      if (!isKnownRegSettingKey(keyParam)) {
        return res
          .status(400)
          .json({ success: false, error: "Unknown reg setting key" });
      }
      const parsed = regSettingUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      await setRegSetting(facilityNumber, keyParam, parsed.data.value, {
        sourceNote: parsed.data.sourceNote ?? undefined,
        validated: parsed.data.validated,
        actorId: actor.id,
        actorRole: actor.role,
      });
      // Re-read so the response shows placeholder/validated state.
      const data = (await listRegSettings(facilityNumber)).find(
        (r) => r.key === keyParam,
      );
      return res.json({ success: true, data });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /facilities/:facilityNumber/reg-settings/seed
opsRouter.post(
  "/facilities/:facilityNumber/reg-settings/seed",
  requireOpsPermission(OPS_RESOURCES.REG_SETTING, "manage_settings"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const result = await seedDefaultsForFacility(facilityNumber);
      return res.json({ success: true, data: result });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// ── F2 — Evidence attachments ─────────────────────────────────────────────────

// GET /facilities/:facilityNumber/evidence?entityType=&entityId=
opsRouter.get(
  "/facilities/:facilityNumber/evidence",
  requireOpsPermission(OPS_RESOURCES.EVIDENCE, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = evidenceListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const data = await listEvidence(
        facilityNumber,
        parsed.data.entityType,
        parsed.data.entityId,
      );
      return res.json({ success: true, data });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /evidence — multipart/form-data
// Body fields: entityType, entityId, kind, externalUri?
// File field:  file (single, ≤ 5 MB, mime-sniffed)
opsRouter.post(
  "/evidence",
  requireOpsPermission(OPS_RESOURCES.EVIDENCE, "create"),
  evidenceUploadLimiter,
  // Multer needs to run AFTER the permission check but BEFORE the body
  // handler — wrap to convert multer errors into the envelope shape.
  (req: Request, res: Response, next: NextFunction) => {
    evidenceUpload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res
            .status(413)
            .json({ success: false, error: "File exceeds 5 MB limit" });
        }
        return res
          .status(400)
          .json({ success: false, error: err.message });
      }
      if (err) return next(err);
      return next();
    });
  },
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const parsed = evidenceAttachSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const fileBuf = (req as Request & { file?: Express.Multer.File }).file;

      if (parsed.data.kind === "external_link") {
        if (!parsed.data.externalUri) {
          return res
            .status(400)
            .json({ success: false, error: "externalUri is required for external_link" });
        }
        const row = await attachEvidence({
          facilityNumber,
          entityType: parsed.data.entityType,
          entityId: parsed.data.entityId,
          kind: "external_link",
          externalUri: parsed.data.externalUri,
          uploadedBy: actor.id,
          actorRole: actor.role,
        });
        return res.status(201).json({ success: true, data: row });
      }

      if (!fileBuf) {
        return res
          .status(400)
          .json({ success: false, error: "file field is required" });
      }
      // Multer's declared mime comes from the client's form-data and is
      // therefore untrusted; we pass it as the "declared" value and the
      // storage layer sniffs the buffer to confirm.
      const declaredMime = fileBuf.mimetype || undefined;
      if (declaredMime && !EVIDENCE_ALLOWED_MIME.has(declaredMime)) {
        return res
          .status(400)
          .json({ success: false, error: `Mime ${declaredMime} is not allowed` });
      }
      const row = await attachEvidence({
        facilityNumber,
        entityType: parsed.data.entityType,
        entityId: parsed.data.entityId,
        kind: parsed.data.kind,
        filename: fileBuf.originalname,
        mime: declaredMime,
        bytes: fileBuf.buffer,
        uploadedBy: actor.id,
        actorRole: actor.role,
      });
      return res.status(201).json({ success: true, data: row });
    } catch (e) {
      if (e instanceof EvidenceValidationError) {
        const status = e.code === "FILE_TOO_LARGE" ? 413 : 400;
        return res.status(status).json({ success: false, error: e.message });
      }
      return handleRouteError(req, e, res);
    }
  },
);

// GET /evidence/:id/download — streams file with proper headers
opsRouter.get(
  "/evidence/:id/download",
  requireOpsPermission(OPS_RESOURCES.EVIDENCE, "read"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (Number.isNaN(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const result = await readEvidenceStream(facilityNumber, id);
      if (!result) {
        return res.status(404).json({ success: false, error: "Not found" });
      }
      // Filename was sanitized at write time; re-quote per RFC 6266
      // (Content-Disposition) by replacing any stray quote chars.
      const safeName = result.filename.replace(/"/g, "_");
      res.setHeader("Content-Type", result.mime);
      res.setHeader("Content-Length", String(result.byteSize));
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${safeName}"`,
      );
      // PHI-ish — never cache.
      res.setHeader("Cache-Control", "private, no-store");
      result.stream.on("error", (streamErr) => {
        console.error("[ops] evidence stream error", streamErr);
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.destroy(streamErr);
        }
      });
      return result.stream.pipe(res);
    } catch (e) {
      console.error("[ops] evidence download failed", e);
      if (!res.headersSent) {
        return res.status(500).json({ success: false, error: "Internal error" });
      }
      return res.end();
    }
  },
);

// DELETE /evidence/:id — soft-delete (sets deleted_at, no hard remove)
opsRouter.delete(
  "/evidence/:id",
  requireOpsPermission(OPS_RESOURCES.EVIDENCE, "delete"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (Number.isNaN(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const actor = getActor(req);
      const row = await softDeleteEvidence(facilityNumber, id, actor);
      if (!row) {
        return res.status(404).json({ success: false, error: "Not found" });
      }
      return res.json({ success: true, data: { id: row.id, deletedAt: row.deletedAt } });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// ── F3 — Audit trail (read-only) ─────────────────────────────────────────────

// GET /facilities/:facilityNumber/audit-trail?entityType=&entityId=&page=&limit=
opsRouter.get(
  "/facilities/:facilityNumber/audit-trail",
  requireOpsPermission(OPS_RESOURCES.AUDIT_TRAIL, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = auditTrailQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await listAuditForFacility(facilityNumber, {
        entityType: parsed.data.entityType,
        entityId: parsed.data.entityId,
        actor: parsed.data.actor,
        action: parsed.data.action,
        sinceMs: parsed.data.sinceMs,
        untilMs: parsed.data.untilMs,
        page,
        limit,
      });
      return res.json({
        success: true,
        data: result.rows,
        meta: { total: result.total, page, limit },
      });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// ── W8 — Chart completeness sweep ────────────────────────────────────────────

// GET /facilities/:facilityNumber/chart-completeness?worst=&limit=
//   Returns one row per active resident with its evaluated chart status
//   plus a `complete` counter for the "X of Y residents complete" banner.
opsRouter.get(
  "/facilities/:facilityNumber/chart-completeness",
  requireOpsPermission(OPS_RESOURCES.RESIDENT, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = chartCompletenessQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const result = await listChartCompleteness(facilityNumber, {
        worst: parsed.data.worst,
        limit: parsed.data.limit,
      });
      return res.json({
        success: true,
        data: result.rows,
        meta: {
          total: result.total,
          complete: result.complete,
          activeResidents: result.activeResidents,
        },
      });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// GET /residents/:id/chart-completeness — per-resident banner.
//   Note: no `:facilityNumber` in the path, so we resolve it from the
//   authenticated session. The storage layer enforces tenant scope on the
//   lookup so a forged id can't escape the facility.
opsRouter.get(
  "/residents/:id/chart-completeness",
  requireOpsPermission(OPS_RESOURCES.RESIDENT, "read"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isFinite(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const row = await getChartCompletenessForResident(id, facilityNumber);
      if (!row) {
        return res.status(404).json({ success: false, error: "Not found" });
      }
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Wave 1 — Epic B Audit-Readiness routes
//
// Pattern mirrors the Wave 0 routes above:
//   - `.strict()` zod schemas so unknown fields surface as 400
//   - `requireOpsPermission(resource, action)` after the auth + subscription
//     middleware already mounted on opsRouter
//   - `getFacilityNumber(req)` for body-only routes; `:facilityNumber` URL
//     form for list routes (the existing opsRouter.param guard covers IDOR)
//   - Envelope `{ success, data }`; errors `{ success: false, error }`
//   - Storage layer emits audit rows; routes never call recordAudit directly
// ─────────────────────────────────────────────────────────────────────────────

// ── Helper: extract id param ────────────────────────────────────────────────

function parseIdParam(raw: unknown): number | null {
  const n = parseInt(String(raw), 10);
  if (Number.isNaN(n) || n <= 0) return null;
  return n;
}

// Centralized error responder. Stops the "swallow as Internal error"
// anti-pattern that hid production failures and made debugging impossible.
// Behavior:
//   - Domain errors (matched by message regex in isDomainError) → 400
//     with the thrown message so the FE toast shows a useful reason.
//   - Postgres unique-constraint violations (23505) → 409 conflict.
//   - Everything else → 500 with a structured `code` for the FE to
//     branch on, plus a `console.error` carrying the request method+path
//     and the full Error so it surfaces in production logs.
//
// Usage: `} catch (e) { return handleRouteError(req, e, res); }`
export function handleRouteError(req: Request, e: unknown, res: Response) {
  if (isDomainError(e)) {
    return res.status(400).json({
      success: false,
      code: "DOMAIN_ERROR",
      error: (e as Error).message,
    });
  }
  // Postgres unique violation. The pg driver exposes `code` on the
  // thrown error; better-sqlite3 throws SqliteError with a different
  // shape but production runs on Postgres so this is the hot path.
  const err = e as { code?: string; constraint?: string; message?: string };
  if (err && err.code === "23505") {
    return res.status(409).json({
      success: false,
      code: "CONFLICT",
      error: err.message ?? "Resource already exists",
    });
  }
  // eslint-disable-next-line no-console
  console.error(`[ops] ${req.method} ${req.originalUrl} failed`, e);
  return res.status(500).json({
    success: false,
    code: "INTERNAL_ERROR",
    error: "Internal error",
  });
}

// Map a thrown Error to the correct HTTP envelope. We treat domain errors
// (status transition violations, "fixture not found", "follow-up already
// resolved") as 400; the calling route falls through to its catch and
// returns 500 only on unexpected throws.
function isDomainError(e: unknown): e is Error {
  if (!(e instanceof Error)) return false;
  const m = e.message;
  return (
    /not found/i.test(m) ||
    /already resolved/i.test(m) ||
    /already closed/i.test(m) ||
    /not active/i.test(m) ||
    /not out of range/i.test(m) ||
    /required for non-anonymous/i.test(m) ||
    /invalid/i.test(m) ||
    /illegal/i.test(m) ||
    /must be resolved/i.test(m) ||
    /Cannot/i.test(m) ||
    /open citations remain/i.test(m) ||
    // Wave 2 W4 — incident lifecycle domain errors.
    /closure note is required/i.test(m) ||
    /reopen reason is required/i.test(m) ||
    /at least 8 characters/i.test(m)
  );
}

// ── Shared: string-aware boolean coercer for query strings ──────────────────
// `z.coerce.boolean()` treats any non-empty string (including "false") as
// `true`. We accept literal "true" / "false" instead.
const queryStringBool = z
  .union([z.literal("true"), z.literal("false")])
  .transform((v) => v === "true");

// ── W7 Temperature fixtures + logs ──────────────────────────────────────────

const tempFixtureCreateSchema = z.object({
  fixtureKey: z.string().min(1).max(64),
  fixtureLabel: z.string().min(1).max(120),
  kind: z.string().min(1).max(40),
  requiredMin: z.number().finite().nullable().optional(),
  requiredMax: z.number().finite().nullable().optional(),
  unit: z.string().max(8).nullable().optional(),
}).strict();

const tempFixtureUpdateSchema = z.object({
  fixtureLabel: z.string().min(1).max(120).optional(),
  kind: z.string().min(1).max(40).optional(),
  requiredMin: z.number().finite().nullable().optional(),
  requiredMax: z.number().finite().nullable().optional(),
  unit: z.string().max(8).optional(),
  status: z.enum(["active", "inactive"]).optional(),
}).strict();

const tempLogCreateSchema = z.object({
  fixtureId: z.number().int().positive(),
  readingValue: z.number().finite(),
  readingAt: z.number().int().positive(),
  // Phase 5 §6.A.1 — free-text, defaults to session user if blank.
  recordedBy: z.string().trim().max(120).nullable().optional(),
  note: z.string().max(2000).nullable().optional(),
}).strict();

const tempLogResolveSchema = z.object({
  note: z.string().trim().min(1, "Resolution note required").max(2000),
}).strict();

const tempLogListQuerySchema = z.object({
  fixtureKey: z.string().optional(),
  sinceMs: z.coerce.number().int().nonnegative().optional(),
  outOfRangeOnly: queryStringBool.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();

// GET /facilities/:facilityNumber/temp-fixtures
opsRouter.get(
  "/facilities/:facilityNumber/temp-fixtures",
  requireOpsPermission(OPS_RESOURCES.TEMPERATURE_FIXTURE, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const includeInactive = String(req.query.includeInactive ?? "") === "true";
      const data = await ops.listTemperatureFixtures(facilityNumber, { includeInactive });
      return res.json({ success: true, data });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /temp-fixtures
opsRouter.post(
  "/temp-fixtures",
  requireOpsPermission(OPS_RESOURCES.TEMPERATURE_FIXTURE, "create"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const parsed = tempFixtureCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const row = await ops.createTemperatureFixture(
        {
          facilityNumber,
          fixtureKey: parsed.data.fixtureKey,
          fixtureLabel: parsed.data.fixtureLabel,
          kind: parsed.data.kind,
          requiredMin: parsed.data.requiredMin ?? null,
          requiredMax: parsed.data.requiredMax ?? null,
          unit: parsed.data.unit ?? "F",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        actor,
      );
      return res.status(201).json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// PUT /temp-fixtures/:id
opsRouter.put(
  "/temp-fixtures/:id",
  requireOpsPermission(OPS_RESOURCES.TEMPERATURE_FIXTURE, "update"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = tempFixtureUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const row = await ops.updateTemperatureFixture(id, facilityNumber, parsed.data, getActor(req));
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// DELETE /temp-fixtures/:id — soft inactivate
opsRouter.delete(
  "/temp-fixtures/:id",
  requireOpsPermission(OPS_RESOURCES.TEMPERATURE_FIXTURE, "delete"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const ok = await ops.softInactivateTemperatureFixture(id, facilityNumber, getActor(req));
      if (!ok) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: { id } });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// GET /facilities/:facilityNumber/temp-logs
opsRouter.get(
  "/facilities/:facilityNumber/temp-logs",
  requireOpsPermission(OPS_RESOURCES.TEMPERATURE_LOG, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = tempLogListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await ops.listTemperatureLogs(facilityNumber, {
        fixtureKey: parsed.data.fixtureKey,
        sinceMs: parsed.data.sinceMs,
        outOfRangeOnly: parsed.data.outOfRangeOnly,
        page,
        limit,
      });
      return res.json({ success: true, data: result.logs, meta: { total: result.total, page, limit } });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /temp-logs — §9 out-of-range hook fires here
opsRouter.post(
  "/temp-logs",
  requireOpsPermission(OPS_RESOURCES.TEMPERATURE_LOG, "create"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const parsed = tempLogCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const recordedBy = parsed.data.recordedBy?.trim() || actor.id;
      const row = await ops.createTemperatureLog(
        {
          facilityNumber,
          fixtureId: parsed.data.fixtureId,
          readingValue: parsed.data.readingValue,
          readingAt: parsed.data.readingAt,
          recordedBy,
          note: parsed.data.note ?? null,
        },
        actor,
      );
      return res.status(201).json({ success: true, data: row });
    } catch (e) {
      if (isDomainError(e)) {
        const msg = (e as Error).message;
        const status = /not found/i.test(msg) ? 404 : 400;
        return res.status(status).json({ success: false, error: msg });
      }
      return handleRouteError(req, e, res);
    }
  },
);

// POST /temp-logs/:id/resolve
opsRouter.post(
  "/temp-logs/:id/resolve",
  requireOpsPermission(OPS_RESOURCES.TEMPERATURE_LOG, "resolve"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = tempLogResolveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const row = await ops.resolveTemperatureFollowUp(
        id,
        facilityNumber,
        getActor(req),
        parsed.data.note,
      );
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// ── W5 Drill logs ────────────────────────────────────────────────────────────

const drillCreateSchema = z.object({
  drillKind: z.string().min(1).max(40),
  scenario: z.string().max(500).nullable().optional(),
  shift: z.string().max(40).nullable().optional(),
  executedAt: z.number().int().positive(),
  leader: z.string().max(120).nullable().optional(),
  participants: z.array(z.string().max(200)).max(200).nullable().optional(),
  residentsInvolved: z.array(z.string().max(200)).max(200).nullable().optional(),
  // Phase 5 §6.A.2 — FE converts mm:ss to integer seconds before POST.
  evacuationSeconds: z.number().int().nonnegative().max(86400).nullable().optional(),
  debriefNotes: z.string().max(4000).nullable().optional(),
  correctiveActions: z.array(z.string().max(500)).max(50).nullable().optional(),
  status: z.enum(["executed", "completed"]).optional(),
}).strict();

const drillUpdateSchema = drillCreateSchema.partial().strict();

const drillListQuerySchema = z.object({
  kind: z.string().optional(),
  sinceMs: z.coerce.number().int().nonnegative().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();

opsRouter.get(
  "/facilities/:facilityNumber/drills",
  requireOpsPermission(OPS_RESOURCES.DRILL_LOG, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = drillListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await ops.listDrillLogs(facilityNumber, {
        kind: parsed.data.kind,
        sinceMs: parsed.data.sinceMs,
        page,
        limit,
      });
      // Decode JSON columns so clients see arrays, not stringified text.
      const decoded = result.logs.map((r) => ops.decodeDrillLog(r));
      return res.json({ success: true, data: decoded, meta: { total: result.total, page, limit } });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.post(
  "/drills",
  requireOpsPermission(OPS_RESOURCES.DRILL_LOG, "create"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const parsed = drillCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const row = await ops.createDrillLog(
        {
          facilityNumber,
          drillKind: parsed.data.drillKind,
          scenario: parsed.data.scenario ?? null,
          shift: parsed.data.shift ?? null,
          executedAt: parsed.data.executedAt,
          leader: parsed.data.leader ?? null,
          participants: parsed.data.participants ?? [],
          residentsInvolved: parsed.data.residentsInvolved ?? [],
          evacuationSeconds: parsed.data.evacuationSeconds ?? null,
          debriefNotes: parsed.data.debriefNotes ?? null,
          correctiveActions: parsed.data.correctiveActions ?? [],
          status: parsed.data.status,
          createdBy: actor.id,
        },
        actor,
      );
      return res.status(201).json({ success: true, data: ops.decodeDrillLog(row) });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.put(
  "/drills/:id",
  requireOpsPermission(OPS_RESOURCES.DRILL_LOG, "update"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = drillUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const row = await ops.updateDrillLog(id, facilityNumber, nullsToUndef(parsed.data), getActor(req));
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: ops.decodeDrillLog(row) });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.delete(
  "/drills/:id",
  requireOpsPermission(OPS_RESOURCES.DRILL_LOG, "delete"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const ok = await ops.softDeleteDrillLog(id, facilityNumber, getActor(req));
      if (!ok) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: { id } });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// ── W9 Vendors ───────────────────────────────────────────────────────────────

const vendorCreateSchema = z.object({
  vendorName: z.string().min(1).max(200),
  vendorType: z.string().min(1).max(60),
  contactName: z.string().max(200).nullable().optional(),
  contactPhone: z.string().max(40).nullable().optional(),
  contactEmail: z.union([z.string().email().max(200), z.literal("")]).nullable().optional(),
  coiExpiresAt: z.number().int().nonnegative().nullable().optional(),
  licenseExpiresAt: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
}).strict();

const vendorUpdateSchema = z.object({
  vendorName: z.string().min(1).max(200).optional(),
  vendorType: z.string().min(1).max(60).optional(),
  contactName: z.string().max(200).nullable().optional(),
  contactPhone: z.string().max(40).nullable().optional(),
  contactEmail: z.string().email().max(200).nullable().optional().or(z.literal("")),
  coiExpiresAt: z.number().int().nonnegative().nullable().optional(),
  licenseExpiresAt: z.number().int().nonnegative().nullable().optional(),
  notes: z.string().max(2000).nullable().optional(),
  status: z.enum(["active", "archived"]).optional(),
}).strict();

const vendorListQuerySchema = z.object({
  expiringWithinDays: z.coerce.number().int().positive().max(3650).optional(),
  vendorType: z.string().optional(),
  status: z.enum(["active", "archived"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();

opsRouter.get(
  "/facilities/:facilityNumber/vendors",
  requireOpsPermission(OPS_RESOURCES.VENDOR, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = vendorListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await ops.listVendors(facilityNumber, {
        expiringWithinDays: parsed.data.expiringWithinDays,
        vendorType: parsed.data.vendorType,
        status: parsed.data.status,
        page,
        limit,
      });
      return res.json({ success: true, data: result.vendors, meta: { total: result.total, page, limit } });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.post(
  "/vendors",
  requireOpsPermission(OPS_RESOURCES.VENDOR, "create"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const parsed = vendorCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const row = await ops.createVendor(
        {
          facilityNumber,
          vendorName: parsed.data.vendorName,
          vendorType: parsed.data.vendorType,
          contactName: parsed.data.contactName ?? null,
          contactPhone: parsed.data.contactPhone ?? null,
          contactEmail: parsed.data.contactEmail || null,
          coiExpiresAt: parsed.data.coiExpiresAt ?? null,
          licenseExpiresAt: parsed.data.licenseExpiresAt ?? null,
          notes: parsed.data.notes ?? null,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        actor,
      );
      return res.status(201).json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.put(
  "/vendors/:id",
  requireOpsPermission(OPS_RESOURCES.VENDOR, "update"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = vendorUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const row = await ops.updateVendor(id, facilityNumber, parsed.data, getActor(req));
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.post(
  "/vendors/:id/archive",
  requireOpsPermission(OPS_RESOURCES.VENDOR, "delete"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const row = await ops.archiveVendor(id, facilityNumber, getActor(req));
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// ── W10 Complaints ───────────────────────────────────────────────────────────

const COMPLAINANT_TYPES = ["resident", "family", "staff", "anonymous", "external"] as const;

const complaintCreateSchema = z.object({
  receivedAt: z.number().int().positive(),
  complainantType: z.enum(COMPLAINANT_TYPES),
  // Anonymous handling (Phase 5 §6.A.3) — these may be empty strings or
  // omitted entirely when complainantType === "anonymous".
  complainantName: z.string().trim().max(200).nullable().optional(),
  complainantRelation: z.string().trim().max(120).nullable().optional(),
  nature: z.string().min(1).max(2000),
  intakeNotes: z.string().max(4000).nullable().optional(),
  assignedTo: z.string().max(120).nullable().optional(),
  // §6.B.2 — free-text external reference (ombudsman / regulator / internal #).
  externalRef: z.string().max(500).nullable().optional(),
}).strict();

const complaintUpdateSchema = z.object({
  nature: z.string().min(1).max(2000).optional(),
  intakeNotes: z.string().max(4000).nullable().optional(),
  assignedTo: z.string().max(120).nullable().optional(),
  externalRef: z.string().max(500).nullable().optional(),
  status: z.enum(["open", "investigating", "resolved", "closed"]).optional(),
}).strict();

const complaintListQuerySchema = z.object({
  status: z.enum(["open", "investigating", "resolved", "closed"]).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();

const complaintNoteSchema = z.object({
  note: z.string().trim().min(1).max(4000),
}).strict();

const complaintResolveSchema = z.object({
  resolutionNote: z.string().trim().min(1).max(4000),
}).strict();

opsRouter.get(
  "/facilities/:facilityNumber/complaints",
  requireOpsPermission(OPS_RESOURCES.COMPLAINT, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = complaintListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await ops.listComplaints(facilityNumber, {
        status: parsed.data.status,
        page,
        limit,
      });
      return res.json({ success: true, data: result.complaints, meta: { total: result.total, page, limit } });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.get(
  "/complaints/:id",
  requireOpsPermission(OPS_RESOURCES.COMPLAINT, "read"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const result = await ops.getComplaint(id, facilityNumber);
      if (!result) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: result });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.post(
  "/complaints",
  requireOpsPermission(OPS_RESOURCES.COMPLAINT, "create"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const parsed = complaintCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const row = await ops.createComplaint(
        {
          facilityNumber,
          receivedAt: parsed.data.receivedAt,
          complainantType: parsed.data.complainantType,
          complainantName: parsed.data.complainantName ?? null,
          complainantRelation: parsed.data.complainantRelation ?? null,
          nature: parsed.data.nature,
          intakeNotes: parsed.data.intakeNotes ?? null,
          assignedTo: parsed.data.assignedTo ?? null,
          externalRef: parsed.data.externalRef ?? null,
          createdBy: actor.id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        actor,
      );
      return res.status(201).json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.put(
  "/complaints/:id",
  requireOpsPermission(OPS_RESOURCES.COMPLAINT, "update"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = complaintUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const row = await ops.updateComplaint(id, facilityNumber, parsed.data, getActor(req));
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.post(
  "/complaints/:id/notes",
  requireOpsPermission(OPS_RESOURCES.COMPLAINT, "update"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = complaintNoteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const row = await ops.addInvestigationNote(id, facilityNumber, getActor(req), parsed.data.note);
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.status(201).json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.post(
  "/complaints/:id/resolve",
  requireOpsPermission(OPS_RESOURCES.COMPLAINT, "resolve"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = complaintResolveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const row = await ops.resolveComplaint(
        id,
        facilityNumber,
        getActor(req),
        parsed.data.resolutionNote,
      );
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.post(
  "/complaints/:id/close",
  requireOpsPermission(OPS_RESOURCES.COMPLAINT, "close"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const row = await ops.closeComplaint(id, facilityNumber, getActor(req));
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// ── W13 Inspections + citations ──────────────────────────────────────────────

const inspectionCreateSchema = z.object({
  inspectorOrg: z.string().min(1).max(120),
  inspectorName: z.string().max(200).nullable().optional(),
  purpose: z.string().min(1).max(60),
  visitAt: z.number().int().positive(),
  findingsJson: z.string().max(16_000).nullable().optional(),
}).strict();

const inspectionUpdateSchema = z.object({
  inspectorOrg: z.string().min(1).max(120).optional(),
  inspectorName: z.string().max(200).nullable().optional(),
  purpose: z.string().min(1).max(60).optional(),
  visitAt: z.number().int().positive().optional(),
  findingsJson: z.string().max(16_000).nullable().optional(),
  status: z.enum(["open", "closed"]).optional(),
}).strict();

const inspectionListQuerySchema = z.object({
  sinceMs: z.coerce.number().int().nonnegative().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();

const citationCreateSchema = z.object({
  citationTitle: z.string().min(1).max(200),
  detail: z.string().max(4000).nullable().optional(),
  dueAt: z.number().int().positive().nullable().optional(),
}).strict();

const citationCloseSchema = z.object({
  closureNote: z.string().trim().min(1).max(4000),
}).strict();

// Phase 2 R2: ops_inspections.findings_json flipped from TEXT to JSONB.
// The wire format remains a JSON-encoded *string* (client-side editor
// emits arbitrary stringified JSON up to 16 KB); on the way in we parse it
// before handing to storage so Drizzle stores the object, and on the way
// out we re-stringify so the FE keeps round-tripping the same shape.
//
// Parse errors fall back to NULL — the route still validated the string
// length, and storing an opaque payload as null is preferable to crashing.
function parseFindingsJsonForStorage(raw: string | null | undefined): unknown {
  if (raw == null || raw === "") return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function serialiseInspectionRow<T extends { findingsJson?: unknown }>(row: T): T {
  const fj = row.findingsJson;
  if (fj == null) return row;
  if (typeof fj === "string") return row; // legacy text row passes through
  return { ...row, findingsJson: JSON.stringify(fj) };
}

opsRouter.get(
  "/facilities/:facilityNumber/inspections",
  requireOpsPermission(OPS_RESOURCES.INSPECTION, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = inspectionListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await ops.listInspections(facilityNumber, {
        sinceMs: parsed.data.sinceMs,
        page,
        limit,
      });
      return res.json({
        success: true,
        data: result.inspections.map((r) => serialiseInspectionRow(r)),
        meta: { total: result.total, page, limit },
      });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.get(
  "/inspections/:id",
  requireOpsPermission(OPS_RESOURCES.INSPECTION, "read"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const row = await ops.getInspection(id, facilityNumber);
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      // The nested shape carries the actual ops_inspections row under
      // .inspection; re-wrap so the wire-compat shim sees the field it
      // expects without touching the sibling citations/evidence arrays.
      return res.json({
        success: true,
        data: { ...row, inspection: serialiseInspectionRow(row.inspection) },
      });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.post(
  "/inspections",
  requireOpsPermission(OPS_RESOURCES.INSPECTION, "create"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const parsed = inspectionCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const row = await ops.createInspection(
        {
          facilityNumber,
          inspectorOrg: parsed.data.inspectorOrg,
          inspectorName: parsed.data.inspectorName ?? null,
          purpose: parsed.data.purpose,
          visitAt: parsed.data.visitAt,
          findingsJson: parseFindingsJsonForStorage(parsed.data.findingsJson),
          createdBy: actor.id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        actor,
      );
      return res.status(201).json({ success: true, data: serialiseInspectionRow(row) });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.put(
  "/inspections/:id",
  requireOpsPermission(OPS_RESOURCES.INSPECTION, "update"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = inspectionUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      // Parse findingsJson off the validated input before passing through.
      const update: Record<string, unknown> = { ...parsed.data };
      if (Object.prototype.hasOwnProperty.call(parsed.data, "findingsJson")) {
        update.findingsJson = parseFindingsJsonForStorage(parsed.data.findingsJson);
      }
      const row = await ops.updateInspection(id, facilityNumber, update, getActor(req));
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: serialiseInspectionRow(row) });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.post(
  "/inspections/:id/close",
  requireOpsPermission(OPS_RESOURCES.INSPECTION, "close"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const row = await ops.closeInspection(id, facilityNumber, getActor(req));
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: serialiseInspectionRow(row) });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.post(
  "/inspections/:id/citations",
  requireOpsPermission(OPS_RESOURCES.INSPECTION, "update"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const inspectionId = parseIdParam(req.params.id);
      if (inspectionId === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = citationCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const row = await ops.addCitation(
        inspectionId,
        facilityNumber,
        {
          citationTitle: parsed.data.citationTitle,
          detail: parsed.data.detail ?? null,
          dueAt: parsed.data.dueAt ?? null,
        },
        getActor(req),
      );
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.status(201).json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.post(
  "/citations/:id/close",
  requireOpsPermission(OPS_RESOURCES.INSPECTION, "close"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = citationCloseSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const row = await ops.closeCitation(id, facilityNumber, getActor(req), parsed.data.closureNote);
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// ── W11 Controlled-sub reconciliation ────────────────────────────────────────

const controlledSubListQuerySchema = z.object({
  resolved: queryStringBool.optional(),
  includeDestructions: queryStringBool.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();

const controlledSubResolveSchema = z.object({
  note: z.string().trim().min(1).max(4000),
  witnessedBy: z.string().trim().min(1).max(120),
}).strict();

opsRouter.get(
  "/facilities/:facilityNumber/controlled-sub/discrepancies",
  requireOpsPermission(OPS_RESOURCES.CONTROLLED_SUB_COUNT, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = controlledSubListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await ops.listControlledSubDiscrepancies(facilityNumber, {
        resolved: parsed.data.resolved,
        page,
        limit,
      });
      // Phase 5 §6.B.1 — include "Recent destructions" alongside the
      // discrepancy list so the FE can render the accordion without a
      // separate fetch. Opt-in via query so list-only callers stay lean.
      let recentDestructions: Awaited<ReturnType<typeof ops.listRecentDestructions>> | undefined;
      if (parsed.data.includeDestructions) {
        recentDestructions = await ops.listRecentDestructions(facilityNumber, { limit: 25 });
      }
      return res.json({
        success: true,
        data: result.rows,
        meta: { total: result.total, page, limit, recentDestructions },
      });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

opsRouter.post(
  "/controlled-sub/counts/:id/resolve",
  requireOpsPermission(OPS_RESOURCES.CONTROLLED_SUB_COUNT, "resolve"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = controlledSubResolveSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const row = await ops.resolveControlledSubDiscrepancy(
        id,
        facilityNumber,
        getActor(req),
        { note: parsed.data.note, witnessedBy: parsed.data.witnessedBy },
      );
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// W3 — Staff Credentials (Wave 2, Epic C)
//
// Routes mirror Wave 1 module shape: every route chains the existing
// requireFacilityAuth + requireActiveSubscription (inherited from the
// router) + requireOpsPermission(STAFF_CREDENTIAL, ...). IDOR guard via
// :facilityNumber. CREDENTIAL_WARNING_DAYS for the evaluate-shift route
// comes from getRegSetting — never from the client.
// ─────────────────────────────────────────────────────────────────────────────

const credentialCreateSchema = z.object({
  staffId: z.number().int().positive(),
  credentialType: z.enum(CREDENTIAL_TYPES),
  issuedAt: z.number().int().nonnegative().nullable().optional(),
  expiresAt: z.number().int().nonnegative().nullable().optional(),
  verifiedAt: z.number().int().nonnegative().nullable().optional(),
  verifiedBy: z.string().trim().max(120).nullable().optional(),
  status: z.enum(CREDENTIAL_STATUSES).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
}).strict();

const credentialUpdateSchema = z.object({
  credentialType: z.enum(CREDENTIAL_TYPES).optional(),
  issuedAt: z.number().int().nonnegative().nullable().optional(),
  expiresAt: z.number().int().nonnegative().nullable().optional(),
  verifiedAt: z.number().int().nonnegative().nullable().optional(),
  verifiedBy: z.string().trim().max(120).nullable().optional(),
  status: z.enum(CREDENTIAL_STATUSES).optional(),
  note: z.string().trim().max(2000).nullable().optional(),
}).strict();

const credentialListQuerySchema = z.object({
  staffId: z.coerce.number().int().positive().optional(),
  credentialType: z.enum(CREDENTIAL_TYPES).optional(),
  status: z.enum(CREDENTIAL_STATUSES).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
}).strict();

const expiringListQuerySchema = z.object({
  withinDays: z.coerce.number().int().positive().max(3650).optional(),
  includeExpired: queryStringBool.optional(),
  limit: z.coerce.number().int().positive().max(500).optional(),
}).strict();

const evaluateShiftSchema = z.object({
  staffId: z.number().int().positive(),
  shiftAtMs: z.number().int().positive(),
}).strict();

// "other" credentials must carry a non-empty note — the audit trail needs
// to know what "other" actually means. Apply on both create and update.
function assertOtherCredentialHasNote(
  credentialType: string | undefined,
  note: string | null | undefined,
): void {
  if (credentialType === "other") {
    if (!note || !note.trim()) {
      throw new Error("credential_type 'other' requires a non-empty note");
    }
  }
}

// GET /facilities/:facilityNumber/staff-credentials
opsRouter.get(
  "/facilities/:facilityNumber/staff-credentials",
  requireOpsPermission(OPS_RESOURCES.STAFF_CREDENTIAL, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = credentialListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await ops.listStaffCredentials(facilityNumber, {
        staffId: parsed.data.staffId,
        credentialType: parsed.data.credentialType,
        status: parsed.data.status,
        page,
        limit,
      });
      return res.json({
        success: true,
        data: result.rows,
        meta: { total: result.total, page, limit },
      });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// GET /staff-credentials/:id
opsRouter.get(
  "/staff-credentials/:id",
  requireOpsPermission(OPS_RESOURCES.STAFF_CREDENTIAL, "read"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const row = await ops.getStaffCredential(id, facilityNumber);
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /staff-credentials
opsRouter.post(
  "/staff-credentials",
  requireOpsPermission(OPS_RESOURCES.STAFF_CREDENTIAL, "create"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const parsed = credentialCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      try {
        assertOtherCredentialHasNote(parsed.data.credentialType, parsed.data.note ?? null);
      } catch (e) {
        return res.status(400).json({ success: false, error: (e as Error).message });
      }
      const actor = getActor(req);
      const row = await ops.createStaffCredential(
        {
          facilityNumber,
          staffId: parsed.data.staffId,
          credentialType: parsed.data.credentialType,
          issuedAt: parsed.data.issuedAt ?? null,
          expiresAt: parsed.data.expiresAt ?? null,
          verifiedAt: parsed.data.verifiedAt ?? null,
          verifiedBy: parsed.data.verifiedBy ?? null,
          status: parsed.data.status ?? "active",
          note: parsed.data.note ?? null,
          createdBy: actor.id,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        actor,
      );
      return res.status(201).json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// PUT /staff-credentials/:id
opsRouter.put(
  "/staff-credentials/:id",
  requireOpsPermission(OPS_RESOURCES.STAFF_CREDENTIAL, "update"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = credentialUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      // The "other" note rule applies to the *resulting* row; if either
      // credentialType or note is being changed, re-check with the merged
      // values. Pull the existing row only when needed.
      const before = await ops.getStaffCredential(id, facilityNumber);
      if (!before) return res.status(404).json({ success: false, error: "Not found" });
      const nextType = parsed.data.credentialType ?? before.credentialType;
      const nextNote =
        parsed.data.note !== undefined ? parsed.data.note : before.note;
      try {
        assertOtherCredentialHasNote(nextType, nextNote);
      } catch (e) {
        return res.status(400).json({ success: false, error: (e as Error).message });
      }
      const row = await ops.updateStaffCredential(
        id,
        facilityNumber,
        parsed.data,
        getActor(req),
      );
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// DELETE /staff-credentials/:id — soft delete
opsRouter.delete(
  "/staff-credentials/:id",
  requireOpsPermission(OPS_RESOURCES.STAFF_CREDENTIAL, "delete"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const ok = await ops.softDeleteStaffCredential(id, facilityNumber, getActor(req));
      if (!ok) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: { id, deleted: true } });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// GET /facilities/:facilityNumber/credentials/expiring
opsRouter.get(
  "/facilities/:facilityNumber/credentials/expiring",
  requireOpsPermission(OPS_RESOURCES.STAFF_CREDENTIAL, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = expiringListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      // If client doesn't pass withinDays, default to the facility's
      // CREDENTIAL_WARNING_DAYS reg setting (Wave 2 acceptance criterion).
      let withinDays = parsed.data.withinDays;
      if (typeof withinDays !== "number") {
        const raw = await getRegSetting(facilityNumber, "CREDENTIAL_WARNING_DAYS");
        const parsedDays = parseInt(raw, 10);
        withinDays = Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 60;
      }
      const data = await ops.listExpiringCredentials(facilityNumber, {
        withinDays,
        includeExpired: parsed.data.includeExpired ?? false,
        limit: parsed.data.limit ?? 50,
      });
      return res.json({
        success: true,
        data,
        meta: { withinDays, count: data.length },
      });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /facilities/:facilityNumber/credentials/evaluate-shift
opsRouter.post(
  "/facilities/:facilityNumber/credentials/evaluate-shift",
  requireOpsPermission(OPS_RESOURCES.STAFF_CREDENTIAL, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = evaluateShiftSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      // warningDays comes from reg settings — never trust the client.
      const raw = await getRegSetting(facilityNumber, "CREDENTIAL_WARNING_DAYS");
      const parsedDays = parseInt(raw, 10);
      const warningDays =
        Number.isFinite(parsedDays) && parsedDays > 0 ? parsedDays : 60;
      const result = await ops.evaluateStaffCredentialsForShift(
        facilityNumber,
        parsed.data.staffId,
        parsed.data.shiftAtMs,
        warningDays,
      );
      return res.json({ success: true, data: { ...result, warningDays } });
    } catch (e) {
      if (e instanceof Error && /staff not found/i.test(e.message)) {
        return res.status(404).json({ success: false, error: e.message });
      }
      return handleRouteError(req, e, res);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Module 3 — W4 Incident Lifecycle Closer (BA §5 W4, §6 state machine)
//
// Four routes added next to the existing /incidents endpoints. Permissions
// are wired via requireOpsPermission against the OPS_RESOURCES.INCIDENT
// resource (matrix in server/ops/permissions.ts). Zod schemas use .strict()
// so an unexpected field surfaces as 400 rather than being silently dropped.
// event_severity is NEVER accepted from the wire — derivation lives in the
// storage layer via classifyIncidentSeverity().
// ─────────────────────────────────────────────────────────────────────────────

const incidentCloseSchema = z.object({
  closureNote: z.string().trim().min(8, "Closure note must be at least 8 characters").max(4000),
}).strict();

const incidentReopenSchema = z.object({
  reason: z.string().trim().min(8, "Reopen reason must be at least 8 characters").max(4000),
}).strict();

const incidentPastSlaQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(200).optional(),
}).strict();

// GET /incidents/:id/checklist
opsRouter.get(
  "/incidents/:id/checklist",
  requireOpsPermission(OPS_RESOURCES.INCIDENT, "read"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const data = await ops.evaluateIncidentChecklist(facilityNumber, id);
      if (!data) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /incidents/:id/close
opsRouter.post(
  "/incidents/:id/close",
  requireOpsPermission(OPS_RESOURCES.INCIDENT, "close"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = incidentCloseSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const row = await ops.closeIncident(
        id,
        facilityNumber,
        actor.id,
        parsed.data.closureNote,
        actor,
      );
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /incidents/:id/reopen
opsRouter.post(
  "/incidents/:id/reopen",
  requireOpsPermission(OPS_RESOURCES.INCIDENT, "update"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = incidentReopenSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const row = await ops.reopenIncident(
        id,
        facilityNumber,
        actor.id,
        parsed.data.reason,
        actor,
      );
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// GET /facilities/:facilityNumber/incidents/past-sla?limit=
opsRouter.get(
  "/facilities/:facilityNumber/incidents/past-sla",
  requireOpsPermission(OPS_RESOURCES.INCIDENT, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = incidentPastSlaQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const data = await ops.listIncidentsPastSla(facilityNumber, {
        limit: parsed.data.limit,
      });
      return res.json({ success: true, data });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Wave 2 finale — Obligation engine (BA §4.3, §6, §9 G3)
//
// Routes are permission-gated against OPS_RESOURCES.OBLIGATION. The state
// machine is enforced inside obligationsStorage.transitionObligation —
// illegal transitions throw `Cannot transition from <from> to <to>` and
// surface here as 400 via isDomainError.
// ─────────────────────────────────────────────────────────────────────────────

const obligationCreateSchema = z.object({
  obligationType: z.enum(OBLIGATION_TYPES),
  targetType: z.enum(OBLIGATION_TARGETS).optional(),
  targetId: z.number().int().positive().nullable().optional(),
  title: z.string().min(1, "Title is required").max(200),
  description: z.string().max(4000).nullable().optional(),
  dueAt: z.number().int({ message: "dueAt required" }),
  assignedTo: z.string().max(200).nullable().optional(),
  severity: z.enum(OBLIGATION_SEVERITIES).optional(),
  status: z.enum(OBLIGATION_STATUSES).optional(),
  evidenceRequired: z.number().int().min(0).max(1).optional(),
  // Constrained at zod-level so the recurrence rule grammar is enforced
  // up front. Storage just trusts the validated string.
  recurrenceRule: z
    .union([
      z.literal("annual"),
      z.literal("quarterly"),
      z.literal("monthly"),
      z.string().regex(/^every_n_days:\d+$/),
    ])
    .nullable()
    .optional(),
  reminderDaysBefore: z.number().int().nonnegative().max(365).nullable().optional(),
  sourceEntityType: z.string().max(64).nullable().optional(),
  sourceEntityId: z.number().int().nullable().optional(),
  notes: z.string().max(8000).nullable().optional(),
}).strict();

const obligationUpdateSchema = z.object({
  obligationType: z.enum(OBLIGATION_TYPES).optional(),
  targetType: z.enum(OBLIGATION_TARGETS).optional(),
  targetId: z.number().int().nullable().optional(),
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(4000).nullable().optional(),
  dueAt: z.number().int().optional(),
  assignedTo: z.string().max(200).nullable().optional(),
  severity: z.enum(OBLIGATION_SEVERITIES).optional(),
  evidenceRequired: z.number().int().min(0).max(1).optional(),
  recurrenceRule: z
    .union([
      z.literal("annual"),
      z.literal("quarterly"),
      z.literal("monthly"),
      z.string().regex(/^every_n_days:\d+$/),
    ])
    .nullable()
    .optional(),
  reminderDaysBefore: z.number().int().nonnegative().max(365).optional(),
  notes: z.string().max(8000).nullable().optional(),
}).strict();

const obligationTransitionSchema = z.object({
  status: z.enum(OBLIGATION_STATUSES),
  note: z.string().max(2000).optional(),
  completedBy: z.string().max(200).optional(),
}).strict();

const obligationCompleteSchema = z.object({
  by: z.string().min(1, "by is required").max(200),
  note: z.string().max(2000).optional(),
}).strict();

const obligationListQuerySchema = z.object({
  status: z.enum(OBLIGATION_STATUSES).optional(),
  obligationType: z.enum(OBLIGATION_TYPES).optional(),
  targetType: z.enum(OBLIGATION_TARGETS).optional(),
  targetId: z.coerce.number().int().positive().optional(),
  severity: z.enum(OBLIGATION_SEVERITIES).optional(),
  assignedTo: z.string().max(200).optional(),
  dueWithinDays: z.coerce.number().int().nonnegative().max(3650).optional(),
  overdueOnly: queryStringBool.optional(),
  sourceEntityType: z.string().max(64).optional(),
  sourceEntityId: z.coerce.number().int().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
  includeDeleted: queryStringBool.optional(),
}).strict();

// GET /facilities/:facilityNumber/obligations
opsRouter.get(
  "/facilities/:facilityNumber/obligations",
  requireOpsPermission(OPS_RESOURCES.OBLIGATION, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = obligationListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await obligations.listObligations(facilityNumber, {
        status: parsed.data.status,
        obligationType: parsed.data.obligationType,
        targetType: parsed.data.targetType,
        targetId: parsed.data.targetId,
        severity: parsed.data.severity,
        assignedTo: parsed.data.assignedTo,
        dueWithinDays: parsed.data.dueWithinDays,
        overdueOnly: parsed.data.overdueOnly,
        sourceEntityType: parsed.data.sourceEntityType,
        sourceEntityId: parsed.data.sourceEntityId,
        page: parsed.data.page ?? page,
        limit: parsed.data.limit ?? limit,
        includeDeleted: parsed.data.includeDeleted,
      });
      return res.json({
        success: true,
        data: result.rows,
        meta: {
          total: result.total,
          page: parsed.data.page ?? page,
          limit: parsed.data.limit ?? limit,
        },
      });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// GET /obligations/:id
opsRouter.get(
  "/obligations/:id",
  requireOpsPermission(OPS_RESOURCES.OBLIGATION, "read"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const row = await obligations.getObligation(id, facilityNumber);
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /obligations
opsRouter.post(
  "/obligations",
  requireOpsPermission(OPS_RESOURCES.OBLIGATION, "create"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const parsed = obligationCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const now = Date.now();
      const row = await obligations.createObligation(
        {
          facilityNumber,
          obligationType: parsed.data.obligationType,
          targetType: parsed.data.targetType ?? "facility",
          targetId: parsed.data.targetId ?? null,
          title: parsed.data.title,
          description: parsed.data.description ?? null,
          dueAt: parsed.data.dueAt,
          completedAt: null,
          completedBy: null,
          assignedTo: parsed.data.assignedTo ?? null,
          severity: parsed.data.severity ?? "medium",
          status: parsed.data.status ?? "pending",
          evidenceRequired: parsed.data.evidenceRequired ?? 0,
          recurrenceRule: parsed.data.recurrenceRule ?? null,
          reminderDaysBefore: parsed.data.reminderDaysBefore ?? 30,
          sourceEntityType: parsed.data.sourceEntityType ?? null,
          sourceEntityId: parsed.data.sourceEntityId ?? null,
          notes: parsed.data.notes ?? null,
          createdBy: actor.id,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        },
        actor,
      );
      return res.status(201).json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// PUT /obligations/:id
opsRouter.put(
  "/obligations/:id",
  requireOpsPermission(OPS_RESOURCES.OBLIGATION, "update"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = obligationUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const row = await obligations.updateObligation(
        id,
        facilityNumber,
        parsed.data,
        getActor(req),
      );
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /obligations/:id/transition
opsRouter.post(
  "/obligations/:id/transition",
  requireOpsPermission(OPS_RESOURCES.OBLIGATION, "update"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = obligationTransitionSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const row = await obligations.transitionObligation(
        id,
        facilityNumber,
        parsed.data.status,
        getActor(req),
        { note: parsed.data.note, completedBy: parsed.data.completedBy },
      );
      if (!row) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /obligations/:id/complete
opsRouter.post(
  "/obligations/:id/complete",
  requireOpsPermission(OPS_RESOURCES.OBLIGATION, "update"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const parsed = obligationCompleteSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ success: false, error: parsed.error.errors[0].message });
      }
      const result = await obligations.completeObligation(
        id,
        facilityNumber,
        parsed.data.by,
        getActor(req),
        parsed.data.note,
      );
      if (!result) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: result });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// DELETE /obligations/:id — soft delete
opsRouter.delete(
  "/obligations/:id",
  requireOpsPermission(OPS_RESOURCES.OBLIGATION, "delete"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res.status(401).json({ success: false, error: "Not authenticated" });
      }
      const id = parseIdParam(req.params.id);
      if (id === null) return res.status(400).json({ success: false, error: "Invalid id" });
      const ok = await obligations.softDeleteObligation(id, facilityNumber, getActor(req));
      if (!ok) return res.status(404).json({ success: false, error: "Not found" });
      return res.json({ success: true, data: { id, deleted: true } });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /facilities/:facilityNumber/obligations/backfill-legacy
opsRouter.post(
  "/facilities/:facilityNumber/obligations/backfill-legacy",
  requireOpsPermission(OPS_RESOURCES.OBLIGATION, "create"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const result = await obligations.backfillLegacyComplianceItems(
        facilityNumber,
        getActor(req),
      );
      return res.json({ success: true, data: result });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Wave 3 Phase 3.1 — W1 Daily Triage + W14 Daily Summary Email
// ─────────────────────────────────────────────────────────────────────────────
//
// W1 reads the eleven-section triage payload for the Audit Readiness drill-
// down list. W14 paginates the daily-summary notification log and exposes a
// "send test email" admin action that bypasses the hour + idempotency guards.
//
// Permission mapping:
//   GET /triage         — OBLIGATION:read   (umbrella — the aggregator spans
//                                            every audit-readiness surface)
//   GET /notifications  — AUDIT_TRAIL:read  (the log is forensic + insert-only,
//                                            so it shares the audit-trail read perm)
//   POST /daily-summary/test-send — REG_SETTING:manage_settings  (matches the
//                                            existing reg-settings mutate perm)

// GET /facilities/:facilityNumber/triage?perSectionLimit=&now=
opsRouter.get(
  "/facilities/:facilityNumber/triage",
  requireOpsPermission(OPS_RESOURCES.OBLIGATION, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = triageQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const data = await aggregateTriage(facilityNumber, {
        perSectionLimit: parsed.data.perSectionLimit,
        now: parsed.data.now,
      });
      return res.json({ success: true, data });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// GET /facilities/:facilityNumber/notifications?kind=&deliveryStatus=&sinceMs=&untilMs=&page=&limit=
opsRouter.get(
  "/facilities/:facilityNumber/notifications",
  requireOpsPermission(OPS_RESOURCES.AUDIT_TRAIL, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = notificationListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await listNotifications(facilityNumber, {
        kind: parsed.data.kind as NotificationKind | undefined,
        deliveryStatus: parsed.data.deliveryStatus as DeliveryStatus | undefined,
        sinceMs: parsed.data.sinceMs,
        untilMs: parsed.data.untilMs,
        page,
        limit,
      });
      return res.json({
        success: true,
        data: result.rows,
        meta: { total: result.total, page, limit },
      });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /facilities/:facilityNumber/daily-summary/test-send
opsRouter.post(
  "/facilities/:facilityNumber/daily-summary/test-send",
  requireOpsPermission(OPS_RESOURCES.REG_SETTING, "manage_settings"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = dailySummaryTestSendSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const result = await sendDailySummaryForFacility(facilityNumber, {
        manualTest: true,
        overrideRecipients: parsed.data.overrideRecipients,
      });
      return res.json({ success: true, data: result });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Wave 3 Phase 3.2 — Auditor share-links + W2 pre-audit pulls (admin side)
//
// The AUDITOR session that *consumes* a minted token uses a separate router
// mounted at /api/ops/auditor with `requireAuditorToken` instead of the
// facility-Passport guard. See server/ops/auditorRouter.ts. The endpoints
// below are the *admin* side: mint a token, list them, revoke; mint a
// pre-audit bundle, list past pulls.
//
// Permission mapping:
//   POST /facilities/:fn/share-links             — SHARE_LINK:create
//   GET  /facilities/:fn/share-links             — SHARE_LINK:read
//   POST /share-links/:id/revoke                 — SHARE_LINK:update
//   POST /facilities/:fn/preaudit-pull           — PREAUDIT_PULL:create
//   GET  /facilities/:fn/preaudit-pulls          — PREAUDIT_PULL:read
// ─────────────────────────────────────────────────────────────────────────────

const shareLinkCreateSchema = z
  .object({
    audience: z.enum(AUDITOR_AUDIENCES),
    audienceLabel: z.string().max(200).optional(),
    scope: z.enum(SHARE_LINK_SCOPES).optional(),
    durationDays: z
      .number()
      .positive()
      .max(MAX_SHARE_LINK_DURATION_DAYS)
      .optional(),
  })
  .strict();

const shareLinkListQuerySchema = z
  .object({
    includeRevoked: z.coerce.boolean().optional(),
    includeExpired: z.coerce.boolean().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .strict();

const preauditPullSchema = z
  .object({
    audience: z.enum(AUDITOR_AUDIENCES),
    audienceLabel: z.string().max(200).optional(),
    windowStartAt: z.number().int().nonnegative(),
    windowEndAt: z.number().int().positive(),
    sections: z.array(z.enum(PREAUDIT_SECTIONS)).min(1).max(PREAUDIT_SECTIONS.length),
    deliveryMethod: z.enum(["download", "share_link"]),
    shareDurationDays: z
      .number()
      .positive()
      .max(MAX_SHARE_LINK_DURATION_DAYS)
      .optional(),
    // Wave 5 — also persist the bundle to the Reports Hub so the admin
    // can re-download it later. Defaults to true; opt out by passing false.
    saveToReports: z.boolean().optional(),
  })
  .strict()
  .refine((v) => v.windowStartAt < v.windowEndAt, {
    message: "windowStartAt must be < windowEndAt",
  });

const preauditPullListQuerySchema = z
  .object({
    sinceMs: z.coerce.number().int().nonnegative().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .strict();

// POST /facilities/:facilityNumber/share-links
opsRouter.post(
  "/facilities/:facilityNumber/share-links",
  requireOpsPermission(OPS_RESOURCES.SHARE_LINK, "create"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = shareLinkCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const row = await createShareLink(
        {
          facilityNumber,
          audience: parsed.data.audience,
          audienceLabel: parsed.data.audienceLabel,
          scope: parsed.data.scope,
          durationDays:
            parsed.data.durationDays ?? DEFAULT_SHARE_LINK_DURATION_DAYS,
          createdBy: actor.id,
        },
        actor,
      );
      return res.status(201).json({ success: true, data: row });
    } catch (e) {
      if (e instanceof ShareLinkDurationError) {
        return res.status(400).json({ success: false, error: e.message });
      }
      return handleRouteError(req, e, res);
    }
  },
);

// GET /facilities/:facilityNumber/share-links
opsRouter.get(
  "/facilities/:facilityNumber/share-links",
  requireOpsPermission(OPS_RESOURCES.SHARE_LINK, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = shareLinkListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await listShareLinks(facilityNumber, {
        includeRevoked: parsed.data.includeRevoked,
        includeExpired: parsed.data.includeExpired,
        page,
        limit,
      });
      return res.json({
        success: true,
        data: result.rows,
        meta: { total: result.total, page, limit },
      });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /share-links/:id/revoke
// The facility scope is enforced inside revokeShareLink via the tenant
// WHERE — no `:facilityNumber` URL param needed here.
opsRouter.post(
  "/share-links/:id/revoke",
  requireOpsPermission(OPS_RESOURCES.SHARE_LINK, "update"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid id" });
      }
      const actor = getActor(req);
      const ok = await revokeShareLink(id, facilityNumber, actor.id, actor);
      if (!ok) {
        return res
          .status(404)
          .json({ success: false, error: "Share link not found" });
      }
      return res.json({ success: true });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /facilities/:facilityNumber/preaudit-pull
//
// Body: PreauditPullSpec. Returns PreauditPullResult. When delivery is
// 'download', the bundle is returned inline. When 'share_link', a share
// link is minted alongside and the bundle is NOT returned inline (the
// auditor pulls it back via /api/ops/auditor/preaudit-pull/:id).
opsRouter.post(
  "/facilities/:facilityNumber/preaudit-pull",
  requireOpsPermission(OPS_RESOURCES.PREAUDIT_PULL, "create"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = preauditPullSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const spec = parsed.data;

      const { bundle, totals } = await generatePreauditBundle(
        facilityNumber,
        spec,
      );

      let shareLinkId: number | undefined;
      let shareToken: string | undefined;
      if (spec.deliveryMethod === "share_link") {
        try {
          const link = await createShareLink(
            {
              facilityNumber,
              audience: spec.audience,
              audienceLabel: spec.audienceLabel,
              durationDays:
                spec.shareDurationDays ?? DEFAULT_SHARE_LINK_DURATION_DAYS,
              createdBy: actor.id,
            },
            actor,
          );
          shareLinkId = link.id;
          shareToken = link.token;
        } catch (e) {
          if (e instanceof ShareLinkDurationError) {
            return res
              .status(400)
              .json({ success: false, error: e.message });
          }
          throw e;
        }
      }

      const pull = await recordPreauditPull(
        facilityNumber,
        spec,
        totals,
        {
          method: spec.deliveryMethod,
          shareLinkId,
        },
        actor.id,
        actor,
      );

      // Wave 5 — optionally persist the bundle to the Reports Hub. Defaults
      // to true; opt-out via `saveToReports: false` in the body. Best-
      // effort — persistAsReport swallows its own errors so a Reports-Hub
      // failure can't roll back the originating pull.
      let reportId: number | undefined;
      const wantSave = spec.saveToReports !== false;
      if (wantSave) {
        const reportRow = await persistAsReport(
          facilityNumber,
          bundle,
          totals,
          spec,
          actor.id,
          actor,
          pull.id,
        );
        if (reportRow) reportId = reportRow.id;
      }

      const result = {
        preauditPullId: pull.id,
        shareLinkId,
        shareToken,
        reportId,
        generatedAt: pull.generatedAt,
        windowStartAt: pull.windowStartAt,
        windowEndAt: pull.windowEndAt,
        totals,
        // Bundle only inline when delivery=download. With share_link the
        // auditor pulls the bundle via the auditor router using the
        // minted token (the bundle is NOT persisted server-side; the
        // section-on-demand endpoint regenerates it from the source
        // rows so it stays current).
        bundle: spec.deliveryMethod === "download" ? bundle : undefined,
      };
      return res.status(201).json({ success: true, data: result });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// GET /facilities/:facilityNumber/preaudit-pulls
opsRouter.get(
  "/facilities/:facilityNumber/preaudit-pulls",
  requireOpsPermission(OPS_RESOURCES.PREAUDIT_PULL, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = preauditPullListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await listPreauditPulls(facilityNumber, {
        sinceMs: parsed.data.sinceMs,
        page,
        limit,
      });
      return res.json({
        success: true,
        data: result.rows,
        meta: { total: result.total, page, limit },
      });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Wave 4 Phase 4.1 (W6) — Posting verification routes
//
// Permission mapping:
//   GET    /facilities/:fn/postings                         — POSTING:read
//   POST   /facilities/:fn/postings/seed                    — POSTING:create
//   POST   /postings                                         — POSTING:create
//   PUT    /postings/:id                                     — POSTING:update
//   POST   /postings/:id/archive                             — POSTING:update
//   GET    /facilities/:fn/postings/:catalogId/verifications — POSTING:read
//   POST   /postings/:catalogId/verify                       — POSTING:create
//   GET    /facilities/:fn/drills/cadence                   — DRILL_LOG:read (existing)
// ─────────────────────────────────────────────────────────────────────────────

const postingCatalogCreateSchema = z
  .object({
    postingKey: z.enum(POSTING_KEYS),
    titleEn: z.string().min(1).max(200),
    titleEs: z.string().max(200).nullable().optional(),
    locationHint: z.string().max(200).nullable().optional(),
    required: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
    cadenceDays: z.number().int().positive().max(3650).optional(),
    notes: z.string().max(4000).nullable().optional(),
  })
  .strict();

const postingCatalogUpdateSchema = z
  .object({
    titleEn: z.string().min(1).max(200).optional(),
    titleEs: z.string().max(200).nullable().optional(),
    locationHint: z.string().max(200).nullable().optional(),
    required: z.union([z.boolean(), z.number().int().min(0).max(1)]).optional(),
    cadenceDays: z.number().int().positive().max(3650).optional(),
    notes: z.string().max(4000).nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .strict();

const postingVerifyCreateSchema = z
  .object({
    status: z.enum(POSTING_VERIFICATION_STATUSES),
    verifiedAt: z.number().int().positive().nullable().optional(),
    note: z.string().max(4000).nullable().optional(),
  })
  .strict();

const postingVerificationListQuerySchema = z
  .object({
    catalogId: z.coerce.number().int().positive().optional(),
    sinceMs: z.coerce.number().int().nonnegative().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .strict();

// GET /facilities/:facilityNumber/postings
opsRouter.get(
  "/facilities/:facilityNumber/postings",
  requireOpsPermission(OPS_RESOURCES.POSTING, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const includeArchived = req.query.includeArchived === "true"
        || req.query.includeArchived === "1";
      const rows = await listPostingCatalog(facilityNumber, { includeArchived });
      return res.json({ success: true, data: rows });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /facilities/:facilityNumber/postings/seed — idempotent
opsRouter.post(
  "/facilities/:facilityNumber/postings/seed",
  requireOpsPermission(OPS_RESOURCES.POSTING, "create"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const actor = getActor(req);
      const result = await seedDefaultPostings(facilityNumber, actor);
      return res.status(201).json({ success: true, data: result });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /postings  (body carries facilityNumber)
opsRouter.post(
  "/postings",
  requireOpsPermission(OPS_RESOURCES.POSTING, "create"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }
      const parsed = postingCatalogCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const requiredVal =
        typeof parsed.data.required === "boolean"
          ? parsed.data.required ? 1 : 0
          : parsed.data.required ?? 1;
      const row = await createPostingCatalogEntry(
        {
          facilityNumber,
          postingKey: parsed.data.postingKey,
          titleEn: parsed.data.titleEn,
          titleEs: parsed.data.titleEs ?? null,
          locationHint: parsed.data.locationHint ?? null,
          required: requiredVal,
          cadenceDays: parsed.data.cadenceDays ?? 30,
          notes: parsed.data.notes ?? null,
          status: "active",
          createdBy: actor.id,
          // createdAt + updatedAt stamped inside storage
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        actor,
      );
      return res.status(201).json({ success: true, data: row });
    } catch (e) {
      // Unique-violation (active row with same posting_key already exists)
      if ((e as { code?: string }).code === "23505") {
        return res
          .status(409)
          .json({ success: false, error: "Posting already exists for this key" });
      }
      return handleRouteError(req, e, res);
    }
  },
);

// PUT /postings/:id
opsRouter.put(
  "/postings/:id",
  requireOpsPermission(OPS_RESOURCES.POSTING, "update"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const parsed = postingCatalogUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const partial: Record<string, unknown> = { ...parsed.data };
      if (typeof partial.required === "boolean") {
        partial.required = partial.required ? 1 : 0;
      }
      const row = await updatePostingCatalogEntry(id, facilityNumber, partial, actor);
      if (!row) {
        return res.status(404).json({ success: false, error: "Posting not found" });
      }
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /postings/:id/archive
opsRouter.post(
  "/postings/:id/archive",
  requireOpsPermission(OPS_RESOURCES.POSTING, "update"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const actor = getActor(req);
      const ok = await archivePostingCatalogEntry(id, facilityNumber, actor);
      if (!ok) {
        return res
          .status(404)
          .json({ success: false, error: "Posting not found or already archived" });
      }
      return res.json({ success: true });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// GET /facilities/:facilityNumber/postings/:catalogId/verifications
opsRouter.get(
  "/facilities/:facilityNumber/postings/:catalogId/verifications",
  requireOpsPermission(OPS_RESOURCES.POSTING, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const catalogId = parseInt(String(req.params.catalogId), 10);
      if (!Number.isInteger(catalogId) || catalogId <= 0) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid catalog id" });
      }
      const parsed = postingVerificationListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      // Verify the catalog row belongs to this facility before listing —
      // defense in depth against the auditor route shape leaking cross-
      // tenant verification ids.
      const catalog = await getPostingCatalogEntry(catalogId, facilityNumber);
      if (!catalog) {
        return res
          .status(404)
          .json({ success: false, error: "Posting not found" });
      }
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await listPostingVerifications(facilityNumber, {
        catalogId,
        sinceMs: parsed.data.sinceMs,
        page,
        limit,
      });
      return res.json({
        success: true,
        data: result.rows,
        meta: { total: result.total, page, limit },
      });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /postings/:catalogId/verify
opsRouter.post(
  "/postings/:catalogId/verify",
  requireOpsPermission(OPS_RESOURCES.POSTING, "create"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }
      const catalogId = parseInt(String(req.params.catalogId), 10);
      if (!Number.isInteger(catalogId) || catalogId <= 0) {
        return res
          .status(400)
          .json({ success: false, error: "Invalid catalog id" });
      }
      const parsed = postingVerifyCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const now = Date.now();
      const catalog = await getPostingCatalogEntry(catalogId, facilityNumber);
      if (!catalog) {
        return res
          .status(404)
          .json({ success: false, error: "Posting not found" });
      }
      const row = await createPostingVerification(
        {
          facilityNumber,
          catalogId,
          postingKey: catalog.postingKey,
          verifiedAt: parsed.data.verifiedAt ?? now,
          verifiedBy: actor.id,
          status: parsed.data.status,
          note: parsed.data.note ?? null,
          evidenceCount: 0,
          createdAt: now,
        },
        actor,
      );
      return res.status(201).json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// GET /facilities/:facilityNumber/drills/cadence
opsRouter.get(
  "/facilities/:facilityNumber/drills/cadence",
  requireOpsPermission(OPS_RESOURCES.DRILL_LOG, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const cadence = await getDrillCadence(facilityNumber);
      return res.json({ success: true, data: cadence });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Wave 4 Phase 4.2 (W12) — Resident trust account routes
//
// Feature gate: every route returns 404 with body
// "Trust accounts are not enabled for this facility" unless
// RESIDENT_TRUST_ENABLED='true' for the facility. The middleware below is
// the first thing in the route handler chain so a disabled facility pays
// no DB cost beyond one reg-settings read.
//
// Permission mapping:
//   GET    /facilities/:fn/trust/accounts                       — RESIDENT_TRUST:read
//   GET    /trust/accounts/:id                                  — RESIDENT_TRUST:read
//   POST   /trust/accounts                                      — RESIDENT_TRUST:create
//   POST   /trust/accounts/:id/close                            — RESIDENT_TRUST:update
//   GET    /trust/accounts/:id/ledger                           — RESIDENT_TRUST:read
//   POST   /trust/accounts/:id/ledger                           — RESIDENT_TRUST:create
//   POST   /trust/ledger/:entryId/reverse                       — RESIDENT_TRUST:create
//   GET    /trust/accounts/:id/reconcile                        — RESIDENT_TRUST:read
//   POST   /trust/accounts/:id/repair-balance                   — RESIDENT_TRUST:update
//   POST   /trust/accounts/:id/statements                       — RESIDENT_TRUST:create
//   GET    /trust/accounts/:id/statements                       — RESIDENT_TRUST:read
// ─────────────────────────────────────────────────────────────────────────────

// Translate TrustDomainError → HTTP response. 409 for domain rejections is
// the right shape (conflict with current resource state — closed account,
// non-zero balance, missing witness, etc.).
function handleTrustDomainError(res: Response, err: unknown): boolean {
  if (err instanceof TrustDomainError) {
    res.status(409).json({ success: false, error: err.message, code: err.code });
    return true;
  }
  return false;
}

async function requireTrustEnabled(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const facilityNumber = getFacilityNumber(req);
  if (!facilityNumber) {
    res.status(401).json({ success: false, error: "Not authenticated" });
    return;
  }
  const enabled = await isTrustEnabled(facilityNumber);
  if (!enabled) {
    res.status(404).json({
      success: false,
      error: "Trust accounts are not enabled for this facility",
    });
    return;
  }
  next();
}

const trustListAccountsQuerySchema = z
  .object({
    residentId: z.coerce.number().int().positive().optional(),
    status: z.enum(["active", "closed"]).optional(),
    includeClosed: z
      .union([z.literal("true"), z.literal("1"), z.literal("false"), z.literal("0")])
      .optional(),
  })
  .strict();

const trustCreateAccountSchema = z
  .object({ residentId: z.number().int().positive() })
  .strict();

const trustLedgerListQuerySchema = z
  .object({
    sinceMs: z.coerce.number().int().nonnegative().optional(),
    untilMs: z.coerce.number().int().nonnegative().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
  })
  .strict();

const trustLedgerCreateSchema = z
  .object({
    direction: z.enum(TRUST_LEDGER_DIRECTIONS),
    amountCents: z.number().int().positive(),
    category: z.enum(TRUST_LEDGER_CATEGORIES),
    description: z.string().min(1).max(500),
    transactedAt: z.number().int().positive(),
    recordedBy: z.string().min(1).max(120),
    witnessedBy: z.string().min(1).max(120).nullable().optional(),
    notes: z.string().max(2000).nullable().optional(),
    receiptUri: z.string().max(2000).nullable().optional(),
  })
  .strict();

const trustReverseSchema = z
  .object({ reason: z.string().min(1).max(500) })
  .strict();

const trustStatementCreateSchema = z
  .object({
    periodStartAt: z.number().int().nonnegative(),
    periodEndAt: z.number().int().positive(),
  })
  .strict()
  .refine((v) => v.periodStartAt < v.periodEndAt, {
    message: "periodStartAt must be strictly less than periodEndAt",
  });

// GET /facilities/:facilityNumber/trust/accounts
opsRouter.get(
  "/facilities/:facilityNumber/trust/accounts",
  requireOpsPermission(OPS_RESOURCES.RESIDENT_TRUST, "read"),
  requireTrustEnabled,
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = trustListAccountsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const includeClosed =
        parsed.data.includeClosed === "true" || parsed.data.includeClosed === "1";
      const rows = await listTrustAccounts(facilityNumber, {
        residentId: parsed.data.residentId,
        status: parsed.data.status,
        includeClosed,
      });
      return res.json({ success: true, data: rows });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// GET /trust/accounts/:id
opsRouter.get(
  "/trust/accounts/:id",
  requireOpsPermission(OPS_RESOURCES.RESIDENT_TRUST, "read"),
  requireTrustEnabled,
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const row = await getTrustAccount(id, facilityNumber);
      if (!row) {
        return res.status(404).json({ success: false, error: "Trust account not found" });
      }
      return res.json({ success: true, data: row });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /trust/accounts  — body { residentId }
opsRouter.post(
  "/trust/accounts",
  requireOpsPermission(OPS_RESOURCES.RESIDENT_TRUST, "create"),
  requireTrustEnabled,
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      const parsed = trustCreateAccountSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const row = await ensureTrustAccount(
        facilityNumber,
        parsed.data.residentId,
        actor.id,
        actor,
      );
      return res.status(201).json({ success: true, data: row });
    } catch (e) {
      if (handleTrustDomainError(res, e)) return;
      return handleRouteError(req, e, res);
    }
  },
);

// POST /trust/accounts/:id/close
opsRouter.post(
  "/trust/accounts/:id/close",
  requireOpsPermission(OPS_RESOURCES.RESIDENT_TRUST, "update"),
  requireTrustEnabled,
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const actor = getActor(req);
      const row = await closeTrustAccount(id, facilityNumber, actor.id, actor);
      if (!row) {
        return res.status(404).json({ success: false, error: "Trust account not found" });
      }
      return res.json({ success: true, data: row });
    } catch (e) {
      if (handleTrustDomainError(res, e)) return;
      return handleRouteError(req, e, res);
    }
  },
);

// GET /trust/accounts/:id/ledger
opsRouter.get(
  "/trust/accounts/:id/ledger",
  requireOpsPermission(OPS_RESOURCES.RESIDENT_TRUST, "read"),
  requireTrustEnabled,
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const parsed = trustLedgerListQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      // Verify the account belongs to this facility — defense in depth so
      // the ledger doesn't leak across tenants if the id is guessed.
      const acct = await getTrustAccount(id, facilityNumber);
      if (!acct) {
        return res.status(404).json({ success: false, error: "Trust account not found" });
      }
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await listLedger(facilityNumber, {
        accountId: id,
        sinceMs: parsed.data.sinceMs,
        untilMs: parsed.data.untilMs,
        page,
        limit,
      });
      return res.json({
        success: true,
        data: result.rows,
        meta: { total: result.total, page, limit },
      });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

// POST /trust/accounts/:id/ledger
opsRouter.post(
  "/trust/accounts/:id/ledger",
  requireOpsPermission(OPS_RESOURCES.RESIDENT_TRUST, "create"),
  requireTrustEnabled,
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const parsed = trustLedgerCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const row = await appendLedgerEntry(facilityNumber, id, nullsToUndef(parsed.data), actor);
      return res.status(201).json({ success: true, data: row });
    } catch (e) {
      if (handleTrustDomainError(res, e)) return;
      return handleRouteError(req, e, res);
    }
  },
);

// POST /trust/ledger/:entryId/reverse
opsRouter.post(
  "/trust/ledger/:entryId/reverse",
  requireOpsPermission(OPS_RESOURCES.RESIDENT_TRUST, "create"),
  requireTrustEnabled,
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      const entryId = parseInt(String(req.params.entryId), 10);
      if (!Number.isInteger(entryId) || entryId <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const parsed = trustReverseSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const row = await recordReversal(facilityNumber, entryId, parsed.data.reason, actor);
      return res.status(201).json({ success: true, data: row });
    } catch (e) {
      if (handleTrustDomainError(res, e)) return;
      return handleRouteError(req, e, res);
    }
  },
);

// GET /trust/accounts/:id/reconcile
opsRouter.get(
  "/trust/accounts/:id/reconcile",
  requireOpsPermission(OPS_RESOURCES.RESIDENT_TRUST, "read"),
  requireTrustEnabled,
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const data = await reconcileAccount(id, facilityNumber);
      return res.json({ success: true, data });
    } catch (e) {
      if (handleTrustDomainError(res, e)) return;
      return handleRouteError(req, e, res);
    }
  },
);

// POST /trust/accounts/:id/repair-balance
opsRouter.post(
  "/trust/accounts/:id/repair-balance",
  requireOpsPermission(OPS_RESOURCES.RESIDENT_TRUST, "update"),
  requireTrustEnabled,
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const actor = getActor(req);
      const row = await repairBalance(id, facilityNumber, actor);
      if (!row) {
        return res.status(404).json({ success: false, error: "Trust account not found" });
      }
      return res.json({ success: true, data: row });
    } catch (e) {
      if (handleTrustDomainError(res, e)) return;
      return handleRouteError(req, e, res);
    }
  },
);

// POST /trust/accounts/:id/statements
opsRouter.post(
  "/trust/accounts/:id/statements",
  requireOpsPermission(OPS_RESOURCES.RESIDENT_TRUST, "create"),
  requireTrustEnabled,
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const parsed = trustStatementCreateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const actor = getActor(req);
      const row = await generateMonthlyStatement(
        facilityNumber,
        id,
        parsed.data.periodStartAt,
        parsed.data.periodEndAt,
        actor.id,
        actor,
      );
      return res.status(201).json({ success: true, data: row });
    } catch (e) {
      if (handleTrustDomainError(res, e)) return;
      return handleRouteError(req, e, res);
    }
  },
);

// GET /trust/accounts/:id/statements
opsRouter.get(
  "/trust/accounts/:id/statements",
  requireOpsPermission(OPS_RESOURCES.RESIDENT_TRUST, "read"),
  requireTrustEnabled,
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const acct = await getTrustAccount(id, facilityNumber);
      if (!acct) {
        return res.status(404).json({ success: false, error: "Trust account not found" });
      }
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await listStatements(facilityNumber, id, { page, limit });
      return res.json({
        success: true,
        data: result.rows,
        meta: { total: result.total, page, limit },
      });
    } catch (e) {
      return handleRouteError(req, e, res);
    }
  },
);

