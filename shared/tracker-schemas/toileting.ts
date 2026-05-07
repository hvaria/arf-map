/**
 * Toileting tracker definition + payload schema.
 *
 * Daily-care tracker. Detailed-only (one event per save). Two event types via
 * a discriminated union: `bm` (with Bristol scale) and `urine` (with color +
 * output + smell + method). Specialized client renderers `BristolScale` and
 * `UrineColorScale` provide the tap-to-pick UI.
 */

import { z } from "zod";

import {
  type HistorySummary,
  type HistoryTone,
  type TrackerDefinition,
} from "./tracker-types";

// ─────────────────────────────────────────────────────────────────────────────
// Bristol Stool Chart (1..7).
// ─────────────────────────────────────────────────────────────────────────────

export const BRISTOL_TYPES = [1, 2, 3, 4, 5, 6, 7] as const;
export type BristolType = (typeof BRISTOL_TYPES)[number];

export interface BristolMeta {
  type: BristolType;
  title: string;
  description: string;
  /** Heuristic — used by the renderer for color tinting and the history tab. */
  category: "constipation" | "normal" | "loose";
}

export const BRISTOL_META: Record<BristolType, BristolMeta> = {
  1: {
    type: 1,
    title: "Hard lumps",
    description: "Severe constipation",
    category: "constipation",
  },
  2: {
    type: 2,
    title: "Sausage-shaped, lumpy",
    description: "Mild constipation",
    category: "constipation",
  },
  3: {
    type: 3,
    title: "Sausage with cracks",
    description: "Normal",
    category: "normal",
  },
  4: {
    type: 4,
    title: "Smooth sausage / snake",
    description: "Ideal",
    category: "normal",
  },
  5: {
    type: 5,
    title: "Soft blobs with edges",
    description: "Lacking fiber",
    category: "loose",
  },
  6: {
    type: 6,
    title: "Fluffy mushy",
    description: "Mild diarrhea",
    category: "loose",
  },
  7: {
    type: 7,
    title: "Watery liquid",
    description: "Severe diarrhea",
    category: "loose",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Urine color scale (1..7).
// ─────────────────────────────────────────────────────────────────────────────

export const URINE_COLORS = [
  "clear",
  "light_yellow",
  "yellow",
  "dark_yellow",
  "amber",
  "brown",
  "red",
] as const;
export type UrineColor = (typeof URINE_COLORS)[number];

export interface UrineColorMeta {
  value: UrineColor;
  title: string;
  description: string;
  /** Hex used by the renderer swatch. */
  hex: string;
  category: "good" | "ok" | "warning" | "alert";
}

export const URINE_COLOR_META: Record<UrineColor, UrineColorMeta> = {
  clear: {
    value: "clear",
    title: "Clear",
    description: "Very good hydration",
    hex: "#F8FBFF",
    category: "good",
  },
  light_yellow: {
    value: "light_yellow",
    title: "Light yellow",
    description: "Good",
    hex: "#FCF4B7",
    category: "good",
  },
  yellow: {
    value: "yellow",
    title: "Yellow",
    description: "Normal",
    hex: "#F8E16C",
    category: "ok",
  },
  dark_yellow: {
    value: "dark_yellow",
    title: "Dark yellow",
    description: "Light dehydration",
    hex: "#E5B528",
    category: "ok",
  },
  amber: {
    value: "amber",
    title: "Amber",
    description: "Dehydrated",
    hex: "#C28100",
    category: "warning",
  },
  brown: {
    value: "brown",
    title: "Brown",
    description: "Very dehydrated",
    hex: "#7A4A1F",
    category: "warning",
  },
  red: {
    value: "red",
    title: "Red",
    description: "Severe — alert",
    hex: "#A21F1F",
    category: "alert",
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Other urine fields.
// ─────────────────────────────────────────────────────────────────────────────

export const URINE_OUTPUTS = ["small", "medium", "large"] as const;
export type UrineOutput = (typeof URINE_OUTPUTS)[number];

export const URINE_SMELLS = ["normal", "strong", "foul"] as const;
export type UrineSmell = (typeof URINE_SMELLS)[number];

export const URINE_METHODS = [
  "toilet",
  "brief",
  "commode",
  "catheter",
  "urinal",
  "ostomy",
] as const;
export type UrineMethod = (typeof URINE_METHODS)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Payload schemas (Zod discriminated union on `event_type`).
// ─────────────────────────────────────────────────────────────────────────────

const noteField = z.string().max(500).optional();

export const toiletingBmPayloadSchema = z.object({
  event_type: z.literal("bm"),
  bristol: z
    .number()
    .int()
    .min(1)
    .max(7)
    .refine((n): n is BristolType =>
      (BRISTOL_TYPES as readonly number[]).includes(n),
    ),
  note: noteField,
});

export const toiletingUrinePayloadSchema = z.object({
  event_type: z.literal("urine"),
  color: z.enum(URINE_COLORS),
  output: z.enum(URINE_OUTPUTS),
  smell: z.enum(URINE_SMELLS),
  method: z.enum(URINE_METHODS),
  note: noteField,
});

export const toiletingEntryPayloadSchema = z.discriminatedUnion("event_type", [
  toiletingBmPayloadSchema,
  toiletingUrinePayloadSchema,
]);
export type ToiletingEntryPayload = z.infer<
  typeof toiletingEntryPayloadSchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// TOILETING_DEFINITION
// ─────────────────────────────────────────────────────────────────────────────

export const TOILETING_DEFINITION: TrackerDefinition = {
  slug: "toileting",
  name: "Toileting",
  shortName: "Toileting",
  category: "daily-care",
  schemaVersion: 1,
  icon: "Droplets",
  description:
    "Log bowel and bladder events with Bristol scale and urine color guidance.",
  modes: ["detailed", "history"],
  defaultMode: "detailed",
  renderer: "toileting",
  detailedFields: [
    {
      kind: "resident",
      name: "residentId",
      label: "Resident",
      required: true,
    },
    {
      kind: "select",
      name: "event_type",
      label: "Event type",
      required: true,
      options: [
        { value: "bm", label: "Bowel movement" },
        { value: "urine", label: "Urine" },
      ],
    },
    {
      kind: "datetime",
      name: "occurredAt",
      label: "Occurred at",
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
  payloadSchema: toiletingEntryPayloadSchema,
  historySummary: toiletingHistorySummary,
  requiresResident: true,
  supportsBulk: false,
  shiftAware: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// History summary — used by the History tab "what happened" cell and the
// Versions drawer per-version preview. Bristol type 7 (watery) and urine
// "amber"/"brown"/"red" surface as warning/critical badges so dehydration and
// possible diarrhea/UTI patterns pop out at a glance.
// ─────────────────────────────────────────────────────────────────────────────

const URINE_TONE: Record<UrineColorMeta["category"], HistoryTone> = {
  good: "normal",
  ok: "normal",
  warning: "elevated",
  alert: "critical",
};

const BRISTOL_TONE: Record<"constipation" | "normal" | "loose", HistoryTone> = {
  normal: "normal",
  constipation: "elevated",
  loose: "elevated",
};

export function toiletingHistorySummary(payload: unknown): HistorySummary {
  if (typeof payload !== "object" || payload === null) {
    return { primary: "Toileting (unknown)" };
  }
  const p = payload as Record<string, unknown>;
  const event = typeof p.event_type === "string" ? p.event_type : undefined;

  if (event === "bm") {
    const t = typeof p.bristol === "number" ? (p.bristol as BristolType) : undefined;
    if (!t || !BRISTOL_META[t]) return { primary: "BM (unspecified)" };
    const meta = BRISTOL_META[t];
    return {
      primary: `BM · Bristol Type ${t} — ${meta.title}`,
      badge:
        t === 7
          ? "Severe diarrhea"
          : t === 1
            ? "Severe constipation"
            : meta.category === "normal"
              ? "Normal"
              : meta.category === "constipation"
                ? "Constipation"
                : "Loose",
      tone:
        t === 7 || t === 1 ? "critical" : BRISTOL_TONE[meta.category],
    };
  }

  if (event === "urine") {
    const color = typeof p.color === "string" ? p.color : undefined;
    const output = typeof p.output === "string" ? p.output : undefined;
    const meta = color ? URINE_COLOR_META[color as UrineColor] : undefined;
    const colorLabel = meta?.title ?? color ?? "unknown";
    const primary = output
      ? `Urine · ${colorLabel} (${output})`
      : `Urine · ${colorLabel}`;
    if (!meta) return { primary };
    return {
      primary,
      badge: meta.description,
      tone: URINE_TONE[meta.category] ?? "info",
    };
  }

  return { primary: "Toileting" };
}
