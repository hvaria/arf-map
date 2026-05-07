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

import { type TrackerDefinition } from "./tracker-types";

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
  requiresResident: true,
  supportsBulk: false,
  shiftAware: true,
};
