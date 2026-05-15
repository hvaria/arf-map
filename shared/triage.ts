// shared/triage.ts — Daily-triage data contract shared by backend and frontend.
//
// Wave 3 Phase 3.1 (W1 + W14). Single source of truth for the section enum,
// item shape, and aggregator payload returned by GET /api/ops/triage and
// fed into the W14 daily-summary email. Both the FE Audit Readiness
// drill-down list and the server-side aggregator import from here so the
// section keys and labels can never drift.

export const TRIAGE_SECTIONS = [
  "overdue_obligations",
  "incidents_past_sla",
  "credentials_expired",
  "credentials_expiring",
  "temperature_out_of_range_open",
  "vendors_expired",
  "vendors_expiring",
  "complaints_open",
  "drills_quarter_deficit",
  "charts_incomplete",
  "controlled_sub_discrepancies_aging",
  // Wave 4 Phase 4.1 (W6) — Posting verification freshness. Surfaces one
  // item per stale-or-missing posting catalog entry. Severity = "high" for
  // missing (status≠current or no verification on file) and "medium" for
  // stale (status=current but verification older than cadence).
  "postings_stale_or_missing",
] as const;
export type TriageSection = (typeof TRIAGE_SECTIONS)[number];

export type TriageSeverity = "high" | "medium" | "low";

export interface TriageItem {
  section: TriageSection;
  /** Stable id usable as a list key (e.g., 'obligation:42'). */
  itemKey: string;
  subject: string;        // human readable: "Pharmacy COI · ABC Pharmacy"
  action: string;         // what the admin needs to do: "Renew COI"
  ageDays?: number;       // days since the relevant event (created_at, expired_at, etc.); negative = days_until for warnings
  severity: TriageSeverity;
  ownerLabel?: string;    // who's responsible per the row
  deepLink: {
    subView: string;      // e.g. "audit_readiness/vendors" | "incidents" | "compliance"
    entityId?: number;
  };
}

export interface TriagePayload {
  facilityNumber: string;
  generatedAt: number;
  /** Section-keyed counts (drives the KPI tiles + the email header). */
  counts: Record<TriageSection, number>;
  /** Top-N items per section for the live drill-down list. */
  items: TriageItem[];
  /** Sum of items across all sections (clamped at items.length). */
  totalItems: number;
}

/** Sort comparator: severity desc -> ageDays desc -> section alpha. */
export function compareTriageItems(a: TriageItem, b: TriageItem): number {
  const sev = { high: 0, medium: 1, low: 2 };
  const dSev = sev[a.severity] - sev[b.severity];
  if (dSev !== 0) return dSev;
  const dAge = (b.ageDays ?? 0) - (a.ageDays ?? 0);
  if (dAge !== 0) return dAge;
  return a.section.localeCompare(b.section);
}

/** Human-readable section labels for the UI + email subject lines. */
export const TRIAGE_SECTION_LABELS: Record<TriageSection, string> = {
  overdue_obligations: "Overdue obligations",
  incidents_past_sla: "Incidents past SLA",
  credentials_expired: "Credentials expired",
  credentials_expiring: "Credentials expiring soon",
  temperature_out_of_range_open: "Temperature out-of-range — unresolved",
  vendors_expired: "Vendor COIs expired",
  vendors_expiring: "Vendor COIs expiring",
  complaints_open: "Open complaints",
  drills_quarter_deficit: "Drill cadence deficit",
  charts_incomplete: "Resident charts incomplete",
  controlled_sub_discrepancies_aging: "Controlled-sub discrepancies aging",
  postings_stale_or_missing: "Postings stale or missing",
};
