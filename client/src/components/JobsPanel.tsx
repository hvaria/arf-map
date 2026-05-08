import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, MapPin, DollarSign, Clock, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Facility } from "@shared/schema";
import { useFacilities } from "@/hooks/useFacilities";
import { cn } from "@/lib/utils";

interface DbJob {
  id: number;
  facilityNumber: string;
  title: string;
  type: string;
  salary: string;
  description: string;
  requirements: string[];
  postedAt: number;
}

interface DisplayJob {
  key: string;
  facilityNumber: string;
  title: string;
  type: string;
  salary: string;
  description: string;
  requirements: string[];
  postedAt: number;
}

interface JobsPanelProps {
  selectedFacility: Facility | null;
  onSelectFacility: (facility: Facility) => void;
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

export function JobsPanel({ selectedFacility, onSelectFacility }: JobsPanelProps) {
  const { facilities, facilityByNumber } = useFacilities();

  // DB jobs from the facility portal
  const { data: dbJobs = [], isLoading } = useQuery<DbJob[]>({
    queryKey: ["/api/jobs"],
    staleTime: 60000,
  });

  // Merge DB jobs + facility-embedded jobs (deduplicated by facility)
  const jobs = useMemo<DisplayJob[]>(() => {
    const dbFacilityNumbers = new Set(dbJobs.map((j) => j.facilityNumber));

    // Jobs embedded in facilities that have no DB portal account
    const embeddedJobs: DisplayJob[] = facilities
      .filter((f) => f.isHiring && f.jobPostings.length > 0 && !dbFacilityNumbers.has(f.number))
      .flatMap((f) =>
        f.jobPostings
          .filter((jp) => !isJunkJob(jp))
          .map((jp, i) => ({
            key: `emb-${f.number}-${i}`,
            facilityNumber: f.number,
            title: jp.title,
            type: jp.type,
            salary: jp.salary,
            description: jp.description,
            requirements: jp.requirements,
            postedAt: Date.now() - jp.postedDaysAgo * 86_400_000,
          }))
      );

    const mapped: DisplayJob[] = dbJobs
      .filter((j) => !isJunkJob(j))
      .map((j) => ({
        key: `db-${j.id}`,
        facilityNumber: j.facilityNumber,
        title: j.title,
        type: j.type,
        salary: j.salary,
        description: j.description,
        requirements: j.requirements,
        postedAt: j.postedAt,
      }));

    return [
      ...mapped.sort((a, b) => b.postedAt - a.postedAt),
      ...embeddedJobs.sort((a, b) => b.postedAt - a.postedAt),
    ];
  }, [dbJobs, facilities]);

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
              <p className="text-[13px] font-medium text-stone-700">No open positions</p>
              <p className="text-[12px] mt-1 text-center px-4 leading-relaxed">
                Facilities post openings here when they&apos;re hiring.
              </p>
            </div>
          ) : (
            jobs.map((job) => {
              const facility = facilityByNumber.get(job.facilityNumber) ?? null;
              const isSelected = selectedFacility?.number === job.facilityNumber;
              return (
                <JobCard
                  key={job.key}
                  job={job}
                  facility={facility}
                  isSelected={isSelected}
                  onClick={() => facility && onSelectFacility(facility)}
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
            Tap any posting to see the facility on the map.
          </p>
        </>
      )}
    </div>
  );
}

function JobCard({
  job,
  facility,
  isSelected,
  onClick,
}: {
  job: DisplayJob;
  facility: Facility | null;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "w-full text-left rounded-md border transition-colors p-3 group focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
        isSelected
          ? "border-[var(--portal-accent)] bg-[var(--portal-accent-soft)]"
          : "bg-white hover:bg-stone-50",
      )}
      style={{
        borderColor: isSelected ? "var(--portal-accent)" : "var(--portal-border-subtle)",
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
          {job.salary}
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
