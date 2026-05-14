/**
 * Wave 2 W8 — Chart Completeness Sweep storage layer.
 *
 * Aggregates two tenant-scoped queries — `ops_residents` (status='active')
 * and `ops_admissions` — and runs the shared pure evaluator
 * `evaluateChartCompleteness()` from `@shared/chart-completeness` over the
 * joined-in-memory rows. Reuses the evaluator verbatim; no re-implementation.
 *
 * Performance contract:
 *  - Exactly 2 SELECTs per facility-wide call. No N+1 across residents.
 *  - The reg-setting (ANNUAL_PHYSICIAN_REPORT_DAYS) is read once per call,
 *    not per resident.
 *
 * Tenant isolation is enforced at the storage layer — every WHERE clause
 * carries `facility_number = $fn` for defense in depth on top of the
 * `requireOpsPermission` + IDOR guard already on the router.
 */

import { and, desc, eq } from "drizzle-orm";
import {
  evaluateChartCompleteness,
  type ChartCompletenessResult,
  type ChartItemStatus,
} from "@shared/chart-completeness";
import { db } from "../db/index";
import {
  opsAdmissions,
  opsResidents,
  type OpsAdmission,
  type OpsResident,
} from "./opsSchema";
import { getRegSetting } from "./regSettings";

export interface ChartCompletenessRow extends ChartCompletenessResult {
  residentFirstName: string;
  residentLastName: string;
  residentRoomNumber: string | null;
  residentStatus: string;
  admissionId: number | null;
}

export interface ListChartCompletenessOpts {
  worst?: ChartItemStatus;
  limit?: number;
}

export interface ListChartCompletenessResult {
  rows: ChartCompletenessRow[];
  /** Count of rows in the (post-filter) listing. */
  total: number;
  /** Count of residents whose chart is fully `ok` (pre-filter, across active
   *  residents) — useful for the "X of Y residents complete" banner. */
  complete: number;
  /** Total active residents at the facility (pre-filter). */
  activeResidents: number;
}

/** Pick the most-recent admission row per resident from a desc-ordered list. */
function indexLatestAdmissionByResident(
  admissions: OpsAdmission[],
): Map<number, OpsAdmission> {
  const out = new Map<number, OpsAdmission>();
  for (const a of admissions) {
    if (a.residentId != null && !out.has(a.residentId)) {
      out.set(a.residentId, a);
    }
  }
  return out;
}

/** Build a single ChartCompletenessRow from the resident + (optional) admission. */
function buildRow(
  r: OpsResident,
  a: OpsAdmission | null,
  now: number,
  annualDays: number,
): ChartCompletenessRow {
  const result = evaluateChartCompleteness(r, a, now, annualDays);
  return {
    ...result,
    residentFirstName: r.firstName,
    residentLastName: r.lastName,
    residentRoomNumber: r.roomNumber,
    residentStatus: r.status,
    admissionId: a?.id ?? null,
  };
}

/**
 * Compute chart-completeness rows for every active resident at the facility.
 *
 * Two SELECTs total (residents + admissions). Reg-setting read once. The
 * `worst` filter is post-evaluation since it depends on item statuses.
 */
export async function listChartCompleteness(
  facilityNumber: string,
  opts: ListChartCompletenessOpts = {},
  now: number = Date.now(),
): Promise<ListChartCompletenessResult> {
  // 1. Read the annual physician-report cadence once. Falls back to the
  // catalogue default ("365") if the facility has never set it.
  const annualDaysStr = await getRegSetting(facilityNumber, "ANNUAL_PHYSICIAN_REPORT_DAYS");
  const parsed = parseInt(annualDaysStr, 10);
  const annualDays = Number.isFinite(parsed) && parsed > 0 ? parsed : 365;

  // 2. Active residents at this facility. Soft-deleted residents have
  // status='discharged'; filter to 'active' so the sweep only scores
  // charts that an inspector would actually pull.
  const residents = await db
    .select()
    .from(opsResidents)
    .where(
      and(
        eq(opsResidents.facilityNumber, facilityNumber),
        eq(opsResidents.status, "active"),
      ),
    );

  if (residents.length === 0) {
    return { rows: [], total: 0, complete: 0, activeResidents: 0 };
  }

  // 3. All admissions for this facility in one query, desc by created_at
  // so the first row we keep per resident is the most recent. This is the
  // "no N+1" path — one SELECT regardless of resident count.
  const admissions = await db
    .select()
    .from(opsAdmissions)
    .where(eq(opsAdmissions.facilityNumber, facilityNumber))
    .orderBy(desc(opsAdmissions.createdAt));

  const admissionByResidentId = indexLatestAdmissionByResident(admissions);

  // 4. Evaluate every active resident.
  const allRows: ChartCompletenessRow[] = residents.map((r) =>
    buildRow(r, admissionByResidentId.get(r.id) ?? null, now, annualDays),
  );

  // 5. The "X of Y complete" counter is over the un-filtered set.
  const complete = allRows.filter((r) => r.worst === "ok").length;
  const activeResidents = residents.length;

  // 6. Optional `worst` filter is applied post-evaluation.
  const filtered = opts.worst ? allRows.filter((r) => r.worst === opts.worst) : allRows;
  const total = filtered.length;

  // 7. Optional `limit` is sliced off the end for the dashboard banner
  // (e.g., show me the top 5 worst charts).
  const rows = opts.limit && opts.limit > 0 ? filtered.slice(0, opts.limit) : filtered;

  return { rows, total, complete, activeResidents };
}

/**
 * Single-resident chart completeness. Used by the per-resident banner so
 * the FE can render the same evaluator output without pulling the whole
 * facility list. Tenant filter is enforced on both lookups.
 */
export async function getChartCompletenessForResident(
  residentId: number,
  facilityNumber: string,
  now: number = Date.now(),
): Promise<ChartCompletenessRow | undefined> {
  const annualDaysStr = await getRegSetting(facilityNumber, "ANNUAL_PHYSICIAN_REPORT_DAYS");
  const parsed = parseInt(annualDaysStr, 10);
  const annualDays = Number.isFinite(parsed) && parsed > 0 ? parsed : 365;

  const residentRows = await db
    .select()
    .from(opsResidents)
    .where(
      and(
        eq(opsResidents.id, residentId),
        eq(opsResidents.facilityNumber, facilityNumber),
      ),
    )
    .limit(1);
  const r = residentRows[0];
  if (!r) return undefined;

  // Most recent admission for this resident at this facility — one row.
  const admissionRows = await db
    .select()
    .from(opsAdmissions)
    .where(
      and(
        eq(opsAdmissions.facilityNumber, facilityNumber),
        eq(opsAdmissions.residentId, residentId),
      ),
    )
    .orderBy(desc(opsAdmissions.createdAt))
    .limit(1);
  const a = admissionRows[0] ?? null;

  return buildRow(r, a, now, annualDays);
}
