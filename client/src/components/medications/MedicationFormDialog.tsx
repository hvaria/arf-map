import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import {
  MEDICATION_FREQUENCY,
  defaultScheduledTimes,
  frequencyRequiresTimes,
  validateFrequencyTimesConsistency,
  isKnownFrequency,
  type MedicationFrequency,
} from "@shared/medication-constants";
import { ScheduledTimeChips } from "./ScheduledTimeChips";

export interface MedicationFormValue {
  id?: number;
  drugName: string;
  dosage: string;
  route: string;
  frequency: MedicationFrequency | "";
  frequencyRaw?: string | null;
  scheduledTimes: string[];
  prescriberName: string;
}

interface MedicationFormDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  residentId: string;
  facilityNumber: string;
  initialValue?: MedicationFormValue;
}

const ROUTE_OPTIONS = [
  { value: "oral", label: "Oral" },
  { value: "topical", label: "Topical" },
  { value: "sublingual", label: "Sublingual" },
  { value: "injectable", label: "Injectable" },
  { value: "inhaled", label: "Inhaled" },
  { value: "other", label: "Other" },
];

function emptyForm(): MedicationFormValue {
  return {
    drugName: "",
    dosage: "",
    route: "",
    frequency: "",
    scheduledTimes: [],
    prescriberName: "",
  };
}

export function MedicationFormDialog({
  open,
  onOpenChange,
  mode,
  residentId,
  facilityNumber,
  initialValue,
}: MedicationFormDialogProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<MedicationFormValue>(emptyForm());
  const [errors, setErrors] = useState<Partial<Record<keyof MedicationFormValue, string>>>({});

  // Prefill on open / when initialValue changes.
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && initialValue) {
      setForm({
        ...initialValue,
        // Defensive: if server hasn't normalized, accept either shape.
        frequency: isKnownFrequency(initialValue.frequency) ? initialValue.frequency : "other",
        scheduledTimes: initialValue.scheduledTimes ?? [],
      });
    } else {
      setForm(emptyForm());
    }
    setErrors({});
  }, [open, mode, initialValue]);

  const isLegacyFrequency =
    mode === "edit" && form.frequency === "other" && !!initialValue?.frequencyRaw;

  function set<K extends keyof MedicationFormValue>(key: K, value: MedicationFormValue[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  function onFrequencyChange(value: string) {
    const next = value as MedicationFrequency;
    setForm((f) => {
      const wasPrn = f.frequency === "prn";
      const becomingPrn = next === "prn";
      // If switching frequency, auto-populate times from defaults so caregivers
      // don't start with an empty grid. They can still edit. If becoming PRN,
      // clear times. If returning from PRN, populate defaults.
      let nextTimes = f.scheduledTimes;
      if (becomingPrn) {
        nextTimes = [];
      } else if (wasPrn || f.scheduledTimes.length === 0) {
        nextTimes = defaultScheduledTimes(next);
      }
      return { ...f, frequency: next, scheduledTimes: nextTimes };
    });
    setErrors((e) => ({ ...e, frequency: undefined, scheduledTimes: undefined }));
  }

  function validate(): boolean {
    const errs: Partial<Record<keyof MedicationFormValue, string>> = {};
    if (!form.drugName.trim()) errs.drugName = "Enter the medication name.";
    if (!form.dosage.trim()) errs.dosage = "Enter a dosage (e.g. 10 mg, 5 mL).";
    if (!form.route) errs.route = "Choose how this medication is given.";
    if (!form.frequency) errs.frequency = "Choose how often this medication is given.";
    if (form.frequency === "other") {
      errs.frequency = "Choose a standard frequency before saving.";
    }
    if (form.frequency && form.frequency !== "other") {
      const r = validateFrequencyTimesConsistency(
        form.frequency as MedicationFrequency,
        form.scheduledTimes,
      );
      if (!r.ok) errs.scheduledTimes = r.message;
    }
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        drugName: form.drugName.trim(),
        dosage: form.dosage.trim(),
        route: form.route,
        frequency: form.frequency,
        scheduledTimes: form.scheduledTimes,
        prescriberName: form.prescriberName.trim() || undefined,
        // Keep isPrn flag aligned with frequency so med-pass generation skips correctly.
        isPrn: form.frequency === "prn" ? 1 : 0,
      };
      if (mode === "create") {
        const res = await apiRequest(
          "POST",
          `/api/ops/facilities/${facilityNumber}/residents/${residentId}/medications`,
          body,
        );
        return res.json();
      } else {
        const res = await apiRequest("PUT", `/api/ops/medications/${initialValue!.id}`, body);
        return res.json();
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentId}/medications`],
      });
      toast({ title: mode === "create" ? "Medication added" : "Medication updated" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  function onSubmit() {
    if (!validate()) return;
    mutation.mutate();
  }

  const requiresTimes = form.frequency
    ? frequencyRequiresTimes(form.frequency as MedicationFrequency)
    : true;
  const suggestedCount = form.frequency
    ? MEDICATION_FREQUENCY.find((f) => f.value === form.frequency)?.defaultTimeCount
    : undefined;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{mode === "create" ? "Add Medication" : "Edit Medication"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="med-drug-name">Drug Name</Label>
            <Input
              id="med-drug-name"
              value={form.drugName}
              onChange={(e) => set("drugName", e.target.value)}
              placeholder="e.g. Lisinopril"
              aria-invalid={!!errors.drugName}
            />
            {errors.drugName && <p className="text-xs text-destructive">{errors.drugName}</p>}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="med-dosage">Dosage</Label>
              <Input
                id="med-dosage"
                value={form.dosage}
                onChange={(e) => set("dosage", e.target.value)}
                placeholder="e.g. 10 mg"
                aria-invalid={!!errors.dosage}
              />
              {errors.dosage && <p className="text-xs text-destructive">{errors.dosage}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="med-route">Route</Label>
              <Select value={form.route} onValueChange={(v) => set("route", v)}>
                <SelectTrigger id="med-route" aria-label="Route" aria-invalid={!!errors.route}>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {ROUTE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.route && <p className="text-xs text-destructive">{errors.route}</p>}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="med-frequency">Frequency</Label>
              <Select
                value={!form.frequency || form.frequency === "other" ? undefined : form.frequency}
                onValueChange={onFrequencyChange}
              >
                <SelectTrigger id="med-frequency" aria-label="Frequency" aria-invalid={!!errors.frequency}>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  {MEDICATION_FREQUENCY.filter((f) => f.value !== "other").map((f) => (
                    <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {errors.frequency && <p className="text-xs text-destructive">{errors.frequency}</p>}
              {isLegacyFrequency && (
                <p className="text-xs text-muted-foreground">
                  Legacy value: <span className="italic">"{initialValue?.frequencyRaw}"</span>. Choose a standard frequency.
                </p>
              )}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="med-prescriber">Prescriber</Label>
              <Input
                id="med-prescriber"
                value={form.prescriberName}
                onChange={(e) => set("prescriberName", e.target.value)}
                placeholder="Dr. Smith"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Scheduled Times</Label>
            <ScheduledTimeChips
              value={form.scheduledTimes}
              onChange={(next) => set("scheduledTimes", next)}
              suggestedCount={suggestedCount}
              disabled={!requiresTimes}
              ariaLabel="Scheduled administration times"
              error={errors.scheduledTimes ?? null}
            />
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="gradient"
              onClick={onSubmit}
              disabled={mutation.isPending}
            >
              {mutation.isPending
                ? (mode === "create" ? "Adding..." : "Saving...")
                : (mode === "create" ? "Add Medication" : "Save Changes")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
