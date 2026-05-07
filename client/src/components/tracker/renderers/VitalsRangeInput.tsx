/**
 * VitalsRangeInput — specialized numeric input for the Vitals tracker.
 *
 * Behaviour:
 *   • Picks the right input shape based on `vital_type` (BP shows two inputs,
 *     others show one).
 *   • Calls `useVitalRange` on every keystroke; the live range coloring is
 *     driven by the resulting `'normal' | 'elevated' | 'critical' | 'unknown'`.
 *   • For temperature/weight a small unit toggle lets the caregiver flip
 *     between F/C or lb/kg without re-typing.
 *   • Shows a labelled status badge ("Normal", "Elevated", "Critical").
 */
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  classifyVitalRange,
  RANGE_CLASSES,
  RANGE_LABEL,
  type VitalRange,
} from "@/lib/tracker/useVitalRange";
import {
  VITAL_TYPE_LABEL,
  VITAL_TYPE_UNIT,
  type VitalType,
} from "@shared/tracker-schemas";

export interface VitalsValue {
  /** BP only. */
  systolic?: string;
  /** BP only. */
  diastolic?: string;
  /** All non-BP vitals. */
  value?: string;
  /** Temperature/weight only. */
  unit?: "F" | "C" | "lb" | "kg";
}

export function VitalsRangeInput({
  vitalType,
  value,
  onChange,
  error,
  idPrefix = "vitals",
}: {
  vitalType: VitalType;
  value: VitalsValue;
  onChange: (next: VitalsValue) => void;
  error?: Partial<Record<keyof VitalsValue | "vital_type", string>>;
  idPrefix?: string;
}) {
  // `classifyVitalRange` is a pure function — recompute every render.
  const range: VitalRange =
    vitalType === "bp"
      ? classifyVitalRange("bp", value.systolic, { secondary: value.diastolic })
      : vitalType === "temperature"
        ? classifyVitalRange("temperature", value.value, {
            unit: value.unit === "C" ? "C" : "F",
          })
        : classifyVitalRange(vitalType, value.value);

  const cls = RANGE_CLASSES[range];

  // Header chip — label + range badge.
  const header = (
    <div className="flex items-end justify-between gap-3">
      <div>
        <p className={cn("text-sm font-semibold", cls.text)}>
          {VITAL_TYPE_LABEL[vitalType]}
        </p>
        <p className="text-xs text-muted-foreground">
          {VITAL_TYPE_UNIT[vitalType]}
        </p>
      </div>
      <span
        className={cn(
          "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors",
          cls.badge,
        )}
        aria-live="polite"
      >
        {RANGE_LABEL[range]}
      </span>
    </div>
  );

  if (vitalType === "bp") {
    return (
      <div
        className={cn(
          "rounded-lg border-2 p-4 space-y-3 transition-colors",
          cls.border,
          cls.bg,
        )}
      >
        {header}
        <div className="grid grid-cols-2 gap-3">
          <NumberCell
            id={`${idPrefix}-systolic`}
            label="Systolic"
            unit="mmHg"
            value={value.systolic ?? ""}
            onChange={(v) => onChange({ ...value, systolic: v })}
            range={range}
            error={error?.systolic}
            min={40}
            max={300}
          />
          <NumberCell
            id={`${idPrefix}-diastolic`}
            label="Diastolic"
            unit="mmHg"
            value={value.diastolic ?? ""}
            onChange={(v) => onChange({ ...value, diastolic: v })}
            range={range}
            error={error?.diastolic}
            min={20}
            max={200}
          />
        </div>
      </div>
    );
  }

  // Vitals with a single numeric value.
  const showUnit =
    vitalType === "temperature" || vitalType === "weight"
      ? (vitalType === "temperature" ? (["F", "C"] as const) : (["lb", "kg"] as const))
      : null;

  const inputBounds: Partial<Record<VitalType, { min: number; max: number }>> = {
    pulse: { min: 20, max: 250 },
    weight: { min: 1, max: 800 },
    temperature: { min: 70, max: 115 },
    oxygen: { min: 50, max: 100 },
    glucose: { min: 20, max: 800 },
    respiratory: { min: 2, max: 80 },
    pain: { min: 0, max: 10 },
  };
  const bounds = inputBounds[vitalType];

  return (
    <div
      className={cn(
        "rounded-lg border-2 p-4 space-y-3 transition-colors",
        cls.border,
        cls.bg,
      )}
    >
      {header}
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <NumberCell
            id={`${idPrefix}-value`}
            label="Reading"
            unit={VITAL_TYPE_UNIT[vitalType]}
            value={value.value ?? ""}
            onChange={(v) => onChange({ ...value, value: v })}
            range={range}
            error={error?.value}
            min={bounds?.min}
            max={bounds?.max}
          />
        </div>
        {showUnit && (
          <div role="group" aria-label="Unit" className="flex rounded-md border bg-white">
            {showUnit.map((u) => {
              const active = value.unit === u || (!value.unit && u === showUnit[0]);
              return (
                <button
                  key={u}
                  type="button"
                  onClick={() => onChange({ ...value, unit: u })}
                  className={cn(
                    "min-w-[40px] min-h-[40px] px-3 text-sm font-medium transition-colors first:rounded-l-md last:rounded-r-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300 active:scale-95",
                    active
                      ? "bg-indigo-600 text-white"
                      : "text-muted-foreground hover:bg-indigo-50",
                  )}
                  aria-pressed={active}
                >
                  {u}
                </button>
              );
            })}
          </div>
        )}
      </div>
      {vitalType === "pain" && (
        <p className="text-xs text-muted-foreground">
          0 = no pain · 10 = worst imaginable
        </p>
      )}
    </div>
  );
}

function NumberCell({
  id,
  label,
  unit,
  value,
  onChange,
  range,
  error,
  min,
  max,
}: {
  id: string;
  label: string;
  unit?: string;
  value: string;
  onChange: (next: string) => void;
  range: VitalRange;
  error?: string;
  min?: number;
  max?: number;
}) {
  const cls = RANGE_CLASSES[range];
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id} className={cn("text-xs font-medium", cls.text)}>
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        inputMode="decimal"
        value={value}
        min={min}
        max={max}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "h-12 text-2xl tabular-nums font-semibold border-2 bg-white transition-colors",
          cls.border,
          cls.text,
          cls.ring,
        )}
        aria-invalid={!!error}
      />
      {unit && <p className="text-[10px] text-muted-foreground">{unit}</p>}
      {error && (
        <p className="text-xs text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
