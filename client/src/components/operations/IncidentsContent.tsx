/**
 * IncidentsContent — Operations sub-view for ops_incidents.
 *
 * Wave 2 W4 (BA §5 W4, §6 state machine) extends the existing inline detail
 * panel with a checklist + SLA timers + gated close/reopen. The list shell,
 * filter chips, ReportIncidentDialog, and the per-row notification timestamp
 * checkboxes pre-date W4 and are NOT modified.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Page heading style:                        ComplianceContent.tsx:281
 *   - Loading skeleton row pattern:              ComplianceContent.tsx:311-313
 *   - Empty-state dashed border:                 ComplianceContent.tsx:315-318
 *   - <FormField> + onSubmitKey:                 components/operations/FormField.tsx
 *   - <AuditTrailButton> in detail header:       components/operations/AuditTrailButton.tsx
 *   - useMutation + invalidate + toast:          ComplianceContent.tsx:88-106
 *   - Status badge tone palette:                 EmarContent.tsx:55-62
 *   - Optimistic update + rollback pattern:      ComplaintDetail.tsx:141-163
 *   - Dialog footer [Cancel] before primary:     IncidentsContent.tsx:279-284 (existing)
 *
 * API contract (W4, Phase 4):
 *   GET    /api/ops/incidents/:id/checklist        — checklist + SLA + canClose
 *   POST   /api/ops/incidents/:id/close            { closureNote: string (>=8) }
 *   POST   /api/ops/incidents/:id/reopen           { reason: string (>=8) }
 *   GET    /api/ops/facilities/:fn/incidents/past-sla?limit=  (Wave 3 tile)
 *
 * Field updates for individual checklist items (CCLD verbal, LIC 624, SOC 341,
 * supervisor/family/physician notifications, root cause, corrective action,
 * follow-up) reuse the EXISTING PUT /api/ops/incidents/:id endpoint — no
 * parallel mutation endpoints introduced.
 */
import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { toLocalEpochMs } from "@/lib/datetime";
import { useResidents } from "@/hooks/useResidents";
import { FormField, onSubmitKey } from "@/components/operations/FormField";
import { AuditTrailButton } from "@/components/operations/AuditTrailButton";
import {
  Plus,
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  Clock,
  Minus,
  RotateCcw,
  Lock,
  Pencil,
} from "lucide-react";
import { useIsWritable } from "@/context/AuditorContext";
import { IncidentCard } from "@/components/incidents/IncidentCard";

interface Resident {
  id: number;
  firstName: string;
  lastName: string;
}

interface Incident {
  id: number;
  facilityNumber: string;
  residentId: number | null;
  residentName?: string;
  incidentType: string;
  incidentDate: number;
  incidentTime: string;
  location: string;
  description: string;
  immediateActionTaken: string;
  injuryInvolved: boolean;
  supervisorNotified: boolean;
  supervisorNotifiedAt: number | null;
  familyNotified: boolean;
  familyNotifiedAt: number | null;
  physicianNotified: boolean;
  physicianNotifiedAt: number | null;
  reportedBy: string;
  status: string;
  lic624Required: boolean;
  lic624Submitted: boolean;
  lic624SubmittedAt?: number | null;
  soc341Required?: boolean;
  soc341Submitted?: boolean;
  soc341SubmittedAt?: number | null;
  ccldVerbalNotified?: boolean;
  ccldVerbalNotifiedAt?: number | null;
  ccldVerbalNotifiedBy?: string | null;
  eventSeverity?: "serious" | "non_emergent" | null;
  rootCause?: string;
  correctiveAction?: string;
  followUpDate?: number | null;
  followUpCompleted?: boolean;
  closureNote?: string | null;
  closedAt?: number | null;
  closedBy?: string | null;
  reopenedAt?: number | null;
  reopenedBy?: string | null;
  reopenReason?: string | null;
}

const INCIDENT_TYPES = [
  "fall",
  "medication_error",
  "elopement",
  "altercation",
  "injury",
  "behavioral",
  "medical_emergency",
  "property_damage",
  "other",
];

const STATUS_COLORS: Record<string, string> = {
  open: "bg-red-100 text-red-700",
  under_review: "bg-yellow-100 text-yellow-700",
  closed: "bg-green-100 text-green-700",
};

// ─────────────────────────────────────────────────────────────────────────────
// W4 — Checklist API types
// Pulled here so both this component and the test file share the same shape
// (exported for the smoke-test fixture).
// ─────────────────────────────────────────────────────────────────────────────

export type ChecklistKey =
  | "supervisor"
  | "family"
  | "physician"
  | "ccldVerbal"
  | "lic624"
  | "soc341"
  | "rootCause"
  | "correctiveAction"
  | "followUp";

export type SlaSeverity = "ok" | "warning" | "overdue";

export interface IncidentChecklistData {
  incidentId: number;
  status: string;
  eventSeverity: "serious" | "non_emergent";
  required: Record<ChecklistKey, boolean>;
  done: Record<ChecklistKey, boolean>;
  sla: {
    ccldVerbalDueAt?: number;
    ccldVerbalSeverity?: SlaSeverity;
    lic624DueAt?: number;
    lic624Severity?: SlaSeverity;
    soc341DueAt?: number;
    soc341Severity?: SlaSeverity;
  };
  canClose: boolean;
  blockingReasons: string[];
}

export interface IncidentChecklistEnvelope {
  success: boolean;
  data: IncidentChecklistData;
}

interface IncidentFormData {
  incidentType: string;
  incidentDate: string;
  incidentTime: string;
  residentId: string;
  location: string;
  description: string;
  immediateActionTaken: string;
  injuryInvolved: boolean;
  supervisorNotified: boolean;
  supervisorNotifiedAt: string;
  familyNotified: boolean;
  familyNotifiedAt: string;
  physicianNotified: boolean;
  physicianNotifiedAt: string;
}

// Lazy so the date/time reflect "now" each time the form opens, AND use
// local time (toISOString is UTC and would default to tomorrow's date in
// the evening for users west of UTC).
function makeEmptyForm(): IncidentFormData {
  const d = new Date();
  const localDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { ...EMPTY_FORM_STATIC, incidentDate: localDate, incidentTime: d.toTimeString().slice(0, 5) };
}

const EMPTY_FORM_STATIC: IncidentFormData = {
  incidentType: "",
  incidentDate: "",
  incidentTime: "",
  residentId: "none",
  location: "",
  description: "",
  immediateActionTaken: "",
  injuryInvolved: false,
  supervisorNotified: false,
  supervisorNotifiedAt: "",
  familyNotified: false,
  familyNotifiedAt: "",
  physicianNotified: false,
  physicianNotifiedAt: "",
};

function ReportIncidentDialog({
  open,
  onOpenChange,
  facilityNumber,
  residents,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilityNumber: string;
  residents: Resident[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<IncidentFormData>(makeEmptyForm);

  const set = <K extends keyof IncidentFormData>(key: K, value: IncidentFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const [showErrors, setShowErrors] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      // Use toLocalEpochMs for date-only fields so users west of UTC don't
      // see their incident-date roll back by a day.
      const body = {
        ...form,
        residentId: form.residentId && form.residentId !== "none" ? Number(form.residentId) : null,
        incidentDate: form.incidentDate ? toLocalEpochMs(form.incidentDate) : Date.now(),
        injuryInvolved: form.injuryInvolved ? 1 : 0,
        supervisorNotified: form.supervisorNotified ? 1 : 0,
        supervisorNotifiedAt: form.supervisorNotifiedAt ? new Date(form.supervisorNotifiedAt).getTime() : null,
        familyNotified: form.familyNotified ? 1 : 0,
        familyNotifiedAt: form.familyNotifiedAt ? new Date(form.familyNotifiedAt).getTime() : null,
        physicianNotified: form.physicianNotified ? 1 : 0,
        physicianNotifiedAt: form.physicianNotifiedAt ? new Date(form.physicianNotifiedAt).getTime() : null,
      };
      const res = await apiRequest("POST", `/api/ops/incidents`, body);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/incidents`] });
      toast({ title: "Incident reported" });
      onOpenChange(false);
      setForm({ ...makeEmptyForm(), residentId: "none" });
      setShowErrors(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Required: type, date, description. Everything else is supporting context.
  const errors = {
    incidentType: !form.incidentType ? "Pick the incident type" : undefined,
    incidentDate: !form.incidentDate ? "When did it happen?" : undefined,
    description: form.description.trim().length === 0 ? "Describe what happened" : undefined,
  };
  const isValid = !errors.incidentType && !errors.incidentDate && !errors.description;
  const submit = () => {
    if (!isValid || mutation.isPending) {
      setShowErrors(true);
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report Incident</DialogTitle>
        </DialogHeader>
        <div className="space-y-4" onKeyDown={onSubmitKey(submit)}>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Incident Type" required error={showErrors ? errors.incidentType : undefined}>
              <Select value={form.incidentType} onValueChange={(v) => set("incidentType", v)}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {INCIDENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Resident">
              <Select value={form.residentId} onValueChange={(v) => set("residentId", v)}>
                <SelectTrigger><SelectValue placeholder="Select resident" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None / facility-wide</SelectItem>
                  {Array.isArray(residents) && residents.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.firstName} {r.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Date" required error={showErrors ? errors.incidentDate : undefined}>
              <Input type="date" value={form.incidentDate} onChange={(e) => set("incidentDate", e.target.value)} />
            </FormField>
            <FormField label="Time" hint="Calendar uses this for the time grid">
              <Input type="time" value={form.incidentTime} onChange={(e) => set("incidentTime", e.target.value)} />
            </FormField>
          </div>

          <FormField label="Location">
            <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Dining room" />
          </FormField>

          <FormField label="Description" required error={showErrors ? errors.description : undefined}>
            <Textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Describe what happened..."
              className="resize-none min-h-[80px]"
            />
          </FormField>

          <FormField label="Immediate Action Taken">
            <Textarea
              value={form.immediateActionTaken}
              onChange={(e) => set("immediateActionTaken", e.target.value)}
              placeholder="What was done immediately..."
              className="resize-none min-h-[60px]"
            />
          </FormField>

          <div className="flex items-center gap-2">
            <Checkbox
              id="injury"
              checked={form.injuryInvolved}
              onCheckedChange={(v) => set("injuryInvolved", !!v)}
            />
            <label htmlFor="injury" className="text-sm cursor-pointer">Injury involved</label>
          </div>

          <div className="space-y-3 border rounded-lg p-3">
            <p className="text-sm font-medium">Notifications</p>
            {[
              { key: "supervisor" as const, label: "Supervisor" },
              { key: "family" as const, label: "Family" },
              { key: "physician" as const, label: "Physician" },
            ].map(({ key, label }) => (
              <div key={key} className="space-y-1.5">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id={`notif-${key}`}
                    checked={form[`${key}Notified`]}
                    onCheckedChange={(v) => set(`${key}Notified`, !!v)}
                  />
                  <label htmlFor={`notif-${key}`} className="text-sm cursor-pointer">{label} notified</label>
                </div>
                {form[`${key}Notified`] && (
                  <Input
                    type="datetime-local"
                    value={form[`${key}NotifiedAt`]}
                    onChange={(e) => set(`${key}NotifiedAt`, e.target.value)}
                    className="mt-1"
                  />
                )}
              </div>
            ))}
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? "Reporting..." : "Report Incident"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-1 text-right">
            <kbd className="px-1 rounded border bg-gray-50">Enter</kbd> to save
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// W4 helpers — SLA chip formatter + checklist line
// `chevronEdgeTime` is named per the spec; renders relative SLA copy:
//   • due in 1h 23m
//   • overdue by 2d
//   • due 2026-05-21
// ─────────────────────────────────────────────────────────────────────────────

function chevronEdgeTime(dueAt: number, severity: SlaSeverity | undefined, now = Date.now()): string {
  const diff = dueAt - now;
  const abs = Math.abs(diff);
  const minutes = Math.round(abs / 60_000);
  const hours = Math.round(abs / 3_600_000);
  const days = Math.round(abs / 86_400_000);

  if (severity === "overdue" || diff < 0) {
    if (minutes < 60) return `overdue by ${minutes}m`;
    if (hours < 24) return `overdue by ${hours}h`;
    return `overdue by ${days}d`;
  }

  if (minutes < 60) return `due in ${minutes}m`;
  if (hours < 24) {
    const remMin = Math.max(0, Math.round((abs - hours * 3_600_000) / 60_000));
    return remMin > 0 ? `due in ${hours}h ${remMin}m` : `due in ${hours}h`;
  }
  if (days < 7) return `due in ${days}d`;
  return `due ${new Date(dueAt).toLocaleDateString()}`;
}

function fmtRelativeDone(ms: number, now = Date.now()): string {
  const diff = now - ms;
  if (diff < 0) return new Date(ms).toLocaleString();
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

const SLA_CHIP_TONE: Record<SlaSeverity, string> = {
  ok: "bg-emerald-100 text-emerald-700 border-emerald-200",
  warning: "bg-amber-100 text-amber-700 border-amber-200",
  overdue: "bg-red-100 text-red-700 border-red-200",
};

// ─────────────────────────────────────────────────────────────────────────────
// W4 — ChecklistItem row.
// One row per required checklist step. Renders icon + label + status detail,
// inline action button when pending and actionable, optional SLA chip when
// timed. Tones reuse the EmarContent palette.
// ─────────────────────────────────────────────────────────────────────────────

interface ChecklistItemProps {
  itemKey: ChecklistKey;
  label: string;
  required: boolean;
  done: boolean;
  doneAt?: number | null;
  doneBy?: string | null;
  sla?: { dueAt: number; severity: SlaSeverity };
  /** If non-null, renders an inline "Mark …" action. */
  onMark?: () => void;
  marking?: boolean;
  actionLabel?: string;
}

function ChecklistItem({
  itemKey,
  label,
  required,
  done,
  doneAt,
  doneBy,
  sla,
  onMark,
  marking,
  actionLabel,
}: ChecklistItemProps) {
  // Three visual states:
  //   • done       — emerald check
  //   • pending+sla — clock icon, chip indicates ok/warning/overdue
  //   • pending+no sla — em-dash icon, slate
  let icon = <Minus className="h-4 w-4 text-slate-400" />;
  if (done) icon = <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  else if (sla) {
    if (sla.severity === "overdue") icon = <XCircle className="h-4 w-4 text-red-600" />;
    else icon = <Clock className="h-4 w-4 text-amber-600" />;
  }

  return (
    <li
      className="flex items-start gap-2 py-2"
      data-testid={`incident-checklist-${itemKey}`}
      data-done={done ? "true" : "false"}
    >
      <span className="pt-0.5 shrink-0">{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium">{label}</span>
          {!required && (
            <span className="text-[10px] text-muted-foreground">(not required)</span>
          )}
          {sla && !done && (
            <span
              className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border",
                SLA_CHIP_TONE[sla.severity],
              )}
            >
              {chevronEdgeTime(sla.dueAt, sla.severity)}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5">
          {done ? (
            <>
              {doneBy ? `${doneBy} · ` : ""}
              {doneAt ? fmtRelativeDone(doneAt) : "done"}
            </>
          ) : sla ? (
            <span>SLA timer running</span>
          ) : (
            <span>—</span>
          )}
        </p>
        {!done && onMark && actionLabel && (
          <Button
            size="sm"
            variant="outline"
            className="mt-1.5 h-7 text-xs"
            onClick={onMark}
            disabled={marking}
            data-testid={`incident-checklist-mark-${itemKey}`}
          >
            {marking ? "Marking…" : actionLabel}
          </Button>
        )}
      </div>
    </li>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// W4 — Close / Reopen modals
// Reuse Dialog + FormField + onSubmitKey + [Cancel][Primary] footer.
// closureNote and reason are each required ≥ 8 characters (server also
// enforces; we mirror client-side to provide inline error feedback).
// ─────────────────────────────────────────────────────────────────────────────

function CloseIncidentDialog({
  open,
  onOpenChange,
  incidentId,
  facilityNumber,
  blockingReasons,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  incidentId: number;
  facilityNumber: string;
  blockingReasons: string[];
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [showError, setShowError] = useState(false);

  const listKey = [`/api/ops/facilities/${facilityNumber}/incidents`] as const;
  const detailKey = [`/api/ops/incidents/${incidentId}/checklist`] as const;

  const closeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/incidents/${incidentId}/close`, {
        closureNote: note.trim(),
      });
      return res.json();
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: detailKey });
      const prev = qc.getQueryData<IncidentChecklistEnvelope>(detailKey);
      if (prev?.data) {
        qc.setQueryData(detailKey, {
          ...prev,
          data: { ...prev.data, status: "closed" },
        });
      }
      return { prev };
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(detailKey, ctx.prev);
      toast({ title: "Couldn't close", description: err.message, variant: "destructive" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/incidents/past-sla`],
      });
      toast({ title: "Incident closed" });
      onOpenChange(false);
      setNote("");
      setShowError(false);
    },
  });

  const isInvalid = note.trim().length < 8;
  const submit = () => {
    if (isInvalid || closeMutation.isPending) {
      setShowError(true);
      return;
    }
    closeMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setShowError(false); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Close incident</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          {blockingReasons.length > 0 && (
            <div
              className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800"
              role="alert"
            >
              <p className="font-medium mb-1">Blocked by:</p>
              <ul className="list-disc pl-4 space-y-0.5">
                {blockingReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            </div>
          )}
          <FormField
            label="Closure note"
            required
            hint="At least 8 characters. Summarise the outcome and resolution."
            error={showError && isInvalid ? "Closure note must be at least 8 characters." : undefined}
          >
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="resize-none min-h-[80px]"
              placeholder="Resolution summary, corrective action, follow-up plan…"
              data-testid="incident-close-note"
              aria-invalid={showError && isInvalid ? true : undefined}
            />
          </FormField>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="gradient"
              onClick={submit}
              disabled={closeMutation.isPending}
              data-testid="incident-close-submit"
            >
              {closeMutation.isPending ? "Closing…" : "Close incident"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-1 text-right">
            <kbd className="px-1 rounded border bg-gray-50">Enter</kbd> to save
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ReopenIncidentDialog({
  open,
  onOpenChange,
  incidentId,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  incidentId: number;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [showError, setShowError] = useState(false);

  const listKey = [`/api/ops/facilities/${facilityNumber}/incidents`] as const;
  const detailKey = [`/api/ops/incidents/${incidentId}/checklist`] as const;

  const reopenMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/incidents/${incidentId}/reopen`, {
        reason: reason.trim(),
      });
      return res.json();
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: detailKey });
      const prev = qc.getQueryData<IncidentChecklistEnvelope>(detailKey);
      if (prev?.data) {
        qc.setQueryData(detailKey, {
          ...prev,
          data: { ...prev.data, status: "under_review" },
        });
      }
      return { prev };
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(detailKey, ctx.prev);
      toast({ title: "Couldn't reopen", description: err.message, variant: "destructive" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: listKey });
      toast({ title: "Incident reopened — status set to under review" });
      onOpenChange(false);
      setReason("");
      setShowError(false);
    },
  });

  const isInvalid = reason.trim().length < 8;
  const submit = () => {
    if (isInvalid || reopenMutation.isPending) {
      setShowError(true);
      return;
    }
    reopenMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) setShowError(false); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reopen incident</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField
            label="Reason"
            required
            hint="At least 8 characters. Why is this being reopened?"
            error={showError && isInvalid ? "Reason must be at least 8 characters." : undefined}
          >
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="resize-none min-h-[80px]"
              placeholder="New evidence surfaced; corrective action incomplete…"
              data-testid="incident-reopen-reason"
              aria-invalid={showError && isInvalid ? true : undefined}
            />
          </FormField>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              variant="gradient"
              onClick={submit}
              disabled={reopenMutation.isPending}
              data-testid="incident-reopen-submit"
            >
              {reopenMutation.isPending ? "Reopening…" : "Reopen incident"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// W4 — Checklist panel
// Reads `/checklist`, renders the 9-step checklist + inline mark actions +
// Close / Reopen + closed-state banner.
// ─────────────────────────────────────────────────────────────────────────────

const CHECKLIST_ROWS: Array<{ key: ChecklistKey; label: string; actionLabel: string }> = [
  { key: "supervisor",       label: "Supervisor notified",         actionLabel: "Mark supervisor notified" },
  { key: "family",           label: "Family notified",             actionLabel: "Mark family notified" },
  { key: "physician",        label: "Physician notified",          actionLabel: "Mark physician notified" },
  { key: "ccldVerbal",       label: "CCLD verbal notification",    actionLabel: "Mark CCLD verbal notification given" },
  { key: "lic624",           label: "LIC 624 written report",      actionLabel: "Mark LIC 624 submitted" },
  { key: "soc341",           label: "SOC 341 abuse report",        actionLabel: "Mark SOC 341 submitted" },
  { key: "rootCause",        label: "Root cause documented",       actionLabel: "Mark root cause documented" },
  { key: "correctiveAction", label: "Corrective action documented",actionLabel: "Mark corrective action documented" },
  { key: "followUp",         label: "Follow-up complete",          actionLabel: "Mark follow-up complete" },
];

function IncidentChecklistPanel({
  incident,
  facilityNumber,
  rootCauseDraft,
  correctiveActionDraft,
}: {
  incident: Incident;
  facilityNumber: string;
  rootCauseDraft: string;
  correctiveActionDraft: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [closeOpen, setCloseOpen] = useState(false);
  const [reopenOpen, setReopenOpen] = useState(false);

  const detailKey = [`/api/ops/incidents/${incident.id}/checklist`] as const;
  const listKey = [`/api/ops/facilities/${facilityNumber}/incidents`] as const;

  const { data, isLoading, error } = useQuery<IncidentChecklistEnvelope | null>({
    queryKey: detailKey,
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: Number.isFinite(incident.id),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const cl = data?.data ?? null;

  // Reuses the EXISTING PUT /api/ops/incidents/:id endpoint — no parallel
  // mutation channels per the W4 spec.
  const markMutation = useMutation<unknown, Error, { key: ChecklistKey }>({
    mutationFn: async ({ key }) => {
      const now = Date.now();
      const body: Record<string, unknown> = {};
      switch (key) {
        case "supervisor":
          body.supervisorNotified = true;
          body.supervisorNotifiedAt = now;
          break;
        case "family":
          body.familyNotified = true;
          body.familyNotifiedAt = now;
          break;
        case "physician":
          body.physicianNotified = true;
          body.physicianNotifiedAt = now;
          break;
        case "ccldVerbal":
          body.ccldVerbalNotified = true;
          body.ccldVerbalNotifiedAt = now;
          break;
        case "lic624":
          body.lic624Submitted = true;
          body.lic624SubmittedAt = now;
          break;
        case "soc341":
          body.soc341Submitted = true;
          body.soc341SubmittedAt = now;
          break;
        case "rootCause":
          // Persist whatever the parent form currently has in the
          // rootCause textarea — the user already typed something or
          // the inline action wouldn't make sense.
          body.rootCause = rootCauseDraft.trim();
          break;
        case "correctiveAction":
          body.correctiveAction = correctiveActionDraft.trim();
          break;
        case "followUp":
          body.followUpCompleted = true;
          break;
      }
      const res = await apiRequest("PUT", `/api/ops/incidents/${incident.id}`, body);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: listKey });
      toast({ title: "Step updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't mark step", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="rounded-lg border p-4 space-y-2" data-testid="incident-checklist-loading">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-10 w-full" />
        ))}
      </div>
    );
  }

  if (error || !cl) {
    return (
      <div
        className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive"
        role="alert"
      >
        Couldn't load the action checklist.
      </div>
    );
  }

  const status = cl.status;
  const isClosed = status === "closed";

  // ── Done-detail lookup for each row.
  const doneAtFor = (key: ChecklistKey): number | null | undefined => {
    switch (key) {
      case "supervisor":       return incident.supervisorNotifiedAt;
      case "family":           return incident.familyNotifiedAt;
      case "physician":        return incident.physicianNotifiedAt;
      case "ccldVerbal":       return incident.ccldVerbalNotifiedAt;
      case "lic624":           return incident.lic624SubmittedAt;
      case "soc341":           return incident.soc341SubmittedAt;
      case "followUp":         return incident.followUpDate;
      default:                 return null;
    }
  };
  const doneByFor = (key: ChecklistKey): string | null | undefined => {
    if (key === "ccldVerbal") return incident.ccldVerbalNotifiedBy;
    return null;
  };
  const slaFor = (key: ChecklistKey): { dueAt: number; severity: SlaSeverity } | undefined => {
    if (key === "ccldVerbal" && cl.sla.ccldVerbalDueAt) {
      return { dueAt: cl.sla.ccldVerbalDueAt, severity: cl.sla.ccldVerbalSeverity ?? "ok" };
    }
    if (key === "lic624" && cl.sla.lic624DueAt) {
      return { dueAt: cl.sla.lic624DueAt, severity: cl.sla.lic624Severity ?? "ok" };
    }
    if (key === "soc341" && cl.sla.soc341DueAt) {
      return { dueAt: cl.sla.soc341DueAt, severity: cl.sla.soc341Severity ?? "ok" };
    }
    return undefined;
  };

  // Show only rows that are required for THIS incident.
  const rows = CHECKLIST_ROWS.filter((r) => cl.required[r.key]);

  return (
    <div className="space-y-3" data-testid="incident-checklist-panel">
      {/* Severity badge */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-medium">Action checklist</span>
        <span
          className={cn(
            "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border capitalize",
            cl.eventSeverity === "serious"
              ? "bg-red-100 text-red-700 border-red-200"
              : "bg-slate-100 text-slate-700 border-slate-200",
          )}
          data-testid="incident-severity-badge"
        >
          {cl.eventSeverity === "serious" ? "Serious" : "Non-Emergent"}
        </span>
      </div>

      {/* Closed / reopened banner */}
      {isClosed && incident.closedAt && (
        <div
          className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm"
          data-testid="incident-closed-banner"
        >
          <p className="font-medium">
            Closed
            {incident.closedBy ? ` by ${incident.closedBy}` : ""}
            {` on ${new Date(incident.closedAt).toLocaleString()}`}
          </p>
          {incident.closureNote && (
            <p className="mt-1 whitespace-pre-wrap text-emerald-900">{incident.closureNote}</p>
          )}
        </div>
      )}
      {!isClosed && incident.reopenedAt && (
        <div
          className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm"
          data-testid="incident-reopened-banner"
        >
          <p className="font-medium">
            Reopened
            {incident.reopenedBy ? ` by ${incident.reopenedBy}` : ""}
            {` on ${new Date(incident.reopenedAt).toLocaleString()}`}
          </p>
          {incident.reopenReason && (
            <p className="mt-1 whitespace-pre-wrap text-amber-900">{incident.reopenReason}</p>
          )}
        </div>
      )}

      {/* Checklist rows */}
      <ul
        className="rounded-lg border bg-white px-3 divide-y"
        data-testid="incident-checklist-list"
      >
        {rows.map((r) => {
          const done = cl.done[r.key];
          // Only show inline mark actions for "simple" boolean steps. The
          // rootCause / correctiveAction actions only make sense if the
          // user has typed something; we surface them anyway and let the
          // server reject empty values for an honest error.
          const onMark = !done && !isClosed ? () => markMutation.mutate({ key: r.key }) : undefined;
          return (
            <ChecklistItem
              key={r.key}
              itemKey={r.key}
              label={r.label}
              required={cl.required[r.key]}
              done={done}
              doneAt={doneAtFor(r.key)}
              doneBy={doneByFor(r.key)}
              sla={slaFor(r.key)}
              onMark={onMark}
              marking={markMutation.isPending && markMutation.variables?.key === r.key}
              actionLabel={r.actionLabel}
            />
          );
        })}
      </ul>

      {/* Close / Reopen */}
      <div className="flex flex-wrap items-start gap-2">
        {!isClosed && (
          <div className="flex flex-col gap-1">
            <Button
              variant="gradient"
              size="sm"
              onClick={() => setCloseOpen(true)}
              disabled={!cl.canClose}
              aria-disabled={!cl.canClose}
              title={!cl.canClose ? cl.blockingReasons.join(" · ") : "Close incident"}
              data-testid="incident-close-trigger"
            >
              <Lock className="h-3.5 w-3.5 mr-1" />
              Close incident
            </Button>
            {!cl.canClose && cl.blockingReasons.length > 0 && (
              <ul
                className="text-[11px] text-muted-foreground list-disc pl-4 mt-1"
                data-testid="incident-blocking-reasons"
              >
                {cl.blockingReasons.map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        {isClosed && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setReopenOpen(true)}
            data-testid="incident-reopen-trigger"
          >
            <RotateCcw className="h-3.5 w-3.5 mr-1" />
            Reopen incident
          </Button>
        )}
      </div>

      <CloseIncidentDialog
        open={closeOpen}
        onOpenChange={setCloseOpen}
        incidentId={incident.id}
        facilityNumber={facilityNumber}
        blockingReasons={cl.blockingReasons}
      />
      <ReopenIncidentDialog
        open={reopenOpen}
        onOpenChange={setReopenOpen}
        incidentId={incident.id}
        facilityNumber={facilityNumber}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// EditIncidentDialog (non-lifecycle basic fields)
//
// Edits incidentType, incidentDate, incidentTime, location, description,
// immediateActionTaken, injuryInvolved, injuryDescription,
// hospitalizationRequired, hospitalName, reportedBy. The W4 close/reopen
// lifecycle is NOT touched here — closed incidents must be reopened via the
// dedicated dialog before they can be edited.
//
// Pattern citations:
//   - <ReportIncidentDialog> form layout: line 213 above
//   - FormField + onSubmitKey + Enter hint: components/operations/FormField.tsx
//   - Optimistic update + rollback: CloseIncidentDialog above (line 547)
// ─────────────────────────────────────────────────────────────────────────────
function EditIncidentDialog({
  open,
  onOpenChange,
  incident,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  incident: Incident;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const initialFor = (i: Incident) => ({
    incidentType: i.incidentType ?? "",
    incidentDate: i.incidentDate
      ? new Date(i.incidentDate).toISOString().slice(0, 10)
      : "",
    incidentTime: i.incidentTime ?? "",
    location: i.location ?? "",
    description: i.description ?? "",
    immediateActionTaken: i.immediateActionTaken ?? "",
    injuryInvolved: !!i.injuryInvolved,
    injuryDescription:
      (i as unknown as { injuryDescription?: string | null }).injuryDescription ?? "",
    hospitalizationRequired:
      !!(i as unknown as { hospitalizationRequired?: boolean | number }).hospitalizationRequired,
    hospitalName:
      (i as unknown as { hospitalName?: string | null }).hospitalName ?? "",
    reportedBy: i.reportedBy ?? "",
  });

  const [form, setForm] = useState(() => initialFor(incident));
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (open) {
      setForm(initialFor(incident));
      setShowErrors(false);
    }
  }, [open, incident]);

  const listKey = [`/api/ops/facilities/${facilityNumber}/incidents`] as const;
  const detailKey = [`/api/ops/incidents/${incident.id}/checklist`] as const;

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        incidentType: form.incidentType,
        incidentDate: form.incidentDate ? toLocalEpochMs(form.incidentDate) : incident.incidentDate,
        incidentTime: form.incidentTime,
        location: form.location,
        description: form.description.trim(),
        immediateActionTaken: form.immediateActionTaken.trim(),
        injuryInvolved: form.injuryInvolved ? 1 : 0,
        injuryDescription: form.injuryDescription.trim() || null,
        hospitalizationRequired: form.hospitalizationRequired ? 1 : 0,
        hospitalName: form.hospitalName.trim() || null,
        reportedBy: form.reportedBy,
      };
      const res = await apiRequest("PUT", `/api/ops/incidents/${incident.id}`, body);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: listKey });
      qc.invalidateQueries({ queryKey: detailKey });
      toast({ title: "Incident updated" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't save", description: err.message, variant: "destructive" });
    },
  });

  const errors = {
    incidentType: !form.incidentType ? "Pick the incident type" : undefined,
    incidentDate: !form.incidentDate ? "When did it happen?" : undefined,
    description: form.description.trim().length === 0 ? "Describe what happened" : undefined,
  };
  const isValid = !errors.incidentType && !errors.incidentDate && !errors.description;
  const submit = () => {
    if (!isValid || mutation.isPending) {
      setShowErrors(true);
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit incident details</DialogTitle>
        </DialogHeader>
        <div className="space-y-4" onKeyDown={onSubmitKey(submit)}>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Incident Type"
              required
              error={showErrors ? errors.incidentType : undefined}
            >
              <Select
                value={form.incidentType}
                onValueChange={(v) => setForm((f) => ({ ...f, incidentType: v }))}
              >
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {INCIDENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">
                      {t.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Reported By">
              <Input
                value={form.reportedBy}
                onChange={(e) => setForm((f) => ({ ...f, reportedBy: e.target.value }))}
              />
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Date"
              required
              error={showErrors ? errors.incidentDate : undefined}
            >
              <Input
                type="date"
                value={form.incidentDate}
                onChange={(e) => setForm((f) => ({ ...f, incidentDate: e.target.value }))}
              />
            </FormField>
            <FormField label="Time">
              <Input
                type="time"
                value={form.incidentTime}
                onChange={(e) => setForm((f) => ({ ...f, incidentTime: e.target.value }))}
              />
            </FormField>
          </div>
          <FormField label="Location">
            <Input
              value={form.location}
              onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
              placeholder="e.g. Dining room"
            />
          </FormField>
          <FormField
            label="Description"
            required
            error={showErrors ? errors.description : undefined}
          >
            <Textarea
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="resize-none min-h-[80px]"
            />
          </FormField>
          <FormField label="Immediate Action Taken">
            <Textarea
              value={form.immediateActionTaken}
              onChange={(e) =>
                setForm((f) => ({ ...f, immediateActionTaken: e.target.value }))
              }
              className="resize-none min-h-[60px]"
            />
          </FormField>
          <div className="space-y-3 border rounded-lg p-3">
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-injury"
                checked={form.injuryInvolved}
                onCheckedChange={(v) => setForm((f) => ({ ...f, injuryInvolved: !!v }))}
              />
              <label htmlFor="edit-injury" className="text-sm cursor-pointer">
                Injury involved
              </label>
            </div>
            {form.injuryInvolved && (
              <FormField label="Injury Description">
                <Textarea
                  value={form.injuryDescription}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, injuryDescription: e.target.value }))
                  }
                  className="resize-none min-h-[60px]"
                />
              </FormField>
            )}
            <div className="flex items-center gap-2">
              <Checkbox
                id="edit-hospitalization"
                checked={form.hospitalizationRequired}
                onCheckedChange={(v) =>
                  setForm((f) => ({ ...f, hospitalizationRequired: !!v }))
                }
              />
              <label htmlFor="edit-hospitalization" className="text-sm cursor-pointer">
                Hospitalization required
              </label>
            </div>
            {form.hospitalizationRequired && (
              <FormField label="Hospital Name">
                <Input
                  value={form.hospitalName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, hospitalName: e.target.value }))
                  }
                  placeholder="Receiving hospital"
                />
              </FormField>
            )}
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              onClick={submit}
              disabled={mutation.isPending}
              data-testid="incident-edit-save"
            >
              {mutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-1 text-right">
            <kbd className="px-1 rounded border bg-gray-50">Enter</kbd> to save
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function IncidentRow({ incident, facilityNumber }: { incident: Incident; facilityNumber: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isWritable = useIsWritable();
  const [expanded, setExpanded] = useState(false);
  const [rootCause, setRootCause] = useState(incident.rootCause ?? "");
  const [correctiveAction, setCorrectiveAction] = useState(incident.correctiveAction ?? "");
  const [status, setStatus] = useState(incident.status ?? "open");
  const [editOpen, setEditOpen] = useState(false);
  const isClosed = (incident.status ?? "").toLowerCase() === "closed";

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "PUT",
        `/api/ops/incidents/${incident.id}`,
        { rootCause, correctiveAction, status }
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/incidents`] });
      qc.invalidateQueries({ queryKey: [`/api/ops/incidents/${incident.id}/checklist`] });
      toast({ title: "Incident updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Top-of-detail severity badge from the incident row itself (always shown).
  // The checklist panel re-asserts this from the canonical /checklist
  // response, but rendering it on the header avoids a flash during loading.
  const headerSeverity = incident.eventSeverity ?? null;

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #E0E7FF' }}>
      <button
        className="w-full text-left p-4 flex items-start gap-3 hover:bg-[#F0F4FF] transition-colors"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <IncidentCard
          incidentType={incident.incidentType}
          incidentDate={incident.incidentDate}
          incidentTime={incident.incidentTime}
          residentName={incident.residentName}
          reportedBy={incident.reportedBy}
          severity={headerSeverity}
          extras={
            incident.lic624Required && !incident.lic624Submitted ? (
              <Badge className="bg-orange-100 text-orange-700 border-orange-300 text-xs">LIC 624 Required</Badge>
            ) : null
          }
        />
        <Badge className={cn("text-xs shrink-0", STATUS_COLORS[incident.status] ?? "")}>
          {incident.status?.replace(/_/g, " ")}
        </Badge>
      </button>

      {expanded && (
        <div className="border-t p-4 space-y-4 text-sm">
          <div className="flex items-center justify-end gap-2">
            {isWritable && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setEditOpen(true)}
                disabled={isClosed}
                title={isClosed ? "Reopen to edit" : "Edit incident details"}
                aria-label="Edit incident details"
                data-testid="incident-edit-trigger"
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                Edit details
              </Button>
            )}
            <AuditTrailButton
              entityType="ops_incident"
              entityId={incident.id}
              facilityNumber={facilityNumber}
              labelText="History"
            />
          </div>
          <EditIncidentDialog
            open={editOpen}
            onOpenChange={setEditOpen}
            incident={incident}
            facilityNumber={facilityNumber}
          />


          <div>
            <p className="text-muted-foreground text-xs mb-0.5">Location</p>
            <p>{incident.location}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">Description</p>
            <p>{incident.description}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs mb-0.5">Immediate Action</p>
            <p>{incident.immediateActionTaken}</p>
          </div>
          <div className="space-y-2">
            <Label>Root Cause</Label>
            <Textarea
              value={rootCause}
              onChange={(e) => setRootCause(e.target.value)}
              placeholder="Document root cause analysis..."
              className="resize-none min-h-[60px]"
            />
          </div>
          <div className="space-y-2">
            <Label>Corrective Action</Label>
            <Textarea
              value={correctiveAction}
              onChange={(e) => setCorrectiveAction(e.target.value)}
              placeholder="Document corrective actions taken..."
              className="resize-none min-h-[60px]"
            />
          </div>
          <div className="space-y-2">
            <Label>Status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="sm:w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="under_review">Under Review</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            size="sm"
            variant="gradient"
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? "Saving..." : "Save"}
          </Button>

          {/* ── W4 — Action checklist + SLA + Close / Reopen ── */}
          <div className="pt-2 mt-2 border-t">
            <IncidentChecklistPanel
              incident={incident}
              facilityNumber={facilityNumber}
              rootCauseDraft={rootCause}
              correctiveActionDraft={correctiveAction}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function IncidentsContent({ facilityNumber, onBack }: { facilityNumber: string; onBack?: () => void }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  // Wave 3 Phase 3.2 — admin sees write actions; auditor session does not.
  const isWritable = useIsWritable();

  const { data: incidentsEnvelope, isLoading, error } = useQuery<{ success: boolean; data: Incident[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/incidents`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
  });

  // Active residents only — incidents are reported on people currently in
  // care. Past incidents on discharged residents stay readable in the list.
  const { residents } = useResidents(facilityNumber);

  const incidents = incidentsEnvelope?.data ?? [];

  const filtered = incidents.filter((i) => {
    const typeMatch = typeFilter === "all" || i.incidentType === typeFilter;
    const statusMatch = statusFilter === "all" || i.status === statusFilter;
    return typeMatch && statusMatch;
  });

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

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold" style={{ color: '#1E1B4B' }}>Incidents</h1>
        {isWritable && (
          <Button size="sm" variant="gradient" onClick={() => setReportOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Report Incident
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Select value={typeFilter} onValueChange={setTypeFilter}>
          <SelectTrigger className="sm:w-48">
            <SelectValue placeholder="Filter by type" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Types</SelectItem>
            {INCIDENT_TYPES.map((t) => (
              <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="sm:w-40">
            <SelectValue placeholder="Filter by status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Statuses</SelectItem>
            <SelectItem value="open">Open</SelectItem>
            <SelectItem value="under_review">Under Review</SelectItem>
            <SelectItem value="closed">Closed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          Failed to load incidents.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-16 w-full rounded-lg" />)}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <AlertTriangle className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            {incidents.length === 0 ? "No incidents recorded." : "No incidents match your filters."}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((incident) => (
            <IncidentRow key={incident.id} incident={incident} facilityNumber={facilityNumber} />
          ))}
        </div>
      )}

      <ReportIncidentDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        facilityNumber={facilityNumber}
        residents={residents}
      />
    </div>
  );
}

// Re-export the checklist panel and types for the smoke-test fixture.
export { IncidentChecklistPanel };
