/**
 * Facility profile — public-listing + report-letterhead editable fields.
 *
 * Auth: every mutating endpoint reuses the Passport-based facility session
 * (`req.isAuthenticated()` + `req.user.facilityNumber`). Tenant isolation is
 * enforced at the storage layer — every read/write filters by the session
 * facility number, never by a client-supplied path/body param.
 *
 * Logo storage: reuses the `FlyVolumeAdapter` from `server/ops/evidenceStorage.ts`
 * but writes under a sibling `branding/` subdir so the customer FACILITY's logo
 * stays visually separate from raw evidence uploads. Logos are public (rendered
 * on the public listing + PDF letterheads of every report); GET is open, all
 * mutations require the facility session.
 */

import { Router } from "express";
import type { Request, Response, NextFunction } from "express";
import { createReadStream } from "node:fs";
import { stat, unlink } from "node:fs/promises";
import { z } from "zod";
import multer from "multer";

import { storage } from "../storage";
import {
  FACILITY_LOGO_MAX_BYTES,
  FACILITY_LOGO_ALLOWED_MIMES,
  FACILITY_LANGUAGES,
  FACILITY_CARE_TYPES,
  type FacilityCareType,
  type DayOfWeek,
} from "@shared/facility-profile";
import { getStorageAdapter } from "../ops/evidenceStorage";
import { recordAudit } from "../ops/auditStorage";
import { getFacilityByNumberAsync } from "../storage";
import { serialiseFacilityOverrideRow } from "../lib/jsonbWireCompat";

export const facilityProfileRouter = Router();

// ─────────────────────────────────────────────────────────────────────────────
// Auth gate — facility session (Passport.LocalStrategy)
// ─────────────────────────────────────────────────────────────────────────────

function requireFacilityAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

// ─────────────────────────────────────────────────────────────────────────────
// Zod schemas — strict over the union of original 4 + 26 additive columns.
// JSON-shaped columns (hoursOfOperation, languagesSpoken, careTypesOffered,
// accreditations) are validated as parsed shapes here and persist to JSONB
// columns (Phase 2 R2) — the storage layer passes the JS values through to
// Drizzle without any JSON.stringify boilerplate.
// ─────────────────────────────────────────────────────────────────────────────

const LANGUAGE_CODES = FACILITY_LANGUAGES.map((l) => l.code) as ReadonlyArray<
  (typeof FACILITY_LANGUAGES)[number]["code"]
>;

const hoursEntrySchema = z
  .object({
    open: z.string().regex(/^\d{2}:\d{2}$/, "Hours must be HH:MM"),
    close: z.string().regex(/^\d{2}:\d{2}$/, "Hours must be HH:MM"),
    closed: z.boolean().optional(),
  })
  .strict();

const DAY_KEYS: readonly DayOfWeek[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
] as const;

const hoursOfOperationSchema = z
  .object(
    DAY_KEYS.reduce(
      (acc, day) => {
        acc[day] = hoursEntrySchema.optional();
        return acc;
      },
      {} as Record<DayOfWeek, z.ZodOptional<typeof hoursEntrySchema>>,
    ),
  )
  .strict();

const CURRENT_YEAR = new Date().getFullYear();

const profileUpdateSchema = z
  .object({
    // ── Original 4 (existing /api/facility/details schema) ──────────────────
    phone: z.string().max(40).optional(),
    description: z.string().max(4000).optional(),
    website: z.union([z.string().url(), z.literal("")]).optional(),
    email: z.union([z.string().email(), z.literal("")]).optional(),

    // ── Identity & branding ────────────────────────────────────────────────
    dbaName: z.string().max(200).optional(),
    // logoStorageUri / logoMimeType / logoUpdatedAt are NOT settable via PUT —
    // they're written by the logo upload route only.

    // ── Mailing address ────────────────────────────────────────────────────
    mailingAddressLine1: z.string().max(200).optional(),
    mailingAddressLine2: z.string().max(200).optional(),
    mailingCity: z.string().max(120).optional(),
    mailingState: z
      .string()
      .regex(/^[A-Z]{2}$/, "State must be a 2-letter code")
      .optional()
      .or(z.literal("")),
    mailingZip: z
      .string()
      .regex(/^\d{5}(?:-\d{4})?$/, "ZIP must be 5 or 9 digits")
      .optional()
      .or(z.literal("")),

    // ── Operations: hours / languages / care types ─────────────────────────
    hoursOfOperation: hoursOfOperationSchema.optional(),
    languagesSpoken: z
      .array(z.enum(LANGUAGE_CODES as [string, ...string[]]))
      .max(LANGUAGE_CODES.length)
      .optional(),
    careTypesOffered: z
      .array(z.enum(FACILITY_CARE_TYPES as readonly string[] as [string, ...string[]]))
      .max(FACILITY_CARE_TYPES.length)
      .optional(),

    // ── Administrator ──────────────────────────────────────────────────────
    administratorName: z.string().max(200).optional(),
    administratorPhone: z.string().max(40).optional(),
    administratorEmail: z.union([z.string().email(), z.literal("")]).optional(),
    administratorLicenseNumber: z.string().max(60).optional(),

    // ── Operations / business detail ───────────────────────────────────────
    // taxIdLast4: LAST 4 digits of the EIN only. Full EIN is never stored.
    taxIdLast4: z
      .string()
      .regex(/^\d{4}$/, "Tax ID must be the last 4 digits")
      .optional()
      .or(z.literal("")),
    yearEstablished: z
      .number()
      .int()
      .min(1900)
      .max(CURRENT_YEAR)
      .optional(),
    accreditations: z.array(z.string().max(200)).max(50).optional(),

    // ── Social ─────────────────────────────────────────────────────────────
    facebookUrl: z.union([z.string().url(), z.literal("")]).optional(),
    instagramUrl: z.union([z.string().url(), z.literal("")]).optional(),
    linkedinUrl: z.union([z.string().url(), z.literal("")]).optional(),

    // ── Report letterhead ──────────────────────────────────────────────────
    reportHeaderText: z.string().max(500).optional(),
    reportFooterText: z.string().max(500).optional(),
  })
  .strict();

type ProfileUpdate = z.infer<typeof profileUpdateSchema>;

/** Map the parsed PUT body to the DB column shape. The four JSON-shaped
 * columns (hoursOfOperationJson, languagesSpokenJson, careTypesOfferedJson,
 * accreditationsJson) are JSONB in Postgres now (Phase 2 R2) — Drizzle
 * accepts the JS value directly, no JSON.stringify needed. */
function toOverrideColumns(input: ProfileUpdate): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const passthrough: (keyof ProfileUpdate)[] = [
    "phone",
    "description",
    "website",
    "email",
    "dbaName",
    "mailingAddressLine1",
    "mailingAddressLine2",
    "mailingCity",
    "mailingState",
    "mailingZip",
    "administratorName",
    "administratorPhone",
    "administratorEmail",
    "administratorLicenseNumber",
    "taxIdLast4",
    "yearEstablished",
    "facebookUrl",
    "instagramUrl",
    "linkedinUrl",
    "reportHeaderText",
    "reportFooterText",
  ];
  for (const k of passthrough) {
    if (input[k] !== undefined) {
      // Treat empty string as "clear" — store null so the public listing
      // falls back to the CCLD value.
      const v = input[k];
      out[k] = v === "" ? null : v;
    }
  }
  if (input.hoursOfOperation !== undefined) {
    out.hoursOfOperationJson = input.hoursOfOperation;
  }
  if (input.languagesSpoken !== undefined) {
    out.languagesSpokenJson = input.languagesSpoken;
  }
  if (input.careTypesOffered !== undefined) {
    out.careTypesOfferedJson = input.careTypesOffered as FacilityCareType[];
  }
  if (input.accreditations !== undefined) {
    out.accreditationsJson = input.accreditations;
  }
  return out;
}

// Wire-format compatibility (Phase 2 R2): the FacilityOverride row's JSON
// fields flipped from TEXT to JSONB. `serialiseFacilityOverrideRow`
// re-stringifies the affected fields on outbound so the FE wire contract is
// bit-for-bit preserved — a follow-up round can flip the FE to expect
// objects/arrays directly and drop the wrapper.

// ─────────────────────────────────────────────────────────────────────────────
// Multer — in-memory upload capped at FACILITY_LOGO_MAX_BYTES
// ─────────────────────────────────────────────────────────────────────────────

const logoUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: FACILITY_LOGO_MAX_BYTES,
    files: 1,
    fields: 5,
  },
});

const ALLOWED_MIMES = new Set<string>(FACILITY_LOGO_ALLOWED_MIMES);

function extForMime(mime: string): string {
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/svg+xml") return "svg";
  return "bin";
}

function actorIdFromReq(req: Request): string {
  const u = req.user as { username?: string; id?: number } | undefined;
  return u?.username ?? (u?.id != null ? String(u.id) : "unknown");
}

// ─────────────────────────────────────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * GET /api/facility/profile — return the override row + CCLD suggestion
 * payload so the FE can render "Suggested: <value>" hints for empty fields.
 */
facilityProfileRouter.get(
  "/facility/profile",
  requireFacilityAuth,
  async (req, res, next) => {
    try {
      const facilityNumber = req.user!.facilityNumber;
      const [override, ccldRow] = await Promise.all([
        storage.getFacilityOverride(facilityNumber),
        getFacilityByNumberAsync(facilityNumber),
      ]);
      const ccld = ccldRow
        ? {
            phone: ccldRow.phone,
            address: ccldRow.address,
            city: ccldRow.city,
            zip: ccldRow.zip,
            administrator: ccldRow.administrator,
            capacity: ccldRow.capacity ?? 0,
            firstLicenseDate: ccldRow.first_license_date,
          }
        : null;
      res.set("Cache-Control", "private, no-store");
      res.json({ overrides: serialiseFacilityOverrideRow(override ?? null) ?? null, ccld });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * PUT /api/facility/profile — partial update of the override row. Strict zod;
 * unknown keys reject. Empty strings on optional URL/email fields clear the
 * value (set to NULL) so the public listing falls back to CCLD.
 */
facilityProfileRouter.put(
  "/facility/profile",
  requireFacilityAuth,
  async (req, res, next) => {
    try {
      const parsed = profileUpdateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res
          .status(400)
          .json({ message: parsed.error.errors[0].message });
      }
      const facilityNumber = req.user!.facilityNumber;
      const before = await storage.getFacilityOverride(facilityNumber);
      const columns = toOverrideColumns(parsed.data);
      const override = await storage.upsertFacilityOverride(
        facilityNumber,
        columns as Partial<typeof override>,
      );

      // Audit — best-effort. Never roll back the user-visible mutation if
      // the audit table is unavailable.
      try {
        await recordAudit({
          facilityNumber,
          actorId: actorIdFromReq(req),
          actorRole: req.user!.role ?? "facility_admin",
          action: "update",
          entityType: "facility_override",
          entityId: override.id,
          before: before ?? null,
          after: override,
        });
      } catch (auditErr) {
        // eslint-disable-next-line no-console
        console.error("[facilityProfile] audit emit failed", auditErr);
      }

      res.json(serialiseFacilityOverrideRow(override));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/facility/profile/prefill-from-ccld — wrap the storage-layer
 * prefill helper. Idempotent: returns `{ prefilled: [] }` once the row's
 * `prefilledFromCcldAt` is set.
 */
facilityProfileRouter.post(
  "/facility/profile/prefill-from-ccld",
  requireFacilityAuth,
  async (req, res, next) => {
    try {
      const facilityNumber = req.user!.facilityNumber;
      const result = await storage.prefillFacilityOverrideFromCcld(
        facilityNumber,
        actorIdFromReq(req),
      );

      if (result.prefilled.length > 0) {
        try {
          await recordAudit({
            facilityNumber,
            actorId: actorIdFromReq(req),
            actorRole: req.user!.role ?? "facility_admin",
            action: "update",
            entityType: "facility_override",
            entityId: result.override.id,
            after: { prefilledFields: result.prefilled, source: "ccld" },
          });
        } catch (auditErr) {
          // eslint-disable-next-line no-console
          console.error("[facilityProfile] prefill audit emit failed", auditErr);
        }
      }

      res.json({
        override: serialiseFacilityOverrideRow(result.override),
        prefilled: result.prefilled,
      });
    } catch (err) {
      next(err);
    }
  },
);

/**
 * POST /api/facility/profile/logo — multipart upload, single `file` field.
 *
 * Validates mime against FACILITY_LOGO_ALLOWED_MIMES (declared form-data
 * mime). 2 MB cap is enforced by multer (LIMIT_FILE_SIZE → 413). Writes to
 *   <volume>/<facility>/branding/<entityType>/<id>/<sha8>-logo.<ext>
 * via the FlyVolumeAdapter so the file layout is consistent with evidence
 * uploads but lives in a sibling `branding/` subdir.
 */
facilityProfileRouter.post(
  "/facility/profile/logo",
  requireFacilityAuth,
  (req: Request, res: Response, next: NextFunction) => {
    logoUpload.single("file")(req, res, (err: unknown) => {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_FILE_SIZE") {
          return res
            .status(413)
            .json({ message: "Logo exceeds 2 MB limit" });
        }
        return res.status(400).json({ message: err.message });
      }
      if (err) return next(err);
      return next();
    });
  },
  async (req, res, next) => {
    try {
      const facilityNumber = req.user!.facilityNumber;
      const fileBuf = (req as Request & { file?: Express.Multer.File }).file;
      if (!fileBuf) {
        return res
          .status(400)
          .json({ message: "file field is required" });
      }
      const declaredMime = (fileBuf.mimetype || "").toLowerCase();
      if (!ALLOWED_MIMES.has(declaredMime)) {
        return res
          .status(400)
          .json({ message: `Mime ${declaredMime || "unknown"} is not allowed` });
      }
      if (fileBuf.size === 0) {
        return res.status(400).json({ message: "File is empty" });
      }

      const adapter = getStorageAdapter();
      const put = await adapter.put({
        facilityNumber,
        // entityType + entityId provide path stability and let us reuse the
        // adapter's `safePathSegment` pipeline. We use the override row id as
        // the entityId so successive uploads from the same facility share a
        // directory (the sha8 prefix keeps individual files unique).
        entityType: "facility_logo",
        entityId: 0,
        filename: `logo.${extForMime(declaredMime)}`,
        bytes: fileBuf.buffer,
        subdir: "branding",
      });

      // Best-effort cleanup of the previous logo so the Fly volume doesn't
      // accumulate orphaned files on every re-upload.
      const before = await storage.getFacilityOverride(facilityNumber);
      if (before?.logoStorageUri && before.logoStorageUri !== put.uri) {
        try {
          const oldPath = adapter.resolve(before.logoStorageUri);
          await unlink(oldPath);
        } catch {
          // Old file may have been deleted out-of-band; ignore.
        }
      }

      const override = await storage.upsertFacilityOverride(facilityNumber, {
        logoStorageUri: put.uri,
        logoMimeType: declaredMime,
        logoUpdatedAt: Date.now(),
      });

      try {
        await recordAudit({
          facilityNumber,
          actorId: actorIdFromReq(req),
          actorRole: req.user!.role ?? "facility_admin",
          action: "update",
          entityType: "facility_override",
          entityId: override.id,
          after: {
            logoStorageUri: put.uri,
            logoMimeType: declaredMime,
            byteSize: put.byteSize,
            sha256: put.sha256,
          },
        });
      } catch (auditErr) {
        // eslint-disable-next-line no-console
        console.error("[facilityProfile] logo audit emit failed", auditErr);
      }

      res.status(201).json(serialiseFacilityOverrideRow(override));
    } catch (err) {
      next(err);
    }
  },
);

/**
 * GET /api/facility/profile/logo — public (the logo is rendered on the map
 * facility listing alongside the facility name). Streams the bytes with the
 * stored mime + a short cache window.
 *
 * Query: `?n=<facilityNumber>` — required because anonymous callers don't
 * have a session. For authenticated facility callers, falls back to the
 * session facility number when `n` is omitted.
 */
facilityProfileRouter.get("/facility/profile/logo", async (req, res, next) => {
  try {
    const sessionFn = (req.user as { facilityNumber?: string } | undefined)?.facilityNumber;
    const queryFn = typeof req.query.n === "string" ? req.query.n.trim() : "";
    const facilityNumber = queryFn || sessionFn;
    if (!facilityNumber) {
      return res
        .status(400)
        .json({ message: "Facility number is required (use ?n=)" });
    }
    const override = await storage.getFacilityOverride(facilityNumber);
    if (!override?.logoStorageUri || !override.logoMimeType) {
      return res.status(404).json({ message: "Logo not set" });
    }
    const adapter = getStorageAdapter();
    let abs: string;
    try {
      abs = adapter.resolve(override.logoStorageUri);
    } catch {
      return res.status(404).json({ message: "Logo not available" });
    }
    try {
      await stat(abs);
    } catch {
      return res.status(404).json({ message: "Logo file missing" });
    }
    res.setHeader("Content-Type", override.logoMimeType);
    // 5-minute browser cache so an upload propagates quickly to the public
    // listing but we still amortize repeat hits from the same page.
    res.setHeader("Cache-Control", "public, max-age=300");
    const stream = createReadStream(abs);
    stream.on("error", (streamErr) => {
      // eslint-disable-next-line no-console
      console.error("[facilityProfile] logo stream error", streamErr);
      if (!res.headersSent) res.status(500).end();
      else res.destroy(streamErr);
    });
    return stream.pipe(res);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/facility/profile/logo — clear the logo fields on the row AND
 * unlink the file from the volume.
 */
facilityProfileRouter.delete(
  "/facility/profile/logo",
  requireFacilityAuth,
  async (req, res, next) => {
    try {
      const facilityNumber = req.user!.facilityNumber;
      const before = await storage.getFacilityOverride(facilityNumber);
      if (before?.logoStorageUri) {
        try {
          const adapter = getStorageAdapter();
          const abs = adapter.resolve(before.logoStorageUri);
          await unlink(abs);
        } catch {
          // File may already be gone — proceed with the row clear.
        }
      }
      const override = await storage.upsertFacilityOverride(facilityNumber, {
        logoStorageUri: null,
        logoMimeType: null,
        logoUpdatedAt: null,
      });

      try {
        await recordAudit({
          facilityNumber,
          actorId: actorIdFromReq(req),
          actorRole: req.user!.role ?? "facility_admin",
          action: "delete",
          entityType: "facility_override",
          entityId: override.id,
          before: before
            ? {
                logoStorageUri: before.logoStorageUri,
                logoMimeType: before.logoMimeType,
              }
            : null,
        });
      } catch (auditErr) {
        // eslint-disable-next-line no-console
        console.error("[facilityProfile] logo-delete audit failed", auditErr);
      }

      res.json(serialiseFacilityOverrideRow(override));
    } catch (err) {
      next(err);
    }
  },
);
