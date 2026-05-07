/**
 * Range computation for vitals.
 *
 * Given a vital type and a numeric value (and an optional secondary value, used
 * by BP for diastolic), classify it into `normal | elevated | critical`. The
 * tunable thresholds live as data here so the same logic can be used by the
 * input renderer and the history tab.
 *
 * Adult thresholds — see the slice spec for the canonical table.
 */

import type { VitalType } from "@shared/tracker-schemas";

export type VitalRange = "normal" | "elevated" | "critical" | "unknown";

const RANK: Record<VitalRange, number> = {
  unknown: 0,
  normal: 1,
  elevated: 2,
  critical: 3,
};

/** The "louder" of two ranges — handy when combining systolic/diastolic. */
function worst(a: VitalRange, b: VitalRange): VitalRange {
  return RANK[a] >= RANK[b] ? a : b;
}

function classifyBp(systolic: number, diastolic: number): VitalRange {
  if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) return "unknown";
  // Critical ≥180 systolic or ≥120 diastolic.
  if (systolic >= 180 || diastolic >= 120) return "critical";
  // High stage 2 (140–179 / 90–119) — treat as elevated for the visual.
  if (systolic >= 140 || diastolic >= 90) return "elevated";
  // High stage 1 (130–139 / 80–89) — elevated.
  if (systolic >= 130 || diastolic >= 80) return "elevated";
  // Elevated (120–129 systolic, <80 diastolic).
  if (systolic >= 120) return "elevated";
  // Normal.
  return "normal";
}

function classifyPulse(value: number): VitalRange {
  if (!Number.isFinite(value)) return "unknown";
  if (value < 50 || value > 120) return "critical";
  if (value < 60 || value > 100) return "elevated";
  return "normal";
}

function classifyTemperatureF(value: number): VitalRange {
  if (!Number.isFinite(value)) return "unknown";
  if (value > 103 || value < 95) return "critical";
  if (value >= 101 && value <= 103) return "elevated";
  if (value > 99 && value < 101) return "elevated";
  if (value >= 97 && value <= 99) return "normal";
  // Below 97 but ≥95 we still call elevated (low-grade hypothermic risk).
  if (value >= 95 && value < 97) return "elevated";
  return "normal";
}

function classifyTemperatureC(value: number): VitalRange {
  if (!Number.isFinite(value)) return "unknown";
  // Convert to F and reuse — keeps thresholds aligned in one place.
  const f = (value * 9) / 5 + 32;
  return classifyTemperatureF(f);
}

function classifyOxygen(value: number): VitalRange {
  if (!Number.isFinite(value)) return "unknown";
  if (value < 90) return "critical";
  if (value < 95) return "elevated";
  return "normal";
}

function classifyGlucose(value: number): VitalRange {
  if (!Number.isFinite(value)) return "unknown";
  if (value < 70 || value > 250) return "critical";
  if (value > 140) return "elevated";
  return "normal";
}

function classifyRespiratory(value: number): VitalRange {
  if (!Number.isFinite(value)) return "unknown";
  if (value < 8 || value > 30) return "critical";
  if (value > 20 || value < 12) return "elevated";
  return "normal";
}

function classifyPain(value: number): VitalRange {
  if (!Number.isFinite(value)) return "unknown";
  if (value >= 8) return "critical";
  if (value >= 4) return "elevated";
  return "normal";
}

function classifyWeight(_value: number): VitalRange {
  // Weight has no clinical range — informational only.
  return "normal";
}

/**
 * Classify a vital reading. The caller passes the primary value; for BP only,
 * `secondary` carries the diastolic pressure. The temperature unit is `F` by
 * default; pass `unit: 'C'` to switch.
 *
 * Pure function — safe to call inline, in `useMemo`, or conditionally. The
 * `useVitalRange` export below is the React-hook wrapper for cases where the
 * parent wants the conventional hook ergonomics.
 */
export function classifyVitalRange(
  vitalType: VitalType,
  value: number | string | undefined,
  options: {
    secondary?: number | string;
    /** For temperature only. */
    unit?: "F" | "C";
  } = {},
): VitalRange {
  const v = typeof value === "string" ? Number(value) : value;
  const secondary =
    typeof options.secondary === "string"
      ? Number(options.secondary)
      : options.secondary;
  if (v === undefined || Number.isNaN(v)) return "unknown";

  switch (vitalType) {
    case "bp": {
      if (secondary === undefined || Number.isNaN(secondary)) {
        // Only systolic so far — give early feedback off systolic alone.
        return classifyBp(v, 0);
      }
      return classifyBp(v, secondary);
    }
    case "pulse":
      return classifyPulse(v);
    case "temperature":
      return options.unit === "C"
        ? classifyTemperatureC(v)
        : classifyTemperatureF(v);
    case "oxygen":
      return classifyOxygen(v);
    case "glucose":
      return classifyGlucose(v);
    case "respiratory":
      return classifyRespiratory(v);
    case "pain":
      return classifyPain(v);
    case "weight":
      return classifyWeight(v);
    default: {
      const _exhaustive: never = vitalType;
      void _exhaustive;
      return "unknown";
    }
  }
}

/**
 * Tailwind class fragments per range. Kept in one place so renderers stay in
 * lockstep with the history tab.
 */
export const RANGE_CLASSES: Record<VitalRange, {
  border: string;
  text: string;
  bg: string;
  ring: string;
  badge: string;
}> = {
  normal: {
    border: "border-emerald-300",
    text: "text-emerald-700",
    bg: "bg-emerald-50",
    ring: "focus-visible:ring-emerald-300",
    badge: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  elevated: {
    border: "border-amber-300",
    text: "text-amber-700",
    bg: "bg-amber-50",
    ring: "focus-visible:ring-amber-300",
    badge: "bg-amber-50 text-amber-800 border-amber-200",
  },
  critical: {
    border: "border-red-400",
    text: "text-red-700",
    bg: "bg-red-50",
    ring: "focus-visible:ring-red-300",
    badge: "bg-red-50 text-red-700 border-red-300",
  },
  unknown: {
    border: "border-input",
    text: "text-muted-foreground",
    bg: "bg-background",
    ring: "focus-visible:ring-indigo-300",
    badge: "bg-slate-50 text-muted-foreground border-slate-200",
  },
};

export const RANGE_LABEL: Record<VitalRange, string> = {
  normal: "Normal",
  elevated: "Elevated",
  critical: "Critical",
  unknown: "—",
};

export { worst as worstRange };

/**
 * React hook wrapper around {@link classifyVitalRange}. The classification is
 * cheap and pure, so we just pass the call through — the hook exists purely
 * so consumers can opt into the conventional `useFoo` ergonomic when they
 * have stable inputs and want a hook in their dependency chain.
 */
export function useVitalRange(
  vitalType: VitalType,
  value: number | string | undefined,
  options: {
    secondary?: number | string;
    unit?: "F" | "C";
  } = {},
): VitalRange {
  return classifyVitalRange(vitalType, value, options);
}
