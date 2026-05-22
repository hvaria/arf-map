/**
 * Phase 2 R2 wire-format compatibility shim.
 *
 * A batch of columns flipped from TEXT to JSONB in this round:
 *   - facility_overrides.{hours_of_operation_json, languages_spoken_json,
 *     care_types_offered_json, accreditations_json, prefilled_fields}
 *   - job_postings.requirements
 *
 * Note: `job_seeker_profiles.job_types` also flipped to JSONB but is
 * intentionally NOT in this shim — the existing /api/jobseeker/profile
 * GET/PUT handlers always returned `jobTypes` as a parsed `string[]`
 * (FE type is `string[]` in client/src/lib/seekerProfileTypes.ts and
 * SeekerProfileEditor.tsx). Re-stringifying it would break every
 * consumer. The `serialiseJobSeekerProfileRow` helper stays exported as
 * a no-op so future JSONB columns on that row can plug into the same
 * pattern, but `jobTypes` itself is now natively an array on the wire.
 *
 * Pre-conversion, the server returned these to the client as JSON-encoded
 * STRINGS (FE code did its own JSON.parse). Drizzle now hands the route
 * layer parsed JS values, so without this shim the wire format would
 * silently change from `"foo": "[1,2,3]"` to `"foo": [1,2,3]`, breaking any
 * FE consumer that calls JSON.parse on the field.
 *
 * The shim re-stringifies the affected fields on outbound so the wire
 * contract is bit-for-bit preserved. A future round can flip the FE to
 * expect objects/arrays directly and delete this helper.
 *
 * Why a generic key-list helper rather than per-column wrappers:
 *   - Three different routers (facilityProfile, the main routes.ts public
 *     listing, and the seeker profile endpoints) need to re-stringify
 *     overlapping sets of fields; a single helper keeps the wire contract
 *     defined in one place.
 *   - The behaviour is safe-by-default: only fields explicitly named in the
 *     keys array are touched. If a column is somehow already a string
 *     (legacy row that bypassed JSONB), we leave it alone.
 */

export type JsonbWireRow = Record<string, unknown> | null | undefined;

const FACILITY_OVERRIDE_JSON_KEYS = [
  "hoursOfOperationJson",
  "languagesSpokenJson",
  "careTypesOfferedJson",
  "accreditationsJson",
  "prefilledFields",
] as const;

const JOB_POSTING_JSON_KEYS = ["requirements"] as const;

// Empty — see header comment. `jobTypes` is intentionally NOT
// re-stringified; the wire contract for that field is `string[]`, matching
// how the GET/PUT /api/jobseeker/profile handlers have always returned it.
const JOB_SEEKER_PROFILE_JSON_KEYS = [] as const;

function stringifyJsonbKeys<T extends Record<string, unknown>>(
  row: T,
  keys: readonly string[],
): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of keys) {
    const v = out[k];
    if (v === null || v === undefined) continue;
    if (typeof v === "string") continue; // legacy safety
    out[k] = JSON.stringify(v);
  }
  return out as T;
}

/** Stringify the JSONB fields on a facility_overrides row for wire output. */
export function serialiseFacilityOverrideRow<T extends Record<string, unknown>>(
  row: T,
): T;
export function serialiseFacilityOverrideRow(row: JsonbWireRow): JsonbWireRow;
export function serialiseFacilityOverrideRow(row: JsonbWireRow): JsonbWireRow {
  if (!row) return row;
  return stringifyJsonbKeys(row, FACILITY_OVERRIDE_JSON_KEYS);
}

/** Stringify the JSONB fields on a job_postings row for wire output. */
export function serialiseJobPostingRow<T extends Record<string, unknown>>(
  row: T,
): T;
export function serialiseJobPostingRow(row: JsonbWireRow): JsonbWireRow;
export function serialiseJobPostingRow(row: JsonbWireRow): JsonbWireRow {
  if (!row) return row;
  return stringifyJsonbKeys(row, JOB_POSTING_JSON_KEYS);
}

/** Stringify the JSONB fields on a job_seeker_profiles row for wire output. */
export function serialiseJobSeekerProfileRow<T extends Record<string, unknown>>(
  row: T,
): T;
export function serialiseJobSeekerProfileRow(row: JsonbWireRow): JsonbWireRow;
export function serialiseJobSeekerProfileRow(row: JsonbWireRow): JsonbWireRow {
  if (!row) return row;
  return stringifyJsonbKeys(row, JOB_SEEKER_PROFILE_JSON_KEYS);
}
