/**
 * <RegSettingsContent> — Wave 0 F1 page (Phase 3 §3, Phase 4 §10).
 *
 * One row per canonical reg-setting key. Admin-only. Surfaces every [V]
 * placeholder (default value not validated for this facility) and lets the
 * admin record (value, sourceNote, validated) per the BRD provenance goal.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Page heading style:                           ComplianceContent.tsx:281
 *   - Section subheading style (text-sm font-medium muted): ComplianceContent.tsx:323
 *   - <FormField> wrapper + onSubmitKey:            components/operations/FormField.tsx
 *   - <Button variant="gradient"> primary action:   ComplianceContent.tsx:282
 *   - Loading skeleton row pattern:                 ComplianceContent.tsx:311-313
 *   - Error banner styling:                         ComplianceContent.tsx:305-307
 *   - useQuery + on401 returnNull + apiRequest PUT: ComplianceContent.tsx:222-246
 *   - [V] chip tone (amber = unvalidated warn):     EmarContent.tsx:55-62
 *   - Back-to-overview link:                        ComplianceContent.tsx:270-278
 *   - <Switch> primitive:                           components/ui/switch.tsx
 *
 * API contract (Phase 4 §7.1):
 *   GET /api/ops/facilities/:facilityNumber/reg-settings
 *   PUT /api/ops/reg-settings/:key  { value, sourceNote?, validated? }
 *
 * Wave 3 W14 — Daily summary email:
 *   - Appends a "Daily summary email" section covering the 9 W14 keys
 *     (DAILY_SUMMARY_*). Toggles + recipients + per-section include flags
 *     all go through the same per-row PUT contract (atomic per key).
 *   - "Send test email now" POSTs to
 *     /api/ops/facilities/:fn/daily-summary/test-send and toasts the
 *     server's recipient count.
 *
 * No Save All button in Wave 0 — saves are per-row (atomic per setting,
 * matches the server PUT-by-key contract). The page is sticky-scroll;
 * heavy editing is rare and per-row save fits the BRD intent of capturing
 * a documented provenance per setting.
 */
import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FormField } from "@/components/operations/FormField";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  AlertTriangle,
  Info,
  Mail,
  Send,
} from "lucide-react";

// ── Types matching Phase 4 §4.1 catalogue + §7.1 envelope ─────────────────────

export interface RegSettingRow {
  key: string;
  value: string;
  placeholder: boolean;
  sourceNote?: string;
  validated: boolean;
  /** Optional, may be present if the backend ships unit / label metadata. */
  label?: string;
  unit?: string;
  helpText?: string;
}

// ── Sectioned grouping per Phase 3 §3 wireframe ───────────────────────────────

interface SectionDef {
  id: string;
  title: string;
  /** Match function against the setting key, in order — first match wins. */
  matches: (key: string) => boolean;
}

const SECTIONS: SectionDef[] = [
  {
    id: "environment",
    title: "Environment",
    matches: (k) =>
      k === "HOT_WATER_MAX_F" ||
      k === "FRIDGE_MIN_F" ||
      k === "FRIDGE_MAX_F" ||
      k === "FREEZER_MAX_F",
  },
  {
    id: "incident_slas",
    title: "Incident SLAs",
    matches: (k) =>
      k === "INCIDENT_VERBAL_SERIOUS_HOURS" ||
      k === "INCIDENT_VERBAL_NON_EMERGENT_HOURS" ||
      k === "LIC_624_WRITTEN_DAYS" ||
      k === "SOC_341_VERBAL_HOURS",
  },
  {
    id: "drills",
    title: "Drills",
    matches: (k) =>
      k === "FIRE_DRILLS_PER_SHIFT_PER_QUARTER" ||
      k === "DISASTER_DRILL_INTERVAL_MONTHS",
  },
  {
    id: "staff_credentials",
    title: "Staff credentials",
    matches: (k) =>
      k === "TB_INITIAL_DAYS" ||
      k === "TB_RENEWAL_MONTHS" ||
      k === "FINGERPRINT_BEFORE_RESIDENT_CONTACT" ||
      k === "CPR_FIRST_AID_RENEWAL_MONTHS",
  },
  {
    id: "retention",
    title: "Retention",
    matches: (k) => k === "RECORD_RETENTION_YEARS_DEFAULT",
  },
  {
    id: "postings",
    title: "Postings",
    matches: (k) => k === "POSTING_BILINGUAL_THRESHOLD",
  },
];

// Wave 3 W14 — Daily summary email keys. These render in a dedicated
// <DailySummarySection> below the standard sections (toggle + numeric +
// recipients list don't fit the generic value/Source-note shape).
const DAILY_SUMMARY_KEYS = [
  "DAILY_SUMMARY_ENABLED",
  "DAILY_SUMMARY_HOUR_UTC",
  "DAILY_SUMMARY_RECIPIENTS",
  "DAILY_SUMMARY_INCLUDE_OBLIGATIONS",
  "DAILY_SUMMARY_INCLUDE_INCIDENTS",
  "DAILY_SUMMARY_INCLUDE_TEMPERATURE_OOR",
  "DAILY_SUMMARY_INCLUDE_CREDENTIALS",
  "DAILY_SUMMARY_INCLUDE_COMPLAINTS",
  "DAILY_SUMMARY_INCLUDE_VENDORS",
] as const;
type DailySummaryKey = (typeof DAILY_SUMMARY_KEYS)[number];

function isDailySummaryKey(k: string): k is DailySummaryKey {
  return (DAILY_SUMMARY_KEYS as readonly string[]).includes(k);
}

// Fallback label / unit / help derived from the canonical key when the
// backend doesn't ship them. Keeps the UI useful pre-Phase 5 validation.
const KEY_META: Record<
  string,
  { label: string; unit?: string; helpText?: string }
> = {
  HOT_WATER_MAX_F: {
    label: "Hot water max temperature",
    unit: "°F",
    helpText:
      "Drives the out-of-range flag on every hot-water temperature reading.",
  },
  FRIDGE_MIN_F: {
    label: "Refrigerator min temperature",
    unit: "°F",
    helpText: "Drives the out-of-range flag on fridge readings.",
  },
  FRIDGE_MAX_F: {
    label: "Refrigerator max temperature",
    unit: "°F",
    helpText: "Drives the out-of-range flag on fridge readings.",
  },
  FREEZER_MAX_F: {
    label: "Freezer max temperature",
    unit: "°F",
    helpText: "Drives the out-of-range flag on freezer readings.",
  },
  INCIDENT_VERBAL_SERIOUS_HOURS: {
    label: "CCLD verbal — serious bodily injury / death within",
    unit: "hours",
    helpText: "Hours to verbally notify CCLD of a serious event.",
  },
  INCIDENT_VERBAL_NON_EMERGENT_HOURS: {
    label: "CCLD verbal — non-emergent within",
    unit: "hours",
  },
  LIC_624_WRITTEN_DAYS: {
    label: "LIC 624 written submission within",
    unit: "days",
  },
  SOC_341_VERBAL_HOURS: {
    label: "SOC 341 abuse report — verbal within",
    unit: "hours",
  },
  FIRE_DRILLS_PER_SHIFT_PER_QUARTER: {
    label: "Fire drills per shift per quarter",
    unit: "drills",
  },
  DISASTER_DRILL_INTERVAL_MONTHS: {
    label: "Disaster drill cadence",
    unit: "months",
  },
  TB_INITIAL_DAYS: {
    label: "TB clearance — initial within",
    unit: "days",
  },
  TB_RENEWAL_MONTHS: {
    label: "TB renewal cadence",
    unit: "months",
  },
  FINGERPRINT_BEFORE_RESIDENT_CONTACT: {
    label: "Fingerprint clearance required before resident contact",
    helpText: "Boolean: true / false.",
  },
  CPR_FIRST_AID_RENEWAL_MONTHS: {
    label: "CPR / First Aid renewal",
    unit: "months",
  },
  RECORD_RETENTION_YEARS_DEFAULT: {
    label: "Default record retention",
    unit: "years",
  },
  POSTING_BILINGUAL_THRESHOLD: {
    label: "Bilingual posting threshold",
  },
};

function metaFor(row: RegSettingRow): {
  label: string;
  unit?: string;
  helpText?: string;
} {
  const fallback = KEY_META[row.key] ?? { label: row.key };
  return {
    label: row.label ?? fallback.label,
    unit: row.unit ?? fallback.unit,
    helpText: row.helpText ?? fallback.helpText,
  };
}

// ── Per-row editor ────────────────────────────────────────────────────────────

interface RowProps {
  row: RegSettingRow;
  facilityNumber: string;
}

function RegSettingRowEditor({ row, facilityNumber }: RowProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const meta = metaFor(row);

  const [value, setValue] = useState(row.value);
  const [sourceNote, setSourceNote] = useState(row.sourceNote ?? "");
  const [noteOpen, setNoteOpen] = useState(false);
  const [dirty, setDirty] = useState(false);

  // Derived: validated when the user has cleared the placeholder via
  // providing a non-empty source note. Mirrors §3 "Resolved" rule.
  const computedValidated = sourceNote.trim().length > 0;

  const listKey = [
    `/api/ops/facilities/${facilityNumber}/reg-settings`,
  ] as const;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        value,
        sourceNote: sourceNote.trim() || undefined,
        validated: computedValidated,
      };
      const res = await apiRequest(
        "PUT",
        `/api/ops/reg-settings/${encodeURIComponent(row.key)}`,
        body,
      );
      return res.json();
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<{ data: RegSettingRow[] }>(listKey);
      if (prev?.data) {
        qc.setQueryData(listKey, {
          ...prev,
          data: prev.data.map((r) =>
            r.key === row.key
              ? {
                  ...r,
                  value,
                  sourceNote: sourceNote.trim() || undefined,
                  validated: computedValidated,
                  placeholder: !computedValidated && r.placeholder,
                }
              : r,
          ),
        });
      }
      return { prev };
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(listKey, ctx.prev);
      toast({
        title: "Couldn't save setting",
        description: err.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      toast({ title: "Setting saved" });
      setDirty(false);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: listKey });
    },
  });

  // [V] visible when row is placeholder AND not yet validated.
  const showPlaceholderChip = row.placeholder && !computedValidated;

  return (
    <div className="rounded-md border bg-white p-3 space-y-2">
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-800">
              {meta.label}
            </span>
            {showPlaceholderChip && (
              <span
                className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-amber-100 text-amber-700 border-amber-200"
                title="Default value, not validated for your facility. Replace with the validated value from Title 22 or your licensing analyst."
                data-testid="reg-setting-v-chip"
              >
                [V]
              </span>
            )}
            {computedValidated && (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold border bg-emerald-100 text-emerald-700 border-emerald-200">
                <CheckCircle2 className="h-3 w-3" />
                Validated
              </span>
            )}
          </div>
          {meta.helpText && (
            <p className="text-[11px] text-muted-foreground mt-0.5 flex items-start gap-1">
              <Info className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />
              <span>{meta.helpText}</span>
            </p>
          )}
        </div>

        <div className="flex items-end gap-2 shrink-0">
          <FormField label="Value">
            <Input
              value={value}
              onChange={(e) => {
                setValue(e.target.value);
                setDirty(true);
              }}
              className="h-8 w-28 text-sm"
              aria-label={`${meta.label} value`}
              data-testid={`reg-setting-input-${row.key}`}
            />
          </FormField>
          {meta.unit && (
            <span className="text-xs text-muted-foreground pb-2">
              {meta.unit}
            </span>
          )}
        </div>
      </div>

      <div>
        <button
          type="button"
          onClick={() => setNoteOpen((v) => !v)}
          className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
          aria-expanded={noteOpen}
          aria-label="Toggle source note"
        >
          {noteOpen ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          )}
          Source note
          {sourceNote && !noteOpen && (
            <span className="text-emerald-600 ml-1">·</span>
          )}
        </button>
        {noteOpen && (
          <Textarea
            value={sourceNote}
            onChange={(e) => {
              setSourceNote(e.target.value);
              setDirty(true);
            }}
            placeholder="e.g., Title 22 §87303(g) per CCLD analyst on 2026-05-10"
            className="resize-none min-h-[56px] text-xs mt-1"
            data-testid={`reg-setting-note-${row.key}`}
          />
        )}
      </div>

      {dirty && (
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setValue(row.value);
              setSourceNote(row.sourceNote ?? "");
              setDirty(false);
            }}
            disabled={saveMutation.isPending}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="gradient"
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            data-testid={`reg-setting-save-${row.key}`}
          >
            {saveMutation.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}

// ── Section ───────────────────────────────────────────────────────────────────

function Section({
  title,
  rows,
  facilityNumber,
}: {
  title: string;
  rows: RegSettingRow[];
  facilityNumber: string;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      <div className="space-y-2">
        {rows.map((row) => (
          <RegSettingRowEditor
            key={row.key}
            row={row}
            facilityNumber={facilityNumber}
          />
        ))}
      </div>
    </section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function RegSettingsContent({
  facilityNumber,
  onBack,
}: {
  facilityNumber: string;
  onBack?: () => void;
}) {
  const listKey = [
    `/api/ops/facilities/${facilityNumber}/reg-settings`,
  ] as const;

  const { data, isLoading, error } = useQuery<{
    success: boolean;
    data: RegSettingRow[];
  } | null>({
    queryKey: listKey,
    queryFn: async () => {
      const res = await fetch(
        `/api/ops/facilities/${facilityNumber}/reg-settings`,
        { credentials: "include" },
      );
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const rows = data?.data ?? [];

  // Wave 3 W14 — pull the daily-summary keys out before the generic
  // section bucketing so they only render in <DailySummarySection>.
  const dailySummaryRows = useMemo(
    () => rows.filter((r) => isDailySummaryKey(r.key)),
    [rows],
  );
  const standardRows = useMemo(
    () => rows.filter((r) => !isDailySummaryKey(r.key)),
    [rows],
  );

  // Partition into known sections + a fallback "Other" bucket so a future
  // backend addition surfaces without a UI deploy.
  const used = new Set<string>();
  const bySection = SECTIONS.map((sec) => {
    const matched = standardRows.filter((r) => {
      if (used.has(r.key)) return false;
      if (sec.matches(r.key)) {
        used.add(r.key);
        return true;
      }
      return false;
    });
    return { ...sec, rows: matched };
  });
  const other = standardRows.filter((r) => !used.has(r.key));

  const placeholderCount = standardRows.filter(
    (r) => r.placeholder && !r.validated,
  ).length;

  return (
    <div className="space-y-4 max-w-3xl">
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-2 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Audit Readiness
        </button>
      )}

      <h1
        className="text-xl font-semibold"
        style={{ color: "#1E1B4B" }}
      >
        Reg Settings
      </h1>

      <p className="text-sm text-muted-foreground">
        Some values below are defaults per common practice and are marked{" "}
        <span
          className={cn(
            "inline-flex items-center px-1 py-0.5 rounded text-[10px] font-semibold border",
            "bg-amber-100 text-amber-700 border-amber-200",
          )}
        >
          [V]
        </span>
        . Replace them with your validated values from Title 22 or your
        licensing analyst.
      </p>

      {!isLoading && !error && rows.length > 0 && placeholderCount === 0 && (
        <div
          className="rounded-md bg-emerald-50 border border-emerald-200 p-3 text-sm text-emerald-800 flex items-center gap-2"
          data-testid="reg-settings-banner-validated"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          All values validated for this facility.
        </div>
      )}

      {error && (
        <div
          className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive flex items-center gap-2"
          role="alert"
        >
          <AlertTriangle className="h-4 w-4 shrink-0" />
          Couldn't load reg settings — please try again.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-4" data-testid="reg-settings-loading">
          {Array.from({ length: 3 }).map((_, sectionIdx) => (
            <div key={sectionIdx} className="space-y-2">
              <Skeleton className="h-4 w-32" />
              {Array.from({ length: 3 }).map((__, rowIdx) => (
                <Skeleton key={rowIdx} className="h-20 w-full rounded-md" />
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {bySection.map((sec) => (
            <Section
              key={sec.id}
              title={sec.title}
              rows={sec.rows}
              facilityNumber={facilityNumber}
            />
          ))}
          {other.length > 0 && (
            <Section
              title="Other"
              rows={other}
              facilityNumber={facilityNumber}
            />
          )}
          <DailySummarySection
            facilityNumber={facilityNumber}
            rows={dailySummaryRows}
          />
        </div>
      )}
    </div>
  );
}

// ── Wave 3 W14 — Daily summary email section ──────────────────────────────────

/** Default values for W14 keys when the BE hasn't seeded them yet. */
const DAILY_SUMMARY_DEFAULTS: Record<DailySummaryKey, string> = {
  DAILY_SUMMARY_ENABLED: "false",
  DAILY_SUMMARY_HOUR_UTC: "14",
  DAILY_SUMMARY_RECIPIENTS: "",
  DAILY_SUMMARY_INCLUDE_OBLIGATIONS: "true",
  DAILY_SUMMARY_INCLUDE_INCIDENTS: "true",
  DAILY_SUMMARY_INCLUDE_TEMPERATURE_OOR: "true",
  DAILY_SUMMARY_INCLUDE_CREDENTIALS: "true",
  DAILY_SUMMARY_INCLUDE_COMPLAINTS: "true",
  DAILY_SUMMARY_INCLUDE_VENDORS: "true",
};

const DAILY_SUMMARY_LABELS: Record<DailySummaryKey, string> = {
  DAILY_SUMMARY_ENABLED: "Daily summary enabled",
  DAILY_SUMMARY_HOUR_UTC: "Send hour (UTC)",
  DAILY_SUMMARY_RECIPIENTS: "Recipients",
  DAILY_SUMMARY_INCLUDE_OBLIGATIONS: "Include obligations",
  DAILY_SUMMARY_INCLUDE_INCIDENTS: "Include incidents past SLA",
  DAILY_SUMMARY_INCLUDE_TEMPERATURE_OOR: "Include temperature out-of-range",
  DAILY_SUMMARY_INCLUDE_CREDENTIALS: "Include staff credentials",
  DAILY_SUMMARY_INCLUDE_COMPLAINTS: "Include complaints",
  DAILY_SUMMARY_INCLUDE_VENDORS: "Include vendor COIs",
};

const DAILY_SUMMARY_HELP: Partial<Record<DailySummaryKey, string>> = {
  DAILY_SUMMARY_HOUR_UTC: "Hour of day (UTC). 14 = 7 AM Pacific.",
  DAILY_SUMMARY_RECIPIENTS:
    "Comma-separated emails — leave blank to use the facility primary email.",
};

const TOGGLE_KEYS: DailySummaryKey[] = [
  "DAILY_SUMMARY_ENABLED",
  "DAILY_SUMMARY_INCLUDE_OBLIGATIONS",
  "DAILY_SUMMARY_INCLUDE_INCIDENTS",
  "DAILY_SUMMARY_INCLUDE_TEMPERATURE_OOR",
  "DAILY_SUMMARY_INCLUDE_CREDENTIALS",
  "DAILY_SUMMARY_INCLUDE_COMPLAINTS",
  "DAILY_SUMMARY_INCLUDE_VENDORS",
];

function valueFor(
  rows: RegSettingRow[],
  key: DailySummaryKey,
): RegSettingRow {
  const existing = rows.find((r) => r.key === key);
  if (existing) return existing;
  return {
    key,
    value: DAILY_SUMMARY_DEFAULTS[key],
    placeholder: true,
    validated: false,
  };
}

function DailySummarySection({
  facilityNumber,
  rows,
}: {
  facilityNumber: string;
  rows: RegSettingRow[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);

  const listKey = [
    `/api/ops/facilities/${facilityNumber}/reg-settings`,
  ] as const;

  // Per-key PUT — mirrors RegSettingRowEditor's contract.
  const saveKey = useMutation({
    mutationFn: async (vars: { key: DailySummaryKey; value: string }) => {
      const res = await apiRequest(
        "PUT",
        `/api/ops/reg-settings/${encodeURIComponent(vars.key)}`,
        { value: vars.value, validated: true },
      );
      return res.json();
    },
    onMutate: async (vars) => {
      await qc.cancelQueries({ queryKey: listKey });
      const prev = qc.getQueryData<{ data: RegSettingRow[] }>(listKey);
      if (prev?.data) {
        const existing = prev.data.find((r) => r.key === vars.key);
        const nextRow: RegSettingRow = existing
          ? { ...existing, value: vars.value, validated: true }
          : {
              key: vars.key,
              value: vars.value,
              placeholder: false,
              validated: true,
            };
        qc.setQueryData(listKey, {
          ...prev,
          data: prev.data.some((r) => r.key === vars.key)
            ? prev.data.map((r) => (r.key === vars.key ? nextRow : r))
            : [...prev.data, nextRow],
        });
      }
      return { prev };
    },
    onError: (err: Error, _vars, ctx) => {
      if (ctx?.prev) qc.setQueryData(listKey, ctx.prev);
      toast({
        title: "Couldn't save setting",
        description: err.message,
        variant: "destructive",
      });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: listKey });
    },
  });

  const testSend = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/ops/facilities/${facilityNumber}/daily-summary/test-send`,
        {},
      );
      return res.json() as Promise<{
        success: boolean;
        data: { sent: number; recipients: string[]; skipped: string[] };
      }>;
    },
    onSuccess: (resp) => {
      toast({
        title: `Sent to ${resp.data?.sent ?? 0} recipient${(resp.data?.sent ?? 0) === 1 ? "" : "s"}.`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't send test email",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  return (
    <section
      className="space-y-2"
      aria-label="Daily summary email settings"
      data-testid="daily-summary-section"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
        aria-expanded={open}
      >
        {open ? (
          <ChevronUp className="h-3.5 w-3.5" aria-hidden />
        ) : (
          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
        )}
        <Mail className="h-3.5 w-3.5" aria-hidden />
        Daily summary email
      </button>

      {open && (
        <div className="space-y-2">
          {DAILY_SUMMARY_KEYS.map((key) => {
            const row = valueFor(rows, key);
            const isToggle = TOGGLE_KEYS.includes(key);
            const help = DAILY_SUMMARY_HELP[key];
            const label = DAILY_SUMMARY_LABELS[key];

            if (isToggle) {
              const checked = row.value === "true";
              return (
                <div
                  key={key}
                  className="rounded-md border bg-white p-3 flex items-center justify-between gap-3"
                  data-testid={`daily-summary-row-${key}`}
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-gray-800">
                      {label}
                    </div>
                    {help && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 flex items-start gap-1">
                        <Info className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />
                        <span>{help}</span>
                      </p>
                    )}
                  </div>
                  <Switch
                    checked={checked}
                    onCheckedChange={(v) =>
                      saveKey.mutate({ key, value: v ? "true" : "false" })
                    }
                    disabled={saveKey.isPending}
                    aria-label={label}
                    data-testid={`daily-summary-switch-${key}`}
                  />
                </div>
              );
            }

            return (
              <DailySummaryTextRow
                key={key}
                rowKey={key}
                label={label}
                help={help}
                initialValue={row.value}
                placeholder={
                  key === "DAILY_SUMMARY_RECIPIENTS"
                    ? "admin@example.com, dir@example.com — leave blank to use facility primary email"
                    : undefined
                }
                onSave={(value) => saveKey.mutate({ key, value })}
                saving={saveKey.isPending}
              />
            );
          })}

          <div className="rounded-md border bg-stone-50 p-3 flex items-center justify-between gap-3">
            <div className="text-xs text-muted-foreground">
              Sends to the configured recipients (or facility primary email
              if blank) — confirms the pipeline end-to-end.
            </div>
            <Button
              type="button"
              size="sm"
              variant="gradient"
              onClick={() => testSend.mutate()}
              disabled={testSend.isPending}
              data-testid="daily-summary-test-send"
              aria-label="Send test email now"
            >
              <Send className="h-3.5 w-3.5 mr-1.5" aria-hidden />
              {testSend.isPending ? "Sending…" : "Send test email now"}
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Text/number input row for W14 keys that aren't booleans
 * (DAILY_SUMMARY_HOUR_UTC, DAILY_SUMMARY_RECIPIENTS). Local dirty state
 * + Save button mirrors RegSettingRowEditor's pattern.
 */
function DailySummaryTextRow({
  rowKey,
  label,
  help,
  initialValue,
  placeholder,
  onSave,
  saving,
}: {
  rowKey: DailySummaryKey;
  label: string;
  help?: string;
  initialValue: string;
  placeholder?: string;
  onSave: (value: string) => void;
  saving: boolean;
}) {
  const [value, setValue] = useState(initialValue);
  const [dirty, setDirty] = useState(false);
  const isNumber = rowKey === "DAILY_SUMMARY_HOUR_UTC";

  return (
    <div
      className="rounded-md border bg-white p-3 space-y-2"
      data-testid={`daily-summary-row-${rowKey}`}
    >
      <div className="flex items-start gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-gray-800">{label}</div>
          {help && (
            <p className="text-[11px] text-muted-foreground mt-0.5 flex items-start gap-1">
              <Info className="h-3 w-3 mt-0.5 shrink-0" aria-hidden />
              <span>{help}</span>
            </p>
          )}
        </div>
        <FormField label="Value">
          <Input
            type={isNumber ? "number" : "text"}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setDirty(true);
            }}
            placeholder={placeholder}
            className={cn(
              "h-8 text-sm",
              isNumber ? "w-20" : "w-72 max-w-full",
            )}
            aria-label={label}
            data-testid={`daily-summary-input-${rowKey}`}
          />
        </FormField>
      </div>
      {dirty && (
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => {
              setValue(initialValue);
              setDirty(false);
            }}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            variant="gradient"
            onClick={() => {
              onSave(value);
              setDirty(false);
            }}
            disabled={saving}
            data-testid={`daily-summary-save-${rowKey}`}
          >
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}
