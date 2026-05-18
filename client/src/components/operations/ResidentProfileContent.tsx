import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { ArrowLeft, Pencil, Plus, Check, X, UserMinus, UserCheck } from "lucide-react";
import { MedicationFormDialog, type MedicationFormValue } from "@/components/medications/MedicationFormDialog";
import {
  DISCONTINUE_REASON_LABELS,
  MEDICATION_DISCONTINUE_REASONS,
  type MedicationDiscontinueReason,
} from "@shared/medication-constants";
import { AddTaskDialog } from "@/components/operations/AddTaskDialog";
import { ChartCompletenessPanel } from "@/components/operations/ChartCompletenessBanner";
import { useChartCompletenessForResident } from "@/hooks/useChartCompleteness";
import { useIsWritable } from "@/context/AuditorContext";
import { IncidentCard } from "@/components/incidents/IncidentCard";

interface Resident {
  id: number;
  facilityNumber: string;
  firstName: string;
  lastName: string;
  dob: number;
  gender: string;
  roomNumber: string;
  admissionDate: number;
  primaryDx: string;
  levelOfCare: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  fundingSource: string;
  status: string;
}

interface Assessment {
  id: number;
  assessedAt: number;
  bathing: number;
  dressing: number;
  grooming: number;
  toileting: number;
  eating: number;
  mobility: number;
  transfers: number;
  cognitionScore: number;
  fallRiskLevel: string;
  assessedBy: string;
}

interface CarePlan {
  id: number;
  status: string;
  goal: string;
  intervention: string;
  frequency: string;
  // Server stores presence as text; signatureDate is a single shared timestamp
  // updated by whichever signer signed most recently. Display logic treats the
  // signature *string* as the authoritative "is signed" flag and falls back to
  // signatureDate / updatedAt for display.
  digitalSignatureResident?: string | null;
  digitalSignatureFamily?: string | null;
  signatureDate?: number | null;
  updatedAt?: number | null;
}

interface DailyTask {
  id: number;
  description: string;
  // Wire name matches the server's ops_daily_tasks.task_date column
  // (Drizzle camelCase). The legacy `scheduledDate` field was a
  // client-side typo that silently broke the today filter below.
  taskDate: number;
  status: string;
}

interface Medication {
  id: number;
  drugName: string;
  dosage: string;
  route: string;
  frequency: string;             // canonical enum value (server-normalized)
  frequencyLabel: string;        // human-readable label
  frequencyRaw: string | null;   // legacy text if non-canonical, else null
  scheduledTimes: string | null; // legacy comma-joined display field
  scheduledTimesArray: string[]; // structured form-friendly field
  status: string;
  prescriberName: string | null;
}

interface Incident {
  id: number;
  incidentType: string;
  incidentDate: number;
  description: string;
  status: string;
  reportedBy: string;
  // Server-derived severity (W4 Incident Lifecycle). Optional so older
  // server builds without the column still type-check; the IncidentCard
  // header hides the badge when absent.
  eventSeverity?: "serious" | "non_emergent" | null;
}

function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-3 px-4 py-3 text-sm border-b last:border-b-0">
      <span className="text-muted-foreground w-40 shrink-0">{label}</span>
      <span>{value || <span className="text-muted-foreground italic">Not set</span>}</span>
    </div>
  );
}

function AssessmentDialog({
  open,
  onOpenChange,
  residentId,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  residentId: string;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    assessmentType: "adl",
    assessedBy: "",
    bathing: "3",
    dressing: "3",
    grooming: "3",
    toileting: "3",
    eating: "3",
    mobility: "3",
    transfers: "3",
    cognitionScore: "24",
    fallRiskLevel: "low",
  });

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/ops/facilities/${facilityNumber}/residents/${residentId}/assessments`,
        {
          assessmentType: form.assessmentType,
          assessedBy: form.assessedBy,
          assessedAt: Date.now(),
          bathing: Number(form.bathing),
          dressing: Number(form.dressing),
          grooming: Number(form.grooming),
          toileting: Number(form.toileting),
          eating: Number(form.eating),
          mobility: Number(form.mobility),
          transfers: Number(form.transfers),
          cognitionScore: Number(form.cognitionScore),
          fallRiskLevel: form.fallRiskLevel,
        }
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentId}/assessments`] });
      toast({ title: "Assessment saved" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const adlFields: Array<[keyof typeof form, string]> = [
    ["bathing", "Bathing"],
    ["dressing", "Dressing"],
    ["grooming", "Grooming"],
    ["toileting", "Toileting"],
    ["eating", "Eating"],
    ["mobility", "Mobility"],
    ["transfers", "Transfers"],
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>New Assessment</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Assessment Type</Label>
            <Select value={form.assessmentType} onValueChange={(v) => set("assessmentType", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="adl">ADL</SelectItem>
                <SelectItem value="annual">Annual</SelectItem>
                <SelectItem value="quarterly">Quarterly</SelectItem>
                <SelectItem value="admission">Admission</SelectItem>
                <SelectItem value="change_in_condition">Change in Condition</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Assessed By</Label>
            <Input value={form.assessedBy} onChange={(e) => set("assessedBy", e.target.value)} placeholder="Staff name" />
          </div>
          <p className="text-xs text-muted-foreground">Score each ADL: 1=Total Assist, 2=Max Assist, 3=Mod Assist, 4=Min Assist, 5=Independent</p>
          {adlFields.map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <Label>{label}</Label>
              <Select value={form[key]} onValueChange={(v) => set(key, v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {["1", "2", "3", "4", "5"].map((n) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ))}
          <div className="space-y-1.5">
            <Label>Cognition Score (MMSE 0-30)</Label>
            <Input
              type="number"
              min={0}
              max={30}
              value={form.cognitionScore}
              onChange={(e) => set("cognitionScore", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Fall Risk Level</Label>
            <Select value={form.fallRiskLevel} onValueChange={(v) => set("fallRiskLevel", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="low">Low</SelectItem>
                <SelectItem value="medium">Medium</SelectItem>
                <SelectItem value="high">High</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="gradient"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !form.assessedBy}
            >
              {mutation.isPending ? "Saving..." : "Save Assessment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DiscontinueMedDialog({
  open,
  onOpenChange,
  medication,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  medication: Medication | null;
  onConfirm: (input: { reason: MedicationDiscontinueReason; reasonNote?: string }) => void;
  pending: boolean;
}) {
  const [reason, setReason] = useState<MedicationDiscontinueReason>("completed_course");
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) {
      setReason("completed_course");
      setNote("");
    }
  }, [open]);

  if (!medication) return null;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discontinue {medication.drugName}?</AlertDialogTitle>
          <AlertDialogDescription>
            This medication will no longer appear in the active list. Past administrations and refill history are kept.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Reason</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as MedicationDiscontinueReason)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEDICATION_DISCONTINUE_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{DISCONTINUE_REASON_LABELS[r]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {reason === "other" && (
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a brief note" />
            </div>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              onConfirm({ reason, reasonNote: reason === "other" ? note.trim() || undefined : undefined });
            }}
          >
            {pending ? "Discontinuing..." : "Discontinue"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function CreateCarePlanDialog({
  open,
  onOpenChange,
  residentId,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  residentId: string;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({ goal: "", intervention: "", frequency: "Daily", createdBy: "Staff" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const now = Date.now();
      const res = await apiRequest("POST", `/api/ops/residents/${residentId}/care-plan`, {
        ...form,
        effectiveDate: now,
        reviewDate: now + 90 * 86400000,
        status: "active",
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentId}/care-plan`] });
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentId}/daily-tasks`] });
      toast({ title: "Care plan created" });
      onOpenChange(false);
      setForm({ goal: "", intervention: "", frequency: "Daily", createdBy: "Staff" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Create Care Plan</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Goal</Label>
            <Textarea value={form.goal} onChange={(e) => set("goal", e.target.value)} placeholder="e.g. Maintain ADL independence" rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Intervention</Label>
            <Textarea value={form.intervention} onChange={(e) => set("intervention", e.target.value)} placeholder="e.g. Staff assist with morning care routine" rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Frequency</Label>
            <Input value={form.frequency} onChange={(e) => set("frequency", e.target.value)} placeholder="e.g. Daily" />
          </div>
          <div className="space-y-1.5">
            <Label>Created By</Label>
            <Input value={form.createdBy} onChange={(e) => set("createdBy", e.target.value)} placeholder="Staff name" />
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="gradient"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !form.goal || !form.intervention}
            >
              {mutation.isPending ? "Creating..." : "Create Care Plan"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SignCarePlanDialog({
  open,
  onOpenChange,
  signerType,
  carePlanId,
  facilityNumber,
  residentId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  signerType: "resident" | "family" | null;
  carePlanId: number | undefined;
  facilityNumber: string;
  residentId: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => {
    if (open) {
      setName("");
      setConfirmed(false);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!signerType || !carePlanId) throw new Error("Missing signer context");
      const signature = name.trim();
      if (signature.length === 0) throw new Error("Type your full name to sign");
      const res = await apiRequest("POST", `/api/ops/care-plans/${carePlanId}/sign`, {
        signerType,
        signature,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentId}/care-plan`],
      });
      toast({ title: signerType === "resident" ? "Resident signature recorded" : "Family signature recorded" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Could not sign", description: err.message, variant: "destructive" });
    },
  });

  const trimmed = name.trim();
  const canSubmit = trimmed.length > 0 && confirmed && !mutation.isPending;
  const heading = signerType === "family" ? "Family signature" : "Resident signature";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{heading}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Type the {signerType === "family" ? "family member's" : "resident's"} full name as a digital signature
            confirming review and consent of this care plan.
          </p>
          <div className="space-y-1.5">
            <Label htmlFor="careplan-signature">Full name</Label>
            <Input
              id="careplan-signature"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Jane Doe"
              autoFocus
            />
          </div>
          <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(e) => setConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              I confirm the {signerType === "family" ? "family member" : "resident"} has reviewed and consented
              to this care plan, and that this typed name is intended as a legal signature.
            </span>
          </label>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              onClick={() => mutation.mutate()}
              disabled={!canSubmit}
            >
              {mutation.isPending ? "Signing..." : "Sign"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReportIncidentInlineDialog({
  open,
  onOpenChange,
  residentId,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  residentId: string;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const today = new Date().toISOString().split("T")[0];
  const [form, setForm] = useState({ incidentType: "", incidentDate: today, description: "", immediateActionTaken: "", reportedBy: "Staff" });
  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const trimmedDescription = form.description.trim();
  const trimmedType = form.incidentType.trim();
  const canSubmit = !!trimmedType && trimmedDescription.length > 0;

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/incidents`, {
        ...form,
        description: trimmedDescription,
        immediateActionTaken: form.immediateActionTaken.trim(),
        residentId: Number(residentId),
        incidentDate: new Date(form.incidentDate).getTime(),
        injuryInvolved: 0,
        supervisorNotified: 0,
        familyNotified: 0,
        physicianNotified: 0,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentId}/incidents`] });
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/incidents`] });
      toast({ title: "Incident reported" });
      onOpenChange(false);
      setForm({ incidentType: "", incidentDate: today, description: "", immediateActionTaken: "", reportedBy: "Staff" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>Report Incident</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Incident Type</Label>
            <Select value={form.incidentType} onValueChange={(v) => set("incidentType", v)}>
              <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="fall">Fall</SelectItem>
                <SelectItem value="medication_error">Medication Error</SelectItem>
                <SelectItem value="injury">Injury</SelectItem>
                <SelectItem value="behavioral">Behavioral</SelectItem>
                <SelectItem value="elopement">Elopement</SelectItem>
                <SelectItem value="other">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input type="date" value={form.incidentDate} onChange={(e) => set("incidentDate", e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>
              Description <span className="text-destructive">*</span>
            </Label>
            <Textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Describe what happened"
              rows={3}
              aria-invalid={!trimmedDescription}
              aria-required
            />
            {!trimmedDescription && (
              <p className="text-xs text-muted-foreground">Required — describe what happened.</p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Immediate Action Taken</Label>
            <Textarea value={form.immediateActionTaken} onChange={(e) => set("immediateActionTaken", e.target.value)} placeholder="Actions taken immediately after incident" rows={2} />
          </div>
          <div className="space-y-1.5">
            <Label>Reported By</Label>
            <Input value={form.reportedBy} onChange={(e) => set("reportedBy", e.target.value)} placeholder="Staff name" />
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="gradient"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || !canSubmit}
            >
              {mutation.isPending ? "Reporting..." : "Report Incident"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EditResidentDialog
// Mirrors <AddResidentDialog> (ResidentsContent.tsx:66-260) for field set +
// Select enums. Submits PUT /api/ops/residents/:id with the partial diff so
// the server's residentSchema.partial() validation accepts the body.
//
// Pattern citations (Implementation Contract §2.5):
//   - Dialog shape + Cancel/Primary footer: AssessmentDialog above (line 122)
//   - Form Select enums (gender / levelOfCare / fundingSource):
//       ResidentsContent.tsx:171-244
//   - Optimistic update + rollback: ComplaintDetail.tsx:141-163
//   - useMutation + invalidate + toast: ComplianceContent.tsx:88-106
// ─────────────────────────────────────────────────────────────────────────────
interface EditResidentForm {
  firstName: string;
  lastName: string;
  dob: string;
  gender: string;
  ssnLast4: string;
  admissionDate: string;
  roomNumber: string;
  bedNumber: string;
  primaryDx: string;
  secondaryDx: string;
  levelOfCare: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelation: string;
  fundingSource: string;
  regionalCenterId: string;
}

function toDateInput(ms: number | null | undefined): string {
  if (!ms || !Number.isFinite(ms)) return "";
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function residentToForm(r: Resident): EditResidentForm {
  return {
    firstName: r.firstName ?? "",
    lastName: r.lastName ?? "",
    dob: toDateInput(r.dob),
    gender: r.gender ?? "",
    ssnLast4: (r as unknown as { ssnLast4?: string | null }).ssnLast4 ?? "",
    admissionDate: toDateInput(r.admissionDate),
    roomNumber: r.roomNumber ?? "",
    bedNumber: (r as unknown as { bedNumber?: string | null }).bedNumber ?? "",
    primaryDx: r.primaryDx ?? "",
    secondaryDx: (r as unknown as { secondaryDx?: string | null }).secondaryDx ?? "",
    levelOfCare: r.levelOfCare ?? "",
    emergencyContactName: r.emergencyContactName ?? "",
    emergencyContactPhone: r.emergencyContactPhone ?? "",
    emergencyContactRelation:
      (r as unknown as { emergencyContactRelation?: string | null }).emergencyContactRelation ?? "",
    fundingSource: r.fundingSource ?? "",
    regionalCenterId:
      (r as unknown as { regionalCenterId?: string | null }).regionalCenterId ?? "",
  };
}

function EditResidentDialog({
  open,
  onOpenChange,
  resident,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resident: Resident;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<EditResidentForm>(() => residentToForm(resident));
  const [errors, setErrors] = useState<Partial<Record<keyof EditResidentForm, string>>>({});

  useEffect(() => {
    if (open) {
      setForm(residentToForm(resident));
      setErrors({});
    }
  }, [open, resident]);

  const set = <K extends keyof EditResidentForm>(k: K, v: EditResidentForm[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setErrors((e) => ({ ...e, [k]: undefined }));
  };

  function validate(): boolean {
    const errs: Partial<Record<keyof EditResidentForm, string>> = {};
    if (!form.firstName.trim()) errs.firstName = "First name is required.";
    if (!form.lastName.trim()) errs.lastName = "Last name is required.";
    if (form.ssnLast4 && !/^\d{4}$/.test(form.ssnLast4))
      errs.ssnLast4 = "Must be exactly 4 digits.";
    setErrors(errs);
    return Object.keys(errs).length === 0;
  }

  const residentKey = [
    `/api/ops/facilities/${facilityNumber}/residents/${resident.id}`,
  ] as const;
  const listKey = [`/api/ops/facilities/${facilityNumber}/residents`] as const;

  const mutation = useMutation({
    mutationFn: async () => {
      // Send a diff so we only PUT changed fields — keeps the audit log
      // narrow and avoids re-writing fields the user didn't touch.
      const original = residentToForm(resident);
      const body: Record<string, unknown> = {};
      const passthrough: Array<keyof EditResidentForm> = [
        "firstName",
        "lastName",
        "gender",
        "ssnLast4",
        "roomNumber",
        "bedNumber",
        "primaryDx",
        "secondaryDx",
        "levelOfCare",
        "emergencyContactName",
        "emergencyContactPhone",
        "emergencyContactRelation",
        "fundingSource",
        "regionalCenterId",
      ];
      for (const k of passthrough) {
        if (form[k] !== original[k]) body[k] = form[k] || null;
      }
      if (form.dob !== original.dob) {
        body.dob = form.dob ? new Date(form.dob).getTime() : null;
      }
      if (form.admissionDate !== original.admissionDate) {
        body.admissionDate = form.admissionDate
          ? new Date(form.admissionDate).getTime()
          : null;
      }
      const res = await apiRequest("PUT", `/api/ops/residents/${resident.id}`, body);
      return res.json();
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: residentKey });
      const prev = qc.getQueryData<{ success: boolean; data: Resident }>(residentKey);
      if (prev?.data) {
        const merged: Resident = {
          ...prev.data,
          firstName: form.firstName,
          lastName: form.lastName,
          dob: form.dob ? new Date(form.dob).getTime() : prev.data.dob,
          gender: form.gender,
          admissionDate: form.admissionDate
            ? new Date(form.admissionDate).getTime()
            : prev.data.admissionDate,
          roomNumber: form.roomNumber,
          primaryDx: form.primaryDx,
          levelOfCare: form.levelOfCare,
          emergencyContactName: form.emergencyContactName,
          emergencyContactPhone: form.emergencyContactPhone,
          fundingSource: form.fundingSource,
        };
        qc.setQueryData(residentKey, { ...prev, data: merged });
      }
      return { prev };
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(residentKey, ctx.prev);
      toast({ title: "Couldn't save changes", description: err.message, variant: "destructive" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: residentKey });
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/dashboard`],
      });
      toast({ title: "Resident updated" });
      onOpenChange(false);
    },
  });

  const submit = () => {
    if (!validate() || mutation.isPending) return;
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Resident</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-firstName">First Name <span className="text-destructive">*</span></Label>
              <Input
                id="edit-firstName"
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                aria-invalid={!!errors.firstName}
              />
              {errors.firstName && <p className="text-xs text-destructive">{errors.firstName}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-lastName">Last Name <span className="text-destructive">*</span></Label>
              <Input
                id="edit-lastName"
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
                aria-invalid={!!errors.lastName}
              />
              {errors.lastName && <p className="text-xs text-destructive">{errors.lastName}</p>}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date of Birth</Label>
              <Input type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Gender</Label>
              <Select value={form.gender} onValueChange={(v) => set("gender", v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="non_binary">Non-binary</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                  <SelectItem value="unspecified">Unspecified</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>SSN (last 4)</Label>
              <Input
                inputMode="numeric"
                maxLength={4}
                value={form.ssnLast4}
                onChange={(e) => set("ssnLast4", e.target.value.replace(/\D/g, "").slice(0, 4))}
                aria-invalid={!!errors.ssnLast4}
                placeholder="1234"
              />
              {errors.ssnLast4 && <p className="text-xs text-destructive">{errors.ssnLast4}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>Admission Date</Label>
              <Input
                type="date"
                value={form.admissionDate}
                onChange={(e) => set("admissionDate", e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Room Number</Label>
              <Input value={form.roomNumber} onChange={(e) => set("roomNumber", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Bed Number</Label>
              <Input value={form.bedNumber} onChange={(e) => set("bedNumber", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Primary Diagnosis</Label>
            <Textarea
              rows={2}
              value={form.primaryDx}
              onChange={(e) => set("primaryDx", e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Secondary Diagnosis</Label>
            <Textarea
              rows={2}
              value={form.secondaryDx}
              onChange={(e) => set("secondaryDx", e.target.value)}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Level of Care</Label>
              <Select value={form.levelOfCare} onValueChange={(v) => set("levelOfCare", v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="personal_care">Personal Care</SelectItem>
                  <SelectItem value="assisted_living">Assisted Living</SelectItem>
                  <SelectItem value="memory_care">Memory Care</SelectItem>
                  <SelectItem value="skilled_nursing">Skilled Nursing</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Funding Source</Label>
              <Select value={form.fundingSource} onValueChange={(v) => set("fundingSource", v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="private_pay">Private Pay</SelectItem>
                  <SelectItem value="medi_cal">Medi-Cal</SelectItem>
                  <SelectItem value="medicare">Medicare</SelectItem>
                  <SelectItem value="insurance">Insurance</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Emergency Contact Name</Label>
              <Input
                value={form.emergencyContactName}
                onChange={(e) => set("emergencyContactName", e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Emergency Contact Phone</Label>
              <Input
                value={form.emergencyContactPhone}
                onChange={(e) => set("emergencyContactPhone", e.target.value)}
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Emergency Contact Relation</Label>
              <Input
                value={form.emergencyContactRelation}
                onChange={(e) => set("emergencyContactRelation", e.target.value)}
                placeholder="e.g. Daughter"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Regional Center ID</Label>
              <Input
                value={form.regionalCenterId}
                onChange={(e) => set("regionalCenterId", e.target.value)}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              onClick={submit}
              disabled={mutation.isPending}
            >
              {mutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Discharge / Reactivate confirm dialogs
//
// Pattern citations:
//   - AlertDialog shape: DiscontinueMedDialog above (line 268)
//   - Optimistic update of single-resident query: same as EditResidentDialog
//
// API note: the server's residentSchema (server/ops/opsRouter.ts:221) does
// NOT include `dischargeDate`; we only PUT { status }. dischargeDate is set
// server-side by soft-delete; for an explicit Discharge action via PUT, we
// rely on the server's existing column default + manual back-fill if needed.
// Flagged in the FE handoff.
// ─────────────────────────────────────────────────────────────────────────────
function DischargeResidentDialog({
  open,
  onOpenChange,
  resident,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resident: Resident;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const residentKey = [
    `/api/ops/facilities/${facilityNumber}/residents/${resident.id}`,
  ] as const;
  const listKey = [`/api/ops/facilities/${facilityNumber}/residents`] as const;

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/ops/residents/${resident.id}`, {
        status: "discharged",
      });
      return res.json();
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: residentKey });
      const prev = qc.getQueryData<{ success: boolean; data: Resident }>(residentKey);
      if (prev?.data) {
        qc.setQueryData(residentKey, {
          ...prev,
          data: { ...prev.data, status: "discharged" },
        });
      }
      return { prev };
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(residentKey, ctx.prev);
      toast({ title: "Couldn't discharge", description: err.message, variant: "destructive" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: residentKey });
      qc.invalidateQueries({ queryKey: listKey });
      toast({ title: "Resident discharged" });
      onOpenChange(false);
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Discharge {resident.firstName} {resident.lastName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The resident will be marked discharged. Their chart, medications, and history remain
            readable for audit purposes.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={mutation.isPending}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            {mutation.isPending ? "Discharging..." : "Discharge"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function ReactivateResidentDialog({
  open,
  onOpenChange,
  resident,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  resident: Resident;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const residentKey = [
    `/api/ops/facilities/${facilityNumber}/residents/${resident.id}`,
  ] as const;
  const listKey = [`/api/ops/facilities/${facilityNumber}/residents`] as const;

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PUT", `/api/ops/residents/${resident.id}`, {
        status: "active",
      });
      return res.json();
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: residentKey });
      const prev = qc.getQueryData<{ success: boolean; data: Resident }>(residentKey);
      if (prev?.data) {
        qc.setQueryData(residentKey, {
          ...prev,
          data: { ...prev.data, status: "active" },
        });
      }
      return { prev };
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(residentKey, ctx.prev);
      toast({ title: "Couldn't reactivate", description: err.message, variant: "destructive" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: residentKey });
      qc.invalidateQueries({ queryKey: listKey });
      toast({ title: "Resident reactivated" });
      onOpenChange(false);
    },
  });

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Reactivate {resident.firstName} {resident.lastName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            The resident will return to the active roster.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={mutation.isPending}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={mutation.isPending}
            onClick={(e) => {
              e.preventDefault();
              mutation.mutate();
            }}
          >
            {mutation.isPending ? "Reactivating..." : "Reactivate"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EditCarePlanDialog
// Mirrors <CreateCarePlanDialog> (line 341) for shape; adds status Select +
// optional responsibleStaff / reviewDate. Submits PUT /api/ops/care-plans/:id.
//
// Pattern citations:
//   - CreateCarePlanDialog form layout: line 341
//   - useMutation + invalidate + toast: ComplianceContent.tsx:88-106
// ─────────────────────────────────────────────────────────────────────────────
function EditCarePlanDialog({
  open,
  onOpenChange,
  carePlan,
  facilityNumber,
  residentId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  carePlan: CarePlan;
  facilityNumber: string;
  residentId: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    goal: carePlan.goal ?? "",
    intervention: carePlan.intervention ?? "",
    frequency: carePlan.frequency ?? "Daily",
    responsibleStaff: (carePlan as unknown as { responsibleStaff?: string | null }).responsibleStaff ?? "",
    reviewDate: toDateInput(
      (carePlan as unknown as { reviewDate?: number | null }).reviewDate ?? null,
    ),
    status: carePlan.status ?? "active",
  });

  useEffect(() => {
    if (open) {
      setForm({
        goal: carePlan.goal ?? "",
        intervention: carePlan.intervention ?? "",
        frequency: carePlan.frequency ?? "Daily",
        responsibleStaff:
          (carePlan as unknown as { responsibleStaff?: string | null }).responsibleStaff ?? "",
        reviewDate: toDateInput(
          (carePlan as unknown as { reviewDate?: number | null }).reviewDate ?? null,
        ),
        status: carePlan.status ?? "active",
      });
    }
  }, [open, carePlan]);

  const planKey = [
    `/api/ops/facilities/${facilityNumber}/residents/${residentId}/care-plan`,
  ] as const;

  const mutation = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = {
        goal: form.goal.trim(),
        intervention: form.intervention.trim(),
        frequency: form.frequency.trim(),
        status: form.status,
      };
      if (form.responsibleStaff.trim()) body.responsibleStaff = form.responsibleStaff.trim();
      if (form.reviewDate) body.reviewDate = new Date(form.reviewDate).getTime();
      const res = await apiRequest("PUT", `/api/ops/care-plans/${carePlan.id}`, body);
      return res.json();
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: planKey });
      const prev = qc.getQueryData<{ success: boolean; data: CarePlan }>(planKey);
      if (prev?.data) {
        qc.setQueryData(planKey, {
          ...prev,
          data: {
            ...prev.data,
            goal: form.goal,
            intervention: form.intervention,
            frequency: form.frequency,
            status: form.status,
          },
        });
      }
      return { prev };
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(planKey, ctx.prev);
      toast({ title: "Couldn't save care plan", description: err.message, variant: "destructive" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: planKey });
      toast({ title: "Care plan updated" });
      onOpenChange(false);
    },
  });

  const canSubmit =
    form.goal.trim().length > 0 &&
    form.intervention.trim().length > 0 &&
    form.frequency.trim().length > 0 &&
    !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit Care Plan</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Goal <span className="text-destructive">*</span></Label>
            <Textarea
              value={form.goal}
              onChange={(e) => setForm((f) => ({ ...f, goal: e.target.value }))}
              rows={2}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Intervention <span className="text-destructive">*</span></Label>
            <Textarea
              value={form.intervention}
              onChange={(e) => setForm((f) => ({ ...f, intervention: e.target.value }))}
              rows={2}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Frequency <span className="text-destructive">*</span></Label>
              <Input
                value={form.frequency}
                onChange={(e) => setForm((f) => ({ ...f, frequency: e.target.value }))}
                placeholder="e.g. Daily"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => setForm((f) => ({ ...f, status: v }))}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="under_review">Under Review</SelectItem>
                  <SelectItem value="archived">Archived</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Responsible Staff</Label>
              <Input
                value={form.responsibleStaff}
                onChange={(e) => setForm((f) => ({ ...f, responsibleStaff: e.target.value }))}
                placeholder="Staff name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Review Date</Label>
              <Input
                type="date"
                value={form.reviewDate}
                onChange={(e) => setForm((f) => ({ ...f, reviewDate: e.target.value }))}
              />
            </div>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              onClick={() => mutation.mutate()}
              disabled={!canSubmit}
            >
              {mutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Status badge palette — emerald=active, amber=on_leave, slate=discharged
// (reuses the same tone vocabulary as ResidentsContent.tsx:34-38, but
// rendered here as a chip on the profile header).
// ─────────────────────────────────────────────────────────────────────────────
const STATUS_CHIP_CLASSES: Record<string, string> = {
  active: "bg-emerald-100 text-emerald-700 border-emerald-200",
  on_leave: "bg-amber-100 text-amber-700 border-amber-200",
  discharged: "bg-slate-100 text-slate-700 border-slate-200",
};

function ResidentStatusChip({ status }: { status: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded-full text-[11px] border capitalize",
        STATUS_CHIP_CLASSES[status] ?? "bg-slate-100 text-slate-700 border-slate-200",
      )}
      data-testid="resident-status-chip"
    >
      {status?.replace(/_/g, " ")}
    </span>
  );
}

export function ResidentProfileContent({
  facilityNumber,
  residentId,
  onBack,
}: {
  facilityNumber: string;
  residentId: number;
  onBack?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isWritable = useIsWritable();
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [medFormOpen, setMedFormOpen] = useState(false);
  const [medFormMode, setMedFormMode] = useState<"create" | "edit">("create");
  const [medFormInitial, setMedFormInitial] = useState<MedicationFormValue | undefined>(undefined);
  const [discontinueTarget, setDiscontinueTarget] = useState<Medication | null>(null);
  const [createCarePlanOpen, setCreateCarePlanOpen] = useState(false);
  const [editCarePlanOpen, setEditCarePlanOpen] = useState(false);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  const [reportIncidentOpen, setReportIncidentOpen] = useState(false);
  const [signOpen, setSignOpen] = useState<null | "resident" | "family">(null);
  const [editResidentOpen, setEditResidentOpen] = useState(false);
  const [dischargeOpen, setDischargeOpen] = useState(false);
  const [reactivateOpen, setReactivateOpen] = useState(false);
  const residentIdStr = String(residentId);

  const { data: residentEnvelope, isLoading } = useQuery<{ success: boolean; data: Resident } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentIdStr}`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber && !!residentIdStr,
  });

  const { data: assessmentsEnvelope } = useQuery<{ success: boolean; data: Assessment[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentIdStr}/assessments`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber && !!residentIdStr,
  });

  const { data: carePlanEnvelope } = useQuery<{ success: boolean; data: CarePlan } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentIdStr}/care-plan`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber && !!residentIdStr,
  });

  const { data: dailyTasksEnvelope } = useQuery<{ success: boolean; data: DailyTask[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentIdStr}/daily-tasks`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber && !!residentIdStr,
  });

  const { data: medicationsEnvelope } = useQuery<{ success: boolean; data: Medication[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentIdStr}/medications`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber && !!residentIdStr,
  });

  const { data: incidentsEnvelope } = useQuery<{ success: boolean; data: Incident[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentIdStr}/incidents`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber && !!residentIdStr,
  });

  // W8 — per-resident chart completeness for the profile panel.
  const { data: chartEnvelope, isLoading: chartLoading } =
    useChartCompletenessForResident(residentId);
  const chartResult = chartEnvelope?.data ?? null;

  const resident = residentEnvelope?.data ?? undefined;
  const assessments = assessmentsEnvelope?.data ?? [];
  const carePlan = carePlanEnvelope?.data ?? undefined;
  const dailyTasks = dailyTasksEnvelope?.data ?? [];
  const medications = medicationsEnvelope?.data ?? [];
  const incidents = incidentsEnvelope?.data ?? [];

  const completeTaskMutation = useMutation({
    mutationFn: async ({ taskId, status }: { taskId: number; status: string }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/ops/facilities/${facilityNumber}/residents/${residentIdStr}/daily-tasks/${taskId}`,
        { status }
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentIdStr}/daily-tasks`] });
    },
  });

  const discontinueMedMutation = useMutation({
    mutationFn: async (input: { medId: number; reason: MedicationDiscontinueReason; reasonNote?: string }) => {
      const res = await apiRequest(
        "DELETE",
        `/api/ops/medications/${input.medId}`,
        { reason: input.reason, reasonNote: input.reasonNote }
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentIdStr}/medications`] });
      toast({ title: "Medication discontinued" });
    },
    onError: (err: Error) => {
      toast({ title: "Could not discontinue", description: err.message, variant: "destructive" });
    },
  });


  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTasks = dailyTasks.filter((t) => {
    const td = new Date(t.taskDate);
    td.setHours(0, 0, 0, 0);
    return td.getTime() === today.getTime();
  });

  if (isLoading) {
    return (
      <div className="space-y-4">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Overview
          </button>
        )}
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!resident) {
    return (
      <div className="space-y-4">
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Overview
          </button>
        )}
        <div className="text-center py-12 text-muted-foreground">Resident not found.</div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Overview
        </button>
      )}

      <div className="flex items-center gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold">
              {resident.firstName} {resident.lastName}
            </h1>
            <ResidentStatusChip status={resident.status ?? "active"} />
          </div>
          <p className="text-sm text-muted-foreground">
            Room {resident.roomNumber} &middot; Admitted {new Date(resident.admissionDate).toLocaleDateString()}
          </p>
        </div>
        {isWritable && (
          <div className="ml-auto flex items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setEditResidentOpen(true)}
              aria-label="Edit resident"
              data-testid="resident-edit-trigger"
            >
              <Pencil className="h-3.5 w-3.5 mr-1.5" />
              Edit
            </Button>
            {resident.status === "discharged" ? (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setReactivateOpen(true)}
                data-testid="resident-reactivate-trigger"
              >
                <UserCheck className="h-3.5 w-3.5 mr-1.5" />
                Reactivate
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setDischargeOpen(true)}
                className="text-destructive hover:text-destructive"
                data-testid="resident-discharge-trigger"
              >
                <UserMinus className="h-3.5 w-3.5 mr-1.5" />
                Discharge
              </Button>
            )}
          </div>
        )}
      </div>

      <EditResidentDialog
        open={editResidentOpen}
        onOpenChange={setEditResidentOpen}
        resident={resident}
        facilityNumber={facilityNumber}
      />
      <DischargeResidentDialog
        open={dischargeOpen}
        onOpenChange={setDischargeOpen}
        resident={resident}
        facilityNumber={facilityNumber}
      />
      <ReactivateResidentDialog
        open={reactivateOpen}
        onOpenChange={setReactivateOpen}
        resident={resident}
        facilityNumber={facilityNumber}
      />

      <Tabs defaultValue="profile">
        <TabsList className="w-full overflow-x-auto">
          <TabsTrigger value="profile">Profile</TabsTrigger>
          <TabsTrigger value="careplan">Care Plan</TabsTrigger>
          <TabsTrigger value="medications">Medications</TabsTrigger>
          <TabsTrigger value="incidents">Incidents</TabsTrigger>
        </TabsList>

        {/* Profile Tab */}
        <TabsContent value="profile" className="mt-4 space-y-4">
          <div className="rounded-lg border overflow-hidden">
            <FieldRow label="Date of Birth" value={new Date(resident.dob).toLocaleDateString()} />
            <FieldRow label="Gender" value={resident.gender} />
            <FieldRow label="Primary Diagnosis" value={resident.primaryDx} />
            <FieldRow label="Level of Care" value={resident.levelOfCare?.replace(/_/g, " ")} />
            <FieldRow label="Funding Source" value={resident.fundingSource?.replace(/_/g, " ")} />
            <FieldRow label="Emergency Contact" value={`${resident.emergencyContactName} — ${resident.emergencyContactPhone}`} />
          </div>

          {/* W8 — chart completeness panel for this resident. */}
          <ChartCompletenessPanel
            result={chartResult}
            isLoading={chartLoading}
          />

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium">Assessment History</h2>
              <Button size="sm" variant="outline" onClick={() => setAssessmentOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                New Assessment
              </Button>
            </div>
            {assessments.length === 0 ? (
              <p className="text-sm text-muted-foreground">No assessments recorded.</p>
            ) : (
              <div className="space-y-2">
                {assessments.map((a) => (
                  <div key={a.id} className="rounded-lg border p-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-medium">{new Date(a.assessedAt).toLocaleDateString()}</span>
                      <Badge variant="outline" className="capitalize">{a.fallRiskLevel} fall risk</Badge>
                    </div>
                    <div className="mt-1 text-muted-foreground text-xs">
                      Cognition: {a.cognitionScore}/30 &middot; By {a.assessedBy}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <AssessmentDialog
            open={assessmentOpen}
            onOpenChange={setAssessmentOpen}
            residentId={residentIdStr}
            facilityNumber={facilityNumber}
          />
        </TabsContent>

        {/* Care Plan Tab */}
        <TabsContent value="careplan" className="mt-4 space-y-4">
          {!carePlan ? (
            <div className="rounded-lg border border-dashed p-8 text-center space-y-3">
              <p className="text-sm text-muted-foreground">No active care plan found.</p>
              <Button size="sm" variant="gradient" onClick={() => setCreateCarePlanOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                Create Care Plan
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-lg border overflow-hidden">
                <div className="px-4 py-3 border-b flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">Active Care Plan</span>
                  <div className="flex items-center gap-2">
                    <Badge variant={carePlan.status === "active" ? "default" : "secondary"}>
                      {carePlan.status}
                    </Badge>
                    {isWritable && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-7 px-2"
                        onClick={() => setEditCarePlanOpen(true)}
                        aria-label="Edit care plan"
                        data-testid="careplan-edit-trigger"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
                <FieldRow label="Goal" value={carePlan.goal} />
                <FieldRow label="Intervention" value={carePlan.intervention} />
                <FieldRow label="Frequency" value={carePlan.frequency} />
              </div>
              <EditCarePlanDialog
                open={editCarePlanOpen}
                onOpenChange={setEditCarePlanOpen}
                carePlan={carePlan}
                facilityNumber={facilityNumber}
                residentId={residentIdStr}
              />
              <div className="flex gap-2 flex-wrap">
                <Button
                  size="sm"
                  variant={carePlan.digitalSignatureResident ? "secondary" : "outline"}
                  onClick={() => setSignOpen("resident")}
                  disabled={!!carePlan.digitalSignatureResident}
                >
                  {carePlan.digitalSignatureResident
                    ? `Resident Signed${carePlan.signatureDate ? ` ${new Date(carePlan.signatureDate).toLocaleDateString()}` : ""}`
                    : "Resident Sign"}
                </Button>
                <Button
                  size="sm"
                  variant={carePlan.digitalSignatureFamily ? "secondary" : "outline"}
                  onClick={() => setSignOpen("family")}
                  disabled={!!carePlan.digitalSignatureFamily}
                >
                  {carePlan.digitalSignatureFamily
                    ? `Family Signed${carePlan.signatureDate ? ` ${new Date(carePlan.signatureDate).toLocaleDateString()}` : ""}`
                    : "Family Sign"}
                </Button>
              </div>
              <SignCarePlanDialog
                open={signOpen !== null}
                onOpenChange={(v) => !v && setSignOpen(null)}
                signerType={signOpen}
                carePlanId={carePlan.id}
                facilityNumber={facilityNumber}
                residentId={residentIdStr}
              />
            </>
          )}

          <CreateCarePlanDialog
            open={createCarePlanOpen}
            onOpenChange={setCreateCarePlanOpen}
            residentId={residentIdStr}
            facilityNumber={facilityNumber}
          />

          {/* Pre-fills the resident automatically — caregiver doesn't have
              to re-pick from a dropdown they're already inside. */}
          <AddTaskDialog
            open={addTaskOpen}
            onOpenChange={setAddTaskOpen}
            facilityNumber={facilityNumber}
            defaultResidentId={Number(residentIdStr)}
          />

          <div>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-medium">Today's Tasks</h2>
              <Button size="sm" variant="outline" onClick={() => setAddTaskOpen(true)} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                Add task
              </Button>
            </div>
            {todayTasks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No tasks scheduled for today.</p>
            ) : (
              <div className="space-y-2">
                {todayTasks.map((t) => (
                  <div key={t.id} className="rounded-lg border p-3 flex items-center gap-3">
                    <span className="flex-1 text-sm">{t.description}</span>
                    {t.status === "pending" ? (
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => completeTaskMutation.mutate({ taskId: t.id, status: "completed" })}
                          aria-label="Mark complete"
                        >
                          <Check className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => completeTaskMutation.mutate({ taskId: t.id, status: "refused" })}
                          aria-label="Mark refused"
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    ) : (
                      <Badge variant={t.status === "completed" ? "default" : "secondary"}>
                        {t.status}
                      </Badge>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </TabsContent>

        {/* Medications Tab */}
        <TabsContent value="medications" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Active Medications</h2>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setMedFormMode("create");
                setMedFormInitial(undefined);
                setMedFormOpen(true);
              }}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Add Medication
            </Button>
          </div>
          {medications.filter((m) => m.status !== "discontinued").length === 0 ? (
            <p className="text-sm text-muted-foreground">No active medications.</p>
          ) : (
            <div className="space-y-2">
              {medications
                .filter((m) => m.status !== "discontinued")
                .map((m) => (
                  <div key={m.id} className="rounded-lg p-3" style={{ border: '1px solid #E0E7FF', background: '#F0F4FF' }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm">{m.drugName}</span>
                      {isWritable && (
                        <div className="flex items-center gap-1">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs h-7 px-2"
                            onClick={() => {
                              setMedFormMode("edit");
                              setMedFormInitial({
                                id: m.id,
                                drugName: m.drugName,
                                dosage: m.dosage,
                                route: m.route,
                                frequency: (m.frequency as MedicationFormValue["frequency"]) ?? "",
                                frequencyRaw: m.frequencyRaw,
                                scheduledTimes: m.scheduledTimesArray ?? [],
                                prescriberName: m.prescriberName ?? "",
                              });
                              setMedFormOpen(true);
                            }}
                            aria-label={`Edit ${m.drugName}`}
                            data-testid={`med-edit-${m.id}`}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-destructive hover:text-destructive text-xs"
                            onClick={() => setDiscontinueTarget(m)}
                            disabled={discontinueMedMutation.isPending}
                            aria-label={`Discontinue ${m.drugName}`}
                            data-testid={`med-discontinue-${m.id}`}
                          >
                            Discontinue
                          </Button>
                        </div>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-2">
                      <span>{m.dosage}</span>
                      <span>via {m.route}</span>
                      <span>{m.frequencyLabel || m.frequency}</span>
                      {m.scheduledTimes && (
                        <span>at {m.scheduledTimes}</span>
                      )}
                    </div>
                    {m.prescriberName && (
                      <p className="text-xs text-muted-foreground mt-0.5">Prescriber: {m.prescriberName}</p>
                    )}
                  </div>
                ))}
            </div>
          )}
          <MedicationFormDialog
            open={medFormOpen}
            onOpenChange={setMedFormOpen}
            mode={medFormMode}
            residentId={residentIdStr}
            facilityNumber={facilityNumber}
            initialValue={medFormInitial}
          />
          <DiscontinueMedDialog
            open={!!discontinueTarget}
            onOpenChange={(v) => !v && setDiscontinueTarget(null)}
            medication={discontinueTarget}
            pending={discontinueMedMutation.isPending}
            onConfirm={({ reason, reasonNote }) => {
              if (!discontinueTarget) return;
              discontinueMedMutation.mutate(
                { medId: discontinueTarget.id, reason, reasonNote },
                { onSettled: () => setDiscontinueTarget(null) },
              );
            }}
          />
        </TabsContent>

        {/* Incidents Tab */}
        <TabsContent value="incidents" className="mt-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-medium">Incident Reports</h2>
            <Button size="sm" variant="outline" onClick={() => setReportIncidentOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Report Incident
            </Button>
          </div>
          <ReportIncidentInlineDialog
            open={reportIncidentOpen}
            onOpenChange={setReportIncidentOpen}
            residentId={residentIdStr}
            facilityNumber={facilityNumber}
          />
          {incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">No incidents recorded.</p>
          ) : (
            <div className="space-y-2">
              {incidents.map((i) => (
                <div
                  key={i.id}
                  className="rounded-lg p-3 flex items-start gap-3"
                  style={{ border: '1px solid #E0E7FF', background: '#F0F4FF' }}
                >
                  <IncidentCard
                    incidentType={i.incidentType}
                    incidentDate={i.incidentDate}
                    reportedBy={i.reportedBy}
                    severity={i.eventSeverity ?? null}
                    description={i.description}
                  />
                  <Badge variant="outline" className="shrink-0 capitalize">{i.status?.replace(/_/g, " ")}</Badge>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
