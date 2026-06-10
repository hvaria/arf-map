/**
 * Wave 5 — Reports Hub router.
 *
 * Mounted under /api/ops by opsRouter.ts, so it inherits requireFacility-
 * Auth + requireActiveSubscription + the IDOR :facilityNumber guard.
 *
 * Routes:
 *   GET    /api/ops/facilities/:fn/reports          REPORT:read
 *   POST   /api/ops/facilities/:fn/reports/generate REPORT:create
 *   GET    /api/ops/reports/:id                     REPORT:read
 *   GET    /api/ops/reports/:id/download            REPORT:read (streams)
 *   DELETE /api/ops/reports/:id                     REPORT:delete (soft)
 *
 * Auditor mirrors (read + download only) live in auditorRouter.ts.
 *
 * Synchronous generate path: the route runs the generator inline, races
 * it against REPORTS_MAX_INLINE_GENERATE_MS (default 30s), and returns the
 * finalized row in the same response. On timeout we mark the stub row
 * failed with failure_reason='timed_out' and return 504.
 */

import { Router, type NextFunction, type Request, type Response } from "express";
import { z } from "zod";

import { resolveRole, requireOpsPermission, OPS_RESOURCES } from "./permissions";
import {
  REPORT_KINDS,
  REPORT_STATUSES,
  type ReportKind,
} from "@shared/reports";
import {
  createReportStub,
  getReport,
  listReports,
  markReportFailed,
  markReportReady,
  softDeleteReport,
  streamReport,
} from "./reportsStorage";
import { getReportGenerator } from "./reportsGenerators";
import { getRegSetting } from "./regSettings";
import { TrustDomainError } from "./residentTrustStorage";

export const reportsRouter = Router();

// IDOR guard: parent opsRouter declares the same guard for routes attached
// directly to it, but sub-router param callbacks don't inherit — so we
// register the guard locally for the :facilityNumber routes on this router.
reportsRouter.param(
  "facilityNumber",
  (req: Request, res: Response, next: NextFunction, fnParam: string) => {
    const user = req.user as { facilityNumber?: string } | undefined;
    if (user?.facilityNumber !== fnParam) {
      return res.status(403).json({ success: false, error: "Forbidden" });
    }
    next();
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getActor(req: Request): { id: string; role: string } {
  const u = req.user as { username?: string } | undefined;
  return { id: u?.username ?? "unknown", role: resolveRole(req) };
}

function getFacilityNumber(req: Request): string {
  const user = req.user as { facilityNumber?: string } | undefined;
  return user?.facilityNumber ?? "";
}

function parsePagination(query: Record<string, unknown>): { page: number; limit: number } {
  const page = Math.max(1, parseInt(String(query.page ?? "1"), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? "20"), 10) || 20));
  return { page, limit };
}

/**
 * Race the generator promise against the inline-generate timeout. On
 * timeout we throw a tagged error so the route handler can mark the stub
 * row failed + return 504. Returning early with a non-bytes value is not
 * an option — the generator promise keeps running and the response must
 * still close.
 */
class GenerationTimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GenerationTimeoutError";
  }
}

async function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timeoutId: NodeJS.Timeout | undefined;
  try {
    return await Promise.race<T>([
      p,
      new Promise<T>((_resolve, reject) => {
        timeoutId = setTimeout(() => {
          reject(new GenerationTimeoutError(`timed_out after ${ms}ms`));
        }, ms);
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const listQuerySchema = z
  .object({
    reportKind: z.enum(REPORT_KINDS).optional(),
    status: z.enum(REPORT_STATUSES).optional(),
    generatedBy: z.string().max(200).optional(),
    sinceMs: z.coerce.number().int().nonnegative().optional(),
    untilMs: z.coerce.number().int().positive().optional(),
    page: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().positive().max(100).optional(),
    includeDeleted: z.coerce.boolean().optional(),
  })
  .strict();

const generateSchema = z
  .object({
    reportKind: z.enum(REPORT_KINDS),
    title: z.string().max(300).optional(),
    description: z.string().max(2000).optional(),
    parameters: z.record(z.unknown()).optional(),
    retentionDays: z.number().int().nonnegative().max(36500).optional(),
  })
  .strict();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/facilities/:facilityNumber/reports
// ─────────────────────────────────────────────────────────────────────────────

reportsRouter.get(
  "/facilities/:facilityNumber/reports",
  requireOpsPermission(OPS_RESOURCES.REPORT, "read"),
  async (req, res) => {
    try {
      const facilityNumber = String(req.params.facilityNumber);
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: parsed.error.errors[0].message });
      }
      const { page, limit } = parsePagination(req.query as Record<string, unknown>);
      const result = await listReports(facilityNumber, {
        reportKind: parsed.data.reportKind,
        status: parsed.data.status,
        generatedBy: parsed.data.generatedBy,
        sinceMs: parsed.data.sinceMs,
        untilMs: parsed.data.untilMs,
        includeDeleted: parsed.data.includeDeleted,
        page,
        limit,
      });
      return res.json({
        success: true,
        data: result.rows,
        meta: { total: result.total, page, limit },
      });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ops] reports list failed", e);
      return res.status(500).json({ success: false, error: "Internal error" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/ops/facilities/:facilityNumber/reports/generate
// ─────────────────────────────────────────────────────────────────────────────

reportsRouter.post(
  "/facilities/:facilityNumber/reports/generate",
  requireOpsPermission(OPS_RESOURCES.REPORT, "create"),
  async (req, res) => {
    const facilityNumber = String(req.params.facilityNumber);
    const parsed = generateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, error: parsed.error.errors[0].message });
    }
    const actor = getActor(req);
    const kind = parsed.data.reportKind as ReportKind;
    const generator = getReportGenerator(kind);
    if (!generator) {
      return res.status(400).json({
        success: false,
        error: `Unsupported report kind: ${kind}`,
      });
    }

    // Resolve inline-generate budget from reg-settings. Falls back to 30s
    // if the setting is missing / malformed.
    let timeoutMs = 30_000;
    try {
      const raw = await getRegSetting(facilityNumber, "REPORTS_MAX_INLINE_GENERATE_MS");
      const n = parseInt(raw, 10);
      if (Number.isFinite(n) && n > 0) timeoutMs = n;
    } catch {
      // keep default
    }

    // Stub row first — gives us an id for the storage path + audit lineage
    // even if the generator throws.
    const stub = await createReportStub(
      {
        facilityNumber,
        reportKind: kind,
        title:
          parsed.data.title?.trim() ||
          `${kind} (${new Date().toISOString().slice(0, 16)})`,
        description: parsed.data.description,
        parameters: parsed.data.parameters,
        retentionDays: parsed.data.retentionDays,
        generatedBy: actor.id,
      },
      actor,
    );

    try {
      const result = await withTimeout(
        generator(
          {
            facilityNumber,
            generatedBy: actor.id,
            actor,
            now: stub.generatedAt,
          },
          parsed.data.parameters ?? {},
        ),
        timeoutMs,
      );

      const ready = await markReportReady(
        stub.id,
        facilityNumber,
        { bytes: result.bytes, mime: result.mime },
        actor,
      );

      return res.status(201).json({ success: true, data: ready });
    } catch (e) {
      const reason =
        e instanceof Error ? e.message : "unknown generation failure";
      try {
        await markReportFailed(stub.id, facilityNumber, reason, actor);
      } catch (innerErr) {
        // eslint-disable-next-line no-console
        console.error(
          "[ops] reports markReportFailed failed",
          innerErr,
        );
      }
      // eslint-disable-next-line no-console
      console.error("[ops] reports generate failed", e);
      if (e instanceof GenerationTimeoutError) {
        return res.status(504).json({
          success: false,
          error: "timed_out",
          data: { reportId: stub.id },
        });
      }
      if (e instanceof TrustDomainError) {
        const status = e.code === "account_not_found" ? 404 : 409;
        return res.status(status).json({
          success: false,
          error: e.message,
          code: e.code,
          data: { reportId: stub.id },
        });
      }
      return res.status(500).json({
        success: false,
        error: reason,
        data: { reportId: stub.id },
      });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/reports/:id
// ─────────────────────────────────────────────────────────────────────────────

reportsRouter.get(
  "/reports/:id",
  requireOpsPermission(OPS_RESOURCES.REPORT, "read"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const row = await getReport(id, facilityNumber);
      if (!row) {
        return res.status(404).json({ success: false, error: "Not found" });
      }
      return res.json({ success: true, data: row });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ops] reports get failed", e);
      return res.status(500).json({ success: false, error: "Internal error" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ops/reports/:id/download
// ─────────────────────────────────────────────────────────────────────────────

reportsRouter.get(
  "/reports/:id/download",
  requireOpsPermission(OPS_RESOURCES.REPORT, "read"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const actor = getActor(req);
      const result = await streamReport(id, facilityNumber, actor);
      if (!result) {
        return res.status(404).json({ success: false, error: "Not found" });
      }
      res.setHeader("Content-Type", result.mime);
      res.setHeader("Content-Length", String(result.byteSize));
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${result.filename.replace(/"/g, "")}"`,
      );
      res.setHeader("Cache-Control", "private, no-store");
      result.stream.on("error", (err: Error) => {
        // eslint-disable-next-line no-console
        console.error("[ops] report stream error", err);
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.destroy(err);
        }
      });
      result.stream.pipe(res);
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ops] reports download failed", e);
      if (!res.headersSent) {
        return res.status(500).json({ success: false, error: "Internal error" });
      }
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/ops/reports/:id
// ─────────────────────────────────────────────────────────────────────────────

reportsRouter.delete(
  "/reports/:id",
  requireOpsPermission(OPS_RESOURCES.REPORT, "delete"),
  async (req, res) => {
    try {
      const facilityNumber = getFacilityNumber(req);
      if (!facilityNumber) {
        return res
          .status(401)
          .json({ success: false, error: "Not authenticated" });
      }
      const id = parseInt(String(req.params.id), 10);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ success: false, error: "Invalid id" });
      }
      const actor = getActor(req);
      const ok = await softDeleteReport(id, facilityNumber, actor);
      if (!ok) {
        return res.status(404).json({ success: false, error: "Not found" });
      }
      return res.json({ success: true });
    } catch (e) {
      // eslint-disable-next-line no-console
      console.error("[ops] reports delete failed", e);
      return res.status(500).json({ success: false, error: "Internal error" });
    }
  },
);
