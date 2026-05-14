/**
 * shared/incident-types.ts
 *
 * Single source of truth for incident_type → severity classification.
 * Imported by both `client/` and `server/`, same pattern as
 * `shared/staff-credentials.ts` and `shared/etl-types.ts`.
 *
 * Wave 2 W4 (BA §5 W4, §6 state machine) introduces `event_severity`
 * on `ops_incidents`. The SLA evaluator looks up which reg-setting
 * applies based on this value:
 *
 *   'serious'      → INCIDENT_VERBAL_SERIOUS_HOURS      (default 2 h)
 *   'non_emergent' → INCIDENT_VERBAL_NON_EMERGENT_HOURS (default 24 h)
 *   anything else  → treated as 'non_emergent'
 *
 * The mappings below are PLACEHOLDER ([V]) per Phase 1 §11 BLOCKING.
 * Real admin / CDSS validation is required before going live.
 *
 * No side-effects. No imports from `server/`, `client/`, or `scripts/`.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Severity enum
// ─────────────────────────────────────────────────────────────────────────────

export type IncidentSeverity = "serious" | "non_emergent";

// ─────────────────────────────────────────────────────────────────────────────
// Default-severity table — keyed by incident_type as persisted on
// ops_incidents.incident_type. Any value not present here falls back
// to 'non_emergent'. When adding a new incident_type, also add a row
// here so the SLA evaluator can categorize it.
// ─────────────────────────────────────────────────────────────────────────────

export const INCIDENT_SEVERITY: Record<string, IncidentSeverity> = {
  fall:              "non_emergent", // [V] — depends on injury_involved
  medication_error:  "non_emergent", // [V]
  elopement:         "serious",      // [V]
  altercation:       "non_emergent", // [V]
  injury:            "non_emergent", // [V]
  behavioral:        "non_emergent", // [V]
  medical_emergency: "serious",      // [V]
  property_damage:   "non_emergent", // [V]
  death:             "serious",      // [V]
  abuse_suspected:   "serious",      // [V] — triggers SOC 341
  missing_person:    "serious",      // [V]
  hospitalization:   "serious",      // [V] — when emergent transfer
  other:             "non_emergent",
};

// ─────────────────────────────────────────────────────────────────────────────
// Classification helper — applies severity escalation rules on top of
// the default table. Backend should call this at incident-write time
// and persist the result to `ops_incidents.event_severity`.
//
// Rules (PLACEHOLDER, [V]):
//   1. Any incident with hospitalization_required = 1 → 'serious'.
//   2. fall or altercation + injury_involved = 1 → 'serious'.
//   3. Otherwise → INCIDENT_SEVERITY[incident_type] ?? 'non_emergent'.
// ─────────────────────────────────────────────────────────────────────────────

export function classifyIncidentSeverity(
  incidentType: string,
  flags: { injuryInvolved?: boolean; hospitalizationRequired?: boolean } = {},
): IncidentSeverity {
  if (flags.hospitalizationRequired) return "serious";
  if (
    flags.injuryInvolved &&
    (incidentType === "fall" || incidentType === "altercation")
  ) {
    return "serious";
  }
  return INCIDENT_SEVERITY[incidentType] ?? "non_emergent";
}
