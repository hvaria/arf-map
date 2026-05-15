/**
 * Report-specific data fetches.
 *
 * The PDF renderer needs the facility "letterhead" fields (name, license #,
 * type, address, phone) for the document header. The CSV path doesn't read
 * `facilities` at all, so we keep that lookup local to the reports module.
 *
 * All queries are facility-scoped. Callers pass the session's
 * `facilityNumber` — there is no cross-facility read path here.
 */

import { pool } from "../../db/index";
import { storage } from "../../storage";
import { getStorageAdapter } from "../../ops/evidenceStorage";
import { defaultReportHeader } from "@shared/facility-profile";

export interface FacilityReportHeader {
  /** License number — also the primary key on the facilities table. */
  number: string;
  name: string;
  facilityType: string;
  address: string;
  city: string;
  zip: string;
  phone: string;
  /** Absolute disk path to the customer-facility logo (PNG/JPEG only); null
   *  when no logo is set OR mime is SVG (pdfkit cannot embed SVG). */
  logoPath?: string | null;
  logoMime?: string | null;
  administrator?: string | null;
  headerText?: string | null;
  footerText?: string | null;
}

// Module-scoped flag so the SVG-skip warning logs at most once per process.
let svgWarningEmitted = false;

/**
 * Fetch the facility "letterhead" row for a PDF report header. Merges
 * `facility_overrides` (admin-edited values) over the CCLD `facilities` row.
 * Returns `null` when neither source resolves — the caller should fall back
 * to a license-only header in that case rather than 500.
 */
export async function getFacilityReportHeader(
  facilityNumber: string,
): Promise<FacilityReportHeader | null> {
  if (!facilityNumber) return null;
  const [ccldRes, override] = await Promise.all([
    pool.query<{
      number: string;
      name: string;
      facility_type: string;
      address: string;
      city: string;
      zip: string;
      phone: string;
      administrator: string;
    }>(
      `SELECT number, name, facility_type, address, city, zip, phone, administrator
       FROM facilities
       WHERE number = $1
       LIMIT 1`,
      [facilityNumber],
    ),
    storage.getFacilityOverride(facilityNumber),
  ]);
  const ccld = ccldRes.rows[0];
  if (!ccld && !override) return null;

  const name = override?.dbaName ?? ccld?.name ?? "Facility";
  const address = override?.mailingAddressLine1 ?? ccld?.address ?? "";
  const city = override?.mailingCity ?? ccld?.city ?? "";
  const zip = override?.mailingZip ?? ccld?.zip ?? "";
  const phone = override?.phone ?? ccld?.phone ?? "";
  const administrator = override?.administratorName ?? ccld?.administrator ?? "";

  let logoPath: string | null = null;
  const logoMime = override?.logoMimeType ?? null;
  if (override?.logoStorageUri && logoMime) {
    if (logoMime === "image/svg+xml") {
      if (!svgWarningEmitted) {
        // eslint-disable-next-line no-console
        console.warn(
          `[reportQueries] facility ${facilityNumber} logo mime is image/svg+xml; PDF letterhead will render the textual header only. Re-upload as PNG/JPEG to embed the logo.`,
        );
        svgWarningEmitted = true;
      }
    } else if (logoMime === "image/png" || logoMime === "image/jpeg") {
      try {
        logoPath = getStorageAdapter().resolve(override.logoStorageUri);
      } catch {
        logoPath = null;
      }
    }
  }

  const headerText =
    override?.reportHeaderText ?? defaultReportHeader(name, facilityNumber, city);
  const footerText = override?.reportFooterText ?? null;

  return {
    number: facilityNumber,
    name,
    facilityType: ccld?.facility_type ?? "",
    address,
    city,
    zip,
    phone,
    logoPath,
    logoMime,
    administrator,
    headerText,
    footerText,
  };
}
