/**
 * ADL (Activities of Daily Living) tracker definition + payload schema.
 *
 * The 8 ADL goal IDs below are the canonical list. They map 1:1 to the
 * boolean/applicability columns on `ops_resident_assessments` so a future
 * helper (Phase C, backend-engineer) can resolve which ADL goals apply to
 * which residents. That helper is NOT implemented here.
 *
 * Status vocabulary: "C" = Completed, "I" = Incomplete, "NA" = Not Applicable.
 */

import { z } from "zod";

import {
  shiftSchema,
  type HistorySummary,
  type TrackerDefinition,
} from "./tracker-types";

// ─────────────────────────────────────────────────────────────────────────────
// Canonical ADL goals. Each id corresponds to a column on
// ops_resident_assessments (Phase C will use this for the lookup helper).
// ─────────────────────────────────────────────────────────────────────────────

export const ADL_GOAL_IDS = [
  "bathing",
  "dressing",
  "grooming",
  "toileting",
  "continence",
  "eating",
  "mobility",
  "transfers",
] as const;

export type AdlGoalId = (typeof ADL_GOAL_IDS)[number];

export const ADL_STATUS_VALUES = ["C", "I", "NA"] as const;
export type AdlStatus = (typeof ADL_STATUS_VALUES)[number];

// ─────────────────────────────────────────────────────────────────────────────
// Payload schema — what gets stored in tracker_entries.payload (JSON).
// Resident, occurred_at, reported_by_* etc. live on tracker_entries columns;
// the payload only carries the tracker-specific shape.
// ─────────────────────────────────────────────────────────────────────────────

export const adlEntryPayloadSchema = z.object({
  goal_id: z.string().min(1),
  shift: shiftSchema,
  status: z.enum(ADL_STATUS_VALUES),
  note: z.string().max(500).optional(),
});
export type AdlEntryPayload = z.infer<typeof adlEntryPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// ADL_DEFINITION — the single source of truth for how the ADL tracker renders
// and validates. Imported by Phase C (server registry seeding) and Phase D
// (client tracker shell).
// ─────────────────────────────────────────────────────────────────────────────

export const ADL_DEFINITION: TrackerDefinition = {
  slug: "adl",
  name: "Activities of Daily Living",
  shortName: "ADL",
  category: "daily-care",
  schemaVersion: 1,
  icon: "ListChecks",
  description:
    "Document daily living tasks and ISP goal performance per shift.",
  modes: ["quick", "detailed", "history"],
  defaultMode: "quick",
  quickGrid: {
    rowSource: "goals-inline",
    rows: [
      { id: "bathing",    label: "Bathing" },
      { id: "dressing",   label: "Dressing" },
      { id: "grooming",   label: "Grooming" },
      { id: "toileting",  label: "Toileting" },
      { id: "continence", label: "Continence" },
      { id: "eating",     label: "Eating" },
      { id: "mobility",   label: "Mobility" },
      { id: "transfers",  label: "Transfers" },
    ],
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
    {
      kind: "resident",
      name: "residentId",
      label: "Resident",
      required: true,
    },
    {
      kind: "goal",
      name: "goal_id",
      label: "ADL Goal",
      required: true,
      goalsRef: "inline",
    },
    {
      kind: "shift",
      name: "shift",
      label: "Shift",
      required: true,
    },
    {
      kind: "select",
      name: "status",
      label: "Status",
      required: true,
      options: [
        { value: "C",  label: "Completed" },
        { value: "I",  label: "Incomplete" },
        { value: "NA", label: "Not Applicable" },
      ],
    },
    {
      kind: "textarea",
      name: "note",
      label: "Note",
      required: false,
      maxLength: 500,
    },
  ],
  payloadSchema: adlEntryPayloadSchema,
  historySummary: adlHistorySummary,
  requiresResident: true,
  supportsBulk: true,
  shiftAware: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// History summary — promotes the goal label + status, surfaces the optional
// note prominently when present (the most common reason caregivers attach a
// note is a refusal — surveyors and admins want that visible at a glance).
// ─────────────────────────────────────────────────────────────────────────────

const ADL_GOAL_LABEL: Record<string, string> = {
  bathing:    "Bathing",
  dressing:   "Dressing",
  grooming:   "Grooming",
  toileting:  "Toileting",
  continence: "Continence",
  eating:     "Eating",
  mobility:   "Mobility",
  transfers:  "Transfers",
};

const ADL_STATUS_LABEL: Record<string, string> = {
  C:  "Completed",
  I:  "Incomplete",
  NA: "Not Applicable",
};

export function adlHistorySummary(payload: unknown): HistorySummary {
  if (typeof payload !== "object" || payload === null) {
    return { primary: "ADL (unknown)" };
  }
  const p = payload as Record<string, unknown>;
  const goalId = typeof p.goal_id === "string" ? p.goal_id : undefined;
  const status = typeof p.status === "string" ? p.status : undefined;
  const note =
    typeof p.note === "string" && p.note.trim() !== "" ? p.note.trim() : undefined;

  const goalLabel = goalId
    ? ADL_GOAL_LABEL[goalId] ?? goalId
    : "ADL goal";
  const statusLabel = status
    ? ADL_STATUS_LABEL[status] ?? status
    : "?";

  // Tone follows status — Incomplete reads as elevated for the same reason
  // the cell is amber in the grid.
  const tone =
    status === "I" ? "elevated" : status === "NA" ? "info" : "normal";

  // When a note is attached, fold it into the primary line — short notes
  // don't deserve a separate row, and surveyors scan for them in the
  // headline field.
  const primary = note
    ? `${goalLabel} · ${statusLabel} — “${truncate(note, 80)}”`
    : `${goalLabel} · ${statusLabel}`;

  return { primary, tone };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
