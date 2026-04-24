import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation, useParams } from "wouter";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import PortalLayout from "./PortalLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { ArrowLeft, Pencil, Plus, Check, X } from "lucide-react";

interface SessionUser {
  id: number;
  facilityNumber: string;
  username: string;
}

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
  residentSignedAt: number | null;
  familySignedAt: number | null;
}

interface DailyTask {
  id: number;
  description: string;
  scheduledDate: number;
  status: string;
}

interface Medication {
  id: number;
  drugName: string;
  dosage: string;
  route: string;
  frequency: string;
  scheduledTimes: string[];
  status: string;
  prescriber: string;
}

interface Incident {
  id: number;
  incidentType: string;
  incidentDate: number;
  description: string;
  status: string;
  reportedBy: string;
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
          ...form,
          bathing: Number(form.bathing),
          dressing: Number(form.dressing),
          grooming: Number(form.grooming),
          toileting: Number(form.toileting),
          eating: Number(form.eating),
          mobility: Number(form.mobility),
          transfers: Number(form.transfers),
          cognitionScore: Number(form.cognitionScore),
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
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? "Saving..." : "Save Assessment"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AddMedDialog({
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
    drugName: "",
    dosage: "",
    route: "",
    frequency: "",
    scheduledTimes: "",
    prescriber: "",
  });

  const set = (k: keyof typeof form, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/ops/facilities/${facilityNumber}/residents/${residentId}/medications`,
        {
          ...form,
          scheduledTimes: form.scheduledTimes.split(",").map((t) => t.trim()).filter(Boolean),
        }
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentId}/medications`] });
      toast({ title: "Medication added" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Medication</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Drug Name</Label>
            <Input value={form.drugName} onChange={(e) => set("drugName", e.target.value)} placeholder="e.g. Lisinopril" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Dosage</Label>
              <Input value={form.dosage} onChange={(e) => set("dosage", e.target.value)} placeholder="e.g. 10mg" />
            </div>
            <div className="space-y-1.5">
              <Label>Route</Label>
              <Select value={form.route} onValueChange={(v) => set("route", v)}>
                <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="oral">Oral</SelectItem>
                  <SelectItem value="topical">Topical</SelectItem>
                  <SelectItem value="sublingual">Sublingual</SelectItem>
                  <SelectItem value="injectable">Injectable</SelectItem>
                  <SelectItem value="inhaled">Inhaled</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Frequency</Label>
            <Input value={form.frequency} onChange={(e) => set("frequency", e.target.value)} placeholder="e.g. Once daily" />
          </div>
          <div className="space-y-1.5">
            <Label>Scheduled Times (comma-separated)</Label>
            <Input value={form.scheduledTimes} onChange={(e) => set("scheduledTimes", e.target.value)} placeholder="e.g. 08:00, 20:00" />
          </div>
          <div className="space-y-1.5">
            <Label>Prescriber</Label>
            <Input value={form.prescriber} onChange={(e) => set("prescriber", e.target.value)} placeholder="Dr. Smith" />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending}>
              {mutation.isPending ? "Adding..." : "Add Medication"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
        status: "draft",
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
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.goal || !form.intervention}>
              {mutation.isPending ? "Creating..." : "Create Care Plan"}
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

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/incidents`, {
        ...form,
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
            <Label>Description</Label>
            <Textarea value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Describe what happened" rows={3} />
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
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.incidentType || !form.description}>
              {mutation.isPending ? "Reporting..." : "Report Incident"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
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
  const [assessmentOpen, setAssessmentOpen] = useState(false);
  const [addMedOpen, setAddMedOpen] = useState(false);
  const [createCarePlanOpen, setCreateCarePlanOpen] = useState(false);
  const [reportIncidentOpen, setReportIncidentOpen] = useState(false);
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
    mutationFn: async (medId: number) => {
      const res = await apiRequest(
        "PATCH",
        `/api/ops/facilities/${facilityNumber}/residents/${residentIdStr}/medications/${medId}`,
        { status: "discontinued" }
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentIdStr}/medications`] });
      toast({ title: "Medication discontinued" });
    },
  });

  const signCarePlanMutation = useMutation({
    mutationFn: async (signType: "resident" | "family") => {
      const res = await apiRequest(
        "PATCH",
        `/api/ops/facilities/${facilityNumber}/residents/${residentIdStr}/care-plan/sign`,
        { signType }
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/residents/${residentIdStr}/care-plan`] });
      toast({ title: "Signed successfully" });
    },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayTasks = dailyTasks.filter((t) => {
    const taskDate = new Date(t.scheduledDate);
    taskDate.setHours(0, 0, 0, 0);
    return taskDate.getTime() === today.getTime();
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

      <div className="flex items-center gap-3">
        <div>
          <h1 className="text-xl font-semibold">
            {resident.firstName} {resident.lastName}
          </h1>
          <p className="text-sm text-muted-foreground">
            Room {resident.roomNumber} &middot; Admitted {new Date(resident.admissionDate).toLocaleDateString()}
          </p>
        </div>
        <Badge variant={resident.status === "active" ? "default" : "secondary"} className="ml-auto">
          {resident.status}
        </Badge>
      </div>

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
              <Button size="sm" onClick={() => setCreateCarePlanOpen(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                Create Care Plan
              </Button>
            </div>
          ) : (
            <>
              <div className="rounded-lg border overflow-hidden">
                <div className="px-4 py-3 border-b flex items-center justify-between">
                  <span className="text-sm font-medium">Active Care Plan</span>
                  <Badge variant={carePlan.status === "active" ? "default" : "secondary"}>
                    {carePlan.status}
                  </Badge>
                </div>
                <FieldRow label="Goal" value={carePlan.goal} />
                <FieldRow label="Intervention" value={carePlan.intervention} />
                <FieldRow label="Frequency" value={carePlan.frequency} />
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant={carePlan.residentSignedAt ? "secondary" : "outline"}
                  onClick={() => signCarePlanMutation.mutate("resident")}
                  disabled={!!carePlan.residentSignedAt || signCarePlanMutation.isPending}
                >
                  {carePlan.residentSignedAt
                    ? `Resident Signed ${new Date(carePlan.residentSignedAt).toLocaleDateString()}`
                    : "Resident Sign"}
                </Button>
                <Button
                  size="sm"
                  variant={carePlan.familySignedAt ? "secondary" : "outline"}
                  onClick={() => signCarePlanMutation.mutate("family")}
                  disabled={!!carePlan.familySignedAt || signCarePlanMutation.isPending}
                >
                  {carePlan.familySignedAt
                    ? `Family Signed ${new Date(carePlan.familySignedAt).toLocaleDateString()}`
                    : "Family Sign"}
                </Button>
              </div>
            </>
          )}

          <CreateCarePlanDialog
            open={createCarePlanOpen}
            onOpenChange={setCreateCarePlanOpen}
            residentId={residentIdStr}
            facilityNumber={facilityNumber}
          />

          <div>
            <h2 className="text-sm font-medium mb-3">Today's Tasks</h2>
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
            <Button size="sm" variant="outline" onClick={() => setAddMedOpen(true)}>
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
                  <div key={m.id} className="rounded-lg border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-sm">{m.drugName}</span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive text-xs"
                        onClick={() => discontinueMedMutation.mutate(m.id)}
                        disabled={discontinueMedMutation.isPending}
                      >
                        Discontinue
                      </Button>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-2">
                      <span>{m.dosage}</span>
                      <span>via {m.route}</span>
                      <span>{m.frequency}</span>
                      {m.scheduledTimes?.length > 0 && (
                        <span>at {m.scheduledTimes.join(", ")}</span>
                      )}
                    </div>
                    {m.prescriber && (
                      <p className="text-xs text-muted-foreground mt-0.5">Prescriber: {m.prescriber}</p>
                    )}
                  </div>
                ))}
            </div>
          )}
          <AddMedDialog
            open={addMedOpen}
            onOpenChange={setAddMedOpen}
            residentId={residentIdStr}
            facilityNumber={facilityNumber}
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
                <div key={i.id} className="rounded-lg border p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-sm capitalize">{i.incidentType?.replace(/_/g, " ")}</span>
                    <Badge variant="outline">{i.status}</Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">
                    {new Date(i.incidentDate).toLocaleDateString()} &middot; {i.reportedBy}
                  </p>
                  <p className="text-sm mt-1 line-clamp-2">{i.description}</p>
                </div>
              ))}
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default function ResidentProfilePage() {
  const params = useParams<{ id: string }>();
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
      <div className="space-y-4">
        <div className="flex items-center gap-2">
          <a
            href="/#/portal/residents"
            className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Residents
          </a>
        </div>
        <ResidentProfileContent
          facilityNumber={facilityNumber}
          residentId={Number(params.id)}
        />
      </div>
    </PortalLayout>
  );
}
