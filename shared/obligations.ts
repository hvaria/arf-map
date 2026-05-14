/**
 * shared/obligations.ts
 *
 * Single source of truth for the Wave 2 finale obligation engine
 * (BA §4.3, §6 state machine, §9 G3). The engine supersedes the legacy
 * degenerate `ops_compliance_calendar` table — Wave 2 owns its migration
 * (Engineering Plan §1). Backfilled rows carry
 * `source_entity_type = 'legacy_compliance'`.
 *
 * Imported by both `client/` and `server/`, same pattern as
 * `shared/staff-credentials.ts`, `shared/incident-types.ts`,
 * `shared/etl-types.ts`. No side-effects. No imports from `server/`,
 * `client/`, or `scripts/`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Obligation type — enum-by-convention. Mirrors the legacy
// COMPLIANCE_TYPES on ops_compliance_calendar for backfill compatibility,
// plus new types now possible with the obligation engine (credential
// renewal sourced from ops_staff_credentials, temperature follow-up
// sourced from ops_temperature_logs, vendor COI renewal, inspection
// remediation, complaint follow-up).
// ─────────────────────────────────────────────────────────────────────────────

export const OBLIGATION_TYPES = [
  // Legacy COMPLIANCE_TYPES — preserved for backfill from ops_compliance_calendar.
  "fire_safety",
  "health_inspection",
  "staff_training",
  "medication_audit",
  "incident_review",
  "resident_rights",
  "documentation_audit",
  "background_checks",
  "license_renewal",
  "fire_drill",
  "disaster_drill",
  "fire_extinguisher_service",
  "posting_verification",
  "chart_review",
  "training_in_service",
  // New types unlocked by the obligation engine.
  "credential_renewal",
  "temperature_followup",
  "vendor_coi_renewal",
  "inspection_remediation",
  "complaint_followup",
  "other",
] as const;
export type ObligationType = (typeof OBLIGATION_TYPES)[number];

export const OBLIGATION_TYPE_LABELS: Record<ObligationType, string> = {
  fire_safety: "Fire safety",
  health_inspection: "Health inspection",
  staff_training: "Staff training",
  medication_audit: "Medication audit",
  incident_review: "Incident review",
  resident_rights: "Resident rights",
  documentation_audit: "Documentation audit",
  background_checks: "Background checks",
  license_renewal: "License renewal",
  fire_drill: "Fire drill",
  disaster_drill: "Disaster drill",
  fire_extinguisher_service: "Fire extinguisher service",
  posting_verification: "Posting verification",
  chart_review: "Chart review",
  training_in_service: "In-service training",
  credential_renewal: "Credential renewal",
  temperature_followup: "Temperature follow-up",
  vendor_coi_renewal: "Vendor COI renewal",
  inspection_remediation: "Inspection remediation",
  complaint_followup: "Complaint follow-up",
  other: "Other",
};

// ─────────────────────────────────────────────────────────────────────────────
// Target — what the obligation is about. `target_id` is nullable only
// when `target_type='facility'` (facility-wide obligation, no specific
// resident/staff/vendor/room).
// ─────────────────────────────────────────────────────────────────────────────

export const OBLIGATION_TARGETS = ["facility", "resident", "staff", "vendor", "room"] as const;
export type ObligationTarget = (typeof OBLIGATION_TARGETS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Severity — citation-risk band, drives surfacing/escalation. Distinct
// from incident `event_severity`. Default 'medium'.
// ─────────────────────────────────────────────────────────────────────────────

export const OBLIGATION_SEVERITIES = ["high", "medium", "low"] as const;
export type ObligationSeverity = (typeof OBLIGATION_SEVERITIES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Status — the BA §6 state machine for `obligation`. Terminal states:
// closed | expired | rejected | approved (see isTerminalStatus()).
// ─────────────────────────────────────────────────────────────────────────────

export const OBLIGATION_STATUSES = [
  "pending",
  "in_progress",
  "submitted",
  "under_review",
  "approved",
  "rejected",
  "expired",
  "closed",
] as const;
export type ObligationStatus = (typeof OBLIGATION_STATUSES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Recurrence rule — simplified grammar persisted to
// `ops_obligations.recurrence_rule`. Full RRULE deferred until a real
// use case demands it. Format on the wire:
//   'annual' | 'quarterly' | 'monthly' | `every_n_days:${number}` | null
// `null` means one-time (no recurrence).
// ─────────────────────────────────────────────────────────────────────────────

export type RecurrencePreset = "annual" | "quarterly" | "monthly";
export type RecurrenceRule = RecurrencePreset | `every_n_days:${number}` | null;

/**
 * Parses a recurrence rule string into a normalized form. Returns null
 * for null/undefined/empty/invalid. The `days` field on preset results
 * is an approximation suitable for sorting/grouping; exact next-due
 * computation uses calendar math in `nextDueAt()`.
 */
export function parseRecurrence(
  rule: string | null | undefined,
): { kind: "preset" | "every_n_days"; days: number } | null {
  if (!rule) return null;
  if (rule === "annual") return { kind: "preset", days: 365 };
  if (rule === "quarterly") return { kind: "preset", days: 92 };
  if (rule === "monthly") return { kind: "preset", days: 31 };
  const m = rule.match(/^every_n_days:(\d+)$/);
  if (m) {
    const days = parseInt(m[1], 10);
    if (Number.isFinite(days) && days > 0) return { kind: "every_n_days", days };
  }
  return null;
}

/**
 * Computes the next `due_at` for a recurring obligation, given the
 * just-completed cycle's due_at (epoch ms).
 *
 * For `annual` / `quarterly` / `monthly` we use **calendar math** via
 * `Date#setFullYear` / `setMonth` so end-of-month and leap-year edges
 * don't drift over many cycles (e.g. Jan 31 → Feb 28/29 → Mar 28/29
 * instead of Jan 31 + 31 days = Mar 3 then Apr 3). For
 * `every_n_days:N` we fall back to ms arithmetic since the rule itself
 * is defined in literal day-units.
 *
 * Returns null when the rule is null/invalid (one-time obligation —
 * nothing to schedule next).
 */
export function nextDueAt(currentDueAt: number, rule: RecurrenceRule): number | null {
  const parsed = parseRecurrence(rule);
  if (!parsed) return null;
  if (rule === "annual") {
    const d = new Date(currentDueAt);
    d.setFullYear(d.getFullYear() + 1);
    return d.getTime();
  }
  if (rule === "quarterly") {
    const d = new Date(currentDueAt);
    d.setMonth(d.getMonth() + 3);
    return d.getTime();
  }
  if (rule === "monthly") {
    const d = new Date(currentDueAt);
    d.setMonth(d.getMonth() + 1);
    return d.getTime();
  }
  // every_n_days:N — literal day-unit arithmetic
  return currentDueAt + parsed.days * 24 * 60 * 60 * 1000;
}

/**
 * Whether `status` is terminal in the BA §6 state machine. Terminal
 * means no further transitions allowed; UI hides "advance" affordances
 * and the obligation drops off the open-obligations queue.
 */
export function isTerminalStatus(status: ObligationStatus): boolean {
  return (
    status === "closed" ||
    status === "expired" ||
    status === "rejected" ||
    status === "approved"
  );
}
