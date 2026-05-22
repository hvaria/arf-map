/**
 * Phase 4 — Legal documents registry (shared FE + BE).
 *
 * Source of truth for which legal documents exist, their current version
 * strings, where they live on disk (for the BE markdown server), and what
 * label the clickwrap forms should render.
 *
 * Version-bump procedure
 * ──────────────────────
 * 1) Edit `docs/legal/<slug>.md`.
 * 2) Bump `LEGAL_DOCS[<slug>].version` here to a new ISO date string.
 * 3) Deploy.
 *
 * That's it. The next time any user hits a protected endpoint after the
 * deploy, `getPendingAcceptances` finds no row at the new version for that
 * user and returns the slug. The middleware `requirePendingLegalAcceptances`
 * then 409s the request with `LEGAL_REACCEPT_REQUIRED`, and the FE blocking
 * modal walks the user through the new clickwrap. After re-accept, the
 * insert lands on the new version row and the user is unblocked.
 *
 * No DB migration is needed for a version bump — the (account, document,
 * version) UNIQUE index lets old + new versions coexist forever, which is
 * what the legal team wants (full history of what every user agreed to).
 */

export type LegalDocSlug = "terms" | "privacy" | "aup";

export const LEGAL_DOCS: Record<
  LegalDocSlug,
  { version: string; path: string; label: string }
> = {
  terms: {
    version: "2026-05-21",
    path: "/legal/terms",
    label: "Terms of Service",
  },
  privacy: {
    version: "2026-05-21",
    path: "/legal/privacy",
    label: "Privacy Policy",
  },
  aup: {
    version: "2026-05-21",
    path: "/legal/aup",
    label: "Acceptable Use Policy",
  },
};

/** Returns the list of all known doc slugs (typed). Useful for iteration. */
export const LEGAL_DOC_SLUGS: ReadonlyArray<LegalDocSlug> = [
  "terms",
  "privacy",
  "aup",
];

export type AcceptanceCheckResult = { pending: LegalDocSlug[] };
