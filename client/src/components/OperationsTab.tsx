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
import { Skeleton } from "@/components/ui/skeleton";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  Users, Pill, ClipboardList, AlertTriangle,
  UserPlus, Receipt, ShieldCheck, LayoutDashboard,
  MessageSquare, ChevronRight, AlertCircle,
} from "lucide-react";
import { ResidentsContent } from "@/pages/portal/ResidentsPage";
import { EmarContent } from "@/pages/portal/EmarPage";
import { IncidentsContent } from "@/pages/portal/IncidentsPage";
import { CrmContent } from "@/pages/portal/CrmPage";
import { BillingContent } from "@/pages/portal/BillingPage";
import { StaffContent } from "@/pages/portal/StaffPage";
import { ComplianceContent } from "@/pages/portal/CompliancePage";
import { NotesContent } from "@/pages/portal/NotesPage";
import OpsCalendar from "@/components/OpsCalendar";

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
  static getDerivedStateFromError(): SubViewEBState { return { hasError: true }; }
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
  // Day-scoped sub-views (currently just emar) read this to open on the
  // correct date when navigation comes from a calendar chip.
  const [subViewDate, setSubViewDate] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);

  const { data: envelope, isLoading, error } = useQuery<{ success: boolean; data: DashboardData } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/dashboard`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  // Shared query key with FacilityPortal Dashboard + NotesContent (filter=all)
  // → React Query dedupes; this is effectively free.
  const { data: notesEnvelope } = useQuery<
    { success: boolean; data: { items: Array<{ priority: "normal" | "urgent" }> } } | null
  >({
    queryKey: ["/api/ops/notes?status=open&limit=50"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 30_000,
  });
  const notesItems = notesEnvelope?.data?.items ?? [];
  const notesCount = notesItems.length;
  const hasUrgentNote = notesItems.some((n) => n.priority === "urgent");

  const data: DashboardData | null = envelope?.data ?? null;

  const goToSubView = (sv: string, date: string | null = null) => {
    setSubView(sv);
    setSubViewDate(date);
  };

  // Sub-view routing
  if (subView) {
    const back = () => { setSubView(null); setSubViewDate(null); };
    const content =
      subView === "residents"  ? <ResidentsContent  facilityNumber={facilityNumber} onBack={back} /> :
      subView === "emar"       ? <EmarContent       facilityNumber={facilityNumber} onBack={back} initialDate={subViewDate ?? undefined} /> :
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

  const kpiCards: KpiCardProps[] = data ? [
    { label: "Active Residents",   count: data.activeResidents,   icon: Users,        colorClass: "bg-green-100 text-green-700",                                                        borderClass: "border-l-green-500",                                                       onClick: () => goToSubView("residents")  },
    { label: "Pending Med Passes", count: data.pendingMedPasses,  icon: Pill,         colorClass: data.pendingMedPasses  > 0 ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700", borderClass: data.pendingMedPasses  > 0 ? "border-l-yellow-500" : "border-l-green-500", onClick: () => goToSubView("emar")       },
    { label: "Overdue Tasks",      count: data.overdueTasks,      icon: ClipboardList,colorClass: data.overdueTasks      > 0 ? "bg-red-100 text-red-700"       : "bg-green-100 text-green-700", borderClass: data.overdueTasks      > 0 ? "border-l-red-500"    : "border-l-green-500", onClick: () => goToSubView("residents")  },
    { label: "Open Incidents",     count: data.openIncidents,     icon: AlertTriangle,colorClass: data.openIncidents     > 0 ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700", borderClass: data.openIncidents     > 0 ? "border-l-orange-500" : "border-l-green-500", onClick: () => goToSubView("incidents") },
    { label: "Pending Leads",      count: data.pendingLeads,      icon: UserPlus,     colorClass: "bg-blue-100 text-blue-700",                                                          borderClass: "border-l-blue-500",                                                        onClick: () => goToSubView("crm")        },
    { label: "Overdue Invoices",   count: data.overdueInvoices,   icon: Receipt,      colorClass: data.overdueInvoices   > 0 ? "bg-red-100 text-red-700"       : "bg-green-100 text-green-700", borderClass: data.overdueInvoices   > 0 ? "border-l-red-500"    : "border-l-green-500", onClick: () => goToSubView("billing")   },
    { label: "Overdue Compliance", count: data.overdueCompliance, icon: ShieldCheck,  colorClass: data.overdueCompliance > 0 ? "bg-red-100 text-red-700"       : "bg-green-100 text-green-700", borderClass: data.overdueCompliance > 0 ? "border-l-red-500"    : "border-l-green-500", onClick: () => goToSubView("compliance")},
  ] : [];

  return (
    <div className="space-y-5">
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

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
          Failed to load dashboard data. Please try again.
        </div>
      )}

      {/* Notes — compact trigger card; full feed opens in a side sheet */}
      {facilityNumber && (
        <Sheet open={notesOpen} onOpenChange={setNotesOpen}>
          <SheetTrigger asChild>
            <button
              type="button"
              aria-label={
                notesCount > 0
                  ? `Open team notes — ${notesCount}${hasUrgentNote ? ", contains urgent" : ""}`
                  : "Open team notes"
              }
              className="w-full text-left rounded-xl border border-border bg-card p-3 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 transition-shadow flex items-center gap-3"
            >
              <div
                className={cn(
                  "h-9 w-9 rounded-full flex items-center justify-center shrink-0",
                  hasUrgentNote
                    ? "bg-red-100 text-red-600"
                    : "bg-indigo-100 text-indigo-700",
                )}
              >
                <MessageSquare className="h-4 w-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold">Team Notes</p>
                  {notesCount > 0 && (
                    <span
                      className={cn(
                        "inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-semibold",
                        hasUrgentNote
                          ? "bg-red-500 text-white"
                          : "bg-muted text-foreground/80 border border-border",
                      )}
                    >
                      {notesCount > 99 ? "99+" : notesCount}
                    </span>
                  )}
                  {hasUrgentNote && (
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium text-red-700">
                      <AlertCircle className="h-3 w-3" />
                      Urgent
                    </span>
                  )}
                </div>
                <p className="text-xs text-muted-foreground truncate">
                  {notesCount === 0
                    ? "No notes yet — open to post one."
                    : "View, post, or reply to team messages."}
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          </SheetTrigger>
          <SheetContent
            side="right"
            className="w-full sm:max-w-lg p-0 flex flex-col gap-0"
          >
            <SheetHeader className="px-6 py-4 border-b text-left space-y-1">
              <SheetTitle className="flex items-center gap-2 text-base">
                <MessageSquare className="h-4 w-4" />
                Team Notes
              </SheetTitle>
              <SheetDescription className="text-xs">
                Operational communication for Facility #{facilityNumber}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <NotesContent facilityNumber={facilityNumber} embedded />
            </div>
          </SheetContent>
        </Sheet>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-8">
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

      {/* Operations calendar — visible when on the overview */}
      {facilityNumber && (
        <OpsCalendar
          facilityNumber={facilityNumber}
          onNavigate={(sv, date) => {
            setSubView(sv);
            setSubViewDate(date ?? null);
          }}
        />
      )}
    </div>
  );
}