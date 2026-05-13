import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Send, CheckCircle2, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { setPendingAction } from "@/lib/pendingAction";

const ROLE_OPTIONS = [
  "General Interest",
  "Caregiver",
  "Direct Support Professional (DSP)",
  "Program Director",
  "Administrator",
  "House Manager",
  "Night Awake Staff",
  "On-call / PRN Staff",
  "Registered Nurse (RN)",
  "Licensed Vocational Nurse (LVN)",
  "Certified Nursing Assistant (CNA)",
  "Medication Technician",
  "Social Worker",
  "Mental Health Worker",
  "Behavior Technician",
  "Life Skills Coach",
  "Cook / Chef",
  "Activities Coordinator",
  "Driver / Transportation",
  "Maintenance / Facilities",
];

interface JobSeekerAuth {
  id: number;
  email: string;
}

interface SeekerInterest {
  id: number;
  facilityNumber: string;
  jobId: number | null;
  status: string;
}

interface Props {
  facilityNumber: string;
  facilityName: string;
  /**
   * When provided, this button represents per-job interest. The "already
   * applied" indicator and the upsert are scoped to (seeker, jobId) so a
   * facility with multiple openings has independent state per posting.
   * Omit for facility-level interest (legacy behavior on `<FacilityPanel>`).
   */
  jobId?: number;
  /** Optional CTA label override — defaults to "Express Interest". */
  ctaLabel?: string;
}

export function ExpressInterestButton({ facilityNumber, facilityName, jobId, ctaLabel }: Props) {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [role, setRole] = useState("General Interest");
  const [message, setMessage] = useState("");

  const { data: me } = useQuery<JobSeekerAuth | null>({
    queryKey: ["/api/jobseeker/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 60000,
  });

  const { data: interests = [] } = useQuery<SeekerInterest[]>({
    queryKey: ["/api/jobseeker/interests"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!me,
    staleTime: 30000,
  });

  // Scope the "already applied" check to the right grain. Per-job grain
  // (jobId provided) finds an exact (seeker, jobId) row. Facility grain
  // (jobId omitted) finds a (seeker, facilityNumber, jobId IS NULL) row.
  // A facility-level interest does NOT light up "Interest Sent" on a job
  // detail page, and applying to one job at a facility does NOT light up
  // "Interest Sent" on the facility panel — these are independent intents.
  const existing = jobId != null
    ? interests.find((i) => i.jobId === jobId)
    : interests.find((i) => i.facilityNumber === facilityNumber && i.jobId == null);

  const submitMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/jobseeker/interests", {
        facilityNumber,
        jobId,
        roleInterest: role,
        message: message.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobseeker/interests"] });
      setDialogOpen(false);
      setMessage("");
      toast({ title: `Interest sent to ${facilityName}!` });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to submit", description: err.message, variant: "destructive" });
    },
  });

  // Not logged in — curiosity trap: write pending action and go to register
  if (!me) {
    return (
      <button
        className="portal-btn-primary w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold"
        onClick={() => {
          setPendingAction({ type: "express_interest", facilityId: facilityNumber, facilityName });
          setLocation("/job-seeker");
        }}
      >
        <Send className="h-4 w-4" />
        {ctaLabel ?? "Express Interest"}
      </button>
    );
  }

  // Shortlisted
  if (existing?.status === "shortlisted") {
    return (
      <button
        disabled
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-[10px] opacity-80 cursor-not-allowed"
        style={{ background: "#D1FAE5", color: "#065F46", border: "1px solid #BBF7D0" }}
        title="The facility is reviewing your profile"
      >
        <Star className="h-4 w-4 fill-[#065F46]" />
        Shortlisted ✓
      </button>
    );
  }

  // Already applied (pending or viewed)
  if (existing) {
    return (
      <button
        disabled
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-[10px] cursor-not-allowed"
        style={{ background: "#F0F4FF", color: "#4F46E5", border: "1px solid #E0E7FF" }}
      >
        <CheckCircle2 className="h-4 w-4" />
        Interest Sent ✓
      </button>
    );
  }

  // Logged in, not yet applied — show dialog
  return (
    <>
      <button
        className="portal-btn-primary w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold"
        onClick={() => setDialogOpen(true)}
      >
        <Send className="h-4 w-4" />
        {ctaLabel ?? "Express Interest"}
      </button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Express Interest</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground -mt-2">
            Let <span className="font-medium text-foreground">{facilityName}</span> know you're interested in working there.
          </p>

          <div className="space-y-4 pt-1">
            <div className="space-y-1.5">
              <Label>Role you're interested in</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label>
                Message <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                placeholder="Briefly introduce yourself or note your availability…"
                rows={3}
                maxLength={500}
                className="resize-none"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <p className="text-xs text-muted-foreground text-right">{message.length}/500</p>
            </div>

            <div className="flex gap-2 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setDialogOpen(false)}>
                Cancel
              </Button>
              <button
                className="portal-btn-primary flex-1 flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold disabled:opacity-60 disabled:cursor-not-allowed"
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending ? "Sending…" : "Send Interest"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
