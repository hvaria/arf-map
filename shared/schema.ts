import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
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

// Facility schema - all data is static/embedded, no database needed
export const facilitySchema = z.object({
  name: z.string(),
  number: z.string(),
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
  totalVisits: z.number(),
  inspectionVisits: z.number(),
  complaintVisits: z.number(),
  inspectTypeB: z.number(),
  otherTypeB: z.number(),
  complaintTypeB: z.number(),
  totalTypeB: z.number(),
  citations: z.string(),
  lat: z.number(),
  lng: z.number(),
  geocodeQuality: z.string(),
  isHiring: z.boolean(),
  jobPostings: z.array(jobPostingSchema),
});

export type Facility = z.infer<typeof facilitySchema>;
