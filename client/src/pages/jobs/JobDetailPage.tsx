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
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { BrandLogo } from "@/components/BrandLogo";
import { ExpressInterestButton } from "@/components/ExpressInterestButton";

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
      <div className="min-h-screen" style={{ background: "var(--portal-bg-canvas)" }}>
        <TopBar />
        <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
          <div className="space-y-4">
            <div className="h-8 w-2/3 rounded bg-stone-100 animate-pulse" />
            <div className="h-4 w-1/3 rounded bg-stone-100 animate-pulse" />
            <div className="h-32 rounded bg-stone-100 animate-pulse" />
            <div className="h-24 rounded bg-stone-100 animate-pulse" />
          </div>
        </main>
      </div>
    );
  }

  if (isError || !job) {
    return <NotFoundCard onBack={() => setLocation("/map")} />;
  }

  const facility = facilityData?.facility ?? null;

  return (
    <div className="min-h-screen" style={{ background: "var(--portal-bg-canvas)" }}>
      <TopBar />
      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        {/* Back link */}
        <button
          onClick={() => setLocation("/map")}
          className="inline-flex items-center gap-1.5 text-[13px] text-stone-600 hover:text-[var(--portal-accent)] transition-colors mb-5"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to map
        </button>

        {/* Card */}
        <article
          className="rounded-lg bg-white p-6 sm:p-8"
          style={{ border: "1px solid var(--portal-border-subtle)" }}
        >
          {/* Heading */}
          <header className="space-y-2">
            <h1
              ref={headingRef}
              tabIndex={-1}
              className="text-2xl font-semibold outline-none focus-visible:outline-none"
              style={{ color: "var(--portal-text-primary)" }}
            >
              {job.title}
            </h1>
            {facility && (
              <p className="text-sm flex flex-wrap items-center gap-1.5" style={{ color: "var(--portal-text-secondary)" }}>
                <Building2 className="h-4 w-4 text-stone-400" />
                <span className="font-medium" style={{ color: "var(--portal-text-primary)" }}>{facility.name}</span>
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
          </header>

          {/* Highlight strip — pay badge uses the warm portal accent so it
              reads as the primary CTA hint, not a generic green pill. */}
          <div className="mt-5 flex flex-wrap items-center gap-2">
            <Badge
              variant="outline"
              className="text-[11px] px-2 py-0.5 bg-stone-50 text-stone-700 border-stone-200 font-medium"
            >
              <Briefcase className="h-3 w-3 mr-1" />
              {job.type}
            </Badge>
            <Badge
              variant="outline"
              className="text-[11px] px-2 py-0.5 font-medium"
              style={{
                background: "var(--portal-accent-soft)",
                color: "var(--portal-accent)",
                borderColor: "var(--portal-accent)",
              }}
            >
              <DollarSign className="h-3 w-3 mr-1" />
              {formatPayRange(job.payMin, job.payMax, job.salary)}
            </Badge>
            <Badge
              variant="outline"
              className="text-[11px] px-2 py-0.5 bg-stone-50 text-stone-600 border-stone-200"
            >
              <Clock className="h-3 w-3 mr-1" />
              {daysAgo(job.postedAt)}
            </Badge>
          </div>

          <Separator className="my-6" />

          {/* Description */}
          {job.description && (
            <section className="space-y-2">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-500">
                About this role
              </h2>
              <p className="text-sm leading-relaxed whitespace-pre-wrap" style={{ color: "var(--portal-text-primary)" }}>
                {job.description}
              </p>
            </section>
          )}

          {/* Requirements */}
          {job.requirements.length > 0 && (
            <section className="space-y-2 mt-6">
              <h2 className="text-[13px] font-semibold uppercase tracking-wide text-stone-500">
                Requirements
              </h2>
              <ul className="list-disc list-inside text-sm space-y-1" style={{ color: "var(--portal-text-primary)" }}>
                {job.requirements.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            </section>
          )}

          {/* CTA — per-job interest; scoped to this jobId so it does NOT
              cascade to other openings at the same facility. */}
          {facility && (
            <div className="mt-8 max-w-xs">
              <ExpressInterestButton
                facilityNumber={job.facilityNumber}
                facilityName={facility.name}
                jobId={job.id}
                ctaLabel="Apply to this job"
              />
              <p className="text-[11px] mt-2 text-center" style={{ color: "var(--portal-text-muted)" }}>
                Your application goes to {facility.name}'s hiring team.
              </p>
            </div>
          )}
        </article>
      </main>
    </div>
  );
}

function TopBar() {
  return (
    <header
      className="border-b"
      style={{
        background: "var(--portal-bg-app)",
        borderColor: "var(--portal-border-subtle)",
      }}
    >
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
    <div className="min-h-screen" style={{ background: "var(--portal-bg-canvas)" }}>
      <TopBar />
      <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6">
        <div
          className="rounded-lg p-8 text-center"
          style={{ background: "var(--portal-bg-app)", border: "1px solid var(--portal-border-subtle)" }}
        >
          <Briefcase className="h-8 w-8 text-stone-300 mx-auto mb-3" />
          <h1 className="text-lg font-semibold" style={{ color: "var(--portal-text-primary)" }}>
            This job is no longer available
          </h1>
          <p className="text-sm mt-1" style={{ color: "var(--portal-text-secondary)" }}>
            It may have been filled or removed by the facility.
          </p>
          <button
            onClick={onBack}
            className="mt-5 inline-flex items-center gap-1.5 text-sm font-medium hover:opacity-80 transition-opacity"
            style={{ color: "var(--portal-accent)" }}
          >
            <ArrowLeft className="h-4 w-4" />
            Back to map
          </button>
        </div>
      </main>
    </div>
  );
}
