/**
 * Role lens — describes how the dashboard adapts per user role.
 *
 * Kept as data, not hard-coded into components, so adding a role is a one-line
 * change here. Aligns with NoteRole in server/ops/notePolicy.ts. Unknown roles
 * fall back to "facility_admin" so the UI never breaks.
 */

export type Role =
  | "super_admin"
  | "facility_admin"
  | "supervisor"
  | "med_tech"
  | "caregiver"
  | "wellness_staff"
  | "provider"
  | "compliance_reviewer";

export type KpiKey =
  | "residents"
  | "meds"
  | "tasks"
  | "incidents"
  | "leads"
  | "invoices"
  | "compliance"
  | "staff"
  | "tracker";

export type AlertTier = "clinical" | "regulatory" | "care" | "ops" | "info";

export type QuickActionKey =
  | "chartMed"
  | "addIncident"
  | "postNote"
  | "addLead"
  | "openCompliance";

export interface RoleLens {
  label: string;
  /** KPIs in display order; KPIs not listed are hidden for this role. */
  kpis: KpiKey[];
  /**
   * Per-tier weight added to alert sort key (lower = higher priority).
   * Lets clinicians see clinical first while admins see regulatory first
   * without rewriting the sort.
   */
  tierBoost: Partial<Record<AlertTier, number>>;
  quickActions: QuickActionKey[];
}

const COMMON_KPIS: KpiKey[] = [
  "residents", "meds", "tasks", "incidents", "leads", "invoices", "compliance", "staff", "tracker",
];

const LENSES: Record<Role, RoleLens> = {
  super_admin: {
    label: "Owner / Operator",
    // Owners care most about regulatory/financial signals; staff licensing
    // sits near the top because expired licenses are an audit risk. Tracker
    // documentation is a downstream care-quality signal — visible but last.
    kpis: ["residents", "incidents", "compliance", "staff", "invoices", "leads", "meds", "tasks", "tracker"],
    tierBoost: { regulatory: -1 },
    quickActions: ["postNote", "openCompliance", "addIncident", "addLead"],
  },
  facility_admin: {
    label: "Administrator",
    // Admins see everything in the canonical order; staff comes after the
    // operational KPIs and tracker is the trailing care-documentation signal.
    kpis: COMMON_KPIS,
    tierBoost: { regulatory: -1 },
    quickActions: ["postNote", "addIncident", "addLead", "chartMed"],
  },
  supervisor: {
    label: "Supervisor",
    // Supervisors run the floor — clinical first, then staff/tracker so they
    // can spot a missing license or under-documented shift early.
    kpis: ["meds", "incidents", "tasks", "tracker", "residents", "staff", "compliance", "leads", "invoices"],
    tierBoost: { clinical: -1 },
    quickActions: ["chartMed", "addIncident", "postNote", "addLead"],
  },
  med_tech: {
    label: "Medication Tech",
    kpis: ["meds", "tasks", "tracker", "incidents", "residents"],
    tierBoost: { clinical: -2 },
    quickActions: ["chartMed", "addIncident", "postNote"],
  },
  caregiver: {
    label: "Caregiver",
    // Caregivers' #1 documentation concern is whether ADLs were logged this
    // shift, so tracker rises near the top.
    kpis: ["tasks", "tracker", "residents", "meds", "incidents"],
    tierBoost: { care: -1, clinical: -1 },
    quickActions: ["postNote", "addIncident", "chartMed"],
  },
  wellness_staff: {
    label: "Wellness staff",
    kpis: ["residents", "tasks", "tracker", "meds", "incidents"],
    tierBoost: { care: -1 },
    quickActions: ["postNote", "addIncident"],
  },
  provider: {
    label: "Provider",
    kpis: ["residents", "meds", "incidents"],
    tierBoost: { clinical: -1 },
    quickActions: ["postNote", "chartMed"],
  },
  compliance_reviewer: {
    label: "Compliance reviewer",
    // Compliance reviewers care about staff licensing alongside the rest of
    // the regulatory surface area.
    kpis: ["compliance", "incidents", "staff", "residents", "meds"],
    tierBoost: { regulatory: -2 },
    quickActions: ["openCompliance", "postNote", "addIncident"],
  },
};

const ALL_ROLES = Object.keys(LENSES) as Role[];

export function isRole(value: string | null | undefined): value is Role {
  return !!value && ALL_ROLES.includes(value as Role);
}

export function getLens(role: string | null | undefined): RoleLens {
  return isRole(role) ? LENSES[role] : LENSES.facility_admin;
}

export function listRoles(): Array<{ role: Role; label: string }> {
  return ALL_ROLES.map((r) => ({ role: r, label: LENSES[r].label }));
}
