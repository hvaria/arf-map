/**
 * Hygiene tracker definition + payload schema.
 *
 * Daily-care tracker; structurally identical to ADL — config-driven proof
 * that adding a routine tracker is purely a registry entry. No specialized
 * renderer needed; the existing QuickEntryGrid + DetailedEntryForm + history
 * shell handle it.
 *
 * Goal vocabulary maps to facility hygiene tasks per shift. Status follows
 * the same C/I/NA convention as ADL so caregivers don't learn a new
 * vocabulary between trackers.
 */

import { z } from "zod";

import {
  shiftSchema,
  type HistorySummary,
  type TrackerDefinition,
} from "./tracker-types";

// ─────────────────────────────────────────────────────────────────────────────
// Canonical hygiene goals.
// ─────────────────────────────────────────────────────────────────────────────

export const HYGIENE_GOAL_IDS = [
  "dental_am",
  "dental_pm",
  "shower",
  "shave",
  "hair_care",
  "skin_check",
  "hand_washing",
] as const;
export type HygieneGoalId = (typeof HYGIENE_GOAL_IDS)[number];

const HYGIENE_GOAL_LABEL: Record<HygieneGoalId, string> = {
  dental_am: "Dental hygiene (AM)",
  dental_pm: "Dental hygiene (PM)",
  shower: "Shower",
  shave: "Shaving",
  hair_care: "Hair care",
  skin_check: "Skin check",
  hand_washing: "Hand washing",
};

export const HYGIENE_STATUS_VALUES = ["C", "I", "NA"] as const;
export type HygieneStatus = (typeof HYGIENE_STATUS_VALUES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Payload schema.
// ─────────────────────────────────────────────────────────────────────────────

export const hygieneEntryPayloadSchema = z.object({
  goal_id: z.string().min(1),
  shift: shiftSchema,
  status: z.enum(HYGIENE_STATUS_VALUES),
  note: z.string().max(500).optional(),
});
export type HygieneEntryPayload = z.infer<typeof hygieneEntryPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// HYGIENE_DEFINITION
// ─────────────────────────────────────────────────────────────────────────────

export const HYGIENE_DEFINITION: TrackerDefinition = {
  slug: "hygiene",
  name: "Hygiene",
  shortName: "Hygiene",
  category: "daily-care",
  schemaVersion: 1,
  icon: "Droplet",
  description:
    "Track daily hygiene tasks per resident per shift — dental, shower, grooming, skin check.",
  modes: ["quick", "detailed", "history"],
  defaultMode: "quick",
  quickGrid: {
    rowSource: "goals-inline",
    rows: HYGIENE_GOAL_IDS.map((id) => ({
      id,
      label: HYGIENE_GOAL_LABEL[id],
    })),
    columnSource: "residents",
    cellCycle: ["C", "I", "NA"],
    cellLabels: {
      C:  "Completed",
      I:  "Incomplete",
      NA: "Not Applicable",
    },
    cellColors: {
      C:  "success",
      I:  "warn",
      NA: "muted",
    },
  },
  detailedFields: [
    { kind: "resident", name: "residentId", label: "Resident", required: true },
    {
      kind: "goal",
      name: "goal_id",
      label: "Hygiene task",
      required: true,
      goalsRef: "inline",
    },
    { kind: "shift", name: "shift", label: "Shift", required: true },
    {
      kind: "select",
      name: "status",
      label: "Status",
      required: true,
      options: HYGIENE_STATUS_VALUES.map((v) => ({
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
  payloadSchema: hygieneEntryPayloadSchema,
  historySummary: hygieneHistorySummary,
  requiresResident: true,
  supportsBulk: true,
  shiftAware: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// History summary — same shape as ADL: goal label, status, note inline.
// ─────────────────────────────────────────────────────────────────────────────

const HYGIENE_STATUS_LABEL: Record<string, string> = {
  C: "Completed",
  I: "Incomplete",
  NA: "Not Applicable",
};

export function hygieneHistorySummary(payload: unknown): HistorySummary {
  if (typeof payload !== "object" || payload === null) {
    return { primary: "Hygiene (unknown)" };
  }
  const p = payload as Record<string, unknown>;
  const goalId = typeof p.goal_id === "string" ? p.goal_id : undefined;
  const status = typeof p.status === "string" ? p.status : undefined;
  const note =
    typeof p.note === "string" && p.note.trim() !== "" ? p.note.trim() : undefined;

  const goalLabel = goalId
    ? HYGIENE_GOAL_LABEL[goalId as HygieneGoalId] ?? goalId
    : "Hygiene task";
  const statusLabel = status
    ? HYGIENE_STATUS_LABEL[status] ?? status
    : "?";

  const tone =
    status === "I" ? "elevated" : status === "NA" ? "info" : "normal";

  const primary = note
    ? `${goalLabel} · ${statusLabel} — “${truncate(note, 80)}”`
    : `${goalLabel} · ${statusLabel}`;

  return { primary, tone };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
