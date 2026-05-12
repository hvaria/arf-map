/**
 * Helpers for converting free-form speech-to-text strings into structured
 * form values: dates ("March 5th 1947" → "1947-03-05"), enum selections
 * ("memory care" → "memory_care"), and phone numbers.
 *
 * Kept dependency-free so it stays cheap and easy to reason about. None of
 * these functions throw — they return null/best-effort on failure so the UI
 * can show a friendly "couldn't read that, please retry" message.
 */

export interface EnumOption {
  value: string;
  label: string;
  /** Extra phrases that should match this option, e.g. "memory" → memory_care. */
  aliases?: string[];
}

// ---------- date parsing ----------

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};

const ORDINAL_WORDS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, "twenty-first": 21,
  "twenty-second": 22, "twenty-third": 23, "twenty-fourth": 24,
  "twenty-fifth": 25, "twenty-sixth": 26, "twenty-seventh": 27,
  "twenty-eighth": 28, "twenty-ninth": 29, thirtieth: 30, "thirty-first": 31,
};

const MONTHS = [
  "january", "february", "march", "april", "may", "june",
  "july", "august", "september", "october", "november", "december",
];

const MONTH_ABBREV: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9,
  oct: 10, nov: 11, dec: 12,
};

function isValidYmd(y: number, m: number, d: number): boolean {
  if (y < 1900 || y > 2100) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, m - 1, d));
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  );
}

function ymd(y: number, m: number, d: number): string {
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

function expandTwoDigitYear(y: number): number {
  if (y >= 100) return y;
  return y < 30 ? 2000 + y : 1900 + y;
}

/** Convert a space-separated phrase like "nineteen forty seven" into 1947. */
function wordsToNumber(text: string): number | null {
  const cleaned = text
    .toLowerCase()
    .replace(/-/g, " ")
    .replace(/\band\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  if (/^\d+$/.test(cleaned)) return parseInt(cleaned, 10);
  if (cleaned in ORDINAL_WORDS) return ORDINAL_WORDS[cleaned];
  const hyphenated = cleaned.replace(/ /g, "-");
  if (hyphenated in ORDINAL_WORDS) return ORDINAL_WORDS[hyphenated];

  const parts = cleaned.split(" ");
  let total = 0;
  let current = 0;
  let touched = false;

  for (const p of parts) {
    if (/^\d+$/.test(p)) {
      current += parseInt(p, 10);
      touched = true;
      continue;
    }
    if (p in NUMBER_WORDS) {
      const n = NUMBER_WORDS[p];
      if (n === 100) current = Math.max(current, 1) * 100;
      else if (n === 1000) {
        total += Math.max(current, 1) * 1000;
        current = 0;
      } else {
        current += n;
      }
      touched = true;
      continue;
    }
    if (p in ORDINAL_WORDS) {
      current += ORDINAL_WORDS[p];
      touched = true;
      continue;
    }
    return null;
  }
  if (!touched) return null;
  return total + current;
}

/**
 * Parse a spoken or typed date into ISO `YYYY-MM-DD`. Accepts:
 *   - "1947-03-05"
 *   - "3/5/1947" (US m/d/y)
 *   - "March 5 1947", "March 5th, 1947"
 *   - "march fifth nineteen forty seven"
 *   - "today", "yesterday"
 * Returns `null` if no interpretation works.
 */
export function parseSpokenDate(input: string): string | null {
  if (!input) return null;
  const original = input.trim();
  if (!original) return null;

  const lower = original
    .toLowerCase()
    .replace(/(\d+)(st|nd|rd|th)\b/g, "$1")
    .replace(/,/g, "")
    .replace(/\bof\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (lower === "today") {
    const d = new Date();
    return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }
  if (lower === "yesterday") {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
  }

  // ISO: 1947-03-05 or 1947/03/05
  const iso = lower.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (iso) {
    const y = +iso[1], m = +iso[2], d = +iso[3];
    if (isValidYmd(y, m, d)) return ymd(y, m, d);
  }

  // US m/d/y
  const slash = lower.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (slash) {
    const m = +slash[1];
    const d = +slash[2];
    const y = expandTwoDigitYear(+slash[3]);
    if (isValidYmd(y, m, d)) return ymd(y, m, d);
  }

  // Month-name forms
  let monthIdx = -1;
  let monthToken = "";
  for (let i = 0; i < MONTHS.length; i++) {
    const re = new RegExp(`\\b${MONTHS[i]}\\b`);
    if (re.test(lower)) {
      monthIdx = i;
      monthToken = MONTHS[i];
      break;
    }
  }
  if (monthIdx === -1) {
    for (const [abbrev, idx] of Object.entries(MONTH_ABBREV)) {
      const re = new RegExp(`\\b${abbrev}\\b`);
      if (re.test(lower)) {
        monthIdx = idx - 1;
        monthToken = abbrev;
        break;
      }
    }
  }

  if (monthIdx !== -1) {
    const rest = lower.replace(monthToken, " ").replace(/\s+/g, " ").trim();
    // numeric day + numeric year
    const numMatch = rest.match(/\b(\d{1,2})\b.*?\b(\d{2,4})\b/);
    if (numMatch) {
      const d = +numMatch[1];
      const y = expandTwoDigitYear(+numMatch[2]);
      if (isValidYmd(y, monthIdx + 1, d)) return ymd(y, monthIdx + 1, d);
    }

    // worded day + worded/numeric year
    const tokens = rest.split(/\s+/).filter(Boolean);
    let dayVal: number | null = null;
    let dayIdx = -1;
    for (let t = 0; t < Math.min(tokens.length, 3); t++) {
      const v = wordsToNumber(tokens[t]);
      if (v != null && v >= 1 && v <= 31) {
        dayVal = v;
        dayIdx = t;
        break;
      }
    }
    if (dayVal != null) {
      const yearStr = tokens.slice(dayIdx + 1).join(" ");
      const yearVal = wordsToNumber(yearStr);
      if (yearVal != null) {
        const y = expandTwoDigitYear(yearVal);
        if (isValidYmd(y, monthIdx + 1, dayVal)) {
          return ymd(y, monthIdx + 1, dayVal);
        }
      }
    }
  }

  // Last resort: native parser (handles "Mar 5, 1947" etc.)
  const ts = Date.parse(original);
  if (!Number.isNaN(ts)) {
    const d = new Date(ts);
    if (isValidYmd(d.getFullYear(), d.getMonth() + 1, d.getDate())) {
      return ymd(d.getFullYear(), d.getMonth() + 1, d.getDate());
    }
  }
  return null;
}

// ---------- enum matching ----------

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Score an enum option against a user utterance. Higher is better;
 * threshold lives in `fuzzyMatchEnum`.
 */
function scoreOption(query: string, opt: EnumOption): number {
  const q = normalize(query);
  if (!q) return 0;
  const candidates = [opt.value, opt.label, ...(opt.aliases ?? [])]
    .map(normalize)
    .filter(Boolean);
  let best = 0;
  for (const c of candidates) {
    if (c === q) {
      best = Math.max(best, 100);
      continue;
    }
    if (q.includes(c) || c.includes(q)) {
      // Longer overlap → higher score
      const longer = Math.max(q.length, c.length);
      const shorter = Math.min(q.length, c.length);
      best = Math.max(best, 70 + Math.round((shorter / longer) * 20));
      continue;
    }
    const qTokens = new Set(q.split(" "));
    const cTokens = c.split(" ");
    let hits = 0;
    for (const t of cTokens) if (qTokens.has(t)) hits++;
    if (hits > 0) {
      best = Math.max(best, 40 + Math.round((hits / cTokens.length) * 40));
    }
  }
  return best;
}

/** Pick the best matching enum option, or null if confidence is too low. */
export function fuzzyMatchEnum(
  input: string,
  options: EnumOption[],
  minScore = 60,
): EnumOption | null {
  let best: { opt: EnumOption; score: number } | null = null;
  for (const opt of options) {
    const score = scoreOption(input, opt);
    if (!best || score > best.score) best = { opt, score };
  }
  return best && best.score >= minScore ? best.opt : null;
}

// ---------- phone parsing ----------

const SPOKEN_DIGITS: Record<string, string> = {
  zero: "0", oh: "0", one: "1", two: "2", three: "3", four: "4",
  five: "5", six: "6", seven: "7", eight: "8", nine: "9",
};

/**
 * Normalize a spoken phone number to a US-formatted string when possible.
 * "five five five one two three four five six seven" → "(555) 123-4567".
 * Non-US-length inputs are returned as raw digits.
 */
export function parsePhone(input: string): string {
  if (!input) return "";
  const replaced = input
    .toLowerCase()
    .replace(/\b(zero|oh|one|two|three|four|five|six|seven|eight|nine)\b/g, (m) => SPOKEN_DIGITS[m] ?? "");
  const digits = replaced.replace(/\D/g, "");
  if (!digits) return input.trim();
  let d = digits;
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  if (d.length === 10) {
    return `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}`;
  }
  return d;
}
