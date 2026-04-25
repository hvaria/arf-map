// NEW: expression-of-interest — job seeker's submitted interests list
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Building2, Clock, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { StatusBadge } from "@/components/StatusBadge";

export interface SeekerInterest {
  id: number;
  facilityNumber: string;
  facilityName: string | null;
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
        <p className="text-sm font-medium text-muted-foreground">No interests submitted yet</p>
        <p className="text-xs text-muted-foreground mt-1">
          Browse the map and click "Express Interest" on a facility to get started.
        </p>
        <a href="#/" className="mt-4 inline-block text-xs text-primary hover:underline">
          Browse facilities →
        </a>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {interests.map((interest) => (
        <div key={interest.id} className="rounded-xl p-4" style={{ background: "#F0F4FF", border: "1px solid #E0E7FF" }}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <div className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: "#EEF2FF" }}>
                <Building2 className="h-4 w-4" style={{ color: "#818CF8" }} />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium leading-tight truncate">
                  {interest.facilityName ?? `Facility #${interest.facilityNumber}`}
                </p>
                <p className="text-xs text-muted-foreground">License #{interest.facilityNumber}</p>
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
            <p className="mt-2 text-xs text-yellow-700 dark:text-yellow-400 font-medium">
              The facility is reviewing your profile!
            </p>
          )}

          <div className="mt-3 flex justify-end">
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
      ))}
    </div>
  );
}
