import { useEffect, useRef } from "react";
import { Link, useRoute, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowLeft,
  Briefcase,
  Building2,
  Clock,
  DollarSign,
  MapPin,
} from "lucide-react";
import { getQueryFn } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { BrandLogo } from "@/components/BrandLogo";
import { ExpressInterestButton } from "@/components/ExpressInterestButton";

// Visual language follows the Operations tab canonical patterns (mirrors
// ComplianceContent.tsx:268-302): page heading is `text-xl font-semibold`
// with inline color #1E1B4B; status / value chips use the operator tone
// palette (emerald = ok / positive, blue = pending, slate = info);
// summary/info tiles use the soft-indigo neutral (#F0F4FF / #E0E7FF);
// primary CTA uses <Button variant="gradient"> (portal-btn-primary),
// applied here via the existing <ExpressInterestButton>.

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

export default function JobDetailPage() {
  const [match, params] = useRoute<{ id: string }>("/jobs/:id");
  const [, setLocation] = useLocation();
  const headingRef = useRef<HTMLHeadingElement | null>(null);

  const id = match ? Number(params?.id) : NaN;
  const validId = Number.isInteger(id) && id > 0;

  const { data: job, isLoading, isError } = useQuery<JobDetail | null>({
    queryKey: [`/api/jobs/${id}`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: validId,
    staleTime: 60000,
  });

  const { data: facilityData } = useQuery<FacilityPublic | null>({
    queryKey: [`/api/facilities/${job?.facilityNumber}/public`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!job?.facilityNumber,
    staleTime: 60000,
  });

  // Move focus to the page heading on mount so screen readers announce
  // the new context after the hash navigation.
  useEffect(() => {
    if (job && headingRef.current) headingRef.current.focus();
  }, [job?.id]);

  if (!validId) {
    return <NotFoundCard onBack={() => setLocation("/map")} />;
  }

  if (isLoading) {
    return (
      <div className="min-h-screen bg-white">
        <TopBar />
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 space-y-4">
          <Skeleton className="h-7 w-2/3 rounded-md" />
          <Skeleton className="h-4 w-1/3 rounded-md" />
          <Skeleton className="h-32 w-full rounded-lg" />
          <Skeleton className="h-24 w-full rounded-lg" />
        </main>
      </div>
    );
  }

  if (isError || !job) {
    return <NotFoundCard onBack={() => setLocation("/map")} />;
  }

  const facility = facilityData?.facility ?? null;

  return (
    <div className="min-h-screen bg-white">
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 space-y-4">
        {/* Operator-style back link: muted-foreground, hover→foreground.
            Mirrors AuditReadinessContent.tsx:60-67. */}
        <button
          onClick={() => setLocation("/map")}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to map
        </button>

        {/* Page heading row — operator pattern: title left, optional action right. */}
        <div className="flex items-center justify-between gap-3">
          <h1
            ref={headingRef}
            tabIndex={-1}
            className="text-xl font-semibold outline-none focus-visible:outline-none"
            style={{ color: "#1E1B4B" }}
          >
            {job.title}
          </h1>
        </div>

        {/* Facility sub-line */}
        {facility && (
          <p className="text-sm text-muted-foreground flex flex-wrap items-center gap-1.5 -mt-2">
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
          </p>
        )}

        {/* Summary tiles — operator KPI pattern (rounded-lg p-3 + tone-50/tone-200
            for status-coded, #F0F4FF / #E0E7FF for the neutral primary tile). */}
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-lg p-3 text-center" style={{ background: "#F0F4FF", border: "1px solid #E0E7FF" }}>
            <p className="text-xs portal-eyebrow flex items-center justify-center gap-1">
              <Briefcase className="h-3 w-3" />
              Role
            </p>
            <p className="text-sm font-semibold mt-1" style={{ color: "#1E1B4B" }}>{job.type}</p>
          </div>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
            <p className="text-xs portal-eyebrow text-emerald-700 flex items-center justify-center gap-1">
              <DollarSign className="h-3 w-3" />
              Pay
            </p>
            <p className="text-sm font-semibold text-emerald-700 mt-1 portal-num">
              {formatPayRange(job.payMin, job.payMax, job.salary)}
            </p>
          </div>
          <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-center">
            <p className="text-xs portal-eyebrow flex items-center justify-center gap-1">
              <Clock className="h-3 w-3" />
              Posted
            </p>
            <p className="text-sm font-semibold mt-1 text-stone-700">{daysAgo(job.postedAt)}</p>
          </div>
        </div>

        {/* About section — portal-card-style outline */}
        {job.description && (
          <section className="rounded-lg border border-stone-200 bg-white p-5 space-y-2">
            <h2 className="portal-eyebrow">About this role</h2>
            <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
              {job.description}
            </p>
          </section>
        )}

        {/* Requirements — checklist treatment mirrors Compliance's list rows */}
        {job.requirements.length > 0 && (
          <section className="rounded-lg border border-stone-200 bg-white p-5 space-y-2">
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

        {/* CTA — per-job interest, scoped to this jobId (no facility-wide
            cascade). Button visual = portal-btn-primary via the existing
            ExpressInterestButton implementation. */}
        {facility && (
          <div className="pt-2 max-w-xs">
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
      </main>
    </div>
  );
}

function TopBar() {
  return (
    <header className="border-b bg-white" style={{ borderColor: "var(--portal-border-subtle)" }}>
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
        <Link
          href="/map"
          className="flex items-center hover:opacity-90 transition-opacity"
          aria-label="Back to map"
        >
          <BrandLogo size={44} />
        </Link>
      </div>
    </header>
  );
}

function NotFoundCard({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-screen bg-white">
      <TopBar />
      <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <div className="rounded-lg border border-dashed p-10 text-center">
          <Briefcase className="h-8 w-8 mx-auto text-muted-foreground mb-2 opacity-40" />
          <h1 className="text-base font-semibold" style={{ color: "#1E1B4B" }}>
            This job is no longer available
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            It may have been filled or removed by the facility.
          </p>
          <button
            onClick={onBack}
            className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to map
          </button>
        </div>
      </main>
    </div>
  );
}
