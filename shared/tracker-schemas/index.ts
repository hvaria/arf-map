/**
 * Tracker registry — public entry point for the Tracker Module config system.
 *
 * Adding a new tracker is a matter of importing its definition and appending
 * it to `TRACKER_REGISTRY` below. The server's `seedTrackerDefinitions` loop
 * reads from this registry on boot, and the client's tracker picker reads
 * from the wire-serialized form of it.
 */

import type { ZodTypeAny } from "zod";

import {
  ADL_DEFINITION,
  adlEntryPayloadSchema,
} from "./adl";
import {
  VITALS_DEFINITION,
  vitalsEntryPayloadSchema,
} from "./vitals";
import {
  TOILETING_DEFINITION,
  toiletingEntryPayloadSchema,
} from "./toileting";
import {
  serializeDefinitionForClient,
  type SerializedTrackerDefinition,
  type TrackerDefinition,
} from "./tracker-types";

// Re-export the core types/helpers so consumers only need to import from
// "@shared/tracker-schemas" (or "../shared/tracker-schemas" on the server).
export * from "./tracker-types";
export * from "./alerts";
export * from "./vital-ranges";

// ─── ADL ────────────────────────────────────────────────────────────────────
export { adlEntryPayloadSchema, ADL_DEFINITION } from "./adl";
export type { AdlEntryPayload, AdlGoalId, AdlStatus } from "./adl";
export { ADL_GOAL_IDS, ADL_STATUS_VALUES } from "./adl";

// ─── Vitals ─────────────────────────────────────────────────────────────────
export {
  vitalsEntryPayloadSchema,
  VITALS_DEFINITION,
  VITAL_TYPES,
  VITAL_TYPE_LABEL,
  VITAL_TYPE_UNIT,
} from "./vitals";
export type { VitalType, VitalsEntryPayload } from "./vitals";

// ─── Toileting ──────────────────────────────────────────────────────────────
export {
  toiletingEntryPayloadSchema,
  TOILETING_DEFINITION,
  BRISTOL_TYPES,
  BRISTOL_META,
  URINE_COLORS,
  URINE_COLOR_META,
  URINE_OUTPUTS,
  URINE_SMELLS,
  URINE_METHODS,
} from "./toileting";
export type {
  BristolType,
  BristolMeta,
  UrineColor,
  UrineColorMeta,
  UrineOutput,
  UrineSmell,
  UrineMethod,
  ToiletingEntryPayload,
} from "./toileting";

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Slug → definition lookup. Keep this as the single source of truth: any new
 * tracker must be appended here for it to be visible to the runtime.
 */
export const TRACKER_REGISTRY: Record<string, TrackerDefinition> = {
  adl: ADL_DEFINITION,
  vitals: VITALS_DEFINITION,
  toileting: TOILETING_DEFINITION,
};

// Silence unused-import warnings for re-exports that are surfaced via
// `export *` consumers — referencing them here keeps the bundler honest.
void adlEntryPayloadSchema;
void vitalsEntryPayloadSchema;
void toiletingEntryPayloadSchema;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns every active tracker definition. A tracker is considered active
 * unless `isActive` is explicitly set to `false`.
 */
export function listDefinitions(): TrackerDefinition[] {
  return Object.values(TRACKER_REGISTRY).filter((d) => d.isActive !== false);
}

/** Returns a single tracker definition by slug, or `undefined` if not found. */
export function getDefinition(slug: string): TrackerDefinition | undefined {
  return TRACKER_REGISTRY[slug];
}

/**
 * Returns the per-tracker Zod payload schema (for server-side validation),
 * or `undefined` when the slug is unknown.
 */
export function getPayloadSchema(slug: string): ZodTypeAny | undefined {
  return getDefinition(slug)?.payloadSchema;
}

/**
 * JSON-safe view of every active definition — suitable for sending over the
 * wire to the client (Zod `payloadSchema` is stripped).
 */
export function listSerializedDefinitions(): SerializedTrackerDefinition[] {
  return listDefinitions().map(serializeDefinitionForClient);
}
