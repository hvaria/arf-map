// NEW: expression-of-interest — curiosity-trap button for job seekers
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Send, CheckCircle2, Star, ChevronDown } from "lucide-react";
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
  status: string;
}

interface Props {
  facilityNumber: string;
  facilityName: string;
}

export function ExpressInterestButton({ facilityNumber, facilityName }: Props) {
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

  const existing = interests.find((i) => i.facilityNumber === facilityNumber);

  const submitMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/jobseeker/interests", {
        facilityNumber,
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
      <Button
        className="w-full"
        onClick={() => {
          setPendingAction({ type: "express_interest", facilityId: facilityNumber, facilityName });
          setLocation("/job-seeker");
        }}
      >
        <Send className="h-4 w-4 mr-2" />
        Express Interest
      </Button>
    );
  }

  // Shortlisted
  if (existing?.status === "shortlisted") {
    return (
      <Button
        disabled
        className="w-full bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-100 dark:bg-yellow-950/40 dark:text-yellow-300 dark:border-yellow-800"
        variant="outline"
        title="The facility is reviewing your profile"
      >
        <Star className="h-4 w-4 mr-2 fill-yellow-500 text-yellow-500" />
        Shortlisted ✓
      </Button>
    );
  }

  // Already applied (pending or viewed)
  if (existing) {
    return (
      <Button disabled variant="secondary" className="w-full text-green-700 dark:text-green-400">
        <CheckCircle2 className="h-4 w-4 mr-2 text-green-600 dark:text-green-400" />
        Interest Sent ✓
      </Button>
    );
  }

  // Logged in, not yet applied — show dialog
  return (
    <>
      <Button className="w-full" onClick={() => setDialogOpen(true)}>
        <Send className="h-4 w-4 mr-2" />
        Express Interest
      </Button>

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
              <Button
                className="flex-1"
                onClick={() => submitMutation.mutate()}
                disabled={submitMutation.isPending}
              >
                {submitMutation.isPending ? "Sending…" : "Send Interest"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
