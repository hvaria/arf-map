/**
 * Wave 3 Phase 3.2 — Auditor share-link router.
 *
 * Mounted at /api/ops/auditor by server/index.ts, BEFORE the facility-
 * Passport opsRouter, so the prefix matches first and opsRouter's
 * requireFacilityAuth never sees auditor traffic.
 *
 * Auth model:
 *   - Every request runs `requireAuditorToken` first → req.auditor is
 *     populated with the facility scope, audience, expiry.
 *   - `blockAuditorMutations` then rejects any non-GET (defense in
 *     depth — every handler in this file is a GET, but if a future
 *     refactor adds one and forgets to gate it, the mutation will
 *     still 403 here).
 *
 * Tenant scope:
 *   - `req.auditor.facilityNumber` is the ONLY facility used in storage
 *     calls. The auditor router has no `:facilityNumber` path param —
 *     swapping it would be a no-op since handlers ignore the URL value.
 *     A test asserts that even a hand-crafted URL with a foreign
 *     facility number cannot read cross-tenant data.
 *
 * Mirrored endpoints:
 *   GET /me                                      — session metadata
 *   GET /triage                                   — re-uses aggregateTriage()
 *   GET /sections/:section?windowStartAt=&windowEndAt=
 *                                                 — one section on-demand
 *   GET /preaudit-pull/:pullId                    — bundle replay
 */

import { Router, type Request, type Response } from "express";
import { z } from "zod";

import {
  requireAuditorToken,
  blockAuditorMutations,
} from "./auditorMiddleware";
import { aggregateTriage } from "./triageAggregator";
import {
  generatePreauditBundle,
  getPreauditPull,
} from "./preauditPullsStorage";
import {
  PREAUDIT_SECTIONS,
  AUDITOR_AUDIENCES,
  type PreauditSection,
} from "@shared/auditor";

export const auditorRouter = Router();

// Auth chain — order matters. requireAuditorToken populates req.auditor;
// blockAuditorMutations refuses any non-GET regardless of route handler.
auditorRouter.use(requireAuditorToken);
auditorRouter.use(blockAuditorMutations);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function getScope(req: Request): {
  facilityNumber: string;
  audience: string;
  expiresAt: number;
  shareLinkId: number;
} {
  // requireAuditorToken guarantees req.auditor is set before any handler
  // runs — the cast is a TS convenience, not a runtime decision.
  const a = req.auditor!;
  return {
    facilityNumber: a.facilityNumber,
    audience: a.audience,
    expiresAt: a.expiresAt,
    shareLinkId: a.shareLinkId,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas
// ─────────────────────────────────────────────────────────────────────────────

const sectionQuerySchema = z
  .object({
    windowStartAt: z.coerce.number().int().nonnegative(),
    windowEndAt: z.coerce.number().int().positive(),
  })
  .strict()
  .refine((v) => v.windowStartAt < v.windowEndAt, {
    message: "windowStartAt must be < windowEndAt",
  });

const triageQuerySchema = z
  .object({
    perSectionLimit: z.coerce.number().int().positive().max(100).optional(),
  })
  .strict();

const SECTION_SET = new Set<string>(PREAUDIT_SECTIONS);
// Silence unused-import: AUDITOR_AUDIENCES is re-exported via shared so we
// keep the import for future audience-scoped section gating without churn.
void AUDITOR_AUDIENCES;

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/ops/auditor/me
auditorRouter.get("/me", (req, res) => {
  const scope = getScope(req);
  return res.json({
    success: true,
    data: {
      facilityNumber: scope.facilityNumber,
      audience: scope.audience,
      expiresAt: scope.expiresAt,
    },
  });
});

// GET /api/ops/auditor/triage
auditorRouter.get("/triage", async (req, res) => {
  try {
    const scope = getScope(req);
    const parsed = triageQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, error: parsed.error.errors[0].message });
    }
    const data = await aggregateTriage(scope.facilityNumber, {
      perSectionLimit: parsed.data.perSectionLimit,
    });
    return res.json({ success: true, data });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[ops] auditor triage failed", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /api/ops/auditor/sections/:section?windowStartAt=&windowEndAt=
auditorRouter.get("/sections/:section", async (req, res) => {
  try {
    const scope = getScope(req);
    const section = String(req.params.section);
    if (!SECTION_SET.has(section)) {
      return res
        .status(400)
        .json({ success: false, error: `Unknown section: ${section}` });
    }
    const parsed = sectionQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, error: parsed.error.errors[0].message });
    }
    const { bundle, totals } = await generatePreauditBundle(
      scope.facilityNumber,
      {
        audience: "internal", // placeholder — the section-on-demand path
        // is scoped to a single section, audience only affects the
        // persisted pre-audit-pull row (which we don't write here).
        windowStartAt: parsed.data.windowStartAt,
        windowEndAt: parsed.data.windowEndAt,
        sections: [section as PreauditSection],
        deliveryMethod: "download",
      },
    );
    return res.json({
      success: true,
      data: {
        section,
        rows: bundle[section as PreauditSection],
        totals: totals[section as PreauditSection],
        windowStartAt: parsed.data.windowStartAt,
        windowEndAt: parsed.data.windowEndAt,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[ops] auditor section pull failed", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});

// GET /api/ops/auditor/preaudit-pull/:pullId
auditorRouter.get("/preaudit-pull/:pullId", async (req, res) => {
  try {
    const scope = getScope(req);
    const pullId = parseInt(String(req.params.pullId), 10);
    if (!Number.isInteger(pullId) || pullId <= 0) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid pullId" });
    }
    const row = await getPreauditPull(pullId, scope.facilityNumber);
    if (!row) {
      // 404 for both "not found" and "wrong tenant" — same response so
      // a hostile auditor can't enumerate pull IDs across facilities.
      return res
        .status(404)
        .json({ success: false, error: "Not found" });
    }
    return res.json({
      success: true,
      data: {
        id: row.id,
        audience: row.audience,
        audienceLabel: row.audienceLabel,
        windowStartAt: row.windowStartAt,
        windowEndAt: row.windowEndAt,
        generatedAt: row.generatedAt,
        sectionsJson: row.sectionsJson,
        totalsJson: row.totalsJson,
        deliveryMethod: row.deliveryMethod,
      },
    });
  } catch (e) {
    // eslint-disable-next-line no-console
    console.error("[ops] auditor preaudit-pull replay failed", e);
    return res.status(500).json({ success: false, error: "Internal error" });
  }
});

// Catch-all is intentionally NOT added — Express's default 404 is fine
// here and lets future GETs be wired without ordering surprises.
