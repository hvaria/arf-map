/**
 * OperationsTab — rendered as the 4th tab inside FacilityPortal.
 *
 * Intentionally has NO PortalLayout wrapper and NO auth guard.
 * Auth is already enforced by FacilityPortal before this component mounts.
 * facilityNumber is passed as a prop so we never re-fetch the session here.
 */
import { useState } from "react";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  Users,
  Pill,
  ClipboardList,
  AlertTriangle,
  UserPlus,
  Receipt,
  ShieldCheck,
  LayoutDashboard,
} from "lucide-react";
import { ResidentsContent } from "@/pages/portal/ResidentsPage";
import { EmarContent } from "@/pages/portal/EmarPage";
import { IncidentsContent } from "@/pages/portal/IncidentsPage";
import { CrmContent } from "@/pages/portal/CrmPage";
import { BillingContent } from "@/pages/portal/BillingPage";
import { StaffContent } from "@/pages/portal/StaffPage";
import { ComplianceContent } from "@/pages/portal/CompliancePage";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DashboardData {
  activeResidents: number;
  pendingMedPasses: number;
  overdueTasks: number;
  openIncidents: number;
  pendingLeads: number;
  overdueInvoices: number;
  overdueCompliance: number;
}

interface KpiCardProps {
  label: string;
  count: number;
  icon: React.ElementType;
  colorClass: string;
  borderClass: string;
  onClick: () => void;
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiCard({ label, count, icon: Icon, colorClass, borderClass, onClick }: KpiCardProps) {
  return (
    <button className="block w-full text-left" onClick={onClick}>
      <Card className={cn("border-l-4 hover:shadow-md transition-shadow cursor-pointer", borderClass)} style={{ background: '#F0F4FF' }}>
        <CardContent className="p-4 flex items-center gap-3">
          <div className={cn("h-10 w-10 rounded-full flex items-center justify-center shrink-0", colorClass)}>
            <Icon className="h-5 w-5" />
          </div>
          <div>
            <p className="text-2xl font-bold">{count}</p>
            <p className="text-xs text-muted-foreground leading-tight">{label}</p>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

function KpiSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full shrink-0" />
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-10" />
          <Skeleton className="h-3 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Sub-view error boundary ────────────────────────────────────────────────────

interface SubViewEBState { hasError: boolean }

class SubViewErrorBoundary extends React.Component<
  { onBack: () => void; children: React.ReactNode },
  SubViewEBState
> {
  constructor(props: { onBack: () => void; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): SubViewEBState {
    return { hasError: true };
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="space-y-4">
          <button
            onClick={() => { this.setState({ hasError: false }); this.props.onBack(); }}
            className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back to Overview
          </button>
          <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
            Something went wrong loading this section. Please go back and try again.
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function OperationsTab({ facilityNumber }: { facilityNumber: string }) {
  const [subView, setSubView] = useState<string | null>(null);

  const { data: envelope, isLoading, error } = useQuery<{ success: boolean; data: DashboardData } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/dashboard`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const data: DashboardData | null = envelope?.data ?? null;

  // Sub-view routing — render inline content instead of navigating
  if (subView) {
    const back = () => setSubView(null);
    const content =
      subView === "residents"  ? <ResidentsContent  facilityNumber={facilityNumber} onBack={back} /> :
      subView === "emar"       ? <EmarContent       facilityNumber={facilityNumber} onBack={back} /> :
      subView === "incidents"  ? <IncidentsContent  facilityNumber={facilityNumber} onBack={back} /> :
      subView === "crm"        ? <CrmContent        facilityNumber={facilityNumber} onBack={back} /> :
      subView === "billing"    ? <BillingContent    facilityNumber={facilityNumber} onBack={back} /> :
      subView === "staff"      ? <StaffContent      facilityNumber={facilityNumber} onBack={back} /> :
      subView === "compliance" ? <ComplianceContent facilityNumber={facilityNumber} onBack={back} /> :
      null;
    if (content) {
      return (
        <SubViewErrorBoundary key={subView} onBack={back}>
          {content}
        </SubViewErrorBoundary>
      );
    }
  }

  const kpiCards: KpiCardProps[] = data
    ? [
        {
          label: "Active Residents",
          count: data.activeResidents,
          icon: Users,
          colorClass: "bg-green-100 text-green-700",
          borderClass: "border-l-green-500",
          onClick: () => setSubView("residents"),
        },
        {
          label: "Pending Med Passes",
          count: data.pendingMedPasses,
          icon: Pill,
          colorClass: data.pendingMedPasses > 0 ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700",
          borderClass: data.pendingMedPasses > 0 ? "border-l-yellow-500" : "border-l-green-500",
          onClick: () => setSubView("emar"),
        },
        {
          label: "Overdue Tasks",
          count: data.overdueTasks,
          icon: ClipboardList,
          colorClass: data.overdueTasks > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700",
          borderClass: data.overdueTasks > 0 ? "border-l-red-500" : "border-l-green-500",
          onClick: () => setSubView("residents"),
        },
        {
          label: "Open Incidents",
          count: data.openIncidents,
          icon: AlertTriangle,
          colorClass: data.openIncidents > 0 ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700",
          borderClass: data.openIncidents > 0 ? "border-l-orange-500" : "border-l-green-500",
          onClick: () => setSubView("incidents"),
        },
        {
          label: "Pending Leads",
          count: data.pendingLeads,
          icon: UserPlus,
          colorClass: "bg-blue-100 text-blue-700",
          borderClass: "border-l-blue-500",
          onClick: () => setSubView("crm"),
        },
        {
          label: "Overdue Invoices",
          count: data.overdueInvoices,
          icon: Receipt,
          colorClass: data.overdueInvoices > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700",
          borderClass: data.overdueInvoices > 0 ? "border-l-red-500" : "border-l-green-500",
          onClick: () => setSubView("billing"),
        },
        {
          label: "Overdue Compliance",
          count: data.overdueCompliance,
          icon: ShieldCheck,
          colorClass: data.overdueCompliance > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700",
          borderClass: data.overdueCompliance > 0 ? "border-l-red-500" : "border-l-green-500",
          onClick: () => setSubView("compliance"),
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div
        className="flex items-center gap-2 px-4 py-3 rounded-xl"
        style={{ background: 'linear-gradient(120deg, #EEF2FF 0%, #FFF0F6 100%)', border: '1px solid #E0E7FF' }}
      >
        <LayoutDashboard className="h-5 w-5" style={{ color: '#818CF8' }} />
        <div>
          <h2 className="text-base font-semibold leading-tight" style={{ color: '#1E1B4B' }}>Operations Overview</h2>
          <p className="text-xs" style={{ color: '#6B7280' }}>Facility #{facilityNumber}</p>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
          Failed to load dashboard data. Please try again.
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {isLoading
          ? Array.from({ length: 7 }).map((_, i) => <KpiSkeleton key={i} />)
          : kpiCards.length > 0
            ? kpiCards.map((card) => <KpiCard key={card.label} {...card} />)
            : (
              <div className="col-span-2 md:col-span-4 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                {!facilityNumber
                  ? "Facility not found. Please log out and back in."
                  : "Could not load operations data. Try refreshing the page."}
              </div>
            )}
      </div>

      {/* Quick Actions */}
      <div>
        <h3 className="text-sm font-medium mb-3">Quick Actions</h3>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => setSubView("emar")}
            className="text-white border-0"
            style={{ background: 'linear-gradient(135deg, #818CF8, #F9A8D4)', borderRadius: '10px', backgroundColor: '#818CF8' }}
          >
            <Pill className="h-4 w-4 mr-1.5" />
            Chart Medication
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSubView("incidents")}>
            <AlertTriangle className="h-4 w-4 mr-1.5" />
            Add Incident
          </Button>
          <Button size="sm" variant="outline" onClick={() => setSubView("crm")}>
            <UserPlus className="h-4 w-4 mr-1.5" />
            Add Lead
          </Button>
        </div>
      </div>
    </div>
  );
}
