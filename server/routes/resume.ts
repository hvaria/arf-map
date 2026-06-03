// Job seeker resume export — generates an ATS-friendly PDF resume from the
// seeker's own saved profile data (profile row + account email + credentials
// + work history). Scoped to the authenticated job seeker via
// requireJobSeekerAuth — a seeker can only ever export their own resume.
//
// The mapping from stored data → resume view model lives in the shared,
// single-source mapper `@shared/resume` (buildResumeViewModel); this router
// only gathers the rows, runs the mapper, and streams the rendered PDF. No
// resume-shaping logic lives here.
import { Router } from "express";
import { storage } from "../storage";
import { requireJobSeekerAuth } from "../middleware/requireJobSeekerAuth";
import { buildResumeViewModel, resumeFileName } from "@shared/resume";
import { renderResumePdf } from "../resume/resumeRenderer";
import { respondError, AppError } from "../lib/respondError";

export const resumeRouter = Router();

/**
 * GET /api/jobseeker/resume.pdf — download the signed-in seeker's resume.
 *
 * Returns 422 RESUME_INCOMPLETE (before any bytes are streamed) when the
 * profile has no name — a resume with no name is not a usable document, so we
 * ask the seeker to finish their profile rather than emit a nameless PDF.
 * Every other field is best-effort: empty sections are simply omitted.
 */
resumeRouter.get("/jobseeker/resume.pdf", requireJobSeekerAuth, async (req, res) => {
  try {
    const accountId = req.session.jobSeekerId!;

    const [account, profile, credentials, workExperience] = await Promise.all([
      storage.getJobSeekerAccount(accountId),
      storage.getJobSeekerProfile(accountId),
      storage.listJobSeekerCredentials(accountId),
      storage.listJobSeekerWorkExperience(accountId),
    ]);

    if (!account) {
      throw new AppError("NOT_FOUND", "Account not found", 404);
    }

    const vm = buildResumeViewModel({
      profile: profile ?? null,
      email: account.email,
      credentials,
      workExperience,
    });

    if (!vm.isMinimallyComplete) {
      throw new AppError(
        "RESUME_INCOMPLETE",
        "Add your name to your profile before downloading a resume.",
        422,
        { missingFields: ["Full name", ...vm.missingFields] },
      );
    }

    // Photo is shown by default; `?photo=0` (or `false`/`no`) drops it for a
    // pure text-only resume targeting corporate ATS / bias-conscious screening
    // (per the ATS consulting review — photos add no parse value there).
    const photoParam = String(req.query.photo ?? "").toLowerCase();
    if (photoParam === "0" || photoParam === "false" || photoParam === "no") {
      vm.contact.photoDataUrl = undefined;
    }

    const filename = resumeFileName(vm);

    res.status(200);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");

    renderResumePdf(res, vm);

    console.log(
      JSON.stringify({
        action: "jobseeker.resume.export",
        accountId,
        credentials: credentials.length,
        workExperience: workExperience.length,
      }),
    );
  } catch (err) {
    // If the renderer has already started piping, headers are sent — we can
    // only abort the stream. Otherwise emit the canonical error envelope.
    if (res.headersSent) {
      console.error("[resume] stream failed mid-render", err);
      try {
        res.end();
      } catch {
        /* socket already torn down */
      }
      return;
    }
    return respondError(res, err);
  }
});
