/**
 * Per-session CSRF token middleware.
 *
 * This is the real-token leg of arf-map's CSRF defence. The existing
 * `X-Requested-With: XMLHttpRequest` header check in server/index.ts stays as
 * a belt-and-braces preflight; this middleware adds a per-session random token
 * that the FE must echo back as `X-CSRF-Token` on every state-changing call.
 *
 * Contract.
 *   1. The token lives on the session as `req.session.csrfToken` — a 32-byte
 *      hex string generated lazily on first read.
 *   2. The FE reads the token from the body of `/api/facility/me` or
 *      `/api/jobseeker/me` (the AuthContext rehydration call).
 *   3. The FE sends it back on POST/PUT/PATCH/DELETE under `/api/*` via the
 *      `X-CSRF-Token` request header. Missing or mismatching tokens get 403.
 *   4. GET / HEAD / OPTIONS are skipped (no state change → no CSRF risk).
 *   5. `/api/billing/webhook` is bypassed because Stripe cannot send a session
 *      cookie or our custom header. The route is also mounted before the
 *      session middleware with `express.raw()`; this bypass guards against
 *      future reordering.
 *
 * Why not use `csurf`?
 *   The csurf package is deprecated upstream, and our threat model is narrow:
 *   we only need to gate authenticated state-changing API calls. Rolling a
 *   ~40-line middleware against the session store is simpler and keeps our
 *   dependency footprint small.
 */
import type { Request, Response, NextFunction } from "express";
import { randomBytes, timingSafeEqual } from "crypto";

declare module "express-session" {
  interface SessionData {
    csrfToken?: string;
  }
}

const TOKEN_BYTE_LENGTH = 32;
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/** Paths that must bypass the CSRF check. The Stripe webhook is the canonical
 *  one — Stripe signs the request body but cannot send our session cookie. */
const BYPASS_PATHS = new Set<string>([
  "/api/billing/webhook",
]);

/**
 * Returns the session's CSRF token, lazily generating a new one if absent.
 * Safe to call from any request handler that already has a session.
 */
export function getOrCreateCsrfToken(req: Request): string {
  if (!req.session) {
    // express-session guarantees this is set after the session middleware,
    // but the type allows undefined. Bail loudly in dev if we get here.
    throw new Error("getOrCreateCsrfToken called before session middleware");
  }
  if (!req.session.csrfToken) {
    req.session.csrfToken = randomBytes(TOKEN_BYTE_LENGTH).toString("hex");
  }
  return req.session.csrfToken;
}

/**
 * Constant-time string equality. timingSafeEqual throws on length mismatch,
 * so we guard with a length compare first and pad-fail when the lengths
 * disagree (preserves constant-time semantics from the caller's perspective).
 */
function safeEqualStrings(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  return timingSafeEqual(aBuf, bBuf);
}

/**
 * Express middleware that enforces CSRF token validation on state-changing
 * `/api/*` requests. Mount it AFTER the session middleware and BEFORE any
 * route handlers.
 */
export function csrfTokenMiddleware() {
  return function csrfTokenCheck(req: Request, res: Response, next: NextFunction) {
    // Bypass list — Stripe webhook and any future server-to-server callbacks.
    if (BYPASS_PATHS.has(req.path)) return next();

    const method = req.method.toUpperCase();
    // Safe methods don't mutate state — skip them. We still allow them to
    // generate the token (lazy mint happens whenever /me is hit).
    if (!STATE_CHANGING_METHODS.has(method)) return next();

    // Only gate the JSON API. Vite HMR, static assets, etc. are out of scope.
    if (!req.path.startsWith("/api/")) return next();

    const sessionToken = req.session?.csrfToken;
    const headerToken = req.headers["x-csrf-token"];
    const headerValue = Array.isArray(headerToken) ? headerToken[0] : headerToken;

    if (!sessionToken || typeof headerValue !== "string" || headerValue.length === 0) {
      return res.status(403).json({
        code: "CSRF_TOKEN_INVALID",
        message: "CSRF validation failed",
      });
    }

    if (!safeEqualStrings(sessionToken, headerValue)) {
      return res.status(403).json({
        code: "CSRF_TOKEN_INVALID",
        message: "CSRF validation failed",
      });
    }

    return next();
  };
}
