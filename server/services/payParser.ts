// Pure pay-range parser for free-text `job_postings.salary` strings.
// Returns hourly { payMin, payMax } in USD, or { null, null } when the
// input cannot be confidently parsed. Annual rates are normalized to
// hourly using 2080 hours/year (40 hr × 52 wk). The client falls back to
// the raw `salary` string when both are null.
//
// Reference: matches the spec in
// docs/engineering/implementation-readiness.md §4 of the planning
// branch — kept here pure so it can be unit-tested without a server.

export interface ParsedPay {
  payMin: number | null;
  payMax: number | null;
}

const HOURS_PER_YEAR = 2080;

// Markers we explicitly refuse to parse — mirrors PLACEHOLDER_REGEX in
// client/src/components/JobsPanel.tsx so we never claim to parse junk.
const UNPARSEABLE = /^(test|placeholder|n\/a|na|todo|tbd|sample|asdf|x+|\.+|-+|doe|competitive|negotiable|depends on experience)$/i;

function toNumber(raw: string): number | null {
  const cleaned = raw.replace(/[, ]/g, "");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function detectUnit(input: string): "hour" | "year" {
  const lc = input.toLowerCase();
  if (/(\/\s*hr|\/\s*hour|per\s*hour|hourly|an\s*hour|p\/h|\bhr\b)/.test(lc)) return "hour";
  if (/(\/\s*yr|\/\s*year|per\s*year|annually|annual|p\/a|yearly|\byr\b)/.test(lc)) return "year";
  // Heuristic when unit is implied: anything >= 1000 is almost certainly
  // an annual figure; "60-80" without a unit is hourly.
  const firstNum = lc.match(/[\d][\d,.]*/);
  if (firstNum) {
    const n = toNumber(firstNum[0]);
    if (n != null && n >= 1000) return "year";
  }
  return "hour";
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function parseSalary(salary: string | null | undefined): ParsedPay {
  if (!salary) return { payMin: null, payMax: null };
  const trimmed = salary.trim();
  if (!trimmed) return { payMin: null, payMax: null };
  if (UNPARSEABLE.test(trimmed)) return { payMin: null, payMax: null };

  const numbers = Array.from(trimmed.matchAll(/[\d][\d,]*(?:\.\d+)?/g))
    .map((m) => toNumber(m[0]))
    .filter((n): n is number => n != null);

  if (numbers.length === 0) return { payMin: null, payMax: null };

  const unit = detectUnit(trimmed);
  const hourly = numbers.map((n) => round2(unit === "year" ? n / HOURS_PER_YEAR : n));

  if (hourly.length === 1) {
    return { payMin: hourly[0], payMax: hourly[0] };
  }
  return { payMin: Math.min(...hourly), payMax: Math.max(...hourly) };
}
