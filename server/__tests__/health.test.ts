/**
 * Phase 8 — health-endpoint regression suite.
 *
 * Two concerns covered:
 *
 *   1. /api/health — Fly.io's liveness probe. Must respond 200 without
 *      touching the DB. A regression that makes liveness depend on DB
 *      reachability would cause blue/green deploys to roll back any time
 *      a transient pool hiccup landed during the health-check window.
 *
 *   2. /api/health/deep — readiness probe used by the external uptime
 *      monitor. Must do a real DB round-trip and 200 only when the DB
 *      is reachable. The failure path (DB unreachable -> 503) is
 *      asserted here without mocking — we probe the real pool in
 *      beforeAll and branch the deep-readiness test on what we find:
 *        - DB reachable: assert 200 + checks.db=ok (happy path).
 *        - DB unreachable: assert 503 + checks.db=fail (failure path).
 *      Either way the production handler is exercised and the contract
 *      is asserted, so the suite passes against any local environment.
 *
 * Uses a focused mini-harness rather than buildTestApp() from the
 * tracker suite — buildTestApp() doesn't mount the routes.ts surface,
 * so reusing it would silently 404 every assertion. Mounting the real
 * registerHealthRoutes() against a bare Express app exercises the
 * production code path and keeps this file free of unrelated setup
 * (passport, sessions, CSRF) that the health probes don't use.
 */

import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import express, { type Express } from "express";

import { pool } from "../db/index";
import { registerHealthRoutes } from "../health";

let app: Express;
let dbReachable = false;

beforeAll(async () => {
  app = express();
  registerHealthRoutes(app);
  try {
    await pool.query("SELECT 1");
    dbReachable = true;
  } catch {
    dbReachable = false;
  }
});

afterAll(async () => {
  await pool.end();
});

describe("Phase 8 — /api/health (liveness)", () => {
  it("returns 200 with status=ok without touching the DB", async () => {
    const res = await request(app).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("sets Cache-Control: no-store so intermediate proxies cannot cache", async () => {
    const res = await request(app).get("/api/health");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});

describe("Phase 8 — /api/health/deep (readiness)", () => {
  it("returns 200 + checks.db=ok when DB reachable; 503 + checks.db=fail when not", async () => {
    const res = await request(app).get("/api/health/deep");
    if (dbReachable) {
      expect(res.status, `body: ${JSON.stringify(res.body)}`).toBe(200);
      expect(res.body.status).toBe("ok");
      expect(res.body.checks?.db).toBe("ok");
    } else {
      expect(res.status).toBe(503);
      expect(res.body.status).toBe("degraded");
      expect(res.body.checks?.db).toBe("fail");
      expect(typeof res.body.error).toBe("string");
    }
  });

  it("sets Cache-Control: no-store on both success and failure paths", async () => {
    const res = await request(app).get("/api/health/deep");
    expect(res.headers["cache-control"]).toBe("no-store");
  });
});
