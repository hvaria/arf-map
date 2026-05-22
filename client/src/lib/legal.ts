/**
 * client/src/lib/legal.ts
 *
 * Re-exports the canonical Phase 4 legal-document registry from
 * `@shared/legal`. Keeping this file as a single import seam lets FE code
 * (`Clickwrap`, `LegalAcceptanceModal`, `LegalDocPage`, etc.) import from
 * one place — and if the FE later needs a slightly different view of
 * `LEGAL_DOCS` than the BE, this is where we'd diverge.
 */

export {
  LEGAL_DOCS,
  LEGAL_DOC_SLUGS,
  type LegalDocSlug,
  type LegalDocMeta,
} from "@shared/legal";

/** Type guard — safe to cast incoming `string[]` from the API. */
export function isLegalDocSlug(value: unknown): value is "terms" | "privacy" | "aup" {
  return value === "terms" || value === "privacy" || value === "aup";
}

/**
 * Response from `GET /api/legal/{slug}` — markdown body + version.
 * Defensive: extra fields are ignored.
 */
export interface LegalDocResponse {
  slug: "terms" | "privacy" | "aup";
  version: string;
  content: string;
}
