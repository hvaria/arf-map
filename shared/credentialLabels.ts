// credentialLabels — single source of truth for the user-visible name of
// each CredentialKind. Lives in `shared/` (not the client `/lib`) so BOTH
// the client (badge chips, profile UI) and the server (resume PDF renderer)
// resolve the same label map without duplicating it.
//
// Re-exported from `client/src/lib/credentialLabels.ts` (and transitively
// from `@/components/CredentialBadge`) so existing client import sites keep
// working unchanged.
import type { CredentialKind } from "./schema";

export const CREDENTIAL_LABEL: Record<CredentialKind, string> = {
  CNA: "CNA",
  LVN: "LVN",
  RN: "RN",
  RCFE_ADMIN: "RCFE Administrator",
  ARF_ADMIN: "ARF Administrator",
  DSP_YEAR_1: "DSP Year 1",
  DSP_YEAR_2: "DSP Year 2",
  MED_TECH: "Med Tech",
  MANDATED_REPORTER: "Mandated Reporter",
  RCFE_40_HOUR: "RCFE 40-hr Training",
  LIVE_SCAN: "Live Scan Clearance",
  TB: "TB Clearance",
  CPR: "CPR",
  FIRST_AID: "First Aid",
  OTHER: "Other",
};

// ATS long-form labels — full name + acronym, e.g. "Certified Nursing
// Assistant (CNA)". Used by the resume renderer (NOT the compact in-app chip)
// because ATS keyword search and recruiter boolean queries match on the
// spelled-out term; acronym-only loses half the match surface. (Per the ATS
// consulting review.)
export const CREDENTIAL_RESUME_LABEL: Record<CredentialKind, string> = {
  CNA: "Certified Nursing Assistant (CNA)",
  LVN: "Licensed Vocational Nurse (LVN)",
  RN: "Registered Nurse (RN)",
  RCFE_ADMIN: "RCFE Administrator Certificate",
  ARF_ADMIN: "ARF Administrator Certificate",
  DSP_YEAR_1: "Direct Support Professional — Year 1 (DSP)",
  DSP_YEAR_2: "Direct Support Professional — Year 2 (DSP)",
  MED_TECH: "Medication Technician (Med Tech)",
  MANDATED_REPORTER: "Mandated Reporter Training",
  RCFE_40_HOUR: "RCFE 40-Hour Administrator Training",
  LIVE_SCAN: "Live Scan / DOJ Background Clearance",
  TB: "Tuberculosis (TB) Clearance",
  CPR: "CPR Certification",
  FIRST_AID: "First Aid Certification",
  OTHER: "Other",
};
