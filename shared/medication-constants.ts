/**
 * Medication constants & adapters — single source of truth for the controlled
 * medication form, shared between client (form rendering) and server (Zod
 * validation, response normalization).
 *
 * Storage stays unchanged: opsMedications.frequency is TEXT, scheduledTimes is
 * TEXT (comma-joined "HH:mm"). All structure lives at the API boundary.
 */

import { z } from "zod";

// ── Frequency enum ──────────────────────────────────────────────────────────

export const MEDICATION_FREQUENCY_VALUES = [
  "once_daily",
  "twice_daily",
  "three_times_daily",
  "four_times_daily",
  "every_6_hours",
  "every_8_hours",
  "every_12_hours",
  "at_bedtime",
  "in_the_morning",
  "weekly",
  "prn",
  "other",
] as const;

export type MedicationFrequency = (typeof MEDICATION_FREQUENCY_VALUES)[number];

export interface FrequencyOption {
  value: MedicationFrequency;
  label: string;
  requiresScheduledTimes: boolean;
  defaultTimeCount: number;
  defaultTimes: string[];
}

export const MEDICATION_FREQUENCY: ReadonlyArray<FrequencyOption> = [
  { value: "once_daily",         label: "Once daily (qd)",         requiresScheduledTimes: true,  defaultTimeCount: 1, defaultTimes: ["09:00"] },
  { value: "twice_daily",        label: "Twice daily (BID)",       requiresScheduledTimes: true,  defaultTimeCount: 2, defaultTimes: ["09:00", "21:00"] },
  { value: "three_times_daily",  label: "Three times daily (TID)", requiresScheduledTimes: true,  defaultTimeCount: 3, defaultTimes: ["08:00", "14:00", "20:00"] },
  { value: "four_times_daily",   label: "Four times daily (QID)",  requiresScheduledTimes: true,  defaultTimeCount: 4, defaultTimes: ["08:00", "12:00", "16:00", "20:00"] },
  { value: "every_6_hours",      label: "Every 6 hours (q6h)",     requiresScheduledTimes: true,  defaultTimeCount: 4, defaultTimes: ["06:00", "12:00", "18:00", "00:00"] },
  { value: "every_8_hours",      label: "Every 8 hours (q8h)",     requiresScheduledTimes: true,  defaultTimeCount: 3, defaultTimes: ["06:00", "14:00", "22:00"] },
  { value: "every_12_hours",     label: "Every 12 hours (q12h)",   requiresScheduledTimes: true,  defaultTimeCount: 2, defaultTimes: ["08:00", "20:00"] },
  { value: "at_bedtime",         label: "At bedtime (HS)",         requiresScheduledTimes: true,  defaultTimeCount: 1, defaultTimes: ["21:00"] },
  { value: "in_the_morning",     label: "In the morning (AM)",     requiresScheduledTimes: true,  defaultTimeCount: 1, defaultTimes: ["08:00"] },
  { value: "weekly",             label: "Weekly",                  requiresScheduledTimes: true,  defaultTimeCount: 1, defaultTimes: ["09:00"] },
  { value: "prn",                label: "As needed (PRN)",         requiresScheduledTimes: false, defaultTimeCount: 0, defaultTimes: [] },
  { value: "other",              label: "Other / legacy",          requiresScheduledTimes: false, defaultTimeCount: 0, defaultTimes: [] },
];

const FREQUENCY_BY_VALUE = new Map<string, FrequencyOption>(
  MEDICATION_FREQUENCY.map((f) => [f.value, f])
);

export function isKnownFrequency(value: unknown): value is MedicationFrequency {
  return typeof value === "string" && FREQUENCY_BY_VALUE.has(value);
}

export function frequencyLabel(value: string | null | undefined): string {
  if (!value) return "";
  return FREQUENCY_BY_VALUE.get(value)?.label ?? value;
}

export function defaultScheduledTimes(value: MedicationFrequency): string[] {
  return FREQUENCY_BY_VALUE.get(value)?.defaultTimes ?? [];
}

export function frequencyRequiresTimes(value: MedicationFrequency): boolean {
  return FREQUENCY_BY_VALUE.get(value)?.requiresScheduledTimes ?? false;
}

// ── Scheduled times wire format ─────────────────────────────────────────────

export const HH_MM = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_TIMES_PER_MED = 12;

export function parseLegacyScheduledTimes(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean)
    .filter((t) => HH_MM.test(t));
}

export function joinScheduledTimes(arr: string[] | null | undefined): string | null {
  if (!arr || arr.length === 0) return null;
  return arr.join(",");
}

export function sortTimes(arr: string[]): string[] {
  return [...arr].sort();
}

// ── Legacy frequency normalization ──────────────────────────────────────────

const FREQUENCY_ALIASES: Record<string, MedicationFrequency> = {
  // once daily
  "once daily": "once_daily",
  "once a day": "once_daily",
  "one time daily": "once_daily",
  "one time a day": "once_daily",
  "1x daily": "once_daily",
  "1x a day": "once_daily",
  "1 time daily": "once_daily",
  "1 time a day": "once_daily",
  "every day": "once_daily",
  "every 24 hours": "once_daily",
  "q24h": "once_daily",
  "qd": "once_daily",
  "od": "once_daily",
  "daily": "once_daily",
  // twice daily
  "twice daily": "twice_daily",
  "twice a day": "twice_daily",
  "two times daily": "twice_daily",
  "two times a day": "twice_daily",
  "2x daily": "twice_daily",
  "2x a day": "twice_daily",
  "2 times daily": "twice_daily",
  "2 times a day": "twice_daily",
  "twiceday": "twice_daily",
  "bid": "twice_daily",
  "b.i.d.": "twice_daily",
  "b i d": "twice_daily",
  // three times daily
  "three times daily": "three_times_daily",
  "three times a day": "three_times_daily",
  "3x daily": "three_times_daily",
  "3x a day": "three_times_daily",
  "3 times daily": "three_times_daily",
  "3 times a day": "three_times_daily",
  "tid": "three_times_daily",
  "t.i.d.": "three_times_daily",
  "t i d": "three_times_daily",
  // four times daily
  "four times daily": "four_times_daily",
  "four times a day": "four_times_daily",
  "4x daily": "four_times_daily",
  "4x a day": "four_times_daily",
  "4 times daily": "four_times_daily",
  "4 times a day": "four_times_daily",
  "qid": "four_times_daily",
  "q.i.d.": "four_times_daily",
  "q i d": "four_times_daily",
  // every N hours
  "q6h": "every_6_hours",
  "every 6 hours": "every_6_hours",
  "every 6 hr": "every_6_hours",
  "q 6 h": "every_6_hours",
  "q8h": "every_8_hours",
  "every 8 hours": "every_8_hours",
  "every 8 hr": "every_8_hours",
  "q 8 h": "every_8_hours",
  "q12h": "every_12_hours",
  "every 12 hours": "every_12_hours",
  "every 12 hr": "every_12_hours",
  "q 12 h": "every_12_hours",
  // bedtime
  "qhs": "at_bedtime",
  "hs": "at_bedtime",
  "at bedtime": "at_bedtime",
  "bedtime": "at_bedtime",
  "before bed": "at_bedtime",
  "nightly": "at_bedtime",
  "at night": "at_bedtime",
  // morning
  "qam": "in_the_morning",
  "am": "in_the_morning",
  "in the morning": "in_the_morning",
  "morning": "in_the_morning",
  "every morning": "in_the_morning",
  "with breakfast": "in_the_morning",
  // weekly
  "weekly": "weekly",
  "qweek": "weekly",
  "q week": "weekly",
  "once a week": "weekly",
  "1x weekly": "weekly",
  "1x per week": "weekly",
  // prn
  "prn": "prn",
  "as needed": "prn",
  "p.r.n.": "prn",
  "p r n": "prn",
  "when needed": "prn",
  "if needed": "prn",
};

export function parseLegacyFrequency(text: string | null | undefined): MedicationFrequency {
  if (!text) return "other";
  if (isKnownFrequency(text)) return text;
  const normalized = text.toLowerCase().replace(/[^a-z0-9 .]/g, "").replace(/\s+/g, " ").trim();
  if (FREQUENCY_ALIASES[normalized]) return FREQUENCY_ALIASES[normalized];
  // strip trailing periods then retry
  const stripped = normalized.replace(/\./g, "");
  if (FREQUENCY_ALIASES[stripped]) return FREQUENCY_ALIASES[stripped];
  return "other";
}

// ── Zod schemas ─────────────────────────────────────────────────────────────

const FrequencyEnum = z.enum(MEDICATION_FREQUENCY_VALUES);

/**
 * Accepts the new shape (canonical enum value) OR any legacy free-text string,
 * which we normalize via parseLegacyFrequency. Stale clients sending "BID"
 * still validate.
 */
const FrequencyInput = z
  .union([FrequencyEnum, z.string().min(1)])
  .transform((v) => (isKnownFrequency(v) ? v : parseLegacyFrequency(v)));

/**
 * Accepts string[] of HH:mm OR a comma-joined CSV (legacy clients). Returns
 * the canonical string[] sorted ascending. Rejects malformed entries.
 */
const ScheduledTimesInput = z
  .union([
    z.array(z.string().regex(HH_MM, "Use 24-hour time, e.g. 08:00 or 21:30.")).max(MAX_TIMES_PER_MED),
    z.string(),
  ])
  .transform((v) => {
    const arr = Array.isArray(v) ? v : parseLegacyScheduledTimes(v);
    return sortTimes(arr.filter((t) => HH_MM.test(t))).slice(0, MAX_TIMES_PER_MED);
  });

const baseMedicationFields = {
  drugName: z.string().min(1),
  genericName: z.string().optional(),
  dosage: z.string().min(1),
  route: z.string().min(1),
  frequency: FrequencyInput,
  scheduledTimes: ScheduledTimesInput.optional().default([]),
  prescriberName: z.string().optional(),
  prescriberNpi: z.string().optional(),
  rxNumber: z.string().optional(),
  pharmacyName: z.string().optional(),
  startDate: z.number().int().optional(),
  endDate: z.number().int().optional(),
  isPrn: z.number().int().optional(),
  prnIndication: z.string().optional(),
  isControlled: z.number().int().optional(),
  isPsychotropic: z.number().int().optional(),
  isHazardous: z.number().int().optional(),
  classification: z.string().optional(),
  requiresVitalsBefore: z.number().int().optional(),
  vitalType: z.string().optional(),
  refillThresholdDays: z.number().int().optional(),
  autoRefillRequest: z.number().int().optional(),
  status: z.string().optional(),
};

/**
 * Cross-field rule: PRN must not have scheduled times; non-PRN scheduled
 * frequencies must have at least one. The "other" bucket is intentionally
 * exempt — it exists only for legacy rows.
 */
export function validateFrequencyTimesConsistency(
  frequency: MedicationFrequency,
  scheduledTimes: string[],
): { ok: true } | { ok: false; field: "scheduledTimes"; message: string } {
  if (frequency === "prn" && scheduledTimes.length > 0) {
    return { ok: false, field: "scheduledTimes", message: "PRN medications must not have scheduled times." };
  }
  if (frequency !== "prn" && frequency !== "other" && scheduledTimes.length === 0) {
    return { ok: false, field: "scheduledTimes", message: "Add at least one scheduled time, or change frequency to PRN." };
  }
  return { ok: true };
}

export const MedicationCreateInput = z.object(baseMedicationFields).superRefine((d, ctx) => {
  const r = validateFrequencyTimesConsistency(d.frequency, d.scheduledTimes);
  if (!r.ok) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [r.field], message: r.message });
  }
});

/**
 * For PUT (partial). Cross-field rule cannot run here without the existing
 * row; the route handler runs validateFrequencyTimesConsistency on the merged
 * post-update state.
 */
export const MedicationUpdateInput = z.object(baseMedicationFields).partial();

/** Discontinue reason enum — mirrors the FE Select. */
export const MEDICATION_DISCONTINUE_REASONS = [
  "completed_course",
  "adverse_reaction",
  "prescriber_change",
  "resident_refusal",
  "other",
] as const;

export type MedicationDiscontinueReason =
  (typeof MEDICATION_DISCONTINUE_REASONS)[number];

export const DISCONTINUE_REASON_LABELS: Record<MedicationDiscontinueReason, string> = {
  completed_course: "Completed course",
  adverse_reaction: "Adverse reaction",
  prescriber_change: "Prescriber change",
  resident_refusal: "Resident refusal",
  other: "Other",
};

// ── Response normalization ──────────────────────────────────────────────────

export interface NormalizedMedicationFields {
  frequency: MedicationFrequency;
  frequencyLabel: string;
  frequencyRaw: string | null;
  scheduledTimesArray: string[];
}

/**
 * Used by listMedications/getMedication to enrich a raw DB row with canonical
 * fields without losing legacy display behavior. The original `frequency` and
 * `scheduledTimes` strings are preserved; new fields are added alongside.
 */
export function normalizeMedicationRow<
  T extends { frequency: string; scheduledTimes: string | null },
>(row: T): T & NormalizedMedicationFields {
  const canonical = parseLegacyFrequency(row.frequency);
  const isLegacy = !isKnownFrequency(row.frequency);
  return {
    ...row,
    frequency: canonical,
    frequencyLabel: frequencyLabel(canonical),
    frequencyRaw: isLegacy ? row.frequency : null,
    scheduledTimesArray: parseLegacyScheduledTimes(row.scheduledTimes),
  };
}
