/**
 * ToiletingDetailedForm — Detailed entry form for the Toileting tracker.
 *
 * The caregiver picks BM or Urine at the top; the matching specialized
 * renderer (`BristolScale` or `UrineColorScale`) appears below. Optional
 * datetime + note + shift round out the envelope.
 */
import { useRef, useState, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Save, Check, Loader2, Droplets } from "lucide-react";
import { ResidentSelector } from "../selectors/ResidentSelector";
import { ShiftToggle, deriveCurrentShift } from "../selectors/ShiftToggle";
import {
  makeClientId,
  useCreateTrackerEntry,
} from "@/lib/tracker/useTrackerMutation";
import { cn } from "@/lib/utils";
import { BristolScale } from "./BristolScale";
import { UrineColorScale } from "./UrineColorScale";
import {
  toiletingEntryPayloadSchema,
  URINE_METHODS,
  URINE_OUTPUTS,
  URINE_SMELLS,
  type BristolType,
  type SerializedTrackerDefinition,
  type Shift,
  type UrineColor,
  type UrineMethod,
  type UrineOutput,
  type UrineSmell,
} from "@shared/tracker-schemas";

type EventType = "bm" | "urine";

type Errors = Partial<{
  residentId: string;
  bristol: string;
  color: string;
  output: string;
  smell: string;
  method: string;
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

const OUTPUT_LABEL: Record<UrineOutput, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};
const SMELL_LABEL: Record<UrineSmell, string> = {
  normal: "Normal",
  strong: "Strong",
  foul: "Foul",
};
const METHOD_LABEL: Record<UrineMethod, string> = {
  toilet: "Toilet",
  brief: "Brief",
  commode: "Commode",
  catheter: "Catheter",
  urinal: "Urinal",
  ostomy: "Ostomy",
};

export function ToiletingDetailedForm({
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
  const [eventType, setEventType] = useState<EventType>("bm");
  const [bristol, setBristol] = useState<BristolType | undefined>(undefined);
  const [color, setColor] = useState<UrineColor | undefined>(undefined);
  const [output, setOutput] = useState<UrineOutput>("medium");
  const [smell, setSmell] = useState<UrineSmell>("normal");
  const [method, setMethod] = useState<UrineMethod>("toilet");
  const [occurredAtLocal, setOccurredAtLocal] = useState<string>(
    toDatetimeLocalValue(date + 12 * 60 * 60 * 1000),
  );
  const [note, setNote] = useState<string>("");
  const [shiftValue, setShiftValue] = useState<Shift>(shift);
  const [errors, setErrors] = useState<Errors>({});
  const [savedFlash, setSavedFlash] = useState(false);

  // Reset event-specific selections when the event type flips.
  useEffect(() => {
    setBristol(undefined);
    setColor(undefined);
    setErrors((e) => ({ ...e, bristol: undefined, color: undefined }));
  }, [eventType]);

  function buildPayload(): { payload: unknown; fieldErrors: Errors } {
    const fieldErrors: Errors = {};
    const noteValue = note.trim() === "" ? undefined : note.trim();

    if (residentId === undefined) {
      fieldErrors.residentId = "Required";
    }

    let payload: unknown;
    if (eventType === "bm") {
      if (bristol === undefined) {
        fieldErrors.bristol = "Pick a Bristol type";
      }
      payload = {
        event_type: "bm",
        bristol: bristol ?? 4,
        note: noteValue,
      };
    } else {
      if (color === undefined) {
        fieldErrors.color = "Pick a color";
      }
      payload = {
        event_type: "urine",
        color: color ?? "yellow",
        output,
        smell,
        method,
        note: noteValue,
      };
    }
    return { payload, fieldErrors };
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { payload, fieldErrors } = buildPayload();

    const parsed = toiletingEntryPayloadSchema.safeParse(payload);
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
            title: resp.duplicate ? "Already saved" : "Toileting saved",
            description: resp.duplicate
              ? "This entry was previously recorded."
              : undefined,
          });
          clientIdRef.current = makeClientId();
          setBristol(undefined);
          setColor(undefined);
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
      className="space-y-4 max-w-3xl"
      noValidate
      aria-label={`${definition.name} detailed entry`}
    >
      <div className="space-y-1.5">
        <Label htmlFor="toileting-resident" className="text-sm font-medium">
          Resident<span className="text-red-600 ml-1">*</span>
        </Label>
        <ResidentSelector
          id="toileting-resident"
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

      <div>
        <Label className="text-sm font-medium mb-1.5 inline-flex items-center gap-1.5">
          <Droplets className="h-3.5 w-3.5" />
          Event type
          <span className="text-red-600 ml-1">*</span>
        </Label>
        <div role="tablist" aria-label="Event type" className="inline-flex rounded-md border bg-white p-1">
          {(["bm", "urine"] as EventType[]).map((t) => {
            const active = t === eventType;
            return (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setEventType(t)}
                className={cn(
                  "min-h-[40px] px-4 rounded-sm text-sm font-medium transition-colors active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
                  active
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "text-muted-foreground hover:bg-indigo-50",
                )}
              >
                {t === "bm" ? "Bowel movement" : "Urine"}
              </button>
            );
          })}
        </div>
      </div>

      {eventType === "bm" ? (
        <div className="space-y-1.5">
          <Label className="text-sm font-medium">Bristol stool type<span className="text-red-600 ml-1">*</span></Label>
          <BristolScale value={bristol} onChange={setBristol} error={errors.bristol} />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label className="text-sm font-medium">Color<span className="text-red-600 ml-1">*</span></Label>
            <UrineColorScale value={color} onChange={setColor} error={errors.color} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <SegmentedSelect
              label="Output"
              value={output}
              onChange={(v) => setOutput(v as UrineOutput)}
              options={URINE_OUTPUTS.map((v) => ({ value: v, label: OUTPUT_LABEL[v] }))}
            />
            <SegmentedSelect
              label="Smell"
              value={smell}
              onChange={(v) => setSmell(v as UrineSmell)}
              options={URINE_SMELLS.map((v) => ({ value: v, label: SMELL_LABEL[v] }))}
            />
            <SegmentedSelect
              label="Method"
              value={method}
              onChange={(v) => setMethod(v as UrineMethod)}
              options={URINE_METHODS.map((v) => ({ value: v, label: METHOD_LABEL[v] }))}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="toileting-occurred" className="text-sm font-medium">
            Occurred at
          </Label>
          <Input
            id="toileting-occurred"
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
        <Label htmlFor="toileting-note" className="text-sm font-medium">
          Note
        </Label>
        <Textarea
          id="toileting-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          maxLength={500}
          placeholder="Optional context"
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
            setBristol(undefined);
            setColor(undefined);
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

function SegmentedSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-sm font-medium">{label}</Label>
      <div role="group" aria-label={label} className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onChange(o.value)}
              aria-pressed={active}
              className={cn(
                "min-h-[40px] px-3 rounded-md border text-sm font-medium transition-colors active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-300",
                active
                  ? "bg-indigo-600 text-white border-indigo-600"
                  : "bg-white text-muted-foreground hover:bg-indigo-50",
              )}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
