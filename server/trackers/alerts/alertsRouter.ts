/**
 * Tracker alerts sub-router.
 *
 * Mounted at `/api/ops/trackers/alerts` by routes.ts. Inherits
 * `requireFacilityAuth` from opsRouter — every request is multi-tenant
 * scoped on `req.user.facilityNumber`.
 *
 * Endpoints:
 *   GET    /                — list alerts (default status='active')
 *   GET    /summary         — severity-bucketed active counts
 *   POST   /:id/acknowledge — set status='acknowledged' + audit
 *   POST   /:id/resolve     — set status='resolved' + audit
 *
 * Conventions match entriesRouter:
 *   - Zod parse → storage call → JSON envelope.
 *   - 404 for both missing and wrong-tenant (existence-leak avoidance).
 *   - 409 only when the state machine says no (e.g. resolve→acknowledge).
 */

import { Router, type Request } from "express";
import { z } from "zod";

import {
  acknowledgeAlert,
  getActiveAlertCounts,
  listAlerts,
  resolveAlert,
  TrackerAlertAlreadyResolvedError,
  TrackerNotFoundError,
  type ActorCtx,
  type TrackerRequestContext,
} from "../trackerStorage";
import {
  trackerAlertSeveritySchema,
  trackerAlertStatusSchema,
} from "../trackerSchema";
import type { FacilityAccount } from "@shared/schema";

export const alertsRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (mirrored from entriesRouter — tracker module style)
// ─────────────────────────────────────────────────────────────────────────────

function getActor(req: Request): ActorCtx {
  const user = req.user as FacilityAccount;
  return {
    facilityAccountId: user.id,
    staffId: null,
    displayName: user.username,
    role: user.role ?? "facility_admin",
  };
}

function getReqCtx(req: Request): TrackerRequestContext {
  return {
    ipAddress: (req.ip ?? req.socket.remoteAddress) ?? null,
    userAgent: req.get("user-agent") ?? null,
  };
}

function getFacilityNumber(req: Request): string {
  const user = req.user as FacilityAccount | undefined;
  return user?.facilityNumber ?? "";
}

function parseId(raw: string | undefined): number | null {
  if (typeof raw !== "string") return null;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function zodErrorMessage(err: {
  issues: Array<{ message: string; path: (string | number)[] }>;
}): string {
  const e = err.issues[0];
  return e ? `${e.path.join(".") || "input"}: ${e.message}` : "Invalid input";
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const cursorSchema = z
  .object({
    createdAt: z.number().int(),
    id: z.number().int().positive(),
  })
  .strict();

/** CSV → string[] (trimmed, empties dropped). */
function splitCsv(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

const listQuerySchema = z
  .object({
    severity: z.string().optional(),
    status: z.string().optional(),
    slug: z.string().min(1).optional(),
    residentId: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    cursor: z.string().optional(),
  })
  .strict();

const actionBodySchema = z
  .object({
    note: z.string().max(2000).optional(),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────────────
// GET / — list alerts (defaults to status='active')
// ─────────────────────────────────────────────────────────────────────────────

alertsRouter.get("/", async (req, res) => {
  try {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, error: zodErrorMessage(parsed.error) });
    }

    let severity: Array<"info" | "warn" | "critical"> | undefined;
    if (parsed.data.severity) {
      const parts = splitCsv(parsed.data.severity);
      const validated: Array<"info" | "warn" | "critical"> = [];
      for (const p of parts) {
        const r = trackerAlertSeveritySchema.safeParse(p);
        if (!r.success) {
          return res
            .status(400)
            .json({ success: false, error: `Invalid severity: ${p}` });
        }
        validated.push(r.data);
      }
      severity = validated;
    }

    let status: Array<"active" | "acknowledged" | "resolved"> | undefined;
    if (parsed.data.status) {
      const parts = splitCsv(parsed.data.status);
      const validated: Array<"active" | "acknowledged" | "resolved"> = [];
      for (const p of parts) {
        const r = trackerAlertStatusSchema.safeParse(p);
        if (!r.success) {
          return res
            .status(400)
            .json({ success: false, error: `Invalid status: ${p}` });
        }
        validated.push(r.data);
      }
      status = validated;
    }

    let cursor: { createdAt: number; id: number } | undefined;
    if (parsed.data.cursor) {
      try {
        const decoded = JSON.parse(parsed.data.cursor) as unknown;
        const c = cursorSchema.safeParse(decoded);
        if (!c.success) {
          return res
            .status(400)
            .json({ success: false, error: "Invalid cursor" });
        }
        cursor = c.data;
      } catch {
        return res
          .status(400)
          .json({ success: false, error: "Invalid cursor" });
      }
    }

    const result = await listAlerts(getFacilityNumber(req), {
      severity,
      status,
      slug: parsed.data.slug,
      residentId: parsed.data.residentId,
      cursor,
      limit: parsed.data.limit,
    });

    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("[trackers] GET /alerts failed", err);
    return res
      .status(500)
      .json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /summary — severity-bucketed active counts
// ─────────────────────────────────────────────────────────────────────────────

alertsRouter.get("/summary", async (req, res) => {
  try {
    const counts = await getActiveAlertCounts(getFacilityNumber(req));
    return res.json({ success: true, data: counts });
  } catch (err) {
    console.error("[trackers] GET /alerts/summary failed", err);
    return res
      .status(500)
      .json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/acknowledge
// ─────────────────────────────────────────────────────────────────────────────

alertsRouter.post("/:id/acknowledge", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid id" });
    }

    const parsed = actionBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, error: zodErrorMessage(parsed.error) });
    }

    const updated = await acknowledgeAlert({
      id,
      facilityNumber: getFacilityNumber(req),
      actor: getActor(req),
      note: parsed.data.note ?? null,
      reqCtx: getReqCtx(req),
    });

    return res.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof TrackerNotFoundError) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    if (err instanceof TrackerAlertAlreadyResolvedError) {
      return res
        .status(409)
        .json({ success: false, error: "Alert already resolved" });
    }
    console.error("[trackers] POST /alerts/:id/acknowledge failed", err);
    return res
      .status(500)
      .json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /:id/resolve
// ─────────────────────────────────────────────────────────────────────────────

alertsRouter.post("/:id/resolve", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid id" });
    }

    const parsed = actionBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, error: zodErrorMessage(parsed.error) });
    }

    const updated = await resolveAlert({
      id,
      facilityNumber: getFacilityNumber(req),
      actor: getActor(req),
      note: parsed.data.note ?? null,
      reqCtx: getReqCtx(req),
    });

    return res.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof TrackerNotFoundError) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    console.error("[trackers] POST /alerts/:id/resolve failed", err);
    return res
      .status(500)
      .json({ success: false, error: "Internal error" });
  }
});
