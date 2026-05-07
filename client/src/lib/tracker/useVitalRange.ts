/**
 * Client-side React hook around the shared vitals range classifier. The pure
 * threshold logic (`classifyVitalRange`, `VitalRange`, `RANGE_LABEL`,
 * `worstRange`) lives in `@shared/tracker-schemas/vital-ranges` so that
 * `historySummary` callbacks on tracker definitions and any future server-side
 * alert evaluator share one source of truth.
 *
 * This file owns only the bits that touch tailwind / React.
 */

import {
  classifyVitalRange,
  type VitalRange,
} from "@shared/tracker-schemas/vital-ranges";
import type { VitalType } from "@shared/tracker-schemas";

export {
  classifyVitalRange,
  worstRange,
  RANGE_LABEL,
  type VitalRange,
} from "@shared/tracker-schemas/vital-ranges";

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

/**
 * React hook wrapper. Pure pass-through — exists so consumers can opt into
 * conventional `useFoo` ergonomics inside hooks-only contexts.
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
