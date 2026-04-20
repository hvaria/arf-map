// NEW: expression-of-interest — job seeker ↔ facility connection layer
import { Router } from "express";
import { z } from "zod";
import type { Request, Response, NextFunction } from "express";
import { storage, getInterestsByFacility, getInterestsBySeeker } from "../storage";
import { requireJobSeekerAuth } from "../middleware/requireJobSeekerAuth";
import { interestStatusSchema } from "@shared/schema";

export const interestsRouter = Router();

function requireFacilityAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated() || !req.user) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

const submitSchema = z.object({
  facilityNumber: z.string().min(1, "Facility number is required"),
  roleInterest: z.string().optional(),
  message: z.string().max(500).optional(),
});

const statusUpdateSchema = z.object({
  status: interestStatusSchema,
});

// ── Job Seeker endpoints ──────────────────────────────────────────────────────

/** POST /api/jobseeker/interests — submit or update interest in a facility */
interestsRouter.post("/jobseeker/interests", requireJobSeekerAuth, async (req, res, next) => {
  try {
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const { facilityNumber, roleInterest, message } = parsed.data;
    const interest = await storage.upsertApplicantInterest(
      req.session.jobSeekerId!,
      facilityNumber,
      { roleInterest, message }
    );
    res.status(200).json(interest);
  } catch (err) {
    next(err);
  }
});

/** GET /api/jobseeker/interests — list all my interests with facility names */
interestsRouter.get("/jobseeker/interests", requireJobSeekerAuth, async (req, res, next) => {
  try {
    const interests = getInterestsBySeeker(req.session.jobSeekerId!);
    res.json(interests);
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/jobseeker/interests/:id — withdraw interest */
interestsRouter.delete("/jobseeker/interests/:id", requireJobSeekerAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const deleted = await storage.deleteApplicantInterest(id, req.session.jobSeekerId!);
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
    const applicants = getInterestsByFacility(req.user!.facilityNumber);
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

/** PATCH /api/facility/applicants/:id — update status (viewed / shortlisted) */
interestsRouter.patch("/facility/applicants/:id", requireFacilityAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const parsed = statusUpdateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }

    const updated = await storage.updateApplicantInterestStatus(
      id,
      req.user!.facilityNumber,
      parsed.data.status
    );
    if (!updated) return res.status(404).json({ message: "Applicant not found" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});
