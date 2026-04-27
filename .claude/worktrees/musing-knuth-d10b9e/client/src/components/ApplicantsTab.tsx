// NEW: expression-of-interest — facility-side applicant dashboard tab
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Users, MapPin, Briefcase, Clock, Mail, MessageSquare } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { StatusBadge } from "@/components/StatusBadge";

interface Applicant {
  id: number;
  jobSeekerId: number;
  facilityNumber: string;
  roleInterest: string | null;
  message: string | null;
  status: string;
  createdAt: number;
  email: string;
  firstName: string | null;
  lastName: string | null;
  city: string | null;
  state: string | null;
  yearsExperience: number | null;
  jobTypes: string[];
  bio: string | null;
}

function timeAgo(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

function ApplicantCard({ applicant }: { applicant: Applicant }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const statusMutation = useMutation({
    mutationFn: (status: string) =>
      apiRequest("PATCH", `/api/facility/applicants/${applicant.id}`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/facility/applicants"] });
    },
    onError: (err: Error) => {
      toast({ title: "Update failed", description: err.message, variant: "destructive" });
    },
  });

  const displayName = applicant.firstName
    ? `${applicant.firstName} ${applicant.lastName ?? ""}`.trim()
    : applicant.email.split("@")[0];

  const location = [applicant.city, applicant.state].filter(Boolean).join(", ");

  return (
    <div className="rounded-lg border p-4 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 text-sm font-semibold text-primary">
            {(applicant.firstName?.[0] ?? applicant.email[0]).toUpperCase()}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium leading-tight truncate">{displayName}</p>
            <a
              href={`mailto:${applicant.email}`}
              className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
            >
              <Mail className="h-3 w-3" />
              {applicant.email}
            </a>
          </div>
        </div>
        <StatusBadge status={applicant.status} className="shrink-0" />
      </div>

      {/* Meta row */}
      <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
        {location && (
          <span className="flex items-center gap-1">
            <MapPin className="h-3 w-3" />{location}
          </span>
        )}
        {applicant.yearsExperience != null && (
          <span className="flex items-center gap-1">
            <Briefcase className="h-3 w-3" />
            {applicant.yearsExperience} yr{applicant.yearsExperience !== 1 ? "s" : ""} exp
          </span>
        )}
        <span className="flex items-center gap-1">
          <Clock className="h-3 w-3" />{timeAgo(applicant.createdAt)}
        </span>
      </div>

      {/* Role interest */}
      {applicant.roleInterest && (
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Interested in:</span>
          <Badge variant="secondary" className="text-xs">{applicant.roleInterest}</Badge>
        </div>
      )}

      {/* Job types */}
      {applicant.jobTypes.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {applicant.jobTypes.slice(0, 4).map((t) => (
            <span key={t} className="text-[10px] bg-muted rounded-full px-2 py-0.5 text-muted-foreground">
              {t}
            </span>
          ))}
          {applicant.jobTypes.length > 4 && (
            <span className="text-[10px] bg-muted rounded-full px-2 py-0.5 text-muted-foreground">
              +{applicant.jobTypes.length - 4} more
            </span>
          )}
        </div>
      )}

      {/* Message */}
      {applicant.message && (
        <div className="rounded-md bg-muted/50 px-3 py-2 text-xs text-foreground leading-relaxed flex gap-2">
          <MessageSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <span className="italic">"{applicant.message}"</span>
        </div>
      )}

      {/* Status control */}
      <div className="flex items-center justify-between pt-1 border-t">
        <span className="text-xs text-muted-foreground">Update status:</span>
        <Select
          value={applicant.status}
          onValueChange={(v) => statusMutation.mutate(v)}
          disabled={statusMutation.isPending}
        >
          <SelectTrigger className="h-7 w-36 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="viewed">Viewed</SelectItem>
            <SelectItem value="shortlisted">Shortlisted</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

export function ApplicantsTab() {
  const { data: applicants, isLoading, isError } = useQuery<Applicant[]>({
    queryKey: ["/api/facility/applicants"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 30000,
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-32 rounded-lg border animate-pulse bg-muted/30" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive text-center">
        Failed to load applicants. Please refresh the page.
      </div>
    );
  }

  if (!applicants || applicants.length === 0) {
    return (
      <div className="rounded-lg border border-dashed p-8 text-center">
        <Users className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
        <p className="text-sm font-medium text-muted-foreground">No applicants yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Job seekers who express interest in your facility will appear here.
        </p>
      </div>
    );
  }

  const pending = applicants.filter((a) => a.status === "pending").length;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {applicants.length} applicant{applicants.length !== 1 ? "s" : ""}
          {pending > 0 && (
            <span className="ml-2 inline-flex items-center rounded-full bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 px-2 py-0.5 text-xs font-medium">
              {pending} new
            </span>
          )}
        </p>
      </div>
      <div className="space-y-3">
        {applicants.map((a) => (
          <ApplicantCard key={a.id} applicant={a} />
        ))}
      </div>
    </div>
  );
}
