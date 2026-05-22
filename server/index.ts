import "dotenv/config";
// Sentry must be initialised BEFORE Express (and any module Sentry
// instruments — http, fs, express) so the auto-instrumentation hooks attach
// to the original implementations. Keep this import + init pair at the top.
import { initSentry, captureExceptionFromRequest } from "./observability/sentry";
initSentry();
import express, { type Request, Response, NextFunction } from "express";
import compression from "compression";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import { storage } from "./storage";
import { comparePassword } from "./auth";
import { pool } from "./db/index";
import connectPgSimple from "connect-pg-simple";
import { getCachedFacilities, autoSeedIfEmpty } from "./services/facilitiesService";
import { opsRouter } from "./ops/opsRouter";
import { auditorRouter } from "./ops/auditorRouter";
import { bootstrapOpsSchema } from "./ops/opsStorage";
import { bootstrapNotesSchema } from "./ops/notesStorage";
import { bootstrapTrackersSchema } from "./trackers/trackerStorage";
// trackerRouter is mounted under opsRouter in server/ops/opsRouter.ts so it
// inherits requireFacilityAuth — see M4 fix.
import { bootstrapMainSchema } from "./db/bootstrap";
import { stripeWebhookHandler } from "./billing/webhookHandler";
import { startDailySummaryScheduler } from "./ops/dailySummaryScheduler";
import { startObligationExpireScheduler } from "./ops/obligationExpireScheduler";
import { type SessionUser, toSessionUser } from "./types/session-user";
import { csrfTokenMiddleware } from "./middleware/csrfToken";
import { requirePendingLegalAcceptancesAuto } from "./lib/legal";

/** Maximum consecutive failed logins before a facility account is locked. */
const MAX_FACILITY_FAILED_ATTEMPTS = 10;

// Express.User is narrowed to SessionUser — strips the password hash + OTP
// columns so handlers cannot accidentally serialise them into responses. The
// full FacilityAccount row is still reachable via storage.getFacilityAccount.
declare global {
  namespace Express {
    interface User extends SessionUser {}
  }
}

const app = express();
const httpServer = createServer(app);

// fly.io (and most reverse proxies) terminate TLS at the edge and forward HTTP
// internally. Without this, req.secure = false and express-session silently skips
// setting the Set-Cookie header when cookie.secure = true, breaking all sessions.
app.set('trust proxy', 1);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

// gzip/brotli-style compression for all responses. Cuts the /api/facilities
// JSON payload (and the slim /api/facilities/pins payload) by ~5× on the wire.
app.use(compression());

// ── Stripe webhook (Phase 1) ──────────────────────────────────────────────────
// MUST be mounted BEFORE express.json() — Stripe's signature verification
// requires the raw request body Buffer. Once express.json() parses the body
// the original bytes are gone and verification will fail. Also bypasses the
// CSRF guard below (Stripe doesn't send X-Requested-With).
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  stripeWebhookHandler,
);

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

// ── Session store: PostgreSQL via connect-pg-simple ───────────────────────────
const PgSessionStore = connectPgSimple(session);
const sessionStore = new PgSessionStore({
  pool,
  tableName: "session",
  createTableIfMissing: true,
});

if (process.env.NODE_ENV === "production" && !process.env.SESSION_SECRET) {
  throw new Error("SESSION_SECRET environment variable is required in production");
}

// ── Split session cookies by app surface ─────────────────────────────────────
// Facility-owner sessions and job-seeker sessions are independent: each has
// its own cookie name so a logout in one portal does not invalidate the other
// in the same browser. Both cookies use the same Postgres store (one row per
// session) — only the cookie identity differs.
const SESSION_SECRET =
  process.env.SESSION_SECRET || "arf-map-facility-portal-secret-dev-only";
const SESSION_COOKIE_BASE = {
  secure: process.env.NODE_ENV === "production",
  httpOnly: true,
  sameSite: "lax" as const,
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days default; overridable per-session
  path: "/",
};

export const FACILITY_SESSION_COOKIE = "arf_facility_sid";
export const SEEKER_SESSION_COOKIE = "arf_seeker_sid";

const facilitySession = session({
  name: FACILITY_SESSION_COOKIE,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: { ...SESSION_COOKIE_BASE },
});

const seekerSession = session({
  name: SEEKER_SESSION_COOKIE,
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  store: sessionStore,
  cookie: { ...SESSION_COOKIE_BASE },
});

// Route requests to the correct session middleware by URL prefix. The
// job-seeker portal lives under /api/jobseeker; everything else (facility
// admin, ops, billing, static asset hits that happen to land here) gets the
// facility session.
app.use((req, res, next) => {
  if (req.path.startsWith("/api/jobseeker")) {
    return seekerSession(req, res, next);
  }
  return facilitySession(req, res, next);
});

// Passport.session() deserialises req.user from the session cookie. The
// job-seeker portal does NOT use passport (it sets req.session.jobSeekerId
// directly), so passport.session() is a no-op for that branch — which is
// exactly what we want.
app.use(passport.initialize());
app.use(passport.session());

// ── S-01: CSRF protection ─────────────────────────────────────────────────────
// Require the custom X-Requested-With header on all state-changing API requests.
// Browsers cannot send custom headers in cross-site form submissions, so this
// stops CSRF attacks that rely on HTML forms or simple cross-origin fetches.
// All frontend mutations flow through apiRequest() in queryClient.ts, which
// sets this header automatically (including Capacitor native builds).
app.use((req: Request, res: Response, next: NextFunction) => {
  // Stripe webhook requests originate from Stripe's servers (not a browser)
  // and cannot send our custom X-Requested-With header. The route is also
  // mounted above this middleware with express.raw() — but if request
  // matching order ever changes, this bypass keeps the webhook reachable.
  if (req.path === "/api/billing/webhook") return next();

  const method = req.method.toUpperCase();
  if (
    ["POST", "PUT", "DELETE", "PATCH"].includes(method) &&
    req.path.startsWith("/api/")
  ) {
    const xrw = req.headers["x-requested-with"];
    if (!xrw || (xrw as string).toLowerCase() !== "xmlhttprequest") {
      return res.status(403).json({ message: "CSRF validation failed." });
    }
  }
  next();
});

// ── S-01b: Per-session CSRF token ─────────────────────────────────────────────
// Real CSRF token sourced from req.session.csrfToken. The FE reads the token
// once per login from /api/facility/me or /api/jobseeker/me and replays it via
// the X-CSRF-Token header on every mutation. See server/middleware/csrfToken.ts.
app.use(csrfTokenMiddleware());

// ── Phase 4: Legal acceptance gate ────────────────────────────────────────────
// Auto-detecting variant. Sniffs req.user (facility) vs req.session.jobSeekerId
// (job seeker) and returns 409 LEGAL_REACCEPT_REQUIRED on state-changing
// requests if the user's recorded acceptances are out of date vs the current
// LEGAL_DOCS versions. GETs pass through so the FE blocking modal can load
// the legal markdown + /me payloads it needs to render. Anonymous requests
// pass through (the upstream auth guards surface canonical 401s). Mounted
// scoped to /api/* so the Stripe webhook (mounted above the JSON parser) and
// static assets are unaffected. Runs AFTER CSRF so a missing X-Requested-With
// surfaces as 403 (the canonical CSRF error) before we touch the DB.
app.use("/api", requirePendingLegalAcceptancesAuto());

// ── F-01: Facility account lockout — Passport LocalStrategy ───────────────────
passport.use(
  new LocalStrategy(async (username, password, done) => {
    try {
      const account = await storage.getFacilityAccountByUsername(username);
      if (!account) return done(null, false, { message: "Invalid credentials" });

      // Check lockout before password comparison (prevent timing oracle)
      if ((account.failedLoginCount ?? 0) >= MAX_FACILITY_FAILED_ATTEMPTS) {
        return done(null, false, { message: "ACCOUNT_LOCKED" });
      }

      const valid = await comparePassword(password, account.password);
      if (!valid) {
        await storage.updateFacilityAccount(account.id, {
          failedLoginCount: (account.failedLoginCount ?? 0) + 1,
        });
        return done(null, false, { message: "Invalid credentials" });
      }

      if (!account.emailVerified) return done(null, false, { message: "EMAIL_NOT_VERIFIED" });

      // Successful login — reset failure counter
      await storage.updateFacilityAccount(account.id, { failedLoginCount: 0 });
      return done(null, account);
    } catch (err) {
      return done(err);
    }
  }),
);

passport.serializeUser((user, done) => {
  // user here is whatever the LocalStrategy passed to done() — either the raw
  // FacilityAccount (on login) or the already-narrowed SessionUser (on
  // subsequent deserialise round-trips). Both shapes carry .id.
  done(null, (user as { id: number }).id);
});

passport.deserializeUser(async (id: number, done) => {
  try {
    const account = await storage.getFacilityAccount(id);
    if (!account) return done(null, false);
    // Strip password + OTP columns before they enter req.user. Anything that
    // genuinely needs the full row can re-fetch via storage.getFacilityAccount.
    done(null, toSessionUser(account));
  } catch (err) {
    done(err);
  }
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  // Request logger: emit only method/path/status/duration. We DO NOT capture
  // response bodies — auth/profile/billing responses contained PII (emails,
  // Stripe last-4, etc.) and ended up in `fly logs` and any drain attached
  // downstream. If a request needs deeper diagnostics, raise it to Sentry.
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    if (!path.startsWith("/api")) return;
    const duration = Date.now() - start;
    log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
  });

  next();
});

(async () => {
  await bootstrapMainSchema();
  await bootstrapOpsSchema();
  await bootstrapNotesSchema();
  await bootstrapTrackersSchema();

  // Mount the Facility Operations Module router before existing routes.
  // The Tracker Module is mounted UNDER opsRouter (at /trackers) so it
  // inherits opsRouter's requireFacilityAuth instead of running auth twice.
  // Effective URL: /api/ops/trackers/... — unchanged for clients.
  //
  // Wave 3 Phase 3.2 — auditor share-link router. Mounted at
  // /api/ops/auditor BEFORE the facility-Passport opsRouter so the
  // prefix matches first; opsRouter's requireFacilityAuth never sees
  // auditor traffic. Auth on the auditor router is requireAuditorToken
  // (a parallel auth path), with blockAuditorMutations enforcing
  // read-only at the middleware layer.
  app.use("/api/ops/auditor", auditorRouter);
  app.use("/api/ops", opsRouter);

  await registerRoutes(httpServer, app);

  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    // Keep console.error for local visibility / `fly logs`. Sentry capture is
    // fire-and-forget — Sentry batches sends, so awaiting here would block
    // the error response. When SENTRY_DSN is unset, this is a no-op.
    console.error("Internal Server Error:", err);
    captureExceptionFromRequest(err, req);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  httpServer.listen(port, "0.0.0.0", () => {
    log(`serving on port ${port}`);
    log(`[email] RESEND_API_KEY set: ${!!process.env.RESEND_API_KEY}`);

    // Auto-seed the facilities DB from CCL CHHS on first run (non-blocking).
    // If already seeded, this is a no-op. Geocoding runs as a background job.
    autoSeedIfEmpty().catch((err) =>
      log(`[facilitiesService] auto-seed error: ${err.message}`),
    );

    // Legacy pre-warm: only runs if DB is already seeded (fast SQLite path).
    if (!process.env.SKIP_PREWARM && !process.env.SKIP_CACHE_PREWARM) {
      getCachedFacilities()
        .then((f) => { if (f.length) log(`[facilitiesService] pre-warmed ${f.length} facilities`); })
        .catch(() => { /* silently skip — autoSeedIfEmpty handles the empty-DB case */ });
    }

    // Wave 3 W14 — daily-summary scheduler. Production only; set
    // DISABLE_DAILY_SUMMARY=1 in staging/test deployments that share a DB
    // with prod so they don't double-fire the cadence email.
    if (process.env.NODE_ENV === "production") {
      startDailySummaryScheduler();
    }

    // Wave 4 Phase 4.1 — obligation auto-expire cron. Production only; set
    // DISABLE_OBLIGATION_EXPIRE=1 in staging/test deployments that share a
    // DB with prod so they don't double-transition rows.
    if (process.env.NODE_ENV === "production") {
      startObligationExpireScheduler();
    }

  });
})();
