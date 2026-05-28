/**
 * scripts/cdss-facility-detail.ts
 *
 * Shared helpers for fetching a single facility from the CDSS Transparency API
 * and building a canonical row from it. Used by:
 *   - scripts/add-facility-by-number.ts (one-off patch tool)
 *   - scripts/extract-all-ccld.ts        (bulk gap-fill for GEO-only facilities)
 *
 * The CDSS Transparency API at /transparencyapi/api/FacilityDetail/{facNum} is
 * the live licensing system used by the public Care Facility Search site. It
 * includes facilities that haven't yet been published to the CHHS open-data
 * CCL category feeds — the lag is typically several weeks for fresh licenses.
 */

import { normalizeRawType, resolveGeoTypeCode } from "../shared/taxonomy";
import { formatPhone } from "../shared/etl-types";

export const CDSS_BASE = "https://www.ccld.dss.ca.gov/transparencyapi/api";

/** Raw shape returned by GET /FacilityDetail/{facNum}. */
export interface CdssFacilityDetail {
  FACILITYNUMBER:       string;
  FACILITYNAME:         string;
  FACILITYTYPE:         string;
  STATUS:               string;
  STREETADDRESS:        string;
  CITY:                 string;
  STATE:                string;
  ZIPCODE:              string;
  COUNTY:               string;
  TELEPHONE:            string;
  LICENSEENAME:         string;
  CONTACT:              string;
  CAPACITY:             string;
  LICENSEFIRSTDATE:     string;
  DATECLOSED:           string;
  LASTVISITDATE:        string;
  VSTDATEINSP:          string;
  NBRALLVISITS:         string;
  NBRINSPVISITS:        string;
  TOTTYPEB:             string;
  NBRINSPTYPB:          string;
  NBROTHERTYPB:         string;
}

/** Shape of a row in the `facilities` Postgres table. */
export interface CanonicalFacilityRow {
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

/** Coordinates from the CHHS GEO feed for a single facility. */
export interface GeoCoords {
  lat:           number;
  lng:           number;
  typeCode?:     string;
}

function cleanStr(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = String(v).trim();
  if (s.toLowerCase() === "unavailable" || s.toLowerCase() === "confidential") return "";
  return s;
}

function parseIntSafe(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : 0;
}

/** Normalize M/D/YYYY or YYYY-MM-DD to YYYY-MM-DD. Empty input → empty output. */
export function normalizeDate(raw: string): string {
  if (!raw) return "";
  const mdy = raw.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  return raw;
}

/**
 * Fetch a single facility from CDSS Transparency API. Returns null on 404,
 * malformed response, or empty FACILITYNUMBER (CDSS sometimes returns an
 * empty wrapper when the number is unknown).
 *
 * Never throws — network errors return null so batch callers can continue.
 */
export async function fetchCdssFacilityDetail(
  facNum: string,
): Promise<CdssFacilityDetail | null> {
  try {
    const url = `${CDSS_BASE}/FacilityDetail/${encodeURIComponent(facNum)}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "ARF-Map-Extractor/1.0 (public data refresh)",
      },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { FacilityDetail?: CdssFacilityDetail };
    const d = json?.FacilityDetail;
    if (!d || !cleanStr(d.FACILITYNUMBER)) return null;
    return d;
  } catch {
    return null;
  }
}

/**
 * Build a canonical facility row from a CDSS detail response + optional GEO
 * coordinates. The taxonomy is resolved from the CDSS `FACILITYTYPE` label
 * first, falling back to the GEO type code if the label isn't recognized.
 */
export function buildRowFromCdss(
  facNum: string,
  cdss:   CdssFacilityDetail,
  geo:    GeoCoords | null,
): CanonicalFacilityRow {
  const rawType = cleanStr(cdss.FACILITYTYPE);
  let tax = normalizeRawType(rawType);
  if (!tax && geo?.typeCode) tax = resolveGeoTypeCode(geo.typeCode);

  let lat: number | null = null;
  let lng: number | null = null;
  let geocodeQuality = "";
  if (geo && Number.isFinite(geo.lat) && Number.isFinite(geo.lng) && geo.lat !== 0 && geo.lng !== 0) {
    lat = geo.lat;
    lng = geo.lng;
    geocodeQuality = "chhs_geo";
  }

  const lastInspection =
    normalizeDate(cleanStr(cdss.VSTDATEINSP)) ||
    normalizeDate(cleanStr(cdss.LASTVISITDATE));

  const totalTypeB =
    parseIntSafe(cdss.TOTTYPEB) +
    parseIntSafe(cdss.NBRINSPTYPB) +
    parseIntSafe(cdss.NBROTHERTYPB);

  return {
    number:               facNum,
    name:                 cleanStr(cdss.FACILITYNAME),
    facility_type:        tax?.officialLabel ?? rawType,
    facility_group:       tax?.domain ?? "Unknown",
    status:               cleanStr(cdss.STATUS).toUpperCase() || "LICENSED",
    address:              cleanStr(cdss.STREETADDRESS),
    city:                 cleanStr(cdss.CITY).toUpperCase(),
    county:               cleanStr(cdss.COUNTY).toUpperCase(),
    zip:                  cleanStr(cdss.ZIPCODE),
    phone:                formatPhone(cleanStr(cdss.TELEPHONE)),
    licensee:             cleanStr(cdss.LICENSEENAME),
    administrator:        cleanStr(cdss.CONTACT),
    capacity:             parseIntSafe(cdss.CAPACITY),
    first_license_date:   normalizeDate(cleanStr(cdss.LICENSEFIRSTDATE)),
    closed_date:          normalizeDate(cleanStr(cdss.DATECLOSED)),
    last_inspection_date: lastInspection,
    total_visits:         parseIntSafe(cdss.NBRALLVISITS),
    total_type_b:         totalTypeB,
    citations:            0,
    lat,
    lng,
    geocode_quality:      geocodeQuality,
    updated_at:           Date.now(),
  };
}

/** Simple sequential rate limiter. */
export function rateLimiter(requestsPerSecond: number): () => Promise<void> {
  const minIntervalMs = 1000 / Math.max(requestsPerSecond, 0.1);
  let lastCallMs = 0;
  return async () => {
    const wait = minIntervalMs - (Date.now() - lastCallMs);
    if (wait > 0) await new Promise<void>((r) => setTimeout(r, wait));
    lastCallMs = Date.now();
  };
}
