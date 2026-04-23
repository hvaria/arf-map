/**
 * OperationsTab — rendered as the 4th tab inside FacilityPortal.
 *
 * Intentionally has NO PortalLayout wrapper and NO auth guard.
 * Auth is already enforced by FacilityPortal before this component mounts.
 * facilityNumber is passed as a prop so we never re-fetch the session here.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
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
  CalendarDays,
} from "lucide-react";

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
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function KpiCard({ label, count, icon: Icon, colorClass, borderClass }: KpiCardProps) {
  return (
    <Card className={cn("border-l-4", borderClass)}>
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

// ── Module nav links ───────────────────────────────────────────────────────────

const MODULE_LINKS = [
  { href: "/portal/residents", label: "Residents", icon: Users },
  { href: "/portal/emar",      label: "eMAR",      icon: Pill },
  { href: "/portal/incidents", label: "Incidents",  icon: AlertTriangle },
  { href: "/portal/crm",       label: "CRM",        icon: UserPlus },
  { href: "/portal/billing",   label: "Billing",    icon: Receipt },
  { href: "/portal/staff",     label: "Staff",      icon: CalendarDays },
  { href: "/portal/compliance",label: "Compliance", icon: ShieldCheck },
];

// ── Main component ─────────────────────────────────────────────────────────────

export default function OperationsTab({ facilityNumber }: { facilityNumber: string }) {
  // The ops API wraps responses as { success, data }. We unwrap here so the
  // rest of the component works with the flat DashboardData object.
  const { data: envelope, isLoading, error } = useQuery<{ success: boolean; data: DashboardData } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/dashboard`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000, // 1 minute
  });

  const data: DashboardData | null = envelope?.data ?? null;

  const kpiCards: KpiCardProps[] = data
    ? [
        {
          label: "Active Residents",
          count: data.activeResidents,
          icon: Users,
          colorClass: "bg-green-100 text-green-700",
          borderClass: "border-l-green-500",
        },
        {
          label: "Pending Med Passes",
          count: data.pendingMedPasses,
          icon: Pill,
          colorClass: data.pendingMedPasses > 0 ? "bg-yellow-100 text-yellow-700" : "bg-green-100 text-green-700",
          borderClass: data.pendingMedPasses > 0 ? "border-l-yellow-500" : "border-l-green-500",
        },
        {
          label: "Overdue Tasks",
          count: data.overdueTasks,
          icon: ClipboardList,
          colorClass: data.overdueTasks > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700",
          borderClass: data.overdueTasks > 0 ? "border-l-red-500" : "border-l-green-500",
        },
        {
          label: "Open Incidents",
          count: data.openIncidents,
          icon: AlertTriangle,
          colorClass: data.openIncidents > 0 ? "bg-orange-100 text-orange-700" : "bg-green-100 text-green-700",
          borderClass: data.openIncidents > 0 ? "border-l-orange-500" : "border-l-green-500",
        },
        {
          label: "Pending Leads",
          count: data.pendingLeads,
          icon: UserPlus,
          colorClass: "bg-blue-100 text-blue-700",
          borderClass: "border-l-blue-500",
        },
        {
          label: "Overdue Invoices",
          count: data.overdueInvoices,
          icon: Receipt,
          colorClass: data.overdueInvoices > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700",
          borderClass: data.overdueInvoices > 0 ? "border-l-red-500" : "border-l-green-500",
        },
        {
          label: "Overdue Compliance",
          count: data.overdueCompliance,
          icon: ShieldCheck,
          colorClass: data.overdueCompliance > 0 ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700",
          borderClass: data.overdueCompliance > 0 ? "border-l-red-500" : "border-l-green-500",
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-2">
        <LayoutDashboard className="h-5 w-5 text-muted-foreground" />
        <div>
          <h2 className="text-base font-semibold leading-tight">Operations Overview</h2>
          <p className="text-xs text-muted-foreground">Facility #{facilityNumber}</p>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
          Failed to load dashboard data. Please try again.
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 gap-3">
        {isLoading
          ? Array.from({ length: 7 }).map((_, i) => <KpiSkeleton key={i} />)
          : kpiCards.length > 0
            ? kpiCards.map((card) => <KpiCard key={card.label} {...card} />)
            : (
              <div className="col-span-2 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                {!facilityNumber
                  ? "Facility not found. Please log out and back in."
                  : "Could not load operations data. Try refreshing the page."}
              </div>
            )}
      </div>

      {/* Module navigation */}
      <div>
        <h3 className="text-sm font-medium mb-3">Modules</h3>
        <div className="grid grid-cols-2 gap-2">
          {MODULE_LINKS.map(({ href, label, icon: Icon }) => (
            <Link key={href} href={href}>
              <a className="flex items-center gap-2.5 rounded-lg border px-3 py-3 text-sm font-medium hover:bg-muted/50 transition-colors">
                <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                {label}
              </a>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
