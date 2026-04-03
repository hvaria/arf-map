import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index";
import { sqlite } from "../../db/index";
import { jobSeekerAccounts } from "@shared/schema";
import type {
  JobSeekerAccount,
  JobSeekerRepository,
  LoginAttemptEntry,
} from "../jobSeekerRepository";

/**
 * SQLite implementation of JobSeekerRepository.
 *
 * All queries use Drizzle ORM for type safety.  The raw `sqlite` instance is
 * used only for the login_attempts insert (a table not yet in the Drizzle
 * schema) — replace with a Drizzle table definition when a migration tool is
 * fully wired in.
 *
 * ── Replacing this with PostgresJobSeekerRepository ─────────────────────────
 * 1. Create server/repositories/postgres/postgresJobSeekerRepository.ts
 * 2. Implement the same JobSeekerRepository interface using drizzle-orm/pg-core.
 * 3. In server/routes/jobseekerAuth.ts, swap the import.
 * No other files change.
 */
export class SqliteJobSeekerRepository implements JobSeekerRepository {
  async findById(id: number): Promise<JobSeekerAccount | null> {
    const row = await db
      .select()
      .from(jobSeekerAccounts)
      .where(eq(jobSeekerAccounts.id, id))
      .get();
    return row ? this.toModel(row) : null;
  }

  async findByEmail(email: string): Promise<JobSeekerAccount | null> {
    const row = await db
      .select()
      .from(jobSeekerAccounts)
      .where(eq(jobSeekerAccounts.email, email.toLowerCase()))
      .get();
    return row ? this.toModel(row) : null;
  }

  async incrementFailedLoginCount(id: number): Promise<void> {
    await db
      .update(jobSeekerAccounts)
      .set({ failedLoginCount: sql`failed_login_count + 1`, updatedAt: Date.now() })
      .where(eq(jobSeekerAccounts.id, id))
      .run();
  }

  async resetFailedLoginCount(id: number): Promise<void> {
    await db
      .update(jobSeekerAccounts)
      .set({ failedLoginCount: 0, updatedAt: Date.now() })
      .where(eq(jobSeekerAccounts.id, id))
      .run();
  }

  async updateLastLoginAt(id: number, timestamp: number): Promise<void> {
    await db
      .update(jobSeekerAccounts)
      .set({ lastLoginAt: timestamp, updatedAt: timestamp })
      .where(eq(jobSeekerAccounts.id, id))
      .run();
  }

  async logLoginAttempt(entry: LoginAttemptEntry): Promise<void> {
    sqlite
      .prepare(
        `INSERT INTO login_attempts (email, ip, success, failure_reason, attempted_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        entry.email,
        entry.ip ?? null,
        entry.success ? 1 : 0,
        entry.failureReason ?? null,
        Date.now(),
      );
  }

  /** Map the raw DB row (with `password` column) to the domain model. */
  private toModel(
    row: typeof jobSeekerAccounts.$inferSelect,
  ): JobSeekerAccount {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password, // column name is "password" in the existing table
      emailVerified: row.emailVerified === 1,
      failedLoginCount: row.failedLoginCount ?? 0,
      lastLoginAt: row.lastLoginAt ?? null,
      createdAt: row.createdAt,
    };
  }
}
