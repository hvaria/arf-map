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

export interface FacilityReportHeader {
  /** License number — also the primary key on the facilities table. */
  number: string;
  name: string;
  facilityType: string;
  address: string;
  city: string;
  zip: string;
  phone: string;
}

/**
 * Fetch the facility "letterhead" row for a PDF report header. Returns
 * `null` when the session's facility number doesn't resolve — the caller
 * should fall back to a license-only header in that case rather than 500.
 */
export async function getFacilityReportHeader(
  facilityNumber: string,
): Promise<FacilityReportHeader | null> {
  if (!facilityNumber) return null;
  const result = await pool.query<{
    number: string;
    name: string;
    facility_type: string;
    address: string;
    city: string;
    zip: string;
    phone: string;
  }>(
    `SELECT number, name, facility_type, address, city, zip, phone
     FROM facilities
     WHERE number = $1
     LIMIT 1`,
    [facilityNumber],
  );
  const row = result.rows[0];
  if (!row) return null;
  return {
    number: row.number,
    name: row.name,
    facilityType: row.facility_type,
    address: row.address,
    city: row.city,
    zip: row.zip,
    phone: row.phone,
  };
}
