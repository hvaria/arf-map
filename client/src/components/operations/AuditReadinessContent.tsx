/**
 * AuditReadinessContent — top-level sub-view for the audit-readiness hub.
 *
 * Wave 0 mounted the hub with placeholder tabs + Reg Settings. Wave 1 (B12)
 * replaces the placeholders with real sub-views: Drills (B5), Logs (B3),
 * Vendors (B7), Complaints (B9), Inspections (B11). The Overview tab is
 * enriched with cross-cutting KPI tiles — early shape of the Wave 3 W1 daily
 * triage; kept lightweight (small `limit` reads against the same list
 * endpoints the sub-views use, so the cache is shared).
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - portal-tabs shell + shadcn <Tabs>:        StaffContent.tsx:386-391
 *   - Page heading style:                        ComplianceContent.tsx:281
 *   - Summary tile grid + tone palette:          ComplianceContent.tsx:289-302 + EmarContent.tsx:55-62
 *   - Loading skeletons:                         ComplianceContent.tsx:311-313
 *
 * Sub-views imported (Wave 1):
 *   DrillsContent          B5
 *   TemperatureLogsContent B3
 *   VendorsContent         B7
 *   ComplaintsContent      B9
 *   InspectionsContent     B11
 *
 * Wave 2 additions:
 *   - 7th Overview tile "Charts incomplete" (W8) — reads
 *     /api/ops/facilities/:fn/chart-completeness?worst=missing&limit=1.
 *   - New "Audit trail" tab next to Reg Settings (⚙) renders the W15
 *     <AuditTrailViewer> facility-wide filter explorer.
 *
 * Wave 2 finale (obligation engine):
 *   - 8th Overview tile "Overdue obligations" — reads
 *     /api/ops/facilities/:fn/obligations?overdueOnly=true&limit=1 and
 *     consumes `meta.total` for the count. Tone: emerald=0, amber=1-4,
 *     red=5+. Informational v0 (cross-sub-view nav deferred to Wave 4).
 *
 * Reg Settings (⚙) tab stays intact — Wave 0 A11.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ShieldCheck,
  ArrowLeft,
  Settings,
  MessageSquare,
  Thermometer,
  Building2,
  Siren,
  ClipboardCheck,
  History,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { RegSettingsContent } from "@/components/operations/RegSettingsContent";
import { DrillsContent } from "@/components/operations/DrillsContent";
import { TemperatureLogsContent } from "@/components/operations/TemperatureLogsContent";
import { VendorsContent } from "@/components/operations/VendorsContent";
import { ComplaintsContent } from "@/components/operations/ComplaintsContent";
import { InspectionsContent } from "@/components/operations/InspectionsContent";
import { AuditTrailViewer } from "@/components/operations/AuditTrailViewer";

interface Props {
  facilityNumber: string;
  onBack?: () => void;
}

// ── Minimal shapes mirrored from sub-views (kept local to avoid coupling) ────

interface ComplaintLite {
  status: "open" | "investigating" | "resolved" | "closed";
}
interface TempLogLite {
  outOfRange: number | boolean;
  resolvedAt?: number | null;
  readingAt: number;
}
interface VendorLite {
  status: string;
  coiExpires: number | null;
}
interface DrillLite {
  executedAt: number;
}
interface CredentialExpiringLite {
  id: number;
  staffId: number;
  credentialType: string;
  expiresAt: number | null;
}
// W4 — past-SLA shape is minimal; tile reads `.length`.
interface IncidentPastSlaLite {
  id: number;
}

// ── Overview tab ──────────────────────────────────────────────────────────────

function isToday(ms: number): boolean {
  const d = new Date(ms);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function quarterOf(ms: number): { year: number; quarter: number } {
  const d = new Date(ms);
  return { year: d.getFullYear(), quarter: Math.floor(d.getMonth() / 3) + 1 };
}

function Tile({
  label,
  value,
  tone,
  loading,
  hint,
}: {
  label: string;
  value: string | number;
  tone: "indigo" | "amber" | "red" | "emerald" | "stone";
  loading?: boolean;
  hint?: string;
}) {
  const cls: Record<typeof tone, string> = {
    indigo: "bg-indigo-50 border-indigo-200 text-indigo-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    red: "bg-red-50 border-red-200 text-red-700",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    stone: "bg-stone-50 border-stone-200 text-stone-700",
  };
  return (
    <div className={cn("rounded-lg border p-3 text-center", cls[tone])}>
      {loading ? (
        <Skeleton className="h-6 w-12 mx-auto" />
      ) : (
        <p className="text-xl font-bold portal-num">{value}</p>
      )}
      <p className="text-xs">{label}</p>
      {hint && <p className="text-[10px] opacity-70 mt-0.5">{hint}</p>}
    </div>
  );
}

function OverviewTab({
  facilityNumber,
  onOpenSettings,
  onSwitchTab,
}: {
  facilityNumber: string;
  onOpenSettings: () => void;
  onSwitchTab: (tab: string) => void;
}) {
  const complaintsQ = useQuery<{ success: boolean; data: ComplaintLite[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/complaints`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });
  const tempLogsQ = useQuery<{ success: boolean; data: TempLogLite[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/temp-logs`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });
  const vendorsQ = useQuery<{ success: boolean; data: VendorLite[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/vendors?expiringWithinDays=60&page=1&limit=20`],
    queryFn: async () => {
      const res = await fetch(
        `/api/ops/facilities/${facilityNumber}/vendors?expiringWithinDays=60&page=1&limit=20`,
        { credentials: "include" },
      );
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });
  const drillsQ = useQuery<{ success: boolean; data: DrillLite[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/drills`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });
  // W4 Wave 2 — open incidents past their SLA (CCLD verbal / LIC 624 / SOC 341).
  // Tile is informational v0 — cross-sub-view nav still deferred to Wave 4.
  const incidentsPastSlaQ = useQuery<{ success: boolean; data: IncidentPastSlaLite[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/incidents/past-sla?limit=50`],
    queryFn: async () => {
      const res = await fetch(
        `/api/ops/facilities/${facilityNumber}/incidents/past-sla?limit=50`,
        { credentials: "include" },
      );
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  // W8 Wave 2 — residents with an incomplete chart. Reads the list endpoint
  // with `worst=missing&limit=1`; we only need `total` for the tile count.
  // The "Charts incomplete" tile is informational v0 (cross-sub-view nav to
  // Residents lives in OperationsTab.tsx and is wired in Wave 4).
  const chartsIncompleteQ = useQuery<{
    success: boolean;
    data: { total: number };
  } | null>({
    queryKey: [
      `/api/ops/facilities/${facilityNumber}/chart-completeness?worst=missing&limit=1`,
    ],
    queryFn: async () => {
      const res = await fetch(
        `/api/ops/facilities/${facilityNumber}/chart-completeness?worst=missing&limit=1`,
        { credentials: "include" },
      );
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  // Wave 2 finale — overdue obligations. We only need the count; the
  // list endpoint exposes `meta.total` independent of `limit`, so we
  // pass limit=1 to keep payload tiny.
  const overdueObligationsQ = useQuery<{
    success: boolean;
    data: unknown[];
    meta?: { total: number };
  } | null>({
    queryKey: [
      `/api/ops/facilities/${facilityNumber}/obligations?overdueOnly=true&limit=1`,
    ],
    queryFn: async () => {
      const res = await fetch(
        `/api/ops/facilities/${facilityNumber}/obligations?overdueOnly=true&limit=1`,
        { credentials: "include" },
      );
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!facilityNumber,
    staleTime: 30_000,
  });

  // W3 Wave 2 — credentials expiring within 60 days (warning + expired).
  // includeExpired=true so the tile reflects any past-due credential too.
  const credentialsQ = useQuery<{ success: boolean; data: CredentialExpiringLite[] } | null>({
    queryKey: [
      `/api/ops/facilities/${facilityNumber}/credentials/expiring?withinDays=60&includeExpired=true`,
    ],
    queryFn: async () => {
      const res = await fetch(
        `/api/ops/facilities/${facilityNumber}/credentials/expiring?withinDays=60&includeExpired=true`,
        { credentials: "include" },
      );
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const openComplaints = (complaintsQ.data?.data ?? []).filter(
    (c) => c.status === "open" || c.status === "investigating",
  ).length;
  const oorToday = (tempLogsQ.data?.data ?? []).filter(
    (l) => l.outOfRange && !l.resolvedAt && isToday(l.readingAt),
  ).length;
  const vendorsExpiring = (vendorsQ.data?.data ?? []).filter((v) => {
    if (v.status !== "active" || v.coiExpires === null) return false;
    const days = Math.ceil((v.coiExpires - Date.now()) / (24 * 60 * 60 * 1000));
    return days >= 0 && days <= 60;
  }).length;

  const currentQ = useMemo(() => quarterOf(Date.now()), []);
  const drillsThisQuarter = (drillsQ.data?.data ?? []).filter((d) => {
    const q = quarterOf(d.executedAt);
    return q.year === currentQ.year && q.quarter === currentQ.quarter;
  }).length;

  // W4 — incidents past SLA tile tone: emerald=0, amber=1+, red=3+.
  const pastSlaRows = incidentsPastSlaQ.data?.data ?? [];
  const pastSlaCount = pastSlaRows.length;
  const pastSlaTone: "emerald" | "amber" | "red" =
    pastSlaCount === 0 ? "emerald" : pastSlaCount >= 3 ? "red" : "amber";

  // W8 — charts-incomplete tile tone: emerald=0, amber=1+.
  const chartsIncompleteCount = chartsIncompleteQ.data?.data?.total ?? 0;
  const chartsIncompleteTone: "emerald" | "amber" =
    chartsIncompleteCount === 0 ? "emerald" : "amber";

  // Wave 2 finale — overdue obligations tile tone: emerald=0, amber=1-4,
  // red=5+. The list endpoint guarantees a `meta.total` even when the
  // `data` array is capped by `limit`.
  const overdueObligationsCount = overdueObligationsQ.data?.meta?.total ?? 0;
  const overdueObligationsTone: "emerald" | "amber" | "red" =
    overdueObligationsCount === 0
      ? "emerald"
      : overdueObligationsCount >= 5
      ? "red"
      : "amber";

  // Credentials tile: red if any are already expired, amber if any are
  // expiring within 60d, emerald otherwise.
  const credRows = credentialsQ.data?.data ?? [];
  const nowMs = Date.now();
  const credentialsExpired = credRows.filter(
    (r) => r.expiresAt !== null && r.expiresAt < nowMs,
  ).length;
  const credentialsExpiringCount = credRows.length;
  const credentialsTone: "red" | "amber" | "emerald" =
    credentialsExpired > 0 ? "red" : credentialsExpiringCount > 0 ? "amber" : "emerald";

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-dashed p-5">
        <ShieldCheck className="h-7 w-7 mx-auto text-muted-foreground mb-3" />
        <h2 className="text-base font-medium text-center mb-1">
          Welcome to Audit Readiness
        </h2>
        <p className="text-sm text-muted-foreground text-center max-w-xl mx-auto">
          Use this hub to keep your inspection binder healthy day to day.
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-8 gap-3" data-testid="audit-overview-tiles">
        <button
          onClick={() => onSwitchTab("complaints")}
          className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
          aria-label="View open complaints"
        >
          <Tile
            label="Open complaints"
            value={openComplaints}
            tone={openComplaints > 0 ? "red" : "emerald"}
            loading={complaintsQ.isLoading}
          />
        </button>
        <button
          onClick={() => onSwitchTab("logs")}
          className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
          aria-label="View out-of-range readings"
        >
          <Tile
            label="Out-of-range readings today"
            value={oorToday}
            tone={oorToday > 0 ? "red" : "emerald"}
            loading={tempLogsQ.isLoading}
          />
        </button>
        <button
          onClick={() => onSwitchTab("vendors")}
          className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
          aria-label="View vendors expiring within 60 days"
        >
          <Tile
            label="Vendors expiring within 60d"
            value={vendorsExpiring}
            tone={vendorsExpiring > 0 ? "amber" : "stone"}
            loading={vendorsQ.isLoading}
          />
        </button>
        <button
          onClick={() => onSwitchTab("drills")}
          className="text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-lg"
          aria-label="View drills this quarter"
        >
          <Tile
            label="Drills this quarter"
            value={drillsThisQuarter}
            tone="indigo"
            loading={drillsQ.isLoading}
          />
        </button>
        {/*
          W3 — Credentials tile. Informational-only for v0: there is no clean
          cross-sub-view nav primitive that can jump Operations → Staff →
          Credentials from here. Wave 4 follow-up will wire the existing
          `setActiveTab` / `goToSubView` in OperationsTab.tsx so this tile
          becomes navigable like the others.
        */}
        <div
          aria-label="Credentials expiring within 60 days (informational)"
          data-testid="audit-overview-credentials-tile"
        >
          <Tile
            label="Credentials expiring (60d)"
            value={credentialsExpiringCount}
            tone={credentialsTone}
            loading={credentialsQ.isLoading}
            hint={credentialsExpired > 0 ? `${credentialsExpired} already expired` : undefined}
          />
        </div>
        {/*
          W4 — Open incidents past SLA. Informational-only for v0; same
          rationale as the Credentials tile. Wave 4 will route to Operations →
          Incidents filtered by past-SLA via OperationsTab's setActiveTab.
        */}
        <div
          aria-label="Open incidents past SLA (informational)"
          data-testid="audit-overview-incidents-past-sla-tile"
        >
          <Tile
            label="Open incidents past SLA"
            value={pastSlaCount}
            tone={pastSlaTone}
            loading={incidentsPastSlaQ.isLoading}
          />
        </div>
        {/*
          W8 — Charts incomplete tile. Reads the W8 list endpoint with
          worst=missing&limit=1 (we only need the `total`). Informational-only
          for v0 — cross-sub-view nav to Operations → Residents is wired in
          Wave 4, same as the other tiles flagged above.
        */}
        <div
          aria-label="Residents with incomplete charts (informational)"
          data-testid="audit-overview-charts-incomplete-tile"
        >
          <Tile
            label="Charts incomplete"
            value={chartsIncompleteCount}
            tone={chartsIncompleteTone}
            loading={chartsIncompleteQ.isLoading}
          />
        </div>
        {/*
          Wave 2 finale — Overdue obligations. Reads the obligation engine's
          list endpoint with overdueOnly=true&limit=1 and consumes
          `meta.total`. Informational-only v0; Wave 4 will route the tile
          to Operations → Compliance via OperationsTab's setActiveTab.
        */}
        <div
          aria-label="Overdue obligations (informational)"
          data-testid="audit-overview-overdue-obligations-tile"
        >
          <Tile
            label="Overdue obligations"
            value={overdueObligationsCount}
            tone={overdueObligationsTone}
            loading={overdueObligationsQ.isLoading}
          />
        </div>
      </div>

      <div className="rounded-lg border bg-stone-50 p-4">
        <p className="text-sm text-muted-foreground mb-3">Jump to:</p>
        <div className="flex flex-wrap gap-2 text-xs">
          <button
            onClick={() => onSwitchTab("drills")}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-white hover:bg-stone-100 transition-colors"
          >
            <Siren className="h-3.5 w-3.5" />
            Drills
          </button>
          <button
            onClick={() => onSwitchTab("logs")}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-white hover:bg-stone-100 transition-colors"
          >
            <Thermometer className="h-3.5 w-3.5" />
            Temperature logs
          </button>
          <button
            onClick={() => onSwitchTab("vendors")}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-white hover:bg-stone-100 transition-colors"
          >
            <Building2 className="h-3.5 w-3.5" />
            Vendors
          </button>
          <button
            onClick={() => onSwitchTab("complaints")}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-white hover:bg-stone-100 transition-colors"
          >
            <MessageSquare className="h-3.5 w-3.5" />
            Complaints
          </button>
          <button
            onClick={() => onSwitchTab("inspections")}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border bg-white hover:bg-stone-100 transition-colors"
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            Inspections
          </button>
        </div>
      </div>

      <div className="text-right">
        <button
          onClick={onOpenSettings}
          className="text-sm font-medium text-primary hover:underline"
        >
          Open Reg Settings ⚙
        </button>
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export function AuditReadinessContent({ facilityNumber, onBack }: Props) {
  const [tab, setTab] = useState<string>("overview");

  return (
    <div className="space-y-4">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Overview
        </button>
      )}

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold" style={{ color: "#1E1B4B" }}>
          Audit Readiness
        </h1>
      </div>

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
              data-testid="audit-readiness-tab-audit-trail"
            >
              <History className="h-3.5 w-3.5 mr-1" />
              Audit trail
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="flex-1"
              aria-label="Reg Settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="mt-4">
            <OverviewTab
              facilityNumber={facilityNumber}
              onOpenSettings={() => setTab("settings")}
              onSwitchTab={setTab}
            />
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

          <TabsContent value="settings" className="mt-4">
            <RegSettingsContent facilityNumber={facilityNumber} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
