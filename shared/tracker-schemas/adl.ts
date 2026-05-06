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
  requiresResident: true,
  supportsBulk: true,
  shiftAware: true,
};
