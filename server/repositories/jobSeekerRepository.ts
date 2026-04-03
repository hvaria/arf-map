/**
 * JobSeekerRepository — domain interface for all job seeker data access.
 *
 * The auth service and routes depend ONLY on this interface, never on a
 * concrete database implementation.  To migrate from SQLite to PostgreSQL or
 * to add a Snowflake-backed read layer, implement this interface in a new
 * class and inject it wherever SqliteJobSeekerRepository is currently used.
 *
 * Extension points (future adapters):
 *   - PostgresJobSeekerRepository    → drizzle-orm/node-postgres
 *   - WarehouseJobSeekerRepository   → read-through cache from Snowflake
 *   - ExternalIdpAdapter             → maps OAuth/SAML claims to this shape
 */

export interface JobSeekerAccount {
  id: number;
  email: string;
  /** Scrypt-hashed password in the format "{hash}.{salt}" */
  passwordHash: string;
  emailVerified: boolean;
  failedLoginCount: number;
  lastLoginAt: number | null;
  createdAt: number;
}

export interface LoginAttemptEntry {
  email: string;
  ip: string | null;
  success: boolean;
  failureReason?: string;
}

export interface JobSeekerRepository {
  /** Look up an account by primary key. */
  findById(id: number): Promise<JobSeekerAccount | null>;

  /** Look up an account by email address (case-insensitive lookup is handled here). */
  findByEmail(email: string): Promise<JobSeekerAccount | null>;

  /** Increment the consecutive failed login counter. */
  incrementFailedLoginCount(id: number): Promise<void>;

  /** Reset the failed login counter to zero after a successful login. */
  resetFailedLoginCount(id: number): Promise<void>;

  /** Record the timestamp of the most recent successful login. */
  updateLastLoginAt(id: number, timestamp: number): Promise<void>;

  /** Write an audit entry for each login attempt (success or failure). */
  logLoginAttempt(entry: LoginAttemptEntry): Promise<void>;
}
