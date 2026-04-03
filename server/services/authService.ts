import { comparePassword } from "../auth";
import type { JobSeekerRepository } from "../repositories/jobSeekerRepository";

/** Maximum consecutive failures before we signal a locked account. */
const MAX_FAILED_ATTEMPTS = 10;

export interface JobSeekerPublicProfile {
  id: number;
  email: string;
}

export type LoginResult =
  | { ok: true; account: JobSeekerPublicProfile }
  | { ok: false; code: "INVALID_CREDENTIALS" | "EMAIL_NOT_VERIFIED" | "ACCOUNT_LOCKED" };

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
}
