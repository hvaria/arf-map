import { Router } from "express";
import { z } from "zod";
import { AuthService } from "../services/authService";
import { SqliteJobSeekerRepository } from "../repositories/sqlite/sqliteJobSeekerRepository";
import { requireJobSeekerAuth } from "../middleware/requireJobSeekerAuth";
import { sendPasswordResetEmail } from "../email";
import { sqlite } from "../db/index";

// ── Dependency wiring ────────────────────────────────────────────────────────
// To replace SQLite with Postgres or an external IdP, swap the repository or
// service here.  Nothing else in the codebase needs to change.
const repo = new SqliteJobSeekerRepository();
const authService = new AuthService(repo);

// ── Validation schemas ───────────────────────────────────────────────────────
const loginSchema = z.object({
  email: z
    .string({ required_error: "Email is required." })
    .email("Please enter a valid email address."),
  password: z
    .string({ required_error: "Password is required." })
    .min(1, "Password is required."),
  rememberMe: z.boolean().optional(),
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
});

const resetPasswordSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
  token: z.string().length(6, "Code must be 6 digits."),
  newPassword: z.string().min(8, "Password must be at least 8 characters."),
});

// ── Router ───────────────────────────────────────────────────────────────────
export const jobseekerAuthRouter = Router();

/**
 * POST /api/jobseeker/login
 *
 * Authenticates a job seeker with email + password.
 * On success, stores the account id in the session and returns the public profile.
 *
 * Extension point — OAuth / SSO:
 *   Add POST /api/jobseeker/auth/callback here to receive OAuth tokens,
 *   verify them via an ExternalIdentityProviderAdapter, then set the session
 *   the same way this route does.
 */
jobseekerAuthRouter.post("/login", async (req, res, next) => {
  try {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }

    const { email, password, rememberMe } = parsed.data;
    const ip = (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0].trim()
      ?? req.socket.remoteAddress
      ?? null;

    const result = await authService.login(email, password, ip);

    if (!result.ok) {
      const statusMap = {
        INVALID_CREDENTIALS: 401,
        EMAIL_NOT_VERIFIED: 403,
        ACCOUNT_LOCKED: 403,
      } as const;

      const messageMap = {
        INVALID_CREDENTIALS: "Invalid email or password.",
        EMAIL_NOT_VERIFIED: "Please verify your email address before signing in.",
        ACCOUNT_LOCKED:
          "Your account has been temporarily locked due to too many failed login attempts. Please contact support.",
      } as const;

      return res.status(statusMap[result.code]).json({
        message: messageMap[result.code],
        code: result.code,
      });
    }

    // Extend session lifetime when "Remember me" is checked.
    if (rememberMe) {
      req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    }

    req.session.jobSeekerId = result.account.id;
    req.session.save((saveErr) => {
      if (saveErr) return next(saveErr);
      return res.json(result.account);
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/jobseeker/logout
 *
 * Clears the session.  Always returns 200 even if no session existed,
 * to keep the client state consistent.
 */
jobseekerAuthRouter.post("/logout", (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return next(err);
    res.clearCookie("connect.sid");
    res.json({ ok: true });
  });
});

/**
 * GET /api/jobseeker/me
 *
 * Returns the authenticated job seeker's public profile.
 * Used by the frontend AuthContext to rehydrate the session on page load.
 */
jobseekerAuthRouter.get("/me", requireJobSeekerAuth, async (req, res, next) => {
  try {
    const profile = await authService.getProfile(req.session.jobSeekerId!);
    if (!profile) {
      req.session.destroy(() => {});
      return res.status(401).json({ message: "Session is no longer valid." });
    }
    return res.json(profile);
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/jobseeker/dashboard
 *
 * Protected example endpoint.  In production this would return aggregated
 * profile data, application status, recommended jobs, etc.
 *
 * Extension point — Snowflake / warehouse read layer:
 *   Replace the hardcoded stub with a WarehouseJobSeekerRepository call that
 *   reads enriched candidate data from Snowflake while writing still goes to
 *   the transactional SQLite (or Postgres) database.
 */
jobseekerAuthRouter.get("/dashboard", requireJobSeekerAuth, async (req, res, next) => {
  try {
    const profile = await authService.getProfile(req.session.jobSeekerId!);
    if (!profile) {
      return res.status(401).json({ message: "Session is no longer valid." });
    }
    return res.json({
      account: profile,
      // Future: applicationCount, recommendedJobs, profileCompleteness, etc.
    });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/jobseeker/forgot-password
 *
 * Initiates a password reset.  Always returns { emailSent: true } regardless
 * of whether the email exists — prevents account enumeration.
 */
jobseekerAuthRouter.post("/forgot-password", async (req, res, next) => {
  try {
    const parsed = forgotPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }

    const result = await authService.initiatePasswordReset(parsed.data.email);
    if (result) {
      await sendPasswordResetEmail(result.email, result.token);
    }

    return res.json({ emailSent: true });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/jobseeker/reset-password
 *
 * Validates the reset OTP, updates the password, clears any account lockout,
 * and invalidates all existing sessions for the account.
 */
jobseekerAuthRouter.post("/reset-password", async (req, res, next) => {
  try {
    const parsed = resetPasswordSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }

    const { email, token, newPassword } = parsed.data;
    const result = await authService.completePasswordReset(email, token, newPassword);

    if (!result.ok) {
      return res.status(400).json({
        message: "Code is invalid or has already been used. Please request a new one.",
      });
    }

    // Invalidate all active sessions for this account.
    sqlite
      .prepare("DELETE FROM sessions WHERE json_extract(sess, '$.jobSeekerId') = ?")
      .run(result.accountId);

    return res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
