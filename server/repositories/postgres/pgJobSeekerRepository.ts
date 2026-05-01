import { pool } from "../../db/index";
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

export class PgJobSeekerRepository implements JobSeekerRepository {
  async findById(id: number): Promise<JobSeekerAccount | null> {
    const { rows } = await pool.query(
      `SELECT * FROM job_seeker_accounts WHERE id = $1 LIMIT 1`,
      [id]
    );
    return rows[0] ? pgRowToModel(rows[0]) : null;
  }

  async findByEmail(email: string): Promise<JobSeekerAccount | null> {
    const { rows } = await pool.query(
      `SELECT * FROM job_seeker_accounts WHERE email = $1 LIMIT 1`,
      [email.toLowerCase()]
    );
    return rows[0] ? pgRowToModel(rows[0]) : null;
  }

  async incrementFailedLoginCount(id: number): Promise<void> {
    await pool.query(
      `UPDATE job_seeker_accounts SET failed_login_count = failed_login_count + 1, updated_at = $1 WHERE id = $2`,
      [Date.now(), id]
    );
  }

  async resetFailedLoginCount(id: number): Promise<void> {
    await pool.query(
      `UPDATE job_seeker_accounts SET failed_login_count = 0, updated_at = $1 WHERE id = $2`,
      [Date.now(), id]
    );
  }

  async updateLastLoginAt(id: number, timestamp: number): Promise<void> {
    await pool.query(
      `UPDATE job_seeker_accounts SET last_login_at = $1, updated_at = $1 WHERE id = $2`,
      [timestamp, id]
    );
  }

  async logLoginAttempt(entry: LoginAttemptEntry): Promise<void> {
    await pool.query(
      `INSERT INTO login_attempts (email, ip, success, failure_reason, attempted_at)
       VALUES ($1, $2, $3, $4, $5)`,
      [entry.email, entry.ip ?? null, entry.success, entry.failureReason ?? null, Date.now()]
    );
  }

  async savePasswordResetToken(id: number, token: string, expiry: number): Promise<void> {
    await pool.query(
      `UPDATE job_seeker_accounts SET verification_token = $1, verification_expiry = $2, updated_at = $3 WHERE id = $4`,
      [token, expiry, Date.now(), id]
    );
  }

  async clearPasswordResetToken(id: number): Promise<void> {
    await pool.query(
      `UPDATE job_seeker_accounts SET verification_token = NULL, verification_expiry = NULL, updated_at = $1 WHERE id = $2`,
      [Date.now(), id]
    );
  }

  async updatePassword(id: number, hashedPassword: string): Promise<void> {
    await pool.query(
      `UPDATE job_seeker_accounts SET password = $1, updated_at = $2 WHERE id = $3`,
      [hashedPassword, Date.now(), id]
    );
  }
}
