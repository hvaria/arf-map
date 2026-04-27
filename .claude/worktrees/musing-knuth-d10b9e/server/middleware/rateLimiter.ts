import rateLimit from "express-rate-limit";

/**
 * S-03: Rate-limit the password reset flow — 5 attempts per 15 minutes per IP.
 *
 * Applies to both forgot-password (code request) and reset-password (code submission)
 * on both the Facility and Job Seeker portals.
 *
 * trust proxy must be set (see server/index.ts) for accurate IP resolution via
 * X-Forwarded-For on Fly.io.
 */
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5,
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false,
  message: {
    message: "Too many requests. Please wait 15 minutes before trying again.",
  },
  // Count all attempts (not just failed ones) to prevent enumeration via timing
  skipSuccessfulRequests: false,
});
