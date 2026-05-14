import { pgTable, text, integer, serial, bigint, doublePrecision } from "drizzle-orm/pg-core";
import { z } from "zod";

// ============ DRIZZLE TABLES (PostgreSQL) ============

const ts = (col: string) => bigint(col, { mode: "number" });

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const jobSeekerAccounts = pgTable("job_seeker_accounts", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  emailVerified: integer("email_verified").notNull().default(0),
  verificationToken: text("verification_token"),
  verificationExpiry: ts("verification_expiry"),
  createdAt: ts("created_at").notNull(),
  lastLoginAt: ts("last_login_at"),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  updatedAt: ts("updated_at"),
});

export const jobSeekerProfiles = pgTable("job_seeker_profiles", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull().unique(),
  name: text("name"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  profilePictureUrl: text("profile_picture_url"),
  yearsExperience: integer("years_experience"),
  jobTypes: text("job_types"),
  bio: text("bio"),
  updatedAt: ts("updated_at").notNull(),
});

export const facilityAccounts = pgTable("facility_accounts", {
  id: serial("id").primaryKey(),
  facilityNumber: text("facility_number").notNull().unique(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  // Aligns with NoteRole in server/ops/notePolicy.ts. Default keeps existing
  // accounts working with full admin permissions; new accounts can be created
  // with a narrower role once a UI for that lands.
  role: text("role").notNull().default("facility_admin"),
  email: text("email"),
  emailVerified: integer("email_verified").notNull().default(0),
  verificationToken: text("verification_token"),
  verificationExpiry: ts("verification_expiry"),
  createdAt: ts("created_at").notNull(),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  // ── Operations paywall cache columns (Phase 0) ──────────────────────────────
  // Hot-path columns the Operations gate middleware reads on every request.
  // Duplicated from facility_subscriptions so the gate can authorize without a
  // join. Kept in sync by the subscription writer (Phase 1 — Stripe webhook).
  // Nullable subscriptionStatus = "no record yet / free tier".
  subscriptionStatus: text("subscription_status"),
  subscriptionCurrentPeriodEnd: ts("subscription_current_period_end"),
});

// ── Operations paywall: per-account Stripe subscription record (Phase 0) ─────
// One row per facility_accounts.id (UNIQUE). All Stripe-specific columns are
// nullable until Phase 1 wires the Stripe SDK and webhook. `status` is the raw
// Stripe subscription status string; null = free tier / never subscribed.
export const facilitySubscriptions = pgTable("facility_subscriptions", {
  id: serial("id").primaryKey(),
  facilityAccountId: integer("facility_account_id").notNull().unique(),
  // UNIQUE — one Stripe customer maps to at most one facility account, so a
  // webhook resolving customer→account via findAccountByStripeCustomerId
  // can never confuse two accounts. Postgres allows multiple NULLs here,
  // which is fine: brand-new subscription rows have no Stripe customer yet.
  stripeCustomerId: text("stripe_customer_id").unique(),
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripePriceId: text("stripe_price_id"),
  status: text("status"),
  currentPeriodStart: ts("current_period_start"),
  currentPeriodEnd: ts("current_period_end"),
  // Boolean-as-int matches existing convention (see emailVerified above).
  cancelAtPeriodEnd: integer("cancel_at_period_end").notNull().default(0),
  trialEnd: ts("trial_end"),
  latestInvoiceUrl: text("latest_invoice_url"),
  lastFour: text("last_four"),
  cardBrand: text("card_brand"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

export const facilityOverrides = pgTable("facility_overrides", {
  id: serial("id").primaryKey(),
  facilityNumber: text("facility_number").notNull().unique(),
  phone: text("phone"),
  description: text("description"),
  website: text("website"),
  email: text("email"),
  updatedAt: ts("updated_at").notNull(),
});

export const jobPostingsTable = pgTable("job_postings", {
  id: serial("id").primaryKey(),
  facilityNumber: text("facility_number").notNull(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  salary: text("salary").notNull(),
  description: text("description").notNull(),
  requirements: text("requirements").notNull(),
  postedAt: ts("posted_at").notNull(),
});

// Persistent store for all California CCLD facilities (all types, all counties)
export const facilitiesTable = pgTable("facilities", {
  number: text("number").primaryKey(),
  name: text("name").notNull(),
  facilityType: text("facility_type").notNull().default(""),
  facilityGroup: text("facility_group").notNull().default(""),
  status: text("status").notNull(),
  address: text("address").notNull().default(""),
  city: text("city").notNull().default(""),
  county: text("county").notNull().default(""),
  zip: text("zip").notNull().default(""),
  phone: text("phone").notNull().default(""),
  licensee: text("licensee").notNull().default(""),
  administrator: text("administrator").notNull().default(""),
  capacity: integer("capacity").default(0),
  firstLicenseDate: text("first_license_date").default(""),
  closedDate: text("closed_date").default(""),
  lastInspectionDate: text("last_inspection_date").default(""),
  totalVisits: integer("total_visits").default(0),
  totalTypeB: integer("total_type_b").default(0),
  citations: integer("citations").default(0),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  geocodeQuality: text("geocode_quality").default(""),
  updatedAt: ts("updated_at").notNull(),
  enrichedAt: ts("enriched_at"),
});

export const applicantInterests = pgTable("applicant_interests", {
  id: serial("id").primaryKey(),
  jobSeekerId: integer("job_seeker_id").notNull(),
  facilityNumber: text("facility_number").notNull(),
  // When jobId is set, the interest is scoped to one specific job posting
  // (so a facility with multiple openings has independent interest rows per
  // posting). When null, the interest is facility-level (the legacy shape).
  // Uniqueness is enforced by two partial indexes — see bootstrap.ts.
  jobId: integer("job_id"),
  roleInterest: text("role_interest"),
  message: text("message"),
  status: text("status").notNull().default("pending"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

// One row per credential (license/certification/clearance) held by a job
// seeker. 1:many on job_seeker_accounts.id (no FK constraint — follows the
// existing repo convention; cf. job_seeker_profiles.account_id).
//
// `kind` is constrained at the application layer via `credentialKindSchema`
// (zod enum) rather than a Postgres CHECK constraint so the enum can evolve
// without a migration. `label` is only required when kind = "OTHER" and that
// is enforced in zod (superRefine), not SQL. `issued_at` / `expires_at` are
// ISO date strings (YYYY-MM-DD) stored as TEXT to sidestep timezone drift on
// expiry-tone calculations (a date with no time-of-day is not a moment in UTC).
export const jobSeekerCredentials = pgTable("job_seeker_credentials", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  kind: text("kind").notNull(),
  label: text("label"),
  licenseNumber: text("license_number"),
  issuingAuthority: text("issuing_authority"),
  issuedAt: text("issued_at"),
  expiresAt: text("expires_at"),
  notes: text("notes"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});

// ============ DRIZZLE TYPES ============

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type FacilityAccount = typeof facilityAccounts.$inferSelect;
export type InsertFacilityAccount = typeof facilityAccounts.$inferInsert;
export type FacilityOverride = typeof facilityOverrides.$inferSelect;
export type DbJobPosting = typeof jobPostingsTable.$inferSelect;
export type InsertDbJobPosting = typeof jobPostingsTable.$inferInsert;
export type JobSeekerAccount = typeof jobSeekerAccounts.$inferSelect;
export type InsertJobSeekerAccount = typeof jobSeekerAccounts.$inferInsert;
export type JobSeekerProfile = typeof jobSeekerProfiles.$inferSelect;

// NEW: expression-of-interest types
export type ApplicantInterest = typeof applicantInterests.$inferSelect;
export type InsertApplicantInterest = typeof applicantInterests.$inferInsert;
export const interestStatusSchema = z.enum(["pending", "viewed", "shortlisted"]);
export type InterestStatus = z.infer<typeof interestStatusSchema>;

// ── Job seeker credentials ───────────────────────────────────────────────────
// Drizzle types + zod input schema for the job_seeker_credentials table.
// Server-managed columns (id, accountId, createdAt, updatedAt) are NOT part of
// the input schema — the caller supplies only editable fields.
export type JobSeekerCredential = typeof jobSeekerCredentials.$inferSelect;
export type InsertJobSeekerCredential = typeof jobSeekerCredentials.$inferInsert;

export const credentialKindSchema = z.enum([
  "CNA",
  "LVN",
  "RN",
  "RCFE_ADMIN",
  "ARF_ADMIN",
  "DSP_YEAR_1",
  "DSP_YEAR_2",
  "MED_TECH",
  "MANDATED_REPORTER",
  "RCFE_40_HOUR",
  "LIVE_SCAN",
  "TB",
  "CPR",
  "FIRST_AID",
  "OTHER",
]);
export type CredentialKind = z.infer<typeof credentialKindSchema>;

// ISO date in YYYY-MM-DD form. We deliberately keep this as a string (rather
// than z.coerce.date()) so the value round-trips losslessly to the TEXT column
// and the client can render expiry tones from the raw string without
// reintroducing timezone drift.
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "must be ISO date YYYY-MM-DD");

export const credentialInputSchema = z
  .object({
    kind: credentialKindSchema,
    label: z.string().trim().min(1).max(120).optional(),
    licenseNumber: z.string().trim().max(64).optional(),
    issuingAuthority: z.string().trim().max(120).optional(),
    issuedAt: isoDateSchema.optional(),
    expiresAt: isoDateSchema.optional(),
    notes: z.string().max(500).optional(),
  })
  .superRefine((val, ctx) => {
    // `label` is free-form and required only when kind = "OTHER" — otherwise
    // the canonical kind string is the display name.
    if (val.kind === "OTHER" && (!val.label || val.label.trim() === "")) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["label"],
        message: 'label is required when kind = "OTHER"',
      });
    }
  });
export type CredentialInput = z.infer<typeof credentialInputSchema>;

// ── Operations paywall subscription types (Phase 0) ──────────────────────────
export type FacilitySubscription = typeof facilitySubscriptions.$inferSelect;
export type NewFacilitySubscription = typeof facilitySubscriptions.$inferInsert;
// Stripe subscription status values. `null` (column nullable) means "no
// subscription record yet" — the gate treats that the same as a missing row.
export const subscriptionStatusSchema = z.enum([
  "trialing",
  "active",
  "past_due",
  "canceled",
  "unpaid",
  "incomplete",
  "incomplete_expired",
  "paused",
]);
export type SubscriptionStatus = z.infer<typeof subscriptionStatusSchema>;

// ============ ZOD SCHEMAS ============

export const jobPostingSchema = z.object({
  title: z.string(),
  type: z.string(),
  salary: z.string(),
  description: z.string(),
  requirements: z.array(z.string()),
  postedDaysAgo: z.number(),
});

export type JobPosting = z.infer<typeof jobPostingSchema>;

export const facilitySchema = z.object({
  number: z.string(),
  name: z.string(),
  // New fields — optional with defaults for backward compat
  facilityType: z.string().default("Adult Residential Facility"),
  facilityGroup: z.string().default("Adult & Senior Care"),
  county: z.string().default(""),
  // Core location/contact
  address: z.string(),
  city: z.string(),
  zip: z.string(),
  phone: z.string(),
  licensee: z.string(),
  administrator: z.string(),
  status: z.string(),
  capacity: z.number(),
  firstLicenseDate: z.string(),
  closedDate: z.string(),
  lastInspectionDate: z.string(),
  // Inspection stats — detailed breakdown optional (may not be available for all types)
  totalVisits: z.number(),
  inspectionVisits: z.number().default(0),
  complaintVisits: z.number().default(0),
  inspectTypeB: z.number().default(0),
  otherTypeB: z.number().default(0),
  complaintTypeB: z.number().default(0),
  totalTypeB: z.number(),
  citations: z.string(),
  lat: z.number(),
  lng: z.number(),
  geocodeQuality: z.string(),
  isHiring: z.boolean(),
  jobPostings: z.array(jobPostingSchema),
});

export type Facility = z.infer<typeof facilitySchema>;

// Slim shape returned by /api/facilities/pins. Contains only what the map,
// clustered markers, tooltip, and the right-sidebar JobsPanel actually read.
// Full detail (licensee, address, citations, visit history, etc.) is loaded
// on demand from /api/facilities/:number/public when a pin is opened.
export const facilityPinSchema = z.object({
  number: z.string(),
  name: z.string(),
  lat: z.number(),
  lng: z.number(),
  city: z.string().default(""),
  county: z.string().default(""),
  capacity: z.number().default(0),
  status: z.string(),
  facilityType: z.string().default("Adult Residential Facility"),
  facilityGroup: z.string().default("Adult & Senior Care"),
  isHiring: z.boolean(),
  jobCount: z.number().default(0),
});

export type FacilityPin = z.infer<typeof facilityPinSchema>;

// Metadata shape returned by /api/facilities/meta
export const facilitiesMetaSchema = z.object({
  totalCount: z.number(),
  facilityTypes: z.array(z.string()),
  facilityGroups: z.array(z.string()),
  counties: z.array(z.string()),
  statuses: z.array(z.string()),
  countByType: z.record(z.number()),
  countByGroup: z.record(z.number()),
  countByCounty: z.record(z.number()),
  countByStatus: z.record(z.number()),
  lastUpdated: z.number().nullable(),
});
export type FacilitiesMeta = z.infer<typeof facilitiesMetaSchema>;

// ============ OPS MODULE TABLES (re-exported from server/ops/opsSchema) ============
// Drizzle table definitions and inferred types for all ops_ tables.
// The SQL bootstrap lives in server/ops/opsSchema.ts (OPS_SCHEMA_SQL) and is
// executed from server/storage.ts on startup.

export {
  // Table objects
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
  opsFacilitySettings,
  opsComplianceCalendar,
  // Select types
  type OpsResident,
  type OpsResidentAssessment,
  type OpsCarePlan,
  type OpsDailyTask,
  type OpsMedication,
  type OpsMedPass,
  type OpsControlledSubCount,
  type OpsMedDestruction,
  type OpsIncident,
  type OpsLead,
  type OpsTour,
  type OpsAdmission,
  type OpsBillingCharge,
  type OpsInvoice,
  type OpsPayment,
  type OpsStaffMember,
  type OpsShift,
  type OpsFacilitySetting,
  type OpsComplianceItem,
  // Insert types
  type InsertOpsResident,
  type InsertOpsResidentAssessment,
  type InsertOpsCarePlan,
  type InsertOpsDailyTask,
  type InsertOpsMedication,
  type InsertOpsMedPass,
  type InsertOpsControlledSubCount,
  type InsertOpsMedDestruction,
  type InsertOpsIncident,
  type InsertOpsLead,
  type InsertOpsTour,
  type InsertOpsAdmission,
  type InsertOpsBillingCharge,
  type InsertOpsInvoice,
  type InsertOpsPayment,
  type InsertOpsStaffMember,
  type InsertOpsShift,
  type InsertOpsFacilitySetting,
  type InsertOpsComplianceItem,
} from "../server/ops/opsSchema";

// ============ NOTES MODULE TABLES (re-exported from server/ops/notesSchema) ============
// Drizzle table definitions, inferred types, and Zod input schemas for the
// Operations > Notes module. SQL bootstrap lives in server/ops/notesSchema.ts
// (NOTES_PG_SCHEMA_SQL) and is executed from server/ops/notesStorage.ts at
// startup.

export {
  // Table objects
  opsNotes,
  opsNoteVersions,
  opsNoteAttachments,
  opsNoteMentions,
  opsNoteAcknowledgments,
  opsNoteTags,
  opsNoteAuditLog,
  // Select types
  type OpsNote,
  type OpsNoteVersion,
  type OpsNoteAttachment,
  type OpsNoteMention,
  type OpsNoteAcknowledgment,
  type OpsNoteTag,
  type OpsNoteAuditEntry,
  // Insert types
  type InsertOpsNote,
  type InsertOpsNoteVersion,
  type InsertOpsNoteAttachment,
  type InsertOpsNoteMention,
  type InsertOpsNoteAcknowledgment,
  type InsertOpsNoteTag,
  type InsertOpsNoteAuditEntry,
  // Zod enums
  noteCategorySchema,
  noteVisibilitySchema,
  notePrioritySchema,
  noteStatusSchema,
  ackRequiredRoleSchema,
  attachmentScanStatusSchema,
  noteTagSchema,
  noteAuditActionSchema,
  // Zod input schemas
  createNoteInputSchema,
  updateNoteInputSchema,
  replyNoteInputSchema,
  acknowledgeNoteInputSchema,
  listNotesQuerySchema,
  // Inferred input types
  type NoteCategory,
  type NoteVisibility,
  type NotePriority,
  type NoteStatus,
  type AckRequiredRole,
  type AttachmentScanStatus,
  type NoteAuditAction,
  type CreateNoteInput,
  type UpdateNoteInput,
  type ReplyNoteInput,
  type AcknowledgeNoteInput,
  type ListNotesQuery,
} from "../server/ops/notesSchema";

// ============ TRACKERS MODULE TABLES (re-exported from server/trackers/trackerSchema) ============
// Drizzle table definitions, inferred row types, and Zod enums for the
// Operations > Trackers foundation slice. SQL bootstrap lives in
// server/trackers/trackerSchema.ts (TRACKERS_PG_SCHEMA_SQL) and is executed
// from server/trackers/trackerStorage.ts at startup.
//
// NB: row types are suffixed `Row` to avoid colliding with the
// `TrackerDefinition` *config object* type that lives in
// shared/tracker-schemas/tracker-types.ts (Phase B).

// NB: `trackerEntryStatusSchema` and the shift enum (`shiftSchema` / `Shift`)
// are NOT re-exported here. They live in shared/tracker-schemas/tracker-types.ts
// as the single source of truth — import them from "@shared/tracker-schemas".
// See fix M7 in the Tracker Module review.
export {
  // Table objects
  trackerDefinitions,
  trackerEntries,
  trackerEntryVersions,
  trackerAuditLog,
  // Select types (DB rows)
  type TrackerDefinitionRow,
  type TrackerEntryRow,
  type TrackerEntryVersionRow,
  type TrackerAuditLogRow,
  // Insert types
  type NewTrackerDefinitionRow,
  type NewTrackerEntryRow,
  type NewTrackerEntryVersionRow,
  type NewTrackerAuditLogRow,
  // Zod enums (audit-only — entry status & shift moved to @shared/tracker-schemas)
  trackerAuditActionSchema,
  trackerAuditEntityTypeSchema,
  // Inferred enum types
  type TrackerAuditAction,
  type TrackerAuditEntityType,
} from "../server/trackers/trackerSchema";
