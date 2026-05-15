// Job seeker work experience — LinkedIn-style employment history management.
// All routes are scoped to the authenticated job seeker via requireJobSeekerAuth.
// No unique constraint on this table — a seeker can legitimately have multiple
// stints at the same company, so no 409 / unique-violation handling needed.
import { Router } from "express";
import { storage } from "../storage";
import { requireJobSeekerAuth } from "../middleware/requireJobSeekerAuth";
import { workExperienceInputSchema } from "@shared/schema";

export const workExperienceRouter = Router();

/** GET /api/jobseeker/work-experience — list this seeker's work history */
workExperienceRouter.get("/jobseeker/work-experience", requireJobSeekerAuth, async (req, res, next) => {
  try {
    const rows = await storage.listJobSeekerWorkExperience(req.session.jobSeekerId!);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/** POST /api/jobseeker/work-experience — create a new work experience entry */
workExperienceRouter.post("/jobseeker/work-experience", requireJobSeekerAuth, async (req, res, next) => {
  try {
    const parsed = workExperienceInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const row = await storage.createJobSeekerWorkExperience(
      req.session.jobSeekerId!,
      parsed.data
    );
    res.status(201).json(row);
  } catch (err) {
    next(err);
  }
});

/** PUT /api/jobseeker/work-experience/:id — update an entry owned by this seeker */
workExperienceRouter.put("/jobseeker/work-experience/:id", requireJobSeekerAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const parsed = workExperienceInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const updated = await storage.updateJobSeekerWorkExperience(
      id,
      req.session.jobSeekerId!,
      parsed.data
    );
    if (!updated) return res.status(404).json({ message: "Work experience not found" });
    res.json(updated);
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/jobseeker/work-experience/:id — remove an entry */
workExperienceRouter.delete("/jobseeker/work-experience/:id", requireJobSeekerAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const deleted = await storage.deleteJobSeekerWorkExperience(id, req.session.jobSeekerId!);
    if (!deleted) return res.status(404).json({ message: "Work experience not found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
