/**
 * Tracker entries sub-router.
 *
 * Mounted at `/api/ops/trackers` (so the routes here are the per-slug entry
 * endpoints + the by-id entry endpoints). All routes assume `requireFacilityAuth`
 * has already been applied upstream.
 *
 * Conventions:
 *   - Zod-parse → registry lookup → payload validate → storage call → envelope.
 *   - Existence-leak avoidance: 404 for both "missing" and "wrong tenant".
 *   - Single-entry POST runs through trackerIdempotencyMiddleware. Bulk handles
 *     idempotency inside the storage transaction.
 */

import { Router, type Request } from "express";
import { z } from "zod";

import {
  bulkInsertEntries,
  findDefinitionIdBySlug,
  findEntryByClientId,
  getEntryById,
  insertEntry,
  listEntries,
  listVersions,
  softDeleteEntry,
  updateEntry,
  TrackerClientIdSlugMismatchError,
  TrackerNotFoundError,
  type ActorCtx,
  type TrackerRequestContext,
} from "../trackerStorage";
import { getDefinition } from "../registry";
import {
  formatPayloadError,
  validatePayload,
} from "../payloadValidation";
import {
  trackerIdempotencyMiddleware,
  type TrackerLocals,
} from "../middleware/idempotency";
import { shiftSchema } from "@shared/tracker-schemas";
import type { FacilityAccount } from "@shared/schema";

export const entriesRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
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
    occurredAt: z.number().int(),
    id: z.number().int().positive(),
  })
  .strict();

/**
 * `GET /:slug/entries` query schema. Numbers are coerced because Express
 * query strings arrive as strings.
 */
const listQuerySchema = z
  .object({
    from: z.coerce.number().int().optional(),
    to: z.coerce.number().int().optional(),
    shift: shiftSchema.optional(),
    residentId: z.coerce.number().int().positive().optional(),
    limit: z.coerce.number().int().min(1).max(200).optional(),
    /** Cursor is a JSON string of `{ occurredAt, id }` (URL-encoded). */
    cursor: z.string().optional(),
  })
  .strict();

const singleEntryBodySchema = z
  .object({
    clientId: z.string().uuid(),
    residentId: z.number().int().positive().optional(),
    shift: shiftSchema.optional(),
    occurredAt: z.number().int().positive(),
    payload: z.unknown(),
    isIncident: z.boolean().optional(),
  })
  .strict();

const bulkBodySchema = z
  .object({
    items: z.array(singleEntryBodySchema).min(1).max(100),
  })
  .strict();

const patchBodySchema = z
  .object({
    payload: z.unknown().optional(),
    shift: shiftSchema.nullable().optional(),
    occurredAt: z.number().int().positive().optional(),
    isIncident: z.boolean().optional(),
    changeReason: z.string().max(500).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.payload !== undefined ||
      v.shift !== undefined ||
      v.occurredAt !== undefined ||
      v.isIncident !== undefined ||
      v.changeReason !== undefined,
    { message: "patch must include at least one field" },
  );

// ─────────────────────────────────────────────────────────────────────────────
// LIST :slug entries
// ─────────────────────────────────────────────────────────────────────────────

entriesRouter.get("/:slug/entries", async (req, res) => {
  try {
    const def = getDefinition(req.params.slug);
    if (!def || def.isActive === false) {
      return res.status(404).json({ success: false, error: "Tracker not found" });
    }

    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, error: zodErrorMessage(parsed.error) });
    }

    let cursor: { occurredAt: number; id: number } | undefined;
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

    const result = await listEntries(getFacilityNumber(req), {
      slug: def.slug,
      from: parsed.data.from,
      to: parsed.data.to,
      shift: parsed.data.shift,
      residentId: parsed.data.residentId,
      cursor,
      limit: parsed.data.limit,
    });
    return res.json({ success: true, data: result });
  } catch (err) {
    console.error("[trackers] GET /:slug/entries failed", err);
    return res
      .status(500)
      .json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// BULK insert — registered BEFORE the single POST so Express picks the more
// specific path first. Path uses a `/bulk` segment (not `:bulk`) because under
// Express 5's path-to-regexp v8, `:bulk` parses as a NAMED PARAMETER — it
// would match `/adl/entriesXYZ` and bind `req.params.bulk = "XYZ"`. Segment
// form is unambiguous and matches the rest of the codebase. (C3)
// ─────────────────────────────────────────────────────────────────────────────

entriesRouter.post("/:slug/entries/bulk", async (req, res) => {
  try {
    const def = getDefinition(req.params.slug);
    if (!def || def.isActive === false) {
      return res.status(404).json({ success: false, error: "Tracker not found" });
    }

    const parsed = bulkBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, error: zodErrorMessage(parsed.error) });
    }

    const items = parsed.data.items;

    // Reject batches with duplicate clientIds inside the same request — the
    // unique index would catch it eventually, but a 400 here is friendlier.
    const seen = new Set<string>();
    for (const it of items) {
      if (seen.has(it.clientId)) {
        return res.status(400).json({
          success: false,
          error: `Duplicate clientId in batch: ${it.clientId}`,
        });
      }
      seen.add(it.clientId);
    }

    // Per-item payload validation up front. If any payload fails, we 400
    // before opening a transaction.
    for (let i = 0; i < items.length; i++) {
      const v = validatePayload(def.slug, items[i].payload);
      if (!v.ok) {
        return res.status(400).json({
          success: false,
          error: `items[${i}] ${formatPayloadError(v)}`,
        });
      }
      // requiresResident default is true.
      const requiresResident = def.requiresResident !== false;
      if (requiresResident && items[i].residentId === undefined) {
        return res.status(400).json({
          success: false,
          error: `items[${i}] residentId is required for tracker '${def.slug}'`,
        });
      }
    }

    const definitionId = await findDefinitionIdBySlug(def.slug);
    if (definitionId === null) {
      // Unexpected — the seeder runs at boot. Fail loud.
      console.error(
        `[trackers] tracker_definitions row missing for slug '${def.slug}'`,
      );
      return res
        .status(500)
        .json({ success: false, error: "Tracker definition not seeded" });
    }

    const facilityNumber = getFacilityNumber(req);
    const actor = getActor(req);
    const reqCtx = getReqCtx(req);

    const results = await bulkInsertEntries(
      facilityNumber,
      items.map((it) => ({
        clientId: it.clientId,
        residentId: it.residentId ?? null,
        shift: it.shift ?? null,
        occurredAt: it.occurredAt,
        payload: it.payload,
        isIncident: it.isIncident,
      })),
      {
        slug: def.slug,
        trackerDefinitionId: definitionId,
        actor,
        reqCtx,
      },
    );

    const summary = {
      ok: results.length,
      duplicates: results.filter((r) => r.duplicate).length,
      failed: 0,
    };

    return res.json({
      success: true,
      data: {
        items: results.map((r) => ({
          clientId: r.clientId,
          data: r.entry,
          duplicate: r.duplicate,
        })),
        summary,
      },
    });
  } catch (err) {
    if (err instanceof TrackerClientIdSlugMismatchError) {
      // Cross-tracker clientId reuse — same 409 contract as the single-POST
      // defense-in-depth check. The whole batch was rolled back. (M1)
      return res.status(409).json({
        success: false,
        error: "clientId already used for a different tracker",
      });
    }
    console.error("[trackers] POST /:slug/entries/bulk failed", err);
    return res
      .status(500)
      .json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// CREATE single entry (idempotent)
// ─────────────────────────────────────────────────────────────────────────────

entriesRouter.post(
  "/:slug/entries",
  trackerIdempotencyMiddleware,
  async (req, res) => {
    try {
      // Express 5's RequestHandler overload with chained middleware widens
      // params to `string | string[]`; coerce to string for the registry
      // lookup. The router only registers single-segment :slug captures.
      const slug = String(req.params.slug ?? "");
      const def = getDefinition(slug);
      if (!def || def.isActive === false) {
        return res
          .status(404)
          .json({ success: false, error: "Tracker not found" });
      }

      const parsed = singleEntryBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ success: false, error: zodErrorMessage(parsed.error) });
      }
      const body = parsed.data;

      // Idempotency hit: short-circuit with the existing row.
      const dupe = (res.locals as TrackerLocals).duplicateEntry;
      if (dupe) {
        // Defense-in-depth: confirm the existing row belongs to the same
        // tracker slug. If a client reused a UUID across trackers, treat it
        // as a fresh insert attempt that will collide on the unique index
        // — surface a 409.
        if (dupe.trackerSlug !== def.slug) {
          return res.status(409).json({
            success: false,
            error: "clientId already used for a different tracker",
          });
        }
        return res
          .status(200)
          .json({ success: true, data: dupe, duplicate: true });
      }

      // Payload validation.
      const v = validatePayload(def.slug, body.payload);
      if (!v.ok) {
        return res
          .status(400)
          .json({ success: false, error: formatPayloadError(v) });
      }

      // Resident requirement check.
      const requiresResident = def.requiresResident !== false;
      if (requiresResident && body.residentId === undefined) {
        return res.status(400).json({
          success: false,
          error: `residentId is required for tracker '${def.slug}'`,
        });
      }

      const definitionId = await findDefinitionIdBySlug(def.slug);
      if (definitionId === null) {
        console.error(
          `[trackers] tracker_definitions row missing for slug '${def.slug}'`,
        );
        return res
          .status(500)
          .json({ success: false, error: "Tracker definition not seeded" });
      }

      const facilityNumber = getFacilityNumber(req);
      const actor = getActor(req);
      const reqCtx = getReqCtx(req);
      const now = Date.now();

      // Race-window guard: another request with the same clientId could land
      // between the middleware lookup and our insert. Catch that here and
      // re-fetch the existing row.
      //
      // insertEntry now writes the audit row inside the same transaction as
      // the entry insert (M8). No separate writeTrackerAudit call here.
      let row;
      try {
        row = await insertEntry(
          {
            clientId: body.clientId,
            trackerSlug: def.slug,
            trackerDefinitionId: definitionId,
            facilityNumber,
            residentId: body.residentId ?? null,
            shift: body.shift ?? null,
            occurredAt: body.occurredAt,
            reportedByFacilityAccountId: actor.facilityAccountId,
            reportedByStaffId: actor.staffId ?? null,
            reportedByDisplayName: actor.displayName,
            reportedByRole: actor.role,
            payload: JSON.stringify(body.payload),
            status: "active",
            isIncident: body.isIncident === true ? 1 : 0,
            createdAt: now,
            updatedAt: now,
          },
          { actor, facilityNumber, reqCtx },
        );
      } catch (err) {
        // PG unique-violation code is 23505. Drizzle wraps the error but
        // exposes it via `.cause` or `.code`.
        const code = (err as { code?: string }).code;
        if (code === "23505") {
          const existing = await findEntryByClientId(
            facilityNumber,
            body.clientId,
          );
          if (existing) {
            return res
              .status(200)
              .json({ success: true, data: existing, duplicate: true });
          }
        }
        throw err;
      }

      return res.status(201).json({
        success: true,
        data: row,
        duplicate: false,
      });
    } catch (err) {
      console.error("[trackers] POST /:slug/entries failed", err);
      return res
        .status(500)
        .json({ success: false, error: "Internal error" });
    }
  },
);

// ─────────────────────────────────────────────────────────────────────────────
// GET single entry by id
// ─────────────────────────────────────────────────────────────────────────────

entriesRouter.get("/entries/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid id" });
    }
    const row = await getEntryById(id, getFacilityNumber(req));
    if (!row) {
      // Existence-leak avoidance: 404 for both missing and wrong-tenant.
      return res.status(404).json({ success: false, error: "Not found" });
    }
    return res.json({ success: true, data: row });
  } catch (err) {
    console.error("[trackers] GET /entries/:id failed", err);
    return res
      .status(500)
      .json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH single entry (versioned)
// ─────────────────────────────────────────────────────────────────────────────

entriesRouter.patch("/entries/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid id" });
    }

    const parsed = patchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res
        .status(400)
        .json({ success: false, error: zodErrorMessage(parsed.error) });
    }
    const patch = parsed.data;

    const facilityNumber = getFacilityNumber(req);

    // Need the existing row to know which tracker slug to validate the
    // payload against.
    const existing = await getEntryById(id, facilityNumber);
    if (!existing) {
      return res.status(404).json({ success: false, error: "Not found" });
    }

    // If payload is in the patch, re-validate with the tracker's schema.
    if (patch.payload !== undefined) {
      const v = validatePayload(existing.trackerSlug, patch.payload);
      if (!v.ok) {
        return res
          .status(400)
          .json({ success: false, error: formatPayloadError(v) });
      }
    }

    const updated = await updateEntry(
      id,
      facilityNumber,
      {
        payload: patch.payload,
        shift: patch.shift,
        occurredAt: patch.occurredAt,
        isIncident: patch.isIncident,
        changeReason: patch.changeReason,
      },
      getActor(req),
      getReqCtx(req),
    );
    return res.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof TrackerNotFoundError) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    console.error("[trackers] PATCH /entries/:id failed", err);
    return res
      .status(500)
      .json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE single entry (soft delete)
// ─────────────────────────────────────────────────────────────────────────────

entriesRouter.delete("/entries/:id", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid id" });
    }

    const facilityNumber = getFacilityNumber(req);
    const updated = await softDeleteEntry(
      id,
      facilityNumber,
      getActor(req),
      getReqCtx(req),
    );
    return res.json({ success: true, data: updated });
  } catch (err) {
    if (err instanceof TrackerNotFoundError) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    console.error("[trackers] DELETE /entries/:id failed", err);
    return res
      .status(500)
      .json({ success: false, error: "Internal error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// LIST versions of a single entry
// ─────────────────────────────────────────────────────────────────────────────

entriesRouter.get("/entries/:id/versions", async (req, res) => {
  try {
    const id = parseId(req.params.id);
    if (id === null) {
      return res
        .status(400)
        .json({ success: false, error: "Invalid id" });
    }
    const versions = await listVersions(id, getFacilityNumber(req));
    if (versions === null) {
      return res.status(404).json({ success: false, error: "Not found" });
    }
    return res.json({ success: true, data: versions });
  } catch (err) {
    console.error("[trackers] GET /entries/:id/versions failed", err);
    return res
      .status(500)
      .json({ success: false, error: "Internal error" });
  }
});

