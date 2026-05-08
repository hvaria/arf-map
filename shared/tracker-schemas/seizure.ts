/**
 * Seizure tracker definition + payload schema.
 *
 * Health-clinical, event-style — one seizure event per entry. Modeled on the
 * Skin Check pattern (`modes: ["detailed", "history"]`, no Quick grid,
 * declarative `detailedFields`, conditional-required validation in
 * `superRefine`).
 *
 * Critical-alert rule fires on:
 *   - `duration_seconds >= 300` (status epilepticus per clinical guidance), OR
 *   - `seizure_type === "status_epilepticus"`.
 *
 * Cluster detection (3+ seizures in 24h) is deferred — the alerts evaluator
 * supports `payload-matches` only in v1; cross-entry cron rules are v2 per
 * the header comment on shared/tracker-schemas/alerts.ts. v1 also defers
 * video/photo capture (same call as deferred Skin Check photos and deferred
 * facility logo).
 */

import { z } from "zod";

import { type AlertRule } from "./alerts";
import {
  shiftSchema,
  type HistorySummary,
  type HistoryTone,
  type TrackerDefinition,
} from "./tracker-types";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary — ILAE 2017 simplified.
// ─────────────────────────────────────────────────────────────────────────────

export const SEIZURE_TYPES = [
  "focal_aware",
  "focal_impaired",
  "generalized_tonic_clonic",
  "generalized_absence",
  "generalized_atonic",
  "generalized_myoclonic",
  "status_epilepticus",
  "unknown",
] as const;
export type SeizureType = (typeof SEIZURE_TYPES)[number];

const SEIZURE_TYPE_LABEL: Record<SeizureType, string> = {
  focal_aware: "Focal aware",
  focal_impaired: "Focal impaired awareness",
  generalized_tonic_clonic: "Generalized tonic-clonic",
  generalized_absence: "Generalized absence",
  generalized_atonic: "Generalized atonic",
  generalized_myoclonic: "Generalized myoclonic",
  status_epilepticus: "Status epilepticus",
  unknown: "Unknown",
};

// ─────────────────────────────────────────────────────────────────────────────
// Clinical thresholds (seconds). Mirrored in the alert rule and history-summary
// tone classification — keep these constants together so adjustments stay in
// lockstep.
// ─────────────────────────────────────────────────────────────────────────────

export const SEIZURE_STATUS_EPILEPTICUS_SECS = 300; // 5 min
export const SEIZURE_PROLONGED_SECS = 120; // 2 min

// ─────────────────────────────────────────────────────────────────────────────
// Payload schema. Conditional-required fields enforced server-side via
// superRefine — the form layer is not the source of truth.
// ─────────────────────────────────────────────────────────────────────────────

export const seizureEntryPayloadSchema = z
  .object({
    seizure_type: z.enum(SEIZURE_TYPES),
    duration_seconds: z.number().int().nonnegative(),
    shift: shiftSchema,
    witnessed: z.enum(["yes", "no"]),
    rescue_med_given: z.enum(["yes", "no"]).optional(),
    intervention: z.string().max(500).optional(),
    injury: z.enum(["yes", "no"]).optional(),
    supervisor_notified: z.enum(["yes", "no"]),
    note: z.string().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    const triggersIntervention =
      v.rescue_med_given === "yes" ||
      v.duration_seconds >= SEIZURE_STATUS_EPILEPTICUS_SECS ||
      v.seizure_type === "status_epilepticus";
    if (triggersIntervention) {
      if (!v.intervention || v.intervention.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "intervention is required when a rescue med was given or duration ≥ 5 min (status epilepticus)",
          path: ["intervention"],
        });
      }
    }
  });

export type SeizureEntryPayload = z.infer<typeof seizureEntryPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Alert rule — critical on status epilepticus. Manual acknowledgement.
// ─────────────────────────────────────────────────────────────────────────────

const seizureStatusEpilepticusRule: AlertRule = {
  id: "seizure-status-epilepticus",
  defaultSeverity: "critical",
  label: "Seizure — status epilepticus",
  evaluate(payload) {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;
    const duration =
      typeof p.duration_seconds === "number" ? p.duration_seconds : -1;
    const seizureType =
      typeof p.seizure_type === "string" ? p.seizure_type : "";
    const isStatus =
      duration >= SEIZURE_STATUS_EPILEPTICUS_SECS ||
      seizureType === "status_epilepticus";
    if (!isStatus) return null;
    const typeLabel =
      SEIZURE_TYPE_LABEL[seizureType as SeizureType] ?? "seizure";
    return {
      ruleId: "seizure-status-epilepticus",
      severity: "critical",
      message: `Status epilepticus · ${typeLabel} (${formatDuration(duration)})`,
      detail:
        "Seizure ≥ 5 minutes meets clinical status-epilepticus criteria. Confirm rescue med, EMS, supervisor, and family notification — and open an incident if not already filed.",
      autoResolveOnNextEntry: false,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SEIZURE_DEFINITION
// ─────────────────────────────────────────────────────────────────────────────

export const SEIZURE_DEFINITION: TrackerDefinition = {
  slug: "seizure",
  name: "Seizure",
  shortName: "Seizure",
  category: "health-clinical",
  schemaVersion: 1,
  icon: "Activity",
  description:
    "Document seizure events per resident — type, duration, witness, intervention, and post-event response.",
  modes: ["detailed", "history"],
  defaultMode: "detailed",
  detailedFields: [
    { kind: "resident", name: "residentId", label: "Resident", required: true },
    { kind: "shift", name: "shift", label: "Shift", required: true },
    {
      kind: "select",
      name: "seizure_type",
      label: "Seizure type",
      required: true,
      options: SEIZURE_TYPES.map((v) => ({
        value: v,
        label: SEIZURE_TYPE_LABEL[v],
      })),
    },
    {
      kind: "number",
      name: "duration_seconds",
      label: "Duration (seconds)",
      required: true,
      min: 0,
      step: 1,
      unit: "sec",
      helpText: "5 min = 300 sec = status epilepticus.",
    },
    {
      kind: "select",
      name: "witnessed",
      label: "Witnessed",
      required: true,
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    },
    {
      kind: "select",
      name: "rescue_med_given",
      label: "Rescue medication given",
      required: false,
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    },
    {
      kind: "textarea",
      name: "intervention",
      label: "Intervention",
      required: false,
      helpText:
        "Required when a rescue med was given or duration ≥ 5 minutes.",
      maxLength: 500,
    },
    {
      kind: "select",
      name: "injury",
      label: "Injury during event",
      required: false,
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
      ],
    },
    {
      kind: "select",
      name: "supervisor_notified",
      label: "Supervisor notified",
      required: true,
      options: [
        { value: "yes", label: "Yes" },
        { value: "no", label: "No" },
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
  payloadSchema: seizureEntryPayloadSchema,
  historySummary: seizureHistorySummary,
  alerts: [seizureStatusEpilepticusRule],
  requiresResident: true,
  supportsBulk: false,
  shiftAware: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// History summary
// ─────────────────────────────────────────────────────────────────────────────

function classifyTone(
  durationSeconds: number,
  seizureType: SeizureType | undefined,
): HistoryTone {
  if (
    durationSeconds >= SEIZURE_STATUS_EPILEPTICUS_SECS ||
    seizureType === "status_epilepticus"
  ) {
    return "critical";
  }
  if (durationSeconds >= SEIZURE_PROLONGED_SECS) return "elevated";
  return "info";
}

export function seizureHistorySummary(payload: unknown): HistorySummary {
  if (typeof payload !== "object" || payload === null) {
    return { primary: "Seizure (unknown)" };
  }
  const p = payload as Record<string, unknown>;

  const seizureType =
    typeof p.seizure_type === "string"
      ? (p.seizure_type as SeizureType)
      : undefined;
  const duration =
    typeof p.duration_seconds === "number" ? p.duration_seconds : -1;
  const note =
    typeof p.note === "string" && p.note.trim() !== "" ? p.note.trim() : undefined;

  const typeLabel = seizureType
    ? SEIZURE_TYPE_LABEL[seizureType] ?? seizureType
    : "Seizure";
  const durationLabel = duration >= 0 ? formatDuration(duration) : "—";
  const tone = classifyTone(duration, seizureType);

  const badge =
    tone === "critical"
      ? "Status epilepticus"
      : tone === "elevated"
        ? "Prolonged"
        : undefined;

  const primary = note
    ? `${typeLabel} · ${durationLabel} — “${truncate(note, 80)}”`
    : `${typeLabel} · ${durationLabel}`;

  return { primary, tone, badge };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  if (seconds < 0) return "—";
  if (seconds < 60) return `${seconds} sec`;
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (remainder === 0) return `${minutes} min`;
  return `${minutes} min ${remainder} sec`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
