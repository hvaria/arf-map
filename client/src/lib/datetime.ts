/**
 * Shared datetime helpers for the Operations portal.
 *
 * Fixes a class of timezone bugs that came from using
 *     new Date("2026-05-05").getTime()
 * which parses as UTC midnight, NOT local midnight. For users west of UTC
 * that means an "incident on May 5" lands on May 4 in the database.
 *
 * Always use these helpers when converting between user-facing dates and
 * timestamps stored on the server.
 */

/** YYYY-MM-DD for the given date in local time (default: now). */
export function isoLocalDate(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today's date as YYYY-MM-DD in local time. */
export function todayLocal(): string {
  return isoLocalDate(new Date());
}

/**
 * Convert YYYY-MM-DD to LOCAL midnight Unix ms.
 *
 * `new Date("YYYY-MM-DD")` is parsed as UTC; `new Date("YYYY-MM-DDT00:00:00")`
 * (no trailing Z) is parsed as local. We use the latter so the timestamp
 * represents the user's intended day in their timezone.
 */
export function toLocalEpochMs(yyyymmdd: string): number {
  if (!yyyymmdd) return Number.NaN;
  return new Date(`${yyyymmdd}T00:00:00`).getTime();
}

/**
 * Convert a YYYY-MM-DD + HH:MM pair to a local-time Unix ms. Either part
 * may be empty; missing time defaults to 00:00.
 */
export function toLocalEpochMsWithTime(
  yyyymmdd: string,
  hhmm: string | null | undefined,
): number {
  if (!yyyymmdd) return Number.NaN;
  const time = hhmm && /^\d{1,2}:\d{2}$/.test(hhmm) ? hhmm : "00:00";
  return new Date(`${yyyymmdd}T${time}:00`).getTime();
}

/**
 * Parse a scheduled time string into {hour, minute}. Tolerates both formats
 * the backend can emit:
 *   • 24-hour zero-padded   — "08:00", "20:30"
 *   • 12-hour with meridiem — "8:00 AM", "10:30 PM"
 * Returns null on garbage so the caller can drop unparseable rows.
 */
export function parseAmPm(t: string | null | undefined): { hour: number; minute: number } | null {
  if (!t) return null;
  const trimmed = t.trim();

  const ampm = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let hour = parseInt(ampm[1], 10);
    const minute = parseInt(ampm[2], 10);
    const pm = ampm[3].toUpperCase() === "PM";
    if (pm && hour !== 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    return { hour, minute };
  }

  const h24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const hour = parseInt(h24[1], 10);
    const minute = parseInt(h24[2], 10);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute };
  }

  return null;
}

/** Render any parsed time as "8:00 AM" / "12:30 PM". */
export function formatTimeLabel(t: string | null | undefined): string {
  const p = parseAmPm(t);
  if (!p) return t ?? "";
  const ampm = p.hour < 12 ? "AM" : "PM";
  const h12 = p.hour === 0 ? 12 : p.hour > 12 ? p.hour - 12 : p.hour;
  return `${h12}:${String(p.minute).padStart(2, "0")} ${ampm}`;
}
