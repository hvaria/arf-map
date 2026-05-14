import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import {
  X, Phone, MapPin, Calendar, ShieldCheck, BadgeCheck,
  ExternalLink, Briefcase, Clock, DollarSign, CheckCircle2,
  Globe, Mail, Pencil, AlertTriangle, ChevronRight, Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { Facility, FacilityPin, JobPosting } from "@shared/schema";
import { cn } from "@/lib/utils";
import { normalizeRawType } from "@shared/taxonomy";
import { ExpressInterestButton } from "@/components/ExpressInterestButton";
import { useSession } from "@/hooks/useSession";

// ── Distance helper ──────────────────────────────────────────────────────────
function haversineDistanceMiles(
  lat1: number, lng1: number, lat2: number, lng2: number,
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

// "8 months ago" / "today" / "3 years ago" — humanized recency for trust chips.
function relativeFromDateString(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  const days = Math.max(0, Math.floor(diffMs / 86400000));
  if (days < 1) return "today";
  if (days < 30) return `${days} day${days === 1 ? "" : "s"} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.floor(months / 12);
  return `${years} year${years === 1 ? "" : "s"} ago`;
}

function yearOf(iso?: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return String(d.getFullYear());
}

// ── Types ────────────────────────────────────────────────────────────────────
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
  facility: Facility | null;
  overrides: FacilityOverride | null;
  jobPostings: DbJobPosting[];
}

// ── Status palette (kept from prior version, neighborhood-friendly) ──────────
const STATUS_CONFIG: Record<string, { dot: string; tint: string; ring: string; label: string }> = {
  LICENSED: {
    dot: "#15803D",
    tint: "var(--portal-status-ok-bg)",
    ring: "var(--portal-status-ok-border)",
    label: "Licensed",
  },
  CLOSED: {
    dot: "#B91C1C",
    tint: "var(--portal-status-critical-bg)",
    ring: "var(--portal-status-critical-border)",
    label: "Closed",
  },
  PENDING: {
    dot: "#A16207",
    tint: "var(--portal-status-warning-bg)",
    ring: "var(--portal-status-warning-border)",
    label: "Pending",
  },
  "ON PROBATION": {
    dot: "#A16207",
    tint: "var(--portal-status-warning-bg)",
    ring: "var(--portal-status-warning-border)",
    label: "On Probation",
  },
};

// 3D depth tokens — kept inline so the panel is self-contained and reads as a
// raised surface against the map. All values stay inside the portal palette;
// nothing introduces new colors.
const SHADOW_PANEL =
  "0 -1px 0 rgba(255,255,255,0.9) inset, 0 -10px 28px -8px rgba(28,25,23,0.18), 0 -3px 8px -2px rgba(28,25,23,0.08)";
const SHADOW_CHIP =
  "inset 0 1px 0 rgba(255,255,255,0.9), 0 1px 2px rgba(28,25,23,0.06)";
const SHADOW_CARD =
  "inset 0 1px 0 rgba(255,255,255,0.95), 0 1px 2px rgba(28,25,23,0.05), 0 4px 14px -8px rgba(28,25,23,0.10)";
const SHADOW_BTN_PRIMARY =
  "inset 0 1px 0 rgba(255,255,255,0.22), inset 0 -1px 0 rgba(0,0,0,0.12), 0 1px 2px rgba(28,25,23,0.18), 0 8px 20px -6px rgba(194,90,46,0.42)";

// ── Drag-resize constants ────────────────────────────────────────────────────
const MIN_VH = 22;
const MAX_VH = 88;
const DEFAULT_VH = 38;
const CLOSE_THRESHOLD_VH = 16;

// ── Main component ───────────────────────────────────────────────────────────
export function FacilityPanel({ facility, open, onClose, userLocation }: FacilityPanelProps) {
  const [panelVh, setPanelVh] = useState(DEFAULT_VH);
  const [dragging, setDragging] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const dragData = useRef<{ startY: number; startVh: number } | null>(null);

  useEffect(() => {
    if (open) {
      setPanelVh(DEFAULT_VH);
      setDescExpanded(false);
    }
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
    [panelVh, onClose],
  );

  const { data: publicData, isLoading: isLoadingDetail } = useQuery<PublicData>({
    queryKey: [`/api/facilities/${facility?.number}/public`],
    queryFn: getQueryFn({ on401: "throw" }),
    enabled: !!facility?.number,
    staleTime: 30000,
  });

  const { data: me } = useSession();

  // ── Derived display fields ────────────────────────────────────────────────
  const detail = publicData?.facility ?? null;
  const overrides = publicData?.overrides;
  const ccldUrl = facility
    ? `https://www.ccld.dss.ca.gov/carefacilitysearch/FacDetail/${facility.number}`
    : "";

  const displayPhone = overrides?.phone || detail?.phone || "";
  const dbJobs = publicData?.jobPostings ?? [];
  const displayJobs: (JobPosting | DbJobPosting)[] = dbJobs;

  const typeEntry = facility?.facilityType ? normalizeRawType(facility.facilityType) : null;
  const plainTypeLabel = typeEntry?.displayLabel ?? facility?.facilityType ?? "Care facility";

  const distanceMiles = useMemo(() => {
    if (!facility || !userLocation) return null;
    return haversineDistanceMiles(userLocation.lat, userLocation.lng, facility.lat, facility.lng);
  }, [facility, userLocation]);

  const operatorVerified = !!(
    overrides && (overrides.phone || overrides.description || overrides.website || overrides.email)
  );
  const isHiring = !!facility?.isHiring;
  const lastInspectedRel = relativeFromDateString(detail?.lastInspectionDate);
  const operatingSinceYear = yearOf(detail?.firstLicenseDate);
  const isClosed = facility?.status === "CLOSED" || !!detail?.closedDate;
  const isOwner = me?.facilityNumber === facility?.number;

  if (!facility) return null;

  const statusConfig = STATUS_CONFIG[facility.status] || STATUS_CONFIG.LICENSED;

  // Compact subtitle: "Assisted Living · 6 beds · San Mateo"
  const subtitleParts = [
    plainTypeLabel,
    facility.capacity > 0 ? `${facility.capacity} beds` : null,
    facility.city || null,
  ].filter(Boolean) as string[];

  return (
    <div
      data-testid="facility-panel"
      style={{
        height: `${panelVh}vh`,
        background: "linear-gradient(180deg, #FFFFFF 0%, #FAFAF9 100%)",
        boxShadow: SHADOW_PANEL,
      }}
      className={cn(
        "fixed bottom-0 left-0 right-0 md:right-80 z-40",
        "rounded-t-[20px] border-t border-stone-200/80",
        "flex flex-col",
        dragging ? "" : "transition-transform duration-300 ease-out",
        open ? "translate-y-0" : "translate-y-full",
      )}
    >
      {/* ── Drag handle ── */}
      <div
        className="shrink-0 pt-2.5 pb-1 flex flex-col items-center cursor-row-resize select-none touch-none"
        onMouseDown={(e) => { e.preventDefault(); startDrag(e.clientY); }}
        onTouchStart={(e) => startDrag(e.touches[0].clientY)}
      >
        <div
          className={cn(
            "w-11 h-1.5 rounded-full transition-colors",
            dragging ? "bg-stone-500" : "bg-stone-300 hover:bg-stone-400",
          )}
          style={{ boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6), 0 1px 1px rgba(0,0,0,0.05)" }}
        />
      </div>

      {/* ── Closed-facility takeover banner ── */}
      {isClosed && (
        <div
          className="mx-4 mb-3 rounded-xl px-3.5 py-2.5"
          style={{
            background: "linear-gradient(180deg, #FFFFFF 0%, var(--portal-status-critical-bg) 100%)",
            border: "1px solid var(--portal-status-critical-border)",
            boxShadow: SHADOW_CARD,
          }}
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" style={{ color: "var(--portal-status-critical)" }} />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold" style={{ color: "var(--portal-status-critical)" }}>
                This home is closed.
              </p>
              {detail?.closedDate && (
                <p className="text-[12px] mt-0.5" style={{ color: "var(--portal-status-critical)" }}>
                  Stopped operating on {detail.closedDate}.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Header ── */}
      <div className="shrink-0 px-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2
              className="text-[17px] font-semibold leading-tight tracking-tight text-stone-900 truncate"
              data-testid="text-facility-name"
            >
              {facility.name}
            </h2>
            <p className="text-[12.5px] text-stone-500 mt-1 leading-snug truncate">
              {subtitleParts.join(" · ")}
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="shrink-0 -mr-1 h-8 w-8 text-stone-500 hover:text-stone-900 rounded-full"
            style={{
              background: "linear-gradient(180deg, #FFFFFF 0%, #F5F5F4 100%)",
              boxShadow: SHADOW_CHIP,
            }}
            data-testid="button-close-panel"
            aria-label="Close panel"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        {/* Chip row — 3D layered pills */}
        <div className="flex flex-wrap gap-1.5 mt-3">
          <Chip3D
            tint={statusConfig.tint}
            ring={statusConfig.ring}
            iconDot={statusConfig.dot}
            textColor={statusConfig.dot}
            label={statusConfig.label}
            strong
          />
          {distanceMiles !== null && (
            <Chip3D
              icon={MapPin}
              label={`${distanceMiles.toFixed(1)} mi away`}
            />
          )}
          {isHiring && (
            <Chip3D
              icon={Briefcase}
              tint="var(--portal-accent-soft)"
              ring="var(--portal-status-warning-border)"
              textColor="var(--portal-accent)"
              label={`Hiring · ${displayJobs.length || ""}`.trim()}
              strong
            />
          )}
          {operatorVerified && (
            <Chip3D
              icon={BadgeCheck}
              tint="#EFF6FF"
              ring="#BFDBFE"
              textColor="#1D4ED8"
              label="Operator-verified"
            />
          )}
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-y-auto overscroll-contain min-h-0">
        <div className="px-4 pb-4 space-y-4">
          {/* Primary action — in-app chat will live here in a future iteration;
              the visitor can still see and copy the phone number from the
              Location tab in the meantime. */}
          {!isClosed && (
            !isOwner ? (
              <div
                className="rounded-xl overflow-hidden"
                style={{ boxShadow: SHADOW_BTN_PRIMARY, borderRadius: 12 }}
              >
                <ExpressInterestButton
                  facilityNumber={facility.number}
                  facilityName={facility.name}
                />
              </div>
            ) : (
              <a
                href="/#/facility-portal"
                className="flex items-center justify-center gap-2 w-full px-3 py-2.5 rounded-xl text-[13.5px] font-semibold transition-transform active:translate-y-[1px]"
                style={{
                  background:
                    "linear-gradient(180deg, var(--portal-accent) 0%, var(--portal-accent-hover) 100%)",
                  color: "var(--portal-accent-fg)",
                  boxShadow: SHADOW_BTN_PRIMARY,
                }}
              >
                <Pencil className="h-4 w-4" />
                Manage listing
              </a>
            )
          )}

          {/* Trust block */}
          <SectionCard>
            <SectionEyebrow>Trust signals</SectionEyebrow>
            <div className="space-y-1.5">
              <TrustLine
                icon={ShieldCheck}
                tone={facility.status === "LICENSED" ? "ok" : "warning"}
                label={
                  facility.status === "LICENSED"
                    ? "Licensed by CDSS-CCLD"
                    : `License status: ${statusConfig.label}`
                }
              />
              {lastInspectedRel && (
                <TrustLine
                  icon={Calendar}
                  tone="ok"
                  label={`Last inspected ${lastInspectedRel}`}
                />
              )}
              {operatingSinceYear && (
                <TrustLine
                  icon={Sparkles}
                  tone="neutral"
                  label={`Operating since ${operatingSinceYear}`}
                />
              )}
              {operatorVerified && (
                <TrustLine
                  icon={BadgeCheck}
                  tone="info"
                  label="Operator-verified listing"
                />
              )}
              {!lastInspectedRel && !operatingSinceYear && isLoadingDetail && (
                <SkeletonLine />
              )}
            </div>
          </SectionCard>

          {/* About */}
          {overrides?.description && (
            <SectionCard>
              <SectionEyebrow>About</SectionEyebrow>
              <p
                className={cn(
                  "text-[13.5px] text-stone-800 leading-relaxed",
                  !descExpanded && "line-clamp-3",
                )}
              >
                {overrides.description}
              </p>
              {overrides.description.length > 140 && (
                <button
                  type="button"
                  onClick={() => setDescExpanded((v) => !v)}
                  className="mt-1.5 text-[12px] font-medium text-stone-600 hover:text-stone-900 inline-flex items-center gap-0.5"
                >
                  {descExpanded ? "Show less" : "Read more"}
                  <ChevronRight className={cn("h-3 w-3 transition-transform", descExpanded && "rotate-90")} />
                </button>
              )}
            </SectionCard>
          )}

          {/* Contact — always visible, merged from former Overview + Location tabs */}
          <SectionCard>
            <SectionEyebrow>Contact</SectionEyebrow>
            <div className="space-y-2.5">
              <InfoRow icon={MapPin} label="Address">
                {detail
                  ? <>{detail.address}, {facility.city}, CA {detail.zip}</>
                  : isLoadingDetail
                    ? <SkeletonLine />
                    : <>{facility.city}, CA</>}
                {facility.county && (
                  <span className="block text-[10.5px] text-stone-500 mt-0.5">{facility.county} County</span>
                )}
              </InfoRow>
              {displayPhone && (
                <InfoRow icon={Phone} label="Phone">
                  <a href={`tel:${displayPhone}`} className="text-stone-900 hover:underline">
                    {displayPhone}
                  </a>
                </InfoRow>
              )}
              {overrides?.email && (
                <InfoRow icon={Mail} label="Email">
                  <a href={`mailto:${overrides.email}`} className="text-stone-900 hover:underline">
                    {overrides.email}
                  </a>
                </InfoRow>
              )}
              {overrides?.website && (
                <InfoRow icon={Globe} label="Website">
                  <a
                    href={overrides.website}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-stone-900 hover:underline break-all"
                  >
                    {overrides.website.replace(/^https?:\/\//, "")}
                  </a>
                </InfoRow>
              )}
            </div>
          </SectionCard>

          {/* Open roles — inline, only when the facility is hiring */}
          {displayJobs.length > 0 && (
            <SectionCard>
              <SectionEyebrow>Open roles · {displayJobs.length}</SectionEyebrow>
              <div className="space-y-2">
                {displayJobs.map((job, idx) => {
                  const isDbJob = "postedAt" in job;
                  const jobPosting = isDbJob
                    ? {
                        ...(job as DbJobPosting),
                        postedDaysAgo: Math.floor((Date.now() - (job as DbJobPosting).postedAt) / 86400000),
                      }
                    : (job as JobPosting);
                  return <JobCard key={isDbJob ? (job as DbJobPosting).id : idx} job={jobPosting as JobPosting} />;
                })}
              </div>
              <p className="text-[11.5px] text-stone-500 mt-2 italic">
                Express interest above — the facility will see your profile.
              </p>
            </SectionCard>
          )}

          {/* Footer — no license number, only source + freshness */}
          <div className="pt-1 flex items-center justify-between text-[11px] text-stone-500">
            <a
              href={ccldUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="link-ccld"
              className="inline-flex items-center gap-1 hover:text-stone-700"
            >
              Source · verify on CCLD
              <ExternalLink className="h-2.5 w-2.5" />
            </a>
            <span>Data refreshed Mar 2026</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ───────────────────────────────────────────────────────────

function SectionEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="text-[10.5px] font-semibold tracking-[0.08em] uppercase text-stone-500 mb-2">
      {children}
    </h3>
  );
}

function SectionCard({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="rounded-2xl p-3.5"
      style={{
        background: "linear-gradient(180deg, #FFFFFF 0%, #FAFAF9 100%)",
        border: "1px solid var(--portal-border-subtle)",
        boxShadow: SHADOW_CARD,
      }}
    >
      {children}
    </div>
  );
}

function Chip3D({
  icon: Icon,
  iconDot,
  label,
  tint,
  ring,
  textColor,
  strong,
}: {
  icon?: any;
  iconDot?: string;
  label: string;
  tint?: string;
  ring?: string;
  textColor?: string;
  strong?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11.5px] leading-none",
        strong ? "font-semibold" : "font-medium",
      )}
      style={{
        background: tint
          ? `linear-gradient(180deg, #FFFFFF 0%, ${tint} 100%)`
          : "linear-gradient(180deg, #FFFFFF 0%, #F5F5F4 100%)",
        border: `1px solid ${ring ?? "var(--portal-border-subtle)"}`,
        color: textColor ?? "var(--portal-text-secondary)",
        boxShadow: SHADOW_CHIP,
      }}
    >
      {iconDot && (
        <span
          className="w-1.5 h-1.5 rounded-full inline-block"
          style={{
            backgroundColor: iconDot,
            boxShadow: `0 0 0 2px rgba(255,255,255,0.6), 0 0 6px ${iconDot}66`,
          }}
        />
      )}
      {Icon && <Icon className="h-3 w-3" />}
      {label}
    </span>
  );
}

function TrustLine({
  icon: Icon,
  label,
  tone,
}: {
  icon: any;
  label: string;
  tone: "ok" | "warning" | "info" | "neutral";
}) {
  const colorMap = {
    ok: "var(--portal-status-ok)",
    warning: "var(--portal-status-warning)",
    info: "#1D4ED8",
    neutral: "var(--portal-text-secondary)",
  } as const;
  const tintMap = {
    ok: "var(--portal-status-ok-bg)",
    warning: "var(--portal-status-warning-bg)",
    info: "#EFF6FF",
    neutral: "#F5F5F4",
  } as const;
  return (
    <div className="flex items-center gap-2">
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded-full shrink-0"
        style={{
          background: `linear-gradient(180deg, #FFFFFF 0%, ${tintMap[tone]} 100%)`,
          boxShadow: SHADOW_CHIP,
        }}
      >
        <Icon className="h-3 w-3" style={{ color: colorMap[tone] }} />
      </span>
      <span className="text-[13px] text-stone-800 leading-snug">{label}</span>
    </div>
  );
}

function SkeletonLine() {
  return <span className="inline-block w-32 h-3 bg-stone-100 rounded animate-pulse align-middle" />;
}

function InfoRow({
  icon: Icon,
  label,
  children,
}: {
  icon: any;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start gap-2.5">
      <span
        className="inline-flex items-center justify-center w-6 h-6 rounded-lg shrink-0 mt-0.5"
        style={{
          background: "linear-gradient(180deg, #FFFFFF 0%, #F5F5F4 100%)",
          border: "1px solid var(--portal-border-subtle)",
          boxShadow: SHADOW_CHIP,
        }}
      >
        <Icon className="h-3 w-3 text-stone-500" />
      </span>
      <div className="min-w-0 flex-1 pt-0.5">
        <span className="text-[10.5px] text-stone-500 block leading-none mb-0.5 uppercase tracking-wide">
          {label}
        </span>
        <p className="text-[13px] text-stone-900 leading-snug">{children}</p>
      </div>
    </div>
  );
}

function JobCard({ job }: { job: JobPosting }) {
  const daysLabel =
    job.postedDaysAgo === 0 ? "Today" : job.postedDaysAgo === 1 ? "1 day ago" : `${job.postedDaysAgo} days ago`;
  return (
    <div
      className="rounded-xl p-3"
      style={{
        background: "linear-gradient(180deg, #FFFFFF 0%, #FAFAF9 100%)",
        border: "1px solid var(--portal-border-subtle)",
        boxShadow: SHADOW_CHIP,
      }}
    >
      <div className="flex items-start justify-between gap-2 mb-1.5">
        <div className="min-w-0">
          <h4 className="text-[13.5px] font-semibold text-stone-900 truncate">{job.title}</h4>
          <span className="text-[11.5px] text-stone-500">{job.type}</span>
        </div>
        <span
          className="inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-[11px] font-medium text-stone-700"
          style={{
            background: "linear-gradient(180deg, #FFFFFF 0%, #F5F5F4 100%)",
            border: "1px solid var(--portal-border-subtle)",
            boxShadow: SHADOW_CHIP,
          }}
        >
          <DollarSign className="h-3 w-3" />
          {job.salary}
        </span>
      </div>
      <p className="text-[12px] text-stone-600 leading-relaxed mb-2 line-clamp-2">{job.description}</p>
      {job.requirements.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {job.requirements.map((req, i) => (
            <span
              key={i}
              className="inline-flex items-center gap-1 text-[10.5px] rounded-full px-2 py-0.5 text-stone-600"
              style={{
                background: "linear-gradient(180deg, #FFFFFF 0%, #F5F5F4 100%)",
                border: "1px solid var(--portal-border-subtle)",
                boxShadow: SHADOW_CHIP,
              }}
            >
              <CheckCircle2 className="h-2.5 w-2.5 text-emerald-600" />
              {req}
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1 text-[11px] text-stone-500 portal-num">
        <Clock className="h-3 w-3" />
        Posted {daysLabel}
      </div>
    </div>
  );
}

