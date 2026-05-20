import { useQuery } from "@tanstack/react-query";
import { ShieldCheck, BadgeCheck, BookOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { getQueryFn } from "@/lib/queryClient";
import type { JobSeekerCredential, CredentialKind } from "@shared/schema";
// CREDENTIAL_LABEL moved to a JSX-free module so non-component code
// (e.g. client/src/lib/bioTemplate.ts) can import the labels without
// pulling JSX into its dependency graph.
import { CREDENTIAL_LABEL } from "@/lib/credentialLabels";

// Re-export so existing import sites (`import { CREDENTIAL_LABEL } from
// "@/components/CredentialBadge"`) keep working unchanged.
export { CREDENTIAL_LABEL };

// Visual grouping — drives the icon and informs whether a missing
// expiry is "normal" (clearance/training) vs. info-noted (license).
const LICENSE_KINDS = new Set<CredentialKind>([
  "CNA",
  "LVN",
  "RN",
  "RCFE_ADMIN",
  "ARF_ADMIN",
  "MED_TECH",
]);
const CLEARANCE_KINDS = new Set<CredentialKind>([
  "LIVE_SCAN",
  "TB",
  "MANDATED_REPORTER",
]);
// Kinds that typically have an expiry — when omitted we show an info
// tone (slate) rather than the green "valid" tone, so a missing TB
// date doesn't get flagged as "verified for life."
const TYPICALLY_EXPIRES = new Set<CredentialKind>([
  "TB",
  "CPR",
  "FIRST_AID",
  "RCFE_40_HOUR",
  "MED_TECH",
  "CNA",
  "LVN",
  "RN",
  "DSP_YEAR_1",
  "DSP_YEAR_2",
]);

type Tone = "emerald" | "amber" | "red" | "slate";

function toneClasses(tone: Tone): string {
  switch (tone) {
    case "emerald":
      return "bg-emerald-50 text-emerald-700 border-emerald-200";
    case "amber":
      return "bg-amber-50 text-amber-700 border-amber-200";
    case "red":
      return "bg-red-50 text-red-700 border-red-200";
    case "slate":
    default:
      return "bg-slate-50 text-slate-700 border-slate-200";
  }
}

// Today as YYYY-MM-DD in the user's local timezone — date-only strings
// don't have a UTC moment, so we compare local-calendar-day to
// local-calendar-day to avoid off-by-one near midnight.
function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function isoPlusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dd}`;
}

function computeTone(
  kind: CredentialKind,
  expiresAt: string | null,
): Tone {
  const today = todayIso();
  const horizon = isoPlusDays(60);
  if (expiresAt == null) {
    // No expiry recorded. Licenses/clearances are valid-by-default; for
    // kinds that typically renew, surface the absence as informational.
    if (TYPICALLY_EXPIRES.has(kind)) return "slate";
    return "emerald";
  }
  if (expiresAt < today) return "red";
  if (expiresAt <= horizon) return "amber";
  return "emerald";
}

function iconFor(kind: CredentialKind) {
  if (CLEARANCE_KINDS.has(kind)) return BadgeCheck;
  if (LICENSE_KINDS.has(kind)) return ShieldCheck;
  return BookOpen;
}

interface Props {
  credential: JobSeekerCredential;
  className?: string;
}

/**
 * CredentialBadge — one-line chip rendering of a single credential.
 *
 * The chip class shape mirrors the operator-tab status badge so the
 * seeker-facing surfaces share visual language with the facility
 * portal: rounded pill, hairline border, 10px medium label.
 *
 * Expiry tone:
 *   - red    → already expired
 *   - amber  → expires within 60 days
 *   - emerald→ valid (or no expiry on a kind that doesn't typically renew)
 *   - slate  → informational (no expiry recorded on a renewable kind)
 */
export function CredentialBadge({ credential, className }: Props) {
  const kind = credential.kind as CredentialKind;
  const Icon = iconFor(kind);
  const tone = computeTone(kind, credential.expiresAt ?? null);
  const displayName =
    kind === "OTHER"
      ? (credential.label?.trim() || CREDENTIAL_LABEL.OTHER)
      : CREDENTIAL_LABEL[kind] ?? kind;
  const today = todayIso();
  const titleSuffix =
    credential.expiresAt == null
      ? ""
      : credential.expiresAt < today
      ? ` · expired ${credential.expiresAt}`
      : ` · expires ${credential.expiresAt}`;
  return (
    <span
      title={`${displayName}${titleSuffix}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium",
        toneClasses(tone),
        className,
      )}
    >
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span>{displayName}</span>
    </span>
  );
}

/**
 * useCredentials — shared TanStack Query hook so the three+ consumer
 * sites (ProfileEditor section, ProfileEditor read-only chip strip,
 * DashboardPage strip, ExpressInterestButton preview) hit a single
 * cache entry. Pass `{ enabled: false }` to skip when no seeker is
 * signed in (avoids a redundant 401).
 */
export function useCredentials(opts: { enabled?: boolean } = {}) {
  return useQuery<JobSeekerCredential[]>({
    queryKey: ["/api/jobseeker/credentials"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 30000,
    enabled: opts.enabled ?? true,
  });
}
