/**
 * Skin Check tracker definition + payload schema.
 *
 * Health-clinical tracker, event-style (one observation per entry, no Quick
 * grid). Mirrors the Vitals / Toileting pattern: `modes: ["detailed",
 * "history"]`, no `quickGrid`, declarative `detailedFields` rendered by the
 * generic `DetailedEntryForm`.
 *
 * Two paths via the same form:
 *   - "No concerns observed"  → finding=no_concerns, severity=none. Fast.
 *   - Concern found           → body_site + finding + severity + action.
 *
 * Conditional required-fields are enforced server-side via `superRefine`:
 *   - body_site is required iff finding ≠ no_concerns
 *   - action_taken is required iff severity ∈ {moderate, severe}
 *   - supervisor_notified is required iff severity ∈ {moderate, severe}
 *
 * v1 does not support photo uploads (deferred — same call as the deferred
 * facility logo). Caring-Data-style NPUAP staging is also deferred; v1 uses a
 * simplified minor/moderate/severe scale.
 */

import { z } from "zod";

import {
  type AlertRule,
} from "./alerts";
import {
  type HistorySummary,
  type HistoryTone,
  type TrackerDefinition,
} from "./tracker-types";

// ─────────────────────────────────────────────────────────────────────────────
// Vocabulary
// ─────────────────────────────────────────────────────────────────────────────

export const SKIN_CHECK_FINDING_TYPES = [
  "no_concerns",
  "redness",
  "dryness",
  "rash",
  "bruising",
  "skin_tear",
  "pressure_injury",
  "wound",
  "lesion",
  "other",
] as const;
export type SkinCheckFindingType = (typeof SKIN_CHECK_FINDING_TYPES)[number];

const FINDING_LABEL: Record<SkinCheckFindingType, string> = {
  no_concerns: "No concerns observed",
  redness: "Redness",
  dryness: "Dryness",
  rash: "Rash",
  bruising: "Bruising",
  skin_tear: "Skin tear",
  pressure_injury: "Pressure injury",
  wound: "Wound",
  lesion: "Lesion",
  other: "Other",
};

export const SKIN_CHECK_BODY_SITES = [
  "head",
  "face",
  "neck",
  "chest",
  "back",
  "abdomen",
  "sacrum",
  "buttocks",
  "hip_l",
  "hip_r",
  "arm_l",
  "arm_r",
  "hand_l",
  "hand_r",
  "leg_l",
  "leg_r",
  "foot_l",
  "foot_r",
  "other",
] as const;
export type SkinCheckBodySite = (typeof SKIN_CHECK_BODY_SITES)[number];

const BODY_SITE_LABEL: Record<SkinCheckBodySite, string> = {
  head: "Head",
  face: "Face",
  neck: "Neck",
  chest: "Chest",
  back: "Back",
  abdomen: "Abdomen",
  sacrum: "Sacrum",
  buttocks: "Buttocks",
  hip_l: "Hip (left)",
  hip_r: "Hip (right)",
  arm_l: "Arm (left)",
  arm_r: "Arm (right)",
  hand_l: "Hand (left)",
  hand_r: "Hand (right)",
  leg_l: "Leg (left)",
  leg_r: "Leg (right)",
  foot_l: "Foot (left)",
  foot_r: "Foot (right)",
  other: "Other",
};

export const SKIN_CHECK_SEVERITIES = [
  "none",
  "minor",
  "moderate",
  "severe",
] as const;
export type SkinCheckSeverity = (typeof SKIN_CHECK_SEVERITIES)[number];

const SEVERITY_LABEL: Record<SkinCheckSeverity, string> = {
  none: "None",
  minor: "Minor",
  moderate: "Moderate",
  severe: "Severe",
};

// ─────────────────────────────────────────────────────────────────────────────
// Payload schema. `superRefine` enforces the conditional-required fields so
// the server is authoritative — the form doesn't have to be the source of
// truth.
// ─────────────────────────────────────────────────────────────────────────────

import { shiftSchema } from "./tracker-types";

export const skinCheckEntryPayloadSchema = z
  .object({
    finding: z.enum(SKIN_CHECK_FINDING_TYPES),
    body_site: z.enum(SKIN_CHECK_BODY_SITES).optional(),
    severity: z.enum(SKIN_CHECK_SEVERITIES),
    shift: shiftSchema,
    action_taken: z.string().max(500).optional(),
    supervisor_notified: z.enum(["yes", "no"]).optional(),
    note: z.string().max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.finding === "no_concerns") {
      if (v.severity !== "none") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "severity must be 'none' when finding is 'no_concerns'",
          path: ["severity"],
        });
      }
      // body_site, action_taken, supervisor_notified ignored when no concerns
      return;
    }

    // finding ≠ no_concerns
    if (!v.body_site) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "body_site is required when a finding is recorded",
        path: ["body_site"],
      });
    }
    if (v.severity === "none") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "severity must be minor, moderate, or severe when a finding is recorded",
        path: ["severity"],
      });
    }
    if (v.severity === "moderate" || v.severity === "severe") {
      if (!v.action_taken || v.action_taken.trim() === "") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "action_taken is required for moderate or severe findings",
          path: ["action_taken"],
        });
      }
      if (v.supervisor_notified !== "yes" && v.supervisor_notified !== "no") {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "supervisor_notified must be set for moderate or severe findings",
          path: ["supervisor_notified"],
        });
      }
    }
  });

export type SkinCheckEntryPayload = z.infer<typeof skinCheckEntryPayloadSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Alert rule — fires critical when severity = "severe". The supervisor must
// acknowledge explicitly; rule does not auto-resolve on later entries.
// ─────────────────────────────────────────────────────────────────────────────

const skinCheckSevereRule: AlertRule = {
  id: "skin-check-severe-finding",
  defaultSeverity: "critical",
  label: "Skin check — severe finding",
  evaluate(payload) {
    if (!payload || typeof payload !== "object") return null;
    const p = payload as Record<string, unknown>;
    if (p.severity !== "severe") return null;
    const site =
      typeof p.body_site === "string"
        ? BODY_SITE_LABEL[p.body_site as SkinCheckBodySite] ?? p.body_site
        : "unspecified site";
    const findingLabel =
      typeof p.finding === "string"
        ? FINDING_LABEL[p.finding as SkinCheckFindingType] ?? p.finding
        : "skin finding";
    return {
      ruleId: "skin-check-severe-finding",
      severity: "critical",
      message: `Severe ${findingLabel.toLowerCase()} · ${site}`,
      detail:
        "Confirm supervisor notification and document corrective action. Consider opening an incident if not already filed.",
      autoResolveOnNextEntry: false,
    };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// SKIN_CHECK_DEFINITION
// ─────────────────────────────────────────────────────────────────────────────

export const SKIN_CHECK_DEFINITION: TrackerDefinition = {
  slug: "skin_check",
  name: "Skin Check",
  shortName: "Skin",
  category: "health-clinical",
  schemaVersion: 1,
  icon: "Stethoscope",
  description:
    "Document skin integrity per resident per shift — log observations, findings, and actions taken.",
  modes: ["detailed", "history"],
  defaultMode: "detailed",
  detailedFields: [
    { kind: "resident", name: "residentId", label: "Resident", required: true },
    { kind: "shift", name: "shift", label: "Shift", required: true },
    {
      kind: "select",
      name: "finding",
      label: "Finding",
      required: true,
      options: SKIN_CHECK_FINDING_TYPES.map((v) => ({
        value: v,
        label: FINDING_LABEL[v],
      })),
    },
    {
      kind: "select",
      name: "body_site",
      label: "Body site",
      required: false,
      helpText: "Required when a finding is recorded.",
      options: SKIN_CHECK_BODY_SITES.map((v) => ({
        value: v,
        label: BODY_SITE_LABEL[v],
      })),
    },
    {
      kind: "select",
      name: "severity",
      label: "Severity",
      required: true,
      options: SKIN_CHECK_SEVERITIES.map((v) => ({
        value: v,
        label: SEVERITY_LABEL[v],
      })),
    },
    {
      kind: "textarea",
      name: "action_taken",
      label: "Action taken",
      required: false,
      helpText: "Required for moderate or severe findings.",
      maxLength: 500,
    },
    {
      kind: "select",
      name: "supervisor_notified",
      label: "Supervisor notified",
      required: false,
      helpText: "Required for moderate or severe findings.",
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
  payloadSchema: skinCheckEntryPayloadSchema,
  historySummary: skinCheckHistorySummary,
  alerts: [skinCheckSevereRule],
  requiresResident: true,
  supportsBulk: false,
  shiftAware: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// History summary
// ─────────────────────────────────────────────────────────────────────────────

const SEVERITY_TONE: Record<SkinCheckSeverity, HistoryTone> = {
  none: "normal",
  minor: "info",
  moderate: "elevated",
  severe: "critical",
};

export function skinCheckHistorySummary(payload: unknown): HistorySummary {
  if (typeof payload !== "object" || payload === null) {
    return { primary: "Skin check (unknown)" };
  }
  const p = payload as Record<string, unknown>;

  const finding =
    typeof p.finding === "string" ? (p.finding as SkinCheckFindingType) : undefined;
  const severity =
    typeof p.severity === "string" ? (p.severity as SkinCheckSeverity) : undefined;
  const bodySite =
    typeof p.body_site === "string" ? (p.body_site as SkinCheckBodySite) : undefined;
  const note =
    typeof p.note === "string" && p.note.trim() !== "" ? p.note.trim() : undefined;

  // No-concerns path — short, confirming line.
  if (finding === "no_concerns") {
    const primary = note
      ? `No concerns observed — “${truncate(note, 80)}”`
      : "No concerns observed";
    return { primary, tone: "normal" };
  }

  // Concern recorded — site + finding + severity badge.
  const findingLabel = finding ? FINDING_LABEL[finding] ?? finding : "Finding";
  const siteLabel = bodySite ? BODY_SITE_LABEL[bodySite] ?? bodySite : "—";
  const severityLabel = severity ? SEVERITY_LABEL[severity] ?? severity : "?";
  const tone: HistoryTone = severity ? SEVERITY_TONE[severity] : "info";

  const primary = note
    ? `${siteLabel} · ${findingLabel} (${severityLabel}) — “${truncate(note, 80)}”`
    : `${siteLabel} · ${findingLabel} (${severityLabel})`;

  return { primary, tone, badge: severityLabel };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1).trimEnd() + "…";
}
