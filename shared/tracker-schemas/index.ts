/**
 * Tracker registry — public entry point for the Tracker Module config system.
 *
 * Phase B foundation ships exactly one tracker (ADL). Adding trackers 2..25
 * is a matter of importing the new definition and appending it to
 * `TRACKER_REGISTRY` below.
 */

import type { ZodTypeAny } from "zod";

import {
  ADL_DEFINITION,
  adlEntryPayloadSchema,
} from "./adl";
import {
  serializeDefinitionForClient,
  type SerializedTrackerDefinition,
  type TrackerDefinition,
} from "./tracker-types";

// Re-export the core types/helpers so consumers only need to import from
// "@shared/tracker-schemas" (or "../shared/tracker-schemas" on the server).
export * from "./tracker-types";
export { adlEntryPayloadSchema, ADL_DEFINITION } from "./adl";
export type { AdlEntryPayload, AdlGoalId, AdlStatus } from "./adl";
export { ADL_GOAL_IDS, ADL_STATUS_VALUES } from "./adl";

// ─────────────────────────────────────────────────────────────────────────────
// Registry
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Slug → definition lookup. Keep this as the single source of truth: any new
 * tracker must be appended here for it to be visible to the runtime.
 */
export const TRACKER_REGISTRY: Record<string, TrackerDefinition> = {
  adl: ADL_DEFINITION,
};

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
