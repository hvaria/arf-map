import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { z } from "zod";

// ============ DRIZZLE TABLES ============

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const jobSeekerAccounts = sqliteTable("job_seeker_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  username: text("username").notNull().unique(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  emailVerified: integer("email_verified").notNull().default(0),
  verificationToken: text("verification_token"),
  verificationExpiry: integer("verification_expiry"),
  createdAt: integer("created_at").notNull(),
  // Extended fields — added via addColumnIfMissing migration in storage.ts
  lastLoginAt: integer("last_login_at"),
  failedLoginCount: integer("failed_login_count").notNull().default(0),
  updatedAt: integer("updated_at"),
});

export const jobSeekerProfiles = sqliteTable("job_seeker_profiles", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  accountId: integer("account_id").notNull().unique(),
  // Legacy name field (kept for backward compatibility)
  name: text("name"),
  // New split name fields
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  address: text("address"),
  city: text("city"),
  state: text("state"),
  zipCode: text("zip_code"),
  profilePictureUrl: text("profile_picture_url"),
  yearsExperience: integer("years_experience"),
  jobTypes: text("job_types"), // JSON array stored as string
  bio: text("bio"),
  updatedAt: integer("updated_at").notNull(),
});

export const facilityAccounts = sqliteTable("facility_accounts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  facilityNumber: text("facility_number").notNull().unique(),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
  email: text("email"),
  emailVerified: integer("email_verified").notNull().default(0),
  verificationToken: text("verification_token"),
  verificationExpiry: integer("verification_expiry"),
  createdAt: integer("created_at").notNull(),
});

export const facilityOverrides = sqliteTable("facility_overrides", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  facilityNumber: text("facility_number").notNull().unique(),
  phone: text("phone"),
  description: text("description"),
  website: text("website"),
  email: text("email"),
  updatedAt: integer("updated_at").notNull(),
});

export const jobPostingsTable = sqliteTable("job_postings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  facilityNumber: text("facility_number").notNull(),
  title: text("title").notNull(),
  type: text("type").notNull(),
  salary: text("salary").notNull(),
  description: text("description").notNull(),
  requirements: text("requirements").notNull(), // JSON array stored as string
  postedAt: integer("posted_at").notNull(),
});

// Persistent store for all California CCLD facilities (all types, all counties)
export const facilitiesTable = sqliteTable("facilities", {
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
  lat: real("lat"),
  lng: real("lng"),
  geocodeQuality: text("geocode_quality").default(""),
  updatedAt: integer("updated_at").notNull(),
});

// NEW: expression-of-interest — links a job seeker to a facility with status tracking
export const applicantInterests = sqliteTable("applicant_interests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  jobSeekerId: integer("job_seeker_id").notNull(),
  facilityNumber: text("facility_number").notNull(),
  roleInterest: text("role_interest"),
  message: text("message"),
  status: text("status").notNull().default("pending"), // pending | viewed | shortlisted
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
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
