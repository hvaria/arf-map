import { useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { queryClient } from "@/lib/queryClient";
import PortalLayout from "./PortalLayout";
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
} from "lucide-react";

interface SessionUser {
  id: number;
  facilityNumber: string;
  username: string;
}

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
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-6 w-10" />
          <Skeleton className="h-3 w-24" />
        </div>
      </CardContent>
    </Card>
  );
}

export default function PortalDashboard() {
  const [, navigate] = useLocation();

  const { data: me } = useQuery<SessionUser | null>({
    queryKey: ["/api/facility/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000,
  });

  const facilityNumber = me?.facilityNumber ?? "";

  const { data: envelope, isLoading, error } = useQuery<{ success: boolean; data: DashboardData } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/dashboard`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
  });

  useEffect(() => {
    if (me === null) navigate("/facility-portal");
  }, [me, navigate]);

  if (me === null) return null;

  const dashboard = envelope?.data ?? null;

  const kpiCards = dashboard
    ? [
        {
          label: "Active Residents",
          count: dashboard.activeResidents,
          icon: Users,
          colorClass: "bg-green-100 text-green-700",
          borderClass: "border-l-green-500",
        },
        {
          label: "Pending Med Passes",
          count: dashboard.pendingMedPasses,
          icon: Pill,
          colorClass:
            dashboard.pendingMedPasses > 0
              ? "bg-yellow-100 text-yellow-700"
              : "bg-green-100 text-green-700",
          borderClass:
            dashboard.pendingMedPasses > 0 ? "border-l-yellow-500" : "border-l-green-500",
        },
        {
          label: "Overdue Tasks",
          count: dashboard.overdueTasks,
          icon: ClipboardList,
          colorClass:
            dashboard.overdueTasks > 0
              ? "bg-red-100 text-red-700"
              : "bg-green-100 text-green-700",
          borderClass:
            dashboard.overdueTasks > 0 ? "border-l-red-500" : "border-l-green-500",
        },
        {
          label: "Open Incidents",
          count: dashboard.openIncidents,
          icon: AlertTriangle,
          colorClass:
            dashboard.openIncidents > 0
              ? "bg-red-100 text-red-700"
              : "bg-green-100 text-green-700",
          borderClass:
            dashboard.openIncidents > 0 ? "border-l-red-500" : "border-l-green-500",
        },
        {
          label: "Pending Leads",
          count: dashboard.pendingLeads,
          icon: UserPlus,
          colorClass:
            dashboard.pendingLeads > 0
              ? "bg-blue-100 text-blue-700"
              : "bg-green-100 text-green-700",
          borderClass:
            dashboard.pendingLeads > 0 ? "border-l-blue-500" : "border-l-green-500",
        },
        {
          label: "Overdue Invoices",
          count: dashboard.overdueInvoices,
          icon: Receipt,
          colorClass:
            dashboard.overdueInvoices > 0
              ? "bg-red-100 text-red-700"
              : "bg-green-100 text-green-700",
          borderClass:
            dashboard.overdueInvoices > 0 ? "border-l-red-500" : "border-l-green-500",
        },
        {
          label: "Overdue Compliance",
          count: dashboard.overdueCompliance,
          icon: ShieldCheck,
          colorClass:
            dashboard.overdueCompliance > 0
              ? "bg-orange-100 text-orange-700"
              : "bg-green-100 text-green-700",
          borderClass:
            dashboard.overdueCompliance > 0 ? "border-l-orange-500" : "border-l-green-500",
        },
      ]
    : [];

  return (
    <PortalLayout>
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-semibold">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Overview for Facility #{facilityNumber}
          </p>
        </div>

        {error && (
          <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
            Failed to load dashboard data. Please try again.
          </div>
        )}

        {/* KPI grid */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {isLoading
            ? Array.from({ length: 7 }).map((_, i) => <KpiSkeleton key={i} />)
            : kpiCards.map((card) => <KpiCard key={card.label} {...card} />)}
        </div>

        {/* Quick actions */}
        <div>
          <h2 className="text-sm font-medium mb-3">Quick Actions</h2>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              onClick={() => navigate("/portal/emar")}
            >
              <Pill className="h-4 w-4 mr-1.5" />
              Chart Medication
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/portal/incidents")}
            >
              <AlertTriangle className="h-4 w-4 mr-1.5" />
              Add Incident
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => navigate("/portal/crm")}
            >
              <UserPlus className="h-4 w-4 mr-1.5" />
              Add Lead
            </Button>
          </div>
        </div>
      </div>
    </PortalLayout>
  );
}
