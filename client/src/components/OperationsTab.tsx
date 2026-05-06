/**
 * OperationsTab — rendered as the 4th tab inside FacilityPortal.
 *
 * Intentionally has NO PortalLayout wrapper and NO auth guard.
 * Auth is already enforced by FacilityPortal before this component mounts.
 * facilityNumber is passed as a prop so we never re-fetch the session here.
 *
 * Polish ported from PortalDashboard (Phase A consolidation):
 *   • Smart KPI tiles with subtitles + tone (Zone A)
 *   • Alerts & Exceptions panel — urgency-ranked, cross-module list (Zone B)
 *   • Personal Work Queue — items the current user owns (Zone F)
 *   • Today's schedule strip with shift rollups (Zone D)
 *   • Role-lens switcher
 *   • Sticky quick-action bar (Zone G)
 *   • Keyboard shortcuts (g+m, g+i, g+n, g+r, g+c, c, ?)
 *
 * Notes intentionally are NOT a section in here anymore — they live as the
 * bell icon in the FacilityPortal header (NotesNotificationButton). The
 * keyboard shortcut g+n dispatches a custom event the bell listens for.
 */
import { useEffect, useMemo, useState } from "react";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { getQueryFn } from "@/lib/queryClient";
import { useSession } from "@/hooks/useSession";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import {
  type KpiKey,
  type Role,
  type QuickActionKey,
  getLens,
  isRole,
  listRoles,
} from "@/lib/roleLens";
import {
  Users, Pill, ClipboardList, AlertTriangle,
  UserPlus, Receipt, ShieldCheck,
  MessageSquare, Bell, ArrowRight, Clock, Sparkles,
  CheckCircle2, Inbox, UserCog, Keyboard, TrendingUp,
  Calendar as CalendarIcon,
} from "lucide-react";
import { ResidentsContent } from "@/components/operations/ResidentsContent";
import { EmarContent } from "@/components/operations/EmarContent";
import { IncidentsContent } from "@/components/operations/IncidentsContent";
import { CrmContent } from "@/components/operations/CrmContent";
import { BillingContent } from "@/components/operations/BillingContent";
import { StaffContent } from "@/components/operations/StaffContent";
import { ComplianceContent } from "@/components/operations/ComplianceContent";
import { AddTaskDialog } from "@/components/operations/AddTaskDialog";
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

interface MedPassEntry {
  id: number;
  residentId: number;
  residentName: string;
  roomNumber: string;
  drugName: string;
  dosage: string;
  scheduledTime: string;
  status: "pending" | "given" | "late" | "missed" | "refused" | "held";
  shift: "AM" | "PM" | "NOC";
}

interface IncidentRow {
  id: number;
  residentName?: string;
  incidentType: string;
  incidentDate: number;
  incidentTime: string;
  status: string;
  reportedBy?: string;
  supervisorNotified: boolean;
  familyNotified: boolean;
  physicianNotified: boolean;
  lic624Required: boolean;
  lic624Submitted: boolean;
}

interface ComplianceItem {
  id: number;
  itemType: string;
  description: string;
  dueDate: number;
  status: string;
  assignedTo: string | null;
}

interface StaffMember {
  id: number;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  licenseExpiry: number | null;
}

interface NoteListItem {
  id: number;
  body: string;
  authorDisplayName: string;
  priority: "normal" | "urgent";
  status: "open" | "archived" | "deleted";
  ackRequired: number;
  createdAt: number;
}

// Sub-view keys that the user can navigate to inside this tab.
type SubView = "residents" | "emar" | "incidents" | "crm" | "billing" | "staff" | "compliance";

// ── Time / urgency helpers ───────────────────────────────────────────────────

const APPROACHING_MED_MINUTES = 60;
const APPROACHING_COMPLIANCE_DAYS = 30;
const APPROACHING_LICENSE_DAYS = 30;

type Urgency = "overdue" | "approaching" | "scheduled" | "open";

const URGENCY_RANK: Record<Urgency, number> = {
  overdue: 0,
  approaching: 1,
  open: 2,
  scheduled: 3,
};

type Tier = "clinical" | "regulatory" | "care" | "ops" | "info";
const TIER_RANK: Record<Tier, number> = {
  clinical: 0,
  regulatory: 1,
  care: 2,
  ops: 3,
  info: 4,
};

interface AlertItem {
  id: string;
  tier: Tier;
  urgency: Urgency;
  icon: React.ElementType;
  title: string;
  detail: string;
  whenLabel: string;
  actionLabel: string;
  subView: SubView | "notes";
  sortKey: number;
}

function parseScheduledTimeToToday(scheduled: string): number | null {
  const m = scheduled.match(/^(\d{1,2}):(\d{2})\s+(AM|PM)$/i);
  if (!m) return null;
  let hours = parseInt(m[1], 10);
  const minutes = parseInt(m[2], 10);
  const ampm = m[3].toUpperCase();
  if (ampm === "PM" && hours !== 12) hours += 12;
  if (ampm === "AM" && hours === 12) hours = 0;
  const d = new Date();
  d.setHours(hours, minutes, 0, 0);
  return d.getTime();
}

function relativeTime(ts: number): string {
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60_000) return diff >= 0 ? "in <1 min" : "<1 min ago";
  return formatDistanceToNow(new Date(ts), { addSuffix: true });
}

function todayIso(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function greeting(): string {
  const h = new Date().getHours();
  if (h < 5) return "Good night";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 21) return "Good evening";
  return "Good night";
}

// Notes are global, surfaced via the header bell. Dispatch a DOM event the
// bell listens for so keyboard shortcut g+n and "Open notes" alert actions
// keep working without coupling to the bell's state.
function openNotesBell() {
  window.dispatchEvent(new CustomEvent("arf:open-notes"));
}

// ── KPI tiles ────────────────────────────────────────────────────────────────

interface KpiTile {
  key: KpiKey;
  label: string;
  count: number;
  subtitle: string;
  icon: React.ElementType;
  tone: "ok" | "info" | "warn" | "danger";
  subView: SubView;
}

const TONE_STYLES: Record<KpiTile["tone"], { border: string; iconBg: string; subtitle: string }> = {
  ok:     { border: "border-l-emerald-500", iconBg: "bg-emerald-100 text-emerald-700", subtitle: "text-emerald-700" },
  info:   { border: "border-l-indigo-500",  iconBg: "bg-indigo-100  text-indigo-700",  subtitle: "text-indigo-700"  },
  warn:   { border: "border-l-amber-500",   iconBg: "bg-amber-100   text-amber-700",   subtitle: "text-amber-700"   },
  danger: { border: "border-l-red-500",     iconBg: "bg-red-100     text-red-700",     subtitle: "text-red-700"     },
};

function KpiCard({ tile, onClick }: { tile: KpiTile; onClick: () => void }) {
  const t = TONE_STYLES[tile.tone];
  const Icon = tile.icon;
  return (
    <button
      onClick={onClick}
      className="text-left w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400 rounded-lg"
    >
      <Card className={cn("border-l-4 transition-all hover:shadow-md hover:-translate-y-0.5", t.border)}>
        <CardContent className="p-3.5 flex items-center gap-3">
          <div className={cn("h-10 w-10 rounded-full flex items-center justify-center shrink-0", t.iconBg)}>
            <Icon className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-2xl font-bold tabular-nums leading-none">{tile.count}</p>
            <p className="text-xs text-muted-foreground leading-tight mt-1">{tile.label}</p>
            <p className={cn("text-[10px] font-medium leading-tight mt-0.5 truncate", t.subtitle)}>
              {tile.subtitle}
            </p>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}

function KpiSkeleton() {
  return (
    <Card>
      <CardContent className="p-3.5 flex items-center gap-3">
        <Skeleton className="h-10 w-10 rounded-full" />
        <div className="space-y-1.5 flex-1">
          <Skeleton className="h-6 w-10" />
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-2.5 w-16" />
        </div>
      </CardContent>
    </Card>
  );
}

// ── Alerts & Exceptions ──────────────────────────────────────────────────────

const URGENCY_BADGE: Record<Urgency, string> = {
  overdue:     "bg-red-100   text-red-700   border-red-200",
  approaching: "bg-amber-100 text-amber-800 border-amber-200",
  open:        "bg-orange-100 text-orange-700 border-orange-200",
  scheduled:   "bg-slate-100 text-slate-600  border-slate-200",
};

const URGENCY_LABEL: Record<Urgency, string> = {
  overdue: "Overdue",
  approaching: "Approaching",
  open: "Open",
  scheduled: "Scheduled",
};

function AlertRow({
  alert,
  onAct,
}: {
  alert: AlertItem;
  onAct: (target: SubView | "notes") => void;
}) {
  const Icon = alert.icon;
  return (
    <li className="group flex items-center gap-3 px-3 py-2.5 hover:bg-indigo-50/40 transition-colors border-b border-gray-50 last:border-0">
      <div className="h-8 w-8 rounded-md bg-white border border-gray-200 flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-gray-600" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{alert.title}</span>
          <Badge
            variant="outline"
            className={cn("h-5 text-[10px] font-semibold", URGENCY_BADGE[alert.urgency])}
          >
            {URGENCY_LABEL[alert.urgency]}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {alert.detail} · <span className="tabular-nums">{alert.whenLabel}</span>
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0 h-8 text-xs gap-1 opacity-70 group-hover:opacity-100"
        onClick={() => onAct(alert.subView)}
      >
        {alert.actionLabel}
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

// ── Role lens switcher ───────────────────────────────────────────────────────

function RoleLensSwitcher({
  activeRole,
  userRole,
  isPreviewing,
  onChange,
}: {
  activeRole: Role;
  userRole: Role;
  isPreviewing: boolean;
  onChange: (role: Role) => void;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <UserCog className="h-3.5 w-3.5 text-muted-foreground" />
      <select
        aria-label="Role lens"
        value={activeRole}
        onChange={(e) => onChange(e.target.value as Role)}
        className={cn(
          "h-8 text-xs rounded-md border bg-white px-2 pr-7 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
          isPreviewing ? "border-amber-400 text-amber-900" : "border-gray-200",
        )}
      >
        {listRoles().map(({ role, label }) => (
          <option key={role} value={role}>
            {label}
            {role === userRole ? " · You" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

// ── Quick actions registry (lens-driven) ─────────────────────────────────────

const QUICK_ACTIONS: Record<
  QuickActionKey,
  { label: string; icon: React.ElementType; subView: SubView | "notes" }
> = {
  chartMed:        { label: "Chart medication", icon: Pill,           subView: "emar" },
  addIncident:     { label: "Add incident",     icon: AlertTriangle,  subView: "incidents" },
  postNote:        { label: "Post note",        icon: MessageSquare,  subView: "notes" },
  addLead:         { label: "Add lead",         icon: UserPlus,       subView: "crm" },
  openCompliance:  { label: "Compliance",       icon: ShieldCheck,    subView: "compliance" },
};

// ── Personal Work Queue ──────────────────────────────────────────────────────

function PersonalQueue({
  items,
  isLoading,
  onAct,
  displayName,
}: {
  items: AlertItem[];
  isLoading: boolean;
  onAct: (target: SubView | "notes") => void;
  displayName: string;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
          <div className="flex items-center gap-2">
            <Inbox className="h-4 w-4 text-indigo-500" />
            <h2 className="text-sm font-semibold">My work</h2>
            {!isLoading && items.length > 0 && (
              <Badge variant="outline" className="h-5 text-[10px]">
                {items.length}
              </Badge>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground hidden sm:inline">
            Items assigned to or awaiting <span className="font-medium">{displayName}</span>
          </span>
        </div>
        {isLoading ? (
          <div className="p-3 space-y-2">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="h-12 w-3/4" />
          </div>
        ) : items.length === 0 ? (
          <div className="p-5 text-center">
            <CheckCircle2 className="h-6 w-6 text-emerald-500 mx-auto mb-1.5" />
            <p className="text-sm font-medium">Nothing on your queue</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              When something is assigned to you or needs your acknowledgement, it'll show up here.
            </p>
          </div>
        ) : (
          <ul>
            {items.slice(0, 6).map((a) => (
              <AlertRow key={a.id} alert={a} onAct={onAct} />
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

// ── Keyboard shortcut help ───────────────────────────────────────────────────

function ShortcutHelp({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const rows: Array<{ keys: string[]; label: string }> = [
    { keys: ["g", "m"], label: "Go to eMAR (medications)" },
    { keys: ["g", "i"], label: "Go to incidents" },
    { keys: ["g", "n"], label: "Open notes (bell drawer)" },
    { keys: ["g", "r"], label: "Go to residents" },
    { keys: ["g", "c"], label: "Go to compliance" },
    { keys: ["c"],      label: "Chart medication (eMAR)" },
    { keys: ["?"],      label: "Show this dialog" },
  ];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Keyboard className="h-4 w-4" />
            Keyboard shortcuts
          </DialogTitle>
        </DialogHeader>
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{r.label}</span>
              <span className="flex items-center gap-1">
                {r.keys.map((k, i) => (
                  <kbd
                    key={i}
                    className="px-1.5 py-0.5 rounded border border-gray-200 bg-gray-50 text-xs font-mono"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

// ── Today strip ──────────────────────────────────────────────────────────────

function TodayStrip({
  medPasses,
  isLoading,
  onAction,
}: {
  medPasses: MedPassEntry[];
  isLoading: boolean;
  onAction: () => void;
}) {
  if (isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  const groups: Array<{ key: "AM" | "PM" | "NOC"; label: string }> = [
    { key: "AM", label: "Morning" },
    { key: "PM", label: "Afternoon / Evening" },
    { key: "NOC", label: "Overnight" },
  ];

  if (medPasses.length === 0) {
    return (
      <div className="rounded-md border border-dashed py-6 text-center text-sm text-muted-foreground">
        No med passes scheduled today.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {groups.map((g) => {
        const items = medPasses.filter((m) => m.shift === g.key);
        if (items.length === 0) return null;
        const totals = items.reduce(
          (acc, m) => {
            acc.total += 1;
            if (m.status === "given") acc.given += 1;
            else if (m.status === "late" || m.status === "missed") acc.late += 1;
            else if (m.status === "pending") acc.pending += 1;
            return acc;
          },
          { total: 0, given: 0, late: 0, pending: 0 },
        );
        const pct = totals.total === 0 ? 0 : Math.round((totals.given / totals.total) * 100);
        return (
          <button
            key={g.key}
            onClick={onAction}
            className="w-full text-left rounded-lg border border-gray-100 hover:border-indigo-200 hover:bg-indigo-50/40 transition-colors p-3"
          >
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                {g.label}
              </span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {totals.given}/{totals.total} given
                {totals.late > 0 && (
                  <span className="ml-2 text-red-600 font-medium">
                    {totals.late} late
                  </span>
                )}
                {totals.pending > 0 && (
                  <span className="ml-2 text-amber-700">
                    {totals.pending} pending
                  </span>
                )}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all",
                  totals.late > 0 ? "bg-red-500" : pct === 100 ? "bg-emerald-500" : "bg-indigo-500",
                )}
                style={{ width: `${pct}%` }}
              />
            </div>
          </button>
        );
      })}
    </div>
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
  const [subView, setSubView] = useState<SubView | null>(null);
  // Day-scoped sub-views (currently just emar) read this to open on the
  // correct date when navigation comes from a calendar chip.
  const [subViewDate, setSubViewDate] = useState<string | null>(null);
  // Calendar is visible by default — it's the main operational view.
  // Users can collapse it via the toggle in Today's-schedule if they want
  // more screen space for alerts/queue.
  const [showCalendar, setShowCalendar] = useState(true);
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [lensOverride, setLensOverride] = useState<Role | null>(null);
  const [addTaskOpen, setAddTaskOpen] = useState(false);

  const { data: me } = useSession();
  const userRole: Role = isRole(me?.role) ? me.role : "facility_admin";
  const activeRole: Role = lensOverride ?? userRole;
  const lens = useMemo(() => getLens(activeRole), [activeRole]);
  const isPreviewing = lensOverride !== null && lensOverride !== userRole;

  // ── Data sources ───────────────────────────────────────────────────────────
  const enabled = !!facilityNumber;

  const { data: dashEnv, isLoading: dashLoading, error: dashError } = useQuery<
    { success: boolean; data: DashboardData } | null
  >({
    queryKey: [`/api/ops/facilities/${facilityNumber}/dashboard`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled,
    staleTime: 60_000,
  });

  const { data: medEnv, isLoading: medLoading } = useQuery<
    { success: boolean; data: MedPassEntry[] } | null
  >({
    queryKey: [`/api/ops/facilities/${facilityNumber}/med-pass`, todayIso()],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled,
    staleTime: 60_000,
  });

  const { data: incEnv, isLoading: incLoading } = useQuery<
    { success: boolean; data: IncidentRow[] } | null
  >({
    queryKey: [`/api/ops/facilities/${facilityNumber}/incidents`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled,
    staleTime: 60_000,
  });

  const { data: ovdCompEnv, isLoading: ovdLoading } = useQuery<
    { success: boolean; data: ComplianceItem[] } | null
  >({
    queryKey: [`/api/ops/facilities/${facilityNumber}/compliance/overdue`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled,
    staleTime: 60_000,
  });

  const { data: compEnv, isLoading: compLoading } = useQuery<
    { success: boolean; data: ComplianceItem[] } | null
  >({
    queryKey: [`/api/ops/facilities/${facilityNumber}/compliance`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled,
    staleTime: 60_000,
  });

  const { data: staffEnv, isLoading: staffLoading } = useQuery<
    { success: boolean; data: StaffMember[] } | null
  >({
    queryKey: [`/api/ops/facilities/${facilityNumber}/staff`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled,
    staleTime: 5 * 60_000,
  });

  // Shared key with NotesNotificationButton (same limit=50) — React Query dedupes.
  const { data: notesEnv, isLoading: notesLoading } = useQuery<
    { success: boolean; data: { items: NoteListItem[]; nextCursor: string | null } } | null
  >({
    queryKey: ["/api/ops/notes?status=open&limit=50"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled,
    staleTime: 30_000,
  });

  const dashboard = dashEnv?.data ?? null;
  const medPasses = medEnv?.data ?? [];
  const incidents = incEnv?.data ?? [];
  const overdueCompliance = ovdCompEnv?.data ?? [];
  const allCompliance = compEnv?.data ?? [];
  const staff = staffEnv?.data ?? [];
  const notes = notesEnv?.data?.items ?? [];

  const goToSubView = (sv: SubView, date: string | null = null) => {
    setSubView(sv);
    setSubViewDate(date);
  };

  // Unified "go" — alerts/quick actions can target either a sub-view or the
  // global notes bell.
  const navigateTarget = (target: SubView | "notes") => {
    if (target === "notes") {
      openNotesBell();
      return;
    }
    goToSubView(target);
  };

  // Keyboard shortcuts. This effect only runs while OperationsTab is mounted —
  // FacilityPortal uses Radix Tabs which unmounts inactive panels, so the
  // shortcuts auto-disable when the user switches to another tab.
  useEffect(() => {
    let prefix: string | null = null;
    let prefixTimeout: ReturnType<typeof setTimeout> | null = null;
    const isTyping = (el: EventTarget | null) =>
      !!el && el instanceof HTMLElement && /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName);

    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (isTyping(e.target)) return;

      if (e.key === "?") {
        e.preventDefault();
        setShowShortcuts(true);
        return;
      }
      if (e.key === "c" && prefix == null) {
        setSubView("emar");
        setSubViewDate(null);
        return;
      }
      if (e.key === "g") {
        prefix = "g";
        if (prefixTimeout) clearTimeout(prefixTimeout);
        prefixTimeout = setTimeout(() => { prefix = null; }, 1200);
        return;
      }
      if (prefix === "g") {
        const map: Record<string, SubView | "notes"> = {
          m: "emar",
          i: "incidents",
          n: "notes",
          r: "residents",
          c: "compliance",
        };
        const dest = map[e.key];
        prefix = null;
        if (prefixTimeout) clearTimeout(prefixTimeout);
        if (dest) {
          e.preventDefault();
          if (dest === "notes") {
            openNotesBell();
          } else {
            setSubView(dest);
            setSubViewDate(null);
          }
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (prefixTimeout) clearTimeout(prefixTimeout);
    };
  }, []);

  // ── Smart KPI tiles ────────────────────────────────────────────────────────
  const kpiTiles: KpiTile[] = useMemo(() => {
    if (!dashboard) return [];
    const lateMissed = medPasses.filter((m) => m.status === "late" || m.status === "missed").length;
    const approachingMeds = medPasses.filter((m) => {
      if (m.status !== "pending") return false;
      const t = parseScheduledTimeToToday(m.scheduledTime);
      if (t == null) return false;
      const minsAway = (t - Date.now()) / 60_000;
      return minsAway >= 0 && minsAway <= APPROACHING_MED_MINUTES;
    }).length;
    const openIncidents = incidents.filter((i) => i.status === "open").length;

    return [
      {
        key: "residents",
        label: "Active Residents",
        count: dashboard.activeResidents,
        subtitle: dashboard.activeResidents === 0 ? "No residents on census" : "On census today",
        icon: Users,
        tone: "info",
        subView: "residents",
      },
      {
        key: "meds",
        label: "Pending Med Passes",
        count: dashboard.pendingMedPasses,
        subtitle:
          lateMissed > 0
            ? `${lateMissed} late or missed`
            : approachingMeds > 0
              ? `${approachingMeds} due in next ${APPROACHING_MED_MINUTES} min`
              : dashboard.pendingMedPasses === 0
                ? "All clear"
                : "On schedule",
        icon: Pill,
        tone: lateMissed > 0 ? "danger" : approachingMeds > 0 ? "warn" : dashboard.pendingMedPasses > 0 ? "info" : "ok",
        subView: "emar",
      },
      {
        key: "tasks",
        label: "Overdue Tasks",
        count: dashboard.overdueTasks,
        subtitle: dashboard.overdueTasks > 0 ? "Past due window" : "Caught up",
        icon: ClipboardList,
        tone: dashboard.overdueTasks > 0 ? "danger" : "ok",
        subView: "residents",
      },
      {
        key: "incidents",
        label: "Open Incidents",
        count: dashboard.openIncidents,
        subtitle:
          openIncidents > 0
            ? `${openIncidents} unresolved`
            : dashboard.openIncidents === 0
              ? "No open incidents"
              : "Under review",
        icon: AlertTriangle,
        tone: dashboard.openIncidents > 0 ? "danger" : "ok",
        subView: "incidents",
      },
      {
        key: "leads",
        label: "Pending Leads",
        count: dashboard.pendingLeads,
        subtitle: dashboard.pendingLeads > 0 ? "Awaiting follow-up" : "Pipeline clear",
        icon: UserPlus,
        tone: dashboard.pendingLeads > 0 ? "info" : "ok",
        subView: "crm",
      },
      {
        key: "invoices",
        label: "Overdue Invoices",
        count: dashboard.overdueInvoices,
        subtitle: dashboard.overdueInvoices > 0 ? "Past due A/R" : "All current",
        icon: Receipt,
        tone: dashboard.overdueInvoices > 0 ? "danger" : "ok",
        subView: "billing",
      },
      {
        key: "compliance",
        label: "Overdue Compliance",
        count: dashboard.overdueCompliance,
        subtitle: dashboard.overdueCompliance > 0 ? "Regulatory exposure" : "On track",
        icon: ShieldCheck,
        tone: dashboard.overdueCompliance > 0 ? "warn" : "ok",
        subView: "compliance",
      },
    ];
  }, [dashboard, medPasses, incidents]);

  // Lens-filtered KPIs.
  const orderedKpis: KpiTile[] = useMemo(() => {
    if (kpiTiles.length === 0) return [];
    const byKey = new Map(kpiTiles.map((t) => [t.key, t]));
    return lens.kpis
      .map((k) => byKey.get(k))
      .filter((t): t is KpiTile => t !== undefined);
  }, [kpiTiles, lens]);

  // ── Alerts & Exceptions ────────────────────────────────────────────────────
  const alerts: AlertItem[] = useMemo(() => {
    const out: AlertItem[] = [];
    const now = Date.now();

    for (const m of medPasses) {
      if (m.status !== "late" && m.status !== "missed") continue;
      const t = parseScheduledTimeToToday(m.scheduledTime);
      out.push({
        id: `med-${m.id}`,
        tier: "clinical",
        urgency: "overdue",
        icon: Pill,
        title: `${m.status === "late" ? "Late" : "Missed"} med · ${m.residentName}`,
        detail: `${m.drugName} ${m.dosage}`.trim() + (m.roomNumber ? ` · Rm ${m.roomNumber}` : ""),
        whenLabel: `scheduled ${m.scheduledTime}`,
        actionLabel: "Chart",
        subView: "emar",
        sortKey: t ?? now,
      });
    }

    for (const m of medPasses) {
      if (m.status !== "pending") continue;
      const t = parseScheduledTimeToToday(m.scheduledTime);
      if (t == null) continue;
      const minsAway = (t - now) / 60_000;
      if (minsAway < 0 || minsAway > APPROACHING_MED_MINUTES) continue;
      out.push({
        id: `med-app-${m.id}`,
        tier: "clinical",
        urgency: "approaching",
        icon: Pill,
        title: `${m.residentName} · ${m.drugName}`.trim(),
        detail: `${m.dosage}`.trim() + (m.roomNumber ? ` · Rm ${m.roomNumber}` : ""),
        whenLabel: relativeTime(t),
        actionLabel: "Chart",
        subView: "emar",
        sortKey: t,
      });
    }

    for (const inc of incidents) {
      if (inc.status !== "open") continue;
      const missing: string[] = [];
      if (!inc.supervisorNotified) missing.push("supervisor");
      if (!inc.familyNotified) missing.push("family");
      if (!inc.physicianNotified) missing.push("physician");
      if (missing.length === 0) continue;
      out.push({
        id: `inc-notify-${inc.id}`,
        tier: "regulatory",
        urgency: "open",
        icon: AlertTriangle,
        title: `${inc.incidentType.replace(/_/g, " ")}${inc.residentName ? ` · ${inc.residentName}` : ""}`,
        detail: `Missing notification: ${missing.join(", ")}`,
        whenLabel: relativeTime(inc.incidentDate),
        actionLabel: "Open",
        subView: "incidents",
        sortKey: inc.incidentDate,
      });
    }

    for (const inc of incidents) {
      if (!inc.lic624Required || inc.lic624Submitted) continue;
      out.push({
        id: `inc-lic-${inc.id}`,
        tier: "regulatory",
        urgency: "approaching",
        icon: ShieldCheck,
        title: `LIC 624 needed · ${inc.incidentType.replace(/_/g, " ")}`,
        detail: inc.residentName ?? "Reportable incident",
        whenLabel: relativeTime(inc.incidentDate),
        actionLabel: "File",
        subView: "incidents",
        sortKey: inc.incidentDate,
      });
    }

    for (const c of overdueCompliance) {
      out.push({
        id: `cmp-ovd-${c.id}`,
        tier: "regulatory",
        urgency: "overdue",
        icon: ShieldCheck,
        title: c.description || c.itemType,
        detail: c.assignedTo ? `Assigned to ${c.assignedTo}` : "Unassigned",
        whenLabel: `due ${relativeTime(c.dueDate)}`,
        actionLabel: "Review",
        subView: "compliance",
        sortKey: c.dueDate,
      });
    }

    const APPROACH_MS = APPROACHING_COMPLIANCE_DAYS * 86_400_000;
    for (const c of allCompliance) {
      if (c.status === "completed") continue;
      const ms = c.dueDate - now;
      if (ms <= 0 || ms > APPROACH_MS) continue;
      out.push({
        id: `cmp-app-${c.id}`,
        tier: "regulatory",
        urgency: "approaching",
        icon: ShieldCheck,
        title: c.description || c.itemType,
        detail: c.assignedTo ? `Assigned to ${c.assignedTo}` : "Unassigned",
        whenLabel: `due ${relativeTime(c.dueDate)}`,
        actionLabel: "Review",
        subView: "compliance",
        sortKey: c.dueDate,
      });
    }

    const LIC_APPROACH_MS = APPROACHING_LICENSE_DAYS * 86_400_000;
    for (const s of staff) {
      if (s.licenseExpiry == null) continue;
      if (s.status !== "active") continue;
      const ms = s.licenseExpiry - now;
      if (ms <= 0) {
        out.push({
          id: `lic-${s.id}`,
          tier: "regulatory",
          urgency: "overdue",
          icon: ShieldCheck,
          title: `License expired · ${s.firstName} ${s.lastName}`,
          detail: `Role: ${s.role.replace(/_/g, " ")}`,
          whenLabel: relativeTime(s.licenseExpiry),
          actionLabel: "Update",
          subView: "staff",
          sortKey: s.licenseExpiry,
        });
      } else if (ms <= LIC_APPROACH_MS) {
        out.push({
          id: `lic-${s.id}`,
          tier: "regulatory",
          urgency: "approaching",
          icon: ShieldCheck,
          title: `License expiring · ${s.firstName} ${s.lastName}`,
          detail: `Role: ${s.role.replace(/_/g, " ")}`,
          whenLabel: relativeTime(s.licenseExpiry),
          actionLabel: "Update",
          subView: "staff",
          sortKey: s.licenseExpiry,
        });
      }
    }

    for (const n of notes) {
      if (n.priority !== "urgent" || n.status !== "open") continue;
      out.push({
        id: `note-${n.id}`,
        tier: "care",
        urgency: "open",
        icon: MessageSquare,
        title: "Urgent note awaiting acknowledgement",
        detail: n.body.slice(0, 80) + (n.body.length > 80 ? "…" : ""),
        whenLabel: relativeTime(n.createdAt),
        actionLabel: "Open",
        subView: "notes",
        sortKey: n.createdAt,
      });
    }

    out.sort((a, b) => {
      const tierA = TIER_RANK[a.tier] + (lens.tierBoost[a.tier] ?? 0);
      const tierB = TIER_RANK[b.tier] + (lens.tierBoost[b.tier] ?? 0);
      if (tierA !== tierB) return tierA - tierB;
      const urg = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (urg !== 0) return urg;
      return a.sortKey - b.sortKey;
    });

    return out;
  }, [medPasses, incidents, overdueCompliance, allCompliance, staff, notes, lens]);

  const alertsLoading =
    medLoading || incLoading || ovdLoading || compLoading || staffLoading || notesLoading;
  const overdueCount = alerts.filter((a) => a.urgency === "overdue").length;
  const approachingCount = alerts.filter((a) => a.urgency === "approaching").length;
  const visibleAlerts = showAllAlerts ? alerts : alerts.slice(0, 6);

  // ── Personal Work Queue ────────────────────────────────────────────────────
  // Derived from existing endpoints — same heuristics PortalDashboard used.
  const myQueue: AlertItem[] = useMemo(() => {
    if (!me) return [];
    const usernameLc = me.username.toLowerCase();
    const out: AlertItem[] = [];
    const now = Date.now();

    for (const c of allCompliance) {
      if (c.status === "completed") continue;
      if (!c.assignedTo) continue;
      if (c.assignedTo.toLowerCase() !== usernameLc) continue;
      const overdue = c.dueDate <= now;
      out.push({
        id: `mine-cmp-${c.id}`,
        tier: "regulatory",
        urgency: overdue ? "overdue" : "approaching",
        icon: ShieldCheck,
        title: c.description || c.itemType,
        detail: `Assigned to you · ${overdue ? "overdue" : "upcoming"}`,
        whenLabel: `due ${relativeTime(c.dueDate)}`,
        actionLabel: "Open",
        subView: "compliance",
        sortKey: c.dueDate,
      });
    }

    for (const inc of incidents) {
      if (inc.status !== "open") continue;
      if (!inc.reportedBy) continue;
      if (inc.reportedBy.toLowerCase() !== usernameLc) continue;
      out.push({
        id: `mine-inc-${inc.id}`,
        tier: "regulatory",
        urgency: "open",
        icon: AlertTriangle,
        title: `${inc.incidentType.replace(/_/g, " ")}${inc.residentName ? ` · ${inc.residentName}` : ""}`,
        detail: "You reported this — still open",
        whenLabel: relativeTime(inc.incidentDate),
        actionLabel: "Open",
        subView: "incidents",
        sortKey: inc.incidentDate,
      });
    }

    for (const n of notes) {
      if (n.status !== "open") continue;
      const isMine = n.authorDisplayName.toLowerCase() === usernameLc;
      const needsAck = n.priority === "urgent" && n.ackRequired === 1;
      if (!isMine && !needsAck) continue;
      out.push({
        id: `mine-note-${n.id}`,
        tier: "care",
        urgency: needsAck ? "open" : "scheduled",
        icon: MessageSquare,
        title: needsAck ? "Acknowledge urgent note" : "Your note",
        detail: n.body.slice(0, 80) + (n.body.length > 80 ? "…" : ""),
        whenLabel: relativeTime(n.createdAt),
        actionLabel: "Open",
        subView: "notes",
        sortKey: n.createdAt,
      });
    }

    out.sort((a, b) => {
      const urg = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (urg !== 0) return urg;
      return a.sortKey - b.sortKey;
    });
    return out;
  }, [me, allCompliance, incidents, notes]);

  const myQueueLoading = compLoading || incLoading || notesLoading;

  // Sub-view content is rendered inline below the overview header so the
  // header (greeting + status sentence) stays pinned while the user is
  // drilled into a module — UX-1 from BA review: "see at-a-glance status
  // even while you're focused on one thing".
  const subViewBack = () => { setSubView(null); setSubViewDate(null); };
  const subViewContent: React.ReactNode =
    subView === "residents"  ? <ResidentsContent  facilityNumber={facilityNumber} onBack={subViewBack} /> :
    subView === "emar"       ? <EmarContent       facilityNumber={facilityNumber} onBack={subViewBack} initialDate={subViewDate ?? undefined} /> :
    subView === "incidents"  ? <IncidentsContent  facilityNumber={facilityNumber} onBack={subViewBack} /> :
    subView === "crm"        ? <CrmContent        facilityNumber={facilityNumber} onBack={subViewBack} /> :
    subView === "billing"    ? <BillingContent    facilityNumber={facilityNumber} onBack={subViewBack} /> :
    subView === "staff"      ? <StaffContent      facilityNumber={facilityNumber} onBack={subViewBack} /> :
    subView === "compliance" ? <ComplianceContent facilityNumber={facilityNumber} onBack={subViewBack} /> :
    null;

  // Role-lens preview is admin-only; caregivers and med techs don't need
  // to "preview as another role" and the picker is just visual noise for
  // them.
  const isAdmin = userRole === "super_admin" || userRole === "facility_admin";

  // ── Overview render ────────────────────────────────────────────────────────

  const today = new Date();
  const dateLabel = today.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="space-y-5 pb-24">
      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <CalendarIcon className="h-3.5 w-3.5" />
            {dateLabel}
          </p>
          <h1 className="text-2xl font-semibold mt-0.5">
            {greeting()}{me?.username ? `, ${me.username}` : ""}
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Facility #{facilityNumber} ·{" "}
            {alertsLoading ? (
              <span>checking status…</span>
            ) : alerts.length === 0 ? (
              <span className="text-emerald-700 font-medium">All clear</span>
            ) : (
              <span>
                <span className={overdueCount > 0 ? "text-red-700 font-medium" : ""}>
                  {overdueCount} overdue
                </span>
                {" · "}
                <span className={approachingCount > 0 ? "text-amber-700 font-medium" : ""}>
                  {approachingCount} approaching
                </span>
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <RoleLensSwitcher
              activeRole={activeRole}
              userRole={userRole}
              isPreviewing={isPreviewing}
              onChange={(r) => setLensOverride(r === userRole ? null : r)}
            />
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setShowShortcuts(true)}
            className="gap-1.5"
          >
            <Keyboard className="h-3.5 w-3.5" />
            Shortcuts
          </Button>
        </div>
      </div>

      {isPreviewing && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900 flex items-center justify-between gap-2">
          <span>
            Previewing dashboard as <strong>{getLens(lensOverride!).label}</strong>. Your real role is {getLens(userRole).label}.
          </span>
          <button
            type="button"
            className="font-semibold underline hover:no-underline"
            onClick={() => setLensOverride(null)}
          >
            Reset
          </button>
        </div>
      )}

      {dashError && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive">
          Failed to load dashboard counts. Other sections may still work.
        </div>
      )}

      {subView && subViewContent ? (
        <SubViewErrorBoundary key={subView} onBack={subViewBack}>
          {subViewContent}
        </SubViewErrorBoundary>
      ) : (
        <>
      {/* Zone A: KPIs */}
      <section aria-label="Key indicators">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {dashLoading
            ? Array.from({ length: 7 }).map((_, i) => <KpiSkeleton key={i} />)
            : orderedKpis.length > 0
              ? orderedKpis.map((t) => (
                  <KpiCard key={t.label} tile={t} onClick={() => goToSubView(t.subView)} />
                ))
              : (
                <div className="col-span-2 md:col-span-3 lg:col-span-4 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
                  {!facilityNumber
                    ? "Facility not found. Please log out and back in."
                    : "Could not load operations data. Try refreshing the page."}
                </div>
              )}
        </div>
      </section>

      {/* Zone B: Alerts & Exceptions */}
      <section aria-label="Alerts and exceptions">
        <Card>
          <CardContent className="p-0">
            <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
              <div className="flex items-center gap-2">
                <Bell className="h-4 w-4 text-amber-600" />
                <h2 className="text-sm font-semibold">Needs attention</h2>
                {!alertsLoading && alerts.length > 0 && (
                  <Badge variant="outline" className="h-5 text-[10px]">
                    {alerts.length}
                  </Badge>
                )}
              </div>
              {!alertsLoading && alerts.length > 6 && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => setShowAllAlerts((v) => !v)}
                >
                  {showAllAlerts ? "Show top 6" : `Show all ${alerts.length}`}
                </Button>
              )}
            </div>

            {alertsLoading ? (
              <div className="p-3 space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-3/4" />
              </div>
            ) : alerts.length === 0 ? (
              <div className="p-6 text-center">
                <Sparkles className="h-7 w-7 text-emerald-500 mx-auto mb-2" />
                <p className="text-sm font-semibold">All caught up</p>
                <p className="text-xs text-muted-foreground mt-1">
                  {medPasses.length > 0 ? (
                    <>
                      Next med pass at{" "}
                      <span className="font-medium">
                        {medPasses.find((m) => m.status === "pending")?.scheduledTime ?? "—"}
                      </span>
                      .
                    </>
                  ) : (
                    <>No urgent items right now. Check the calendar for what's coming up.</>
                  )}
                </p>
              </div>
            ) : (
              <ul>
                {visibleAlerts.map((a) => (
                  <AlertRow key={a.id} alert={a} onAct={navigateTarget} />
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </section>

      {/* Zone F: Personal Work Queue */}
      <section aria-label="My work">
        <PersonalQueue
          items={myQueue}
          isLoading={myQueueLoading}
          onAct={navigateTarget}
          displayName={me?.username ?? ""}
        />
      </section>

      {/* Zone D: Today's schedule */}
      <section aria-label="Today's schedule">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Clock className="h-4 w-4 text-indigo-500" />
                <h2 className="text-sm font-semibold">Today's schedule</h2>
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs gap-1"
                onClick={() => setShowCalendar((v) => !v)}
              >
                {showCalendar ? "Hide calendar" : "Open calendar"}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </div>
            <TodayStrip
              medPasses={medPasses}
              isLoading={medLoading}
              onAction={() => goToSubView("emar")}
            />
          </CardContent>
        </Card>
      </section>

      {/* Optional embedded calendar */}
      {showCalendar && facilityNumber && (
        <section aria-label="Operations calendar">
          <OpsCalendar
            facilityNumber={facilityNumber}
            onNavigate={(sv, date) => {
              goToSubView(sv as SubView, date ?? null);
            }}
          />
        </section>
      )}
        </>
      )}

      {/* Sticky quick action bar (Zone G) */}
      <div
        className="fixed bottom-0 left-0 right-0 border-t bg-white/95 backdrop-blur-sm shadow-[0_-4px_12px_-6px_rgba(0,0,0,0.08)] z-30"
        style={{ borderColor: "#E0E7FF" }}
      >
        <div className="max-w-7xl mx-auto px-4 py-2 flex items-center gap-2 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hidden sm:inline">
            Quick actions
          </span>
          {lens.quickActions.map((key, idx) => {
            const a = QUICK_ACTIONS[key];
            const A = a.icon;
            return (
              <Button
                key={key}
                size="sm"
                variant={idx === 0 ? "default" : "outline"}
                onClick={() => navigateTarget(a.subView)}
                className="gap-1.5"
              >
                <A className="h-4 w-4" />
                {a.label}
              </Button>
            );
          })}
          {/* Add Task — independent of role lens since tasks are universal. */}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setAddTaskOpen(true)}
            className="gap-1.5"
          >
            <ClipboardList className="h-4 w-4" />
            Add task
          </Button>
          <div className="ml-auto text-[10px] text-muted-foreground hidden md:flex items-center gap-1">
            <TrendingUp className="h-3 w-3" />
            Press <kbd className="px-1 py-0.5 rounded bg-gray-100 border text-[10px] font-mono">?</kbd> for shortcuts
          </div>
        </div>
      </div>

      <ShortcutHelp open={showShortcuts} onOpenChange={setShowShortcuts} />
      <AddTaskDialog
        open={addTaskOpen}
        onOpenChange={setAddTaskOpen}
        facilityNumber={facilityNumber}
      />
    </div>
  );
}
