/**
 * server/routes/adminEtl.ts
 *
 * Admin endpoints for manually triggering and monitoring the CCLD enrichment job.
 * The actual process management lives in server/etlScheduler.ts — these routes
 * are just a control surface over it.
 *
 * Routes:
 *   POST /api/admin/etl/enrich   trigger enrichment now (requires auth)
 *   GET  /api/admin/etl/status   check whether enrichment is running (requires auth)
 */

import { Router, Request, Response, NextFunction } from "express";
import {
  triggerEnrichmentNow,
  isEnrichmentRunning,
} from "../etlScheduler";
import { getEnrichmentLog } from "../storage";

export const adminEtlRouter = Router();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Not authenticated" });
  next();
}

// ── POST /api/admin/etl/enrich ────────────────────────────────────────────────

adminEtlRouter.post("/enrich", requireAuth, (_req: Request, res: Response) => {
  if (isEnrichmentRunning()) {
    return res.status(409).json({ message: "Enrichment is already running" });
  }
  triggerEnrichmentNow();
  res.status(202).json({ message: "Enrichment started — watch fly logs for progress" });
});

// ── GET /api/admin/etl/status ─────────────────────────────────────────────────

adminEtlRouter.get("/status", requireAuth, (_req: Request, res: Response) => {
  res.json({ running: isEnrichmentRunning() });
});

// ── GET /api/admin/etl/log ────────────────────────────────────────────────────

adminEtlRouter.get("/log", requireAuth, (_req: Request, res: Response) => {
  res.json(getEnrichmentLog());
});
