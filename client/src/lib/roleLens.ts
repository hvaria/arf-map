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
  | "compliance";

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
  "residents", "meds", "tasks", "incidents", "leads", "invoices", "compliance",
];

const LENSES: Record<Role, RoleLens> = {
  super_admin: {
    label: "Owner / Operator",
    kpis: ["residents", "incidents", "compliance", "invoices", "leads", "meds", "tasks"],
    tierBoost: { regulatory: -1 },
    quickActions: ["postNote", "openCompliance", "addIncident", "addLead"],
  },
  facility_admin: {
    label: "Administrator",
    kpis: COMMON_KPIS,
    tierBoost: { regulatory: -1 },
    quickActions: ["postNote", "addIncident", "addLead", "chartMed"],
  },
  supervisor: {
    label: "Supervisor",
    kpis: ["meds", "incidents", "tasks", "residents", "compliance", "leads", "invoices"],
    tierBoost: { clinical: -1 },
    quickActions: ["chartMed", "addIncident", "postNote", "addLead"],
  },
  med_tech: {
    label: "Medication Tech",
    kpis: ["meds", "tasks", "incidents", "residents"],
    tierBoost: { clinical: -2 },
    quickActions: ["chartMed", "addIncident", "postNote"],
  },
  caregiver: {
    label: "Caregiver",
    kpis: ["tasks", "residents", "meds", "incidents"],
    tierBoost: { care: -1, clinical: -1 },
    quickActions: ["postNote", "addIncident", "chartMed"],
  },
  wellness_staff: {
    label: "Wellness staff",
    kpis: ["residents", "tasks", "meds", "incidents"],
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
    kpis: ["compliance", "incidents", "residents", "meds"],
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
