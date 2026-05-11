/**
 * Vitals critical-alert evaluator — unit tests.
 *
 * Regression coverage for the bug where vitalsCriticalRule unconditionally
 * fired a critical alert for any vitals entry of the matching type, ignoring
 * the actual reading. The fix wires the rule to classifyVitalRange so an
 * alert only fires when the classifier returns "critical".
 *
 * Test matrix: each vital type gets a "normal reading → no alert" case and a
 * "critical reading → alert fires" case. Thresholds mirror vital-ranges.ts.
 */

import { describe, expect, it } from "vitest";

import {
  VITALS_DEFINITION,
  type VitalType,
} from "@shared/tracker-schemas";
import type { AlertRule } from "@shared/tracker-schemas/alerts";

function findRule(ruleId: string): AlertRule {
  const rule = VITALS_DEFINITION.alerts?.find((r) => r.id === ruleId);
  if (!rule) throw new Error(`Missing vitals rule: ${ruleId}`);
  return rule;
}

const CTX = {
  trackerSlug: "vitals",
  residentId: 1,
  shift: "AM" as const,
  occurredAt: Date.now(),
};

function evaluate(ruleId: string, payload: Record<string, unknown>) {
  return findRule(ruleId).evaluate(payload, CTX);
}

interface NormalCriticalCase {
  ruleId: string;
  vitalType: VitalType;
  normal: Record<string, unknown>;
  critical: Record<string, unknown>;
}

const CASES: NormalCriticalCase[] = [
  {
    ruleId: "vitals.bp.critical",
    vitalType: "bp",
    normal: { vital_type: "bp", systolic: 128, diastolic: 82 },
    critical: { vital_type: "bp", systolic: 185, diastolic: 95 },
  },
  {
    ruleId: "vitals.pulse.critical",
    vitalType: "pulse",
    normal: { vital_type: "pulse", value: 74 },
    critical: { vital_type: "pulse", value: 45 },
  },
  {
    ruleId: "vitals.temperature.critical",
    vitalType: "temperature",
    normal: { vital_type: "temperature", value: 98.6, unit: "F" },
    critical: { vital_type: "temperature", value: 104, unit: "F" },
  },
  {
    ruleId: "vitals.oxygen.critical",
    vitalType: "oxygen",
    normal: { vital_type: "oxygen", value: 98 },
    critical: { vital_type: "oxygen", value: 88 },
  },
  {
    ruleId: "vitals.glucose.critical",
    vitalType: "glucose",
    normal: { vital_type: "glucose", value: 110 },
    critical: { vital_type: "glucose", value: 60 },
  },
  {
    ruleId: "vitals.respiratory.critical",
    vitalType: "respiratory",
    normal: { vital_type: "respiratory", value: 16 },
    critical: { vital_type: "respiratory", value: 6 },
  },
  {
    ruleId: "vitals.pain.critical",
    vitalType: "pain",
    normal: { vital_type: "pain", value: 3 },
    critical: { vital_type: "pain", value: 9 },
  },
];

describe("vitalsCriticalRule — false-positive regression", () => {
  for (const c of CASES) {
    it(`${c.vitalType}: normal reading does not fire ${c.ruleId}`, () => {
      expect(evaluate(c.ruleId, c.normal)).toBeNull();
    });

    it(`${c.vitalType}: critical reading fires ${c.ruleId}`, () => {
      const alert = evaluate(c.ruleId, c.critical);
      expect(alert).not.toBeNull();
      expect(alert?.severity).toBe("critical");
      expect(alert?.ruleId).toBe(c.ruleId);
    });
  }

  // Boundary cases lifted directly from the user-reported bug values.
  it("BP 128/82 (the original false-positive) does NOT fire hypertensive crisis", () => {
    expect(
      evaluate("vitals.bp.critical", {
        vital_type: "bp",
        systolic: 128,
        diastolic: 82,
      }),
    ).toBeNull();
  });

  it("BP fires when only diastolic crosses ≥120", () => {
    const alert = evaluate("vitals.bp.critical", {
      vital_type: "bp",
      systolic: 130,
      diastolic: 125,
    });
    expect(alert).not.toBeNull();
  });

  it("Temperature in Celsius is correctly classified (39°C = 102.2°F = elevated, not critical)", () => {
    expect(
      evaluate("vitals.temperature.critical", {
        vital_type: "temperature",
        value: 39,
        unit: "C",
      }),
    ).toBeNull();
  });

  it("Temperature in Celsius fires when >103°F equivalent (40°C = 104°F)", () => {
    const alert = evaluate("vitals.temperature.critical", {
      vital_type: "temperature",
      value: 40,
      unit: "C",
    });
    expect(alert).not.toBeNull();
  });

  it("Mismatched vital_type does not fire a rule (defense-in-depth)", () => {
    // pulse rule called with a bp payload — must not fire.
    expect(
      evaluate("vitals.pulse.critical", {
        vital_type: "bp",
        systolic: 185,
        diastolic: 95,
      }),
    ).toBeNull();
  });
});
