// shared/facility-profile.ts — facility profile field catalogue + helpers.
//
// Single source of truth for the editable fields on facility_overrides that
// power the public listing AND PDF report letterheads. Imported by both
// client (Listing details admin page) and server (signup prefill, report
// renderer). No runtime DB access here — pure constants + helper functions.
//
// NB: The "logo" referenced throughout this module is the CUSTOMER FACILITY's
// own logo (each ARF uploads its own; rendered on their public listing and on
// PDF reports). It is NOT the arf-map app brand identity — that lives in
// client/src/components/BrandLogo.tsx and is wholly unrelated to this table.

// Logos render on every page of every report; keep the file small to avoid
// blowing up PDF sizes. 2 MB is generous for PNG/JPEG/SVG marks.
export const FACILITY_LOGO_MAX_BYTES = 2 * 1024 * 1024;
export const FACILITY_LOGO_ALLOWED_MIMES = [
  "image/png",
  "image/jpeg",
  "image/svg+xml",
] as const;
export type FacilityLogoMime = (typeof FACILITY_LOGO_ALLOWED_MIMES)[number];

export const FACILITY_LANGUAGES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "tl", label: "Tagalog" },
  { code: "vi", label: "Vietnamese" },
  { code: "zh", label: "Chinese" },
  { code: "ko", label: "Korean" },
  { code: "ar", label: "Arabic" },
  { code: "ru", label: "Russian" },
  { code: "hi", label: "Hindi" },
  { code: "fa", label: "Persian (Farsi)" },
] as const;

export const FACILITY_CARE_TYPES = [
  "assisted_living",
  "memory_care",
  "skilled_nursing",
  "hospice",
  "respite",
  "adult_day_program",
  "adult_residential",
  "residential_care_elderly",
  "developmentally_disabled",
] as const;
export type FacilityCareType = (typeof FACILITY_CARE_TYPES)[number];

export const FACILITY_CARE_TYPE_LABELS: Record<FacilityCareType, string> = {
  assisted_living: "Assisted living",
  memory_care: "Memory care",
  skilled_nursing: "Skilled nursing",
  hospice: "Hospice",
  respite: "Respite care",
  adult_day_program: "Adult day program",
  adult_residential: "Adult residential",
  residential_care_elderly: "Residential care (elderly)",
  developmentally_disabled: "Developmentally disabled",
};

export type DayOfWeek = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";
export const DAYS_OF_WEEK: DayOfWeek[] = [
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  "sat",
  "sun",
];

export interface HoursEntry {
  open: string;   // "HH:MM" 24h
  close: string;  // "HH:MM" 24h
  closed?: boolean;
}

export type HoursOfOperation = Partial<Record<DayOfWeek, HoursEntry>>;

/**
 * Which CCLD source columns prefill which facility_overrides columns on signup.
 * Keys are facility_overrides columns; values are facilities-table column
 * names (or computed source descriptors). The signup flow reads from the
 * `facilities` table by facility_number and writes only NULL columns —
 * never overwriting admin-edited values.
 */
export const CCLD_PREFILL_MAP = {
  phone: "phone",
  mailingAddressLine1: "address",
  mailingCity: "city",
  mailingState: "state",
  mailingZip: "zip",
  administratorName: "administrator",
  yearEstablished: "first_license_date_year",
} as const;

/**
 * Free-form report letterhead default — used when facility_overrides.report_header_text
 * is NULL. Format: "<facility name> — Lic. <license #> · <city>" (city is
 * appended only when present).
 */
export function defaultReportHeader(
  facilityName: string,
  licenseNumber: string,
  city?: string,
): string {
  const where = city ? ` · ${city}` : "";
  return `${facilityName} — Lic. ${licenseNumber}${where}`;
}
