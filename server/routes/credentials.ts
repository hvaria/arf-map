// Job seeker credentials — license / certification / clearance management.
// All routes are scoped to the authenticated job seeker via requireJobSeekerAuth.
import { Router } from "express";
import { storage } from "../storage";
import { requireJobSeekerAuth } from "../middleware/requireJobSeekerAuth";
import { credentialInputSchema } from "@shared/schema";

export const credentialsRouter = Router();

// Postgres unique-violation SQLSTATE. The partial-unique index
// `uniq_credentials_account_kind_license` surfaces here when a seeker tries to
// store the same (kind, license_number) twice.
const PG_UNIQUE_VIOLATION = "23505";

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

/** GET /api/jobseeker/credentials — list this seeker's credentials */
credentialsRouter.get("/jobseeker/credentials", requireJobSeekerAuth, async (req, res, next) => {
  try {
    const rows = await storage.listJobSeekerCredentials(req.session.jobSeekerId!);
    res.json(rows);
  } catch (err) {
    next(err);
  }
});

/** POST /api/jobseeker/credentials — create a new credential */
credentialsRouter.post("/jobseeker/credentials", requireJobSeekerAuth, async (req, res, next) => {
  try {
    const parsed = credentialInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    try {
      const row = await storage.createJobSeekerCredential(
        req.session.jobSeekerId!,
        parsed.data
      );
      res.status(201).json(row);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res
          .status(409)
          .json({ message: "You already have this credential on file." });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

/** PUT /api/jobseeker/credentials/:id — update a credential owned by this seeker */
credentialsRouter.put("/jobseeker/credentials/:id", requireJobSeekerAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

    const parsed = credentialInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    try {
      const updated = await storage.updateJobSeekerCredential(
        id,
        req.session.jobSeekerId!,
        parsed.data
      );
      if (!updated) return res.status(404).json({ message: "Credential not found" });
      res.json(updated);
    } catch (err) {
      if (isUniqueViolation(err)) {
        return res
          .status(409)
          .json({ message: "You already have this credential on file." });
      }
      throw err;
    }
  } catch (err) {
    next(err);
  }
});

/** DELETE /api/jobseeker/credentials/:id — remove a credential */
credentialsRouter.delete("/jobseeker/credentials/:id", requireJobSeekerAuth, async (req, res, next) => {
  try {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
    const deleted = await storage.deleteJobSeekerCredential(id, req.session.jobSeekerId!);
    if (!deleted) return res.status(404).json({ message: "Credential not found" });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
