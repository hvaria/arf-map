import rateLimit from "express-rate-limit";
import type { Request } from "express";

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

/**
 * Rate-limit billing mutation endpoints (`POST /api/billing/checkout` and
 * `POST /api/billing/portal`). Each call mints a Stripe API session; an
 * authenticated abuser or buggy retry loop could spam Stripe's rate limits
 * and degrade billing for everyone. Keyed by the authenticated facility
 * account id — the routes mount `requireFacilityAuth` BEFORE this limiter,
 * so `req.user` is guaranteed present here (unauthenticated requests are
 * 401'd before they ever reach the limiter).
 */
export const billingRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    code: "RATE_LIMITED",
    message: "Too many billing requests. Please wait a few minutes.",
  },
  keyGenerator: (req: Request) => {
    const userId = (req.user as { id?: number } | undefined)?.id;
    // Fail-closed: if requireFacilityAuth somehow let an unauthenticated
    // request through, return a single bucket key so abuse is bounded
    // rather than dispersed across spoofable IPs.
    return userId ? `facility:${userId}` : "unauthenticated";
  },
});
