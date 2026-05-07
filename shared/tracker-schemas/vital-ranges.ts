/**
 * Pure vitals range classification — shared between server, client, and
 * `historySummary` callbacks on tracker definitions.
 *
 * Adult thresholds. The same logic powers the live coloring on
 * `VitalsRangeInput` and the badge rendering in HistoryTab + Versions drawer,
 * so tone stays consistent across input and review.
 */

import type { VitalType } from "./vitals";

export type VitalRange = "normal" | "elevated" | "critical" | "unknown";

const RANK: Record<VitalRange, number> = {
  unknown: 0,
  normal: 1,
  elevated: 2,
  critical: 3,
};

/** The "louder" of two ranges — handy when combining systolic/diastolic. */
export function worstRange(a: VitalRange, b: VitalRange): VitalRange {
  return RANK[a] >= RANK[b] ? a : b;
}

function classifyBp(systolic: number, diastolic: number): VitalRange {
  if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) return "unknown";
  if (systolic >= 180 || diastolic >= 120) return "critical";
  if (systolic >= 140 || diastolic >= 90) return "elevated";
  if (systolic >= 130 || diastolic >= 80) return "elevated";
  if (systolic >= 120) return "elevated";
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
  if (value >= 95 && value < 97) return "elevated";
  return "normal";
}

function classifyTemperatureC(value: number): VitalRange {
  if (!Number.isFinite(value)) return "unknown";
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
 * Classify a vital reading. For BP only, `secondary` carries the diastolic
 * pressure. Temperature defaults to Fahrenheit; pass `unit: 'C'` to switch.
 * Pure — safe in shared, server, and client contexts.
 */
export function classifyVitalRange(
  vitalType: VitalType,
  value: number | string | undefined,
  options: {
    secondary?: number | string;
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

export const RANGE_LABEL: Record<VitalRange, string> = {
  normal: "Normal",
  elevated: "Elevated",
  critical: "Critical",
  unknown: "—",
};
