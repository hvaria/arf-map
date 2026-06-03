// Canonical resume view-model + mapper.
//
// This is the ONE place that turns a job seeker's stored profile data
// (profile row + email + credentials + work-experience rows) into the shape
// a resume is rendered from. The server PDF renderer consumes it today; a
// future client-side "Preview Resume" surface, a "Share Resume" link, or a
// second template can consume the exact same view model — so the mapping
// logic never gets duplicated or drifts between surfaces.
//
// Pure, dependency-free, JSX-free, node-free: importable from both
// `server/` and `client/`.

import type {
  JobSeekerProfile,
  JobSeekerCredential,
  JobSeekerWorkExperience,
  CredentialKind,
} from "./schema";
import { CREDENTIAL_RESUME_LABEL } from "./credentialLabels";

// ─── View-model types ───────────────────────────────────────────────────────

export interface ResumeContact {
  fullName: string;
  email: string;
  phone?: string;
  /** "City, ST 95814" — assembled from city/state/zip, omitted if all empty. */
  location?: string;
  /** Street address line, kept separate from `location` so a template can
   *  choose to show or hide it (resumes often omit the street). */
  street?: string;
  /**
   * Profile photo as a base64 data URL (`data:image/jpeg;base64,…`). The
   * profile picture is stored client-side as a downscaled JPEG data URL, so
   * we pass it straight through. Only populated when the stored value is a
   * real `data:image/*` URL — non-image / remote URLs are dropped.
   */
  photoDataUrl?: string;
}

/** Visual grouping for a credential — drives the badge colour in the PDF,
 *  mirroring the license / clearance / training split in the client's
 *  CredentialBadge component. */
export type ResumeCredentialCategory =
  | "license"
  | "clearance"
  | "training"
  | "other";

export interface ResumeCredentialVM {
  label: string;
  /** "License #1234 · Issued 2023-01 · Expires 2026-01" — omitted if empty. */
  detail?: string;
  /** Original credential kind (e.g. "CNA") — lets the renderer look up a
   *  licensed official logo asset when one is configured. */
  kind: string;
  category: ResumeCredentialCategory;
}

export interface ResumeWorkEntryVM {
  title: string;
  company: string;
  location?: string;
  employmentType?: string;
  /** "Jan 2022 – Present" / "Mar 2019 – Aug 2021". */
  dateRange: string;
  description?: string;
}

export interface ResumeViewModel {
  contact: ResumeContact;
  /** One-line professional headline derived from job types + experience. */
  headline?: string;
  /** Free-text "about me" / professional summary (the profile bio). */
  summary?: string;
  yearsExperience: number | null;
  /** Roles the seeker is looking for — rendered as a "Target Roles" list. */
  jobTypes: string[];
  credentials: ResumeCredentialVM[];
  workExperience: ResumeWorkEntryVM[];
  /**
   * A resume needs at minimum a name to be meaningful. When false the caller
   * should prompt the user to finish their profile instead of generating an
   * unusable document.
   */
  isMinimallyComplete: boolean;
  /**
   * Recommended-but-empty fields, for a "to make your resume stronger, add…"
   * nudge. Never blocks generation (except the name — see above).
   */
  missingFields: string[];
}

// ─── Inputs ───────────────────────────────────────────────────────────────────

export interface ResumeSourceData {
  profile: JobSeekerProfile | null;
  email: string;
  credentials: JobSeekerCredential[];
  workExperience: JobSeekerWorkExperience[];
}

// ─── Mapper ─────────────────────────────────────────────────────────────────

export function buildResumeViewModel(src: ResumeSourceData): ResumeViewModel {
  const { profile, email, credentials, workExperience } = src;

  const firstName = clean(profile?.firstName);
  const lastName = clean(profile?.lastName);
  const fullName = [firstName, lastName].filter(Boolean).join(" ").trim();

  const location = joinLocation(profile?.city, profile?.state, profile?.zipCode);

  const contact: ResumeContact = {
    fullName,
    email,
    phone: clean(profile?.phone),
    location,
    street: clean(profile?.address),
    photoDataUrl: asImageDataUrl(profile?.profilePictureUrl),
  };

  const jobTypes = (profile?.jobTypes ?? []).filter((t) => clean(t));
  const yearsExperience = profile?.yearsExperience ?? null;

  const credentialVMs: ResumeCredentialVM[] = credentials.map(toResumeCredential);
  const workVMs: ResumeWorkEntryVM[] = workExperience.map(toResumeWorkEntry);

  const summary = clean(profile?.bio);

  const missingFields: string[] = [];
  if (!contact.phone) missingFields.push("Phone number");
  if (!location) missingFields.push("City / State");
  if (!summary) missingFields.push("Professional summary");
  if (jobTypes.length === 0) missingFields.push("Target roles");
  if (workVMs.length === 0) missingFields.push("Work experience");
  if (credentialVMs.length === 0) missingFields.push("Credentials");

  return {
    contact,
    headline: buildHeadline(jobTypes, yearsExperience),
    summary,
    yearsExperience,
    jobTypes,
    credentials: credentialVMs,
    workExperience: workVMs,
    isMinimallyComplete: fullName.length > 0,
    missingFields,
  };
}

/**
 * Filesystem-safe, human-readable resume filename:
 *   "jane-smith-resume.pdf" / "jane-resume.pdf" / "resume.pdf".
 * Derived only from the name so it's stable and predictable for the user.
 */
export function resumeFileName(vm: ResumeViewModel): string {
  const slug = vm.contact.fullName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug ? `${slug}-resume.pdf` : "resume.pdf";
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function clean(v: string | null | undefined): string | undefined {
  const t = (v ?? "").trim();
  return t.length > 0 ? t : undefined;
}

function joinLocation(
  city: string | null | undefined,
  state: string | null | undefined,
  zip: string | null | undefined,
): string | undefined {
  const c = clean(city);
  const s = clean(state);
  const z = clean(zip);
  const cityState = [c, s].filter(Boolean).join(", ");
  const full = [cityState, z].filter(Boolean).join(" ").trim();
  return full.length > 0 ? full : undefined;
}

function buildHeadline(
  jobTypes: string[],
  yearsExperience: number | null,
): string | undefined {
  // Comma-separated keeps ATS tokenization clean (the consulting review
  // flagged mixed `·` / `|` separators as parser noise).
  const roles = jobTypes.slice(0, 3).join(", ");
  const exp =
    yearsExperience != null && yearsExperience > 0
      ? `${yearsExperience}+ ${yearsExperience === 1 ? "year" : "years"} experience`
      : "";
  const parts = [roles, exp].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : undefined;
}

function toResumeCredential(c: JobSeekerCredential): ResumeCredentialVM {
  const kind = c.kind as CredentialKind;
  // Spell-out label for ATS keyword matching; OTHER uses the free-text label.
  const label =
    kind === "OTHER"
      ? clean(c.label) ?? CREDENTIAL_RESUME_LABEL.OTHER
      : CREDENTIAL_RESUME_LABEL[kind] ?? c.kind;

  const bits: string[] = [];
  const issuer = clean(c.issuingAuthority);
  const lic = clean(c.licenseNumber);
  const issued = monthYearFromIso(c.issuedAt);
  const expires = monthYearFromIso(c.expiresAt);
  if (issuer) bits.push(issuer);
  if (lic) bits.push(`License #${lic}`);
  if (issued) bits.push(`Issued ${issued}`);
  if (expires) bits.push(`Expires ${expires}`);

  // Comma separators (ATS-safer than middle-dots per the consulting review).
  return {
    label,
    detail: bits.length > 0 ? bits.join(", ") : undefined,
    kind: c.kind,
    category: categoryFor(kind),
  };
}

// Credential → visual category. Mirrors the LICENSE/CLEARANCE sets in the
// client's CredentialBadge so the PDF badge colour matches the in-app chip.
const LICENSE_KINDS = new Set<string>([
  "CNA", "LVN", "RN", "RCFE_ADMIN", "ARF_ADMIN", "MED_TECH",
]);
const CLEARANCE_KINDS = new Set<string>([
  "LIVE_SCAN", "TB", "MANDATED_REPORTER",
]);
const TRAINING_KINDS = new Set<string>([
  "DSP_YEAR_1", "DSP_YEAR_2", "RCFE_40_HOUR", "CPR", "FIRST_AID",
]);

function categoryFor(kind: string): ResumeCredentialCategory {
  if (LICENSE_KINDS.has(kind)) return "license";
  if (CLEARANCE_KINDS.has(kind)) return "clearance";
  if (TRAINING_KINDS.has(kind)) return "training";
  return "other";
}

/** Pass through only genuine `data:image/*` URLs (the stored profile picture
 *  format); drop empty / remote / non-image values so the renderer never
 *  tries to embed something pdfkit can't decode. */
function asImageDataUrl(value: string | null | undefined): string | undefined {
  const v = clean(value);
  if (!v) return undefined;
  return /^data:image\/(png|jpe?g);base64,/i.test(v) ? v : undefined;
}

function toResumeWorkEntry(w: JobSeekerWorkExperience): ResumeWorkEntryVM {
  return {
    title: w.title,
    company: w.company,
    location: clean(w.location),
    employmentType: clean(w.employmentType),
    dateRange: formatRange(w.startDate, w.endDate),
    description: clean(w.description),
  };
}

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "YYYY-MM" → "Mon YYYY". Returns the raw value if it doesn't match. */
function formatYearMonth(value: string | null | undefined): string | undefined {
  const v = clean(value);
  if (!v) return undefined;
  const m = /^(\d{4})-(\d{2})$/.exec(v);
  if (!m) return v;
  const monthIdx = parseInt(m[2], 10) - 1;
  const month = MONTHS[monthIdx] ?? m[2];
  return `${month} ${m[1]}`;
}

/** Credential ISO date "YYYY-MM-DD" → "Mon YYYY" (standardized to match the
 *  work-experience date format per the ATS review). Returns the raw value if
 *  it doesn't match. */
function monthYearFromIso(value: string | null | undefined): string | undefined {
  const v = clean(value);
  if (!v) return undefined;
  const m = /^(\d{4})-(\d{2})(?:-\d{2})?$/.exec(v);
  if (!m) return v;
  const monthIdx = parseInt(m[2], 10) - 1;
  const month = MONTHS[monthIdx] ?? m[2];
  return `${month} ${m[1]}`;
}

function formatRange(
  start: string | null | undefined,
  end: string | null | undefined,
): string {
  const s = formatYearMonth(start) ?? "";
  const e = formatYearMonth(end) ?? "Present";
  if (!s) return e === "Present" ? "" : e;
  return `${s} – ${e}`;
}
