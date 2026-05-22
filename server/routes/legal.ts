/**
 * Phase 4 — Legal document routes.
 *
 * Two surfaces:
 *
 *   1) Top-level `/legal/*`  (mounted on `app` directly — NOT under /api)
 *      Serves the raw markdown files for direct browser navigation, social
 *      preview, search-engine indexing, etc.
 *
 *   2) `/api/legal/*`         (mounted on `app`)
 *      Same content + version metadata, JSON-wrapped, used by the FE
 *      blocking-modal renderer and by the registration clickwrap form.
 *      Also exposes POST /accept so a logged-in user can satisfy the
 *      re-prompt without re-registering.
 *
 * Disk layout: `docs/legal/<slug>.md`. Resolved from the project root using
 * `process.cwd()` — same convention as the rest of the server (file uploads,
 * static assets, etc.). If the markdown is missing we 500 with a clear
 * message; the dev's job is to create the file, not return a stub.
 */

import { Router } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { LEGAL_DOCS, LEGAL_DOC_SLUGS, type LegalDocSlug } from "@shared/legal";
import { recordAcceptance } from "../lib/legal";

function isLegalSlug(value: unknown): value is LegalDocSlug {
  return typeof value === "string" && (LEGAL_DOC_SLUGS as readonly string[]).includes(value);
}

function docPath(slug: LegalDocSlug): string {
  return path.join(process.cwd(), "docs", "legal", `${slug}.md`);
}

async function loadDoc(slug: LegalDocSlug): Promise<string> {
  return readFile(docPath(slug), "utf8");
}

// ─────────────────────────────────────────────────────────────────────────────
// /legal/<slug> — raw markdown for direct browser navigation
// ─────────────────────────────────────────────────────────────────────────────
export const legalRouter = Router();

for (const slug of LEGAL_DOC_SLUGS) {
  legalRouter.get(`/${slug}`, async (_req, res, next) => {
    try {
      const content = await loadDoc(slug);
      res.set("Content-Type", "text/markdown; charset=utf-8");
      // Docs change infrequently — 5 min browser cache.
      res.set("Cache-Control", "public, max-age=300");
      res.send(content);
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        console.error(`[legal] missing markdown file for slug=${slug}:`, docPath(slug));
        return res
          .status(500)
          .json({ message: `Legal document '${slug}' is missing on disk.` });
      }
      next(err);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// /api/legal/* — JSON-wrapped + acceptance write endpoint
// ─────────────────────────────────────────────────────────────────────────────
export const legalApiRouter = Router();

/**
 * GET /api/legal/:slug
 *
 * Returns the markdown content + the current version string so the FE
 * blocking modal can render the doc inline and pin the acceptance to the
 * displayed version (avoiding race conditions across deploys).
 */
legalApiRouter.get("/:slug", async (req, res, next) => {
  try {
    const { slug } = req.params;
    if (!isLegalSlug(slug)) {
      return res.status(404).json({ message: "Unknown legal document slug" });
    }
    const content = await loadDoc(slug);
    res.set("Cache-Control", "public, max-age=300");
    res.json({
      slug,
      version: LEGAL_DOCS[slug].version,
      label: LEGAL_DOCS[slug].label,
      content,
    });
  } catch (err: any) {
    if (err?.code === "ENOENT") {
      console.error(`[legal] missing markdown file:`, req.params.slug);
      return res
        .status(500)
        .json({ message: `Legal document is missing on disk.` });
    }
    next(err);
  }
});

/**
 * POST /api/legal/accept
 *
 * Records an acceptance for the authenticated user (facility or job seeker).
 * Body: { documents: LegalDocSlug[] } — one POST satisfies multiple slugs.
 * If `documents` is omitted, accepts ALL slugs at their current versions —
 * the typical FE call shape for the "Accept all" modal CTA.
 *
 * Idempotent via the UNIQUE index, so the FE can replay on flaky network
 * without poisoning the audit trail. Returns the post-acceptance pending
 * list so the FE can decide whether to keep the modal open (defensive — in
 * the happy path it's always empty after this call).
 *
 * NOTE: This endpoint MUST run before requirePendingLegalAcceptances would
 * 409 the request. The global middleware in server/index.ts only blocks
 * state-changing requests when there ARE pending acceptances; the
 * acceptance write itself is the unblock. To avoid the chicken-and-egg
 * loop, the middleware leaves this path alone — it's a POST but if the
 * user has pending acceptances the middleware will 409 it. We work around
 * that by short-circuiting in the middleware path... actually a simpler
 * fix: the middleware checks pending BEFORE letting the request through.
 * Since accepting the doc is the very thing that clears pending, we
 * special-case this path in the middleware below.
 */
legalApiRouter.post("/accept", async (req, res, next) => {
  try {
    // Resolve auth (mirrors lib/legal.ts auto-detector).
    let accountKind: "facility" | "job_seeker" | null = null;
    let accountId: number | undefined;
    const user = req.user as { id?: number } | undefined;
    if (user?.id != null) {
      accountKind = "facility";
      accountId = user.id;
    } else if (req.session?.jobSeekerId != null) {
      accountKind = "job_seeker";
      accountId = req.session.jobSeekerId;
    }
    if (!accountKind || !accountId) {
      return res.status(401).json({ message: "Authentication required." });
    }

    const body = req.body as { documents?: unknown } | undefined;
    let documents: LegalDocSlug[];
    if (Array.isArray(body?.documents)) {
      documents = (body!.documents as unknown[]).filter(isLegalSlug);
      if (documents.length === 0) {
        return res
          .status(400)
          .json({ message: "documents must be a non-empty array of legal slugs" });
      }
    } else {
      documents = [...LEGAL_DOC_SLUGS];
    }

    for (const slug of documents) {
      await recordAcceptance({
        req,
        accountKind,
        accountId,
        document: slug,
        version: LEGAL_DOCS[slug].version,
      });
    }

    // Recompute pending so the FE knows the modal can close.
    const { getPendingAcceptances } = await import("../lib/legal");
    const pending = await getPendingAcceptances({ accountKind, accountId });
    res.json({ ok: true, pendingAcceptances: pending });
  } catch (err) {
    next(err);
  }
});
