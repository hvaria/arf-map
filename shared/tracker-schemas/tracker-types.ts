/**
 * Core types for the Tracker Module config system.
 *
 * Each tracker (ADL, Vitals, Food, Hygiene, etc.) is declared as a
 * `TrackerDefinition` config object. The runtime renders generic Quick Grid +
 * Detailed Form UIs from these configs.
 *
 * This file is pure types and helpers — no tracker-specific data.
 *
 * NB: `TrackerDefinition` here is the *config object* type, separate from
 * `TrackerDefinitionRow` (the DB row type defined in
 * server/trackers/trackerSchema.ts and re-exported from shared/schema.ts).
 *
 * The `payloadSchema` field carries a Zod schema and is intentionally NOT
 * JSON-safe. Use `serializeDefinitionForClient` to strip it before sending a
 * definition over the wire — the client imports its own copy of the Zod
 * schema, never deserializes one.
 */

import { z, type ZodTypeAny } from "zod";

// ─────────────────────────────────────────────────────────────────────────────
// Enums (Zod + inferred TS types)
// ─────────────────────────────────────────────────────────────────────────────

export const trackerCategorySchema = z.enum([
  "daily-care",
  "health-clinical",
  "safety-incidents",
  "resident-life",
  "facility-ops",
]);
export type TrackerCategory = z.infer<typeof trackerCategorySchema>;

export const shiftSchema = z.enum(["AM", "PM", "NOC", "OTHER"]);
export type Shift = z.infer<typeof shiftSchema>;

export const trackerEntryStatusSchema = z.enum(["active", "edited", "deleted"]);
export type TrackerEntryStatus = z.infer<typeof trackerEntryStatusSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// FieldDefinition — discriminated union by `kind`
// ─────────────────────────────────────────────────────────────────────────────

const fieldBase = {
  name: z.string().min(1),
  label: z.string().min(1),
  required: z.boolean().optional(),
  helpText: z.string().optional(),
};

const selectOptionSchema = z.object({
  value: z.string().min(1),
  label: z.string().min(1),
});
export type SelectOption = z.infer<typeof selectOptionSchema>;

export const textFieldSchema = z.object({
  kind: z.literal("text"),
  ...fieldBase,
  placeholder: z.string().optional(),
  maxLength: z.number().int().positive().optional(),
});
export type TextField = z.infer<typeof textFieldSchema>;

export const textareaFieldSchema = z.object({
  kind: z.literal("textarea"),
  ...fieldBase,
  placeholder: z.string().optional(),
  maxLength: z.number().int().positive().optional(),
});
export type TextareaField = z.infer<typeof textareaFieldSchema>;

export const numberFieldSchema = z.object({
  kind: z.literal("number"),
  ...fieldBase,
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  unit: z.string().optional(),
});
export type NumberField = z.infer<typeof numberFieldSchema>;

export const selectFieldSchema = z.object({
  kind: z.literal("select"),
  ...fieldBase,
  options: z.array(selectOptionSchema).min(1),
});
export type SelectField = z.infer<typeof selectFieldSchema>;

export const multiselectFieldSchema = z.object({
  kind: z.literal("multiselect"),
  ...fieldBase,
  options: z.array(selectOptionSchema).min(1),
});
export type MultiselectField = z.infer<typeof multiselectFieldSchema>;

export const dateFieldSchema = z.object({
  kind: z.literal("date"),
  ...fieldBase,
});
export type DateField = z.infer<typeof dateFieldSchema>;

export const datetimeFieldSchema = z.object({
  kind: z.literal("datetime"),
  ...fieldBase,
  defaultsToNow: z.boolean().optional(),
});
export type DatetimeField = z.infer<typeof datetimeFieldSchema>;

export const shiftFieldSchema = z.object({
  kind: z.literal("shift"),
  ...fieldBase,
});
export type ShiftField = z.infer<typeof shiftFieldSchema>;

export const residentFieldSchema = z.object({
  kind: z.literal("resident"),
  ...fieldBase,
});
export type ResidentField = z.infer<typeof residentFieldSchema>;

export const goalFieldSchema = z.object({
  kind: z.literal("goal"),
  ...fieldBase,
  goalsRef: z.enum(["inline", "assessments"]),
});
export type GoalField = z.infer<typeof goalFieldSchema>;

export const fieldDefinitionSchema = z.discriminatedUnion("kind", [
  textFieldSchema,
  textareaFieldSchema,
  numberFieldSchema,
  selectFieldSchema,
  multiselectFieldSchema,
  dateFieldSchema,
  datetimeFieldSchema,
  shiftFieldSchema,
  residentFieldSchema,
  goalFieldSchema,
]);
export type FieldDefinition = z.infer<typeof fieldDefinitionSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// QuickGridConfig — describes the Quick Grid for a tracker
// ─────────────────────────────────────────────────────────────────────────────

export const quickGridCellColorSchema = z.enum([
  "success",
  "warn",
  "muted",
  "danger",
]);
export type QuickGridCellColor = z.infer<typeof quickGridCellColorSchema>;

export const quickGridRowSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
});
export type QuickGridRow = z.infer<typeof quickGridRowSchema>;

export const quickGridConfigSchema = z.object({
  rowSource: z.enum(["goals-inline", "assessments-derived"]),
  rows: z.array(quickGridRowSchema).optional(),
  assessmentsField: z.string().optional(),
  columnSource: z.literal("residents"),
  cellCycle: z.array(z.string().min(1)).min(1),
  cellLabels: z.record(z.string()).optional(),
  cellColors: z.record(quickGridCellColorSchema).optional(),
});
export type QuickGridConfig = z.infer<typeof quickGridConfigSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// TrackerDefinition — the central config object
//
// Note: this is *not* a Zod schema. We keep it as a plain TypeScript interface
// because `payloadSchema: ZodTypeAny` is intentionally not JSON-safe. The
// individual config sub-shapes above are validated structurally via Zod where
// useful, but the registry itself is hand-authored TypeScript.
// ─────────────────────────────────────────────────────────────────────────────

export type TrackerMode = "quick" | "detailed" | "history";

export interface TrackerDefinition {
  /** Stable identifier, e.g. "adl". Matches `tracker_definitions.slug`. */
  slug: string;
  /** Human-friendly name, e.g. "Activities of Daily Living". */
  name: string;
  /** Ultra-short label used in compact UIs, e.g. "ADL". */
  shortName?: string;
  category: TrackerCategory;
  /** Bump when payload shape changes incompatibly. */
  schemaVersion: number;
  /** Defaults to true when omitted. */
  isActive?: boolean;
  /** Lucide icon name (e.g. "ListChecks"). Resolved on the client. */
  icon?: string;
  /** Shown on the tracker landing card. */
  description?: string;
  /** Which tabs the tracker shell renders. */
  modes: TrackerMode[];
  defaultMode: "quick" | "detailed";
  /** Required when `modes` includes "quick". */
  quickGrid?: QuickGridConfig;
  /** Always required — also used to render history detail rows. */
  detailedFields: FieldDefinition[];
  /**
   * Server-side payload validator. Stripped before serializing to the client
   * over the wire — see `serializeDefinitionForClient`.
   */
  payloadSchema: ZodTypeAny;
  /** Defaults to true when omitted. Some trackers (Cleaning, Pest) won't require a resident. */
  requiresResident?: boolean;
  /** Defaults to true when `quickGrid` is present. */
  supportsBulk?: boolean;
  /** Defaults to true when omitted. */
  shiftAware?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialization helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The same shape as `TrackerDefinition` minus the non-JSON-safe Zod schema.
 * This is what the wire payload (and the client-side registry view) looks like.
 */
export type SerializedTrackerDefinition = Omit<
  TrackerDefinition,
  "payloadSchema"
>;

/**
 * Strip the Zod `payloadSchema` so the result is JSON-safe. Use this anywhere
 * a `TrackerDefinition` crosses the network or `JSON.stringify` boundary.
 *
 * The client imports its own local copy of every per-tracker Zod schema; it
 * never deserializes a Zod schema from the wire.
 */
export function serializeDefinitionForClient(
  def: TrackerDefinition,
): SerializedTrackerDefinition {
  // Object-rest discard: drop `payloadSchema`, keep everything else.
  const { payloadSchema: _payloadSchema, ...rest } = def;
  void _payloadSchema;
  return rest;
}
