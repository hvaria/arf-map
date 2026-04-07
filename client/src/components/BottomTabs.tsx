import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Briefcase, Building2, MapPin, DollarSign, Clock, ChevronUp, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Facility } from "@shared/schema";
import { useFacilities } from "@/hooks/useFacilities";

interface PublicJob {
  id: number;
  facilityNumber: string;
  title: string;
  type: string;
  salary: string;
  description: string;
  requirements: string[];
  postedAt: number;
}

interface BottomTabsProps {
  filteredFacilities: Facility[];
  onSelectFacility: (facility: Facility) => void;
}

function daysAgo(ts: number) {
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "1d ago";
  return `${days}d ago`;
}

export function BottomTabs({ filteredFacilities, onSelectFacility }: BottomTabsProps) {
  const [activeTab, setActiveTab] = useState<"jobs" | "facilities">("jobs");
  const [expanded, setExpanded] = useState(false);
  const { facilityByNumber } = useFacilities();

  const { data: jobs = [], isLoading } = useQuery<PublicJob[]>({
    queryKey: ["/api/jobs"],
    staleTime: 60000,
  });

  const panelHeight = expanded ? "h-[60vh]" : "h-[260px]";

  return (
    <div
      className={cn(
        "fixed bottom-0 left-0 right-0 z-20 bg-background/95 backdrop-blur-sm border-t shadow-2xl rounded-t-2xl transition-all duration-300",
        panelHeight
      )}
    >
      {/* Handle */}
      <div
        className="flex justify-center pt-2.5 pb-1 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
      </div>

      {/* Tab bar */}
      <div className="flex items-center px-4 gap-1 pb-2">
        <button
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
            activeTab === "jobs"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
          onClick={() => setActiveTab("jobs")}
        >
          <Briefcase className="h-3.5 w-3.5" />
          Jobs
          {jobs.length > 0 && (
            <span className={cn("text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center",
              activeTab === "jobs" ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
            )}>
              {jobs.length}
            </span>
          )}
        </button>
        <button
          className={cn(
            "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-colors",
            activeTab === "facilities"
              ? "bg-primary text-primary-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          )}
          onClick={() => setActiveTab("facilities")}
        >
          <Building2 className="h-3.5 w-3.5" />
          Facilities
          <span className={cn("text-xs rounded-full px-1.5 py-0.5 min-w-[20px] text-center",
            activeTab === "facilities" ? "bg-primary-foreground/20 text-primary-foreground" : "bg-muted text-muted-foreground"
          )}>
            {filteredFacilities.length}
          </span>
        </button>
        <button
          className="ml-auto text-muted-foreground hover:text-foreground p-1"
          onClick={() => setExpanded((e) => !e)}
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
      </div>

      {/* Content */}
      <div className="overflow-y-auto" style={{ height: "calc(100% - 80px)" }}>
        {activeTab === "jobs" ? (
          <div className="px-4 pb-4 space-y-2">
            {isLoading ? (
              <div className="space-y-2 pt-2">
                {[1, 2, 3].map((i) => <div key={i} className="h-16 rounded-lg bg-muted animate-pulse" />)}
              </div>
            ) : jobs.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Briefcase className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No open positions yet</p>
              </div>
            ) : (
              jobs.map((job) => {
                const facility = facilityByNumber.get(job.facilityNumber);
                return (
                  <button
                    key={job.id}
                    className="w-full text-left rounded-xl border bg-card hover:bg-accent transition-colors p-3"
                    onClick={() => facility && onSelectFacility(facility)}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-semibold truncate">{job.title}</p>
                        {facility && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                            <MapPin className="h-3 w-3 shrink-0" />
                            {facility.name} · {facility.city}
                          </p>
                        )}
                      </div>
                      <div className="shrink-0 flex flex-col items-end gap-1">
                        <Badge variant="secondary" className="text-xs">
                          {job.type}
                        </Badge>
                        <span className="text-xs text-muted-foreground flex items-center gap-0.5">
                          <Clock className="h-3 w-3" />
                          {daysAgo(job.postedAt)}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mt-1.5 text-xs text-green-600 dark:text-green-400">
                      <DollarSign className="h-3 w-3" />
                      {job.salary}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        ) : (
          <div className="px-4 pb-4 space-y-1.5">
            {filteredFacilities.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Building2 className="h-8 w-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No facilities match filters</p>
              </div>
            ) : (
              filteredFacilities.map((facility) => (
                <button
                  key={facility.number}
                  className="w-full text-left rounded-xl border bg-card hover:bg-accent transition-colors p-3"
                  onClick={() => onSelectFacility(facility)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold truncate">{facility.name}</p>
                      <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5 truncate">
                        <MapPin className="h-3 w-3 shrink-0" />
                        {facility.city} · {facility.capacity} beds
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <StatusBadge status={facility.status} />
                      {facility.isHiring && (
                        <Badge className="text-[10px] px-1.5 py-0 bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800" variant="outline">
                          Hiring
                        </Badge>
                      )}
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, string> = {
    LICENSED: "bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800",
    CLOSED: "bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800",
    PENDING: "bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800",
    "ON PROBATION": "bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800",
  };
  return (
    <Badge variant="outline" className={cn("text-[10px] px-1.5 py-0", config[status] ?? config.LICENSED)}>
      {status}
    </Badge>
  );
}
