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
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, and } from "drizzle-orm";
import path from "path";

// In production (Fly.io) DATA_DIR=/data points to the persistent volume.
// Locally it stays at the project root.
const DB_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, "data.db")
  : "data.db";

const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");

// Auto-create tables on startup
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

export const db = drizzle(sqlite);

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

  getJobSeekerAccount(id: number): Promise<JobSeekerAccount | undefined>;
  getJobSeekerAccountByUsername(username: string): Promise<JobSeekerAccount | undefined>;
  getJobSeekerAccountByEmail(email: string): Promise<JobSeekerAccount | undefined>;
  createJobSeekerAccount(data: InsertJobSeekerAccount): Promise<JobSeekerAccount>;
  getJobSeekerProfile(accountId: number): Promise<JobSeekerProfile | undefined>;
  upsertJobSeekerProfile(
    accountId: number,
    data: Partial<Pick<JobSeekerProfile, "name" | "phone" | "city" | "yearsExperience" | "jobTypes" | "bio">>
  ): Promise<JobSeekerProfile>;
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

  async getJobSeekerAccountByUsername(username: string): Promise<JobSeekerAccount | undefined> {
    return db.select().from(jobSeekerAccounts).where(eq(jobSeekerAccounts.username, username)).get();
  }

  async getJobSeekerAccountByEmail(email: string): Promise<JobSeekerAccount | undefined> {
    return db.select().from(jobSeekerAccounts).where(eq(jobSeekerAccounts.email, email)).get();
  }

  async createJobSeekerAccount(data: InsertJobSeekerAccount): Promise<JobSeekerAccount> {
    return db.insert(jobSeekerAccounts).values(data).returning().get();
  }

  async getJobSeekerProfile(accountId: number): Promise<JobSeekerProfile | undefined> {
    return db.select().from(jobSeekerProfiles).where(eq(jobSeekerProfiles.accountId, accountId)).get();
  }

  async upsertJobSeekerProfile(
    accountId: number,
    data: Partial<Pick<JobSeekerProfile, "name" | "phone" | "city" | "yearsExperience" | "jobTypes" | "bio">>
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
