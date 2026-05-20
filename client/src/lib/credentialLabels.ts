// credentialLabels — single source of truth for the user-visible name of
// each CredentialKind. Lives in /lib (not /components) so non-JSX modules
// (e.g. bioTemplate.ts) can import the labels without dragging a JSX
// transform target into their dependency graph.
//
// Re-exported from `@/components/CredentialBadge` so existing call sites
// keep working unchanged.
import type { CredentialKind } from "@shared/schema";

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
