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
 *      is reachable. Failure path (DB down → 503) is verified by the
 *      runbook chaos drill, not here — mocking the pool would defeat the
 *      purpose of the assertion (we want to know the real query path is
 *      wired up correctly, not that a mock returns the right shape).
 */

import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import type { Express } from "express";

import { pool } from "../db/index";
import { bootstrapMainSchema } from "../db/bootstrap";
import { buildTestApp } from "./trackers/setupTestApp";

let app: Express;

beforeAll(async () => {
  app = buildTestApp();
  await bootstrapMainSchema();
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
});

describe("Phase 8 — /api/health/deep (readiness)", () => {
  it("returns 200 with checks.db=ok when the DB is reachable", async () => {
    const res = await request(app).get("/api/health/deep");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.checks?.db).toBe("ok");
  });
});
