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
 *
 * API contract (Phase 4 §7.1):
 *   GET /api/ops/facilities/:facilityNumber/reg-settings
 *   PUT /api/ops/reg-settings/:key  { value, sourceNote?, validated? }
 *
 * No Save All button in Wave 0 — saves are per-row (atomic per setting,
 * matches the server PUT-by-key contract). The page is sticky-scroll;
 * heavy editing is rare and per-row save fits the BRD intent of capturing
 * a documented provenance per setting.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
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

  // Partition into known sections + a fallback "Other" bucket so a future
  // backend addition surfaces without a UI deploy.
  const used = new Set<string>();
  const bySection = SECTIONS.map((sec) => {
    const matched = rows.filter((r) => {
      if (used.has(r.key)) return false;
      if (sec.matches(r.key)) {
        used.add(r.key);
        return true;
      }
      return false;
    });
    return { ...sec, rows: matched };
  });
  const other = rows.filter((r) => !used.has(r.key));

  const placeholderCount = rows.filter(
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
        </div>
      )}
    </div>
  );
}
