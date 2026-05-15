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
  jobSeekerCredentials,
  type FacilityAccount,
  type InsertFacilityAccount,
  type FacilityOverride,
  type DbJobPosting,
  type JobSeekerAccount,
  type InsertJobSeekerAccount,
  type JobSeekerProfile,
  type ApplicantInterest,
  type JobSeekerCredential,
  type CredentialInput,
  jobSeekerWorkExperience,
  type JobSeekerWorkExperience,
  type WorkExperienceInput,
} from "@shared/schema";
import { eq, and, isNull, desc } from "drizzle-orm";
import { db, pool } from "./db/index";
import { CCLD_PREFILL_MAP } from "@shared/facility-profile";

export type { FacilityDbRow } from "@shared/etl-types";

// ── Helper: return first result from a Drizzle select ────────────────────────
async function getFirst<T>(query: Promise<T[]>): Promise<T | undefined> {
  return (await query)[0];
}

export interface IStorage {
  getUser(id: number): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  getFacilityAccount(id: number): Promise<FacilityAccount | undefined>;
  getFacilityAccountByUsername(username: string): Promise<FacilityAccount | undefined>;
  getFacilityAccountByNumber(facilityNumber: string): Promise<FacilityAccount | undefined>;
  getFacilityAccountByEmail(email: string): Promise<FacilityAccount | undefined>;
  createFacilityAccount(account: InsertFacilityAccount): Promise<FacilityAccount>;
  updateFacilityAccount(id: number, updates: Partial<Pick<FacilityAccount, "emailVerified" | "verificationToken" | "verificationExpiry" | "password" | "failedLoginCount">>): Promise<void>;

  getFacilityOverride(facilityNumber: string): Promise<FacilityOverride | undefined>;
  upsertFacilityOverride(
    facilityNumber: string,
    data: Partial<Omit<FacilityOverride, "id" | "facilityNumber" | "updatedAt">>
  ): Promise<FacilityOverride>;
  prefillFacilityOverrideFromCcld(
    facilityNumber: string,
    actor: string,
  ): Promise<{ override: FacilityOverride; prefilled: string[] }>;

  getAllJobPostings(): Promise<DbJobPosting[]>;
  getJobPostingById(id: number): Promise<DbJobPosting | undefined>;
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

  upsertApplicantInterest(
    jobSeekerId: number,
    facilityNumber: string,
    data: { jobId?: number | null; roleInterest?: string; message?: string }
  ): Promise<ApplicantInterest>;
  deleteApplicantInterest(id: number, jobSeekerId: number): Promise<boolean>;
  updateApplicantInterestStatus(id: number, facilityNumber: string, status: string): Promise<ApplicantInterest | undefined>;

  listJobSeekerCredentials(accountId: number): Promise<JobSeekerCredential[]>;
  createJobSeekerCredential(accountId: number, input: CredentialInput): Promise<JobSeekerCredential>;
  updateJobSeekerCredential(id: number, accountId: number, input: CredentialInput): Promise<JobSeekerCredential | undefined>;
  deleteJobSeekerCredential(id: number, accountId: number): Promise<boolean>;

  listJobSeekerWorkExperience(accountId: number): Promise<JobSeekerWorkExperience[]>;
  createJobSeekerWorkExperience(accountId: number, input: WorkExperienceInput): Promise<JobSeekerWorkExperience>;
  updateJobSeekerWorkExperience(id: number, accountId: number, input: WorkExperienceInput): Promise<JobSeekerWorkExperience | undefined>;
  deleteJobSeekerWorkExperience(id: number, accountId: number): Promise<boolean>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number): Promise<User | undefined> {
    return getFirst(db.select().from(users).where(eq(users.id, id)));
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    return getFirst(db.select().from(users).where(eq(users.username, username)));
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const rows = await db.insert(users).values(insertUser).returning();
    return rows[0] as User;
  }

  async getFacilityAccount(id: number): Promise<FacilityAccount | undefined> {
    return getFirst(db.select().from(facilityAccounts).where(eq(facilityAccounts.id, id)));
  }

  async getFacilityAccountByUsername(username: string): Promise<FacilityAccount | undefined> {
    return getFirst(db.select().from(facilityAccounts).where(eq(facilityAccounts.username, username)));
  }

  async getFacilityAccountByNumber(facilityNumber: string): Promise<FacilityAccount | undefined> {
    return getFirst(db.select().from(facilityAccounts).where(eq(facilityAccounts.facilityNumber, facilityNumber)));
  }

  async createFacilityAccount(account: InsertFacilityAccount): Promise<FacilityAccount> {
    const rows = await db.insert(facilityAccounts).values(account).returning();
    return rows[0] as FacilityAccount;
  }

  async getFacilityAccountByEmail(email: string): Promise<FacilityAccount | undefined> {
    return getFirst(db.select().from(facilityAccounts).where(eq(facilityAccounts.email, email)));
  }

  async updateFacilityAccount(
    id: number,
    updates: Partial<Pick<FacilityAccount, "emailVerified" | "verificationToken" | "verificationExpiry" | "password" | "failedLoginCount">>
  ): Promise<void> {
    await db.update(facilityAccounts).set(updates).where(eq(facilityAccounts.id, id));
  }

  async getFacilityOverride(facilityNumber: string): Promise<FacilityOverride | undefined> {
    return getFirst(db.select().from(facilityOverrides).where(eq(facilityOverrides.facilityNumber, facilityNumber)));
  }

  async upsertFacilityOverride(
    facilityNumber: string,
    data: Partial<Omit<FacilityOverride, "id" | "facilityNumber" | "updatedAt">>
  ): Promise<FacilityOverride> {
    const existing = await this.getFacilityOverride(facilityNumber);
    const now = Date.now();
    if (existing) {
      const rows = await db
        .update(facilityOverrides)
        .set({ ...data, updatedAt: now })
        .where(eq(facilityOverrides.facilityNumber, facilityNumber))
        .returning();
      return rows[0] as FacilityOverride;
    }
    const rows = await db
      .insert(facilityOverrides)
      .values({ facilityNumber, ...data, updatedAt: now })
      .returning();
    return rows[0] as FacilityOverride;
  }

  async prefillFacilityOverrideFromCcld(
    facilityNumber: string,
    actor: string,
  ): Promise<{ override: FacilityOverride; prefilled: string[] }> {
    // The CCLD `facilities` table doesn't carry a state column (every row is
    // California by construction). `state` in CCLD_PREFILL_MAP resolves to
    // an empty value here and is skipped by the null-check below.
    const facRes = await pool.query(
      `SELECT phone, address, city, zip, administrator, first_license_date
         FROM facilities WHERE number = $1`,
      [facilityNumber],
    );
    const fac = facRes.rows[0] as
      | {
          phone: string | null;
          address: string | null;
          city: string | null;
          zip: string | null;
          administrator: string | null;
          first_license_date: string | null;
        }
      | undefined;

    let existing = await this.getFacilityOverride(facilityNumber);
    if (!existing) {
      const inserted = await db
        .insert(facilityOverrides)
        .values({ facilityNumber, updatedAt: Date.now() })
        .returning();
      existing = inserted[0] as FacilityOverride;
    }

    if (existing.prefilledFromCcldAt) {
      return { override: existing, prefilled: [] };
    }

    if (!fac) {
      const now = Date.now();
      const rows = await db
        .update(facilityOverrides)
        .set({
          prefilledFromCcldAt: now,
          prefilledFields: JSON.stringify([]),
          updatedAt: now,
        })
        .where(eq(facilityOverrides.facilityNumber, facilityNumber))
        .returning();
      return { override: rows[0] as FacilityOverride, prefilled: [] };
    }

    const updates: Record<string, unknown> = {};
    const written: string[] = [];

    type OverrideCol = keyof typeof CCLD_PREFILL_MAP;
    const sourceValue = (srcKey: string): string | null => {
      if (srcKey === "first_license_date_year") {
        const raw = fac.first_license_date ?? "";
        const m = raw.match(/(19|20)\d{2}/);
        return m ? m[0] : null;
      }
      const v = (fac as Record<string, unknown>)[srcKey];
      if (v == null) return null;
      const s = String(v).trim();
      return s.length > 0 ? s : null;
    };

    for (const overrideCol of Object.keys(CCLD_PREFILL_MAP) as OverrideCol[]) {
      const srcKey = CCLD_PREFILL_MAP[overrideCol];
      const currentValue = (existing as Record<string, unknown>)[overrideCol];
      if (currentValue != null && currentValue !== "") continue;
      const fromCcld = sourceValue(srcKey);
      if (fromCcld == null) continue;
      if (overrideCol === "yearEstablished") {
        const year = Number(fromCcld);
        if (Number.isFinite(year) && year >= 1900 && year <= 2100) {
          updates[overrideCol] = year;
          written.push(overrideCol);
        }
      } else {
        updates[overrideCol] = fromCcld;
        written.push(overrideCol);
      }
    }

    const now = Date.now();
    const rows = await db
      .update(facilityOverrides)
      .set({
        ...updates,
        prefilledFromCcldAt: now,
        prefilledFields: JSON.stringify(written),
        updatedAt: now,
      })
      .where(eq(facilityOverrides.facilityNumber, facilityNumber))
      .returning();
    void actor;
    return { override: rows[0] as FacilityOverride, prefilled: written };
  }

  async getAllJobPostings(): Promise<DbJobPosting[]> {
    return db.select().from(jobPostingsTable);
  }

  async getJobPostingById(id: number): Promise<DbJobPosting | undefined> {
    const rows = await db
      .select()
      .from(jobPostingsTable)
      .where(eq(jobPostingsTable.id, id))
      .limit(1);
    return rows[0];
  }

  async getJobPostings(facilityNumber: string): Promise<DbJobPosting[]> {
    return db.select().from(jobPostingsTable).where(eq(jobPostingsTable.facilityNumber, facilityNumber));
  }

  async createJobPosting(
    facilityNumber: string,
    data: Pick<DbJobPosting, "title" | "type" | "salary" | "description" | "requirements">
  ): Promise<DbJobPosting> {
    const rows = await db
      .insert(jobPostingsTable)
      .values({ ...data, facilityNumber, postedAt: Date.now() })
      .returning();
    return rows[0] as DbJobPosting;
  }

  async updateJobPosting(
    id: number,
    facilityNumber: string,
    data: Partial<Pick<DbJobPosting, "title" | "type" | "salary" | "description" | "requirements">>
  ): Promise<DbJobPosting | undefined> {
    const existingRows = await db
      .select()
      .from(jobPostingsTable)
      .where(and(eq(jobPostingsTable.id, id), eq(jobPostingsTable.facilityNumber, facilityNumber)));
    if (!existingRows[0]) return undefined;
    const rows = await db
      .update(jobPostingsTable)
      .set(data)
      .where(eq(jobPostingsTable.id, id))
      .returning();
    return rows[0] as DbJobPosting | undefined;
  }

  async deleteJobPosting(id: number, facilityNumber: string): Promise<boolean> {
    const existingRows = await db
      .select()
      .from(jobPostingsTable)
      .where(and(eq(jobPostingsTable.id, id), eq(jobPostingsTable.facilityNumber, facilityNumber)));
    if (!existingRows[0]) return false;
    await db.delete(jobPostingsTable).where(eq(jobPostingsTable.id, id));
    return true;
  }

  async getJobSeekerAccount(id: number): Promise<JobSeekerAccount | undefined> {
    return getFirst(db.select().from(jobSeekerAccounts).where(eq(jobSeekerAccounts.id, id)));
  }

  async getJobSeekerAccountByEmail(email: string): Promise<JobSeekerAccount | undefined> {
    return getFirst(db.select().from(jobSeekerAccounts).where(eq(jobSeekerAccounts.email, email.toLowerCase())));
  }

  async getJobSeekerAccountByVerificationToken(token: string): Promise<JobSeekerAccount | undefined> {
    return getFirst(db.select().from(jobSeekerAccounts).where(eq(jobSeekerAccounts.verificationToken, token)));
  }

  async createJobSeekerAccount(data: InsertJobSeekerAccount): Promise<JobSeekerAccount> {
    const normalized = {
      ...data,
      email: data.email.toLowerCase(),
      username: data.username.toLowerCase(),
    };
    const rows = await db.insert(jobSeekerAccounts).values(normalized).returning();
    return rows[0] as JobSeekerAccount;
  }

  async updateJobSeekerAccount(
    id: number,
    data: Partial<Pick<JobSeekerAccount, "emailVerified" | "verificationToken" | "verificationExpiry" | "lastLoginAt" | "failedLoginCount" | "updatedAt" | "password">>
  ): Promise<void> {
    await db.update(jobSeekerAccounts).set(data).where(eq(jobSeekerAccounts.id, id));
  }

  async getJobSeekerProfile(accountId: number): Promise<JobSeekerProfile | undefined> {
    return getFirst(db.select().from(jobSeekerProfiles).where(eq(jobSeekerProfiles.accountId, accountId)));
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
      const rows = await db
        .update(jobSeekerProfiles)
        .set({ ...data, updatedAt: now })
        .where(eq(jobSeekerProfiles.accountId, accountId))
        .returning();
      return rows[0] as JobSeekerProfile;
    }
    const rows = await db
      .insert(jobSeekerProfiles)
      .values({ accountId, ...data, updatedAt: now })
      .returning();
    return rows[0] as JobSeekerProfile;
  }

  async upsertApplicantInterest(
    jobSeekerId: number,
    facilityNumber: string,
    data: { jobId?: number | null; roleInterest?: string; message?: string }
  ): Promise<ApplicantInterest> {
    const now = Date.now();
    const { jobId = null, roleInterest, message } = data;
    // Scope the lookup so per-job and facility-level rows don't collide:
    // - jobId set      → unique by (seeker, jobId)
    // - jobId null     → unique by (seeker, facilityNumber) WHERE jobId IS NULL
    const existingRows = await db
      .select()
      .from(applicantInterests)
      .where(
        jobId == null
          ? and(
              eq(applicantInterests.jobSeekerId, jobSeekerId),
              eq(applicantInterests.facilityNumber, facilityNumber),
              isNull(applicantInterests.jobId),
            )
          : and(
              eq(applicantInterests.jobSeekerId, jobSeekerId),
              eq(applicantInterests.jobId, jobId),
            ),
      );
    if (existingRows[0]) {
      const rows = await db
        .update(applicantInterests)
        .set({ roleInterest, message, updatedAt: now })
        .where(eq(applicantInterests.id, existingRows[0].id))
        .returning();
      return rows[0] as ApplicantInterest;
    }
    const rows = await db
      .insert(applicantInterests)
      .values({
        jobSeekerId,
        facilityNumber,
        jobId,
        roleInterest,
        message,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return rows[0] as ApplicantInterest;
  }

  async deleteApplicantInterest(id: number, jobSeekerId: number): Promise<boolean> {
    const existingRows = await db
      .select()
      .from(applicantInterests)
      .where(and(eq(applicantInterests.id, id), eq(applicantInterests.jobSeekerId, jobSeekerId)));
    if (!existingRows[0]) return false;
    await db.delete(applicantInterests).where(eq(applicantInterests.id, id));
    return true;
  }

  async updateApplicantInterestStatus(
    id: number,
    facilityNumber: string,
    status: string
  ): Promise<ApplicantInterest | undefined> {
    const existingRows = await db
      .select()
      .from(applicantInterests)
      .where(and(eq(applicantInterests.id, id), eq(applicantInterests.facilityNumber, facilityNumber)));
    if (!existingRows[0]) return undefined;
    const rows = await db
      .update(applicantInterests)
      .set({ status, updatedAt: Date.now() })
      .where(eq(applicantInterests.id, id))
      .returning();
    return rows[0] as ApplicantInterest | undefined;
  }

  async listJobSeekerCredentials(accountId: number): Promise<JobSeekerCredential[]> {
    return db
      .select()
      .from(jobSeekerCredentials)
      .where(eq(jobSeekerCredentials.accountId, accountId))
      .orderBy(desc(jobSeekerCredentials.createdAt));
  }

  async createJobSeekerCredential(
    accountId: number,
    input: CredentialInput
  ): Promise<JobSeekerCredential> {
    const now = Date.now();
    const rows = await db
      .insert(jobSeekerCredentials)
      .values({
        accountId,
        kind: input.kind,
        label: input.label,
        licenseNumber: input.licenseNumber,
        issuingAuthority: input.issuingAuthority,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        notes: input.notes,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return rows[0] as JobSeekerCredential;
  }

  async updateJobSeekerCredential(
    id: number,
    accountId: number,
    input: CredentialInput
  ): Promise<JobSeekerCredential | undefined> {
    const existingRows = await db
      .select()
      .from(jobSeekerCredentials)
      .where(and(eq(jobSeekerCredentials.id, id), eq(jobSeekerCredentials.accountId, accountId)));
    if (!existingRows[0]) return undefined;
    const rows = await db
      .update(jobSeekerCredentials)
      .set({
        kind: input.kind,
        label: input.label,
        licenseNumber: input.licenseNumber,
        issuingAuthority: input.issuingAuthority,
        issuedAt: input.issuedAt,
        expiresAt: input.expiresAt,
        notes: input.notes,
        updatedAt: Date.now(),
      })
      .where(eq(jobSeekerCredentials.id, id))
      .returning();
    return rows[0] as JobSeekerCredential | undefined;
  }

  async deleteJobSeekerCredential(id: number, accountId: number): Promise<boolean> {
    const existingRows = await db
      .select()
      .from(jobSeekerCredentials)
      .where(and(eq(jobSeekerCredentials.id, id), eq(jobSeekerCredentials.accountId, accountId)));
    if (!existingRows[0]) return false;
    await db.delete(jobSeekerCredentials).where(eq(jobSeekerCredentials.id, id));
    return true;
  }

  // ── Job seeker work experience ─────────────────────────────────────────────
  // Reverse-chronological ordering: current roles (end_date IS NULL) first,
  // then by end_date DESC, then by start_date DESC. Drizzle doesn't expose
  // a clean "boolean DESC + NULLS LAST" combo so we drop to pool.query with
  // snake→camel column aliasing, matching the JOIN helpers below.
  async listJobSeekerWorkExperience(accountId: number): Promise<JobSeekerWorkExperience[]> {
    const result = await pool.query<JobSeekerWorkExperience>(
      `SELECT
        id, account_id AS "accountId", title, company,
        facility_number AS "facilityNumber", location,
        employment_type AS "employmentType",
        start_date AS "startDate", end_date AS "endDate",
        description,
        created_at AS "createdAt", updated_at AS "updatedAt"
      FROM job_seeker_work_experience
      WHERE account_id = $1
      ORDER BY (end_date IS NULL) DESC, end_date DESC NULLS LAST, start_date DESC`,
      [accountId],
    );
    return result.rows;
  }

  async createJobSeekerWorkExperience(
    accountId: number,
    input: WorkExperienceInput,
  ): Promise<JobSeekerWorkExperience> {
    const now = Date.now();
    const rows = await db
      .insert(jobSeekerWorkExperience)
      .values({
        accountId,
        title: input.title,
        company: input.company,
        facilityNumber: input.facilityNumber,
        location: input.location,
        employmentType: input.employmentType,
        startDate: input.startDate,
        endDate: input.endDate,
        description: input.description,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return rows[0] as JobSeekerWorkExperience;
  }

  // Single-statement update scoped by (id, accountId). Empty returning array
  // means the row either doesn't exist or belongs to a different seeker —
  // either way the caller treats it as a 404.
  async updateJobSeekerWorkExperience(
    id: number,
    accountId: number,
    input: WorkExperienceInput,
  ): Promise<JobSeekerWorkExperience | undefined> {
    const rows = await db
      .update(jobSeekerWorkExperience)
      .set({
        title: input.title,
        company: input.company,
        facilityNumber: input.facilityNumber,
        location: input.location,
        employmentType: input.employmentType,
        startDate: input.startDate,
        endDate: input.endDate,
        description: input.description,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(jobSeekerWorkExperience.id, id),
          eq(jobSeekerWorkExperience.accountId, accountId),
        ),
      )
      .returning();
    return rows[0] as JobSeekerWorkExperience | undefined;
  }

  async deleteJobSeekerWorkExperience(id: number, accountId: number): Promise<boolean> {
    const rows = await db
      .delete(jobSeekerWorkExperience)
      .where(
        and(
          eq(jobSeekerWorkExperience.id, id),
          eq(jobSeekerWorkExperience.accountId, accountId),
        ),
      )
      .returning({ id: jobSeekerWorkExperience.id });
    return rows.length === 1;
  }
}

export const storage = new DatabaseStorage();

// ── Applicant Interest JOIN queries ───────────────────────────────────────────

export interface ApplicantInterestWithProfile {
  id: number;
  jobSeekerId: number;
  facilityNumber: string;
  jobId: number | null;
  jobTitle: string | null;
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
  jobId: number | null;
  jobTitle: string | null;
  roleInterest: string | null;
  message: string | null;
  status: string;
  createdAt: number;
}

export async function getInterestsByFacilityAsync(facilityNumber: string): Promise<ApplicantInterestWithProfile[]> {
  const result = await pool.query<ApplicantInterestWithProfile>(
    `SELECT
      ai.id, ai.job_seeker_id as "jobSeekerId", ai.facility_number as "facilityNumber",
      ai.job_id as "jobId",
      jp.title as "jobTitle",
      ai.role_interest as "roleInterest", ai.message, ai.status,
      ai.created_at as "createdAt", ai.updated_at as "updatedAt",
      a.email,
      p.first_name as "firstName", p.last_name as "lastName",
      p.city, p.state, p.years_experience as "yearsExperience",
      p.job_types as "jobTypes", p.bio
    FROM applicant_interests ai
    JOIN job_seeker_accounts a ON a.id = ai.job_seeker_id
    LEFT JOIN job_seeker_profiles p ON p.account_id = ai.job_seeker_id
    LEFT JOIN job_postings jp ON jp.id = ai.job_id
    WHERE ai.facility_number = $1
    ORDER BY ai.created_at DESC`,
    [facilityNumber]
  );
  return result.rows;
}

export async function getInterestsBySeekerAsync(jobSeekerId: number): Promise<ApplicantInterestWithFacility[]> {
  const result = await pool.query<ApplicantInterestWithFacility>(
    `SELECT
      ai.id, ai.facility_number as "facilityNumber",
      f.name as "facilityName",
      ai.job_id as "jobId",
      jp.title as "jobTitle",
      ai.role_interest as "roleInterest", ai.message, ai.status,
      ai.created_at as "createdAt"
    FROM applicant_interests ai
    LEFT JOIN facilities f ON f.number = ai.facility_number
    LEFT JOIN job_postings jp ON jp.id = ai.job_id
    WHERE ai.job_seeker_id = $1
    ORDER BY ai.created_at DESC`,
    [jobSeekerId]
  );
  return result.rows;
}

// ── Facility DB helpers (raw SQL for performance) ─────────────────────────────

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

function buildFacilityWhere(filters: FacilityQueryFilters): { where: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  let n = 1;

  const p = (val: unknown) => { params.push(val); return `$${n++}`; };

  if (filters.search) {
    const q = `%${filters.search.toLowerCase()}%`;
    clauses.push(
      `(LOWER(name) LIKE ${p(q)} OR LOWER(address) LIKE ${p(q)} OR LOWER(city) LIKE ${p(q)} OR LOWER(county) LIKE ${p(q)} OR LOWER(licensee) LIKE ${p(q)} OR LOWER(administrator) LIKE ${p(q)} OR number LIKE ${p(q)})`
    );
  }
  if (filters.county) clauses.push(`county = ${p(filters.county)}`);
  if (filters.facilityType) clauses.push(`facility_type = ${p(filters.facilityType)}`);
  if (filters.facilityGroup) clauses.push(`facility_group = ${p(filters.facilityGroup)}`);
  if (filters.statuses && filters.statuses.length > 0) {
    clauses.push(`status IN (${filters.statuses.map((s) => p(s)).join(",")})`);
  }
  if (filters.minCapacity != null) clauses.push(`capacity >= ${p(filters.minCapacity)}`);
  if (filters.maxCapacity != null) clauses.push(`capacity <= ${p(filters.maxCapacity)}`);
  if (filters.bbox) {
    const { minLat, maxLat, minLng, maxLng } = filters.bbox;
    clauses.push(`lat >= ${p(minLat)} AND lat <= ${p(maxLat)} AND lng >= ${p(minLng)} AND lng <= ${p(maxLng)}`);
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  return { where, params };
}

export async function getFacilityDbCountAsync(): Promise<number> {
  const result = await pool.query("SELECT COUNT(*) as n FROM facilities");
  return parseInt(result.rows[0].n as string, 10);
}

export async function queryFacilitiesAllAsync(filters: FacilityQueryFilters): Promise<FacilityDbRow[]> {
  const { where, params } = buildFacilityWhere(filters);
  const coordClause = where
    ? `${where} AND lat IS NOT NULL AND lng IS NOT NULL AND lat != 0 AND lng != 0`
    : `WHERE lat IS NOT NULL AND lng IS NOT NULL AND lat != 0 AND lng != 0`;
  const result = await pool.query(
    `SELECT * FROM facilities ${coordClause} ORDER BY name`,
    params
  );
  return result.rows as FacilityDbRow[];
}

/**
 * Slim projection for the map. Returns only the columns the map cluster,
 * pin, hover tooltip, and JobsPanel actually read — about a quarter the
 * row size of queryFacilitiesAllAsync. Skips ORDER BY because the client
 * groups/clusters by lat/lng anyway.
 */
export interface FacilityPinRow {
  number: string;
  name: string;
  lat: number;
  lng: number;
  city: string;
  county: string;
  capacity: number | null;
  status: string;
  facility_type: string;
  facility_group: string;
}

export async function queryFacilityPinsAsync(
  filters: FacilityQueryFilters,
): Promise<FacilityPinRow[]> {
  const { where, params } = buildFacilityWhere(filters);
  const coordClause = where
    ? `${where} AND lat IS NOT NULL AND lng IS NOT NULL AND lat != 0 AND lng != 0`
    : `WHERE lat IS NOT NULL AND lng IS NOT NULL AND lat != 0 AND lng != 0`;
  const result = await pool.query(
    `SELECT number, name, lat, lng, city, county, capacity, status, facility_type, facility_group
     FROM facilities ${coordClause}`,
    params,
  );
  return result.rows as FacilityPinRow[];
}

/** Single facility detail row, used by /api/facilities/:number/public. */
export async function getFacilityByNumberAsync(
  number: string,
): Promise<FacilityDbRow | undefined> {
  const result = await pool.query("SELECT * FROM facilities WHERE number = $1", [number]);
  return result.rows[0] as FacilityDbRow | undefined;
}

export async function searchFacilitiesAutocompleteAsync(q: string, limit = 10): Promise<FacilityDbRow[]> {
  const pattern = `%${q.toLowerCase()}%`;
  const result = await pool.query(
    "SELECT * FROM facilities WHERE LOWER(name) LIKE $1 OR number LIKE $2 OR LOWER(city) LIKE $3 LIMIT $4",
    [pattern, pattern, pattern, limit]
  );
  return result.rows as FacilityDbRow[];
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

export async function getFacilitiesMetaAsync(): Promise<FacilitiesMetaResult> {
  const [countRes, byTypeRes, byGroupRes, byCountyRes, byStatusRes, lastRes] = await Promise.all([
    pool.query("SELECT COUNT(*) as n FROM facilities"),
    pool.query("SELECT facility_type as k, COUNT(*) as n FROM facilities GROUP BY facility_type ORDER BY facility_type"),
    pool.query("SELECT facility_group as k, COUNT(*) as n FROM facilities GROUP BY facility_group ORDER BY facility_group"),
    pool.query("SELECT county as k, COUNT(*) as n FROM facilities GROUP BY county ORDER BY county"),
    pool.query("SELECT status as k, COUNT(*) as n FROM facilities GROUP BY status ORDER BY status"),
    pool.query("SELECT MAX(updated_at) as t FROM facilities"),
  ]);

  const totalCount = parseInt(countRes.rows[0].n as string, 10);
  const byType = byTypeRes.rows as { k: string; n: number }[];
  const byGroup = byGroupRes.rows as { k: string; n: number }[];
  const byCounty = byCountyRes.rows as { k: string; n: number }[];
  const byStatus = byStatusRes.rows as { k: string; n: number }[];
  const lastUpdated = lastRes.rows[0]?.t != null ? parseInt(lastRes.rows[0].t as string, 10) : null;

  return {
    totalCount,
    facilityTypes: byType.map((r) => r.k).filter(Boolean),
    facilityGroups: byGroup.map((r) => r.k).filter(Boolean),
    counties: byCounty.map((r) => r.k).filter(Boolean),
    statuses: byStatus.map((r) => r.k).filter(Boolean),
    countByType: Object.fromEntries(byType.map((r) => [r.k, Number(r.n)])),
    countByGroup: Object.fromEntries(byGroup.map((r) => [r.k, Number(r.n)])),
    countByCounty: Object.fromEntries(byCounty.map((r) => [r.k, Number(r.n)])),
    countByStatus: Object.fromEntries(byStatus.map((r) => [r.k, Number(r.n)])),
    lastUpdated,
  };
}

export async function bulkUpsertFacilities(rows: Omit<FacilityDbRow, "updated_at">[]): Promise<void> {
  const now = Date.now();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const row of rows) {
      await client.query(
        `INSERT INTO facilities (
          number, name, facility_type, facility_group, status,
          address, city, county, zip, phone,
          licensee, administrator, capacity,
          first_license_date, closed_date, last_inspection_date,
          total_visits, total_type_b, citations,
          lat, lng, geocode_quality, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5,
          $6, $7, $8, $9, $10,
          $11, $12, $13,
          $14, $15, $16,
          $17, $18, $19,
          $20, $21, $22, $23
        ) ON CONFLICT(number) DO UPDATE SET
          name=EXCLUDED.name, facility_type=EXCLUDED.facility_type,
          facility_group=EXCLUDED.facility_group, status=EXCLUDED.status,
          address=EXCLUDED.address, city=EXCLUDED.city, county=EXCLUDED.county,
          zip=EXCLUDED.zip, phone=EXCLUDED.phone, licensee=EXCLUDED.licensee,
          administrator=EXCLUDED.administrator, capacity=EXCLUDED.capacity,
          first_license_date=EXCLUDED.first_license_date, closed_date=EXCLUDED.closed_date,
          last_inspection_date=CASE WHEN facilities.last_inspection_date != '' THEN facilities.last_inspection_date ELSE EXCLUDED.last_inspection_date END,
          total_visits=EXCLUDED.total_visits, total_type_b=EXCLUDED.total_type_b,
          citations=EXCLUDED.citations,
          lat=CASE WHEN EXCLUDED.lat IS NOT NULL THEN EXCLUDED.lat ELSE facilities.lat END,
          lng=CASE WHEN EXCLUDED.lng IS NOT NULL THEN EXCLUDED.lng ELSE facilities.lng END,
          geocode_quality=CASE WHEN EXCLUDED.geocode_quality != '' AND EXCLUDED.geocode_quality IS NOT NULL
                               THEN EXCLUDED.geocode_quality ELSE facilities.geocode_quality END,
          updated_at=EXCLUDED.updated_at`,
        [
          row.number, row.name, row.facility_type, row.facility_group, row.status,
          row.address, row.city, row.county, row.zip, row.phone,
          row.licensee, row.administrator, row.capacity ?? 0,
          row.first_license_date, row.closed_date, row.last_inspection_date,
          row.total_visits ?? 0, row.total_type_b ?? 0, row.citations ?? 0,
          row.lat, row.lng, row.geocode_quality,
          now,
        ]
      );
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function updateFacilityCoords(
  number: string,
  lat: number | null,
  lng: number | null,
  quality: string,
): Promise<void> {
  await pool.query(
    "UPDATE facilities SET lat=$1, lng=$2, geocode_quality=$3 WHERE number=$4",
    [lat, lng, quality, number]
  );
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

export async function logEnrichmentRun(data: {
  startedAt: number;
  finishedAt: number;
  trigger: string;
  totalProcessed: number;
  totalEnriched: number;
  totalNoData: number;
  totalFailed: number;
}): Promise<void> {
  await pool.query(
    `INSERT INTO enrichment_runs
       (started_at, finished_at, trigger, total_processed, total_enriched, total_no_data, total_failed)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [data.startedAt, data.finishedAt, data.trigger, data.totalProcessed, data.totalEnriched, data.totalNoData, data.totalFailed]
  );
}

export async function getEnrichmentLogAsync(): Promise<{ recentRuns: EnrichmentRunRecord[]; coverage: EnrichmentCoverage }> {
  const [runsRes, total, enriched, inspection, admin, licensee, typeB, citations] = await Promise.all([
    pool.query("SELECT * FROM enrichment_runs ORDER BY started_at DESC LIMIT 20"),
    pool.query("SELECT COUNT(*) as n FROM facilities"),
    pool.query("SELECT COUNT(*) as n FROM facilities WHERE enriched_at IS NOT NULL"),
    pool.query("SELECT COUNT(*) as n FROM facilities WHERE last_inspection_date != ''"),
    pool.query("SELECT COUNT(*) as n FROM facilities WHERE administrator != ''"),
    pool.query("SELECT COUNT(*) as n FROM facilities WHERE licensee != ''"),
    pool.query("SELECT COUNT(*) as n FROM facilities WHERE total_type_b > 0"),
    pool.query("SELECT COUNT(*) as n FROM facilities WHERE citations > 0"),
  ]);

  return {
    recentRuns: runsRes.rows as EnrichmentRunRecord[],
    coverage: {
      total:              parseInt(total.rows[0].n as string, 10),
      enriched:           parseInt(enriched.rows[0].n as string, 10),
      withInspectionDate: parseInt(inspection.rows[0].n as string, 10),
      withAdministrator:  parseInt(admin.rows[0].n as string, 10),
      withLicensee:       parseInt(licensee.rows[0].n as string, 10),
      withTypeBCount:     parseInt(typeB.rows[0].n as string, 10),
      withCitations:      parseInt(citations.rows[0].n as string, 10),
    },
  };
}
