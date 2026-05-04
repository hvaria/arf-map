/**
 * shared/taxonomy.ts
 *
 * Canonical California CCLD facility taxonomy. Single source of truth for
 * domains, groups, facility types, official labels, display labels, and
 * acronyms. Used by ETL to normalize raw CHHS data and by the UI to render
 * filters and labels.
 *
 * Hierarchy:
 *   Domain → Search Group → Facility Type
 *
 * Domains map to the four CCLD program branches (plus Adoption rolled into
 * Children's Residential to match the CCLD feed grouping).
 */

// ── Types ────────────────────────────────────────────────────────────────────

export type FacilityDomain =
  | "Adult & Senior Care"
  | "Children's Residential"
  | "Child Care"
  | "Home Care";

export type SearchGroup =
  // Adult & Senior Care
  | "Senior Care"
  | "Adult Disability Care"
  | "Adult Day Programs"
  // Children's Residential
  | "Foster & Family-Based Care"
  | "Group & Therapeutic Care"
  | "Transitional Housing"
  | "Crisis Care"
  | "Adoption"
  // Child Care
  | "Center-Based"
  | "Home-Based"
  // Home Care
  | "Home Care Services";

export interface TaxonomyEntry {
  /** Stable internal code — used for URL slugs, API enums, joins. Never rename. */
  code: string;
  /** Official CCLD label (regulator-facing). */
  officialLabel: string;
  /** User-friendly label for product UI. */
  displayLabel: string;
  /** Short form for chips/badges (e.g., "ARF", "RCFE"). */
  acronym: string;
  /** Search group (level between domain and type). */
  group: SearchGroup;
  /** CCLD program domain. */
  domain: FacilityDomain;
  /** Raw `facility_type` strings seen in CCL feeds that should normalize to this code. */
  ccldRawNames: string[];
  /** Numeric TYPE codes from the GEO feed that map to this entry. */
  geoTypeCodes: string[];
  /**
   * Confidence flag:
   *   - "verified": cross-checked against a CHHS feed AND a CCLD program page.
   *   - "needs_verification": appears in a feed but program ownership is ambiguous (e.g., CCH may be DDS-licensed).
   */
  verificationStatus: "verified" | "needs_verification";
}

// ── Canonical taxonomy ───────────────────────────────────────────────────────

export const TAXONOMY: TaxonomyEntry[] = [
  // ── Adult & Senior Care: Senior Care ──────────────────────────────────────
  {
    code: "RCFE",
    officialLabel: "Residential Care Facility for the Elderly",
    displayLabel: "Senior Living (RCFE)",
    acronym: "RCFE",
    group: "Senior Care",
    domain: "Adult & Senior Care",
    ccldRawNames: ["RESIDENTIAL CARE ELDERLY"],
    geoTypeCodes: ["740"],
    verificationStatus: "verified",
  },
  {
    code: "RCFE-CCRC",
    officialLabel: "RCFE — Continuing Care Retirement Community",
    displayLabel: "CCRC (RCFE)",
    acronym: "RCFE-CCRC",
    group: "Senior Care",
    domain: "Adult & Senior Care",
    ccldRawNames: ["RCFE-CONTINUING CARE RETIREMENT COMMUNITY"],
    geoTypeCodes: ["741"],
    verificationStatus: "verified",
  },

  // ── Adult & Senior Care: Adult Disability Care ────────────────────────────
  {
    code: "ARF",
    officialLabel: "Adult Residential Facility",
    displayLabel: "Adult Residential (ARF)",
    acronym: "ARF",
    group: "Adult Disability Care",
    domain: "Adult & Senior Care",
    ccldRawNames: ["ADULT RESIDENTIAL"],
    geoTypeCodes: ["735"],
    verificationStatus: "verified",
  },
  {
    code: "ARFPSHN",
    officialLabel: "Adult Residential Facility for Persons with Special Health Care Needs",
    displayLabel: "ARFPSHN",
    acronym: "ARFPSHN",
    group: "Adult Disability Care",
    domain: "Adult & Senior Care",
    ccldRawNames: ["ADULT RESIDENTIAL FACILITY FOR PERSONS WITH SPECIAL HEALTH CARE NEEDS"],
    geoTypeCodes: ["734"],
    verificationStatus: "verified",
  },
  {
    code: "EBSH-ARF",
    officialLabel: "Enhanced Behavioral Supports Home (ARF)",
    displayLabel: "EBSH (Adult)",
    acronym: "EBSH",
    group: "Adult Disability Care",
    domain: "Adult & Senior Care",
    ccldRawNames: ["ENHANCED BEHAVIORAL SUPPORTS HOME - ARF"],
    geoTypeCodes: ["737"],
    verificationStatus: "verified",
  },
  {
    code: "CCH-ARF",
    officialLabel: "Community Crisis Home (ARF)",
    displayLabel: "Crisis Home (Adult)",
    acronym: "CCH",
    group: "Adult Disability Care",
    domain: "Adult & Senior Care",
    ccldRawNames: ["COMMUNITY CRISIS HOME - ARF"],
    geoTypeCodes: ["738"],
    verificationStatus: "verified",
  },
  {
    code: "SRF",
    officialLabel: "Social Rehabilitation Facility",
    displayLabel: "Social Rehab (SRF)",
    acronym: "SRF",
    group: "Adult Disability Care",
    domain: "Adult & Senior Care",
    ccldRawNames: ["SOCIAL REHABILITATION FACILITY"],
    geoTypeCodes: ["772"],
    verificationStatus: "verified",
  },
  {
    code: "RCFCI",
    officialLabel: "Residential Care Facility for the Chronically Ill",
    displayLabel: "Chronically Ill (RCFCI)",
    acronym: "RCFCI",
    group: "Adult Disability Care",
    domain: "Adult & Senior Care",
    ccldRawNames: ["RESIDENTIAL FACILITY CHRONICALLY ILL"],
    geoTypeCodes: ["736"],
    verificationStatus: "verified",
  },

  // ── Adult & Senior Care: Adult Day Programs ───────────────────────────────
  {
    code: "ADP",
    officialLabel: "Adult Day Program",
    displayLabel: "Adult Day Program",
    acronym: "ADP",
    group: "Adult Day Programs",
    domain: "Adult & Senior Care",
    ccldRawNames: ["ADULT DAY PROGRAM"],
    geoTypeCodes: ["775"],
    verificationStatus: "needs_verification", // CCLD splits ADC vs ADSC; CCL feed lumps both
  },

  // ── Children's Residential: Foster & Family-Based Care ────────────────────
  {
    code: "FFA",
    officialLabel: "Foster Family Agency",
    displayLabel: "Foster Family Agency",
    acronym: "FFA",
    group: "Foster & Family-Based Care",
    domain: "Children's Residential",
    ccldRawNames: ["FOSTER FAMILY AGENCY"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },
  {
    code: "FFA-SUB",
    officialLabel: "Foster Family Agency Sub-Office",
    displayLabel: "FFA Sub-Office",
    acronym: "FFA-Sub",
    group: "Foster & Family-Based Care",
    domain: "Children's Residential",
    ccldRawNames: ["FOSTER FAMILY AGENCY SUB-"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },
  {
    code: "SFH",
    officialLabel: "Small Family Home",
    displayLabel: "Small Family Home (SFH)",
    acronym: "SFH",
    group: "Foster & Family-Based Care",
    domain: "Children's Residential",
    ccldRawNames: ["SMALL FAMILY HOME"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },

  // ── Children's Residential: Group & Therapeutic Care ──────────────────────
  {
    code: "GH",
    officialLabel: "Group Home",
    displayLabel: "Group Home (Children's)",
    acronym: "GH",
    group: "Group & Therapeutic Care",
    domain: "Children's Residential",
    ccldRawNames: ["GROUP HOME"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },
  {
    code: "STRTP",
    officialLabel: "Short-Term Residential Therapeutic Program",
    displayLabel: "STRTP",
    acronym: "STRTP",
    group: "Group & Therapeutic Care",
    domain: "Children's Residential",
    ccldRawNames: ["SHORT TERM RESIDENTIAL THERAPEUTIC PROGRAM"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },
  {
    code: "STRTP-CCR",
    officialLabel: "STRTP — Children's Crisis Residential",
    displayLabel: "STRTP CCR",
    acronym: "STRTP-CCR",
    group: "Group & Therapeutic Care",
    domain: "Children's Residential",
    ccldRawNames: ["STRTP - CHILDRENS CRISIS RESIDENTIAL"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },
  {
    code: "EBSH-GH",
    officialLabel: "Enhanced Behavioral Supports Home (GH)",
    displayLabel: "EBSH (Children's)",
    acronym: "EBSH",
    group: "Group & Therapeutic Care",
    domain: "Children's Residential",
    ccldRawNames: ["ENHANCED BEHAVIORAL SUPPORTS HOME - GH"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },
  {
    code: "CCH-GH",
    officialLabel: "Community Crisis Home (DDS / Children's)",
    displayLabel: "Crisis Home (Children's)",
    acronym: "CCH",
    group: "Group & Therapeutic Care",
    domain: "Children's Residential",
    ccldRawNames: ["COMMUNITY CRISIS HOMES"],
    geoTypeCodes: [],
    verificationStatus: "needs_verification", // DDS-licensed, surfaced via CCL children's feed
  },
  {
    code: "CTF",
    officialLabel: "Community Treatment Facility",
    displayLabel: "Community Treatment (CTF)",
    acronym: "CTF",
    group: "Group & Therapeutic Care",
    domain: "Children's Residential",
    ccldRawNames: ["COMMUNITY TREATMENT FACILITY"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },
  {
    code: "GH-SHCN",
    officialLabel: "Group Home — Children with Special Health Care Needs",
    displayLabel: "GH (Special Health Care)",
    acronym: "GH-SHCN",
    group: "Group & Therapeutic Care",
    domain: "Children's Residential",
    ccldRawNames: ["GH - CHILDREN SPECIAL HEALTH CARE NEED"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },
  {
    code: "YHPC-GH",
    officialLabel: "Youth Homelessness Prevention Center (GH)",
    displayLabel: "Youth Homelessness Prevention",
    acronym: "YHPC",
    group: "Group & Therapeutic Care",
    domain: "Children's Residential",
    ccldRawNames: ["YOUTH HOMELESSNESS PREVENTION CENTER - GH"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },

  // ── Children's Residential: Transitional Housing ──────────────────────────
  {
    code: "THPP",
    officialLabel: "Transitional Housing Placement Program",
    displayLabel: "Transitional Housing (THPP)",
    acronym: "THPP",
    group: "Transitional Housing",
    domain: "Children's Residential",
    ccldRawNames: ["TRANSITIONAL HOUSING PLACEMENT PROGRAM"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },
  {
    code: "TSCF",
    officialLabel: "Transitional Shelter Care Facility",
    displayLabel: "Transitional Shelter Care",
    acronym: "TSCF",
    group: "Transitional Housing",
    domain: "Children's Residential",
    ccldRawNames: ["TRANSITIONAL SHELTER CARE FACILITY"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },
  {
    code: "TempSCF",
    officialLabel: "Temporary Shelter Care Facility",
    displayLabel: "Temporary Shelter Care",
    acronym: "TempSCF",
    group: "Transitional Housing",
    domain: "Children's Residential",
    ccldRawNames: ["TEMPORARY SHELTER CARE FACILITY"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },

  // ── Children's Residential: Crisis Care ───────────────────────────────────
  {
    code: "CN",
    officialLabel: "Crisis Nursery",
    displayLabel: "Crisis Nursery",
    acronym: "CN",
    group: "Crisis Care",
    domain: "Children's Residential",
    ccldRawNames: ["CRISIS NURSERY"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },

  // ── Children's Residential: Adoption ──────────────────────────────────────
  {
    code: "AA",
    officialLabel: "Adoption Agency",
    displayLabel: "Adoption Agency",
    acronym: "AA",
    group: "Adoption",
    domain: "Children's Residential",
    ccldRawNames: ["ADOPTION AGENCY"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },

  // ── Child Care: Center-Based ──────────────────────────────────────────────
  {
    code: "CCC",
    officialLabel: "Child Care Center",
    displayLabel: "Child Care Center",
    acronym: "CCC",
    group: "Center-Based",
    domain: "Child Care",
    ccldRawNames: ["DAY CARE CENTER"],
    geoTypeCodes: ["850"],
    verificationStatus: "verified",
  },
  {
    code: "CCC-Infant",
    officialLabel: "Infant Center",
    displayLabel: "Infant Center",
    acronym: "Infant CCC",
    group: "Center-Based",
    domain: "Child Care",
    ccldRawNames: ["INFANT CENTER"],
    geoTypeCodes: ["830"],
    verificationStatus: "verified",
  },
  {
    code: "CCC-SchoolAge",
    officialLabel: "School-Age Day Care Center",
    displayLabel: "School-Age Care",
    acronym: "School-Age CCC",
    group: "Center-Based",
    domain: "Child Care",
    ccldRawNames: ["SCHOOL AGE DAY CARE CENTER"],
    geoTypeCodes: ["840"],
    verificationStatus: "verified",
  },
  {
    code: "CCC-Single",
    officialLabel: "Single-Licensed Child Care Center",
    displayLabel: "Single-License CCC",
    acronym: "Single CCC",
    group: "Center-Based",
    domain: "Child Care",
    ccldRawNames: ["SINGLE LICENSED CHILD CARE CENTER"],
    geoTypeCodes: ["860"],
    verificationStatus: "verified",
  },
  {
    code: "CCC-Ill",
    officialLabel: "Day Care Center for Mildly Ill Children",
    displayLabel: "Care for Ill Children",
    acronym: "CCC-Ill",
    group: "Center-Based",
    domain: "Child Care",
    ccldRawNames: ["DAY CARE CENTER - ILL CENTER"],
    geoTypeCodes: ["845"],
    verificationStatus: "verified",
  },

  // ── Child Care: Home-Based ────────────────────────────────────────────────
  {
    code: "FCCH",
    officialLabel: "Family Child Care Home",
    displayLabel: "Family Child Care Home",
    acronym: "FCCH",
    group: "Home-Based",
    domain: "Child Care",
    ccldRawNames: ["FAMILY DAY CARE HOME"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },

  // ── Home Care ─────────────────────────────────────────────────────────────
  {
    code: "HCO",
    officialLabel: "Home Care Organization",
    displayLabel: "Home Care Organization",
    acronym: "HCO",
    group: "Home Care Services",
    domain: "Home Care",
    ccldRawNames: ["HOME CARE"],
    geoTypeCodes: [],
    verificationStatus: "verified",
  },
];

// ── Lookup tables (built once at module load) ────────────────────────────────

const RAW_NAME_INDEX = new Map<string, TaxonomyEntry>();
const GEO_CODE_INDEX = new Map<string, TaxonomyEntry>();
const CODE_INDEX = new Map<string, TaxonomyEntry>();

for (const entry of TAXONOMY) {
  CODE_INDEX.set(entry.code, entry);
  for (const raw of entry.ccldRawNames) {
    RAW_NAME_INDEX.set(raw.toUpperCase(), entry);
  }
  for (const geoCode of entry.geoTypeCodes) {
    GEO_CODE_INDEX.set(geoCode, entry);
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Normalize a raw `facility_type` string from a CHHS CCL feed to a
 * canonical taxonomy entry. Returns null if the raw string is not recognized.
 *
 * Matching is case-insensitive on the trimmed raw string against
 * `ccldRawNames` registered in the taxonomy.
 */
export function normalizeRawType(raw: string | null | undefined): TaxonomyEntry | null {
  if (!raw) return null;
  const key = raw.trim().toUpperCase();
  return RAW_NAME_INDEX.get(key) ?? null;
}

/**
 * Resolve a numeric GEO TYPE code (e.g., "735") to a canonical taxonomy
 * entry. Returns null if the code is not registered.
 */
export function resolveGeoTypeCode(code: string | number | null | undefined): TaxonomyEntry | null {
  if (code === null || code === undefined) return null;
  return GEO_CODE_INDEX.get(String(code)) ?? null;
}

/** Look up a taxonomy entry by its stable internal code. */
export function getByCode(code: string): TaxonomyEntry | null {
  return CODE_INDEX.get(code) ?? null;
}

/** All distinct domains, in canonical order. */
export const DOMAINS: FacilityDomain[] = [
  "Adult & Senior Care",
  "Children's Residential",
  "Child Care",
  "Home Care",
];

/** All distinct search groups under a given domain, in canonical order. */
export function groupsForDomain(domain: FacilityDomain): SearchGroup[] {
  const seen: SearchGroup[] = [];
  for (const e of TAXONOMY) {
    if (e.domain === domain && seen.indexOf(e.group) === -1) seen.push(e.group);
  }
  return seen;
}

/** All taxonomy entries within a given search group. */
export function typesForGroup(group: SearchGroup): TaxonomyEntry[] {
  return TAXONOMY.filter((e) => e.group === group);
}
