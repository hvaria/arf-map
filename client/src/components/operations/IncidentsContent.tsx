import { useState } from "react";
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
import { Plus, AlertTriangle, ArrowLeft } from "lucide-react";

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
  rootCause?: string;
  correctiveAction?: string;
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

function IncidentRow({ incident, facilityNumber }: { incident: Incident; facilityNumber: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [rootCause, setRootCause] = useState(incident.rootCause ?? "");
  const [correctiveAction, setCorrectiveAction] = useState(incident.correctiveAction ?? "");

  const updateMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "PUT",
        `/api/ops/incidents/${incident.id}`,
        { rootCause, correctiveAction }
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/incidents`] });
      toast({ title: "Incident updated" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: '1px solid #E0E7FF' }}>
      <button
        className="w-full text-left p-4 flex items-start gap-3 hover:bg-[#F0F4FF] transition-colors"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm capitalize">{incident.incidentType?.replace(/_/g, " ")}</span>
            {incident.lic624Required && !incident.lic624Submitted && (
              <Badge className="bg-orange-100 text-orange-700 border-orange-300 text-xs">LIC 624 Required</Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {new Date(incident.incidentDate).toLocaleDateString()} {incident.incidentTime}
            {incident.residentName && ` · ${incident.residentName}`}
            {` · ${incident.reportedBy}`}
          </p>
        </div>
        <Badge className={cn("text-xs shrink-0", STATUS_COLORS[incident.status] ?? "")}>
          {incident.status?.replace(/_/g, " ")}
        </Badge>
      </button>

      {expanded && (
        <div className="border-t p-4 space-y-3 text-sm">
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
          <Button
            size="sm"
            variant="gradient"
            onClick={() => updateMutation.mutate()}
            disabled={updateMutation.isPending}
          >
            {updateMutation.isPending ? "Saving..." : "Save"}
          </Button>
        </div>
      )}
    </div>
  );
}

export function IncidentsContent({ facilityNumber, onBack }: { facilityNumber: string; onBack?: () => void }) {
  const [reportOpen, setReportOpen] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");

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
        <Button size="sm" variant="gradient" onClick={() => setReportOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Report Incident
        </Button>
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
