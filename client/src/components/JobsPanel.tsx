import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, MapPin, DollarSign, Clock, ChevronRight, CheckCircle2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { FacilityPin } from "@shared/schema";
import { cn } from "@/lib/utils";
import { getQueryFn } from "@/lib/queryClient";
import { JobDetailModal } from "@/components/JobDetailModal";

interface JobSeekerAuth {
  id: number;
  email: string;
}

interface SeekerInterest {
  id: number;
  jobId: number | null;
  status: string;
}

interface DbJob {
  id: number;
  facilityNumber: string;
  title: string;
  type: string;
  salary: string;
  description: string;
  requirements: string[];
  postedAt: number;
  payMin?: number | null;
  payMax?: number | null;
}

interface DisplayJob {
  id: number;
  key: string;
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

interface JobsPanelProps {
  selectedFacility: FacilityPin | null;
  onSelectFacility: (facility: FacilityPin) => void;
  /**
   * Map of facility number → slim pin, supplied by the parent so JobsPanel
   * reuses MapPage's already-loaded pin data instead of issuing a second
   * (potentially statewide) request just to resolve facility name / city.
   */
  facilityByNumber: Map<string, FacilityPin>;
}

function daysAgo(ts: number) {
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

// Defensive filter: hide jobs whose required fields look like placeholder/seed
// data ("Test", "N/A", short stubs, etc.). Mirrors the server-side Zod refine.
const PLACEHOLDER_REGEX = /^(test|placeholder|n\/a|na|todo|tbd|sample|asdf|x+|\.+|-+)$/i;

function isJunkJob(j: { title: string; description: string; salary: string }): boolean {
  const title = (j.title ?? "").trim();
  const desc = (j.description ?? "").trim();
  const salary = (j.salary ?? "").trim();
  if (!title || !salary) return true;
  if (title.length < 3 || desc.length < 20) return true;
  return [title, desc, salary].some((v) => PLACEHOLDER_REGEX.test(v));
}

// Handoff key written by the /#/jobs/:id redirector page when a seeker
// arrives via a direct / shared link. JobsPanel reads it on mount and
// opens the modal, so the URL becomes a way to *land here with that
// job pre-opened* rather than rendering a separate page.
const PENDING_JOB_MODAL_KEY = "pending_job_modal";

export function JobsPanel({ selectedFacility, onSelectFacility, facilityByNumber }: JobsPanelProps) {
  // Modal state — clicking a card opens the in-context job detail
  // modal instead of navigating away. Direct /#/jobs/:id arrivals are
  // funneled here via PENDING_JOB_MODAL_KEY (set by JobDetailPage's
  // redirector) — see the useEffect below.
  const [modalJobId, setModalJobId] = useState<number | null>(null);

  // Drain the redirector handoff exactly once on mount. Failing
  // silently when sessionStorage is unavailable (private browsing)
  // matches the pendingAction convention.
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem(PENDING_JOB_MODAL_KEY);
      if (pending) {
        const id = Number(pending);
        if (Number.isInteger(id) && id > 0) setModalJobId(id);
        sessionStorage.removeItem(PENDING_JOB_MODAL_KEY);
      }
    } catch {
      // ignore
    }
  }, []);

  // DB jobs from the facility portal — single source of truth now that the
  // pin payload no longer carries embedded jobPostings. Facility metadata
  // (name, city) is looked up by facility number against any pins that
  // happen to be loaded; rows for unloaded pins simply show no facility
  // line until the user pans the map to include them.
  const { data: dbJobs = [], isLoading } = useQuery<DbJob[]>({
    queryKey: ["/api/jobs"],
    staleTime: 60000,
  });

  // "Applied" indicator — only fetched when the viewer is a logged-in
  // job seeker. Anonymous viewers and facility-portal users (different
  // auth session) see no badge: `me` is null for them, so the interests
  // query is disabled and `appliedJobIds` stays empty. This is per-user
  // state and never leaks across sessions.
  const { data: me } = useQuery<JobSeekerAuth | null>({
    queryKey: ["/api/jobseeker/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 60000,
  });
  const { data: myInterests = [] } = useQuery<SeekerInterest[]>({
    queryKey: ["/api/jobseeker/interests"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!me,
    staleTime: 30000,
  });
  const appliedJobIds = useMemo(() => {
    const s = new Set<number>();
    for (const i of myInterests) if (i.jobId != null) s.add(i.jobId);
    return s;
  }, [myInterests]);

  const jobs = useMemo<DisplayJob[]>(() => {
    return dbJobs
      .filter((j) => !isJunkJob(j))
      .map((j) => ({
        id: j.id,
        key: `db-${j.id}`,
        facilityNumber: j.facilityNumber,
        title: j.title,
        type: j.type,
        salary: j.salary,
        description: j.description,
        requirements: j.requirements,
        postedAt: j.postedAt,
        payMin: j.payMin ?? null,
        payMax: j.payMax ?? null,
      }))
      .sort((a, b) => b.postedAt - a.postedAt);
  }, [dbJobs]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-4 py-3 shrink-0 flex items-center gap-2 border-b"
           style={{ borderColor: "var(--portal-border-subtle)" }}>
        <Briefcase className="h-3.5 w-3.5 text-stone-500 shrink-0" />
        <h2 className="text-[13px] font-semibold text-stone-900">Open positions</h2>
        {!isLoading && jobs.length > 0 && (
          <span className="ml-auto text-[11px] text-muted-foreground portal-num bg-stone-50 border border-stone-200 rounded-full px-2 py-0.5">
            {jobs.length}
          </span>
        )}
      </div>

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="p-3 space-y-2">
          {isLoading ? (
            [1, 2, 3, 4].map((i) => (
              <div key={i} className="h-[92px] rounded-md bg-stone-100 animate-pulse" />
            ))
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Briefcase className="h-7 w-7 mb-3 text-stone-300" />
              <p className="text-[13px] font-medium text-stone-700">No jobs posted yet</p>
              <p className="text-[12px] mt-1 text-center px-4 leading-relaxed">
                Check back soon — facilities post new openings here.
              </p>
            </div>
          ) : (
            jobs.map((job) => {
              const facility = facilityByNumber.get(job.facilityNumber) ?? null;
              const isSelected = selectedFacility?.number === job.facilityNumber;
              const isApplied = appliedJobIds.has(job.id);
              return (
                <JobCard
                  key={job.key}
                  job={job}
                  facility={facility}
                  isSelected={isSelected}
                  isApplied={isApplied}
                  onClick={() => {
                    // Keep the existing map-context behavior: clicking a
                    // card still focuses the facility pin on the map so
                    // back-from-modal feels grounded. Then open the
                    // detail modal in place — no navigation away.
                    if (facility) onSelectFacility(facility);
                    setModalJobId(job.id);
                  }}
                />
              );
            })
          )}
        </div>
      </div>

      {/* Footer */}
      {!isLoading && jobs.length > 0 && (
        <>
          <Separator />
          <p className="text-[11px] text-muted-foreground text-center py-2 px-3 leading-relaxed shrink-0">
            Tap a job to see where it is.
          </p>
        </>
      )}

      {/* In-context job detail modal — opens on card click instead of
          navigating to /#/jobs/:id. The route still works for shared
          / deep-linked URLs. */}
      <JobDetailModal
        jobId={modalJobId}
        open={modalJobId != null}
        onOpenChange={(open) => {
          if (!open) setModalJobId(null);
        }}
      />
    </div>
  );
}

function JobCard({
  job,
  facility,
  isSelected,
  isApplied,
  onClick,
}: {
  job: DisplayJob;
  facility: FacilityPin | null;
  isSelected: boolean;
  isApplied: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-md border transition-colors p-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        isSelected
          ? "border-[var(--portal-accent)] bg-[var(--portal-accent-soft)]"
          : isApplied
            ? "border-emerald-200 bg-emerald-50/40 hover:bg-emerald-50"
            : "bg-white hover:bg-stone-50",
      )}
      style={{
        borderColor: isSelected
          ? "var(--portal-accent)"
          : isApplied
            ? undefined // let the className handle it for the emerald tint
            : "var(--portal-border-subtle)",
      }}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold leading-tight truncate text-stone-900">{job.title}</p>
          {facility && (
            <p className="text-[12px] text-muted-foreground flex items-center gap-1 mt-1 truncate">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{facility.name}</span>
            </p>
          )}
          {facility && (
            <p className="text-[11px] text-muted-foreground mt-0.5 pl-4 truncate">{facility.city}</p>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          {/* Applied pill (operator emerald tone, ok=applied). Only
              renders for logged-in job seekers who have submitted an
              application for THIS specific job. */}
          {isApplied && (
            <span className="inline-flex items-center gap-0.5 text-[10px] font-medium px-1.5 py-0 rounded-full border bg-emerald-100 text-emerald-700 border-emerald-200">
              <CheckCircle2 className="h-2.5 w-2.5" />
              Applied
            </span>
          )}
          <Badge
            variant="outline"
            className="text-[10px] px-1.5 py-0 bg-stone-50 text-stone-600 border-stone-200"
          >
            {job.type}
          </Badge>
          <ChevronRight className="h-3.5 w-3.5 text-stone-300 group-hover:text-stone-500 transition-colors" />
        </div>
      </div>

      <div className="flex items-center gap-3 mt-2.5 text-[12px]">
        <span className="flex items-center gap-0.5 text-stone-900 font-medium portal-num">
          <DollarSign className="h-3 w-3 text-stone-400" />
          {formatPayRange(job.payMin, job.payMax, job.salary)}
        </span>
        <span className="flex items-center gap-0.5 text-muted-foreground portal-num">
          <Clock className="h-3 w-3" />
          {daysAgo(job.postedAt)}
        </span>
      </div>

      {job.description && (
        <p className="text-[12px] text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
          {job.description}
        </p>
      )}
    </button>
  );
}
