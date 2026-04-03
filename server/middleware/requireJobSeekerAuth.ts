import type { Request, Response, NextFunction } from "express";

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
    res.status(401).json({ message: "Authentication required." });
    return;
  }
  next();
}
