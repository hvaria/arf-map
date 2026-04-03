import {
  type User,
  type InsertUser,
  users,
  facilityAccounts,
  facilityOverrides,
  jobPostingsTable,
  jobSeekerAccounts,
  jobSeekerProfiles,
  type FacilityAccount,
  type InsertFacilityAccount,
  type FacilityOverride,
  type DbJobPosting,
  type JobSeekerAccount,
  type InsertJobSeekerAccount,
  type JobSeekerProfile,
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { sqlite, db } from "./db/index";

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

addColumnIfMissing("job_seeker_profiles", "first_name", "TEXT");
addColumnIfMissing("job_seeker_profiles", "last_name", "TEXT");
addColumnIfMissing("job_seeker_profiles", "address", "TEXT");
addColumnIfMissing("job_seeker_profiles", "state", "TEXT");
addColumnIfMissing("job_seeker_profiles", "zip_code", "TEXT");
addColumnIfMissing("job_seeker_profiles", "profile_picture_url", "TEXT");

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  getFacilityAccount(id: number): Promise<FacilityAccount | undefined>;
  getFacilityAccountByUsername(username: string): Promise<FacilityAccount | undefined>;
  getFacilityAccountByNumber(facilityNumber: string): Promise<FacilityAccount | undefined>;
  createFacilityAccount(account: InsertFacilityAccount): Promise<FacilityAccount>;

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
    data: Partial<Pick<JobSeekerAccount, "emailVerified" | "verificationToken" | "verificationExpiry" | "lastLoginAt" | "failedLoginCount" | "updatedAt">>
  ): Promise<void>;

  getJobSeekerProfile(accountId: number): Promise<JobSeekerProfile | undefined>;
  upsertJobSeekerProfile(
    accountId: number,
    data: Partial<Pick<JobSeekerProfile,
      "name" | "firstName" | "lastName" | "phone" | "address" | "city" |
      "state" | "zipCode" | "profilePictureUrl" | "yearsExperience" | "jobTypes" | "bio"
    >>
  ): Promise<JobSeekerProfile>;
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
    data: Partial<Pick<JobSeekerAccount, "emailVerified" | "verificationToken" | "verificationExpiry" | "lastLoginAt" | "failedLoginCount" | "updatedAt">>
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
}

export const storage = new DatabaseStorage();
