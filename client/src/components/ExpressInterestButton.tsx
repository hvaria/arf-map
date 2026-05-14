import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Send, CheckCircle2, Star, Briefcase, Building2, MapPin, Mail, Info } from "lucide-react";
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
import { CredentialBadge, useCredentials } from "@/components/CredentialBadge";

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

// Slim shape of /api/jobseeker/profile — used to render the "what the
// facility will see" preview inside the apply dialog. The endpoint
// returns more, we only surface the fields a hiring team actually scans
// at first glance.
interface JobSeekerProfileLite {
  firstName: string | null;
  lastName: string | null;
  city: string | null;
  state: string | null;
  phone: string | null;
  yearsExperience: number | null;
  jobTypes: string[] | null;
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
  /**
   * When per-job, the job's title — drives the dialog title, the body
   * copy, and the success toast so the modal reads like an apply flow
   * ("Apply to Caregiver — Sunny Acres") rather than a generic
   * "Express Interest" form.
   */
  jobTitle?: string;
  /** Optional CTA label override — defaults to "Express Interest". */
  ctaLabel?: string;
}

export function ExpressInterestButton({ facilityNumber, facilityName, jobId, jobTitle, ctaLabel }: Props) {
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

  // Profile preview — fetched only once the dialog opens so we never
  // pay for it on FacilityPanel mount. The data is the same payload
  // /api/jobseeker/profile already returns; we just slice the fields a
  // facility actually scans first ("who is this person?").
  const { data: profile } = useQuery<JobSeekerProfileLite | null>({
    queryKey: ["/api/jobseeker/profile"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!me && dialogOpen,
    staleTime: 60000,
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

  // Per-job applications submit the job title as roleInterest so the
  // facility-side inbox shows the specific posting the seeker applied
  // to. Facility-level interest keeps using the dropdown's "what role
  // are you looking for" value.
  const isPerJob = jobId != null;
  const effectiveRole = isPerJob ? (jobTitle ?? role) : role;

  const submitMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/jobseeker/interests", {
        facilityNumber,
        jobId,
        roleInterest: effectiveRole,
        message: message.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobseeker/interests"] });
      setDialogOpen(false);
      setMessage("");
      toast({
        title: isPerJob ? "Application submitted" : `Interest sent to ${facilityName}`,
        description: isPerJob && jobTitle
          ? `${facilityName} will review your application for ${jobTitle}.`
          : undefined,
      });
    },
    onError: (err: Error) => {
      toast({
        title: isPerJob ? "Failed to submit application" : "Failed to submit",
        description: err.message,
        variant: "destructive",
      });
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
            <DialogTitle style={{ color: "#1E1B4B" }}>
              {isPerJob ? "Apply to this job" : "Express Interest"}
            </DialogTitle>
          </DialogHeader>

          {/* Apply-flow framing: name the specific posting at the
              facility so the seeker confirms what they're applying to
              before they click submit. Facility-level intent keeps the
              softer "let them know you're interested" framing. */}
          {isPerJob ? (
            <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-2 -mt-2 text-sm">
              <p className="flex items-center gap-1.5 text-blue-900">
                <Briefcase className="h-3.5 w-3.5 shrink-0" />
                <span className="font-medium">{jobTitle ?? "this role"}</span>
              </p>
              <p className="flex items-center gap-1.5 text-blue-700 mt-0.5 text-xs">
                <Building2 className="h-3 w-3 shrink-0" />
                {facilityName}
              </p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground -mt-2">
              Let <span className="font-medium text-foreground">{facilityName}</span> know you're interested in working there.
            </p>
          )}

          <div className="space-y-4 pt-1">
            {/* Role picker — only meaningful for facility-level interest;
                per-job submissions already know the role from the posting. */}
            {!isPerJob && (
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
            )}

            <div className="space-y-1.5">
              <Label>
                {isPerJob ? "Cover note" : "Message"}{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                placeholder={isPerJob
                  ? "Tell the hiring team why you're a fit, your availability, or your start date…"
                  : "Briefly introduce yourself or note your availability…"}
                rows={3}
                maxLength={500}
                className="resize-none"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
              />
              <p className="text-xs text-muted-foreground text-right">{message.length}/500</p>
            </div>

            {/* Transparency: what the facility will see from the
                seeker's profile when this submission arrives. Read-only;
                edits go to /jobseeker/dashboard so we don't double up. */}
            <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-xs">
              <p className="flex items-center gap-1.5 portal-eyebrow text-stone-600">
                <Info className="h-3 w-3" />
                What {facilityName} will see
              </p>
              <ProfilePreview profile={profile ?? null} email={me.email} />
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
                {submitMutation.isPending
                  ? (isPerJob ? "Submitting…" : "Sending…")
                  : (isPerJob ? "Submit Application" : "Send Interest")}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── ProfilePreview ──────────────────────────────────────────────────────────
// Surfaces the slice of the seeker's profile the facility will see when
// the application lands. Read-only — the seeker edits in
// /#/jobseeker/dashboard so we don't fork an editor here. If the profile
// hasn't been filled in yet, the preview becomes a soft nudge to
// complete it (non-blocking — submission still goes through).
function ProfilePreview({
  profile,
  email,
}: {
  profile: JobSeekerProfileLite | null;
  email: string;
}) {
  // Credentials preview — only fetched once the dialog has opened
  // (parent gates `profile` on `dialogOpen`), so the dropdown payload
  // is not paid for on the FacilityPanel mount path.
  const { data: credentials } = useCredentials({ enabled: !!profile });
  const credentialList = credentials ?? [];
  if (!profile) {
    return (
      <p className="mt-1.5 text-stone-500">
        Just your email (<span className="font-medium text-stone-700">{email}</span>).{" "}
        <a
          href="#/jobseeker/dashboard"
          className="font-medium text-blue-700 hover:underline"
        >
          Add details to your profile →
        </a>
      </p>
    );
  }
  const fullName = [profile.firstName, profile.lastName].filter(Boolean).join(" ") || null;
  const location = [profile.city, profile.state].filter(Boolean).join(", ") || null;
  const years = profile.yearsExperience != null
    ? `${profile.yearsExperience} yr${profile.yearsExperience === 1 ? "" : "s"} experience`
    : null;
  const items: Array<{ icon: typeof Mail; text: string }> = [
    { icon: Mail, text: email },
    ...(fullName ? [{ icon: Building2, text: fullName }] : []),
    ...(location ? [{ icon: MapPin, text: location }] : []),
    ...(profile.phone ? [{ icon: Building2, text: profile.phone }] : []),
    ...(years ? [{ icon: Briefcase, text: years }] : []),
  ];
  return (
    <>
      <ul className="mt-1.5 space-y-0.5 text-stone-700">
        {items.map((it, i) => (
          <li key={i} className="flex items-center gap-1.5">
            <it.icon className="h-3 w-3 text-stone-400 shrink-0" />
            <span className="truncate">{it.text}</span>
          </li>
        ))}
      </ul>
      {credentialList.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {credentialList.map((c) => (
            <CredentialBadge key={c.id} credential={c} />
          ))}
        </div>
      )}
    </>
  );
}
