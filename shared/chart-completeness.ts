/**
 * Chart completeness — single source of truth for both client and server.
 *
 * Drives Wave 2 W8 (Chart Completeness Sweep). Aggregates existing
 * ops_admissions LIC checkboxes + ops_residents demographics into a
 * per-resident "is this chart inspection-ready?" score.
 *
 * Phase 1 §11 BLOCKING items B14 (annual physician's report cadence)
 * is the regulation-derived value driving the staleness check; this
 * module reads the placeholder via `ANNUAL_PHYSICIAN_REPORT_DAYS`
 * default that callers may override per-facility once validated.
 *
 * NOTHING in this module reads from the network or DB; it's a pure
 * evaluator over data already in hand. Callers (server storage, FE
 * banners, daily-triage aggregator) join the underlying rows once
 * and pass them in.
 */

/** The seven (configurable) chart items every active resident must have on file. */
export const CHART_REQUIREMENTS = [
  "lic_601",           // Identification & emergency info
  "lic_602a",          // Physician's report — annual recurrence
  "lic_603",           // Pre-placement appraisal
  "lic_604a",          // Admission agreement
  "lic_613",           // Personal rights acknowledgment
  "advance_directive", // Advance directive / POLST
  "tb_test_results",   // Resident TB clearance
] as const;
export type ChartRequirementKey = (typeof CHART_REQUIREMENTS)[number];

export const CHART_REQUIREMENT_LABELS: Record<ChartRequirementKey, string> = {
  lic_601: "LIC 601 — Identification & emergency info",
  lic_602a: "LIC 602A — Physician's report",
  lic_603: "LIC 603 — Pre-placement appraisal",
  lic_604a: "LIC 604A — Admission agreement",
  lic_613: "LIC 613 — Personal rights",
  advance_directive: "Advance directive",
  tb_test_results: "TB test results",
};

/**
 * Annual cycle items — refresh required every N days. Tracked via the
 * `*_date` column on ops_admissions when available, falling back to
 * the admission_date if no item-specific date exists.
 *
 * `lic_602a` is the canonical annual physician's report per Phase 1
 * §11 B14 — the value here is a placeholder, configurable per facility
 * via Reg Settings later.
 */
export const CHART_ANNUAL_ITEMS = new Set<ChartRequirementKey>([
  "lic_602a",
]);

/**
 * Default annual cadence in days. [V] — placeholder until validated.
 * Override via a facility reg-setting when Wave 4 wires that up.
 */
export const ANNUAL_PHYSICIAN_REPORT_DAYS = 365;

/** Minimal shape we need from an `ops_admissions` row to evaluate a chart. */
export interface AdmissionForChart {
  lic601Completed?: number | null;
  lic601Date?: number | null;
  lic602aCompleted?: number | null;
  lic602aDate?: number | null;
  lic603Completed?: number | null;
  lic603Date?: number | null;
  lic604aCompleted?: number | null;
  lic604aDate?: number | null;
  lic605aCompleted?: number | null;
  lic605aDate?: number | null;
  lic610dCompleted?: number | null;
  lic610dDate?: number | null;
  admissionAgreementSigned?: number | null;
  admissionAgreementSignedAt?: number | null;
  physicianReportReceived?: number | null;
  tbTestResultsReceived?: number | null;
  moveInDate?: number | null;
}

/** Minimal shape we need from an `ops_residents` row. */
export interface ResidentForChart {
  id: number;
  status?: string | null;
  admissionDate?: number | null;
}

export type ChartItemStatus = "ok" | "missing" | "stale";

export interface ChartItemResult {
  key: ChartRequirementKey;
  status: ChartItemStatus;
  /** Source date (epoch ms) for the most recent completion of this item, when known. */
  asOf?: number | null;
  /** Days until / since the stale cutoff. Positive = days until stale; negative = days overdue. Undefined for non-annual items. */
  daysUntilStale?: number;
}

export interface ChartCompletenessResult {
  residentId: number;
  items: ChartItemResult[];
  completedCount: number;
  totalCount: number;
  /** missing = item not done; stale = annual item past its window. */
  missing: ChartRequirementKey[];
  stale: ChartRequirementKey[];
  /** Worst single status across items: ok < stale < missing. */
  worst: ChartItemStatus;
}

/**
 * Pure evaluator. Pass in the resident + their most-recent admission row
 * (the row that actually has the LIC checkboxes set) + the current time.
 *
 * @param annualWindowDays override the staleness window for annual items
 *   (defaults to ANNUAL_PHYSICIAN_REPORT_DAYS). Storage callers will read
 *   the per-facility reg-setting and pass it in.
 */
export function evaluateChartCompleteness(
  resident: ResidentForChart,
  admission: AdmissionForChart | null,
  now: number = Date.now(),
  annualWindowDays: number = ANNUAL_PHYSICIAN_REPORT_DAYS,
): ChartCompletenessResult {
  const a = admission;
  const items: ChartItemResult[] = CHART_REQUIREMENTS.map((key) => {
    const item = evaluateItem(key, a, now, annualWindowDays);
    return item;
  });

  const missing = items.filter((i) => i.status === "missing").map((i) => i.key);
  const stale = items.filter((i) => i.status === "stale").map((i) => i.key);
  const completedCount = items.filter((i) => i.status === "ok").length;
  const worst: ChartItemStatus = missing.length > 0
    ? "missing"
    : stale.length > 0
      ? "stale"
      : "ok";

  return {
    residentId: resident.id,
    items,
    completedCount,
    totalCount: items.length,
    missing,
    stale,
    worst,
  };
}

function evaluateItem(
  key: ChartRequirementKey,
  a: AdmissionForChart | null,
  now: number,
  annualWindowDays: number,
): ChartItemResult {
  const completed = isCompleted(key, a);
  if (!completed.done) {
    return { key, status: "missing", asOf: null };
  }

  // Stale check — only annual items.
  if (CHART_ANNUAL_ITEMS.has(key)) {
    const asOf = completed.asOf ?? null;
    if (asOf == null) {
      // Completed but no date — treat as stale so admin notices.
      return { key, status: "stale", asOf };
    }
    const ageDays = (now - asOf) / (24 * 60 * 60 * 1000);
    const daysUntilStale = Math.round(annualWindowDays - ageDays);
    return {
      key,
      status: daysUntilStale < 0 ? "stale" : "ok",
      asOf,
      daysUntilStale,
    };
  }

  return { key, status: "ok", asOf: completed.asOf ?? null };
}

/** Maps each requirement to the column(s) on ops_admissions that satisfy it. */
function isCompleted(
  key: ChartRequirementKey,
  a: AdmissionForChart | null,
): { done: boolean; asOf?: number | null } {
  if (!a) return { done: false };
  switch (key) {
    case "lic_601":
      return { done: !!a.lic601Completed, asOf: a.lic601Date };
    case "lic_602a":
      return { done: !!a.lic602aCompleted || !!a.physicianReportReceived, asOf: a.lic602aDate };
    case "lic_603":
      return { done: !!a.lic603Completed, asOf: a.lic603Date };
    case "lic_604a":
      return { done: !!a.lic604aCompleted || !!a.admissionAgreementSigned, asOf: a.lic604aDate ?? a.admissionAgreementSignedAt };
    case "lic_613":
      // No standalone bool on ops_admissions yet — Phase 4 deferred the
      // Personal Rights signed column. For v0, treat it as satisfied
      // when LIC 604A is signed (the admission packet typically bundles
      // 613 with 604A).
      return { done: !!a.lic604aCompleted || !!a.admissionAgreementSigned, asOf: a.lic604aDate ?? a.admissionAgreementSignedAt };
    case "advance_directive":
      // No structured column today; placeholder satisfied by LIC 605A
      // (commonly the appraisal addendum captures DNR/code status).
      return { done: !!a.lic605aCompleted, asOf: a.lic605aDate };
    case "tb_test_results":
      return { done: !!a.tbTestResultsReceived };
  }
}
