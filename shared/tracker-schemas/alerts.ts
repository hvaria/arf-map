/**
 * Per-tracker alert rules.
 *
 * Tracker definitions declare an optional `alerts: AlertRule[]` list. The
 * server evaluator runs each rule against newly-inserted/updated tracker
 * entries and writes triggered alerts to `tracker_alerts`. The
 * OperationsTab Alerts panel and per-tracker views read from there.
 *
 * v1 supports two rule kinds:
 *   - `out-of-range`: pure function of a single payload (immediate, on-write)
 *   - `payload-matches`: structural match against payload fields (on-write)
 *
 * Future kinds (v2): `missing-for-days` (cron-evaluated; needs scheduler).
 *
 * Rule authoring stays in shared/ so both client and server consume the same
 * shape. The `evaluate` function on each rule is stripped before wire
 * transfer (functions aren't JSON-safe) — server reads the local registry,
 * client reads its local registry. See `serializeDefinitionForClient`.
 */

import { classifyVitalRange } from "./vital-ranges";
import type { VitalType } from "./vitals";

export type AlertSeverity = "info" | "warn" | "critical";

/**
 * An alert produced by a rule firing against an entry. Server persists this
 * shape into `tracker_alerts` (with additional metadata like facility_number,
 * created_at, etc.).
 */
export interface AlertEvent {
  /** Stable identifier for the rule that produced this alert. */
  ruleId: string;
  severity: AlertSeverity;
  /** One-line human-readable headline shown in alert lists. */
  message: string;
  /** Optional longer description / suggested action. */
  detail?: string;
  /**
   * If true, this rule's alert can be safely "auto-resolved" when a later
   * entry of the same kind for the same resident no longer matches. v1
   * implementation just marks them stale — UX defers acknowledgement to staff.
   */
  autoResolveOnNextEntry?: boolean;
}

/**
 * `evaluate` returns one alert (or null) for the given payload + context.
 * Pure function; safe to run on either client or server.
 */
export interface AlertRule {
  /** Stable identifier — used to dedupe and reference the rule. */
  id: string;
  /** Default severity if `evaluate` doesn't override. */
  defaultSeverity: AlertSeverity;
  /** Human-readable label for admin UIs (rule list, audit trail). */
  label: string;
  /**
   * Pure evaluator. Receives the inserted/updated payload + lightweight
   * context. Returns an `AlertEvent` to fire, or `null` for no alert.
   */
  evaluate: (
    payload: unknown,
    ctx: AlertEvalContext,
  ) => AlertEvent | null;
}

export interface AlertEvalContext {
  trackerSlug: string;
  residentId: number | null;
  shift: string | null;
  occurredAt: number;
}

/**
 * Helper: build a vitals out-of-range rule that fires `critical` only when
 * the shared classifier returns "critical". Reused by every vital type so the
 * rule severity stays in lockstep with the live coloring on `VitalsRangeInput`
 * and the badges in the History tab.
 */
export function vitalsCriticalRule(args: {
  id: string;
  label: string;
  /** vital_type discriminator value, e.g. 'bp', 'pulse'. */
  vitalType: VitalType;
  /** Build the human-readable headline. */
  message: (payload: Record<string, unknown>) => string;
  /** Optional longer description / suggested action. */
  detail?: (payload: Record<string, unknown>) => string;
}): AlertRule {
  return {
    id: args.id,
    defaultSeverity: "critical",
    label: args.label,
    evaluate(payload) {
      if (!payload || typeof payload !== "object") return null;
      const p = payload as Record<string, unknown>;
      if (p.vital_type !== args.vitalType) return null;

      const range =
        args.vitalType === "bp"
          ? classifyVitalRange("bp", asNumber(p.systolic), {
              secondary: asNumber(p.diastolic),
            })
          : args.vitalType === "temperature"
            ? classifyVitalRange("temperature", asNumber(p.value), {
                unit: p.unit === "C" ? "C" : "F",
              })
            : classifyVitalRange(args.vitalType, asNumber(p.value));

      if (range !== "critical") return null;

      return {
        ruleId: args.id,
        severity: "critical",
        message: args.message(p),
        detail: args.detail?.(p),
        autoResolveOnNextEntry: true,
      };
    },
  };
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}
