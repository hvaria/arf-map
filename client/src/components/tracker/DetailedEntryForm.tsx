/**
 * Generic config-driven detailed-entry form.
 *
 * For each `FieldDefinition` in `definition.detailedFields` we render the
 * matching input. Validation runs at submit time:
 *
 *   - Payload-only fields (anything not `residentId` / `shift` /
 *     `occurredAt`) are validated against `getPayloadSchema(slug)` from the
 *     shared registry (the client carries its own Zod copy — we never
 *     deserialize one from the wire).
 *   - Envelope fields (`residentId` if `requiresResident`, `shift` if any
 *     payload field of kind `shift` is required, `occurredAt`) are checked
 *     locally and surfaced as inline field errors.
 *
 * Submit posts to `/api/ops/trackers/:slug/entries` via `apiRequest` with a
 * `clientId` UUID minted once per form instance and reused across retries.
 */
import { useMemo, useRef, useState } from "react";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  ResidentSelector,
} from "./selectors/ResidentSelector";
import { ShiftToggle, deriveCurrentShift } from "./selectors/ShiftToggle";
import {
  makeClientId,
  useCreateTrackerEntry,
} from "@/lib/tracker/useTrackerMutation";
import {
  getPayloadSchema,
  type FieldDefinition,
  type SerializedTrackerDefinition,
  type Shift,
} from "@shared/tracker-schemas";

const ENVELOPE_NAMES = new Set(["residentId", "occurredAt"]);

type FormValues = Record<string, unknown>;

function defaultValueFor(field: FieldDefinition): unknown {
  switch (field.kind) {
    case "multiselect":
      return [];
    case "number":
      return "";
    case "datetime":
      return field.defaultsToNow ? new Date().toISOString().slice(0, 16) : "";
    case "shift":
      return deriveCurrentShift();
    default:
      return "";
  }
}

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

export function DetailedEntryForm({
  definition,
  date,
  shift,
  onSuccess,
}: {
  definition: SerializedTrackerDefinition;
  /** Local-day epoch ms — used to seed `occurredAt` if no datetime field is present. */
  date: number;
  /** Default shift from filter bar. */
  shift: Shift;
  onSuccess?: () => void;
}) {
  const { toast } = useToast();
  const createMutation = useCreateTrackerEntry(definition.slug);

  // Persist a single clientId for the lifetime of this form instance —
  // the backend uses it as the idempotency key on retries.
  const clientIdRef = useRef<string>(makeClientId());

  const initial = useMemo<FormValues>(() => {
    const out: FormValues = {};
    for (const f of definition.detailedFields) {
      if (f.name === "shift") out[f.name] = shift;
      else out[f.name] = defaultValueFor(f);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [definition.slug]);

  const [values, setValues] = useState<FormValues>(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  function setField(name: string, value: unknown) {
    setValues((v) => ({ ...v, [name]: value }));
    if (errors[name]) {
      setErrors((e) => {
        const { [name]: _drop, ...rest } = e;
        void _drop;
        return rest;
      });
    }
  }

  const requiresResident = definition.requiresResident !== false;

  function buildPayload(): {
    payload: Record<string, unknown>;
    residentId?: number;
    shiftValue?: Shift;
    occurredAt: number;
    fieldErrors: Record<string, string>;
  } {
    const payload: Record<string, unknown> = {};
    let residentId: number | undefined;
    let shiftValue: Shift | undefined;
    // Default occurredAt to noon of the picked date when no datetime field
    // is present in the form. A datetime/date field will overwrite below.
    let occurredAt: number = date + 12 * 60 * 60 * 1000;
    const fieldErrors: Record<string, string> = {};

    for (const f of definition.detailedFields) {
      const raw = values[f.name];
      if (f.name === "residentId") {
        if (typeof raw === "number") residentId = raw;
        else if (typeof raw === "string" && raw.trim() !== "") {
          const n = Number(raw);
          if (Number.isFinite(n)) residentId = n;
        }
        continue;
      }
      if (f.kind === "datetime") {
        const t = fromDatetimeLocalValue(typeof raw === "string" ? raw : "");
        occurredAt = t;
        continue;
      }
      if (f.kind === "date") {
        if (typeof raw === "string" && raw) {
          const t = new Date(raw).getTime();
          if (Number.isFinite(t)) occurredAt = t;
        }
        continue;
      }
      if (f.kind === "shift") {
        const v = typeof raw === "string" ? (raw as Shift) : undefined;
        if (v) shiftValue = v;
        // We don't store shift in payload here because for ADL the shared
        // schema *does* expect it inside payload. Keep both:
        payload[f.name] = v ?? deriveCurrentShift();
        continue;
      }
      if (f.kind === "number") {
        if (raw === "" || raw === null || raw === undefined) {
          if (f.required) fieldErrors[f.name] = "Required";
          continue;
        }
        const n = Number(raw);
        if (!Number.isFinite(n)) {
          fieldErrors[f.name] = "Must be a number";
          continue;
        }
        payload[f.name] = n;
        continue;
      }
      if (f.kind === "multiselect") {
        const arr = Array.isArray(raw) ? raw : [];
        if (f.required && arr.length === 0) {
          fieldErrors[f.name] = "Pick at least one option";
          continue;
        }
        payload[f.name] = arr;
        continue;
      }
      // text/textarea/select/goal — string-valued.
      if (raw === "" || raw === null || raw === undefined) {
        if (f.required) fieldErrors[f.name] = "Required";
        continue;
      }
      payload[f.name] = raw;
    }

    if (requiresResident && residentId === undefined) {
      fieldErrors.residentId = "Required";
    }

    return { payload, residentId, shiftValue, occurredAt, fieldErrors };
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const { payload, residentId, shiftValue, occurredAt, fieldErrors } =
      buildPayload();

    // Run the per-tracker payload schema (client-side mirror of server).
    const schema = getPayloadSchema(definition.slug);
    if (schema) {
      const parsed = schema.safeParse(payload);
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          const field = issue.path[0];
          if (typeof field === "string" && !fieldErrors[field]) {
            fieldErrors[field] = issue.message;
          }
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
        occurredAt,
        payload,
      },
      {
        onSuccess: (resp) => {
          toast({
            title: resp.duplicate ? "Already saved" : "Entry saved",
            description: resp.duplicate
              ? "This entry was previously recorded."
              : undefined,
          });
          // Reset for a new entry — fresh clientId.
          clientIdRef.current = makeClientId();
          setValues(initial);
          setErrors({});
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

  return (
    <form
      onSubmit={onSubmit}
      className="space-y-4 max-w-xl"
      noValidate
      aria-label={`${definition.name} detailed entry`}
    >
      {definition.detailedFields.map((field) => (
        <FieldRenderer
          key={field.name}
          field={field}
          definition={definition}
          value={values[field.name]}
          onChange={(v) => setField(field.name, v)}
          error={errors[field.name]}
        />
      ))}

      <div className="flex items-center gap-2 pt-2">
        <Button type="submit" disabled={createMutation.isPending}>
          {createMutation.isPending ? "Saving…" : "Save entry"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => {
            clientIdRef.current = makeClientId();
            setValues(initial);
            setErrors({});
          }}
          disabled={createMutation.isPending}
        >
          Reset
        </Button>
      </div>
    </form>
  );
}

function FieldRenderer({
  field,
  definition,
  value,
  onChange,
  error,
}: {
  field: FieldDefinition;
  definition: SerializedTrackerDefinition;
  value: unknown;
  onChange: (next: unknown) => void;
  error?: string;
}) {
  const id = `tracker-field-${field.name}`;
  const labelEl = (
    <Label htmlFor={id} className="text-sm font-medium">
      {field.label}
      {field.required && <span className="text-red-600 ml-1">*</span>}
    </Label>
  );
  const helpEl = field.helpText ? (
    <p className="text-xs text-muted-foreground">{field.helpText}</p>
  ) : null;
  const errEl = error ? (
    <p className="text-xs text-red-600" role="alert">
      {error}
    </p>
  ) : null;

  switch (field.kind) {
    case "text":
      return (
        <div className="space-y-1.5">
          {labelEl}
          <Input
            id={id}
            type="text"
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder}
            maxLength={field.maxLength}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={!!error}
          />
          {helpEl}
          {errEl}
        </div>
      );
    case "textarea":
      return (
        <div className="space-y-1.5">
          {labelEl}
          <Textarea
            id={id}
            value={typeof value === "string" ? value : ""}
            placeholder={field.placeholder}
            maxLength={field.maxLength}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={!!error}
            rows={3}
          />
          {helpEl}
          {errEl}
        </div>
      );
    case "number":
      return (
        <div className="space-y-1.5">
          {labelEl}
          <Input
            id={id}
            type="number"
            value={typeof value === "number" || typeof value === "string" ? String(value) : ""}
            min={field.min}
            max={field.max}
            step={field.step}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={!!error}
          />
          {field.unit && (
            <p className="text-xs text-muted-foreground">{field.unit}</p>
          )}
          {helpEl}
          {errEl}
        </div>
      );
    case "select":
      return (
        <div className="space-y-1.5">
          {labelEl}
          <select
            id={id}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            aria-invalid={!!error}
          >
            <option value="" disabled={field.required}>
              Select…
            </option>
            {field.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          {helpEl}
          {errEl}
        </div>
      );
    case "multiselect": {
      const current = Array.isArray(value) ? (value as string[]) : [];
      return (
        <div className="space-y-1.5">
          {labelEl}
          <div className="flex flex-wrap gap-2">
            {field.options.map((o) => {
              const checked = current.includes(o.value);
              return (
                <label
                  key={o.value}
                  className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-sm cursor-pointer hover:bg-indigo-50"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      const next = e.target.checked
                        ? [...current, o.value]
                        : current.filter((v) => v !== o.value);
                      onChange(next);
                    }}
                  />
                  {o.label}
                </label>
              );
            })}
          </div>
          {helpEl}
          {errEl}
        </div>
      );
    }
    case "date":
      return (
        <div className="space-y-1.5">
          {labelEl}
          <Input
            id={id}
            type="date"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={!!error}
          />
          {helpEl}
          {errEl}
        </div>
      );
    case "datetime": {
      const v =
        typeof value === "string" && value
          ? value
          : field.defaultsToNow
            ? toDatetimeLocalValue(Date.now())
            : "";
      return (
        <div className="space-y-1.5">
          {labelEl}
          <Input
            id={id}
            type="datetime-local"
            value={v}
            onChange={(e) => onChange(e.target.value)}
            aria-invalid={!!error}
          />
          {helpEl}
          {errEl}
        </div>
      );
    }
    case "shift":
      return (
        <div className="space-y-1.5">
          {labelEl}
          <ShiftToggle
            value={(typeof value === "string" ? value : deriveCurrentShift()) as Shift}
            onChange={(s) => onChange(s)}
            ariaLabel={field.label}
          />
          {helpEl}
          {errEl}
        </div>
      );
    case "resident":
      return (
        <div className="space-y-1.5">
          {labelEl}
          <ResidentSelector
            id={id}
            value={typeof value === "number" ? value : undefined}
            onChange={(v) => onChange(v)}
            required={field.required}
          />
          {helpEl}
          {errEl}
        </div>
      );
    case "goal": {
      // Inline goals come from the definition's quick grid rows.
      // `assessments` mode is deferred — fall back to inline for now.
      const inlineGoals = definition.quickGrid?.rows ?? [];
      return (
        <div className="space-y-1.5">
          {labelEl}
          <select
            id={id}
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            className="w-full h-10 px-3 rounded-md border border-input bg-background text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            aria-invalid={!!error}
          >
            <option value="" disabled={field.required}>
              Select goal…
            </option>
            {inlineGoals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
          {field.goalsRef === "assessments" && (
            <p className="text-xs text-muted-foreground">
              Showing all goals — per-resident filtering will arrive once
              assessment-derived goals ship.
            </p>
          )}
          {helpEl}
          {errEl}
        </div>
      );
    }
    default: {
      // Exhaustiveness guard.
      const _exhaustive: never = field;
      void _exhaustive;
      return null;
    }
  }
}

// Silence unused-import lint for ENVELOPE_NAMES (kept for future fields
// that may sit outside the payload — useful when more trackers ship).
void ENVELOPE_NAMES;
