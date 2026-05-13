import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { Briefcase, Building2, ChevronRight, Clock, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { StatusBadge } from "@/components/StatusBadge";

export interface SeekerInterest {
  id: number;
  facilityNumber: string;
  facilityName: string | null;
  jobId: number | null;
  jobTitle: string | null;
  roleInterest: string | null;
  message: string | null;
  status: string;
  createdAt: number;
}

function timeAgo(ts: number): string {
  const days = Math.floor((Date.now() - ts) / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export function MyInterestsTab() {
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: interests, isLoading, isError } = useQuery<SeekerInterest[]>({
    queryKey: ["/api/jobseeker/interests"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 30000,
  });

  const withdrawMutation = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/jobseeker/interests/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobseeker/interests"] });
      toast({ title: "Interest withdrawn" });
    },
    onError: (err: Error) => {
      toast({ title: "Failed to withdraw", description: err.message, variant: "destructive" });
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((i) => (
          <div key={i} className="h-20 rounded-xl border animate-pulse bg-muted/30" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive text-center">
        Failed to load. Please refresh.
      </div>
    );
  }

  if (!interests || interests.length === 0) {
    return (
      <div className="rounded-xl border border-dashed p-10 text-center">
        <Send className="h-8 w-8 mx-auto text-muted-foreground mb-3 opacity-40" />
        <p className="text-sm font-medium text-muted-foreground">No applications yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Browse the map, open a job, and click "Apply to this job" to get started.
        </p>
        <a href="#/map" className="mt-4 inline-block text-xs text-primary hover:underline">
          Browse jobs →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {interests.map((interest) => {
        // Per-job interests (jobId set) lead with the job title and link to
        // the public job detail page so the seeker can return to the
        // posting they applied to. Facility-level interests (jobId null,
        // legacy + the FacilityPanel "I'm interested in this place" CTA)
        // keep the facility-name-first treatment.
        const isPerJob = interest.jobId != null;
        const primary = isPerJob
          ? interest.jobTitle ?? `Job #${interest.jobId}`
          : interest.facilityName ?? `Facility #${interest.facilityNumber}`;
        const secondary = isPerJob
          ? interest.facilityName ?? `Facility #${interest.facilityNumber}`
          : `License #${interest.facilityNumber}`;
        const Icon = isPerJob ? Briefcase : Building2;
        return (
          <div key={interest.id} className="rounded-xl p-4" style={{ background: "#F0F4FF", border: "1px solid #E0E7FF" }}>
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#EEF2FF" }}>
                  <Icon className="h-4 w-4" style={{ color: "#818CF8" }} />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium leading-tight truncate">{primary}</p>
                  <p className="text-xs text-muted-foreground truncate">{secondary}</p>
                </div>
              </div>
              <StatusBadge status={interest.status} className="shrink-0" />
            </div>

            <div className="flex flex-wrap gap-3 mt-2 text-xs text-muted-foreground">
              {interest.roleInterest && (
                <Badge variant="secondary" className="text-xs font-normal">
                  {interest.roleInterest}
                </Badge>
              )}
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />{timeAgo(interest.createdAt)}
              </span>
            </div>

            {interest.status === "shortlisted" && (
              <p className="mt-2 text-xs font-medium" style={{ color: "#92400E" }}>
                The facility is reviewing your profile!
              </p>
            )}

            <div className="mt-3 flex items-center justify-between gap-2">
              {isPerJob ? (
                <Link
                  href={`/jobs/${interest.jobId}`}
                  className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
                  style={{ color: "#4F46E5" }}
                >
                  View job <ChevronRight className="h-3 w-3" />
                </Link>
              ) : (
                <Link
                  href="/map"
                  className="inline-flex items-center gap-1 text-xs font-medium hover:underline"
                  style={{ color: "#4F46E5" }}
                >
                  View facility on map <ChevronRight className="h-3 w-3" />
                </Link>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground hover:text-destructive"
                onClick={() => withdrawMutation.mutate(interest.id)}
                disabled={withdrawMutation.isPending}
              >
                <Trash2 className="h-3 w-3 mr-1" />
                Withdraw
              </Button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
