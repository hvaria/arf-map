/**
 * One date/time formatting standard for every operations report.
 *
 * Reports are read by administrators, auditors, and CA regulators (CDSS/CCLD)
 * in local time, so every generator formats through these helpers instead of
 * emitting raw UTC ISO strings. PDFs get human dates ("May 29, 2026, 2:30 PM
 * PDT"); CSVs get sortable ISO-style local datetimes ("2026-05-29 14:30") with
 * the timezone carried in the column header.
 *
 * Timezone is fixed to Pacific — the platform serves California facilities. If
 * the product ever goes multi-region, switch REPORT_TIME_ZONE to a per-facility
 * value here and every report picks it up.
 */

export const REPORT_TIME_ZONE = "America/Los_Angeles";

/** Static label for column headers / period lines where PST↔PDT would be ambiguous. */
export const REPORT_TZ_LABEL = "PT";

function isValidMs(ms: number | null | undefined): ms is number {
  return typeof ms === "number" && Number.isFinite(ms);
}

/** Human timestamp for PDF stamps — e.g. "May 29, 2026, 2:30 PM PDT". */
export function formatStampDateTime(ms: number | null | undefined): string {
  if (!isValidMs(ms)) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: REPORT_TIME_ZONE,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

/** Human date for PDF body / period lines — e.g. "May 29, 2026". */
export function formatReportDate(ms: number | null | undefined): string {
  if (!isValidMs(ms)) return "";
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: REPORT_TIME_ZONE,
      year: "numeric",
      month: "short",
      day: "numeric",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

/** Sortable local datetime for CSV cells — e.g. "2026-05-29 14:30". */
export function formatCsvDateTime(ms: number | null | undefined): string {
  if (!isValidMs(ms)) return "";
  try {
    // en-CA yields "2026-05-29, 14:30"; drop the comma for a clean, sortable cell.
    const s = new Intl.DateTimeFormat("en-CA", {
      timeZone: REPORT_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(ms));
    return s.replace(",", "").replace(/\s+/g, " ").trim();
  } catch {
    return "";
  }
}

/** Sortable local date for CSV cells — e.g. "2026-05-29". */
export function formatCsvDate(ms: number | null | undefined): string {
  if (!isValidMs(ms)) return "";
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: REPORT_TIME_ZONE,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(ms));
  } catch {
    return "";
  }
}

/** "May 1, 2026 – May 31, 2026" period line for PDF headers. */
export function formatReportPeriod(
  startMs: number | null | undefined,
  endMs: number | null | undefined,
): string {
  const a = formatReportDate(startMs);
  const b = formatReportDate(endMs);
  if (a && b) return `${a} – ${b}`;
  return a || b || "";
}

// ─────────────────────────────────────────────────────────────────────────────
// Yes / No flag detection
//
// Boolean-ish columns in this codebase ship in two shapes — true/false (real
// boolean) or 0/1 (integer flag). In reports they should always read as
// "Yes" / "No", never "0" / "false". `formatYesNoFlag` is the single source of
// truth so every generator behaves the same way.
// ─────────────────────────────────────────────────────────────────────────────

// Key suffixes that unambiguously mean "this field is a flag" (e.g.
// `hospitalization_required`, `supervisor_notified`). Status-y words like
// "active", "paid", "archived" are intentionally OMITTED — they're typically
// enum values or money columns, not flags, so a 1 there shouldn't read "Yes".
const FLAG_KEY_SUFFIXES = new Set([
  "required",
  "submitted",
  "notified",
  "completed",
  "involved",
  "acknowledged",
  "signed",
  "verified",
  "approved",
  "rejected",
  "redeemed",
  "revoked",
  "resolved",
]);

// First-word prefixes that mark a boolean predicate (`isActive`, `hasConsent`).
const FLAG_KEY_PREFIXES = new Set([
  "is",
  "has",
  "was",
  "can",
  "should",
  "did",
  "needs",
]);

/** Split snake_case + camelCase into lowercase tokens. */
function tokenize(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .toLowerCase()
    .split(/_+/)
    .filter(Boolean);
}

export function isFlagKey(key: string): boolean {
  const tokens = tokenize(key);
  if (tokens.length === 0) return false;
  if (FLAG_KEY_PREFIXES.has(tokens[0])) return true;
  if (FLAG_KEY_SUFFIXES.has(tokens[tokens.length - 1])) return true;
  return false;
}

/**
 * Map a flag-shaped value to "Yes" / "No". Returns `undefined` when the value
 * is not a recognized flag, so callers can fall through to other formatting.
 *
 * - true / false → always "Yes" / "No"
 * - 0 / 1        → "No" / "Yes" only when the key looks like a flag (so a
 *                  count of 1 or a $1 doesn't accidentally become "Yes")
 */
export function formatYesNoFlag(
  key: string,
  value: unknown,
): string | undefined {
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if ((value === 0 || value === 1) && isFlagKey(key)) {
    return value === 1 ? "Yes" : "No";
  }
  return undefined;
}
