// shared/auditor.ts — share-link audience + preaudit-pull section catalogue
// shared by client + server.
//
// Wave 3 Phase 3.2. Single source of truth for the audience enum, the
// pre-audit section keys + their human-readable labels, and the shared
// request/response contracts for the W2 one-click pull. Both the FE
// share-link dialog / pre-audit wizard and the server-side route handlers
// import from here so the audience tags and section keys can never drift.
// Pattern mirrors shared/triage.ts.

export const AUDITOR_AUDIENCES = [
  "cdss",
  "ombudsman",
  "fire_marshal",
  "health_dept",
  "internal",
  "corporate",
  "other",
] as const;
export type AuditorAudience = (typeof AUDITOR_AUDIENCES)[number];

export const AUDITOR_AUDIENCE_LABELS: Record<AuditorAudience, string> = {
  cdss: "CDSS / CCLD",
  ombudsman: "Ombudsman",
  fire_marshal: "Fire marshal",
  health_dept: "Health department",
  internal: "Internal review",
  corporate: "Corporate audit",
  other: "Other",
};

export const SHARE_LINK_SCOPES = ["audit_readiness"] as const;
export type ShareLinkScope = (typeof SHARE_LINK_SCOPES)[number];

/**
 * Default duration for a freshly-minted share link. Real admins commonly
 * want 24-72 hours for an active inspection visit; 7 days is the safe
 * upper bound default. Admin can override in the dialog.
 */
export const DEFAULT_SHARE_LINK_DURATION_DAYS = 7;
export const MAX_SHARE_LINK_DURATION_DAYS = 30;
export const MIN_SHARE_LINK_DURATION_HOURS = 1;

/** Sections a pre-audit pull can include. */
export const PREAUDIT_SECTIONS = [
  "residents_roster",
  "mar_samples",
  "incidents",
  "drill_logs",
  "temperature_logs",
  "vendors",
  "complaints",
  "inspections",
  "staff_credentials",
  "chart_completeness",
  "obligations",
  "audit_trail",
  "controlled_sub",
] as const;
export type PreauditSection = (typeof PREAUDIT_SECTIONS)[number];

export const PREAUDIT_SECTION_LABELS: Record<PreauditSection, string> = {
  residents_roster: "Residents — roster + admission dates",
  mar_samples: "MAR — last N days per resident",
  incidents: "Incidents — with notification timestamps",
  drill_logs: "Drill logs — fire + disaster",
  temperature_logs: "Temperature logs — per fixture",
  vendors: "Vendors — COI + license status",
  complaints: "Complaints — intake to closure",
  inspections: "Inspections — citations + closures",
  staff_credentials: "Staff credentials — TB, fingerprint, CPR, etc.",
  chart_completeness: "Chart completeness — per resident",
  obligations: "Obligations — overdue + due-soon",
  audit_trail: "Audit trail — every mutation in the window",
  controlled_sub: "Controlled substances — counts + reconciliation",
};

export type DeliveryMethod = "download" | "share_link";

export interface PreauditPullSpec {
  audience: AuditorAudience;
  audienceLabel?: string;
  windowStartAt: number;
  windowEndAt: number;
  sections: PreauditSection[];
  deliveryMethod: DeliveryMethod;
  // When deliveryMethod='share_link', the server creates a share-link too.
  shareDurationDays?: number;
}

export interface PreauditPullResult {
  preauditPullId: number;
  shareLinkId?: number;
  shareToken?: string;
  generatedAt: number;
  windowStartAt: number;
  windowEndAt: number;
  /** Per-section row counts AND exclusions (soft-deleted, etc.). */
  totals: Record<PreauditSection, { included: number; excluded: number }>;
  /** Inline-bundle payload when deliveryMethod='download'; absent on 'share_link'. */
  bundle?: Record<PreauditSection, unknown[]>;
}

/** Builds an absolute viewer URL for an auditor token. Used by FE for the copy-link UI; server uses it in emails. */
export function buildAuditorViewerUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}/#/auditor/${encodeURIComponent(token)}`;
}
