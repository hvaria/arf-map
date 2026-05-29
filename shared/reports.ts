// shared/reports.ts — Report kinds + parameter schemas shared by client + server.
//
// Wave 5 — Reports Hub. The DB column `ops_reports.report_kind` is TEXT and
// validated at the application layer against the REPORT_KINDS union below
// (matches the existing `incident-types.ts` / `postings.ts` / `resident-
// trust.ts` enum-by-convention pattern — no PG ENUM types in the ops schema).

export const REPORT_KINDS = [
  "preaudit_pull",
  "incident_summary",
  "mar_export",
  "audit_trail",
  "monthly_trust_statement",
  "tracker_export",
  "credentials_matrix",
  "drill_log_export",
  "posting_verification_log",
  "complaint_log",
  "vendor_coi_matrix",
  "chart_completeness_snapshot",
  "custom",
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_KIND_LABELS: Record<ReportKind, string> = {
  preaudit_pull: "Pre-audit pull",
  incident_summary: "Incident summary",
  mar_export: "MAR export",
  audit_trail: "Audit trail extract",
  monthly_trust_statement: "Monthly trust statement",
  tracker_export: "Tracker export",
  credentials_matrix: "Staff credentials matrix",
  drill_log_export: "Drill log export",
  posting_verification_log: "Posting verification log",
  complaint_log: "Complaint log",
  vendor_coi_matrix: "Vendor COI matrix",
  chart_completeness_snapshot: "Chart completeness snapshot",
  custom: "Custom",
};

export const REPORT_STATUSES = ["generating", "ready", "failed", "expired"] as const;
export type ReportStatus = (typeof REPORT_STATUSES)[number];

export const REPORT_MIME_TYPES = [
  "application/pdf",
  "application/json",
  "text/csv",
  "application/zip",
] as const;
export type ReportMimeType = (typeof REPORT_MIME_TYPES)[number];

/** Default file extension per MIME. */
export function reportExtensionForMime(mime: ReportMimeType): string {
  switch (mime) {
    case "application/pdf":  return "pdf";
    case "application/json": return "json";
    case "text/csv":         return "csv";
    case "application/zip":  return "zip";
  }
}

/** Default mime per report kind (server may override). */
export const REPORT_DEFAULT_MIME: Record<ReportKind, ReportMimeType> = {
  preaudit_pull: "application/pdf",
  incident_summary: "application/pdf",
  mar_export: "text/csv",
  audit_trail: "text/csv",
  monthly_trust_statement: "application/pdf",
  tracker_export: "text/csv",
  credentials_matrix: "text/csv",
  drill_log_export: "text/csv",
  posting_verification_log: "text/csv",
  complaint_log: "text/csv",
  vendor_coi_matrix: "text/csv",
  chart_completeness_snapshot: "text/csv",
  custom: "application/json",
};

/** Default retention in days per kind. Admin-overridable on the row. */
export const REPORT_DEFAULT_RETENTION_DAYS: Record<ReportKind, number | null> = {
  preaudit_pull: 1095,           // 3 years — common record-retention floor
  incident_summary: 1095,
  mar_export: 1095,
  audit_trail: 1095,
  monthly_trust_statement: 2555,  // 7 years for financial records
  tracker_export: 365,
  credentials_matrix: 365,
  drill_log_export: 1095,
  posting_verification_log: 1095,
  complaint_log: 1095,
  vendor_coi_matrix: 365,
  chart_completeness_snapshot: 365,
  custom: 365,
};

/** Build a safe filename: "{kind}_{YYYYMMDD}_{id}.ext". */
export function buildReportFilename(kind: ReportKind, generatedAt: number, id: number, ext: string): string {
  const d = new Date(generatedAt);
  const date = `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}`;
  return `${kind}_${date}_${id}.${ext}`;
}
