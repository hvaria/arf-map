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
import type { Facility, FacilityPin, JobPosting } from "@shared/schema";
import { cn } from "@/lib/utils";
import { normalizeRawType } from "@shared/taxonomy";
import { ExpressInterestButton } from "@/components/ExpressInterestButton"; // NEW: expression-of-interest
import { useSession } from "@/hooks/useSession";

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
  facility: FacilityPin | null;
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
  /**
   * Full facility row — supplied by the extended /public endpoint so the
   * detail panel can render the heavy fields (licensee, administrator,
   * citations, visit history, etc.) that the slim pin doesn't carry.
   */
  facility: Facility | null;
  overrides: FacilityOverride | null;
  jobPostings: DbJobPosting[];
}

// Status palette — uses the portal status tokens so the panel sits in the
// same visual family as the rest of the system. The dot stays saturated
// for legibility; the chip background is a soft tinted surface.
const STATUS_CONFIG: Record<string, { dot: string; chip: string }> = {
  LICENSED:       { dot: "#15803D", chip: "bg-[var(--portal-status-ok-bg)] text-[var(--portal-status-ok)] border-[var(--portal-status-ok-border)]" },
  CLOSED:         { dot: "#B91C1C", chip: "bg-[var(--portal-status-critical-bg)] text-[var(--portal-status-critical)] border-[var(--portal-status-critical-border)]" },
  PENDING:        { dot: "#A16207", chip: "bg-[var(--portal-status-warning-bg)] text-[var(--portal-status-warning)] border-[var(--portal-status-warning-border)]" },
  "ON PROBATION": { dot: "#A16207", chip: "bg-[var(--portal-status-warning-bg)] text-[var(--portal-status-warning)] border-[var(--portal-status-warning-border)]" },
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

  const { data: publicData, isLoading: isLoadingDetail } = useQuery<PublicData>({
    queryKey: [`/api/facilities/${facility?.number}/public`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!facility?.number,
    staleTime: 30000,
  });

  const { data: me } = useSession();

  if (!facility) return null;

  const statusConfig = STATUS_CONFIG[facility.status] || STATUS_CONFIG.LICENSED;
  const ccldUrl = `https://www.ccld.dss.ca.gov/carefacilitysearch/FacDetail/${facility.number}`;
  const isOwner = me?.facilityNumber === facility.number;
  const distanceMiles =
    userLocation
      ? haversineDistanceMiles(userLocation.lat, userLocation.lng, facility.lat, facility.lng)
      : null;

  // Heavy fields (licensee, administrator, citations, visit history, etc.)
  // arrive from /api/facilities/:number/public — the slim pin only carries
  // what the map needs. While the detail request is in flight the panel
  // renders pin-derived fields immediately and shows skeletons for the rest.
  const detail = publicData?.facility ?? null;
  const overrides = publicData?.overrides;
  const displayPhone = overrides?.phone || detail?.phone || "";
  const dbJobs = publicData?.jobPostings ?? [];
  const displayJobs: (JobPosting | DbJobPosting)[] = dbJobs;
  const isHiring = facility.isHiring;

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
          "w-10 h-1 rounded-full transition-colors",
          dragging ? "bg-stone-500" : "bg-stone-300 hover:bg-stone-400"
        )} />
        <span className="text-[10px] text-muted-foreground/50 mt-1 select-none">drag to resize</span>
      </div>

      {/* ── Header ── */}
      <div className="shrink-0 px-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2
              className="text-[15px] font-semibold leading-tight text-stone-900 truncate"
              data-testid="text-facility-name"
            >
              {facility.name}
            </h2>
            <p className="text-[12px] text-muted-foreground mt-0.5 portal-num">
              License #{facility.number}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="shrink-0 -mr-1 h-8 w-8 text-muted-foreground hover:text-foreground"
            data-testid="button-close-panel"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex flex-wrap gap-1.5 mt-2">
          <Badge
            className={cn("text-[11px] font-medium px-2 py-0.5 gap-1", statusConfig.chip)}
            variant="outline"
          >
            <span className="w-1.5 h-1.5 rounded-full inline-block" style={{ backgroundColor: statusConfig.dot }} />
            {facility.status}
          </Badge>
          {facility.facilityType && (() => {
            const entry = normalizeRawType(facility.facilityType);
            const label = entry?.displayLabel ?? facility.facilityType;
            return (
              <Badge
                variant="outline"
                className="text-[11px] px-2 py-0.5 text-muted-foreground bg-stone-50 border-stone-200"
                title={entry?.officialLabel ?? facility.facilityType}
              >
                {label}
              </Badge>
            );
          })()}
          {facility.capacity > 0 && (
            <Badge variant="outline" className="text-[11px] px-2 py-0.5 text-muted-foreground bg-stone-50 border-stone-200 portal-num">
              {facility.capacity} beds
            </Badge>
          )}
          {isHiring && (
            <Badge
              variant="outline"
              className="text-[11px] font-medium px-2 py-0.5 gap-1 bg-[var(--portal-accent-soft)] text-[var(--portal-accent)] border-[var(--portal-status-warning-border)]"
            >
              <Briefcase className="h-3 w-3" />
              Hiring · <span className="portal-num">{displayJobs.length}</span>
            </Badge>
          )}
          {distanceMiles !== null && (
            <Badge variant="outline" className="text-[11px] px-2 py-0.5 text-muted-foreground bg-stone-50 border-stone-200 gap-1 portal-num">
              <MapPin className="h-2.5 w-2.5" />
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
              {detail
                ? <>{detail.address}, {facility.city}, CA {detail.zip}</>
                : isLoadingDetail
                  ? <SkeletonLine />
                  : <>{facility.city}, CA</>}
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
            <InfoRow icon={Building2} label="Licensee">{detail?.licensee || (isLoadingDetail ? <SkeletonLine /> : "—")}</InfoRow>
            <InfoRow icon={User} label="Administrator">{detail?.administrator || (isLoadingDetail ? <SkeletonLine /> : "—")}</InfoRow>
          </Section>

          <Section title="Key Dates">
            <InfoRow icon={Calendar} label="First Licensed">{detail?.firstLicenseDate || (isLoadingDetail ? <SkeletonLine /> : "—")}</InfoRow>
            {detail?.closedDate && (
              <InfoRow icon={Calendar} label="Closed Date">
                <span className="text-red-600 dark:text-red-400">{detail.closedDate}</span>
              </InfoRow>
            )}
            <InfoRow icon={Calendar} label="Last Inspection">{detail?.lastInspectionDate || (isLoadingDetail ? <SkeletonLine /> : "—")}</InfoRow>
          </Section>

          <Section title="Visit History">
            <div className="grid grid-cols-3 gap-2">
              <StatCard label="Total" value={detail?.totalVisits ?? 0} />
              <StatCard label="Inspections" value={detail?.inspectionVisits ?? 0} />
              <StatCard label="Complaints" value={detail?.complaintVisits ?? 0} alert={(detail?.complaintVisits ?? 0) > 0} />
            </div>
          </Section>

          <Section title="Type B Deficiencies">
            <div className="grid grid-cols-2 gap-2">
              <StatCard label="Inspection" value={detail?.inspectTypeB ?? 0} alert={(detail?.inspectTypeB ?? 0) > 0} />
              <StatCard label="Other"      value={detail?.otherTypeB ?? 0}   alert={(detail?.otherTypeB ?? 0) > 0} />
              <StatCard label="Complaint"  value={detail?.complaintTypeB ?? 0} alert={(detail?.complaintTypeB ?? 0) > 0} />
              <StatCard label="Total"      value={detail?.totalTypeB ?? 0}   alert={(detail?.totalTypeB ?? 0) > 0} large />
            </div>
            {detail?.citations && (
              <div
                className="mt-2 p-3 rounded-md border"
                style={{
                  background: "var(--portal-status-warning-bg)",
                  borderColor: "var(--portal-status-warning-border)",
                }}
              >
                <div
                  className="flex items-center gap-1.5 text-[12px] font-medium mb-1"
                  style={{ color: "var(--portal-status-warning)" }}
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  Citations
                </div>
                <p
                  className="text-[12px] break-all leading-relaxed"
                  style={{ color: "var(--portal-status-warning)" }}
                >
                  {detail.citations}
                </p>
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

          {/* NEW: expression-of-interest — job seeker interest button */}
          {!isOwner && (
            <ExpressInterestButton
              facilityNumber={facility.number}
              facilityName={facility.name}
            />
          )}

          {isOwner && (
            <a
              href="/#/facility-portal"
              className="flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-md border bg-[var(--portal-accent-soft)] text-[var(--portal-accent)] text-[13px] font-medium hover:bg-[var(--portal-accent-soft)] hover:brightness-95 transition-colors"
              style={{ borderColor: "var(--portal-status-warning-border)" }}
            >
              <Pencil className="h-3.5 w-3.5" />
              Manage this listing
            </a>
          )}

          <a
            href={ccldUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-md border bg-white text-stone-700 text-[13px] font-medium hover:bg-stone-50 transition-colors"
            style={{ borderColor: "var(--portal-border-subtle)" }}
            data-testid="link-ccld"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View on CCLD website
          </a>

          <p className="text-[11px] text-muted-foreground text-center leading-relaxed pb-2">
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
      <h3 className="portal-eyebrow mb-2">{title}</h3>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function SkeletonLine() {
  return <span className="inline-block w-32 h-3 bg-stone-100 rounded animate-pulse align-middle" />;
}

function InfoRow({ icon: Icon, label, children }: { icon: any; label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon className="h-3.5 w-3.5 text-stone-400 mt-1 shrink-0" />
      <div className="min-w-0 flex-1">
        <span className="text-[11px] text-muted-foreground block leading-none mb-0.5">{label}</span>
        <p className="text-[13px] text-stone-900 leading-snug">{children}</p>
      </div>
    </div>
  );
}

function StatCard({ label, value, alert, large }: { label: string; value: number; alert?: boolean; large?: boolean }) {
  return (
    <div
      className={cn(
        "rounded-md border p-2.5 text-center transition-colors",
        alert
          ? "bg-[var(--portal-status-critical-bg)]"
          : "bg-stone-50",
      )}
      style={{
        borderColor: alert
          ? "var(--portal-status-critical-border)"
          : "var(--portal-border-subtle)",
      }}
    >
      <div
        className={cn(
          "font-semibold portal-num leading-none",
          large ? "text-[18px]" : "text-[15px]",
          alert ? "text-[var(--portal-status-critical)]" : "text-stone-900",
        )}
      >
        {value}
      </div>
      <div className="text-[11px] text-muted-foreground mt-1">{label}</div>
    </div>
  );
}

function JobCard({ job }: { job: JobPosting }) {
  const daysLabel = job.postedDaysAgo === 0 ? "Today" : job.postedDaysAgo === 1 ? "1 day ago" : `${job.postedDaysAgo} days ago`;
  return (
    <div
      className="rounded-md border bg-white p-3"
      style={{ borderColor: "var(--portal-border-subtle)" }}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold text-stone-900 truncate">{job.title}</h4>
          <span className="text-[11px] text-muted-foreground">{job.type}</span>
        </div>
        <Badge
          variant="outline"
          className="text-[11px] px-1.5 py-0.5 portal-num bg-stone-50 text-stone-700 border-stone-200 gap-0.5"
        >
          <DollarSign className="h-3 w-3" />
          {job.salary}
        </Badge>
      </div>
      <p className="text-[12px] text-muted-foreground leading-relaxed mb-2 line-clamp-2">{job.description}</p>
      {job.requirements.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {job.requirements.map((req, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 text-[11px] bg-stone-50 border rounded-full px-2 py-0.5 text-stone-600"
              style={{ borderColor: "var(--portal-border-subtle)" }}
            >
              <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" />{req}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 text-[11px] text-muted-foreground portal-num">
        <Clock className="h-3 w-3" />Posted {daysLabel}
      </div>
    </div>
  );
}
