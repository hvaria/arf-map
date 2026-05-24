// NEW: expression-of-interest — job seeker ↔ facility connection layer
import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { storage, getInterestsByFacilityAsync, getInterestsBySeekerAsync } from "../storage";
import { requireJobSeekerAuth } from "../middleware/requireJobSeekerAuth";
import { interestStatusSchema } from "@shared/schema";
import type { ApplicantInterest } from "@shared/schema";

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
        jobTypes: a.jobTypes ? JSON.parse(a.jobTypes) : [],
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
    );
    if (!updated) return res.status(404).json({ message: "Applicant not found" });
    res.json(interestToWire(updated));
  } catch (err) {
    next(err);
  }
});
