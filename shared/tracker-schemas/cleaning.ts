/**
 * Cleaning tracker definition + payload schema.
 *
 * Facility-ops, event-style, `requiresResident: false` — entries log a
 * cleaning task completion in a specific zone of the facility, per shift.
 *
 * Status follows the C/I/NA convention used by the daily-care trackers (ADL,
 * Hygiene, Sleep) so caregivers don't learn a new vocabulary between tracker
 * categories.
 */

import { z } from "zod";

import {
  shiftSchema,
  type HistorySummary,
  type HistoryTone,
  type TrackerDefinition,
} from "./tracker-types";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary.
// ─────────────────────────────────────────────────────────────────────────────

export const CLEANING_ZONES = [
  "kitchen",
  "dining_room",
  "common_area",
  "hallway",
  "restroom",
  "bedroom",
  "laundry",
  "outdoor",
  "other",
] as const;
export type CleaningZone = (typeof CLEANING_ZONES)[number];

const CLEANING_ZONE_LABEL: Record<CleaningZone, string> = {
  kitchen: "Kitchen",
  dining_room: "Dining room",
  common_area: "Common area",
  hallway: "Hallway",
  restroom: "Restroom",
  bedroom: "Bedroom",
  laundry: "Laundry",
  outdoor: "Outdoor",
  other: "Other",
};

export const CLEANING_TASKS = [
  "vacuum",
  "mop",
  "sanitize",
  "dust",
  "trash",
  "laundry",
  "deep_clean",
  "other",
] as const;
export type CleaningTask = (typeof CLEANING_TASKS)[number];

const CLEANING_TASK_LABEL: Record<CleaningTask, string> = {
  vacuum: "Vacuum",
  mop: "Mop",
  sanitize: "Sanitize",
  dust: "Dust",
  trash: "Trash / waste",
  laundry: "Laundry",
  deep_clean: "Deep clean",
  other: "Other",
};

export const CLEANING_STATUS_VALUES = ["C", "I", "NA"] as const;
export type CleaningStatus = (typeof CLEANING_STATUS_VALUES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Payload schema.
// ─────────────────────────────────────────────────────────────────────────────

export const cleaningEntryPayloadSchema = z.object({
  zone: z.enum(CLEANING_ZONES),
  task: z.enum(CLEANING_TASKS),
  status: z.enum(CLEANING_STATUS_VALUES),
  shift: shiftSchema,
  note: z.string().max(500).optional(),
});
export type CleaningEntryPayload = z.infer<typeof cleaningEntryPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// CLEANING_DEFINITION
// ─────────────────────────────────────────────────────────────────────────────

export const CLEANING_DEFINITION: TrackerDefinition = {
  slug: "cleaning",
  name: "Cleaning",
  shortName: "Cleaning",
  category: "facility-ops",
  schemaVersion: 1,
  icon: "Droplets",
  description:
    "Log facility cleaning tasks per zone per shift — kitchen, dining, common areas, restrooms.",
  modes: ["detailed", "history"],
  defaultMode: "detailed",
  detailedFields: [
    {
      kind: "select",
      name: "zone",
      label: "Zone",
      required: true,
      options: CLEANING_ZONES.map((v) => ({
        value: v,
        label: CLEANING_ZONE_LABEL[v],
      })),
    },
    {
      kind: "select",
      name: "task",
      label: "Task",
      required: true,
      options: CLEANING_TASKS.map((v) => ({
        value: v,
        label: CLEANING_TASK_LABEL[v],
      })),
    },
    { kind: "shift", name: "shift", label: "Shift", required: true },
    {
      kind: "select",
      name: "status",
      label: "Status",
      required: true,
      options: CLEANING_STATUS_VALUES.map((v) => ({
        value: v,
        label:
          v === "C" ? "Completed" : v === "I" ? "Incomplete" : "Not Applicable",
      })),
    },
    {
      kind: "textarea",
      name: "note",
      label: "Note",
      required: false,
      maxLength: 500,
    },
  ],
  payloadSchema: cleaningEntryPayloadSchema,
  historySummary: cleaningHistorySummary,
  requiresResident: false,
  supportsBulk: false,
  shiftAware: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// History summary — tone follows status, mirroring Hygiene/Sleep semantics.
// ─────────────────────────────────────────────────────────────────────────────

const STATUS_TONE: Record<CleaningStatus, HistoryTone> = {
  C: "normal",
  I: "elevated",
  NA: "info",
};

const STATUS_LABEL: Record<CleaningStatus, string> = {
  C: "Completed",
  I: "Incomplete",
  NA: "Not Applicable",
};

export function cleaningHistorySummary(payload: unknown): HistorySummary {
  if (typeof payload !== "object" || payload === null) {
    return { primary: "Cleaning (unknown)" };
  }
  const p = payload as Record<string, unknown>;
  const zone =
    typeof p.zone === "string" ? (p.zone as CleaningZone) : undefined;
  const task =
    typeof p.task === "string" ? (p.task as CleaningTask) : undefined;
  const status =
    typeof p.status === "string" ? (p.status as CleaningStatus) : undefined;
  const note =
    typeof p.note === "string" && p.note.trim() !== "" ? p.note.trim() : undefined;

  const zoneLabel = zone ? CLEANING_ZONE_LABEL[zone] ?? zone : "—";
  const taskLabel = task ? CLEANING_TASK_LABEL[task] ?? task : "—";
  const statusLabel = status ? STATUS_LABEL[status] ?? status : "?";
  const tone = status ? STATUS_TONE[status] : "info";

  const primary = note
    ? `${zoneLabel} · ${taskLabel} · ${statusLabel} — “${truncate(note, 80)}”`
    : `${zoneLabel} · ${taskLabel} · ${statusLabel}`;

  return { primary, tone };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
