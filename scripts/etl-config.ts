/**
 * scripts/etl-config.ts
 *
 * Single source of truth for the CCLD facility ETL pipeline.
 * Edit this file to change sources, field mappings, filters, or run mode.
 * No other file needs to change for routine extraction updates.
 */

export const ETL_CONFIG = {
  // ── CHHS data sources ──────────────────────────────────────────────────────
  sources: {
    geo: {
      enabled: true,
      resourceId: "f9c77b0d-9711-4f34-8c7f-90f542fbc24a",
      pageSize: 5000,
    },
    ccl: {
      enabled: true,
      resourceId: "9f5d1d00-6b24-4f44-a158-9cbe4b43f117",
      pageSize: 5000,
    },
  },

  // ── Field extraction mapping ───────────────────────────────────────────────
  // Controls EXACTLY which raw API fields are read from each source row.
  // Edit keys here (not in etl.ts) to add/remove fields.
  fieldMap: {
    fromGeo: {
      number:   "FAC_NBR",
      name:     "NAME",
      lat:      "FAC_LATITUDE",
      lng:      "FAC_LONGITUDE",
      address:  "RES_STREET_ADDR",
      city:     "RES_CITY",
      zip:      "RES_ZIP_CODE",
      phone:    "FAC_PHONE_NBR",
      capacity: "CAPACITY",
      status:   "STATUS",    // numeric code → decoded via GEO_STATUS in etl-helpers
      typeCode: "TYPE",      // numeric code → decoded via TYPE_TO_NAME in etl-helpers
    },
    fromCcl: {
      number:           "facility_number",
      name:             "facility_name",
      facilityType:     "facility_type",
      licensee:         "licensee",
      administrator:    "facility_administrator",
      status:           "facility_status",
      capacity:         "facility_capacity",
      firstLicenseDate: "license_first_date",
      closedDate:       "closed_date",
      county:           "county",
    },
  },

  // ── Filters (empty array = include ALL) ───────────────────────────────────
  /** Limit to these facility groups, e.g. ["Child Care", "Adult & Senior Care"] */
  filterByGroups: [] as string[],
  /** Limit to these counties, e.g. ["Los Angeles", "San Diego"] */
  filterByCounties: [] as string[],

  // ── Run-mode flags ─────────────────────────────────────────────────────────
  /** Skip facilities with no lat/lng in the GEO source */
  skipMissingGeo: true,
  /** Parse + validate but do NOT write to DB */
  dryRun: false,
  /** Max records to process after filtering (0 = no limit; use 100 for smoke tests) */
  limit: 0,

  // ── Enrichment (CCLD Transparency API) ────────────────────────────────────
  enrichment: {
    /** Set to false to skip enrichment entirely — existing ETL is 100% unchanged */
    enabled: false,
    /** Which fields to enrich (false = skip that field) */
    fields: {
      lastInspectionDate: true,
      administrator: true,  // used as fallback when CCL source has empty value
      licensee: true,       // used as fallback when CCL source has empty value
    },
    /** Max CCLD Transparency API requests per second (respect rate limits) */
    requestsPerSecond: 5,
    /** Skip enrichment for a field that already has a non-empty value */
    skipIfPopulated: true,
    /** Limit enrichment to N facilities (0 = all; use 10 for smoke tests) */
    enrichLimit: 0,
    /** Only enrich facilities in these counties (empty = all counties) */
    enrichCounties: [] as string[],
  },
} as const satisfies EtlConfig;

// ── Type definition (kept here so consumers get full IntelliSense) ─────────

export interface EtlConfig {
  sources: {
    geo: { enabled: boolean; resourceId: string; pageSize: number };
    ccl: { enabled: boolean; resourceId: string; pageSize: number };
  };
  fieldMap: {
    fromGeo: {
      number: string;
      name: string;
      lat: string;
      lng: string;
      address: string;
      city: string;
      zip: string;
      phone: string;
      capacity: string;
      status: string;
      typeCode: string;
    };
    fromCcl: {
      number: string;
      name: string;
      facilityType: string;
      licensee: string;
      administrator: string;
      status: string;
      capacity: string;
      firstLicenseDate: string;
      closedDate: string;
      county: string;
    };
  };
  filterByGroups: readonly string[];
  filterByCounties: readonly string[];
  skipMissingGeo: boolean;
  dryRun: boolean;
  limit: number;
  enrichment: {
    enabled: boolean;
    fields: {
      lastInspectionDate: boolean;
      administrator: boolean;
      licensee: boolean;
    };
    requestsPerSecond: number;
    skipIfPopulated: boolean;
    enrichLimit: number;
    enrichCounties: readonly string[];
  };
}
