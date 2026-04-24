import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import PortalLayout from "./PortalLayout";
import { AdmissionsContent } from "./AdmissionsPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { Plus, UserPlus, Clock, ArrowLeft } from "lucide-react";

interface SessionUser {
  id: number;
  facilityNumber: string;
  username: string;
}

type LeadStage =
  | "inquiry"
  | "tour_scheduled"
  | "tour_completed"
  | "application"
  | "medical_review"
  | "approved"
  | "moved_in"
  | "lost";

interface Lead {
  id: number;
  facilityNumber: string;
  prospectName: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  careNeeds: string;
  nextFollowUpDate: number | null;
  stage: LeadStage;
  notes: string;
  createdAt: number;
  tourDate: number | null;
}

const STAGES: LeadStage[] = [
  "inquiry",
  "tour_scheduled",
  "tour_completed",
  "application",
  "medical_review",
  "approved",
  "moved_in",
  "lost",
];

const STAGE_LABELS: Record<LeadStage, string> = {
  inquiry: "Inquiry",
  tour_scheduled: "Tour Scheduled",
  tour_completed: "Tour Completed",
  application: "Application",
  medical_review: "Medical Review",
  approved: "Approved",
  moved_in: "Moved In",
  lost: "Lost",
};

interface LeadFormData {
  prospectName: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  careNeeds: string;
  nextFollowUpDate: string;
  stage: string;
  notes: string;
}

const EMPTY_FORM: LeadFormData = {
  prospectName: "",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  careNeeds: "",
  nextFollowUpDate: "",
  stage: "inquiry",
  notes: "",
};

function AddLeadDialog({
  open,
  onOpenChange,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<LeadFormData>(EMPTY_FORM);

  const set = (k: keyof LeadFormData, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/leads`, {
        ...form,
        nextFollowUpDate: form.nextFollowUpDate ? new Date(form.nextFollowUpDate).getTime() : null,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/leads`] });
      toast({ title: "Lead added" });
      onOpenChange(false);
      setForm(EMPTY_FORM);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add Lead</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Prospect Name</Label>
            <Input value={form.prospectName} onChange={(e) => set("prospectName", e.target.value)} placeholder="Resident's name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Contact Name</Label>
              <Input value={form.contactName} onChange={(e) => set("contactName", e.target.value)} placeholder="Family contact" />
            </div>
            <div className="space-y-1.5">
              <Label>Contact Phone</Label>
              <Input value={form.contactPhone} onChange={(e) => set("contactPhone", e.target.value)} placeholder="Phone" />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Contact Email</Label>
            <Input type="email" value={form.contactEmail} onChange={(e) => set("contactEmail", e.target.value)} placeholder="email@example.com" />
          </div>
          <div className="space-y-1.5">
            <Label>Care Needs</Label>
            <Textarea
              value={form.careNeeds}
              onChange={(e) => set("careNeeds", e.target.value)}
              placeholder="Describe care needs..."
              className="resize-none min-h-[60px]"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Stage</Label>
              <Select value={form.stage} onValueChange={(v) => set("stage", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STAGES.map((s) => (
                    <SelectItem key={s} value={s}>{STAGE_LABELS[s]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Next Follow-up</Label>
              <Input type="date" value={form.nextFollowUpDate} onChange={(e) => set("nextFollowUpDate", e.target.value)} />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              placeholder="Additional notes..."
              className="resize-none min-h-[60px]"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.prospectName}>
              {mutation.isPending ? "Adding..." : "Add Lead"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function TourDialog({
  lead,
  facilityNumber,
  onClose,
}: {
  lead: Lead;
  facilityNumber: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tourDatetime, setTourDatetime] = useState("");

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "PUT",
        `/api/ops/leads/${lead.id}`,
        {
          tourDate: tourDatetime ? new Date(tourDatetime).getTime() : null,
          stage: "tour_scheduled",
        }
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/leads`] });
      toast({ title: "Tour scheduled" });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div className="space-y-3 p-4 border rounded-lg bg-muted/30">
      <p className="text-sm font-medium">Schedule Tour for {lead.prospectName}</p>
      <div className="space-y-1.5">
        <Label>Tour Date & Time</Label>
        <Input type="datetime-local" value={tourDatetime} onChange={(e) => setTourDatetime(e.target.value)} />
      </div>
      <div className="flex gap-2">
        <Button size="sm" onClick={() => mutation.mutate()} disabled={mutation.isPending || !tourDatetime}>
          {mutation.isPending ? "Scheduling..." : "Confirm Tour"}
        </Button>
        <Button size="sm" variant="outline" onClick={onClose}>Cancel</Button>
      </div>
    </div>
  );
}

function LeadCard({
  lead,
  facilityNumber,
  onViewAdmissions,
}: {
  lead: Lead;
  facilityNumber: string;
  onViewAdmissions: (leadId: number) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [showTourForm, setShowTourForm] = useState(false);

  const now = Date.now();
  const isOverdue = lead.nextFollowUpDate && lead.nextFollowUpDate < now;

  const moveStage = useMutation({
    mutationFn: async (newStage: LeadStage) => {
      const res = await apiRequest(
        "PUT",
        `/api/ops/leads/${lead.id}`,
        { stage: newStage }
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/leads`] });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <div
      className={cn(
        "rounded-lg border bg-background p-3 space-y-2 cursor-pointer",
        isOverdue ? "border-red-300 shadow-sm" : ""
      )}
    >
      <button
        className="w-full text-left"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <p className="font-medium text-sm">{lead.prospectName}</p>
        <p className="text-xs text-muted-foreground">{lead.contactName}</p>
        {lead.careNeeds && (
          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{lead.careNeeds}</p>
        )}
        {lead.nextFollowUpDate && (
          <div className={cn("flex items-center gap-1 text-xs mt-1", isOverdue ? "text-red-600" : "text-muted-foreground")}>
            <Clock className="h-3 w-3" />
            <span>Follow up: {new Date(lead.nextFollowUpDate).toLocaleDateString()}</span>
          </div>
        )}
      </button>

      {expanded && (
        <div className="pt-2 border-t space-y-2">
          <div className="text-xs text-muted-foreground space-y-0.5">
            <p>Phone: {lead.contactPhone}</p>
            <p>Email: {lead.contactEmail}</p>
            {lead.tourDate && <p>Tour: {new Date(lead.tourDate).toLocaleString()}</p>}
            {lead.notes && <p>Notes: {lead.notes}</p>}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {lead.stage !== "tour_scheduled" && lead.stage !== "moved_in" && lead.stage !== "lost" && (
              <Button size="sm" variant="outline" className="text-xs h-7" onClick={() => setShowTourForm(true)}>
                Schedule Tour
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="text-xs h-7"
              onClick={() => onViewAdmissions(lead.id)}
            >
              View Admissions
            </Button>
            {lead.stage !== "moved_in" && lead.stage !== "lost" && (
              <Button
                size="sm"
                variant="ghost"
                className="text-xs h-7 text-destructive hover:text-destructive"
                onClick={() => moveStage.mutate("lost")}
                disabled={moveStage.isPending}
              >
                Mark Lost
              </Button>
            )}
          </div>
          {showTourForm && (
            <TourDialog
              lead={lead}
              facilityNumber={facilityNumber}
              onClose={() => setShowTourForm(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

export function CrmContent({ facilityNumber, onBack }: { facilityNumber: string; onBack?: () => void }) {
  const [addOpen, setAddOpen] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<number | null>(null);

  const { data: envelope, isLoading, error } = useQuery<{ success: boolean; data: Lead[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/leads`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
  });

  const leads = envelope?.data ?? [];

  // If a lead is selected, show admissions drilldown
  if (selectedLeadId !== null) {
    return (
      <AdmissionsContent
        facilityNumber={facilityNumber}
        leadId={String(selectedLeadId)}
        onBack={() => setSelectedLeadId(null)}
      />
    );
  }

  const leadsByStage = STAGES.reduce<Record<LeadStage, Lead[]>>((acc, stage) => {
    acc[stage] = leads.filter((l) => l.stage === stage);
    return acc;
  }, {} as Record<LeadStage, Lead[]>);

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
        <h1 className="text-xl font-semibold">CRM</h1>
        <Button size="sm" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Lead
        </Button>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          Failed to load leads.
        </div>
      )}

      {isLoading ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {STAGES.map((s) => (
            <div key={s} className="min-w-[220px] space-y-2">
              <Skeleton className="h-6 w-32" />
              <Skeleton className="h-24 w-full" />
            </div>
          ))}
        </div>
      ) : (
        /* Kanban board — horizontal scroll on mobile */
        <div className="overflow-x-auto pb-4">
          <div className="flex gap-4" style={{ minWidth: "max-content" }}>
            {STAGES.map((stage) => (
              <div key={stage} className="w-56 flex-shrink-0">
                <div className="flex items-center gap-1.5 mb-2">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    {STAGE_LABELS[stage]}
                  </h2>
                  {leadsByStage[stage].length > 0 && (
                    <Badge variant="secondary" className="text-xs h-4 px-1">
                      {leadsByStage[stage].length}
                    </Badge>
                  )}
                </div>
                <div className="space-y-2 min-h-[60px] rounded-lg bg-muted/30 p-2">
                  {leadsByStage[stage].length === 0 ? (
                    <div className="text-xs text-muted-foreground text-center py-4">Empty</div>
                  ) : (
                    leadsByStage[stage].map((lead) => (
                      <LeadCard
                        key={lead.id}
                        lead={lead}
                        facilityNumber={facilityNumber}
                        onViewAdmissions={setSelectedLeadId}
                      />
                    ))
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <AddLeadDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        facilityNumber={facilityNumber}
      />
    </div>
  );
}

export default function CrmPage() {
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
      <CrmContent facilityNumber={facilityNumber} />
    </PortalLayout>
  );
}
