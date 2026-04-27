import { comparePassword, hashPassword } from "../auth";
import { randomInt, createHash, timingSafeEqual } from "crypto";
import type { JobSeekerRepository } from "../repositories/jobSeekerRepository";

// ── Token helpers ─────────────────────────────────────────────────────────────
// S-02: OTP tokens are hashed with SHA-256 before being stored in the database.
// The raw token is sent to the user via email; only the hash is persisted.
// This means a database read cannot reveal a usable reset code.

function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

/**
 * Constant-time comparison of a raw user-supplied token against a stored SHA-256 hex hash.
 * Returns false if the stored value is not a valid 64-char hex string (e.g. legacy plain-text).
 */
function safeCompareToken(storedHash: string, rawToken: string): boolean {
  if (storedHash.length !== 64) return false; // not a SHA-256 hex hash — reject
  const stored = Buffer.from(storedHash, "hex");
  const provided = Buffer.from(hashToken(rawToken), "hex");
  if (stored.length !== provided.length) return false;
  return timingSafeEqual(stored, provided);
}

/** Maximum consecutive failures before we signal a locked account. */
const MAX_FAILED_ATTEMPTS = 10;

export interface JobSeekerPublicProfile {
  id: number;
  email: string;
}

export type LoginResult =
  | { ok: true; account: JobSeekerPublicProfile }
  | { ok: false; code: "INVALID_CREDENTIALS" | "EMAIL_NOT_VERIFIED" | "ACCOUNT_LOCKED" };

export type PasswordResetResult =
  | { ok: true; accountId: number }
  | { ok: false; code: "INVALID_OR_EXPIRED" };

/**
 * AuthService — pure business logic for job seeker authentication.
 *
 * This class knows nothing about HTTP, SQLite, or session management.
 * It depends only on the JobSeekerRepository interface, so the same
 * service works with any future storage backend.
 *
 * Extension points:
 *   - SSO / OAuth:  add an authenticateWithProvider(token) method that maps
 *     external identity claims to JobSeekerPublicProfile without touching this
 *     method or the repository.
 *   - MFA / OTP second factor:  inject an OtpService dependency and check it
 *     after password verification succeeds.
 *   - Password reset:  add initiatePasswordReset(email) and
 *     completePasswordReset(token, newPassword) methods here.
 */
export class AuthService {
  constructor(private readonly repo: JobSeekerRepository) {}

  async login(
    email: string,
    password: string,
    ip: string | null,
  ): Promise<LoginResult> {
    const account = await this.repo.findByEmail(email);

    if (!account) {
      // Log the attempt even for unknown emails to help detect enumeration.
      await this.repo.logLoginAttempt({
        email,
        ip,
        success: false,
        failureReason: "account_not_found",
      });
      // Return the same message as wrong-password to prevent email enumeration.
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }

    if (account.failedLoginCount >= MAX_FAILED_ATTEMPTS) {
      await this.repo.logLoginAttempt({
        email,
        ip,
        success: false,
        failureReason: "account_locked",
      });
      return { ok: false, code: "ACCOUNT_LOCKED" };
    }

    const passwordValid = await comparePassword(password, account.passwordHash);

    if (!passwordValid) {
      await this.repo.incrementFailedLoginCount(account.id);
      await this.repo.logLoginAttempt({
        email,
        ip,
        success: false,
        failureReason: "wrong_password",
      });
      return { ok: false, code: "INVALID_CREDENTIALS" };
    }

    if (!account.emailVerified) {
      await this.repo.logLoginAttempt({
        email,
        ip,
        success: false,
        failureReason: "email_not_verified",
      });
      return { ok: false, code: "EMAIL_NOT_VERIFIED" };
    }

    // Successful login — reset failure counter and record timestamp.
    await Promise.all([
      this.repo.resetFailedLoginCount(account.id),
      this.repo.updateLastLoginAt(account.id, Date.now()),
      this.repo.logLoginAttempt({ email, ip, success: true }),
    ]);

    return {
      ok: true,
      account: { id: account.id, email: account.email },
    };
  }

  async getProfile(id: number): Promise<JobSeekerPublicProfile | null> {
    const account = await this.repo.findById(id);
    if (!account) return null;
    return { id: account.id, email: account.email };
  }

  /**
   * Begins a password reset flow for a job seeker.
   * Returns the generated token and email so the caller can send the reset email,
   * or null if the email is unknown / unverified (silent to prevent enumeration).
   */
  async initiatePasswordReset(
    email: string,
  ): Promise<{ token: string; email: string } | null> {
    const account = await this.repo.findByEmail(email);
    // Silent no-op for unknown or unverified accounts — prevents email enumeration.
    if (!account || !account.emailVerified) return null;

    const token = String(randomInt(100000, 999999));
    const expiry = Date.now() + 15 * 60 * 1000;
    // S-02: store hash, send raw token via email
    await this.repo.savePasswordResetToken(account.id, hashToken(token), expiry);
    return { token, email: account.email };
  }

  /**
   * Completes a password reset by validating the OTP, updating the password,
   * clearing the token, and resetting any account lockout.
   */
  async completePasswordReset(
    email: string,
    token: string,
    newPassword: string,
  ): Promise<PasswordResetResult> {
    const account = await this.repo.findByEmail(email);
    if (!account) return { ok: false, code: "INVALID_OR_EXPIRED" };

    // S-02: constant-time hash comparison (reject plain-text legacy tokens automatically)
    if (!account.verificationToken || !safeCompareToken(account.verificationToken, token)) {
      return { ok: false, code: "INVALID_OR_EXPIRED" };
    }
    if (!account.verificationExpiry || Date.now() > account.verificationExpiry) {
      return { ok: false, code: "INVALID_OR_EXPIRED" };
    }

    const hashed = await hashPassword(newPassword);
    await Promise.all([
      this.repo.updatePassword(account.id, hashed),
      this.repo.clearPasswordResetToken(account.id),
      this.repo.resetFailedLoginCount(account.id),
    ]);

    return { ok: true, accountId: account.id };
  }
}
