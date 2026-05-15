/**
 * Wave 4 Phase 4.1 — Drill cadence calculator (replaces the Wave 1 W5
 * "comes later" footnote in 02b-prioritization.md).
 *
 * Pure aggregation only — no writes. Scores the current quarter against
 * the FIRE_DRILLS_PER_SHIFT_PER_QUARTER reg setting (default 1) and
 * returns a per-shift breakdown the FE renders as the "Quarter status"
 * chip in the drills view (§4.3 of 03-product-ia-and-flows.md).
 *
 * Tenant isolation: facility_number is in every WHERE.
 *
 * Spec note (UTC math): quarter boundaries are computed in UTC. The
 * drift across DST is negligible at quarter granularity — a drill logged
 * at the very edge of a quarter could land in the adjacent bucket by an
 * hour, but the operational outcome ("did you log enough this quarter")
 * is unaffected.
 */

import { pool } from "../db/index";
import { getRegSetting } from "./regSettings";

export type DrillShift = "AM" | "PM" | "NOC";
const DRILL_SHIFTS: ReadonlyArray<DrillShift> = ["AM", "PM", "NOC"];

export interface DrillCadenceCell {
  shift: DrillShift;
  /** Target from FIRE_DRILLS_PER_SHIFT_PER_QUARTER (>= 0). */
  required: number;
  /** Count of fire drills logged in [quarterStartAt, quarterEndAt) at this shift. */
  logged: number;
  /** max(0, required - logged). */
  deficit: number;
  status: "ok" | "behind";
}

export interface DrillCadenceRollup {
  facilityNumber: string;
  quarterStartAt: number;
  quarterEndAt: number;
  fire: DrillCadenceCell[];
  totalRequired: number;
  totalLogged: number;
  totalDeficit: number;
  worst: "ok" | "behind";
}

function safePositiveInt(raw: string | null | undefined, fallback: number): number {
  if (raw === null || raw === undefined) return fallback;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/**
 * Quarter boundaries (UTC). Q1 = Jan-Mar, Q2 = Apr-Jun, Q3 = Jul-Sep,
 * Q4 = Oct-Dec. Returns the half-open interval [start, end).
 */
function quarterRange(now: number): { start: number; end: number } {
  const d = new Date(now);
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3);
  const startMonth = q * 3;
  const start = Date.UTC(y, startMonth, 1);
  const endYear = startMonth + 3 >= 12 ? y + 1 : y;
  const endMonth = (startMonth + 3) % 12;
  const end = Date.UTC(endYear, endMonth, 1);
  return { start, end };
}

/**
 * Score the current quarter for one facility. ONE SQL — groups by shift
 * over `executed_at`-bounded range, then fills missing shifts with zero.
 */
export async function getDrillCadence(
  facilityNumber: string,
  now: number = Date.now(),
): Promise<DrillCadenceRollup> {
  if (!facilityNumber) throw new Error("facilityNumber is required");
  const { start, end } = quarterRange(now);

  const perShiftStr = await getRegSetting(
    facilityNumber,
    "FIRE_DRILLS_PER_SHIFT_PER_QUARTER",
  ).catch(() => null);
  const required = safePositiveInt(perShiftStr, 1);

  // Group-by-shift. NULL shifts collapse to a sentinel key we drop on
  // read. status filter excludes soft-deleted drill logs (mirrors
  // opsStorage.listDrillLogs default).
  const res = await pool.query<{ shift: string | null; cnt: number }>(
    `SELECT shift, COUNT(*)::int AS cnt
       FROM ops_drill_logs
      WHERE facility_number = $1
        AND drill_kind = 'fire'
        AND executed_at >= $2
        AND executed_at < $3
        AND status <> 'deleted'
      GROUP BY shift`,
    [facilityNumber, start, end],
  );

  const counts = new Map<DrillShift, number>();
  for (const r of res.rows) {
    const s = (r.shift ?? "").toUpperCase() as DrillShift;
    if (DRILL_SHIFTS.includes(s)) {
      counts.set(s, Number(r.cnt));
    }
    // Drills logged with a NULL or unrecognized shift are not counted
    // against the per-shift target — they remain visible in the drill
    // log and admins can correct the shift attribution.
  }

  const fire: DrillCadenceCell[] = DRILL_SHIFTS.map((shift) => {
    const logged = counts.get(shift) ?? 0;
    const deficit = Math.max(0, required - logged);
    return {
      shift,
      required,
      logged,
      deficit,
      status: deficit > 0 ? "behind" : "ok",
    };
  });

  const totalRequired = fire.reduce((n, c) => n + c.required, 0);
  const totalLogged = fire.reduce((n, c) => n + c.logged, 0);
  const totalDeficit = fire.reduce((n, c) => n + c.deficit, 0);
  const worst: "ok" | "behind" = totalDeficit > 0 ? "behind" : "ok";

  return {
    facilityNumber,
    quarterStartAt: start,
    quarterEndAt: end,
    fire,
    totalRequired,
    totalLogged,
    totalDeficit,
    worst,
  };
}
