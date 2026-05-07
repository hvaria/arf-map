/**
 * Vitals tracker definition + payload schema.
 *
 * Detailed-only tracker (no Quick mode). The caregiver picks a vital type and
 * records the value(s); a `VitalsRangeInput` renderer on the client provides
 * range-aware coloring (normal/elevated/critical) as the caregiver types.
 *
 * The payload is a discriminated union on `vital_type` so each vital can carry
 * the inputs it needs (e.g. BP needs systolic + diastolic; pulse needs only
 * `value`).
 */

import { z } from "zod";

import {
  type AlertRule,
  vitalsCriticalRule,
} from "./alerts";
import {
  type HistorySummary,
  type HistoryTone,
  type TrackerDefinition,
} from "./tracker-types";
import {
  classifyVitalRange,
  RANGE_LABEL,
  type VitalRange,
} from "./vital-ranges";

// ─────────────────────────────────────────────────────────────────────────────
// Canonical vital types. The order here is what the form's vital-type select
// renders.
// ─────────────────────────────────────────────────────────────────────────────

export const VITAL_TYPES = [
  "bp",
  "pulse",
  "weight",
  "temperature",
  "oxygen",
  "glucose",
  "respiratory",
  "pain",
] as const;
export type VitalType = (typeof VITAL_TYPES)[number];

export const VITAL_TYPE_LABEL: Record<VitalType, string> = {
  bp: "Blood Pressure",
  pulse: "Pulse",
  weight: "Weight",
  temperature: "Temperature",
  oxygen: "Oxygen Saturation",
  glucose: "Blood Glucose",
  respiratory: "Respiratory Rate",
  pain: "Pain",
};

export const VITAL_TYPE_UNIT: Record<VitalType, string> = {
  bp: "mmHg",
  pulse: "bpm",
  weight: "lb / kg",
  temperature: "°F / °C",
  oxygen: "%",
  glucose: "mg/dL",
  respiratory: "breaths/min",
  pain: "0–10",
};

// ─────────────────────────────────────────────────────────────────────────────
// Payload schema — discriminated union on `vital_type`.
// ─────────────────────────────────────────────────────────────────────────────

const noteField = z.string().max(500).optional();

export const vitalsBpPayloadSchema = z.object({
  vital_type: z.literal("bp"),
  systolic: z.number().int().min(40).max(300),
  diastolic: z.number().int().min(20).max(200),
  note: noteField,
});

export const vitalsPulsePayloadSchema = z.object({
  vital_type: z.literal("pulse"),
  value: z.number().int().min(20).max(250),
  note: noteField,
});

export const vitalsWeightPayloadSchema = z.object({
  vital_type: z.literal("weight"),
  value: z.number().positive().max(800),
  unit: z.enum(["lb", "kg"]),
  note: noteField,
});

export const vitalsTemperaturePayloadSchema = z.object({
  vital_type: z.literal("temperature"),
  value: z.number().min(70).max(115),
  unit: z.enum(["F", "C"]),
  note: noteField,
});

export const vitalsOxygenPayloadSchema = z.object({
  vital_type: z.literal("oxygen"),
  value: z.number().int().min(50).max(100),
  note: noteField,
});

export const vitalsGlucosePayloadSchema = z.object({
  vital_type: z.literal("glucose"),
  value: z.number().int().min(20).max(800),
  note: noteField,
});

export const vitalsRespiratoryPayloadSchema = z.object({
  vital_type: z.literal("respiratory"),
  value: z.number().int().min(2).max(80),
  note: noteField,
});

export const vitalsPainPayloadSchema = z.object({
  vital_type: z.literal("pain"),
  value: z.number().int().min(0).max(10),
  note: noteField,
});

export const vitalsEntryPayloadSchema = z.discriminatedUnion("vital_type", [
  vitalsBpPayloadSchema,
  vitalsPulsePayloadSchema,
  vitalsWeightPayloadSchema,
  vitalsTemperaturePayloadSchema,
  vitalsOxygenPayloadSchema,
  vitalsGlucosePayloadSchema,
  vitalsRespiratoryPayloadSchema,
  vitalsPainPayloadSchema,
]);
export type VitalsEntryPayload = z.infer<typeof vitalsEntryPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// VITALS_DEFINITION — single source of truth.
// ─────────────────────────────────────────────────────────────────────────────

export const VITALS_DEFINITION: TrackerDefinition = {
  slug: "vitals",
  name: "Vitals",
  shortName: "Vitals",
  category: "health-clinical",
  schemaVersion: 1,
  icon: "Activity",
  description:
    "Record blood pressure, pulse, oxygen, temperature and other clinical vitals.",
  modes: ["detailed", "history"],
  defaultMode: "detailed",
  // The renderer on the client switches DetailedEntryForm to the
  // specialized VitalsRangeInput layout — `detailedFields` here is mostly
  // declarative metadata for the history tab summarizer.
  renderer: "vitals-range",
  detailedFields: [
    {
      kind: "resident",
      name: "residentId",
      label: "Resident",
      required: true,
    },
    {
      kind: "select",
      name: "vital_type",
      label: "Vital",
      required: true,
      options: VITAL_TYPES.map((v) => ({
        value: v,
        label: VITAL_TYPE_LABEL[v],
      })),
    },
    {
      kind: "datetime",
      name: "occurredAt",
      label: "Recorded at",
      defaultsToNow: true,
    },
    {
      kind: "textarea",
      name: "note",
      label: "Note",
      required: false,
      maxLength: 500,
    },
  ],
  payloadSchema: vitalsEntryPayloadSchema,
  historySummary: vitalsHistorySummary,
  alerts: buildVitalsAlerts(),
  requiresResident: true,
  supportsBulk: false,
  shiftAware: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// History summary — used by the History tab "what happened" cell and the
// Versions drawer per-version preview. Reuses the shared range classifier so
// the badge tone matches the live coloring on `VitalsRangeInput`.
// ─────────────────────────────────────────────────────────────────────────────

const RANGE_TO_TONE: Record<VitalRange, HistoryTone> = {
  normal: "normal",
  elevated: "elevated",
  critical: "critical",
  unknown: "info",
};

export function vitalsHistorySummary(payload: unknown): HistorySummary {
  // Defensive: payload may be malformed in older entries or unfamiliar shapes.
  if (typeof payload !== "object" || payload === null) {
    return { primary: "Vitals (unknown)" };
  }
  const p = payload as Record<string, unknown>;
  const vt = typeof p.vital_type === "string" ? p.vital_type : undefined;
  if (!vt) return { primary: "Vitals" };

  switch (vt) {
    case "bp": {
      const sys = num(p.systolic);
      const dia = num(p.diastolic);
      const range = classifyVitalRange("bp", sys, { secondary: dia });
      return {
        primary: `BP ${fmt(sys)}/${fmt(dia)} mmHg`,
        badge: RANGE_LABEL[range],
        tone: RANGE_TO_TONE[range],
      };
    }
    case "pulse": {
      const v = num(p.value);
      const range = classifyVitalRange("pulse", v);
      return {
        primary: `Pulse ${fmt(v)} bpm`,
        badge: RANGE_LABEL[range],
        tone: RANGE_TO_TONE[range],
      };
    }
    case "weight": {
      const v = num(p.value);
      const u = typeof p.unit === "string" ? p.unit : "lb";
      return { primary: `Weight ${fmt(v)} ${u}` };
    }
    case "temperature": {
      const v = num(p.value);
      const u = (p.unit === "C" ? "C" : "F") as "F" | "C";
      const range = classifyVitalRange("temperature", v, { unit: u });
      return {
        primary: `Temp ${fmt(v)}°${u}`,
        badge: RANGE_LABEL[range],
        tone: RANGE_TO_TONE[range],
      };
    }
    case "oxygen": {
      const v = num(p.value);
      const range = classifyVitalRange("oxygen", v);
      return {
        primary: `O₂ ${fmt(v)}%`,
        badge: RANGE_LABEL[range],
        tone: RANGE_TO_TONE[range],
      };
    }
    case "glucose": {
      const v = num(p.value);
      const range = classifyVitalRange("glucose", v);
      return {
        primary: `Glucose ${fmt(v)} mg/dL`,
        badge: RANGE_LABEL[range],
        tone: RANGE_TO_TONE[range],
      };
    }
    case "respiratory": {
      const v = num(p.value);
      const range = classifyVitalRange("respiratory", v);
      return {
        primary: `Resp ${fmt(v)} rpm`,
        badge: RANGE_LABEL[range],
        tone: RANGE_TO_TONE[range],
      };
    }
    case "pain": {
      const v = num(p.value);
      const range = classifyVitalRange("pain", v);
      return {
        primary: `Pain ${fmt(v)}/10`,
        badge: RANGE_LABEL[range],
        tone: RANGE_TO_TONE[range],
      };
    }
    default:
      return { primary: `Vitals (${vt})` };
  }
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) {
    return Number(v);
  }
  return undefined;
}

function fmt(v: number | undefined): string {
  return v === undefined ? "—" : String(v);
}

// ─────────────────────────────────────────────────────────────────────────────
// Alert rules. Every clinical vital with a "critical" classifier band fires a
// critical alert on out-of-range readings. Reuses the shared classifier so
// rule severity stays in lockstep with input coloring + history badges.
// ─────────────────────────────────────────────────────────────────────────────

function buildVitalsAlerts(): AlertRule[] {
  return [
    vitalsCriticalRule({
      id: "vitals.bp.critical",
      label: "BP critical (≥180 systolic or ≥120 diastolic)",
      vitalType: "bp",
      message: (p) =>
        `BP ${num(p.systolic) ?? "?"}/${num(p.diastolic) ?? "?"} — hypertensive crisis`,
      detail: () => "Systolic ≥180 or diastolic ≥120. Notify nurse / 911 per facility protocol.",
    }),
    vitalsCriticalRule({
      id: "vitals.pulse.critical",
      label: "Pulse critical (<50 or >120 bpm)",
      vitalType: "pulse",
      message: (p) => `Pulse ${num(p.value) ?? "?"} bpm — bradycardia/tachycardia`,
      detail: () => "Pulse outside 50–120 bpm. Reassess and document decision.",
    }),
    vitalsCriticalRule({
      id: "vitals.temperature.critical",
      label: "Temperature critical (>103°F or <95°F)",
      vitalType: "temperature",
      message: (p) =>
        `Temp ${num(p.value) ?? "?"}°${p.unit === "C" ? "C" : "F"} — fever or hypothermic`,
      detail: () => "Outside 95–103°F. Hydration check, cooling measures, notify nurse.",
    }),
    vitalsCriticalRule({
      id: "vitals.oxygen.critical",
      label: "O₂ saturation critical (<90%)",
      vitalType: "oxygen",
      message: (p) => `O₂ ${num(p.value) ?? "?"}% — significant hypoxia`,
      detail: () => "Below 90%. Reposition, supplemental O₂, escalate to nurse.",
    }),
    vitalsCriticalRule({
      id: "vitals.glucose.critical",
      label: "Glucose critical (<70 or >250 mg/dL)",
      vitalType: "glucose",
      message: (p) => `Glucose ${num(p.value) ?? "?"} mg/dL — hypo/hyperglycemia`,
      detail: () => "Outside 70–250 mg/dL. Follow facility hypo/hyperglycemia protocol.",
    }),
    vitalsCriticalRule({
      id: "vitals.respiratory.critical",
      label: "Respiratory rate critical (<8 or >30 rpm)",
      vitalType: "respiratory",
      message: (p) => `Resp ${num(p.value) ?? "?"} rpm — distress`,
      detail: () => "Outside 8–30 rpm. Auscultate, document, escalate.",
    }),
    vitalsCriticalRule({
      id: "vitals.pain.critical",
      label: "Pain severe (≥8/10)",
      vitalType: "pain",
      message: (p) => `Pain ${num(p.value) ?? "?"}/10 — severe`,
      detail: () => "Document, notify nurse, follow PRN pain protocol.",
    }),
  ];
}
