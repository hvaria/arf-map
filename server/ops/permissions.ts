/**
 * F4 — Ops role-based permission scaffold.
 *
 * Pattern reused: mounts alongside the existing `requireFacilityAuth`
 * middleware in `server/ops/opsRouter.ts:34-42` — does NOT replace it.
 * Every Wave 0 endpoint chains `requireFacilityAuth` (already in the
 * router) → `requireActiveSubscription` (already in the router) →
 * `requireOpsPermission(resource, action)` (this file).
 *
 * Phase 3 stance: `resolveRole()` now reads from `req.user.role` (which
 * Passport sets to the `facility_accounts.role` column value). Until a
 * dedicated facility-users table lands, every facility_accounts row maps
 * to an OpsRole via KNOWN_DB_TO_OPS_ROLE below. Unknown DB role strings
 * fall back to `"admin"` so a column mismatch never accidentally locks
 * out a paying facility; a console.warn surfaces drift to operations.
 *
 * Auditor share-link traffic does NOT flow through this resolver — it
 * uses requireAuditorToken on a separate router and never hits a
 * facility-Passport session.
 */

import type { NextFunction, Request, Response } from "express";

export type OpsRole =
  | "admin"
  | "auditor"
  | "don"
  | "med_tech"
  | "schedule_lead"
  | "office_manager";

export type OpsAction =
  | "read"
  | "create"
  | "update"
  | "delete"
  | "resolve"
  | "close"
  | "manage_settings";

export interface Permission {
  resource: string;
  actions: OpsAction[];
}

// Resources known in Wave 0. Wave 1+ tickets append to this list; the
// permissions matrix below is keyed by resource string so the additions
// are local.
export const OPS_RESOURCES = {
  REG_SETTING: "ops_reg_setting",
  EVIDENCE: "ops_evidence",
  AUDIT_TRAIL: "ops_audit_trail",
  // Wave 1 additions (Epic B)
  TEMPERATURE_FIXTURE: "ops_temperature_fixture",
  TEMPERATURE_LOG: "ops_temperature_log",
  DRILL_LOG: "ops_drill_log",
  VENDOR: "ops_vendor",
  COMPLAINT: "ops_complaint",
  INSPECTION: "ops_inspection",
  CONTROLLED_SUB_COUNT: "ops_controlled_sub_count",
  // Wave 2 additions (Epic C)
  STAFF_CREDENTIAL: "ops_staff_credential",
  INCIDENT: "ops_incident",
  // Wave 2 W8 — resident-chart-completeness reads. Hangs off the
  // existing residents Module 1 storage. Granting `read` here keeps the
  // chart-completeness routes consistent with the rest of the ops
  // permission scaffold; the existing un-gated residents CRUD remains
  // facility-auth-only for now.
  RESIDENT: "ops_resident",
  // Wave 2 finale — generic obligation engine (BA §4.3, §6, §9 G3).
  // Supersedes the legacy `ops_compliance_calendar` resource on read +
  // write paths via a transparent shim in `opsRouter.ts`. Admin gets full
  // CRUD; auditor is read-only (consistent with W3/W4 patterns).
  OBLIGATION: "ops_obligation",
  // Wave 3 Phase 3.2 — share-link admin operations. Auditor role does
  // NOT appear in the matrix below for these resources: auditor traffic
  // never uses the facility-Passport ROLE_PERMISSIONS path, it has its
  // own parallel auth (requireAuditorToken) on a separate router.
  SHARE_LINK: "ops_share_link",
  PREAUDIT_PULL: "ops_preaudit_pull",
  // Wave 4 Phase 4.1 — Posting verification catalogue (W6). Per-facility
  // catalog rows + walkthrough verification log. Admin gets read/create/
  // update; auditor read-only (read-only audit walkthrough use case).
  POSTING: "ops_posting",
  // Wave 4 Phase 4.2 — Resident trust accounts (W12). Per-resident trust
  // accounts + insert-only ledger + monthly statement snapshots. Admin
  // gets read/create/update (no delete — ledger is application-insert-only,
  // corrections happen via reversal entries). Auditor read-only.
  RESIDENT_TRUST: "ops_resident_trust",
  // Wave 5 — Reports Hub. Persistent library of generated reports
  // (pre-audit pulls, MAR exports, incident summaries, monthly statements,
  // audit-trail extracts, tracker exports, etc.). Admin gets read/create/
  // delete (soft). Auditor read-only — auditor share-link sessions can
  // pull previously generated reports for inspector handoff.
  REPORT: "ops_report",
  // Phase 3 — Module 1 to Module 6 resources. These existed as un-gated
  // routes ("facility-auth-only for now") before the role wiring landed.
  // Admin gets full CRUD; auditor gets read-only on the visible-to-
  // auditor-share-link subset. Group the keys by module so the matrix
  // below stays greppable.
  RESIDENT_ASSESSMENT: "ops_resident_assessment", // Module 1
  CARE_PLAN: "ops_care_plan",                     // Module 1
  DAILY_TASK: "ops_daily_task",                   // Module 1
  MEDICATION: "ops_medication",                   // Module 2
  MED_PASS: "ops_med_pass",                       // Module 2
  MED_DESTRUCTION: "ops_med_destruction",         // Module 2
  LEAD: "ops_lead",                               // Module 4 (CRM)
  TOUR: "ops_tour",                               // Module 4
  ADMISSION: "ops_admission",                     // Module 4
  BILLING: "ops_billing",                         // Module 5
  STAFF: "ops_staff",                             // Module 6
  SHIFT: "ops_shift",                             // Module 6
  // Read-only operational dashboards aggregated across modules. Auditor
  // share-link can see the same rollups for inspector handoff.
  DASHBOARD: "ops_dashboard",
} as const;

const ADMIN_ALL: Permission[] = [
  {
    resource: OPS_RESOURCES.REG_SETTING,
    actions: ["read", "create", "update", "manage_settings"],
  },
  {
    resource: OPS_RESOURCES.EVIDENCE,
    // attach = create, detach = delete (soft).
    actions: ["read", "create", "delete"],
  },
  {
    resource: OPS_RESOURCES.AUDIT_TRAIL,
    actions: ["read"],
  },
  // Wave 1 additions — admin has full grant on every new resource.
  // `close` and `resolve` are domain-specific terminal actions
  // (e.g., resolve a complaint / out-of-range follow-up; close an
  // inspection or citation). Listing them explicitly keeps the matrix
  // greppable and forces tests to opt in per action.
  {
    resource: OPS_RESOURCES.TEMPERATURE_FIXTURE,
    actions: ["read", "create", "update", "delete"],
  },
  {
    resource: OPS_RESOURCES.TEMPERATURE_LOG,
    actions: ["read", "create", "update", "resolve"],
  },
  {
    resource: OPS_RESOURCES.DRILL_LOG,
    actions: ["read", "create", "update", "delete"],
  },
  {
    resource: OPS_RESOURCES.VENDOR,
    actions: ["read", "create", "update", "delete"],
  },
  {
    resource: OPS_RESOURCES.COMPLAINT,
    actions: ["read", "create", "update", "resolve", "close"],
  },
  {
    resource: OPS_RESOURCES.INSPECTION,
    actions: ["read", "create", "update", "close"],
  },
  {
    resource: OPS_RESOURCES.CONTROLLED_SUB_COUNT,
    actions: ["read", "resolve"],
  },
  // Wave 2 — Staff credentials (W3). Admin gets full CRUD; the soft-delete
  // path is gated by `delete`. There is no `resolve`/`close` for credentials
  // — renewal is a write (update) and the status field carries the lifecycle.
  {
    resource: OPS_RESOURCES.STAFF_CREDENTIAL,
    actions: ["read", "create", "update", "delete"],
  },
  // Wave 2 — Incident lifecycle closer (W4). Admin can read/create/update
  // every incident and close (terminal state with checklist gate) or
  // re-open (closed → under_review). No 'delete' — incidents are
  // forensic records and only soft-state transitions are exposed.
  {
    resource: OPS_RESOURCES.INCIDENT,
    actions: ["read", "create", "update", "close"],
  },
  // Wave 2 — Resident chart completeness (W8) + Phase 3 — full resident
  // CRUD now flows through this resource. Admin can read/create/update/
  // delete (soft). Auditor stays read-only.
  {
    resource: OPS_RESOURCES.RESIDENT,
    actions: ["read", "create", "update", "delete"],
  },
  // Phase 3 — Module 1 (resident chart) sub-resources.
  {
    resource: OPS_RESOURCES.RESIDENT_ASSESSMENT,
    actions: ["read", "create", "update"],
  },
  {
    resource: OPS_RESOURCES.CARE_PLAN,
    actions: ["read", "create", "update"],
  },
  {
    resource: OPS_RESOURCES.DAILY_TASK,
    actions: ["read", "create", "update"],
  },
  // Phase 3 — Module 2 (eMAR). DELETE on medication maps to "discontinue"
  // (the soft-state transition exposed by the route).
  {
    resource: OPS_RESOURCES.MEDICATION,
    actions: ["read", "create", "update", "delete"],
  },
  {
    resource: OPS_RESOURCES.MED_PASS,
    actions: ["read", "create", "update"],
  },
  {
    resource: OPS_RESOURCES.MED_DESTRUCTION,
    actions: ["read", "create"],
  },
  // Phase 3 — Module 4 (CRM). Admission `delete` is intentionally omitted;
  // the convert flow is a `create` event against a different resource.
  {
    resource: OPS_RESOURCES.LEAD,
    actions: ["read", "create", "update"],
  },
  {
    resource: OPS_RESOURCES.TOUR,
    actions: ["read", "create", "update"],
  },
  {
    resource: OPS_RESOURCES.ADMISSION,
    actions: ["read", "create", "update"],
  },
  // Phase 3 — Module 5 (Billing). Single resource covers charges,
  // invoices, payments, AR aging, billing summary — they all guard the
  // same financial surface.
  {
    resource: OPS_RESOURCES.BILLING,
    actions: ["read", "create", "update", "delete"],
  },
  // Phase 3 — Module 6 (Staff + Scheduling).
  {
    resource: OPS_RESOURCES.STAFF,
    actions: ["read", "create", "update", "delete"],
  },
  {
    resource: OPS_RESOURCES.SHIFT,
    actions: ["read", "create", "update"],
  },
  // Phase 3 — Dashboard rollups (facility dashboard, calendar, occupancy,
  // CRM pipeline, eMAR dashboard, incident trends, med refusals, PRN
  // report). All read-only.
  {
    resource: OPS_RESOURCES.DASHBOARD,
    actions: ["read", "create"],
  },
  // Wave 2 finale — obligation engine. Admin can read/create/update/delete
  // (soft). `delete` gates the soft-delete path; the state machine itself
  // is enforced inside `obligationsStorage.transitionObligation` so admin
  // role + correct transition are both required for terminal moves.
  {
    resource: OPS_RESOURCES.OBLIGATION,
    actions: ["read", "create", "update", "delete"],
  },
  // Wave 3 Phase 3.2 — share-link admin operations. Mint, list, revoke.
  // No `delete` — revocation is the terminal action and is gated by
  // `update`. The auditor session that consumes the minted token is a
  // separate auth path (requireAuditorToken) and is NOT modeled in this
  // matrix; the row is omitted from AUDITOR_READ_ONLY below by design.
  {
    resource: OPS_RESOURCES.SHARE_LINK,
    actions: ["read", "create", "update"],
  },
  // Wave 3 Phase 3.2 — W2 pre-audit pull. `create` mints the bundle (and
  // optionally a share-link). `read` lists past pulls for the admin
  // history view.
  {
    resource: OPS_RESOURCES.PREAUDIT_PULL,
    actions: ["read", "create"],
  },
  // Wave 4 Phase 4.1 — Posting verification (W6). Admin gets read/create/
  // update on the catalog + verifications. No delete — catalog rows are
  // archived via the `archive` route (an update path) and verifications
  // are append-only forensic records.
  {
    resource: OPS_RESOURCES.POSTING,
    actions: ["read", "create", "update"],
  },
  // Wave 4 Phase 4.2 — Resident trust accounts (W12). Admin gets read/
  // create/update. `update` gates close + repair-balance. No `delete` —
  // ledger is application-insert-only; corrections happen via reversals
  // (which are `create` events themselves).
  {
    resource: OPS_RESOURCES.RESIDENT_TRUST,
    actions: ["read", "create", "update"],
  },
  // Wave 5 — Reports Hub. Admin can read/create/delete (soft). `create`
  // gates the synchronous generate path. `delete` gates soft-delete; the
  // underlying file is purged by the retention cron, not by user delete.
  {
    resource: OPS_RESOURCES.REPORT,
    actions: ["read", "create", "delete"],
  },
];

const AUDITOR_READ_ONLY: Permission[] = [
  { resource: OPS_RESOURCES.REG_SETTING,         actions: ["read"] },
  { resource: OPS_RESOURCES.EVIDENCE,            actions: ["read"] },
  { resource: OPS_RESOURCES.AUDIT_TRAIL,         actions: ["read"] },
  { resource: OPS_RESOURCES.TEMPERATURE_FIXTURE, actions: ["read"] },
  { resource: OPS_RESOURCES.TEMPERATURE_LOG,     actions: ["read"] },
  { resource: OPS_RESOURCES.DRILL_LOG,           actions: ["read"] },
  { resource: OPS_RESOURCES.VENDOR,              actions: ["read"] },
  { resource: OPS_RESOURCES.COMPLAINT,           actions: ["read"] },
  { resource: OPS_RESOURCES.INSPECTION,          actions: ["read"] },
  { resource: OPS_RESOURCES.CONTROLLED_SUB_COUNT,actions: ["read"] },
  { resource: OPS_RESOURCES.STAFF_CREDENTIAL,    actions: ["read"] },
  { resource: OPS_RESOURCES.INCIDENT,            actions: ["read"] },
  { resource: OPS_RESOURCES.RESIDENT,            actions: ["read"] },
  { resource: OPS_RESOURCES.OBLIGATION,          actions: ["read"] },
  { resource: OPS_RESOURCES.POSTING,             actions: ["read"] },
  { resource: OPS_RESOURCES.RESIDENT_TRUST,      actions: ["read"] },
  // Wave 5 — Reports Hub. Auditor share-link can pull previously generated
  // reports (download via the auditor router mirror endpoint) for inspector
  // handoff. Read-only — auditors never trigger generation themselves.
  { resource: OPS_RESOURCES.REPORT,              actions: ["read"] },
  // Phase 3 — Module 1 to Module 6 read-only auditor mirror. Mirrors the
  // existing Wave 2 W8 stance on RESIDENT — auditor can read every chart
  // / lead / billing surface the admin can, but can't write.
  { resource: OPS_RESOURCES.RESIDENT_ASSESSMENT, actions: ["read"] },
  { resource: OPS_RESOURCES.CARE_PLAN,           actions: ["read"] },
  { resource: OPS_RESOURCES.DAILY_TASK,          actions: ["read"] },
  { resource: OPS_RESOURCES.MEDICATION,          actions: ["read"] },
  { resource: OPS_RESOURCES.MED_PASS,            actions: ["read"] },
  { resource: OPS_RESOURCES.MED_DESTRUCTION,     actions: ["read"] },
  { resource: OPS_RESOURCES.LEAD,                actions: ["read"] },
  { resource: OPS_RESOURCES.TOUR,                actions: ["read"] },
  { resource: OPS_RESOURCES.ADMISSION,           actions: ["read"] },
  { resource: OPS_RESOURCES.BILLING,             actions: ["read"] },
  { resource: OPS_RESOURCES.STAFF,               actions: ["read"] },
  { resource: OPS_RESOURCES.SHIFT,               actions: ["read"] },
  { resource: OPS_RESOURCES.DASHBOARD,           actions: ["read"] },
];

// Wave 0 matrix. Other roles are scaffolded but unused — Wave 2+ fills
// them in when the staff-credential / shift work lands. Leaving them
// here keeps the contract stable so Wave 1 route mounts don't churn.
export const ROLE_PERMISSIONS: Record<OpsRole, Permission[]> = {
  admin: ADMIN_ALL,
  auditor: AUDITOR_READ_ONLY,
  don: [],
  med_tech: [],
  schedule_lead: [],
  office_manager: [],
};

/**
 * Mapping from the DB column `facility_accounts.role` (a free-form text
 * column with a default of `"facility_admin"`) to the OpsRole enum used
 * by `ROLE_PERMISSIONS` above.
 *
 * `facility_admin` is the DB default for every existing account — it
 * intentionally maps to OpsRole `admin` so historical accounts retain
 * full CRUD without a data migration. New rows that want a narrower role
 * (auditor view sharing, future facility_users entries, etc.) write the
 * narrower string and pick up the matching matrix entry.
 *
 * Keep keys lowercase; the resolver lowercases & trims the DB value
 * before lookup.
 */
const KNOWN_DB_TO_OPS_ROLE: Record<string, OpsRole> = {
  facility_admin: "admin",
  admin: "admin",
  auditor: "auditor",
  don: "don",
  med_tech: "med_tech",
  schedule_lead: "schedule_lead",
  office_manager: "office_manager",
};

/**
 * Resolve the effective Ops role for the request.
 *
 * Reads `req.user.role` from the authenticated facility-Passport session
 * (Passport's deserializeUser hydrates the full FacilityAccount onto
 * req.user, including the `role` column). Returns `"admin"` for unknown
 * values so a stray DB string never accidentally locks a user out — but
 * emits a `console.warn` so operations can spot drift.
 *
 * Test code can monkey-patch `resolveRole` via module mocking to assert
 * the auditor / deny paths.
 */
export function resolveRole(req: Request): OpsRole {
  const user = req.user as { role?: string | null } | undefined;
  const rawRole = user?.role;
  const dbRole =
    typeof rawRole === "string" && rawRole.trim().length > 0
      ? rawRole.trim().toLowerCase()
      : "facility_admin";
  const opsRole = KNOWN_DB_TO_OPS_ROLE[dbRole];
  if (!opsRole) {
    // Surface unexpected DB role strings without locking the user out.
    // Phase 3 fallback contract; revisit when facility_users lands.
    // eslint-disable-next-line no-console
    console.warn(
      `[permissions] unknown facility_accounts.role="${dbRole}" — defaulting to admin`,
    );
    return "admin";
  }
  return opsRole;
}

/**
 * Express middleware factory. Mounted per-route as the third middleware
 * in the chain (after auth + subscription). On deny it returns the
 * standard ops envelope shape `{ success: false, error }` so the FE
 * error-banner pattern keeps working without a special case.
 */
export function requireOpsPermission(resource: string, action: OpsAction) {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = resolveRole(req);
    const perms = ROLE_PERMISSIONS[role] ?? [];
    const allowed = perms.some(
      (p) => p.resource === resource && p.actions.includes(action),
    );
    if (!allowed) {
      return res
        .status(403)
        .json({ success: false, error: "Forbidden" });
    }
    return next();
  };
}
