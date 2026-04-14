import { useEffect, useRef, useState, useCallback } from "react";
import {
  X, Phone, MapPin, User, Building2, Calendar, AlertTriangle,
  ExternalLink, Briefcase, Clock, DollarSign, CheckCircle2,
  Globe, Mail, Pencil,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { Facility, JobPosting } from "@shared/schema";
import { cn } from "@/lib/utils";

function haversineDistanceMiles(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const R = 3958.8;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

interface FacilityPanelProps {
  facility: Facility | null;
  open: boolean;
  onClose: () => void;
  userLocation?: { lat: number; lng: number } | null;
}

interface DbJobPosting {
  id: number;
  facilityNumber: string;
  title: string;
  type: string;
  salary: string;
  description: string;
  requirements: string[];
  postedAt: number;
}

interface FacilityOverride {
  phone?: string | null;
  description?: string | null;
  website?: string | null;
  email?: string | null;
}

interface PublicData {
  overrides: FacilityOverride | null;
  jobPostings: DbJobPosting[];
}

interface SessionUser {
  id: number;
  facilityNumber: string;
  username: string;
}

const STATUS_CONFIG: Record<string, { color: string; bgClass: string; textClass: string }> = {
  LICENSED:     { color: "#22c55e", bgClass: "bg-green-100 dark:bg-green-950",  textClass: "text-green-700 dark:text-green-300"  },
  CLOSED:       { color: "#ef4444", bgClass: "bg-red-100 dark:bg-red-950",      textClass: "text-red-700 dark:text-red-300"      },
  PENDING:      { color: "#f59e0b", bgClass: "bg-amber-100 dark:bg-amber-950",  textClass: "text-amber-700 dark:text-amber-300"  },
  "ON PROBATION":{ color: "#a855f7",bgClass: "bg-purple-100 dark:bg-purple-950",textClass: "text-purple-700 dark:text-purple-300"},
};

const MIN_VH = 18;
const MAX_VH = 70;
const DEFAULT_VH = 30;
const CLOSE_THRESHOLD_VH = 14; // drag below this → close

export function FacilityPanel({ facility, open, onClose, userLocation }: FacilityPanelProps) {
  const [panelVh, setPanelVh] = useState(DEFAULT_VH);
  const [dragging, setDragging] = useState(false);
  const dragData = useRef<{ startY: number; startVh: number } | null>(null);

  // Reset height each time a new facility opens
  useEffect(() => {
    if (open) setPanelVh(DEFAULT_VH);
  }, [open, facility?.number]);

  const startDrag = useCallback(
    (startY: number) => {
      dragData.current = { startY, startVh: panelVh };
      setDragging(true);

      const onMove = (e: MouseEvent | TouchEvent) => {
        if (!dragData.current) return;
        const y = "touches" in e ? e.touches[0].clientY : (e as MouseEvent).clientY;
        const deltaVh = ((dragData.current.startY - y) / window.innerHeight) * 100;
        setPanelVh(Math.max(MIN_VH - 4, Math.min(MAX_VH, dragData.current.startVh + deltaVh)));
      };

      const onEnd = (e: MouseEvent | TouchEvent) => {
        if (!dragData.current) return;
        const y =
          "changedTouches" in e
            ? e.changedTouches[0].clientY
            : (e as MouseEvent).clientY;
        const deltaVh = ((dragData.current.startY - y) / window.innerHeight) * 100;
        const finalVh = dragData.current.startVh + deltaVh;

        if (finalVh < CLOSE_THRESHOLD_VH) {
          onClose();
        } else {
          setPanelVh(Math.max(MIN_VH, Math.min(MAX_VH, finalVh)));
        }

        dragData.current = null;
        setDragging(false);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("touchmove", onMove);
        document.removeEventListener("mouseup", onEnd);
        document.removeEventListener("touchend", onEnd);
      };

      document.addEventListener("mousemove", onMove);
      document.addEventListener("touchmove", onMove, { passive: true });
      document.addEventListener("mouseup", onEnd);
      document.addEventListener("touchend", onEnd);
    },
    [panelVh, onClose]
  );

  const { data: publicData } = useQuery<PublicData>({
    queryKey: [`/api/facilities/${facility?.number}/public`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!facility?.number,
    staleTime: 30000,
  });

  const { data: me } = useQuery<SessionUser | null>({
    queryKey: ["/api/facility/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 60000,
  });

  if (!facility) return null;

  const statusConfig = STATUS_CONFIG[facility.status] || STATUS_CONFIG.LICENSED;
  const ccldUrl = `https://www.ccld.dss.ca.gov/carefacilitysearch/FacDetail/${facility.number}`;
  const isOwner = me?.facilityNumber === facility.number;
  const distanceMiles =
    userLocation
      ? haversineDistanceMiles(userLocation.lat, userLocation.lng, facility.lat, facility.lng)
      : null;

  const overrides = publicData?.overrides;
  const displayPhone = overrides?.phone || facility.phone;
  const dbJobs = publicData?.jobPostings ?? [];
  const hasDbAccount = dbJobs.length > 0 || overrides != null;
  const displayJobs: (JobPosting | DbJobPosting)[] = hasDbAccount ? dbJobs : facility.jobPostings;
  const isHiring = hasDbAccount ? dbJobs.length > 0 : facility.isHiring;

  return (
    // No backdrop — map stays fully interactive
    <div
      data-testid="facility-panel"
      style={{ height: `${panelVh}vh` }}
      className={cn(
        "fixed bottom-0 left-0 right-0 md:right-80 z-40",
        "bg-background rounded-t-2xl shadow-[0_-4px_24px_rgba(0,0,0,0.12)] border-t",
        "flex flex-col",
        // Only animate translate, not height (height is dragged)
        dragging ? "" : "transition-transform duration-300 ease-out",
        open ? "translate-y-0" : "translate-y-full"
      )}
    >
      {/* ── Drag handle zone ── */}
      <div
        className="shrink-0 pt-2.5 pb-1 flex flex-col items-center cursor-row-resize select-none touch-none"
        onMouseDown={(e) => { e.preventDefault(); startDrag(e.clientY); }}
        onTouchStart={(e) => startDrag(e.touches[0].clientY)}
      >
        <div className={cn(
          "w-10 h-1.5 rounded-full transition-colors",
          dragging ? "bg-primary/50" : "bg-muted-foreground/25 hover:bg-muted-foreground/45"
        )} />
        <span className="text-[10px] text-muted-foreground/40 mt-0.5 select-none">drag to resize</span>
      </div>

      {/* ── Header ── */}
      <div className="shrink-0 px-4 pb-2">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-semibold leading-tight truncate" data-testid="text-facility-name">
              {facility.name}
            </h2>
            <p className="text-xs text-muted-foreground mt-0.5">License #{facility.number}</p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="shrink-0 -mr-1 -mt-0.5 h-7 w-7"
            data-testid="button-close-panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-1.5">
          <Badge
            className={cn("text-xs font-medium px-2 py-0.5", statusConfig.bgClass, statusConfig.textClass)}
            variant="outline"
          >
            <span className="w-1.5 h-1.5 rounded-full mr-1 inline-block" style={{ backgroundColor: statusConfig.color }} />
            {facility.status}
          </Badge>
          {facility.facilityType && facility.facilityType !== "Adult Residential Facility" && (
            <Badge variant="outline" className="text-xs px-2 py-0.5 text-muted-foreground">
              {facility.facilityType}
            </Badge>
          )}
          {facility.capacity > 0 && (
            <Badge variant="secondary" className="text-xs px-2 py-0.5">
              {facility.capacity} beds
            </Badge>
          )}
          {isHiring && (
            <Badge
              className="text-xs font-medium px-2 py-0.5 bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800"
              variant="outline"
            >
              <Briefcase className="h-3 w-3 mr-1" />
              Hiring · {displayJobs.length}
            </Badge>
          )}
          {distanceMiles !== null && (
            <Badge variant="outline" className="text-xs px-2 py-0.5 text-muted-foreground">
              <MapPin className="h-2.5 w-2.5 mr-1" />
              {distanceMiles.toFixed(1)} mi away
            </Badge>
          )}
        </div>
      </div>

      <Separator />

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
        <div className="p-4 space-y-4">

          <Section title="Location & Contact">
            <InfoRow icon={MapPin} label="Address">
              {facility.address}, {facility.city}, CA {facility.zip}
              {facility.county && (
                <span className="block text-[10px] text-muted-foreground mt-0.5">{facility.county} County</span>
              )}
            </InfoRow>
            {displayPhone && (
              <InfoRow icon={Phone} label="Phone">
                <a href={`tel:${displayPhone}`} className="text-primary hover:underline">{displayPhone}</a>
              </InfoRow>
            )}
            {overrides?.email && (
              <InfoRow icon={Mail} label="Email">
                <a href={`mailto:${overrides.email}`} className="text-primary hover:underline">{overrides.email}</a>
              </InfoRow>
            )}
            {overrides?.website && (
              <InfoRow icon={Globe} label="Website">
                <a href={overrides.website} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline break-all">
                  {overrides.website.replace(/^https?:\/\//, "")}
                </a>
              </InfoRow>
            )}
          </Section>

          {overrides?.description && (
            <Section title="About">
              <p className="text-sm text-foreground leading-relaxed">{overrides.description}</p>
            </Section>
          )}

          <Section title="Licensee & Administration">
            <InfoRow icon={Building2} label="Licensee">{facility.licensee || "—"}</InfoRow>
            <InfoRow icon={User} label="Administrator">{facility.administrator || "—"}</InfoRow>
          </Section>

          <Section title="Key Dates">
            <InfoRow icon={Calendar} label="First Licensed">{facility.firstLicenseDate || "—"}</InfoRow>
            {facility.closedDate && (
              <InfoRow icon={Calendar} label="Closed Date">
                <span className="text-red-600 dark:text-red-400">{facility.closedDate}</span>
              </InfoRow>
            )}
            <InfoRow icon={Calendar} label="Last Inspection">{facility.lastInspectionDate || "—"}</InfoRow>
          </Section>

          <Section title="Visit History">
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Total" value={facility.totalVisits} />
              <StatCard label="Inspections" value={facility.inspectionVisits} />
              <StatCard label="Complaints" value={facility.complaintVisits} alert={facility.complaintVisits > 0} />
            </div>
          </Section>

          <Section title="Type B Deficiencies">
            <div className="grid grid-cols-2 gap-2">
              <StatCard label="Inspection" value={facility.inspectTypeB} alert={facility.inspectTypeB > 0} />
              <StatCard label="Other"      value={facility.otherTypeB}   alert={facility.otherTypeB > 0} />
              <StatCard label="Complaint"  value={facility.complaintTypeB} alert={facility.complaintTypeB > 0} />
              <StatCard label="Total"      value={facility.totalTypeB}   alert={facility.totalTypeB > 0} large />
            </div>
            {facility.citations && (
              <div className="mt-2 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800">
                <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-300 mb-1">
                  <AlertTriangle className="h-3.5 w-3.5" />Citations
                </div>
                <p className="text-xs text-amber-900 dark:text-amber-200 break-all leading-relaxed">{facility.citations}</p>
              </div>
            )}
          </Section>

          {isHiring && displayJobs.length > 0 && (
            <Section title="Job Openings">
              <div className="space-y-2">
                {displayJobs.map((job, idx) => {
                  const isDbJob = "postedAt" in job;
                  const jobPosting = isDbJob
                    ? { ...job, postedDaysAgo: Math.floor((Date.now() - (job as DbJobPosting).postedAt) / 86400000) }
                    : job as JobPosting;
                  return <JobCard key={isDbJob ? (job as DbJobPosting).id : idx} job={jobPosting as JobPosting} />;
                })}
              </div>
              <p className="text-xs text-muted-foreground mt-2 italic">Contact the facility directly to inquire.</p>
            </Section>
          )}

          {isOwner && (
            <a
              href="/#/facility-portal"
              className="flex items-center justify-center gap-2 w-full p-3 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/50 text-sm font-medium text-blue-700 dark:text-blue-300 hover:bg-blue-100 transition-colors"
            >
              <Pencil className="h-4 w-4" />Manage This Listing
            </a>
          )}

          <a
            href={ccldUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full p-3 rounded-lg border text-sm font-medium text-primary hover:bg-accent transition-colors"
            data-testid="link-ccld"
          >
            <ExternalLink className="h-4 w-4" />View on CCLD Website
          </a>

          <p className="text-xs text-muted-foreground text-center leading-relaxed pb-2">
            Data from CA Community Care Licensing Division · March 2026
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h3 className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-2">{title}</h3>
      <div className="space-y-1.5">{children}</div>
    </div>
  );
}

function InfoRow({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2">
      <Icon className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
      <div className="min-w-0">
        <span className="text-[10px] text-muted-foreground">{label}</span>
        <p className="text-xs text-foreground leading-snug">{children}</p>
      </div>
    </div>
  );
}

function StatCard({ label, value, alert, large }: { label: string; value: number; alert?: boolean; large?: boolean }) {
  return (
    <div className={cn("rounded-lg border p-2 text-center", alert ? "border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950/30" : "bg-muted/30")}>
      <div className={cn("font-semibold", large ? "text-lg" : "text-base", alert ? "text-red-600 dark:text-red-400" : "text-foreground")}>
        {value}
      </div>
      <div className="text-[10px] text-muted-foreground mt-0.5">{label}</div>
    </div>
  );
}

function JobCard({ job }: { job: JobPosting }) {
  const daysLabel = job.postedDaysAgo === 0 ? "Today" : job.postedDaysAgo === 1 ? "1 day ago" : `${job.postedDaysAgo} days ago`;
  return (
    <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/30 p-2.5">
      <div className="flex items-start justify-between gap-2 mb-1">
        <div>
          <h4 className="text-xs font-semibold">{job.title}</h4>
          <span className="text-[10px] text-blue-600 dark:text-blue-400 font-medium">{job.type}</span>
        </div>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
          <DollarSign className="h-2.5 w-2.5 mr-0.5" />{job.salary}
        </Badge>
      </div>
      <p className="text-[10px] text-muted-foreground leading-relaxed mb-1.5">{job.description}</p>
      <div className="flex flex-wrap gap-1 mb-1">
        {job.requirements.map((req, i) => (
          <span key={i} className="inline-flex items-center gap-0.5 text-[9px] bg-background/80 border rounded-full px-1.5 py-0.5 text-muted-foreground">
            <CheckCircle2 className="h-2 w-2 text-green-500" />{req}
          </span>
        ))}
      </div>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        <Clock className="h-2.5 w-2.5" />Posted {daysLabel}
      </div>
    </div>
  );
}
