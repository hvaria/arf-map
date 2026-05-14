/**
 * shared/staff-credentials.ts
 *
 * Single source of truth for staff-credential types, statuses, the
 * per-role required matrix, and the per-credential expiry severity
 * computation. Both client and server import from this module — same
 * precedent as `shared/etl-types.ts` and the `shared/tracker-schemas/`
 * registry.
 *
 * Wave 2 W3 (BA §5 / §4.4) introduces a per-credential row model
 * (table `ops_staff_credentials`, defined in
 * `server/ops/opsSchema.ts`). The narrow `ops_staff.license_expiry`
 * column remains on the table for backward compatibility but is
 * superseded by rows in `ops_staff_credentials`.
 *
 * No side-effects, no imports from server/, client/, or scripts/.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Credential type enum (string-by-convention; persisted as TEXT)
// ─────────────────────────────────────────────────────────────────────────────

export const CREDENTIAL_TYPES = [
  "tb_clearance",
  "fingerprint_clearance",
  "cpr",
  "first_aid",
  "dementia_training",
  "food_handler",
  "rcfe_administrator_certificate",
  "pre_service_hours",
  "in_service_hours",
  "other",
] as const;
export type CredentialType = (typeof CREDENTIAL_TYPES)[number];

export const CREDENTIAL_LABELS: Record<CredentialType, string> = {
  tb_clearance: "TB clearance",
  fingerprint_clearance: "Fingerprint clearance",
  cpr: "CPR",
  first_aid: "First Aid",
  dementia_training: "Dementia training",
  food_handler: "Food handler",
  rcfe_administrator_certificate: "RCFE Administrator certificate",
  pre_service_hours: "Pre-service hours",
  in_service_hours: "In-service hours",
  other: "Other",
};

// ─────────────────────────────────────────────────────────────────────────────
// Credential status enum
// ─────────────────────────────────────────────────────────────────────────────

export const CREDENTIAL_STATUSES = ["active", "expired", "pending", "na"] as const;
export type CredentialStatus = (typeof CREDENTIAL_STATUSES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Per-role required credentials matrix.
//
// Role values match the existing `ops_staff.role` enum used in the Add
// Staff dialog (`client/src/components/operations/StaffContent.tsx`).
// Every role baseline-requires TB + Fingerprint per common practice;
// specific roles layer additional credentials.
//
// NOTE: this matrix is intended to become facility-tunable in a future
// Wave 4 ticket; v0 is hardcoded here so server validation and FE
// rendering stay in lockstep.
// ─────────────────────────────────────────────────────────────────────────────

const BASE = ["tb_clearance", "fingerprint_clearance"] as const satisfies readonly CredentialType[];

export const ROLE_REQUIRED_CREDENTIALS: Record<string, readonly CredentialType[]> = {
  administrator:        [...BASE, "rcfe_administrator_certificate"],
  caregiver:            [...BASE, "cpr", "first_aid", "pre_service_hours"],
  med_tech:             [...BASE, "cpr", "first_aid", "pre_service_hours"],
  rn:                   [...BASE, "cpr", "first_aid"],
  lpn:                  [...BASE, "cpr", "first_aid"],
  activity_coordinator: [...BASE],
  dietary:              [...BASE, "food_handler"],
  housekeeping:         [...BASE],
  maintenance:          [...BASE],
  other:                [...BASE],
};

// ─────────────────────────────────────────────────────────────────────────────
// Expiry severity for one credential.
//
// Returns:
//   "expired" — expiresAt is in the past
//   "warning" — expiresAt is within `warningDays` of `now`
//   "ok"      — expiresAt is null (non-expiring, e.g. fingerprint
//                 clearance is typically continuous via DOJ subsequent
//                 arrest notification) OR beyond the warning window
// ─────────────────────────────────────────────────────────────────────────────

export function credentialSeverity(
  expiresAt: number | null | undefined,
  warningDays: number,
  now: number = Date.now(),
): "ok" | "warning" | "expired" {
  if (expiresAt == null) return "ok";
  if (expiresAt < now) return "expired";
  const warningCutoff = now + warningDays * 24 * 60 * 60 * 1000;
  if (expiresAt <= warningCutoff) return "warning";
  return "ok";
}
