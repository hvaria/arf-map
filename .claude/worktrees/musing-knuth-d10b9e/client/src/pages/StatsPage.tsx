import { useQuery } from "@tanstack/react-query";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from "recharts";
import { Building2, MapPin, Activity, Briefcase, ArrowLeft, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import type { FacilitiesMeta } from "@shared/schema";

const GROUP_COLORS: Record<string, string> = {
  "Adult & Senior Care": "#0ea5e9",
  "Child Care": "#22c55e",
  "Children's Residential": "#a855f7",
  "Home Care": "#f97316",
};

const STATUS_COLORS: Record<string, string> = {
  LICENSED: "#22c55e",
  PENDING: "#f59e0b",
  "ON PROBATION": "#a855f7",
  CLOSED: "#ef4444",
  REVOKED: "#991b1b",
};

export default function StatsPage() {
  const { data: meta, isLoading, refetch, dataUpdatedAt } = useQuery<FacilitiesMeta>({
    queryKey: ["/api/facilities/meta"],
    staleTime: 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });

  const lastUpdated = meta?.lastUpdated
    ? new Date(meta.lastUpdated).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  // Top 15 counties by count
  const topCounties = meta
    ? Object.entries(meta.countByCounty)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 15)
        .map(([name, count]) => ({ name, count }))
    : [];

  // Facility type breakdown (top 12)
  const topTypes = meta
    ? Object.entries(meta.countByType)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 12)
        .map(([name, count]) => ({ name: shortenType(name), full: name, count }))
    : [];

  // Status pie
  const statusPie = meta
    ? Object.entries(meta.countByStatus)
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value }))
    : [];

  // Group pie
  const groupPie = meta
    ? Object.entries(meta.countByGroup)
        .sort((a, b) => b[1] - a[1])
        .map(([name, value]) => ({ name, value }))
    : [];

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center gap-3">
          <a href="/#/">
            <Button variant="ghost" size="sm" className="gap-1.5 -ml-2">
              <ArrowLeft className="h-4 w-4" />
              Map
            </Button>
          </a>
          <Separator orientation="vertical" className="h-5" />
          <div className="flex items-center gap-2">
            <BarChart2Icon className="h-4 w-4 text-primary" />
            <h1 className="text-sm font-semibold">California CCLD Statistics</h1>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {lastUpdated && (
              <span className="text-xs text-muted-foreground hidden sm:block">
                Data: {lastUpdated}
              </span>
            )}
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => refetch()}>
              <RefreshCw className="h-3.5 w-3.5" />
              Refresh
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 space-y-8">
        {/* KPI row */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="h-24 rounded-xl bg-muted animate-pulse" />
            ))}
          </div>
        ) : meta ? (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <KpiCard
              icon={Building2}
              label="Total Facilities"
              value={meta.totalCount.toLocaleString()}
              color="text-primary"
            />
            <KpiCard
              icon={Activity}
              label="Licensed"
              value={(meta.countByStatus["LICENSED"] ?? 0).toLocaleString()}
              sub={`${Math.round(((meta.countByStatus["LICENSED"] ?? 0) / meta.totalCount) * 100)}%`}
              color="text-green-600 dark:text-green-400"
            />
            <KpiCard
              icon={MapPin}
              label="Counties Covered"
              value={meta.counties.length.toLocaleString()}
              color="text-blue-600 dark:text-blue-400"
            />
            <KpiCard
              icon={Briefcase}
              label="Facility Types"
              value={meta.facilityTypes.length.toLocaleString()}
              color="text-purple-600 dark:text-purple-400"
            />
          </div>
        ) : null}

        {/* Group breakdown + Status pie */}
        <div className="grid md:grid-cols-2 gap-6">
          <ChartCard title="By Facility Group">
            <div className="space-y-2">
              {groupPie.map(({ name, value }) => {
                const pct = meta ? Math.round((value / meta.totalCount) * 100) : 0;
                return (
                  <div key={name}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="font-medium" style={{ color: GROUP_COLORS[name] ?? "#6b7280" }}>
                        {name}
                      </span>
                      <span className="text-muted-foreground">
                        {value.toLocaleString()} <span className="opacity-60">({pct}%)</span>
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${pct}%`,
                          backgroundColor: GROUP_COLORS[name] ?? "#6b7280",
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </ChartCard>

          <ChartCard title="License Status">
            {statusPie.length > 0 && (
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={statusPie}
                    cx="50%"
                    cy="50%"
                    outerRadius={80}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${Math.round((percent ?? 0) * 100)}%`}
                    labelLine={false}
                  >
                    {statusPie.map((entry) => (
                      <Cell
                        key={entry.name}
                        fill={STATUS_COLORS[entry.name] ?? "#6b7280"}
                      />
                    ))}
                  </Pie>
                  <Tooltip
                    formatter={(value: number) => [value.toLocaleString(), "Facilities"]}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </div>

        {/* Top counties bar chart */}
        <ChartCard title="Top 15 Counties by Facility Count">
          {topCounties.length > 0 && (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topCounties} margin={{ top: 4, right: 12, bottom: 60, left: 8 }}>
                <XAxis
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip formatter={(v: number) => [v.toLocaleString(), "Facilities"]} />
                <Bar dataKey="count" fill="#0ea5e9" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Facility types bar chart */}
        <ChartCard title="Top 12 Facility Types">
          {topTypes.length > 0 && (
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={topTypes} layout="vertical" margin={{ top: 4, right: 40, bottom: 4, left: 8 }}>
                <XAxis type="number" tick={{ fontSize: 11 }} />
                <YAxis
                  type="category"
                  dataKey="name"
                  tick={{ fontSize: 11 }}
                  width={180}
                />
                <Tooltip
                  formatter={(v: number) => [v.toLocaleString(), "Facilities"]}
                  labelFormatter={(label: string) => {
                    const entry = topTypes.find((t) => t.name === label);
                    return entry?.full ?? label;
                  }}
                />
                <Bar dataKey="count" fill="#a855f7" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        {/* Status breakdown table */}
        {meta && (
          <ChartCard title="Status Breakdown">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b text-left text-xs text-muted-foreground">
                    <th className="pb-2 font-medium">Status</th>
                    <th className="pb-2 font-medium text-right">Count</th>
                    <th className="pb-2 font-medium text-right">% of Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {Object.entries(meta.countByStatus)
                    .sort((a, b) => b[1] - a[1])
                    .map(([status, count]) => (
                      <tr key={status}>
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <span
                              className="w-2.5 h-2.5 rounded-full shrink-0"
                              style={{ backgroundColor: STATUS_COLORS[status] ?? "#6b7280" }}
                            />
                            <Badge
                              variant="outline"
                              className="text-xs font-medium"
                              style={{
                                color: STATUS_COLORS[status] ?? "#6b7280",
                                borderColor: STATUS_COLORS[status] ? `${STATUS_COLORS[status]}40` : undefined,
                              }}
                            >
                              {status}
                            </Badge>
                          </div>
                        </td>
                        <td className="py-2 text-right font-medium">{count.toLocaleString()}</td>
                        <td className="py-2 text-right text-muted-foreground">
                          {Math.round((count / meta.totalCount) * 100)}%
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </ChartCard>
        )}

        <p className="text-xs text-muted-foreground text-center pb-4">
          Data sourced from CA Community Care Licensing Division (CCLD) via CHHS Open Data Portal
        </p>
      </main>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiCard({
  icon: Icon,
  label,
  value,
  sub,
  color,
}: {
  icon: any;
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="rounded-xl border bg-card p-4 space-y-1.5">
      <div className="flex items-center gap-2">
        <Icon className={`h-4 w-4 ${color}`} />
        <span className="text-xs text-muted-foreground font-medium">{label}</span>
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className={`text-2xl font-bold ${color}`}>{value}</span>
        {sub && <span className="text-xs text-muted-foreground">{sub}</span>}
      </div>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <h2 className="text-sm font-semibold mb-4">{title}</h2>
      {children}
    </div>
  );
}

function shortenType(type: string): string {
  const map: Record<string, string> = {
    "Residential Care Facility for the Elderly": "RCFE",
    "Adult Residential Facility": "ARF",
    "Adult Residential Facility for Persons with Special Health Care Needs": "ARF-PSHCN",
    "Short-Term Residential Therapeutic Program": "STRTP",
    "Congregate Living Health Facility": "CLHF",
    "Residential Care Facility for the Chronically Ill": "RCFCI",
    "Family Child Care Home - Large": "FCCH (Large)",
    "Family Child Care Home - Small": "FCCH (Small)",
    "Enhanced Behavioral Supports Home": "EBSH",
    "Community Treatment Facility": "CTF",
  };
  return map[type] ?? (type.length > 25 ? `${type.slice(0, 23)}…` : type);
}

function BarChart2Icon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="20" x2="18" y2="10" />
      <line x1="12" y1="20" x2="12" y2="4" />
      <line x1="6" y1="20" x2="6" y2="14" />
    </svg>
  );
}
