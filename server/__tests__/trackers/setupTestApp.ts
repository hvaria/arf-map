/**
 * Shared test harness for the Tracker Module.
 *
 * Builds a minimal Express app that mirrors `server/index.ts` for the
 * surface the tracker tests exercise:
 *   - express.json() body parsing
 *   - express-session with an in-memory MemoryStore (no DB pollution)
 *   - passport.initialize() + passport.session() + LocalStrategy
 *   - the same CSRF guard (X-Requested-With) the real app uses
 *   - opsRouter mounted at /api/ops, which mounts trackerRouter at /trackers
 *
 * The harness does NOT call httpServer.listen — supertest calls the app
 * directly. Callers seed two facility accounts (TEST-FAC-A, TEST-FAC-B)
 * via `seedFacility()` and authenticate via the real login endpoint to
 * obtain a session cookie reusable across requests with `agent`.
 *
 * Cleanup helpers delete only rows tied to the test facility numbers so
 * the suite is rerunnable on a shared dev DB without dropping schema.
 */

// dotenv must run before importing server/db/index — that module throws
// at import-time if DATABASE_URL is unset. Vitest does not auto-load .env.
import "dotenv/config";

import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";

import { storage } from "../../storage";
import { hashPassword, comparePassword } from "../../auth";
import { pool } from "../../db/index";
import { opsRouter } from "../../ops/opsRouter";
import type { FacilityAccount } from "@shared/schema";

export type TestFacility = {
  id: number;
  facilityNumber: string;
  username: string;
  password: string;
  email: string;
};

/**
 * Facility identifiers must be unique per test file because the two
 * tracker test files run in parallel forks and share a single DB. Cleanup
 * is scoped by facility_number; if both files used the same numbers, one
 * file's `afterEach` would delete the other file's in-flight rows.
 *
 * Each test file passes its own constants — see entries.test.ts and
 * security.test.ts.
 */

let cachedApp: Express | null = null;
let passportInitialized = false;

/**
 * Build (or return cached) Express app wired exactly like server/index.ts
 * but without an HTTP listener. Idempotent — first call configures global
 * passport state, later calls reuse it.
 */
export function buildTestApp(): Express {
  if (cachedApp) return cachedApp;

  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use(
    session({
      // MemoryStore keeps test sessions out of the production `session` table.
      secret: "tracker-test-session-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: false,
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 1000,
      },
    }),
  );

  if (!passportInitialized) {
    passport.use(
      "test-local",
      new LocalStrategy(async (username, password, done) => {
        try {
          const account = await storage.getFacilityAccountByUsername(username);
          if (!account) return done(null, false, { message: "Invalid credentials" });
          const ok = await comparePassword(password, account.password);
          if (!ok) return done(null, false, { message: "Invalid credentials" });
          return done(null, account);
        } catch (err) {
          return done(err as Error);
        }
      }),
    );
    passport.serializeUser((user, done) => {
      done(null, (user as FacilityAccount).id);
    });
    passport.deserializeUser(async (id: number, done) => {
      try {
        const account = await storage.getFacilityAccount(id);
        done(null, account ?? false);
      } catch (err) {
        done(err as Error);
      }
    });
    passportInitialized = true;
  }

  app.use(passport.initialize());
  app.use(passport.session());

  // Same CSRF gate as production (server/index.ts). Tracker tests set this
  // header on every state-changing request via supertest.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const m = req.method.toUpperCase();
    if (
      ["POST", "PUT", "DELETE", "PATCH"].includes(m) &&
      req.path.startsWith("/api/")
    ) {
      const xrw = req.headers["x-requested-with"];
      if (!xrw || (xrw as string).toLowerCase() !== "xmlhttprequest") {
        return res.status(403).json({ message: "CSRF validation failed." });
      }
    }
    next();
  });

  // Test login endpoint — calls passport with the test strategy (no
  // emailVerified / lockout side effects to avoid coupling the test
  // harness to those flows). Same response shape as /api/facility/login.
  app.post("/api/facility/login", (req, res, next) => {
    passport.authenticate(
      "test-local",
      (err: Error | null, user: FacilityAccount | false) => {
        if (err) return next(err);
        if (!user) return res.status(401).json({ message: "Invalid credentials" });
        req.login(user, (loginErr) => {
          if (loginErr) return next(loginErr);
          return res.json({
            id: user.id,
            facilityNumber: user.facilityNumber,
            username: user.username,
          });
        });
      },
    )(req, res, next);
  });

  app.use("/api/ops", opsRouter);

  // Generic error sink so unexpected throws surface as 500 with body the
  // test can assert against.
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    // eslint-disable-next-line no-console
    console.error("[test-app] unhandled error:", err);
    if (res.headersSent) return;
    res.status(500).json({ success: false, error: err.message });
  });

  cachedApp = app;
  return app;
}

// ─────────────────────────────────────────────────────────────────────────────
// Facility account seeding
// ─────────────────────────────────────────────────────────────────────────────

export async function seedFacility(input: {
  facilityNumber: string;
  username: string;
  password: string;
  email: string;
}): Promise<TestFacility> {
  const hashed = await hashPassword(input.password);
  const now = Date.now();
  // Upsert by facility_number so reruns don't need to clean up first. We
  // refresh the username/email/password every time to keep tests
  // deterministic if a previous run left stale data behind.
  const result = await pool.query<{ id: number }>(
    `INSERT INTO facility_accounts
       (facility_number, username, password, role, email, email_verified, created_at)
     VALUES ($1, $2, $3, 'facility_admin', $4, 1, $5)
     ON CONFLICT (facility_number) DO UPDATE SET
       username = EXCLUDED.username,
       password = EXCLUDED.password,
       email = EXCLUDED.email,
       email_verified = 1
     RETURNING id`,
    [input.facilityNumber, input.username, hashed, input.email, now],
  );
  const id = Number(result.rows[0].id);
  return {
    id,
    facilityNumber: input.facilityNumber,
    username: input.username,
    password: input.password,
    email: input.email,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Cleanup — caller passes the facility_numbers the file owns. Tests in
// parallel forks must NOT share facility_numbers, otherwise one file's
// cleanup will delete another file's in-flight rows.
// ─────────────────────────────────────────────────────────────────────────────

export async function cleanTrackerData(
  facilityNumbers: readonly string[],
): Promise<void> {
  const ns = [...facilityNumbers];
  // tracker_entry_versions has no facility column; scope by entry_id.
  await pool.query(
    `DELETE FROM tracker_entry_versions
     WHERE entry_id IN (
       SELECT id FROM tracker_entries WHERE facility_number = ANY($1::text[])
     )`,
    [ns],
  );
  await pool.query(
    `DELETE FROM tracker_audit_log WHERE facility_number = ANY($1::text[])`,
    [ns],
  );
  await pool.query(
    `DELETE FROM tracker_entries WHERE facility_number = ANY($1::text[])`,
    [ns],
  );
}

export async function cleanFacilityAccounts(
  facilityNumbers: readonly string[],
): Promise<void> {
  await pool.query(
    `DELETE FROM facility_accounts WHERE facility_number = ANY($1::text[])`,
    [[...facilityNumbers]],
  );
}

/**
 * Number of tracker_entries rows currently present for the given facility.
 * Used by tests to assert no extra rows leaked through transactions.
 */
export async function countEntries(facilityNumber: string): Promise<number> {
  const r = await pool.query<{ c: string | number }>(
    `SELECT COUNT(*)::int AS c FROM tracker_entries WHERE facility_number = $1`,
    [facilityNumber],
  );
  return Number(r.rows[0].c);
}

export async function countAuditLog(
  facilityNumber: string,
  action?: "create" | "update" | "delete" | "restore",
): Promise<number> {
  if (action) {
    const r = await pool.query<{ c: string | number }>(
      `SELECT COUNT(*)::int AS c FROM tracker_audit_log
       WHERE facility_number = $1 AND action = $2`,
      [facilityNumber, action],
    );
    return Number(r.rows[0].c);
  }
  const r = await pool.query<{ c: string | number }>(
    `SELECT COUNT(*)::int AS c FROM tracker_audit_log WHERE facility_number = $1`,
    [facilityNumber],
  );
  return Number(r.rows[0].c);
}

/**
 * Insert a synthetic tracker_entries row for a *different* tracker_slug to
 * simulate cross-tracker clientId reuse. Used by the cross-tracker collision
 * tests since the foundation registry only ships ADL today, so we cannot
 * actually POST to a "second" slug — we plant a row with `tracker_slug =
 * 'fake-other'` and confirm the router/storage rejects an ADL POST that
 * reuses the same clientId.
 *
 * `tracker_definition_id` is set to 0 (an invalid FK in the soft-FK style
 * of this codebase) since no real definition exists for `fake-other`. The
 * NOT NULL constraint is satisfied; nothing in the read path ever joins.
 */
export async function insertCrossTrackerRow(args: {
  facilityNumber: string;
  clientId: string;
  trackerSlug: string;
  reportedByFacilityAccountId: number;
}): Promise<{ id: number }> {
  const now = Date.now();
  const r = await pool.query<{ id: number }>(
    `INSERT INTO tracker_entries
       (client_id, tracker_slug, tracker_definition_id, facility_number,
        resident_id, shift, occurred_at,
        reported_by_facility_account_id, reported_by_staff_id,
        reported_by_display_name, reported_by_role,
        payload, status, is_incident, created_at, updated_at)
     VALUES ($1, $2, 0, $3, NULL, NULL, $4, $5, NULL,
             'test-seed', 'facility_admin', '{}', 'active', 0, $4, $4)
     RETURNING id`,
    [args.clientId, args.trackerSlug, args.facilityNumber, now, args.reportedByFacilityAccountId],
  );
  return { id: Number(r.rows[0].id) };
}
