import { useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Map, MapPin, DollarSign, Clock, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useFacilities } from "@/hooks/useFacilities";
import type { Facility } from "@shared/schema";

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

function daysAgo(ts: number) {
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

interface NearbySheetProps {
  onSelectFacility: (facility: Facility) => void;
  /** Hide the sheet while a facility detail panel is open */
  hidden: boolean;
}

export function NearbySheet({ onSelectFacility, hidden }: NearbySheetProps) {
  const [expanded, setExpanded] = useState(false);
  const dragStartY = useRef<number | null>(null);

  const { facilities, facilityByNumber } = useFacilities();

  const { data: dbJobs = [], isLoading } = useQuery<DbJob[]>({
    queryKey: ["/api/jobs"],
    staleTime: 60000,
  });

  const jobs = useMemo<DisplayJob[]>(() => {
    const dbFacilityNumbers = new Set(dbJobs.map((j) => j.facilityNumber));

    const embeddedJobs: DisplayJob[] = facilities
      .filter((f) => f.isHiring && f.jobPostings.length > 0 && !dbFacilityNumbers.has(f.number))
      .flatMap((f) =>
        f.jobPostings.map((jp, i) => ({
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

    return [
      ...mapped.sort((a, b) => b.postedAt - a.postedAt),
      ...embeddedJobs.sort((a, b) => b.postedAt - a.postedAt),
    ];
  }, [dbJobs, facilities]);

  if (hidden) return null;

  const onDown = (clientY: number) => {
    dragStartY.current = clientY;
  };
  const onUp = (clientY: number) => {
    if (dragStartY.current === null) return;
    const delta = dragStartY.current - clientY;
    if (delta > 15) setExpanded(true);
    else if (delta < -15) setExpanded(false);
    else setExpanded((v) => !v);
    dragStartY.current = null;
  };

  return (
    <div
      className="md:hidden fixed bottom-0 left-0 right-0 z-30 bg-background rounded-t-2xl border-t shadow-[0_-4px_24px_rgba(0,0,0,0.12)] flex flex-col overflow-hidden"
      style={{
        height: expanded ? "70vh" : "72px",
        transition: "height 300ms ease-out",
      }}
    >
      {/* ── Handle / collapsed header ── */}
      <div
        className="shrink-0 flex flex-col items-center pt-2.5 pb-2 cursor-pointer select-none touch-none"
        onMouseDown={(e) => onDown(e.clientY)}
        onMouseUp={(e) => onUp(e.clientY)}
        onTouchStart={(e) => onDown(e.touches[0].clientY)}
        onTouchEnd={(e) => onUp(e.changedTouches[0].clientY)}
      >
        <div className="w-10 h-1.5 rounded-full bg-muted-foreground/25" />
        <div className="flex items-center gap-1.5 mt-1.5">
          <Briefcase className="h-3 w-3 text-primary" />
          <p className="text-xs font-medium text-muted-foreground">
            {isLoading ? "Loading…" : `${jobs.length} open position${jobs.length !== 1 ? "s" : ""}`}
          </p>
        </div>
      </div>

      {/* ── Expanded: job list ── */}
      {expanded && (
        <>
          <Separator />
          <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
            <div className="p-3 pb-20 space-y-2">
              {isLoading ? (
                [1, 2, 3].map((i) => (
                  <div key={i} className="h-[88px] rounded-xl bg-muted animate-pulse" />
                ))
              ) : jobs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <Briefcase className="h-8 w-8 mb-3 opacity-25" />
                  <p className="text-sm font-medium">No open positions</p>
                  <p className="text-xs mt-1 text-center px-4 leading-relaxed">
                    Facilities post openings here when they're hiring
                  </p>
                </div>
              ) : (
                jobs.map((job) => {
                  const facility = facilityByNumber.get(job.facilityNumber) ?? null;
                  return (
                    <JobCard
                      key={job.key}
                      job={job}
                      facility={facility}
                      onClick={() => {
                        if (facility) {
                          onSelectFacility(facility);
                          setExpanded(false);
                        }
                      }}
                    />
                  );
                })
              )}
            </div>
          </div>
        </>
      )}

      {/* ── "View Map" pill — only when expanded ── */}
      {expanded && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 pointer-events-none z-10">
          <button
            className="pointer-events-auto flex items-center gap-2 px-4 py-2 bg-foreground text-background rounded-full shadow-lg text-sm font-medium whitespace-nowrap"
            onClick={() => setExpanded(false)}
          >
            <Map className="h-3.5 w-3.5" />
            View Map
          </button>
        </div>
      )}
    </div>
  );
}

function JobCard({
  job,
  facility,
  onClick,
}: {
  job: DisplayJob;
  facility: Facility | null;
  onClick: () => void;
}) {
  return (
    <button
      className="w-full text-left rounded-xl border bg-card hover:bg-accent p-3 transition-colors group"
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
