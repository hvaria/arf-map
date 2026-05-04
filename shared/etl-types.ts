/**
 * shared/etl-types.ts
 *
 * Types and pure utility functions shared between the main app server and
 * the ETL scripts. No side-effects, no imports from server/ or scripts/.
 *
 * This file is the single source of truth for:
 *  - FacilityDbRow interface (the SQLite/Postgres table shape)
 *  - GEO_STATUS lookup (CCLD GeoJSON STATUS code → label)
 *  - typeToGroup() legacy substring-based domain heuristic
 *  - formatPhone() utility
 *
 * NOTE: The canonical facility taxonomy (domain/group/type → official label,
 * acronym, raw-name normalization, GEO TYPE codes) lives in
 * `shared/taxonomy.ts`. New code should call `normalizeRawType()` /
 * `resolveGeoTypeCode()` from there instead of `typeToGroup()`. The previous
 * `TYPE_TO_NAME` lookup (broken codes — see commit 4c70f4e) has been removed.
 *
 * `typeToGroup()` is retained only because legacy live-fetch code paths in
 * `server/services/facilitiesService.ts` still call it. New audits and ETL
 * code must validate against the canonical taxonomy.
 *
 * Keeping these here breaks the import cycle that would otherwise require
 * ETL scripts to import from server/storage.ts or server/services/.
 */

// ── FacilityDbRow ─────────────────────────────────────────────────────────────

/** Shape of a row in the `facilities` SQLite table. */
export interface FacilityDbRow {
  number:               string;
  name:                 string;
  facility_type:        string;
  facility_group:       string;
  status:               string;
  address:              string;
  city:                 string;
  county:               string;
  zip:                  string;
  phone:                string;
  licensee:             string;
  administrator:        string;
  capacity:             number;
  first_license_date:   string;
  closed_date:          string;
  last_inspection_date: string;
  total_visits:         number;
  total_type_b:         number;
  citations:            number;
  lat:                  number | null;
  lng:                  number | null;
  geocode_quality:      string;
  updated_at:           number;
}

// ── CCLD lookup tables ────────────────────────────────────────────────────────

/** GeoJSON STATUS numeric code → human-readable status text */
export const GEO_STATUS: Record<string, string> = {
  "1": "PENDING",
  "2": "PENDING",
  "3": "LICENSED",
  "4": "ON PROBATION",
  "5": "CLOSED",
  "6": "REVOKED",
};

// ── Pure utility functions ────────────────────────────────────────────────────

/**
 * Legacy substring-based domain heuristic. Retained for live-fetch fallback
 * in `server/services/facilitiesService.ts`. New code should use
 * `normalizeRawType().domain` from `shared/taxonomy.ts` instead.
 *
 * @deprecated Use `normalizeRawType()` from `shared/taxonomy.ts`.
 */
export function typeToGroup(facilityType: string): string {
  const t = facilityType.toLowerCase();
  if (
    t.includes("child care center") ||
    t.includes("family child care")
  ) return "Child Care";
  if (
    t.includes("group home") ||
    t.includes("short-term residential") ||
    t.includes("strtp") ||
    t.includes("community treatment") ||
    t.includes("foster family")
  ) return "Children's Residential";
  if (t.includes("home care organization")) return "Home Care";
  return "Adult & Senior Care";
}

/** Format a raw phone number string to (XXX) XXX-XXXX. */
export function formatPhone(raw: string | null | undefined): string {
  const d = (raw ?? "").replace(/\D/g, "");
  if (d.length === 10) return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  if (d.length === 11 && d[0] === "1")
    return `(${d.slice(1, 4)}) ${d.slice(4, 7)}-${d.slice(7)}`;
  return raw ?? "";
}
