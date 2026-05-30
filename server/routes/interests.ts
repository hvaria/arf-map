// NEW: expression-of-interest — job seeker ↔ facility connection layer
import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import {
  storage,
  getInterestsByFacilityAsync,
  getInterestsBySeekerAsync,
  getApplicantProfileDetail,
} from "../storage";
import { requireJobSeekerAuth } from "../middleware/requireJobSeekerAuth";
import { interestStatusSchema, applicantNoteInputSchema } from "@shared/schema";
import type { ApplicantInterest } from "@shared/schema";
import { respondError, AppError } from "../lib/respondError";

export const interestsRouter = Router();

function requireFacilityAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

// Phase 7 — strip the internal integer PK from any applicant_interests wire
// payload. Responses expose `externalId` only; the integer `id` is purely
// internal-FK glue and never crosses the wire.
function interestToWire(i: ApplicantInterest) {
  const { id: _internalId, jobId: _internalJobId, ...rest } = i;
  return rest;
}

const submitSchema = z.object({
  facilityNumber: z.string().min(1, "Facility number is required"),
  // Phase 7 — the FE no longer has the integer jobId; submissions identify
  // the specific posting by its `externalId` (the nanoid). Omit for
  // facility-level interest (legacy behavior).
  jobExternalId: z.string().min(4).max(32).optional(),
  roleInterest: z.string().optional(),
  message: z.string().max(500).optional(),
});

const statusUpdateSchema = z.object({
  status: interestStatusSchema,
});

const EXTERNAL_ID_REGEX = /^[A-Za-z0-9_-]{4,32}$/;

// ── Job Seeker endpoints ──────────────────────────────────────────────────────

/** POST /api/jobseeker/interests — submit or update interest in a facility */
interestsRouter.post("/jobseeker/interests", requireJobSeekerAuth, async (req, res, next) => {
  try {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const { facilityNumber, jobExternalId, roleInterest, message } = parsed.data;
    // Resolve the public job external id to the internal integer PK for the
    // (facility, job) match check + FK relationship. Anonymous integer ids
    // are never accepted on the wire from this endpoint.
    let jobId: number | undefined;
    if (jobExternalId != null) {
      const job = await storage.getJobPostingByExternalId(jobExternalId);
      if (!job || job.facilityNumber !== facilityNumber) {
        return res.status(400).json({ message: "Job does not belong to this facility" });
      }
      jobId = job.id;
    }
    const interest = await storage.upsertApplicantInterest(
      req.session.jobSeekerId!,
      facilityNumber,
      { jobId, roleInterest, message }
    );
    res.status(200).json(interestToWire(interest));
  } catch (err) {
    next(err);
  }
});

/** GET /api/jobseeker/interests — list all my interests with facility names */
interestsRouter.get("/jobseeker/interests", requireJobSeekerAuth, async (req, res, next) => {
  try {
    const interests = await getInterestsBySeekerAsync(req.session.jobSeekerId!);
    res.json(interests);
  } catch (err) {
    next(err);
  }
});

/**
 * DELETE /api/jobseeker/interests/:externalId — withdraw interest
 * Phase 7: URL param is the nanoid `external_id`, not the integer PK.
 */
interestsRouter.delete("/jobseeker/interests/:externalId", requireJobSeekerAuth, async (req, res, next) => {
  try {
    const externalId = String(req.params.externalId ?? "");
    if (!EXTERNAL_ID_REGEX.test(externalId)) {
      return res.status(400).json({ message: "Invalid id" });
    }
    const deleted = await storage.deleteApplicantInterestByExternalId(
      externalId,
      req.session.jobSeekerId!,
    );
    if (!deleted) return res.status(404).json({ message: "Interest not found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

// ── Facility endpoints ────────────────────────────────────────────────────────

/** GET /api/facility/applicants — list applicants interested in my facility */
interestsRouter.get("/facility/applicants", requireFacilityAuth, async (req, res, next) => {
  try {
    const applicants = await getInterestsByFacilityAsync(req.user!.facilityNumber);
    res.json(
      applicants.map((a) => ({
        ...a,
        // Phase 2 R2: jobTypes is JSONB. Drizzle returns the parsed array
        // directly; we fall back to safe-parse for legacy text rows that
        // may slip through during the post-migration warm-up.
        jobTypes: Array.isArray(a.jobTypes)
          ? a.jobTypes
          : typeof a.jobTypes === "string" && a.jobTypes.length > 0
            ? (() => {
                try {
                  const parsed: unknown = JSON.parse(a.jobTypes);
                  return Array.isArray(parsed)
                    ? parsed.filter((v): v is string => typeof v === "string")
                    : [];
                } catch {
                  return [];
                }
              })()
            : [],
      }))
    );
  } catch (err) {
    next(err);
  }
});

/**
 * PATCH /api/facility/applicants/:externalId — update status (viewed / shortlisted)
 * Phase 7: URL param is the nanoid `external_id`, not the integer PK.
 */
interestsRouter.patch("/facility/applicants/:externalId", requireFacilityAuth, async (req, res, next) => {
  try {
    const externalId = String(req.params.externalId ?? "");
    if (!EXTERNAL_ID_REGEX.test(externalId)) {
      return res.status(400).json({ message: "Invalid id" });
    }

    const parsed = statusUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }

    const updated = await storage.updateApplicantInterestStatusByExternalId(
      externalId,
      req.user!.facilityNumber,
      parsed.data.status,
      String(req.user!.id),
    );
    if (!updated) return res.status(404).json({ message: "Applicant not found" });
    res.json(interestToWire(updated));
  } catch (err) {
    next(err);
  }
});

/**
 * GET /api/facility/applicants/:externalId — full applicant profile for the
 * facility review drawer. Tenancy enforced in storage (facility_number scope);
 * a foreign/unknown id 404s with no existence leak. Opening a `pending`
 * applicant auto-transitions it to `viewed` (idempotent, recorded in history).
 */
interestsRouter.get("/facility/applicants/:externalId", requireFacilityAuth, async (req, res) => {
  try {
    const externalId = String(req.params.externalId ?? "");
    if (!EXTERNAL_ID_REGEX.test(externalId)) {
      throw new AppError("VALIDATION_ERROR", "Invalid id", 400);
    }
    const facilityNumber = req.user!.facilityNumber;
    const result = await getApplicantProfileDetail(externalId, facilityNumber);
    if (!result) {
      throw new AppError("NOT_FOUND", "Applicant not found.", 404);
    }

    // Auto-advance pending → viewed on first open (recorded in status history).
    if (result.detail.interest.status === "pending") {
      await storage.updateApplicantInterestStatusByExternalId(
        externalId,
        facilityNumber,
        "viewed",
        String(req.user!.id),
      );
      result.detail.interest.status = "viewed";
    }

    res.json(result.detail);
  } catch (err) {
    respondError(res, err);
  }
});

/** GET /api/facility/applicants/:externalId/notes — recruiter notes (newest first) */
interestsRouter.get("/facility/applicants/:externalId/notes", requireFacilityAuth, async (req, res) => {
  try {
    const externalId = String(req.params.externalId ?? "");
    if (!EXTERNAL_ID_REGEX.test(externalId)) {
      throw new AppError("VALIDATION_ERROR", "Invalid id", 400);
    }
    const facilityNumber = req.user!.facilityNumber;
    const interest = await storage.getApplicantInterestByExternalId(externalId, facilityNumber);
    if (!interest) throw new AppError("NOT_FOUND", "Applicant not found.", 404);
    const notes = await storage.listApplicantNotes(interest.id);
    res.json({ notes });
  } catch (err) {
    respondError(res, err);
  }
});

/** POST /api/facility/applicants/:externalId/notes — add a recruiter note */
interestsRouter.post("/facility/applicants/:externalId/notes", requireFacilityAuth, async (req, res) => {
  try {
    const externalId = String(req.params.externalId ?? "");
    if (!EXTERNAL_ID_REGEX.test(externalId)) {
      throw new AppError("VALIDATION_ERROR", "Invalid id", 400);
    }
    const parsed = applicantNoteInputSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;
    const facilityNumber = req.user!.facilityNumber;
    const interest = await storage.getApplicantInterestByExternalId(externalId, facilityNumber);
    if (!interest) throw new AppError("NOT_FOUND", "Applicant not found.", 404);
    const note = await storage.addApplicantNote(
      interest.id,
      facilityNumber,
      parsed.data.body,
      String(req.user!.id),
    );
    res.status(201).json(note);
  } catch (err) {
    respondError(res, err);
  }
});

/** PATCH /api/facility/applicants/:externalId/notes/:noteExternalId — edit a note */
interestsRouter.patch("/facility/applicants/:externalId/notes/:noteExternalId", requireFacilityAuth, async (req, res) => {
  try {
    const noteExternalId = String(req.params.noteExternalId ?? "");
    if (!EXTERNAL_ID_REGEX.test(noteExternalId)) {
      throw new AppError("VALIDATION_ERROR", "Invalid id", 400);
    }
    const parsed = applicantNoteInputSchema.safeParse(req.body);
    if (!parsed.success) throw parsed.error;
    const updated = await storage.updateApplicantNoteByExternalId(
      noteExternalId,
      req.user!.facilityNumber,
      parsed.data.body,
      String(req.user!.id),
    );
    if (!updated) throw new AppError("NOT_FOUND", "Note not found.", 404);
    res.json(updated);
  } catch (err) {
    respondError(res, err);
  }
});

/** DELETE /api/facility/applicants/:externalId/notes/:noteExternalId — soft-delete a note */
interestsRouter.delete("/facility/applicants/:externalId/notes/:noteExternalId", requireFacilityAuth, async (req, res) => {
  try {
    const noteExternalId = String(req.params.noteExternalId ?? "");
    if (!EXTERNAL_ID_REGEX.test(noteExternalId)) {
      throw new AppError("VALIDATION_ERROR", "Invalid id", 400);
    }
    const ok = await storage.softDeleteApplicantNoteByExternalId(
      noteExternalId,
      req.user!.facilityNumber,
      String(req.user!.id),
    );
    if (!ok) throw new AppError("NOT_FOUND", "Note not found.", 404);
    res.status(204).end();
  } catch (err) {
    respondError(res, err);
  }
});
