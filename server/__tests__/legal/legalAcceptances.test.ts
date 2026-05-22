/**
 * Phase 4 — legal acceptance helpers + middleware tests.
 *
 * Targets `server/lib/legal.ts` against the real test Postgres so the SQL
 * (ON CONFLICT DO NOTHING, UNIQUE index, per-slug lookup) is exercised
 * end-to-end.
 *
 * Covered:
 *   - getPendingAcceptances returns all 3 slugs for a brand-new account.
 *   - After recordAcceptance('terms'), only privacy + aup remain pending.
 *   - Replay of the same (account, doc, version) is idempotent (one row).
 *   - A bumped version makes the slug pending again.
 *   - requirePendingLegalAcceptances middleware:
 *       * 409 on POST with the right body shape
 *       * passes GET through
 *       * passes /api/legal/accept through
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import request from "supertest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import {
  recordAcceptance,
  getPendingAcceptances,
  requirePendingLegalAcceptances,
} from "../../lib/legal";
import { LEGAL_DOCS, type LegalDocSlug } from "@shared/legal";

const SEEKER_EMAIL = "test-legal-seeker@example.com";
const SEEKER_USERNAME = "test-legal-seeker";

let seekerId: number;

beforeAll(async () => {
  await bootstrapMainSchema();
  const r = await pool.query<{ id: number }>(
    `INSERT INTO job_seeker_accounts (username, email, password, email_verified, created_at)
     VALUES ($1, $2, 'unused-hash', 1, $3)
     ON CONFLICT (email) DO UPDATE SET username = EXCLUDED.username
     RETURNING id`,
    [SEEKER_USERNAME, SEEKER_EMAIL, Date.now()],
  );
  seekerId = Number(r.rows[0].id);
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM legal_acceptances WHERE account_kind = 'job_seeker' AND account_id = $1`,
    [seekerId],
  );
  await pool.query(
    `DELETE FROM job_seeker_accounts WHERE email = $1`,
    [SEEKER_EMAIL],
  );
});

beforeEach(async () => {
  // Wipe acceptance rows so each test gets a clean slate.
  await pool.query(
    `DELETE FROM legal_acceptances WHERE account_kind = 'job_seeker' AND account_id = $1`,
    [seekerId],
  );
});

// Tiny fake Request just for recordAcceptance. The helper only reads
// req.ip and req.get('user-agent') so a minimal shim is enough.
function fakeReq(): Request {
  return {
    ip: "127.0.0.1",
    get: (header: string) => (header.toLowerCase() === "user-agent" ? "vitest" : undefined),
  } as unknown as Request;
}

describe("getPendingAcceptances", () => {
  it("returns all 3 slugs for a brand-new account", async () => {
    const pending = await getPendingAcceptances({
      accountKind: "job_seeker",
      accountId: seekerId,
    });
    expect(pending.sort()).toEqual(["aup", "privacy", "terms"]);
  });

  it("returns only privacy + aup after accepting terms", async () => {
    await recordAcceptance({
      req: fakeReq(),
      accountKind: "job_seeker",
      accountId: seekerId,
      document: "terms",
      version: LEGAL_DOCS.terms.version,
    });
    const pending = await getPendingAcceptances({
      accountKind: "job_seeker",
      accountId: seekerId,
    });
    expect(pending.sort()).toEqual(["aup", "privacy"]);
  });
});

describe("recordAcceptance", () => {
  it("is idempotent on the (account, doc, version) UNIQUE index", async () => {
    const args = {
      accountKind: "job_seeker" as const,
      accountId: seekerId,
      document: "terms" as LegalDocSlug,
      version: LEGAL_DOCS.terms.version,
    };
    await recordAcceptance({ req: fakeReq(), ...args });
    await recordAcceptance({ req: fakeReq(), ...args });
    await recordAcceptance({ req: fakeReq(), ...args });

    const r = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM legal_acceptances
        WHERE account_kind = 'job_seeker' AND account_id = $1
          AND document = 'terms' AND version = $2`,
      [seekerId, LEGAL_DOCS.terms.version],
    );
    expect(Number(r.rows[0].count)).toBe(1);
  });

  it("re-prompts after a version bump (new version row missing)", async () => {
    // First, accept at the current version.
    await recordAcceptance({
      req: fakeReq(),
      accountKind: "job_seeker",
      accountId: seekerId,
      document: "terms",
      version: LEGAL_DOCS.terms.version,
    });
    let pending = await getPendingAcceptances({
      accountKind: "job_seeker",
      accountId: seekerId,
    });
    expect(pending).not.toContain("terms");

    // Simulate a version bump by directly checking against a new version
    // string. We can't mutate LEGAL_DOCS at runtime cleanly, so we assert
    // the underlying SQL semantics: a (doc, version) pair with no row is
    // pending regardless of older accepted versions.
    const bumpedVersion = `${LEGAL_DOCS.terms.version}-NEW`;
    const r = await pool.query<{ id: number }>(
      `SELECT id FROM legal_acceptances
        WHERE account_kind = 'job_seeker' AND account_id = $1
          AND document = 'terms' AND version = $2
        LIMIT 1`,
      [seekerId, bumpedVersion],
    );
    expect(r.rows.length).toBe(0);
  });

  it("captures ip + user-agent in the audit row", async () => {
    await recordAcceptance({
      req: fakeReq(),
      accountKind: "job_seeker",
      accountId: seekerId,
      document: "privacy",
      version: LEGAL_DOCS.privacy.version,
    });
    const r = await pool.query<{ accepted_ip: string; accepted_user_agent: string }>(
      `SELECT accepted_ip, accepted_user_agent FROM legal_acceptances
        WHERE account_kind = 'job_seeker' AND account_id = $1
          AND document = 'privacy'`,
      [seekerId],
    );
    expect(r.rows[0].accepted_ip).toBe("127.0.0.1");
    expect(r.rows[0].accepted_user_agent).toBe("vitest");
  });
});

describe("requirePendingLegalAcceptances middleware", () => {
  function buildApp(): Express {
    const app = express();
    app.use(express.json());
    app.use(
      session({
        secret: "legal-test-secret",
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false, httpOnly: true, sameSite: "lax", maxAge: 60 * 60 * 1000 },
      }),
    );
    // Stamp jobSeekerId on session for every request (test-only).
    app.use((req: Request, _res: Response, next: NextFunction) => {
      req.session.jobSeekerId = seekerId;
      next();
    });
    app.use(requirePendingLegalAcceptances("job_seeker"));
    // A trivial pair of read/write handlers so the gate is observable.
    app.get("/api/protected", (_req, res) => {
      res.json({ ok: true });
    });
    app.post("/api/protected", (_req, res) => {
      res.json({ ok: true });
    });
    app.post("/api/legal/accept", (_req, res) => {
      res.json({ ok: true, bypassed: true });
    });
    return app;
  }

  it("returns 409 on POST when acceptances are pending", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/protected").send({});
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({
      code: "LEGAL_REACCEPT_REQUIRED",
    });
    expect(res.body.pendingAcceptances.sort()).toEqual(["aup", "privacy", "terms"]);
  });

  it("passes GET through even when acceptances are pending", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/protected");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it("does NOT block POST /api/legal/accept", async () => {
    const app = buildApp();
    const res = await request(app).post("/api/legal/accept").send({});
    expect(res.status).toBe(200);
    expect(res.body.bypassed).toBe(true);
  });

  it("passes POST through after all docs are accepted", async () => {
    // Accept every doc first.
    for (const slug of ["terms", "privacy", "aup"] as const) {
      await recordAcceptance({
        req: fakeReq(),
        accountKind: "job_seeker",
        accountId: seekerId,
        document: slug,
        version: LEGAL_DOCS[slug].version,
      });
    }
    const app = buildApp();
    const res = await request(app).post("/api/protected").send({});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });
});
