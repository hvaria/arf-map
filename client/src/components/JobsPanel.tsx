import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, MapPin, DollarSign, Clock, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { Facility } from "@shared/schema";
import facilitiesData from "@/data/facilities.json";

const allFacilities = facilitiesData as Facility[];
const facilityByNumber = new Map(allFacilities.map((f) => [f.number, f]));

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

export function JobsPanel({ selectedFacility, onSelectFacility }: JobsPanelProps) {
  // DB jobs from the facility portal
  const { data: dbJobs = [], isLoading } = useQuery<DbJob[]>({
    queryKey: ["/api/jobs"],
    staleTime: 60000,
  });

  // Merge DB jobs + static JSON jobs (deduplicated by facility)
  const jobs = useMemo<DisplayJob[]>(() => {
    // Facilities that already have DB jobs — don't double-count with static
    const dbFacilityNumbers = new Set(dbJobs.map((j) => j.facilityNumber));

    // Static jobs from hiring facilities that have no DB portal account
    const staticJobs: DisplayJob[] = allFacilities
      .filter((f) => f.isHiring && f.jobPostings.length > 0 && !dbFacilityNumbers.has(f.number))
      .flatMap((f) =>
        f.jobPostings.map((jp, i) => ({
          key: `static-${f.number}-${i}`,
          facilityNumber: f.number,
          title: jp.title,
          type: jp.type,
          salary: jp.salary,
          description: jp.description,
          requirements: jp.requirements,
          postedAt: Date.now() - jp.postedDaysAgo * 86400000,
        }))
      );

    const mapped: DisplayJob[] = dbJobs.map((j) => ({
      key: `db-${j.id}`,
      facilityNumber: j.facilityNumber,
      title: j.title,
      type: j.type,
      salary: j.salary,
      description: j.description,
      requirements: j.requirements,
      postedAt: j.postedAt,
    }));

    // DB jobs first, then static — sorted newest first within each group
    return [
      ...mapped.sort((a, b) => b.postedAt - a.postedAt),
      ...staticJobs.sort((a, b) => b.postedAt - a.postedAt),
    ];
  }, [dbJobs]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Header */}
      <div className="px-4 py-3 shrink-0 flex items-center gap-2">
        <Briefcase className="h-4 w-4 text-primary shrink-0" />
        <h2 className="text-sm font-semibold">Open Positions</h2>
        {!isLoading && (
          <span className="ml-auto text-xs text-muted-foreground tabular-nums">
            {jobs.length}
          </span>
        )}
      </div>

      <Separator />

      {/* Scrollable list */}
      <div className="flex-1 overflow-y-auto overscroll-contain">
        <div className="p-3 space-y-2">
          {isLoading ? (
            [1, 2, 3, 4].map((i) => (
              <div key={i} className="h-[88px] rounded-xl bg-muted animate-pulse" />
            ))
          ) : jobs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <Briefcase className="h-9 w-9 mb-3 opacity-25" />
              <p className="text-sm font-medium">No open positions</p>
              <p className="text-xs mt-1 text-center px-4 leading-relaxed">
                Facilities post openings here when they&apos;re hiring
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
            Click any card to view the facility on the map
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
      className={`w-full text-left rounded-xl border transition-all p-3 group ${
        isSelected
          ? "border-primary/60 bg-primary/5 shadow-sm"
          : "bg-card hover:bg-accent hover:border-primary/30"
      }`}
      onClick={onClick}
    >
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold leading-tight truncate">{job.title}</p>
          {facility && (
            <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
              <MapPin className="h-3 w-3 shrink-0" />
              {facility.name}
            </p>
          )}
          {facility && (
            <p className="text-xs text-muted-foreground mt-0.5 pl-4">{facility.city}</p>
          )}
        </div>
        <div className="shrink-0 flex flex-col items-end gap-1.5">
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {job.type}
          </Badge>
          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 group-hover:text-primary/60 transition-colors" />
        </div>
      </div>

      <div className="flex items-center gap-3 mt-2 text-xs">
        <span className="flex items-center gap-0.5 text-green-600 dark:text-green-400 font-medium">
          <DollarSign className="h-3 w-3" />
          {job.salary}
        </span>
        <span className="flex items-center gap-0.5 text-muted-foreground">
          <Clock className="h-3 w-3" />
          {daysAgo(job.postedAt)}
        </span>
      </div>

      {job.description && (
        <p className="text-xs text-muted-foreground mt-1.5 line-clamp-2 leading-relaxed">
          {job.description}
        </p>
      )}
    </button>
  );
}
