import { useQuery } from "@tanstack/react-query";
import {
  Briefcase,
  Building2,
  Clock,
  DollarSign,
  MapPin,
} from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { ExpressInterestButton } from "@/components/ExpressInterestButton";

// Modal variant of the job detail surface used from JobsPanel cards on
// the map. The /#/jobs/:id route still exists for shared / deep-linked
// URLs (JobDetailPage), but in-flow browsing no longer navigates away
// from the map — we open this dialog instead. Visual language follows
// the Operations tab canonical patterns: text-xl + #1E1B4B heading,
// KPI tiles (rounded-lg p-3 + tone-50 / tone-200), portal-eyebrow sub-
// headings, primary CTA via portal-btn-primary inside ExpressInterestButton.

interface JobDetail {
  id: number;
  facilityNumber: string;
  title: string;
  type: string;
  salary: string;
  description: string;
  requirements: string[];
  postedAt: number;
  payMin: number | null;
  payMax: number | null;
}

interface FacilityPublic {
  facility: {
    number: string;
    name: string;
    city: string;
    address: string;
    zip: string;
    facilityType: string;
  } | null;
}

interface Props {
  jobId: number | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function formatMoney(n: number): string {
  return n % 1 === 0 ? String(n) : n.toFixed(2);
}

function formatPayRange(payMin: number | null, payMax: number | null, fallback: string): string {
  if (payMin == null && payMax == null) return fallback;
  if (payMin != null && payMax != null && payMin !== payMax) {
    return `$${formatMoney(payMin)}–$${formatMoney(payMax)}/hr`;
  }
  const single = payMin ?? payMax!;
  return `$${formatMoney(single)}/hr`;
}

function daysAgo(ts: number): string {
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

export function JobDetailModal({ jobId, open, onOpenChange }: Props) {
  const validId = jobId != null && Number.isInteger(jobId) && jobId > 0;

  const { data: job, isLoading, isError } = useQuery<JobDetail | null>({
    queryKey: [`/api/jobs/${jobId}`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: open && validId,
    staleTime: 60000,
  });

  const { data: facilityData } = useQuery<FacilityPublic | null>({
    queryKey: [`/api/facilities/${job?.facilityNumber}/public`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: open && !!job?.facilityNumber,
    staleTime: 60000,
  });

  const facility = facilityData?.facility ?? null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto">
        {isLoading ? (
          <div className="space-y-4">
            <Skeleton className="h-7 w-2/3 rounded-md" />
            <Skeleton className="h-4 w-1/2 rounded-md" />
            <div className="grid grid-cols-3 gap-3">
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
              <Skeleton className="h-16 rounded-lg" />
            </div>
            <Skeleton className="h-24 w-full rounded-lg" />
            <Skeleton className="h-9 w-full rounded-md" />
          </div>
        ) : isError || !job ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <Briefcase className="h-8 w-8 mx-auto text-muted-foreground mb-2 opacity-40" />
            <p className="text-sm font-semibold" style={{ color: "#1E1B4B" }}>
              This job is no longer available
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              It may have been filled or removed by the facility.
            </p>
          </div>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="text-xl font-semibold" style={{ color: "#1E1B4B" }}>
                {job.title}
              </DialogTitle>
              {facility && (
                <DialogDescription className="flex flex-wrap items-center gap-1.5 text-sm">
                  <Building2 className="h-4 w-4 text-stone-400" />
                  <span className="font-medium text-foreground">{facility.name}</span>
                  {facility.city && (
                    <>
                      <span className="text-stone-300">•</span>
                      <MapPin className="h-3.5 w-3.5 text-stone-400" />
                      <span>
                        {facility.city}
                        {facility.zip ? `, ${facility.zip}` : ""}
                      </span>
                    </>
                  )}
                </DialogDescription>
              )}
            </DialogHeader>

            {/* KPI strip — operator tile pattern: rounded-lg p-3 + tone bgs.
                Pay tile uses emerald (positive value tone in the operator
                palette); Role uses the neutral indigo info tile; Posted
                uses stone for muted info. */}
            <div className="grid grid-cols-3 gap-3">
              <div
                className="rounded-lg p-3 text-center"
                style={{ background: "#F0F4FF", border: "1px solid #E0E7FF" }}
              >
                <p className="portal-eyebrow flex items-center justify-center gap-1">
                  <Briefcase className="h-3 w-3" />
                  Position
                </p>
                <p className="text-sm font-semibold mt-1" style={{ color: "#1E1B4B" }}>
                  {job.type}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
                <p className="portal-eyebrow text-emerald-700 flex items-center justify-center gap-1">
                  <DollarSign className="h-3 w-3" />
                  Pay
                </p>
                <p className="text-sm font-semibold text-emerald-700 mt-1 portal-num">
                  {formatPayRange(job.payMin, job.payMax, job.salary)}
                </p>
              </div>
              <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-center">
                <p className="portal-eyebrow flex items-center justify-center gap-1">
                  <Clock className="h-3 w-3" />
                  Posted
                </p>
                <p className="text-sm font-semibold mt-1 text-stone-700">
                  {daysAgo(job.postedAt)}
                </p>
              </div>
            </div>

            {job.description && (
              <section className="rounded-lg border border-stone-200 bg-white p-4 space-y-2">
                <h2 className="portal-eyebrow">About this role</h2>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                  {job.description}
                </p>
              </section>
            )}

            {job.requirements.length > 0 && (
              <section className="rounded-lg border border-stone-200 bg-white p-4 space-y-2">
                <h2 className="portal-eyebrow">Requirements</h2>
                <ul className="space-y-1.5">
                  {job.requirements.map((r, i) => (
                    <li key={i} className="text-sm text-foreground flex items-start gap-2">
                      <span className="mt-1.5 h-1.5 w-1.5 rounded-full bg-emerald-500 shrink-0" />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {facility && (
              <div className="pt-1">
                <ExpressInterestButton
                  facilityNumber={job.facilityNumber}
                  facilityName={facility.name}
                  jobId={job.id}
                  jobTitle={job.title}
                  ctaLabel="Apply to this job"
                />
                <p className="text-[11px] mt-2 text-center text-muted-foreground">
                  Your application goes to {facility.name}'s hiring team.
                </p>
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
