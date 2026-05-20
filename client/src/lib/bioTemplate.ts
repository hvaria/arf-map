// bioTemplate — builds a starter bio string for the onboarding wizard's
// BioPreviewStep. Pure function: given a (credentials, yearsExperience,
// zipCity) triple, produce a one-paragraph introduction the seeker can
// either accept or edit before saving.
//
// Used by client/src/pages/jobseeker/onboarding/steps/BioPreviewStep.tsx.
// Spec / reference outputs live in client/src/lib/__tests__/bioTemplate.test.ts.
import type { CredentialKind } from "@shared/schema";
import { CREDENTIAL_LABEL } from "@/lib/credentialLabels";

export interface BioInput {
  /** Selected credential kinds — already filtered (no OTHER). */
  credentials: CredentialKind[];
  /** Stored midpoint year value (0, 1, 3, 5) or `null` if unset. */
  yearsExperience: number | null;
  /**
   * Either a 5-digit ZIP code, a "City, ST" string, or null. The wizard
   * only collects a ZIP today; the "City, ST" branch is reserved for a
   * later phase when reverse-geocoding is wired in.
   */
  zipCity: string | null;
}

/**
 * buildBio — assemble the opening, experience clause, location clause,
 * and closing into one paragraph.
 *
 * Algorithm (mirror of architect plan, section "bioTemplate"):
 *   1. Up to 3 credentials joined with ", " and final " and ", then the
 *      word "certified caregiver". With 0 credentials, the opener is just
 *      "Caregiver".
 *   2. yearsExperience phrase — see `experienceClause()`.
 *   3. Location phrase — ZIP regex match → "based in ZIP {n}"; otherwise
 *      the raw "City, ST" string; otherwise omitted.
 *   4. Closing — fixed sentence about ARFs/RCFEs/group homes.
 */
export function buildBio(input: BioInput): string {
  const opener = openingClause(input.credentials);
  const experience = experienceClause(input.yearsExperience);
  const location = locationClause(input.zipCity);

  // Join the three clauses with ", ", trimming any empty slot so we don't
  // end up with stray ", , ".
  const lead = [opener, experience, location].filter(Boolean).join(", ");
  const closing =
    "Available for caregiver and direct support roles at ARFs, RCFEs, and group homes nearby.";

  return `${lead}. ${closing}`;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function openingClause(credentials: CredentialKind[]): string {
  // Drop OTHER defensively even though the picker already excludes it.
  const meaningful = credentials.filter((k) => k !== "OTHER");
  if (meaningful.length === 0) return "Caregiver";

  const top = meaningful.slice(0, 3).map((k) => CREDENTIAL_LABEL[k] ?? k);
  // 1 → "X"; 2 → "X and Y"; 3 → "X, Y and Z" (Oxford comma omitted per
  // the reference outputs in the test file).
  let joined: string;
  if (top.length === 1) {
    joined = top[0];
  } else if (top.length === 2) {
    joined = `${top[0]} and ${top[1]}`;
  } else {
    joined = `${top.slice(0, -1).join(", ")} and ${top[top.length - 1]}`;
  }
  return `${joined} certified caregiver`;
}

function experienceClause(years: number | null): string {
  if (years === null) return "new to professional care work";
  if (years === 0) return "starting my career in care";
  if (years === 1) return "with 1 year of hands-on experience";
  if (years >= 2 && years <= 4) return `with ${years} years of hands-on experience`;
  return "with 5+ years of hands-on experience";
}

function locationClause(zipCity: string | null): string {
  if (!zipCity) return "";
  const trimmed = zipCity.trim();
  if (trimmed === "") return "";
  if (/^\d{5}$/.test(trimmed)) return `based in ZIP ${trimmed}`;
  return `based in ${trimmed}`;
}
