import type { Request, Response, NextFunction } from "express";
import { getOrCreateCsrfToken } from "./csrfToken";

// Extend the express-session type once, here, so all files that import this
// middleware automatically get the typed session field.
declare module "express-session" {
  interface SessionData {
    jobSeekerId?: number;
  }
}

/**
 * Express middleware that gates routes behind job seeker authentication.
 *
 * If the session does not contain a valid jobSeekerId the request is
 * rejected with 401.  Downstream route handlers can safely access
 * req.session.jobSeekerId! without a null check.
 *
 * Phase 1 hardening: the 401 response includes a freshly-minted CSRF token
 * so the FE can submit pre-auth POSTs (login, register, verify-email,
 * forgot-password) right after hitting any gated GET. Without this, the
 * /api/jobseeker/me bootstrap call would return 401 with no token and the
 * very next /api/jobseeker/login POST would 403 CSRF_TOKEN_INVALID — the
 * chicken-and-egg problem documented in client/src/lib/csrfToken.ts.
 *
 * Extension point — External Identity Provider:
 *   If you add SSO / OAuth, update this middleware to also accept a valid
 *   JWT in the Authorization header (Bearer token) and verify it against your
 *   IdP's JWKS endpoint.  The downstream handlers do not need to change.
 */
export function requireJobSeekerAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (!req.session.jobSeekerId) {
    res.status(401).json({
      message: "Authentication required.",
      csrfToken: getOrCreateCsrfToken(req),
    });
    return;
  }
  next();
}
