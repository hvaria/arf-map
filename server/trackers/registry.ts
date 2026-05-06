/**
 * Server-side shim over the shared tracker registry.
 *
 * All server modules import the registry through this file rather than
 * reaching into `@shared/tracker-schemas` directly. Keeping the dependency
 * funneled through one path makes it easy to swap (or extend) the registry
 * source later without touching every consumer.
 */

export {
  TRACKER_REGISTRY,
  getDefinition,
  listDefinitions,
  getPayloadSchema,
  listSerializedDefinitions,
  serializeDefinitionForClient,
} from "@shared/tracker-schemas";

export type {
  TrackerDefinition,
  SerializedTrackerDefinition,
  TrackerCategory,
  Shift,
} from "@shared/tracker-schemas";
