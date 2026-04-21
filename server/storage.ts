import {
  type User,
  type InsertUser,
  users,
  facilityAccounts,
  facilityOverrides,
  jobPostingsTable,
  jobSeekerAccounts,
  jobSeekerProfiles,
  applicantInterests,
  type FacilityAccount,
  type InsertFacilityAccount,
  type FacilityOverride,
  type DbJobPosting,
  type JobSeekerAccount,
  type InsertJobSeekerAccount,
  type JobSeekerProfile,
  type ApplicantInterest,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sqlite, db } from "./db/index";

// FacilityDbRow lives in shared so ETL scripts can import it without pulling
// in any server-side code. Re-exported here for backward compatibility.
export type { FacilityDbRow } from "@shared/etl-types";

// ── Schema bootstrap ─────────────────────────────────────────────────────────
// These CREATE TABLE IF NOT EXISTS statements are idempotent; they run on every
// startup and are a lightweight alternative to running drizzle-kit migrations.
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS facility_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_number TEXT NOT NULL UNIQUE,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS facility_overrides (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_number TEXT NOT NULL UNIQUE,
    phone TEXT,
    description TEXT,
    website TEXT,
    email TEXT,
    updated_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS job_postings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    facility_number TEXT NOT NULL,
    title TEXT NOT NULL,
    type TEXT NOT NULL,
    salary TEXT NOT NULL,
    description TEXT NOT NULL,
    requirements TEXT NOT NULL,
    posted_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS job_seeker_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    email TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL,
    email_verified INTEGER NOT NULL DEFAULT 0,
    verification_token TEXT,
    verification_expiry INTEGER,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS job_seeker_profiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id INTEGER NOT NULL UNIQUE,
    name TEXT,
    phone TEXT,
    city TEXT,
    years_experience INTEGER,
    job_types TEXT,
    bio TEXT,
    updated_at INTEGER NOT NULL
  );
`);

// Migrations: safely add new columns to existing tables
function addColumnIfMissing(table: string, column: string, definition: string) {
  const cols = (sqlite.pragma(`table_info(${table})`) as any[]).map((c) => c.name);
  if (!cols.includes(column)) {
    sqlite.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

addColumnIfMissing("job_seeker_accounts", "email_verified", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("job_seeker_accounts", "verification_token", "TEXT");
addColumnIfMissing("job_seeker_accounts", "verification_expiry", "INTEGER");
addColumnIfMissing("job_seeker_accounts", "last_login_at", "INTEGER");
addColumnIfMissing("job_seeker_accounts", "failed_login_count", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("job_seeker_accounts", "updated_at", "INTEGER");

// NEW: expression-of-interest — one row per seeker+facility pair, upsertable
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS applicant_interests (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    job_seeker_id   INTEGER NOT NULL,
    facility_number TEXT NOT NULL,
    role_interest   TEXT,
    message         TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      INTEGER NOT NULL,
    updated_at      INTEGER NOT NULL,
    UNIQUE(job_seeker_id, facility_number)
  );
  CREATE INDEX IF NOT EXISTS idx_ai_facility ON applicant_interests(facility_number);
  CREATE INDEX IF NOT EXISTS idx_ai_seeker   ON applicant_interests(job_seeker_id);
  CREATE INDEX IF NOT EXISTS idx_ai_status   ON applicant_interests(status);
`);

// Sessions table used by SqliteSessionStore
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_expired_at ON sessions (expired_at);
`);

// Login attempt audit log
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS login_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL,
    ip TEXT,
    success INTEGER NOT NULL DEFAULT 0,
    failure_reason TEXT,
    attempted_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts (email);
`);

// Persistent store for ALL California CCLD facilities (all types, all counties)
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS facilities (
    number TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    facility_type TEXT NOT NULL DEFAULT '',
    facility_group TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL,
    address TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    county TEXT NOT NULL DEFAULT '',
    zip TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    licensee TEXT NOT NULL DEFAULT '',
    administrator TEXT NOT NULL DEFAULT '',
    capacity INTEGER DEFAULT 0,
    first_license_date TEXT DEFAULT '',
    closed_date TEXT DEFAULT '',
    last_inspection_date TEXT DEFAULT '',
    total_visits INTEGER DEFAULT 0,
    total_type_b INTEGER DEFAULT 0,
    citations INTEGER DEFAULT 0,
    lat REAL,
    lng REAL,
    geocode_quality TEXT DEFAULT '',
    updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_facilities_county ON facilities(county);
  CREATE INDEX IF NOT EXISTS idx_facilities_type ON facilities(facility_type);
  CREATE INDEX IF NOT EXISTS idx_facilities_group ON facilities(facility_group);
  CREATE INDEX IF NOT EXISTS idx_facilities_status ON facilities(status);
  CREATE INDEX IF NOT EXISTS idx_facilities_latln ON facilities(lat, lng);
`);

addColumnIfMissing("job_seeker_profiles", "first_name", "TEXT");
addColumnIfMissing("job_seeker_profiles", "last_name", "TEXT");
addColumnIfMissing("job_seeker_profiles", "address", "TEXT");
addColumnIfMissing("job_seeker_profiles", "state", "TEXT");
addColumnIfMissing("job_seeker_profiles", "zip_code", "TEXT");
addColumnIfMissing("job_seeker_profiles", "profile_picture_url", "TEXT");

// enriched_at: Unix timestamp (ms) of when CCLD enrichment last wrote data for this facility
addColumnIfMissing("facilities", "enriched_at", "INTEGER");

// Email verification for facility portal accounts
addColumnIfMissing("facility_accounts", "email", "TEXT");
addColumnIfMissing("facility_accounts", "email_verified", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("facility_accounts", "verification_token", "TEXT");
addColumnIfMissing("facility_accounts", "verification_expiry", "INTEGER");

// Enrichment run audit log — one row per background enrichment pass
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS enrichment_runs (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at       INTEGER NOT NULL,
    finished_at      INTEGER,
    trigger          TEXT NOT NULL DEFAULT 'scheduled',
    total_processed  INTEGER NOT NULL DEFAULT 0,
    total_enriched   INTEGER NOT NULL DEFAULT 0,
    total_no_data    INTEGER NOT NULL DEFAULT 0,
    total_failed     INTEGER NOT NULL DEFAULT 0
  );
`);

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  getFacilityAccount(id: number): Promise<FacilityAccount | undefined>;
  getFacilityAccountByUsername(username: string): Promise<FacilityAccount | undefined>;
  getFacilityAccountByNumber(facilityNumber: string): Promise<FacilityAccount | undefined>;
  getFacilityAccountByEmail(email: string): Promise<FacilityAccount | undefined>;
  createFacilityAccount(account: InsertFacilityAccount): Promise<FacilityAccount>;
  updateFacilityAccount(id: number, updates: Partial<Pick<FacilityAccount, "emailVerified" | "verificationToken" | "verificationExpiry" | "password">>): Promise<void>;

  getFacilityOverride(facilityNumber: string): Promise<FacilityOverride | undefined>;
  upsertFacilityOverride(
    facilityNumber: string,
    data: Partial<Pick<FacilityOverride, "phone" | "description" | "website" | "email">>
  ): Promise<FacilityOverride>;

  getAllJobPostings(): Promise<DbJobPosting[]>;
  getJobPostings(facilityNumber: string): Promise<DbJobPosting[]>;
  createJobPosting(
    facilityNumber: string,
    data: Pick<DbJobPosting, "title" | "type" | "salary" | "description" | "requirements">
  ): Promise<DbJobPosting>;
  updateJobPosting(
    id: number,
    facilityNumber: string,
    data: Partial<Pick<DbJobPosting, "title" | "type" | "salary" | "description" | "requirements">>
  ): Promise<DbJobPosting | undefined>;
  deleteJobPosting(id: number, facilityNumber: string): Promise<boolean>;

  getJobSeekerAccount(id: number): Promise<JobSeekerAccount | undefined>;
  getJobSeekerAccountByEmail(email: string): Promise<JobSeekerAccount | undefined>;
  getJobSeekerAccountByVerificationToken(token: string): Promise<JobSeekerAccount | undefined>;
  createJobSeekerAccount(data: InsertJobSeekerAccount): Promise<JobSeekerAccount>;
  updateJobSeekerAccount(
    id: number,
    data: Partial<Pick<JobSeekerAccount, "emailVerified" | "verificationToken" | "verificationExpiry" | "lastLoginAt" | "failedLoginCount" | "updatedAt" | "password">>
  ): Promise<void>;

  getJobSeekerProfile(accountId: number): Promise<JobSeekerProfile | undefined>;
  upsertJobSeekerProfile(
    accountId: number,
    data: Partial<Pick<JobSeekerProfile,
      "name" | "firstName" | "lastName" | "phone" | "address" | "city" |
      "state" | "zipCode" | "profilePictureUrl" | "yearsExperience" | "jobTypes" | "bio"
    >>
  ): Promise<JobSeekerProfile>;

  // NEW: expression-of-interest
  upsertApplicantInterest(
    jobSeekerId: number,
    facilityNumber: string,
    data: { roleInterest?: string; message?: string }
  ): Promise<ApplicantInterest>;
  deleteApplicantInterest(id: number, jobSeekerId: number): Promise<boolean>;
  updateApplicantInterestStatus(id: number, facilityNumber: string, status: string): Promise<ApplicantInterest | undefined>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.id, id)).get();
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return db.select().from(users).where(eq(users.username, username)).get();
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    return db.insert(users).values(insertUser).returning().get();
  }

  async getFacilityAccount(id: number): Promise<FacilityAccount | undefined> {
    return db.select().from(facilityAccounts).where(eq(facilityAccounts.id, id)).get();
  }

  async getFacilityAccountByUsername(username: string): Promise<FacilityAccount | undefined> {
    return db.select().from(facilityAccounts).where(eq(facilityAccounts.username, username)).get();
  }

  async getFacilityAccountByNumber(facilityNumber: string): Promise<FacilityAccount | undefined> {
    return db
      .select()
      .from(facilityAccounts)
      .where(eq(facilityAccounts.facilityNumber, facilityNumber))
      .get();
  }

  async createFacilityAccount(account: InsertFacilityAccount): Promise<FacilityAccount> {
    return db.insert(facilityAccounts).values(account).returning().get();
  }

  async getFacilityAccountByEmail(email: string): Promise<FacilityAccount | undefined> {
    return db.select().from(facilityAccounts).where(eq(facilityAccounts.email, email)).get();
  }

  async updateFacilityAccount(
    id: number,
    updates: Partial<Pick<FacilityAccount, "emailVerified" | "verificationToken" | "verificationExpiry" | "password">>
  ): Promise<void> {
    await db.update(facilityAccounts).set(updates).where(eq(facilityAccounts.id, id)).run();
  }

  async getFacilityOverride(facilityNumber: string): Promise<FacilityOverride | undefined> {
    return db
      .select()
      .from(facilityOverrides)
      .where(eq(facilityOverrides.facilityNumber, facilityNumber))
      .get();
  }

  async upsertFacilityOverride(
    facilityNumber: string,
    data: Partial<Pick<FacilityOverride, "phone" | "description" | "website" | "email">>
  ): Promise<FacilityOverride> {
    const existing = await this.getFacilityOverride(facilityNumber);
    const now = Date.now();
    if (existing) {
      return db
        .update(facilityOverrides)
        .set({ ...data, updatedAt: now })
        .where(eq(facilityOverrides.facilityNumber, facilityNumber))
        .returning()
        .get();
    }
    return db
      .insert(facilityOverrides)
      .values({ facilityNumber, ...data, updatedAt: now })
      .returning()
      .get();
  }

  async getAllJobPostings(): Promise<DbJobPosting[]> {
    return db.select().from(jobPostingsTable).all();
  }

  async getJobPostings(facilityNumber: string): Promise<DbJobPosting[]> {
    return db
      .select()
      .from(jobPostingsTable)
      .where(eq(jobPostingsTable.facilityNumber, facilityNumber))
      .all();
  }

  async createJobPosting(
    facilityNumber: string,
    data: Pick<DbJobPosting, "title" | "type" | "salary" | "description" | "requirements">
  ): Promise<DbJobPosting> {
    return db
      .insert(jobPostingsTable)
      .values({ ...data, facilityNumber, postedAt: Date.now() })
      .returning()
      .get();
  }

  async updateJobPosting(
    id: number,
    facilityNumber: string,
    data: Partial<Pick<DbJobPosting, "title" | "type" | "salary" | "description" | "requirements">>
  ): Promise<DbJobPosting | undefined> {
    const existing = db
      .select()
      .from(jobPostingsTable)
      .where(and(eq(jobPostingsTable.id, id), eq(jobPostingsTable.facilityNumber, facilityNumber)))
      .get();
    if (!existing) return undefined;

    return db
      .update(jobPostingsTable)
      .set(data)
      .where(eq(jobPostingsTable.id, id))
      .returning()
      .get();
  }

  async deleteJobPosting(id: number, facilityNumber: string): Promise<boolean> {
    const existing = db
      .select()
      .from(jobPostingsTable)
      .where(and(eq(jobPostingsTable.id, id), eq(jobPostingsTable.facilityNumber, facilityNumber)))
      .get();
    if (!existing) return false;

    db.delete(jobPostingsTable).where(eq(jobPostingsTable.id, id)).run();
    return true;
  }

  async getJobSeekerAccount(id: number): Promise<JobSeekerAccount | undefined> {
    return db.select().from(jobSeekerAccounts).where(eq(jobSeekerAccounts.id, id)).get();
  }

  async getJobSeekerAccountByEmail(email: string): Promise<JobSeekerAccount | undefined> {
    return db.select().from(jobSeekerAccounts).where(eq(jobSeekerAccounts.email, email)).get();
  }

  async getJobSeekerAccountByVerificationToken(token: string): Promise<JobSeekerAccount | undefined> {
    return db
      .select()
      .from(jobSeekerAccounts)
      .where(eq(jobSeekerAccounts.verificationToken, token))
      .get();
  }

  async createJobSeekerAccount(data: InsertJobSeekerAccount): Promise<JobSeekerAccount> {
    return db.insert(jobSeekerAccounts).values(data).returning().get();
  }

  async updateJobSeekerAccount(
    id: number,
    data: Partial<Pick<JobSeekerAccount, "emailVerified" | "verificationToken" | "verificationExpiry" | "lastLoginAt" | "failedLoginCount" | "updatedAt" | "password">>
  ): Promise<void> {
    await db
      .update(jobSeekerAccounts)
      .set(data)
      .where(eq(jobSeekerAccounts.id, id))
      .run();
  }

  async getJobSeekerProfile(accountId: number): Promise<JobSeekerProfile | undefined> {
    return db
      .select()
      .from(jobSeekerProfiles)
      .where(eq(jobSeekerProfiles.accountId, accountId))
      .get();
  }

  async upsertJobSeekerProfile(
    accountId: number,
    data: Partial<Pick<JobSeekerProfile,
      "name" | "firstName" | "lastName" | "phone" | "address" | "city" |
      "state" | "zipCode" | "profilePictureUrl" | "yearsExperience" | "jobTypes" | "bio"
    >>
  ): Promise<JobSeekerProfile> {
    const existing = await this.getJobSeekerProfile(accountId);
    const now = Date.now();
    if (existing) {
      return db
        .update(jobSeekerProfiles)
        .set({ ...data, updatedAt: now })
        .where(eq(jobSeekerProfiles.accountId, accountId))
        .returning()
        .get();
    }
    return db
      .insert(jobSeekerProfiles)
      .values({ accountId, ...data, updatedAt: now })
      .returning()
      .get();
  }

  // NEW: expression-of-interest implementations
  async upsertApplicantInterest(
    jobSeekerId: number,
    facilityNumber: string,
    data: { roleInterest?: string; message?: string }
  ): Promise<ApplicantInterest> {
    const now = Date.now();
    const existing = db
      .select()
      .from(applicantInterests)
      .where(
        and(
          eq(applicantInterests.jobSeekerId, jobSeekerId),
          eq(applicantInterests.facilityNumber, facilityNumber)
        )
      )
      .get();

    if (existing) {
      return db
        .update(applicantInterests)
        .set({ ...data, updatedAt: now })
        .where(eq(applicantInterests.id, existing.id))
        .returning()
        .get();
    }
    return db
      .insert(applicantInterests)
      .values({ jobSeekerId, facilityNumber, ...data, createdAt: now, updatedAt: now })
      .returning()
      .get();
  }

  async deleteApplicantInterest(id: number, jobSeekerId: number): Promise<boolean> {
    const existing = db
      .select()
      .from(applicantInterests)
      .where(and(eq(applicantInterests.id, id), eq(applicantInterests.jobSeekerId, jobSeekerId)))
      .get();
    if (!existing) return false;
    db.delete(applicantInterests).where(eq(applicantInterests.id, id)).run();
    return true;
  }

  async updateApplicantInterestStatus(
    id: number,
    facilityNumber: string,
    status: string
  ): Promise<ApplicantInterest | undefined> {
    const existing = db
      .select()
      .from(applicantInterests)
      .where(and(eq(applicantInterests.id, id), eq(applicantInterests.facilityNumber, facilityNumber)))
      .get();
    if (!existing) return undefined;
    return db
      .update(applicantInterests)
      .set({ status, updatedAt: Date.now() })
      .where(eq(applicantInterests.id, id))
      .returning()
      .get();
  }
}

export const storage = new DatabaseStorage();

// ── Applicant Interest JOIN queries (raw SQL for multi-table joins) ───────────

export interface ApplicantInterestWithProfile {
  id: number;
  jobSeekerId: number;
  facilityNumber: string;
  roleInterest: string | null;
  message: string | null;
  status: string;
  createdAt: number;
  updatedAt: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  city: string | null;
  state: string | null;
  yearsExperience: number | null;
  jobTypes: string | null;
  bio: string | null;
}

export interface ApplicantInterestWithFacility {
  id: number;
  facilityNumber: string;
  facilityName: string | null;
  roleInterest: string | null;
  message: string | null;
  status: string;
  createdAt: number;
}

/** All interests for a facility, joined with seeker account + profile. */
export function getInterestsByFacility(facilityNumber: string): ApplicantInterestWithProfile[] {
  return sqlite
    .prepare(`
      SELECT
        ai.id, ai.job_seeker_id as jobSeekerId, ai.facility_number as facilityNumber,
        ai.role_interest as roleInterest, ai.message, ai.status,
        ai.created_at as createdAt, ai.updated_at as updatedAt,
        a.email,
        p.first_name as firstName, p.last_name as lastName,
        p.city, p.state, p.years_experience as yearsExperience,
        p.job_types as jobTypes, p.bio
      FROM applicant_interests ai
      JOIN job_seeker_accounts a ON a.id = ai.job_seeker_id
      LEFT JOIN job_seeker_profiles p ON p.account_id = ai.job_seeker_id
      WHERE ai.facility_number = ?
      ORDER BY ai.created_at DESC
    `)
    .all(facilityNumber) as ApplicantInterestWithProfile[];
}

/** All interests submitted by a seeker, with facility name looked up. */
export function getInterestsBySeeker(jobSeekerId: number): ApplicantInterestWithFacility[] {
  return sqlite
    .prepare(`
      SELECT
        ai.id, ai.facility_number as facilityNumber,
        f.name as facilityName,
        ai.role_interest as roleInterest, ai.message, ai.status,
        ai.created_at as createdAt
      FROM applicant_interests ai
      LEFT JOIN facilities f ON f.number = ai.facility_number
      WHERE ai.job_seeker_id = ?
      ORDER BY ai.created_at DESC
    `)
    .all(jobSeekerId) as ApplicantInterestWithFacility[];
}

// ── Facility DB helpers (raw SQL for performance) ─────────────────────────────
// FacilityDbRow is defined in shared/etl-types.ts and re-exported at the top
// of this file — no local definition needed here.
import type { FacilityDbRow } from "@shared/etl-types";

export interface FacilityQueryFilters {
  search?: string;
  county?: string;
  facilityType?: string;
  facilityGroup?: string;
  statuses?: string[];
  isHiring?: boolean;
  hiringNumbers?: Set<string>;
  minCapacity?: number;
  maxCapacity?: number;
  bbox?: { minLat: number; minLng: number; maxLat: number; maxLng: number };
}

function buildFacilityWhere(filters: FacilityQueryFilters): { where: string; params: any[] } {
  const clauses: string[] = [];
  const params: any[] = [];

  if (filters.search) {
    const q = `%${filters.search.toLowerCase()}%`;
    clauses.push(
      "(LOWER(name) LIKE ? OR LOWER(address) LIKE ? OR LOWER(city) LIKE ? OR LOWER(county) LIKE ? OR LOWER(licensee) LIKE ? OR LOWER(administrator) LIKE ? OR number LIKE ?)"
    );
    params.push(q, q, q, q, q, q, q);
  }
  if (filters.county) {
    clauses.push("county = ?");
    params.push(filters.county);
  }
  if (filters.facilityType) {
    clauses.push("facility_type = ?");
    params.push(filters.facilityType);
  }
  if (filters.facilityGroup) {
    clauses.push("facility_group = ?");
    params.push(filters.facilityGroup);
  }
  if (filters.statuses && filters.statuses.length > 0) {
    clauses.push(`status IN (${filters.statuses.map(() => "?").join(",")})`);
    params.push(...filters.statuses);
  }
  if (filters.minCapacity != null) {
    clauses.push("capacity >= ?");
    params.push(filters.minCapacity);
  }
  if (filters.maxCapacity != null) {
    clauses.push("capacity <= ?");
    params.push(filters.maxCapacity);
  }
  if (filters.bbox) {
    clauses.push("lat >= ? AND lat <= ? AND lng >= ? AND lng <= ?");
    params.push(filters.bbox.minLat, filters.bbox.maxLat, filters.bbox.minLng, filters.bbox.maxLng);
  }
  // isHiring filter handled post-query by the caller (requires job_postings join)

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
}

/** Total number of facility rows in the DB — 0 means DB is empty/not seeded. */
export function getFacilityDbCount(): number {
  const row = sqlite.prepare("SELECT COUNT(*) as n FROM facilities").get() as { n: number };
  return row.n;
}

/** Query all facilities matching filters (no pagination — full list for map). */
export function queryFacilitiesAll(filters: FacilityQueryFilters): FacilityDbRow[] {
  const { where, params } = buildFacilityWhere(filters);
  return sqlite
    .prepare(`SELECT * FROM facilities ${where} ORDER BY name`)
    .all(...params) as FacilityDbRow[];
}

/** Autocomplete: top matches on name, city, number. */
export function searchFacilitiesAutocomplete(q: string, limit = 10): FacilityDbRow[] {
  const pattern = `%${q.toLowerCase()}%`;
  return sqlite
    .prepare(
      "SELECT * FROM facilities WHERE LOWER(name) LIKE ? OR number LIKE ? OR LOWER(city) LIKE ? LIMIT ?"
    )
    .all(pattern, pattern, pattern, limit) as FacilityDbRow[];
}

export interface FacilitiesMetaResult {
  totalCount: number;
  facilityTypes: string[];
  facilityGroups: string[];
  counties: string[];
  statuses: string[];
  countByType: Record<string, number>;
  countByGroup: Record<string, number>;
  countByCounty: Record<string, number>;
  countByStatus: Record<string, number>;
  lastUpdated: number | null;
}

/** Metadata for building the filter UI — counts by type/group/county/status. */
export function getFacilitiesMeta(): FacilitiesMetaResult {
  const totalCount = getFacilityDbCount();

  const byType = sqlite
    .prepare("SELECT facility_type as k, COUNT(*) as n FROM facilities GROUP BY facility_type ORDER BY facility_type")
    .all() as { k: string; n: number }[];

  const byGroup = sqlite
    .prepare("SELECT facility_group as k, COUNT(*) as n FROM facilities GROUP BY facility_group ORDER BY facility_group")
    .all() as { k: string; n: number }[];

  const byCounty = sqlite
    .prepare("SELECT county as k, COUNT(*) as n FROM facilities GROUP BY county ORDER BY county")
    .all() as { k: string; n: number }[];

  const byStatus = sqlite
    .prepare("SELECT status as k, COUNT(*) as n FROM facilities GROUP BY status ORDER BY status")
    .all() as { k: string; n: number }[];

  const lastRow = sqlite
    .prepare("SELECT MAX(updated_at) as t FROM facilities")
    .get() as { t: number | null };

  return {
    totalCount,
    facilityTypes: byType.map((r) => r.k).filter(Boolean),
    facilityGroups: byGroup.map((r) => r.k).filter(Boolean),
    counties: byCounty.map((r) => r.k).filter(Boolean),
    statuses: byStatus.map((r) => r.k).filter(Boolean),
    countByType: Object.fromEntries(byType.map((r) => [r.k, r.n])),
    countByGroup: Object.fromEntries(byGroup.map((r) => [r.k, r.n])),
    countByCounty: Object.fromEntries(byCounty.map((r) => [r.k, r.n])),
    countByStatus: Object.fromEntries(byStatus.map((r) => [r.k, r.n])),
    lastUpdated: lastRow.t,
  };
}

/** Bulk upsert facilities — used by the seed/extract scripts. */
export function bulkUpsertFacilities(rows: Omit<FacilityDbRow, "updated_at">[]): void {
  const stmt = sqlite.prepare(`
    INSERT INTO facilities (
      number, name, facility_type, facility_group, status,
      address, city, county, zip, phone,
      licensee, administrator, capacity,
      first_license_date, closed_date, last_inspection_date,
      total_visits, total_type_b, citations,
      lat, lng, geocode_quality, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?,
      ?, ?, ?, ?
    ) ON CONFLICT(number) DO UPDATE SET
      name=excluded.name, facility_type=excluded.facility_type,
      facility_group=excluded.facility_group, status=excluded.status,
      address=excluded.address, city=excluded.city, county=excluded.county,
      zip=excluded.zip, phone=excluded.phone, licensee=excluded.licensee,
      administrator=excluded.administrator, capacity=excluded.capacity,
      first_license_date=excluded.first_license_date, closed_date=excluded.closed_date,
      last_inspection_date=CASE WHEN last_inspection_date != '' THEN last_inspection_date ELSE excluded.last_inspection_date END,
      total_visits=excluded.total_visits, total_type_b=excluded.total_type_b,
      citations=excluded.citations, lat=excluded.lat, lng=excluded.lng,
      geocode_quality=excluded.geocode_quality, updated_at=excluded.updated_at
  `);

  const now = Date.now();
  const insertMany = sqlite.transaction((items: Omit<FacilityDbRow, "updated_at">[]) => {
    for (const row of items) {
      stmt.run(
        row.number, row.name, row.facility_type, row.facility_group, row.status,
        row.address, row.city, row.county, row.zip, row.phone,
        row.licensee, row.administrator, row.capacity ?? 0,
        row.first_license_date, row.closed_date, row.last_inspection_date,
        row.total_visits ?? 0, row.total_type_b ?? 0, row.citations ?? 0,
        row.lat, row.lng, row.geocode_quality,
        now
      );
    }
  });

  insertMany(rows);
}

// ── Enrichment logging ────────────────────────────────────────────────────────

export interface EnrichmentRunRecord {
  id: number;
  started_at: number;
  finished_at: number | null;
  trigger: string;
  total_processed: number;
  total_enriched: number;
  total_no_data: number;
  total_failed: number;
}

export interface EnrichmentCoverage {
  total: number;
  enriched: number;
  withInspectionDate: number;
  withAdministrator: number;
  withLicensee: number;
  withTypeBCount: number;
  withCitations: number;
}

/** Write a completed enrichment run summary to the audit table. */
export function logEnrichmentRun(data: {
  startedAt: number;
  finishedAt: number;
  trigger: string;
  totalProcessed: number;
  totalEnriched: number;
  totalNoData: number;
  totalFailed: number;
}): void {
  sqlite
    .prepare(
      `INSERT INTO enrichment_runs
         (started_at, finished_at, trigger, total_processed, total_enriched, total_no_data, total_failed)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      data.startedAt,
      data.finishedAt,
      data.trigger,
      data.totalProcessed,
      data.totalEnriched,
      data.totalNoData,
      data.totalFailed,
    );
}

/** Return recent enrichment runs + per-field coverage counts. */
export function getEnrichmentLog(): { recentRuns: EnrichmentRunRecord[]; coverage: EnrichmentCoverage } {
  const recentRuns = sqlite
    .prepare("SELECT * FROM enrichment_runs ORDER BY started_at DESC LIMIT 20")
    .all() as EnrichmentRunRecord[];

  const n = (sql: string) =>
    (sqlite.prepare(sql).get() as { n: number }).n;

  return {
    recentRuns,
    coverage: {
      total:              n("SELECT COUNT(*) as n FROM facilities"),
      enriched:           n("SELECT COUNT(*) as n FROM facilities WHERE enriched_at IS NOT NULL"),
      withInspectionDate: n("SELECT COUNT(*) as n FROM facilities WHERE last_inspection_date != ''"),
      withAdministrator:  n("SELECT COUNT(*) as n FROM facilities WHERE administrator != ''"),
      withLicensee:       n("SELECT COUNT(*) as n FROM facilities WHERE licensee != ''"),
      withTypeBCount:     n("SELECT COUNT(*) as n FROM facilities WHERE total_type_b > 0"),
      withCitations:      n("SELECT COUNT(*) as n FROM facilities WHERE citations > 0"),
    },
  };
}
