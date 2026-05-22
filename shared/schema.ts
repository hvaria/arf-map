import { pgTable, text, integer, serial, bigint, doublePrecision, jsonb } from "drizzle-orm/pg-core";
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
  // Phase 2 R2: was text() carrying a JSON-stringified array of role tags.
  // Now jsonb so the DB validates shape on write and future GIN indexes can
  // target keys. App layer reads/writes JS arrays directly; the route layer
  // re-stringifies on outbound for FE wire-format stability.
  jobTypes: jsonb("job_types").$type<string[]>(),
  bio: text("bio"),
  updatedAt: ts("updated_at").notNull(),
});

// ── Phase 3: facility ↔ user membership (schema seam only) ────────────────────
// Join table connecting `facility_accounts` (the existing single-login-per-
// facility table) with `users` (the legacy table preserved through Phase 2 R1).
// Phase 3 lands the seam so a later phase can introduce multi-staff facilities
// without a schema rewrite — the auth flow is unchanged and no rows are
// backfilled. `role` mirrors the RBAC role set (kept enum-by-CHECK at the DB —
// see migrations/0005_*.sql — so the canonical list can live in code and still
// be enforced by the DB). Soft-delete via `deletedAt`; partial UNIQUE
// `(facilityAccountId, userId) WHERE deleted_at IS NULL` lives in the
// migration so a deleted membership can be re-added.
export const facilityUsers = pgTable("facility_users", {
  id:                  bigint("id", { mode: "number" }).primaryKey(),
  facilityAccountId:   integer("facility_account_id").notNull(),
  userId:              integer("user_id").notNull(),
  role:                text("role").notNull().default("facility_admin"),
  createdAt:           ts("created_at").notNull(),
  // DB has NOT NULL DEFAULT 'system' — see migrations/0005_*.sql. The Drizzle
  // def deliberately omits .notNull() so insert sites that omit the column
  // let the DB default fill it in, and select-side row types stay flexible.
  createdBy:           text("created_by").default("system"),
  updatedAt:           ts("updated_at").notNull(),
  updatedBy:           text("updated_by"),
  deletedAt:           ts("deleted_at"),
});

export type FacilityUserRow = typeof facilityUsers.$inferSelect;
export type NewFacilityUserRow = typeof facilityUsers.$inferInsert;

export const facilityUserRoleSchema = z.enum([
  "facility_admin",
  "admin",
  "auditor",
  "don",
  "med_tech",
  "schedule_lead",
  "office_manager",
]);
export type FacilityUserRole = z.infer<typeof facilityUserRoleSchema>;

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

// ── Stripe webhook idempotency (Phase 2 R2) ──────────────────────────────────
// Append-only registry of every Stripe event id the webhook handler has
// successfully accepted. The handler does:
//
//   INSERT INTO stripe_processed_events (event_id, event_type, processed_at)
//        VALUES ($eventId, $eventType, $now)
//        ON CONFLICT (event_id) DO NOTHING
//        RETURNING event_id;
//
// immediately after signature verification. If RETURNING yields no rows,
// Stripe replayed an event we already processed — short-circuit with 200
// so Stripe stops retrying without re-mutating subscription state.
//
// event_id is the PRIMARY KEY (so the conflict target is a unique B-tree
// lookup). processed_at is BIGINT epoch-ms matching the rest of the schema's
// time convention; the supporting idx_stripe_events_processed_at index lives
// in the migration only — it's an observability/purge aid, not part of the
// hot path the handler exercises.
export const stripeProcessedEvents = pgTable("stripe_processed_events", {
  eventId: text("event_id").primaryKey(),
  eventType: text("event_type").notNull(),
  processedAt: ts("processed_at").notNull(),
});

// Customer-facility public-listing + report-letterhead overrides. One row per
// facility_number. All columns below the original four (phone/description/
// website/email) are nullable additive — backwards compatible with existing
// rows. JSON-as-TEXT columns (hours_of_operation_json, languages_spoken_json,
// etc.) MUST be parsed defensively on read; nothing in the DB layer validates
// shape.
//
// NOTE on facility_logo_*: this is the customer facility's own logo (each ARF
// uploads its own — used on their public listing and on PDF report
// letterheads). It is NOT the app's BrandLogo (client/src/components/BrandLogo.tsx),
// which is the 2DOT2 INC. / arf-map brand identity and must never be sourced
// from this table. Storage path lives on the Fly volume, populated by the
// /api/facility/profile/logo upload endpoint (see server/routes/facilityProfile.ts).
export const facilityOverrides = pgTable("facility_overrides", {
  id: serial("id").primaryKey(),
  facilityNumber: text("facility_number").notNull().unique(),
  phone: text("phone"),
  description: text("description"),
  website: text("website"),
  email: text("email"),

  // ── Identity & branding (customer facility's own logo — NOT the app brand) ─
  dbaName: text("dba_name"),
  logoStorageUri: text("logo_storage_uri"),
  logoMimeType: text("logo_mime_type"),
  logoUpdatedAt: ts("logo_updated_at"),

  // ── Mailing address (when different from CCLD physical address) ──────────
  mailingAddressLine1: text("mailing_address_line1"),
  mailingAddressLine2: text("mailing_address_line2"),
  mailingCity: text("mailing_city"),
  mailingState: text("mailing_state"),
  mailingZip: text("mailing_zip"),

  // ── Operations: hours / languages / care types (JSONB as of Phase 2 R2) ──
  // hoursOfOperationJson  → { mon: {open:'08:00', close:'17:00'}, ... }
  // languagesSpokenJson   → ['en','es','tl']
  // careTypesOfferedJson  → ['skilled_nursing','memory_care', ...]
  // Phase 2 R2 flipped these from text() to jsonb() — the DB now validates
  // shape on write and Drizzle returns parsed JS values directly. The
  // route layer re-stringifies on outbound for FE wire-format stability;
  // the column names retain the `_json` suffix purely for backward
  // compatibility with existing application code referencing them.
  hoursOfOperationJson: jsonb("hours_of_operation_json"),
  languagesSpokenJson: jsonb("languages_spoken_json").$type<string[]>(),
  careTypesOfferedJson: jsonb("care_types_offered_json").$type<string[]>(),

  // ── Administrator (distinct from licensee — different regulatory role) ───
  administratorName: text("administrator_name"),
  administratorPhone: text("administrator_phone"),
  administratorEmail: text("administrator_email"),
  administratorLicenseNumber: text("administrator_license_number"),

  // ── Operations / business detail ─────────────────────────────────────────
  // taxIdLast4: store LAST 4 of the EIN only. Never store the full EIN here.
  taxIdLast4: text("tax_id_last4"),
  yearEstablished: integer("year_established"),
  // Phase 2 R2: text() → jsonb(). Stores a JSON array of accreditation
  // names (e.g. ["CARF","Joint Commission"]).
  accreditationsJson: jsonb("accreditations_json").$type<string[]>(),

  // ── Social ───────────────────────────────────────────────────────────────
  facebookUrl: text("facebook_url"),
  instagramUrl: text("instagram_url"),
  linkedinUrl: text("linkedin_url"),

  // ── Report letterhead overrides ──────────────────────────────────────────
  // When NULL, the PDF renderer falls back to facility name + license + city
  // (see defaultReportHeader in shared/facility-profile.ts).
  reportHeaderText: text("report_header_text"),
  reportFooterText: text("report_footer_text"),

  // ── Prefill audit ────────────────────────────────────────────────────────
  // Records when blanks were auto-filled from CCLD data on signup, and which
  // columns were populated. Phase 2 R2: text() → jsonb() (array of column
  // names like ["administratorName","phone"]).
  prefilledFromCcldAt: ts("prefilled_from_ccld_at"),
  prefilledFields: jsonb("prefilled_fields").$type<string[]>(),

  updatedAt: ts("updated_at").notNull(),
});

export const jobPostingsTable = pgTable("job_postings", {
  id: serial("id").primaryKey(),
  facilityNumber: text("facility_number").notNull(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  salary: text("salary").notNull(),
  description: text("description").notNull(),
  // Phase 2 R2: text() → jsonb(). Holds the requirements array
  // (e.g. ["RCFE License","CPR","TB clearance"]). NOT NULL with
  // DB-level default of '[]'::jsonb so empty arrays don't need
  // explicit handling at the storage layer.
  requirements: jsonb("requirements").$type<string[]>().notNull().default([]),
  postedAt: ts("posted_at").notNull(),
});

// Persistent store for all California CCLD facilities (all types, all counties)
//
// Phase 2 (Round 1) lockdown: address/city/county/zip/phone/licensee/
// administrator/first_license_date/closed_date/last_inspection_date/
// geocode_quality were previously `text NOT NULL DEFAULT ''`. The empty-
// string sentinel is now NULL (true absence of data). App code that reads
// these uses `?? ''` so the runtime impact is nil; the change forces clean
// distinction between "we don't know" (NULL) vs. "this row affirmatively
// has no value" (empty string — no longer used). The 0001 migration
// converts existing '' values to NULL and drops the defaults.
//
// facility_type / facility_group keep `NOT NULL DEFAULT ''` for now because
// they are read on the map's hot path and have a tighter coupling to the
// taxonomy mapping in shared/etl-types.ts — switching them to nullable is a
// follow-up after the search/taxonomy queries are audited.
export const facilitiesTable = pgTable("facilities", {
  number: text("number").primaryKey(),
  name: text("name").notNull(),
  facilityType: text("facility_type").notNull().default(""),
  facilityGroup: text("facility_group").notNull().default(""),
  status: text("status").notNull(),
  address: text("address"),
  city: text("city"),
  county: text("county"),
  zip: text("zip"),
  phone: text("phone"),
  licensee: text("licensee"),
  administrator: text("administrator"),
  capacity: integer("capacity").default(0),
  firstLicenseDate: text("first_license_date"),
  closedDate: text("closed_date"),
  lastInspectionDate: text("last_inspection_date"),
  totalVisits: integer("total_visits").default(0),
  totalTypeB: integer("total_type_b").default(0),
  citations: integer("citations").default(0),
  lat: doublePrecision("lat"),
  lng: doublePrecision("lng"),
  geocodeQuality: text("geocode_quality"),
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

// ── Job seeker work experience (LinkedIn-style employment history) ──────────
// One row per work-history entry per seeker. Month-precision dates stored as
// ISO `YYYY-MM` text (TZ-safe, sorts correctly lexicographically). `endDate`
// null means "Present" (currently employed there). No FK on `accountId` /
// `facilityNumber` per existing convention. No unique constraint — a seeker
// can legitimately have multiple stints at the same company.
export const jobSeekerWorkExperience = pgTable("job_seeker_work_experience", {
  id: serial("id").primaryKey(),
  accountId: integer("account_id").notNull(),
  title: text("title").notNull(),
  company: text("company").notNull(),
  facilityNumber: text("facility_number"),
  location: text("location"),
  employmentType: text("employment_type"),
  startDate: text("start_date").notNull(),
  endDate: text("end_date"),
  description: text("description"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});
export type JobSeekerWorkExperience = typeof jobSeekerWorkExperience.$inferSelect;
export type InsertJobSeekerWorkExperience = typeof jobSeekerWorkExperience.$inferInsert;

export const employmentTypeSchema = z.enum([
  "Full-time",
  "Part-time",
  "Per-diem",
  "On-call",
  "Contract",
  "Volunteer",
]);
export type EmploymentType = z.infer<typeof employmentTypeSchema>;

const yearMonthRegex = /^\d{4}-(0[1-9]|1[0-2])$/;
const yearMonthString = z
  .string()
  .regex(yearMonthRegex, "Date must be in YYYY-MM format");

export const workExperienceInputSchema = z
  .object({
    title: z.string().trim().min(1, "Title is required").max(120),
    company: z.string().trim().min(1, "Company is required").max(120),
    facilityNumber: z.string().trim().max(64).optional(),
    location: z.string().trim().max(120).optional(),
    employmentType: employmentTypeSchema.optional(),
    startDate: yearMonthString,
    endDate: yearMonthString.optional(),
    description: z.string().trim().max(2000).optional(),
  })
  .superRefine((val, ctx) => {
    if (val.endDate && val.endDate < val.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["endDate"],
        message: "End date must be on or after the start date",
      });
    }
  });
export type WorkExperienceInput = z.infer<typeof workExperienceInputSchema>;

// ── Phase 4: Legal acceptance log (clickwrap audit trail) ────────────────────
// Two-tenant log — both facility and job_seeker accounts share the same Terms /
// Privacy / AUP versions, so we keep one table partitioned by `account_kind`
// rather than two near-duplicate tables. Append-only at the application layer
// (no update / delete sites). See `server/lib/legal.ts` for the helpers.
//
// The canonical `LEGAL_DOCS` constant (and the version strings) lives in
// `shared/legal.ts` so the FE clickwrap form and BE acceptance writer share
// one source of truth. Bumping `LEGAL_DOCS[doc].version` is the trigger that
// re-prompts existing users at next request.
export const legalAcceptances = pgTable("legal_acceptances", {
  id: serial("id").primaryKey(),
  accountKind: text("account_kind").notNull(), // 'facility' | 'job_seeker' (CHECK in SQL)
  accountId: integer("account_id").notNull(),
  document: text("document").notNull(), // 'terms' | 'privacy' | 'aup' (CHECK in SQL)
  version: text("version").notNull(),
  acceptedAt: ts("accepted_at").notNull(),
  acceptedIp: text("accepted_ip"),
  acceptedUserAgent: text("accepted_user_agent"),
});
export type LegalAcceptance = typeof legalAcceptances.$inferSelect;
export type InsertLegalAcceptance = typeof legalAcceptances.$inferInsert;

// ── Phase 4: Account data requests (CCPA + email change) ─────────────────────
// Queue / log for data-subject requests. Status is mutable
// (pending → fulfilled | cancelled) so the table carries `updated_at` and the
// Phase-3 `set_updated_at_epoch_ms` trigger. `payloadJson` is JSONB at the
// SQL layer — drizzle exposes it as `text` here for typing simplicity; the
// helpers in `server/routes/account.ts` JSON.parse / stringify on the boundary.
//
// `kind` partitions three flows:
//   'export'       — CCPA right-to-know. Fulfilled manually by operations.
//   'delete'       — CCPA right-to-delete. Fulfilled manually.
//   'email_change' — User-initiated email change with dual-email OTP. The
//                    new email + OTP hash + expiry live in `payloadJson` so
//                    we never touch the live account row until the user
//                    confirms via OTP.
export const accountDataRequests = pgTable("account_data_requests", {
  id: serial("id").primaryKey(),
  accountKind: text("account_kind").notNull(), // 'facility' | 'job_seeker'
  accountId: integer("account_id").notNull(),
  kind: text("kind").notNull(), // 'export' | 'delete' | 'email_change'
  status: text("status").notNull().default("pending"), // 'pending' | 'fulfilled' | 'cancelled'
  requestedAt: ts("requested_at").notNull(),
  requestedIp: text("requested_ip"),
  fulfilledAt: ts("fulfilled_at"),
  fulfilledBy: text("fulfilled_by"),
  notes: text("notes"),
  payloadJson: text("payload_json"),
  createdAt: ts("created_at").notNull(),
  updatedAt: ts("updated_at").notNull(),
});
export type AccountDataRequest = typeof accountDataRequests.$inferSelect;
export type InsertAccountDataRequest = typeof accountDataRequests.$inferInsert;

// ── Operations paywall subscription types (Phase 0) ──────────────────────────
export type FacilitySubscription = typeof facilitySubscriptions.$inferSelect;
export type NewFacilitySubscription = typeof facilitySubscriptions.$inferInsert;

// ── Stripe webhook idempotency types (Phase 2 R2) ────────────────────────────
export type StripeProcessedEvent = typeof stripeProcessedEvents.$inferSelect;
export type NewStripeProcessedEvent = typeof stripeProcessedEvents.$inferInsert;
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
  trackerAlerts,
  // Select types (DB rows)
  type TrackerDefinitionRow,
  type TrackerEntryRow,
  type TrackerEntryVersionRow,
  type TrackerAuditLogRow,
  type TrackerAlertRow,
  // Insert types
  type NewTrackerDefinitionRow,
  type NewTrackerEntryRow,
  type NewTrackerEntryVersionRow,
  type NewTrackerAuditLogRow,
  type NewTrackerAlertRow,
  // Zod enums (audit-only — entry status & shift moved to @shared/tracker-schemas)
  trackerAuditActionSchema,
  trackerAuditEntityTypeSchema,
  // Inferred enum types
  type TrackerAuditAction,
  type TrackerAuditEntityType,
} from "../server/trackers/trackerSchema";
