/**
 * Sleep tracker definition + payload schema.
 *
 * Daily-care, grid-style — Hygiene clone with sleep-specific goals. The
 * caregiver marks each goal C/I/NA per shift per resident; rich
 * measurements (duration in hours, awakening count, quality scale) are
 * deferred to v2 to keep the v1 shape congruent with the existing shell.
 *
 * No alert rule in v1: a meaningful sleep alert would be cluster-style
 * (e.g. ≥3 disturbed nights in 7 days), and the alerts evaluator only
 * supports per-payload rules until cron evaluation lands (see header
 * comment on shared/tracker-schemas/alerts.ts).
 */

import { z } from "zod";

import {
  shiftSchema,
  type HistorySummary,
  type TrackerDefinition,
} from "./tracker-types";

// ─────────────────────────────────────────────────────────────────────────────
// Canonical sleep goals.
// ─────────────────────────────────────────────────────────────────────────────

export const SLEEP_GOAL_IDS = [
  "bedtime_routine",
  "slept_through",
  "restful",
  "no_wandering",
  "woke_independently",
] as const;
export type SleepGoalId = (typeof SLEEP_GOAL_IDS)[number];

const SLEEP_GOAL_LABEL: Record<SleepGoalId, string> = {
  bedtime_routine: "Bedtime routine completed",
  slept_through: "Slept through scheduled hours",
  restful: "Appeared restful",
  no_wandering: "No nighttime wandering",
  woke_independently: "Woke independently",
};

export const SLEEP_STATUS_VALUES = ["C", "I", "NA"] as const;
export type SleepStatus = (typeof SLEEP_STATUS_VALUES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Payload schema.
// ─────────────────────────────────────────────────────────────────────────────

export const sleepEntryPayloadSchema = z.object({
  goal_id: z.string().min(1),
  shift: shiftSchema,
  status: z.enum(SLEEP_STATUS_VALUES),
  note: z.string().max(500).optional(),
});
export type SleepEntryPayload = z.infer<typeof sleepEntryPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// SLEEP_DEFINITION
// ─────────────────────────────────────────────────────────────────────────────

export const SLEEP_DEFINITION: TrackerDefinition = {
  slug: "sleep",
  name: "Sleep",
  shortName: "Sleep",
  category: "daily-care",
  schemaVersion: 1,
  icon: "Bed",
  description:
    "Track sleep observations per resident per shift — bedtime routine, continuity, and overnight behavior.",
  modes: ["quick", "detailed", "history"],
  defaultMode: "quick",
  quickGrid: {
    rowSource: "goals-inline",
    rows: SLEEP_GOAL_IDS.map((id) => ({
      id,
      label: SLEEP_GOAL_LABEL[id],
    })),
    columnSource: "residents",
    cellCycle: ["C", "I", "NA"],
    cellLabels: {
      C: "Completed",
      I: "Incomplete",
      NA: "Not Applicable",
    },
    cellColors: {
      C: "success",
      I: "warn",
      NA: "muted",
    },
  },
  detailedFields: [
    { kind: "resident", name: "residentId", label: "Resident", required: true },
    {
      kind: "goal",
      name: "goal_id",
      label: "Sleep observation",
      required: true,
      goalsRef: "inline",
    },
    { kind: "shift", name: "shift", label: "Shift", required: true },
    {
      kind: "select",
      name: "status",
      label: "Status",
      required: true,
      options: SLEEP_STATUS_VALUES.map((v) => ({
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
  payloadSchema: sleepEntryPayloadSchema,
  historySummary: sleepHistorySummary,
  requiresResident: true,
  supportsBulk: true,
  shiftAware: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// History summary — mirrors Hygiene/ADL: goal label · status, with the
// optional note folded inline. Tone follows status — Incomplete is elevated
// because a missed bedtime routine or overnight wandering needs visibility.
// ─────────────────────────────────────────────────────────────────────────────

const SLEEP_STATUS_LABEL: Record<string, string> = {
  C: "Completed",
  I: "Incomplete",
  NA: "Not Applicable",
};

export function sleepHistorySummary(payload: unknown): HistorySummary {
  if (typeof payload !== "object" || payload === null) {
    return { primary: "Sleep (unknown)" };
  }
  const p = payload as Record<string, unknown>;
  const goalId = typeof p.goal_id === "string" ? p.goal_id : undefined;
  const status = typeof p.status === "string" ? p.status : undefined;
  const note =
    typeof p.note === "string" && p.note.trim() !== "" ? p.note.trim() : undefined;

  const goalLabel = goalId
    ? SLEEP_GOAL_LABEL[goalId as SleepGoalId] ?? goalId
    : "Sleep observation";
  const statusLabel = status ? SLEEP_STATUS_LABEL[status] ?? status : "?";

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
