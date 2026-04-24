import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import PortalLayout from "./PortalLayout";
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
import { Plus, AlertTriangle, ArrowLeft } from "lucide-react";

interface SessionUser {
  id: number;
  facilityNumber: string;
  username: string;
}

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

const EMPTY_FORM: IncidentFormData = {
  incidentType: "",
  incidentDate: new Date().toISOString().slice(0, 10),
  incidentTime: new Date().toTimeString().slice(0, 5),
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
  const [form, setForm] = useState<IncidentFormData>(EMPTY_FORM);

  const set = <K extends keyof IncidentFormData>(key: K, value: IncidentFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation({
    mutationFn: async () => {
      const body = {
        ...form,
        residentId: form.residentId && form.residentId !== "none" ? Number(form.residentId) : null,
        incidentDate: form.incidentDate ? new Date(form.incidentDate).getTime() : Date.now(),
        supervisorNotifiedAt: form.supervisorNotifiedAt ? new Date(form.supervisorNotifiedAt).getTime() : null,
        familyNotifiedAt: form.familyNotifiedAt ? new Date(form.familyNotifiedAt).getTime() : null,
        physicianNotifiedAt: form.physicianNotifiedAt ? new Date(form.physicianNotifiedAt).getTime() : null,
      };
      const res = await apiRequest("POST", `/api/ops/incidents`, body);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/incidents`] });
      toast({ title: "Incident reported" });
      onOpenChange(false);
      setForm({ ...EMPTY_FORM, residentId: "none" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Report Incident</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Incident Type</Label>
              <Select value={form.incidentType} onValueChange={(v) => set("incidentType", v)}>
                <SelectTrigger><SelectValue placeholder="Select type" /></SelectTrigger>
                <SelectContent>
                  {INCIDENT_TYPES.map((t) => (
                    <SelectItem key={t} value={t} className="capitalize">{t.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Resident (optional)</Label>
              <Select value={form.residentId} onValueChange={(v) => set("residentId", v)}>
                <SelectTrigger><SelectValue placeholder="Select resident" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {Array.isArray(residents) && residents.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.firstName} {r.lastName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Date</Label>
              <Input type="date" value={form.incidentDate} onChange={(e) => set("incidentDate", e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Time</Label>
              <Input type="time" value={form.incidentTime} onChange={(e) => set("incidentTime", e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Location</Label>
            <Input value={form.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Dining room" />
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Describe what happened..."
              className="resize-none min-h-[80px]"
            />
          </div>

          <div className="space-y-1.5">
            <Label>Immediate Action Taken</Label>
            <Textarea
              value={form.immediateActionTaken}
              onChange={(e) => set("immediateActionTaken", e.target.value)}
              placeholder="What was done immediately..."
              className="resize-none min-h-[60px]"
            />
          </div>

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
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.incidentType}>
              {mutation.isPending ? "Reporting..." : "Report Incident"}
            </Button>
          </div>
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
    <div className="rounded-lg border overflow-hidden">
      <button
        className="w-full text-left p-4 flex items-start gap-3 hover:bg-muted/30 transition-colors"
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
          <Button size="sm" onClick={() => updateMutation.mutate()} disabled={updateMutation.isPending}>
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

  const { data: residentsEnvelope } = useQuery<{ success: boolean; data: Resident[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/residents`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
  });

  const incidents = incidentsEnvelope?.data ?? [];
  const residents = residentsEnvelope?.data ?? [];

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
        <h1 className="text-xl font-semibold">Incidents</h1>
        <Button size="sm" onClick={() => setReportOpen(true)}>
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

export default function IncidentsPage() {
  const [, navigate] = useLocation();

  const { data: me } = useQuery<SessionUser | null>({
    queryKey: ["/api/facility/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000,
  });

  const facilityNumber = me?.facilityNumber ?? "";

  useEffect(() => {
    if (me === null) navigate("/facility-portal");
  }, [me, navigate]);

  if (me === null) return null;

  return (
    <PortalLayout>
      <IncidentsContent facilityNumber={facilityNumber} />
    </PortalLayout>
  );
}
