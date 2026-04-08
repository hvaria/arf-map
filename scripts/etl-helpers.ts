/**
 * scripts/etl-helpers.ts
 *
 * Shared helpers for the ETL pipeline. Contains fetchAllPages() — which is
 * intentionally NOT exported from server/services/facilitiesService.ts — along
 * with the lookup tables that both the live-fetch path and ETL share.
 *
 * DO NOT import this file from server/ code. It is scripts-only.
 */

const CHHS_BASE = "https://data.chhs.ca.gov/api/3/action/datastore_search";

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
