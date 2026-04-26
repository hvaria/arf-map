import { eq, sql } from "drizzle-orm";
import { db } from "../../db/index";
import { sqlite, usingPostgres, pool } from "../../db/index";
import { jobSeekerAccounts } from "@shared/schema";
import type {
  JobSeekerAccount,
  JobSeekerRepository,
  LoginAttemptEntry,
} from "../jobSeekerRepository";

/**
 * Maps a raw pg pool.query row (snake_case, bigints as strings) to the domain model.
 * Bigint columns arrive as strings from node-postgres — Number() converts them safely
 * for the timestamp range we use (ms since epoch, well within float64 precision).
 */
function pgRowToModel(row: Record<string, unknown>): JobSeekerAccount {
  return {
    id: row.id as number,
    email: row.email as string,
    passwordHash: row.password as string,
    emailVerified: Boolean(row.email_verified),
    failedLoginCount: (row.failed_login_count as number) ?? 0,
    lastLoginAt: row.last_login_at != null ? Number(row.last_login_at) : null,
    createdAt: Number(row.created_at),
    verificationToken: (row.verification_token as string | null) ?? null,
    verificationExpiry: row.verification_expiry != null ? Number(row.verification_expiry) : null,
  };
}

export class SqliteJobSeekerRepository implements JobSeekerRepository {
  async findById(id: number): Promise<JobSeekerAccount | null> {
    if (usingPostgres) {
      const { rows } = await pool!.query(
        `SELECT * FROM job_seeker_accounts WHERE id = $1 LIMIT 1`,
        [id]
      );
      return rows[0] ? pgRowToModel(rows[0]) : null;
    }
    const rows = await db
      .select()
      .from(jobSeekerAccounts)
      .where(eq(jobSeekerAccounts.id, id))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<JobSeekerAccount | null> {
    if (usingPostgres) {
      const { rows } = await pool!.query(
        `SELECT * FROM job_seeker_accounts WHERE email = $1 LIMIT 1`,
        [email.toLowerCase()]
      );
      return rows[0] ? pgRowToModel(rows[0]) : null;
    }
    const rows = await db
      .select()
      .from(jobSeekerAccounts)
      .where(eq(jobSeekerAccounts.email, email.toLowerCase()))
      .limit(1);
    return rows[0] ? this.toModel(rows[0]) : null;
  }

  async incrementFailedLoginCount(id: number): Promise<void> {
    if (usingPostgres) {
      await pool!.query(
        `UPDATE job_seeker_accounts SET failed_login_count = failed_login_count + 1, updated_at = $1 WHERE id = $2`,
        [Date.now(), id]
      );
      return;
    }
    await db
      .update(jobSeekerAccounts)
      .set({ failedLoginCount: sql`failed_login_count + 1`, updatedAt: Date.now() })
      .where(eq(jobSeekerAccounts.id, id))
      .run();
  }

  async resetFailedLoginCount(id: number): Promise<void> {
    if (usingPostgres) {
      await pool!.query(
        `UPDATE job_seeker_accounts SET failed_login_count = 0, updated_at = $1 WHERE id = $2`,
        [Date.now(), id]
      );
      return;
    }
    await db
      .update(jobSeekerAccounts)
      .set({ failedLoginCount: 0, updatedAt: Date.now() })
      .where(eq(jobSeekerAccounts.id, id))
      .run();
  }

  async updateLastLoginAt(id: number, timestamp: number): Promise<void> {
    if (usingPostgres) {
      await pool!.query(
        `UPDATE job_seeker_accounts SET last_login_at = $1, updated_at = $1 WHERE id = $2`,
        [timestamp, id]
      );
      return;
    }
    await db
      .update(jobSeekerAccounts)
      .set({ lastLoginAt: timestamp, updatedAt: timestamp })
      .where(eq(jobSeekerAccounts.id, id))
      .run();
  }

  async logLoginAttempt(entry: LoginAttemptEntry): Promise<void> {
    if (usingPostgres) {
      await pool!.query(
        `INSERT INTO login_attempts (email, ip, success, failure_reason, attempted_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [entry.email, entry.ip ?? null, entry.success, entry.failureReason ?? null, Date.now()]
      );
      return;
    }
    sqlite!
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

  async savePasswordResetToken(id: number, token: string, expiry: number): Promise<void> {
    if (usingPostgres) {
      await pool!.query(
        `UPDATE job_seeker_accounts SET verification_token = $1, verification_expiry = $2, updated_at = $3 WHERE id = $4`,
        [token, expiry, Date.now(), id]
      );
      return;
    }
    await db
      .update(jobSeekerAccounts)
      .set({ verificationToken: token, verificationExpiry: expiry, updatedAt: Date.now() })
      .where(eq(jobSeekerAccounts.id, id))
      .run();
  }

  async clearPasswordResetToken(id: number): Promise<void> {
    if (usingPostgres) {
      await pool!.query(
        `UPDATE job_seeker_accounts SET verification_token = NULL, verification_expiry = NULL, updated_at = $1 WHERE id = $2`,
        [Date.now(), id]
      );
      return;
    }
    await db
      .update(jobSeekerAccounts)
      .set({ verificationToken: null, verificationExpiry: null, updatedAt: Date.now() })
      .where(eq(jobSeekerAccounts.id, id))
      .run();
  }

  async updatePassword(id: number, hashedPassword: string): Promise<void> {
    if (usingPostgres) {
      await pool!.query(
        `UPDATE job_seeker_accounts SET password = $1, updated_at = $2 WHERE id = $3`,
        [hashedPassword, Date.now(), id]
      );
      return;
    }
    await db
      .update(jobSeekerAccounts)
      .set({ password: hashedPassword, updatedAt: Date.now() })
      .where(eq(jobSeekerAccounts.id, id))
      .run();
  }

  private toModel(
    row: typeof jobSeekerAccounts.$inferSelect,
  ): JobSeekerAccount {
    return {
      id: row.id,
      email: row.email,
      passwordHash: row.password,
      emailVerified: !!row.emailVerified,
      failedLoginCount: row.failedLoginCount ?? 0,
      lastLoginAt: row.lastLoginAt ?? null,
      createdAt: row.createdAt,
      verificationToken: row.verificationToken ?? null,
      verificationExpiry: row.verificationExpiry ?? null,
    };
  }
}
