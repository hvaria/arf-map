/**
 * VitalsDetailedForm — Detailed entry form for the Vitals tracker.
 *
 * Composition:
 *   • ResidentSelector
 *   • Vital-type select (8 options)
 *   • VitalsRangeInput — switches input shape per vital type, with live
 *     range coloring driven by `classifyVitalRange`
 *   • Optional datetime + note + shift
 *   • Save button with spinner → checkmark transition
 *
 * Validation runs the discriminated union from `vitalsEntryPayloadSchema`.
 */
import { useRef, useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Save, Check, Loader2, Activity } from "lucide-react";
import { ResidentSelector } from "../selectors/ResidentSelector";
import { ShiftToggle, deriveCurrentShift } from "../selectors/ShiftToggle";
import {
  makeClientId,
  useCreateTrackerEntry,
} from "@/lib/tracker/useTrackerMutation";
import { cn } from "@/lib/utils";
import {
  VitalsRangeInput,
  type VitalsValue,
} from "./VitalsRangeInput";
import {
  vitalsEntryPayloadSchema,
  VITAL_TYPES,
  VITAL_TYPE_LABEL,
  type SerializedTrackerDefinition,
  type Shift,
  type VitalType,
} from "@shared/tracker-schemas";

type Errors = Partial<{
  residentId: string;
  vital_type: string;
  systolic: string;
  diastolic: string;
  value: string;
  note: string;
}>;

function toDatetimeLocalValue(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocalValue(value: string): number {
  if (!value) return Date.now();
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : Date.now();
}

export function VitalsDetailedForm({
  definition,
  date,
  shift,
  onSuccess,
}: {
  definition: SerializedTrackerDefinition;
  date: number;
  shift: Shift;
  onSuccess?: () => void;
}) {
  const { toast } = useToast();
  const createMutation = useCreateTrackerEntry(definition.slug);
  const clientIdRef = useRef<string>(makeClientId());

  const [residentId, setResidentId] = useState<number | undefined>(undefined);
  const [vitalType, setVitalType] = useState<VitalType>("bp");
  const [vitals, setVitals] = useState<VitalsValue>({});
  const [occurredAtLocal, setOccurredAtLocal] = useState<string>(
    toDatetimeLocalValue(date + 12 * 60 * 60 * 1000),
  );
  const [note, setNote] = useState<string>("");
  const [shiftValue, setShiftValue] = useState<Shift>(shift);
  const [errors, setErrors] = useState<Errors>({});
  const [savedFlash, setSavedFlash] = useState(false);

  // Reset the per-vital values when the vital type changes — different
  // shapes shouldn't bleed into each other.
  useEffect(() => {
    setVitals({});
    setErrors((e) => ({ ...e, systolic: undefined, diastolic: undefined, value: undefined }));
  }, [vitalType]);

  function buildPayload(): { payload: unknown; fieldErrors: Errors } {
    const fieldErrors: Errors = {};
    const noteValue = note.trim() === "" ? undefined : note.trim();

    if (residentId === undefined) {
      fieldErrors.residentId = "Required";
    }

    let payload: unknown = null;

    if (vitalType === "bp") {
      const sys = Number(vitals.systolic);
      const dia = Number(vitals.diastolic);
      if (!Number.isFinite(sys)) fieldErrors.systolic = "Required";
      if (!Number.isFinite(dia)) fieldErrors.diastolic = "Required";
      payload = {
        vital_type: "bp",
        systolic: Number.isFinite(sys) ? Math.round(sys) : 0,
        diastolic: Number.isFinite(dia) ? Math.round(dia) : 0,
        note: noteValue,
      };
    } else if (vitalType === "weight") {
      const v = Number(vitals.value);
      if (!Number.isFinite(v)) fieldErrors.value = "Required";
      payload = {
        vital_type: "weight",
        value: Number.isFinite(v) ? v : 0,
        unit: vitals.unit === "kg" ? "kg" : "lb",
        note: noteValue,
      };
    } else if (vitalType === "temperature") {
      const v = Number(vitals.value);
      if (!Number.isFinite(v)) fieldErrors.value = "Required";
      payload = {
        vital_type: "temperature",
        value: Number.isFinite(v) ? v : 0,
        unit: vitals.unit === "C" ? "C" : "F",
        note: noteValue,
      };
    } else {
      const v = Number(vitals.value);
      if (!Number.isFinite(v)) fieldErrors.value = "Required";
      // Pulse/oxygen/glucose/respiratory/pain — all integer-valued.
      const intV = Number.isFinite(v) ? Math.round(v) : 0;
      payload = {
        vital_type: vitalType,
        value: intV,
        note: noteValue,
      };
    }

    return { payload, fieldErrors };
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { payload, fieldErrors } = buildPayload();

    const parsed = vitalsEntryPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const k = String(issue.path[0] ?? "");
        if (k && !fieldErrors[k as keyof Errors]) {
          (fieldErrors as Record<string, string>)[k] = issue.message;
        }
      }
    }

    if (Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }
    setErrors({});

    createMutation.mutate(
      {
        clientId: clientIdRef.current,
        residentId,
        shift: shiftValue,
        occurredAt: fromDatetimeLocalValue(occurredAtLocal),
        payload,
      },
      {
        onSuccess: (resp) => {
          toast({
            title: resp.duplicate ? "Already saved" : "Vitals saved",
            description: resp.duplicate
              ? "This entry was previously recorded."
              : undefined,
          });
          clientIdRef.current = makeClientId();
          setVitals({});
          setNote("");
          setErrors({});
          setSavedFlash(true);
          window.setTimeout(() => setSavedFlash(false), 1100);
          onSuccess?.();
        },
        onError: (err) => {
          toast({
            title: "Couldn't save",
            description: err.message,
            variant: "destructive",
          });
        },
      },
    );
  }

  const saving = createMutation.isPending;

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 max-w-2xl"
      noValidate
      aria-label={`${definition.name} detailed entry`}
    >
      <div className="space-y-1.5">
        <Label htmlFor="vitals-resident" className="text-sm font-medium">
          Resident<span className="text-red-600 ml-1">*</span>
        </Label>
        <ResidentSelector
          id="vitals-resident"
          value={residentId}
          onChange={setResidentId}
          required
        />
        {errors.residentId && (
          <p className="text-xs text-red-600" role="alert">
            {errors.residentId}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="vitals-type" className="text-sm font-medium">
          <span className="inline-flex items-center gap-1.5">
            <Activity className="h-3.5 w-3.5" />
            Vital
          </span>
          <span className="text-red-600 ml-1">*</span>
        </Label>
        <select
          id="vitals-type"
          value={vitalType}
          onChange={(e) => setVitalType(e.target.value as VitalType)}
          className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300"
        >
          {VITAL_TYPES.map((v) => (
            <option key={v} value={v}>
              {VITAL_TYPE_LABEL[v]}
            </option>
          ))}
        </select>
      </div>

      <VitalsRangeInput
        vitalType={vitalType}
        value={vitals}
        onChange={setVitals}
        error={{
          systolic: errors.systolic,
          diastolic: errors.diastolic,
          value: errors.value,
        }}
      />

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="vitals-occurred" className="text-sm font-medium">
            Recorded at
          </Label>
          <Input
            id="vitals-occurred"
            type="datetime-local"
            value={occurredAtLocal}
            onChange={(e) => setOccurredAtLocal(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Shift</Label>
          <ShiftToggle
            value={shiftValue || deriveCurrentShift()}
            onChange={setShiftValue}
            ariaLabel="Shift"
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="vitals-note" className="text-sm font-medium">
          Note
        </Label>
        <Textarea
          id="vitals-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Optional context — symptoms, position, repeat reading, etc."
          rows={3}
        />
      </div>

      <div className="flex items-center gap-2 pt-2">
        <Button
          type="submit"
          disabled={saving}
          className={cn(
            "min-w-[140px] gap-1.5 transition-colors",
            savedFlash && "bg-emerald-600 hover:bg-emerald-600",
          )}
        >
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Saving…
            </>
          ) : savedFlash ? (
            <>
              <Check className="h-4 w-4" />
              Saved
            </>
          ) : (
            <>
              <Save className="h-4 w-4" />
              Save entry
            </>
          )}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            clientIdRef.current = makeClientId();
            setVitals({});
            setNote("");
            setErrors({});
          }}
          disabled={saving}
        >
          Reset
        </Button>
      </div>
    </form>
  );
}
