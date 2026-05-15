// shared/postings.ts — Posting verification catalogue (W6).

// Default posting catalogue per common CA RCFE practice. Marked [V] per
// Phase 1 §11 B12 — the definitive list + bilingual thresholds must be
// confirmed against Title 22 / CDSS guidance before treating any item
// here as authoritative. Facility-level overrides happen via ops_posting_catalog.
export const POSTING_KEYS = [
  "license_certificate",
  "residents_rights",
  "complaint_process",
  "ombudsman_contact",
  "evacuation_route",
  "fire_safety_notice",
  "no_smoking",
  "hot_water_temp_warning",
  "abuse_reporting_hotline",
  "food_safety_notice",
  "emergency_procedures",
  "infection_control_notice",
  "non_discrimination",
  "other",
] as const;
export type PostingKey = (typeof POSTING_KEYS)[number];

export interface PostingDefault {
  titleEn: string;
  titleEs?: string;        // populated for postings commonly required bilingually [V]
  locationHint: string;
  cadenceDays: number;     // recommended verification cadence; admin can override per-facility
  required: boolean;
}

/** Seed catalogue applied on first POST to /api/ops/facilities/:fn/postings/seed. */
export const POSTING_DEFAULTS: Record<PostingKey, PostingDefault> = {
  license_certificate: {
    titleEn: "Facility license certificate",
    locationHint: "Main entrance / lobby",
    cadenceDays: 90,
    required: true,
  },
  residents_rights: {
    titleEn: "Residents' rights",
    titleEs: "Derechos de los residentes",
    locationHint: "Common area",
    cadenceDays: 30,
    required: true,
  },
  complaint_process: {
    titleEn: "How to file a complaint",
    titleEs: "Cómo presentar una queja",
    locationHint: "Common area near residents' rights",
    cadenceDays: 30,
    required: true,
  },
  ombudsman_contact: {
    titleEn: "Long-Term Care Ombudsman contact",
    titleEs: "Contacto del Defensor del Pueblo",
    locationHint: "Common area",
    cadenceDays: 30,
    required: true,
  },
  evacuation_route: {
    titleEn: "Evacuation route map",
    locationHint: "Every resident wing / hallway",
    cadenceDays: 30,
    required: true,
  },
  fire_safety_notice: {
    titleEn: "Fire safety procedures",
    locationHint: "Common area + kitchen",
    cadenceDays: 60,
    required: true,
  },
  no_smoking: {
    titleEn: "No smoking notice",
    locationHint: "Entrances + common areas",
    cadenceDays: 90,
    required: true,
  },
  hot_water_temp_warning: {
    titleEn: "Hot water temperature warning",
    locationHint: "Resident bathrooms",
    cadenceDays: 60,
    required: true,
  },
  abuse_reporting_hotline: {
    titleEn: "Elder abuse reporting hotline",
    titleEs: "Línea directa para denunciar abuso",
    locationHint: "Staff break room + common area",
    cadenceDays: 30,
    required: true,
  },
  food_safety_notice: {
    titleEn: "Food safety / handwashing notice",
    locationHint: "Kitchen + dining room",
    cadenceDays: 60,
    required: true,
  },
  emergency_procedures: {
    titleEn: "Emergency procedures (disaster plan)",
    locationHint: "Staff station",
    cadenceDays: 90,
    required: true,
  },
  infection_control_notice: {
    titleEn: "Infection control / handwashing",
    locationHint: "Kitchen + restrooms",
    cadenceDays: 60,
    required: false,
  },
  non_discrimination: {
    titleEn: "Non-discrimination notice",
    locationHint: "Main entrance",
    cadenceDays: 365,
    required: true,
  },
  other: {
    titleEn: "Other facility-specific posting",
    locationHint: "—",
    cadenceDays: 30,
    required: false,
  },
};

export const POSTING_VERIFICATION_STATUSES = ["current", "missing", "damaged", "illegible"] as const;
export type PostingVerificationStatus = (typeof POSTING_VERIFICATION_STATUSES)[number];

export const POSTING_VERIFICATION_LABELS: Record<PostingVerificationStatus, string> = {
  current: "Posted, current, legible",
  missing: "Missing — needs reprint",
  damaged: "Damaged — needs replacement",
  illegible: "Faded / illegible — needs replacement",
};

/**
 * Compute the staleness state for a posting given (a) its catalog cadence
 * and (b) the most recent verification's verified_at + status.
 *
 * Returns "ok" only when status='current' AND verified within cadence.
 * Returns "stale" when status='current' but verification is older than
 * cadence. Returns "missing" when status≠'current' OR no verification on file.
 */
export function postingFreshness(
  catalog: { cadenceDays: number },
  latestVerification: { status: PostingVerificationStatus; verifiedAt: number } | null,
  now: number = Date.now(),
): "ok" | "stale" | "missing" {
  if (!latestVerification) return "missing";
  if (latestVerification.status !== "current") return "missing";
  const ageDays = (now - latestVerification.verifiedAt) / (24 * 60 * 60 * 1000);
  return ageDays > catalog.cadenceDays ? "stale" : "ok";
}
