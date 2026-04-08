/**
 * scripts/etl-helpers.ts
 *
 * Shared helpers for the ETL pipeline. Contains fetchAllPages() — which is
 * intentionally NOT exported from server/services/facilitiesService.ts — along
 * with the lookup tables that both the live-fetch path and ETL share.
 *
 * Also contains CCLD Transparency API enrichment helpers (fetchLastInspectionDate,
 * fetchAdminFromReport, rateLimiter, enrichFacilities).
 *
 * DO NOT import this file from server/ code. It is scripts-only.
 */

// Type-only imports — do NOT cause runtime module side-effects
import type { FacilityDbRow } from "../server/storage";
import type { EtlConfig } from "./etl-config";

const CHHS_BASE = "https://data.chhs.ca.gov/api/3/action/datastore_search";
const CCLD_BASE = "https://www.ccld.dss.ca.gov/transparencyapi/api";

/** GeoJSON STATUS numeric code → human-readable status text */
export const GEO_STATUS: Record<string, string> = {
  "1": "PENDING",
  "2": "PENDING",
  "3": "LICENSED",
  "4": "ON PROBATION",
  "5": "CLOSED",
  "6": "REVOKED",
};

/** CCLD GeoJSON TYPE numeric code → human-readable facility type name */
export const TYPE_TO_NAME: Record<string, string> = {
  "140": "Foster Family Agency",
  "180": "Group Home",
  "192": "Enhanced Behavioral Supports Home",
  "193": "Community Treatment Facility",
  "194": "Short-Term Residential Therapeutic Program",
  "250": "Family Child Care Home - Small",
  "255": "Family Child Care Home - Large",
  "310": "Child Care Center",
  "385": "Residential Care Facility for the Elderly",
  "400": "Adult Day Program",
  "410": "Social Rehabilitation Facility",
  "425": "Congregate Living Health Facility",
  "500": "Residential Care Facility for the Chronically Ill",
  "735": "Adult Residential Facility",
  "740": "Adult Residential Facility for Persons with Special Health Care Needs",
  "800": "Home Care Organization",
};

/**
 * Fetch every page from a CHHS CKAN datastore resource.
 *
 * Mirrors the private fetchAllPages() inside facilitiesService.ts but accepts
 * a configurable pageSize so the ETL can tune it via ETL_CONFIG.
 */
export async function fetchAllPages(
  resourceId: string,
  pageSize = 5000,
  filters?: Record<string, string>,
  q?: string,
): Promise<any[]> {
  const rows: any[] = [];
  let offset = 0;
  let page = 1;

  while (true) {
    process.stdout.write(`\r    page ${page}  (offset ${offset}, total so far: ${rows.length})…`);

    const params = new URLSearchParams({
      resource_id: resourceId,
      limit: String(pageSize),
      offset: String(offset),
    });
    if (filters) params.set("filters", JSON.stringify(filters));
    if (q) params.set("q", q);

    const res = await fetch(`${CHHS_BASE}?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (!res.ok) {
      throw new Error(`CHHS API returned HTTP ${res.status} for resource ${resourceId}`);
    }

    const json = await res.json();
    const records: any[] = json.result?.records ?? [];
    rows.push(...records);

    if (records.length < pageSize) break; // last page
    offset += pageSize;
    page++;
  }

  // Clear the progress line
  process.stdout.write("\r" + " ".repeat(60) + "\r");

  return rows;
}

// ── CCLD Transparency API — enrichment helpers ────────────────────────────────

/**
 * Normalise a date string to YYYY-MM-DD.
 * Handles MM/DD/YYYY and ISO 8601 inputs.
 */
function normalizeDate(raw: string): string {
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) {
    return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  }
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return raw;
}

/** Pick the most recent visitDate from a parsed JSON array. */
function parseMostRecentVisitDate(data: unknown): string | null {
  const records: any[] = Array.isArray(data)
    ? data
    : ((data as any)?.records ?? (data as any)?.value ?? []);

  let latestMs = 0;
  let latestNorm = "";

  for (const r of records) {
    const raw: string =
      r.visitDate ?? r.VisitDate ?? r.visit_date ?? r.VisitDt ?? r.visitdt ?? "";
    if (!raw) continue;
    const ms = new Date(raw).getTime();
    if (!isNaN(ms) && ms > latestMs) {
      latestMs = ms;
      latestNorm = normalizeDate(raw);
    }
  }

  return latestNorm || null;
}

/** Extract a visit date from an HTML report body via regex. */
function extractVisitDateFromHtml(html: string): string | null {
  const m = html.match(
    /VISIT\s+DATE[:\s]+(\d{1,2}\/\d{1,2}\/\d{4}|\d{4}-\d{2}-\d{2})/i
  );
  return m ? normalizeDate(m[1]) : null;
}

/** Extract administrator name from an HTML report body via regex. */
function extractAdminFromHtml(html: string): string | null {
  // Matches "ADMINISTRATOR/DIRECTOR: John Smith" up to a line-break or HTML tag
  const m = html.match(
    /ADMINISTRATOR(?:\/DIRECTOR)?[:\s]+([A-Za-z][A-Za-z\s,.'"-]{2,60})(?:\r?\n|<|PHONE|FAX|LICENSE|CAPACITY)/i
  );
  return m ? m[1].trim() : null;
}

/**
 * Fetch the most recent inspection date from the CCLD Transparency API.
 *
 * Primary:  FacilityInspections endpoint (JSON array of visits).
 * Fallback: FacilityReports HTML, regex on "VISIT DATE:" text.
 *
 * Returns null on any failure or when no date can be found.
 */
export async function fetchLastInspectionDate(
  facNum: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${CCLD_BASE}/FacilityInspections?facNum=${encodeURIComponent(facNum)}`,
      { headers: { Accept: "application/json" } },
    );
    if (!res.ok) return null;

    const ct = res.headers.get("content-type") ?? "";
    const body = await res.text();

    if (ct.includes("json") || body.trimStart().startsWith("[") || body.trimStart().startsWith("{")) {
      try {
        return parseMostRecentVisitDate(JSON.parse(body));
      } catch {
        // fall through to HTML path
      }
    }

    // FacilityInspections returned HTML — try FacilityReports as fallback
    const fallback = await fetch(
      `${CCLD_BASE}/FacilityReports?facNum=${encodeURIComponent(facNum)}&inx=4`,
    );
    if (!fallback.ok) return null;
    return extractVisitDateFromHtml(await fallback.text());
  } catch {
    return null;
  }
}

/**
 * Fetch the administrator name from the most recent CCLD evaluation report.
 *
 * Fetches FacilityReports HTML and parses "ADMINISTRATOR/DIRECTOR:" line.
 * Returns null on any failure or when the line cannot be found.
 */
export async function fetchAdminFromReport(
  facNum: string,
): Promise<string | null> {
  try {
    const res = await fetch(
      `${CCLD_BASE}/FacilityReports?facNum=${encodeURIComponent(facNum)}&inx=4`,
    );
    if (!res.ok) return null;
    return extractAdminFromHtml(await res.text());
  } catch {
    return null;
  }
}

/**
 * Returns a throttle function that, when awaited, ensures callers do not
 * exceed `requestsPerSecond` sequential HTTP requests.
 */
export function rateLimiter(requestsPerSecond: number): () => Promise<void> {
  const minIntervalMs = 1000 / Math.max(requestsPerSecond, 0.1);
  let lastCallMs = 0;
  return async (): Promise<void> => {
    const now = Date.now();
    const wait = minIntervalMs - (now - lastCallMs);
    if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
    lastCallMs = Date.now();
  };
}

function fmtEta(seconds: number): string {
  if (seconds < 60) return `${Math.ceil(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.ceil(seconds % 60);
  return `${m}m ${s}s`;
}

/**
 * Enrich a batch of facilities with data from the CCLD Transparency API.
 *
 * - Applies per-field `skipIfPopulated` logic.
 * - Respects `enrichLimit` and `requestsPerSecond` from config.
 * - Never throws on per-facility failures — logs a warning and continues.
 *
 * Returns a Map of facilityNumber → enriched fields to be merged by the caller.
 */
export async function enrichFacilities(
  facilities: Array<{ number: string; administrator?: string; licensee?: string }>,
  config: EtlConfig["enrichment"],
): Promise<Map<string, Partial<FacilityDbRow>>> {
  const results = new Map<string, Partial<FacilityDbRow>>();
  const throttle = rateLimiter(config.requestsPerSecond);

  const candidates =
    config.enrichLimit > 0
      ? facilities.slice(0, config.enrichLimit)
      : facilities;

  const total = candidates.length;
  let done = 0;
  let datesFound = 0;
  const startMs = Date.now();

  for (const fac of candidates) {
    const patch: Partial<FacilityDbRow> = {};

    try {
      // ── Last inspection date ───────────────────────────────────────────
      if (config.fields.lastInspectionDate) {
        const existing = (fac as any).last_inspection_date as string | undefined;
        const alreadyHas = config.skipIfPopulated && !!existing;
        if (!alreadyHas) {
          await throttle();
          const date = await fetchLastInspectionDate(fac.number);
          if (date) { patch.last_inspection_date = date; datesFound++; }
        }
      }

      // ── Administrator (fallback from CCLD report) ──────────────────────
      if (config.fields.administrator) {
        const alreadyHas = config.skipIfPopulated && !!fac.administrator;
        if (!alreadyHas) {
          await throttle();
          const admin = await fetchAdminFromReport(fac.number);
          if (admin) patch.administrator = admin;
        }
      }
    } catch (err) {
      process.stdout.write("\n");
      console.warn(`[etl] Warning: enrichment failed for ${fac.number}: ${err}`);
    }

    if (Object.keys(patch).length > 0) results.set(fac.number, patch);

    done++;
    if (done % 10 === 0 || done === total) {
      const elapsedS = (Date.now() - startMs) / 1000;
      const rate = done / elapsedS;
      const etaS = rate > 0 ? (total - done) / rate : 0;
      process.stdout.write(
        `\r    Enriched ${done.toLocaleString()} / ${total.toLocaleString()}` +
        `  (eta: ~${fmtEta(etaS)},  dates found: ${datesFound.toLocaleString()})` +
        " ".repeat(10),
      );
    }
  }

  process.stdout.write("\n");
  return results;
}
