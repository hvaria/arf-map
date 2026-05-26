/**
 * Phase 8 — health probes.
 *
 * Two endpoints, intentionally split:
 *
 *   - GET /api/health        Liveness. No DB hit. Used by Fly's blue/green
 *                            flip + the deploy.yml smoke test. Must not
 *                            depend on DB reachability so a transient
 *                            pool hiccup can't cascade into a rollback.
 *
 *   - GET /api/health/deep   Readiness. Real `SELECT 1` against Postgres
 *                            with a 2 s hard timeout. Returns 503 on DB
 *                            unreachable/slow. This is the URL the
 *                            external uptime monitor polls.
 *
 * Extracted into its own module so the route registration can be reused
 * by the test harness without dragging in all of routes.ts.
 */

import type { Express } from "express";
import { pool } from "./db/index";

const DB_TIMEOUT_MS = 2000;

export function registerHealthRoutes(app: Express): void {
  app.get("/api/health", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ status: "ok" });
  });

  app.get("/api/health/deep", async (_req, res) => {
    // Clear the timer in `finally` so a successful query doesn't leave a
    // ticking setTimeout that rejects 2 s later (would otherwise emit an
    // `UnhandledPromiseRejection` for every successful health-deep hit
    // because Promise.race doesn't attach to the loser).
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        pool.query("SELECT 1"),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("db timeout")), DB_TIMEOUT_MS);
        }),
      ]);
      res.setHeader("Cache-Control", "no-store");
      res.json({ status: "ok", checks: { db: "ok" } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      res.setHeader("Cache-Control", "no-store");
      res.status(503).json({
        status: "degraded",
        checks: { db: "fail" },
        error: message,
      });
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
}
