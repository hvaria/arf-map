/**
 * AuditorPage — Wave 3 Phase 3.2.
 *
 * Read-only auditor shell mounted at `/#/auditor/:token`. Validates the
 * bearer token via `GET /api/ops/auditor/me` and, on success, renders the
 * same Audit Readiness Overview + sub-tabs the facility admin sees but
 * wrapped in <AuditorProvider> so write-actions disappear and the cache
 * does not cross-pollinate with the admin session.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Hash-routing param extraction:
 *       client/src/pages/jobs/JobDetailPage.tsx:18-37
 *   - Dedicated full-page route shell + auth gate effect:
 *       client/src/pages/notes/NotesPage.tsx:42-100
 *   - Tabs + sub-view composition mirrors:
 *       client/src/components/operations/AuditReadinessContent.tsx:533-633
 *
 * Security:
 *   - Token lives in URL + memory only — never written to localStorage.
 *   - Every fetch attaches `Authorization: Bearer <token>` via a
 *     local helper; the server middleware logs each call.
 */
import { useMemo, useState, type ReactNode } from "react";
import { useRoute } from "wouter";
import { useQuery, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertCircle, Eye, History } from "lucide-react";
import {
  AuditorProvider,
  buildAuditorHeaders,
  type AuditorContextValue,
} from "@/context/AuditorContext";
import { DrillsContent } from "@/components/operations/DrillsContent";
import { TemperatureLogsContent } from "@/components/operations/TemperatureLogsContent";
import { VendorsContent } from "@/components/operations/VendorsContent";
import { ComplaintsContent } from "@/components/operations/ComplaintsContent";
import { InspectionsContent } from "@/components/operations/InspectionsContent";
import { AuditTrailViewer } from "@/components/operations/AuditTrailViewer";
import {
  AUDITOR_AUDIENCE_LABELS,
  type AuditorAudience,
} from "@shared/auditor";

// ── Wire shape for /api/ops/auditor/me ───────────────────────────────────────

interface AuditorMe {
  success: boolean;
  data: {
    facilityNumber: string;
    audience: AuditorAudience;
    audienceLabel?: string | null;
    expiresAt: number;
    facilityName?: string | null;
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtRelativeFuture(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "expired";
  const hours = Math.round(diff / 3_600_000);
  if (hours < 1) return "expires soon";
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function AuditorPage() {
  const [match, params] = useRoute<{ token: string }>("/auditor/:token");
  const token =
    match && params?.token ? decodeURIComponent(params.token) : null;

  // Dedicated QueryClient per auditor session so the cache is fully
  // isolated from any admin session that may also be open. We also keep
  // a short staleTime (30s) — auditors visit briefly and freshness matters.
  const qc = useMemo(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: false,
          },
          mutations: { retry: false },
        },
      }),
    [],
  );

  if (!token) {
    return <InvalidTokenScreen />;
  }

  return (
    <QueryClientProvider client={qc}>
      <AuditorShell token={token} />
    </QueryClientProvider>
  );
}

function AuditorShell({ token }: { token: string }) {
  const meQ = useQuery<AuditorMe | null>({
    queryKey: ["/api/ops/auditor/me", token],
    queryFn: async () => {
      const res = await fetch("/api/ops/auditor/me", {
        headers: buildAuditorHeaders(token),
      });
      if (res.status === 401 || res.status === 403 || res.status === 410) {
        return null;
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as AuditorMe;
    },
    staleTime: 30_000,
  });

  if (meQ.isLoading) {
    return (
      <div
        className="min-h-screen flex items-center justify-center p-6"
        data-testid="auditor-loading"
      >
        <div className="space-y-3 w-full max-w-md">
          <Skeleton className="h-10 w-full rounded-md" />
          <Skeleton className="h-32 w-full rounded-md" />
        </div>
      </div>
    );
  }

  if (meQ.isError || !meQ.data || !meQ.data.data) {
    return <ExpiredTokenScreen />;
  }

  const me = meQ.data.data;
  const value: AuditorContextValue = {
    token,
    facilityNumber: me.facilityNumber,
    expiresAt: me.expiresAt,
    audience: me.audience,
    audienceLabel: me.audienceLabel ?? undefined,
    readOnly: true,
  };

  return (
    <AuditorProvider value={value}>
      <AuditorChrome me={me}>
        <AuditorTabs facilityNumber={me.facilityNumber} />
      </AuditorChrome>
    </AuditorProvider>
  );
}

// ── Chrome ───────────────────────────────────────────────────────────────────

function AuditorChrome({
  me,
  children,
}: {
  me: AuditorMe["data"];
  children: ReactNode;
}) {
  const facilityLabel = me.facilityName ?? `Facility ${me.facilityNumber}`;
  return (
    <div className="min-h-screen bg-stone-50" data-testid="auditor-page">
      <header
        className="bg-white border-b sticky top-0 z-10"
        data-testid="auditor-header"
      >
        <div className="max-w-6xl mx-auto px-4 py-3 flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Eye className="h-4 w-4 text-indigo-600" aria-hidden />
              <h1
                className="text-base font-semibold truncate"
                style={{ color: "#1E1B4B" }}
              >
                {facilityLabel}
              </h1>
            </div>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Read-only auditor view — every action you take is logged.
            </p>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span
              className="inline-flex items-center px-2 py-0.5 rounded border bg-indigo-50 border-indigo-200 text-indigo-700 font-medium"
              data-testid="auditor-audience-chip"
            >
              {AUDITOR_AUDIENCE_LABELS[me.audience]}
              {me.audienceLabel ? ` · ${me.audienceLabel}` : ""}
            </span>
            <span
              className="inline-flex items-center px-2 py-0.5 rounded border bg-stone-50 border-stone-200 text-stone-700"
              title={new Date(me.expiresAt).toLocaleString()}
              data-testid="auditor-expires-chip"
            >
              Expires {fmtRelativeFuture(me.expiresAt)}
            </span>
          </div>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-4 py-5">{children}</main>
    </div>
  );
}

// ── Tabs (mirror AuditReadinessContent without Reg Settings) ────────────────

function AuditorTabs({ facilityNumber }: { facilityNumber: string }) {
  const [tab, setTab] = useState<string>("overview");
  return (
    <div className="portal-tabs">
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="w-full overflow-x-auto">
          <TabsTrigger value="overview" className="flex-1">
            Overview
          </TabsTrigger>
          <TabsTrigger value="drills" className="flex-1">
            Drills
          </TabsTrigger>
          <TabsTrigger value="logs" className="flex-1">
            Logs
          </TabsTrigger>
          <TabsTrigger value="vendors" className="flex-1">
            Vendors
          </TabsTrigger>
          <TabsTrigger value="complaints" className="flex-1">
            Complaints
          </TabsTrigger>
          <TabsTrigger value="inspections" className="flex-1">
            Inspections
          </TabsTrigger>
          <TabsTrigger
            value="audit-trail"
            className="flex-1"
            aria-label="Audit trail"
            data-testid="auditor-tab-audit-trail"
          >
            <History className="h-3.5 w-3.5 mr-1" />
            Audit trail
          </TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4">
          <AuditorOverview facilityNumber={facilityNumber} />
        </TabsContent>
        <TabsContent value="drills" className="mt-4">
          <DrillsContent facilityNumber={facilityNumber} />
        </TabsContent>
        <TabsContent value="logs" className="mt-4">
          <TemperatureLogsContent facilityNumber={facilityNumber} />
        </TabsContent>
        <TabsContent value="vendors" className="mt-4">
          <VendorsContent facilityNumber={facilityNumber} />
        </TabsContent>
        <TabsContent value="complaints" className="mt-4">
          <ComplaintsContent facilityNumber={facilityNumber} />
        </TabsContent>
        <TabsContent value="inspections" className="mt-4">
          <InspectionsContent facilityNumber={facilityNumber} />
        </TabsContent>
        <TabsContent value="audit-trail" className="mt-4">
          <AuditTrailViewer facilityNumber={facilityNumber} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Overview tile-grid for the auditor view ──────────────────────────────────

function AuditorOverview({ facilityNumber }: { facilityNumber: string }) {
  // We read the existing /api/ops/auditor/triage scoped endpoint so the
  // overview lights up the same KPI summary the admin sees, but read-only.
  // We bypass that here in v0 and let the sub-tabs do the heavy lifting —
  // a lightweight welcome panel covers the gap when the section reads
  // are still warming. Server contract for /triage is in flight.
  void facilityNumber;
  return (
    <div className="space-y-4">
      <section
        className="rounded-lg border bg-white p-4"
        data-testid="auditor-overview-welcome"
      >
        <h2 className="text-sm font-medium mb-1" style={{ color: "#1E1B4B" }}>
          Welcome
        </h2>
        <p className="text-xs text-muted-foreground">
          Use the tabs above to browse drills, temperature logs, vendors,
          complaints, inspections, and the audit trail. All data is read-only
          for the duration of this share link.
        </p>
      </section>
    </div>
  );
}

// ── Failure screens ──────────────────────────────────────────────────────────

function ExpiredTokenScreen() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 bg-stone-50"
      data-testid="auditor-expired"
    >
      <div className="max-w-md w-full rounded-lg border bg-white p-6 text-center">
        <AlertCircle
          className="h-8 w-8 text-amber-500 mx-auto mb-3"
          aria-hidden
        />
        <h1 className="text-base font-semibold" style={{ color: "#1E1B4B" }}>
          This link has expired or been revoked
        </h1>
        <p className="text-xs text-muted-foreground mt-2">
          Ask the facility for a new share link.
        </p>
      </div>
    </div>
  );
}

function InvalidTokenScreen() {
  return (
    <div
      className="min-h-screen flex items-center justify-center p-6 bg-stone-50"
      data-testid="auditor-invalid"
    >
      <div className="max-w-md w-full rounded-lg border bg-white p-6 text-center">
        <AlertCircle
          className="h-8 w-8 text-red-500 mx-auto mb-3"
          aria-hidden
        />
        <h1 className="text-base font-semibold" style={{ color: "#1E1B4B" }}>
          Invalid share link
        </h1>
        <p className="text-xs text-muted-foreground mt-2">
          The URL is missing a valid token. Ask the facility for a new link.
        </p>
      </div>
    </div>
  );
}
