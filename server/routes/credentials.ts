// Job seeker credentials — license / certification / clearance management.
// All routes are scoped to the authenticated job seeker via requireJobSeekerAuth.
//
// This router is the Phase 0 reference implementation of the canonical error
// envelope (see server/lib/respondError.ts). All error responses go through
// `respondError` / `AppError` and produce the shape `{ code, message, details? }`.
import { Router } from "express";
import { storage } from "../storage";
import { requireJobSeekerAuth } from "../middleware/requireJobSeekerAuth";
import { credentialInputSchema } from "@shared/schema";
import { respondError, AppError } from "../lib/respondError";

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
credentialsRouter.get("/jobseeker/credentials", requireJobSeekerAuth, async (req, res) => {
  try {
    const rows = await storage.listJobSeekerCredentials(req.session.jobSeekerId!);
    res.json(rows);
  } catch (err) {
    return respondError(res, err);
  }
});

/** POST /api/jobseeker/credentials — create a new credential */
credentialsRouter.post("/jobseeker/credentials", requireJobSeekerAuth, async (req, res) => {
  const parsed = credentialInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, parsed.error);
  }
  try {
    const row = await storage.createJobSeekerCredential(
      req.session.jobSeekerId!,
      parsed.data
    );
    res.status(201).json(row);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return respondError(
        res,
        new AppError(
          "CREDENTIAL_DUPLICATE",
          "You already have this credential on file.",
          409,
        ),
      );
    }
    return respondError(res, err);
  }
});

/** PUT /api/jobseeker/credentials/:id — update a credential owned by this seeker */
credentialsRouter.put("/jobseeker/credentials/:id", requireJobSeekerAuth, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    return respondError(
      res,
      new AppError("INVALID_PARAM", "Invalid id", 400),
    );
  }

  const parsed = credentialInputSchema.safeParse(req.body);
  if (!parsed.success) {
    return respondError(res, parsed.error);
  }
  try {
    const updated = await storage.updateJobSeekerCredential(
      id,
      req.session.jobSeekerId!,
      parsed.data
    );
    if (!updated) {
      return respondError(
        res,
        new AppError("CREDENTIAL_NOT_FOUND", "Credential not found", 404),
      );
    }
    res.json(updated);
  } catch (err) {
    if (isUniqueViolation(err)) {
      return respondError(
        res,
        new AppError(
          "CREDENTIAL_DUPLICATE",
          "You already have this credential on file.",
          409,
        ),
      );
    }
    return respondError(res, err);
  }
});

/** DELETE /api/jobseeker/credentials/:id — remove a credential */
credentialsRouter.delete("/jobseeker/credentials/:id", requireJobSeekerAuth, async (req, res) => {
  const id = parseInt(req.params.id as string, 10);
  if (isNaN(id)) {
    return respondError(
      res,
      new AppError("INVALID_PARAM", "Invalid id", 400),
    );
  }
  try {
    const deleted = await storage.deleteJobSeekerCredential(id, req.session.jobSeekerId!);
    if (!deleted) {
      return respondError(
        res,
        new AppError("CREDENTIAL_NOT_FOUND", "Credential not found", 404),
      );
    }
    res.json({ ok: true });
  } catch (err) {
    return respondError(res, err);
  }
});
