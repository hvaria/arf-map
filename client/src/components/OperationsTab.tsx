/**
 * OperationsTab — rendered as the 4th tab inside FacilityPortal.
 *
 * Intentionally has NO outer layout wrapper and NO auth guard.
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
import { useEffect, useMemo, useRef, useState } from "react";
import React from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { getQueryFn } from "@/lib/queryClient";
import { useSession } from "@/hooks/useSession";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
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
  UserPlus, ShieldCheck,
  MessageSquare, Bell, ArrowRight, Clock,
  CheckCircle2, Inbox, UserCog, Keyboard,
  Calendar as CalendarIcon, Activity,
  ChevronDown, ChevronUp, Plus,
  LayoutDashboard, FileText,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ResidentsContent } from "@/components/operations/ResidentsContent";
import { EmarContent } from "@/components/operations/EmarContent";
import { IncidentsContent } from "@/components/operations/IncidentsContent";
import { CrmContent } from "@/components/operations/CrmContent";
import { StaffContent } from "@/components/operations/StaffContent";
import { ComplianceContent } from "@/components/operations/ComplianceContent";
import { AuditReadinessContent } from "@/components/operations/AuditReadinessContent";
import { ReportsContent } from "@/components/operations/ReportsContent";
import { TasksContent } from "@/components/operations/TasksContent";
import { AddTaskDialog } from "@/components/operations/AddTaskDialog";
import OpsCalendar from "@/components/OpsCalendar";
// Tracker module — embedded as a sub-view (no per-tracker URL anymore).
import { TrackerShell } from "@/components/tracker/TrackerShell";
import { TrackerCard } from "@/components/tracker/TrackerCard";
import { resolveTrackerIcon } from "@/components/tracker/trackerIcons";
import {
  TrackerLoading,
  TrackerCardSkeleton,
} from "@/components/tracker/TrackerLoading";
import { TrackerEmpty } from "@/components/tracker/TrackerEmpty";
import { useTrackerDefinitions } from "@/lib/tracker/useTrackerDefinitions";
import { useTrackerDefinition } from "@/lib/tracker/useTrackerDefinition";
import { useTrackerEntries } from "@/lib/tracker/useTrackerEntries";
import { useTrackerAlerts } from "@/lib/tracker/useTrackerAlerts";
import { useTrackerAlertSummary } from "@/lib/tracker/useTrackerAlertSummary";
import { TrackerAlertsCard } from "@/components/tracker/TrackerAlertsCard";
import { startOfDay, type TrackerFilters } from "@/components/tracker/TrackerFilterBar";
import { deriveCurrentShift } from "@/components/tracker/selectors/ShiftToggle";
import type {
  SerializedTrackerDefinition,
  TrackerMode,
  Shift,
} from "@shared/tracker-schemas";
import { useFacilityPortalRoute } from "@/hooks/useFacilityPortalRoute";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DashboardData {
  activeResidents: number;
  pendingMedPasses: number;
  overdueTasks: number;
  // todaysOpenTasks: pending tasks whose task_date falls in today's
  // window. Server returns this alongside overdueTasks; older server
  // builds may not include it, hence optional. The sidebar Tasks badge
  // prefers this metric ("today's work") and falls back to overdueTasks.
  todaysOpenTasks?: number;
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
type SubView =
  | "residents"
  | "emar"
  | "tasks"
  | "incidents"
  | "crm"
  | "staff"
  | "compliance"
  | "audit_readiness"
  | "reports"
  | "tracker"
  | "calendar";

// Sidebar navigation items. `key === null` is the Dashboard / overview view.
// Order is the canonical scan order — clinical first, then ops/admin, then
// the Calendar at the bottom.
const NAV_ITEMS: Array<{ key: SubView | null; label: string; icon: React.ElementType }> = [
  { key: null,         label: "Dashboard",   icon: LayoutDashboard },
  { key: "residents",  label: "Residents",   icon: Users },
  { key: "emar",       label: "eMAR",        icon: Pill },
  { key: "tasks",      label: "Tasks",       icon: ClipboardList },
  { key: "incidents",  label: "Incidents",   icon: AlertTriangle },
  { key: "tracker",    label: "Trackers",    icon: Activity },
  { key: "compliance", label: "Compliance",  icon: ShieldCheck },
  { key: "audit_readiness", label: "Audit Readiness", icon: ShieldCheck },
  { key: "crm",        label: "CRM",         icon: UserPlus },
  { key: "staff",      label: "Staff",       icon: UserCog },
  { key: "reports",    label: "Reports",     icon: FileText },
  { key: "calendar",   label: "Calendar",    icon: CalendarIcon },
];

// Per-slug accent — must mirror SLUG_PALETTE in TrackerCard so the sidebar
// dot and the picker card avatar feel like the same visual object. Kept as
// a separate constant here because TrackerCard's palette uses Tailwind bg-*
// utility classes; the sidebar needs the same colors but with smaller
// expressions (a 6px dot rather than a 48px circle).
const TRACKER_DOT_COLOR: Record<string, string> = {
  adl:        "bg-indigo-500",
  vitals:     "bg-rose-500",
  toileting:  "bg-orange-500",
  hygiene:    "bg-amber-500",
  skin_check: "bg-pink-500",
  seizure:    "bg-violet-500",
  sleep:      "bg-blue-500",
  inventory:  "bg-emerald-500",
  cleaning:   "bg-cyan-500",
};

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

function relativeTime(ts: number | null | undefined): string {
  // Defensive: any nullish or non-finite value short-circuits to a placeholder
  // instead of throwing "Invalid time value". A single bad row should never
  // crash the alerts useMemo and blank the whole tab.
  if (ts == null || !Number.isFinite(ts)) return "—";
  const diff = ts - Date.now();
  const abs = Math.abs(diff);
  if (abs < 60_000) return diff >= 0 ? "in <1 min" : "<1 min ago";
  return formatDistanceToNow(new Date(ts), { addSuffix: true });
}

// Local YYYY-MM-DD. Shared shape with EmarContent so the dashboard and EMAR
// share a React Query cache prefix (`["/api/ops/.../med-pass"]`) — invalidations
// from EMAR's chart mutation propagate to the dashboard's TodayStrip count.
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

interface KpiChip {
  label: string;
  subView: SubView;
}

interface KpiTile {
  key: KpiKey;
  label: string;
  count: number;
  subtitle: string;
  icon: React.ElementType;
  tone: "ok" | "info" | "warn" | "danger";
  subView: SubView;
  /**
   * Optional inline chips that appear inside a consolidated tile (e.g. the
   * "Today's care" tile breaks its count into Meds / Tasks / ADL chips, each
   * navigating to its own sub-view). Chips themselves are clickable; the
   * outer tile still navigates to `subView` when clicked outside a chip.
   */
  chips?: KpiChip[];
}

// Worst-tone wins for consolidated tiles — used by both today_care and
// regulatory. `danger > warn > info > ok`. Hoisted so it can be reused.
type Tone = KpiTile["tone"];
const TONE_RANK: Record<Tone, number> = { ok: 0, info: 1, warn: 2, danger: 3 };
function worstTone(...tones: Tone[]): Tone {
  return tones.reduce<Tone>((acc, t) => (TONE_RANK[t] > TONE_RANK[acc] ? t : acc), "ok");
}

// KPI tones — applied only to the *count* and the status dot, never to the
// card border or an icon bubble. The previous design painted the whole card
// with a category color which made the row read as a barcode.
const TONE_STYLES: Record<KpiTile["tone"], { value: string; dot: string }> = {
  ok:     { value: "text-stone-900", dot: "bg-emerald-500" },
  info:   { value: "text-stone-900", dot: "bg-stone-300"   },
  warn:   { value: "text-amber-800", dot: "bg-amber-500"   },
  danger: { value: "text-red-700",   dot: "bg-red-500"     },
};

function KpiCard({
  tile,
  onClick,
  onChipClick,
}: {
  tile: KpiTile;
  onClick: () => void;
  onChipClick?: (sv: SubView) => void;
}) {
  const t = TONE_STYLES[tile.tone];
  const Icon = tile.icon;
  return (
    <Card className="transition-colors hover:bg-stone-50/50">
      <CardContent className="p-4">
        <button
          onClick={onClick}
          className="text-left w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-md"
          aria-label={`${tile.label}: ${tile.count}. ${tile.subtitle}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-medium text-muted-foreground inline-flex items-center gap-1.5">
              <Icon className="h-3.5 w-3.5 text-stone-400" />
              {tile.label}
            </span>
            <span
              className={cn("h-1.5 w-1.5 rounded-full", t.dot)}
              aria-hidden="true"
            />
          </div>
          <p className={cn("text-[26px] font-semibold portal-num leading-none mt-3", t.value)}>
            {tile.count}
          </p>
          <p className="text-[12px] text-muted-foreground leading-snug mt-1.5 truncate">
            {tile.subtitle}
          </p>
        </button>
        {tile.chips && tile.chips.length > 0 && (
          <div className="mt-3 pt-3 border-t flex flex-wrap gap-1.5"
               style={{ borderColor: "var(--portal-border-subtle)" }}>
            {tile.chips.map((c) => (
              <button
                key={c.label}
                onClick={(e) => {
                  e.stopPropagation();
                  onChipClick?.(c.subView);
                }}
                className="text-[11px] px-2 py-0.5 rounded border bg-white text-muted-foreground hover:bg-stone-50 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary portal-num"
                style={{ borderColor: "var(--portal-border-subtle)" }}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function KpiSkeleton() {
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-7 w-12" />
        <Skeleton className="h-3 w-32" />
      </CardContent>
    </Card>
  );
}


// ── Alerts & Exceptions ──────────────────────────────────────────────────────

const URGENCY_BADGE: Record<Urgency, string> = {
  overdue:     "bg-[var(--portal-status-critical-bg)] text-[var(--portal-status-critical)] border-[var(--portal-status-critical-border)]",
  approaching: "bg-[var(--portal-status-warning-bg)]  text-[var(--portal-status-warning)]  border-[var(--portal-status-warning-border)]",
  open:        "bg-[var(--portal-accent-soft)]        text-[var(--portal-accent)]          border-[var(--portal-status-warning-border)]",
  scheduled:   "bg-stone-50 text-stone-600 border-stone-200",
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
    <li className="group flex items-center gap-3 px-5 py-3 hover:bg-stone-50/70 transition-colors border-b last:border-0"
        style={{ borderColor: "var(--portal-border-subtle)" }}>
      <div
        className="h-7 w-7 rounded-md bg-stone-50 border flex items-center justify-center shrink-0"
        style={{ borderColor: "var(--portal-border-subtle)" }}
      >
        <Icon className="h-3.5 w-3.5 text-stone-600" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-stone-900 truncate">{alert.title}</span>
          <Badge
            variant="outline"
            className={cn("h-5 text-[10px] font-medium px-1.5", URGENCY_BADGE[alert.urgency])}
          >
            {URGENCY_LABEL[alert.urgency]}
          </Badge>
        </div>
        <p className="text-[12px] text-muted-foreground truncate mt-0.5">
          {alert.detail} <span aria-hidden="true" className="text-stone-300">·</span> <span className="portal-num">{alert.whenLabel}</span>
        </p>
      </div>
      <Button
        size="sm"
        variant="outline"
        className="shrink-0 h-8 text-xs gap-1"
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
      <UserCog className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
      <select
        aria-label="Role lens"
        value={activeRole}
        onChange={(e) => onChange(e.target.value as Role)}
        className={cn(
          "h-8 text-[13px] rounded-md border bg-white px-2 pr-7 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          isPreviewing
            ? "border-[var(--portal-status-warning-border)] bg-[var(--portal-status-warning-bg)] text-[var(--portal-status-warning)]"
            : "border-stone-200 text-stone-700",
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
}: {
  items: AlertItem[];
  isLoading: boolean;
  onAct: (target: SubView | "notes") => void;
}) {
  return (
    <Card>
      <CardContent className="p-0">
        <div
          className="portal-section-header"
          style={{ borderColor: "var(--portal-border-subtle)" }}
        >
          <div className="portal-section-header__title">
            <Inbox className="h-3.5 w-3.5 text-stone-500" />
            My work
            {!isLoading && items.length > 0 && (
              <Badge
                variant="outline"
                className="h-5 text-[10px] font-medium portal-num bg-stone-50 text-stone-600 border-stone-200"
              >
                {items.length}
              </Badge>
            )}
          </div>
          <span className="text-[11px] text-muted-foreground hidden md:inline">
            Items assigned to you or awaiting acknowledgement
          </span>
        </div>
        {isLoading ? (
          <div className="p-4 space-y-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-3/4" />
          </div>
        ) : items.length === 0 ? (
          <div className="px-5 py-4 flex items-center gap-2 text-[13px] text-muted-foreground">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0" />
            <span>Nothing on your queue.</span>
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
    { keys: ["g", "t"], label: "Go to trackers" },
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
                    className="px-1.5 py-0.5 rounded border bg-stone-50 text-xs font-mono text-stone-700"
                    style={{ borderColor: "var(--portal-border-subtle)" }}
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
            className="w-full text-left rounded-md border bg-white hover:bg-stone-50 transition-colors p-3"
            style={{ borderColor: "var(--portal-border-subtle)" }}
          >
            <div className="flex items-center justify-between mb-2">
              <span className="portal-eyebrow">{g.label}</span>
              <span className="text-[12px] text-muted-foreground portal-num">
                {totals.given}/{totals.total} given
                {totals.late > 0 && (
                  <span className="ml-2 text-[var(--portal-status-critical)] font-medium">
                    {totals.late} late
                  </span>
                )}
                {totals.pending > 0 && (
                  <span className="ml-2 text-[var(--portal-status-warning)]">
                    {totals.pending} pending
                  </span>
                )}
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-stone-100 overflow-hidden">
              <div
                className={cn(
                  "h-full transition-all",
                  totals.late > 0
                    ? "bg-[var(--portal-status-critical)]"
                    : pct === 100
                      ? "bg-[var(--portal-status-ok)]"
                      : "bg-[var(--portal-accent)]",
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
  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("Operations sub-view crashed:", error);
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

// ── Tab-level error boundary ───────────────────────────────────────────────────
// Catches render errors anywhere inside OperationsTab (KPIs, alerts, calendar,
// sub-views) so a single bad data row can't blank the whole tab and bubble up
// past the auth-bearing parent.

interface OpsEBState { hasError: boolean }

class OperationsErrorBoundary extends React.Component<
  { children: React.ReactNode },
  OpsEBState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError(): OpsEBState { return { hasError: true }; }
  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("OperationsTab crashed:", error);
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="space-y-4 py-8">
          <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
            Something went wrong loading Operations. Try reloading the page —
            your session is still active.
          </div>
          <Button
            size="sm"
            variant="outline"
            onClick={() => this.setState({ hasError: false })}
          >
            Try again
          </Button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Tracker picker ────────────────────────────────────────────────────────────

/**
 * TrackerPicker — landing grid of all active tracker definitions for the
 * facility. Modeled on the CaringData tracker hub: page title + description
 * + search box in the header, then a 3-column grid of colored-icon cards.
 *
 * The search filter is client-side over already-fetched definitions, so it's
 * instant. Matches against name, shortName, and category label.
 */
function TrackerPicker({
  definitions,
  isLoading,
  isError,
  alertCountsBySlug,
  onSelectTracker,
  onBack,
}: {
  definitions: SerializedTrackerDefinition[];
  isLoading: boolean;
  isError: boolean;
  alertCountsBySlug: Map<string, number>;
  onSelectTracker: (slug: string, def: SerializedTrackerDefinition) => void;
  onBack: () => void;
}) {
  const [search, setSearch] = useState("");
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return definitions;
    return definitions.filter((d) => {
      const name = d.name.toLowerCase();
      const shortName = (d.shortName ?? "").toLowerCase();
      const cat = d.category.replace(/-/g, " ").toLowerCase();
      return name.includes(q) || shortName.includes(q) || cat.includes(q);
    });
  }, [definitions, search]);

  return (
    <div className="space-y-4">
      <Button
        variant="ghost"
        size="sm"
        onClick={onBack}
        className="gap-1.5 -ml-2"
        aria-label="Back to overview"
      >
        ← Back to Overview
      </Button>

      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div
            className="h-10 w-10 rounded-md bg-stone-50 border flex items-center justify-center text-stone-700 shrink-0"
            style={{ borderColor: "var(--portal-border-subtle)" }}
          >
            <ClipboardList className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h1 className="text-[20px] font-semibold leading-tight text-stone-900">
              Trackers
            </h1>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              Access and manage your trackers.
            </p>
          </div>
        </div>
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search trackers..."
          className="w-full sm:w-72 h-10"
          aria-label="Search trackers"
        />
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <TrackerCardSkeleton key={i} />
          ))}
        </div>
      ) : isError ? (
        <TrackerEmpty
          title="Couldn't load trackers"
          hint="Try refreshing the page."
        />
      ) : definitions.length === 0 ? (
        <TrackerEmpty
          title="No trackers configured for your facility"
          hint="Trackers are added centrally — check back soon."
        />
      ) : filtered.length === 0 ? (
        <TrackerEmpty
          title={`No trackers match "${search}"`}
          hint="Try a different search term."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map((def) => (
            <TrackerCard
              key={def.slug}
              definition={def}
              activeAlertCount={alertCountsBySlug.get(def.slug) ?? 0}
              onSelect={(s) => onSelectTracker(s, def)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Tracker sub-view ──────────────────────────────────────────────────────────

/**
 * Tracker sub-view. Two modes:
 *   • slug == null → render a picker (one card per active tracker definition).
 *     If exactly one definition exists, auto-select it on mount so the user
 *     doesn't see a one-card picker.
 *   • slug != null → fetch the definition and render <TrackerShell> in
 *     fully-controlled mode.
 */
function TrackerSubView({
  slug,
  tab,
  filters,
  alertCountsBySlug,
  onSelectTracker,
  onTabChange,
  onFiltersChange,
  onBack,
  onViewAllAlerts,
}: {
  slug: string | null;
  tab: TrackerMode;
  filters: TrackerFilters;
  /** Active alert counts keyed by tracker slug — surfaces the red badge on each card. */
  alertCountsBySlug: Map<string, number>;
  onSelectTracker: (slug: string, def: SerializedTrackerDefinition) => void;
  onTabChange: (next: TrackerMode) => void;
  onFiltersChange: (
    patch: Partial<{ date: number; shift: Shift; residentId: number | undefined }>,
  ) => void;
  onBack: () => void;
  /**
   * Bug #2: clicking "View all" inside the in-tracker red banner pre-filters
   * the overview's TrackerAlertsCard to this tracker's slug, unwinds the
   * sub-view, and scrolls the card into view. Owned by OperationsTab so the
   * filter persists across navigation.
   */
  onViewAllAlerts: (slug: string) => void;
}) {
  // Picker-mode list. Always fetched (cached 5 min) so auto-select works.
  const {
    data: defsEnv,
    isLoading: defsLoading,
    isError: defsError,
  } = useTrackerDefinitions();
  const definitions = defsEnv?.data ?? [];

  // Auto-select the only tracker if there's exactly one — saves a click.
  useEffect(() => {
    if (slug !== null) return;
    if (definitions.length === 1) {
      const def = definitions[0];
      onSelectTracker(def.slug, def);
    }
    // Intentionally only depend on the lengths — onSelectTracker is recreated
    // each render and would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, definitions.length]);

  const {
    data: defEnv,
    isLoading: defLoading,
    isError: defError,
  } = useTrackerDefinition(slug ?? undefined);

  if (slug === null) {
    return <TrackerPicker
      definitions={definitions}
      isLoading={defsLoading}
      isError={defsError}
      alertCountsBySlug={alertCountsBySlug}
      onSelectTracker={onSelectTracker}
      onBack={onBack}
    />;
  }

  if (defLoading) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="gap-1.5 -ml-2"
          aria-label="Back to overview"
        >
          ← Back to Overview
        </Button>
        <TrackerLoading rows={4} />
      </div>
    );
  }

  if (defError || !defEnv?.data) {
    return (
      <div className="space-y-4">
        <Button
          variant="ghost"
          size="sm"
          onClick={onBack}
          className="gap-1.5 -ml-2"
          aria-label="Back to overview"
        >
          ← Back to Overview
        </Button>
        <TrackerEmpty
          title="Tracker not found"
          hint={`No tracker with slug "${slug}" is registered for your facility.`}
        />
      </div>
    );
  }

  return (
    <TrackerShell
      definition={defEnv.data}
      tab={tab}
      onTabChange={onTabChange}
      filters={filters}
      onFiltersChange={onFiltersChange}
      onBack={onBack}
      activeAlertCount={alertCountsBySlug.get(defEnv.data.slug) ?? 0}
      onViewAllAlerts={() => onViewAllAlerts(defEnv.data.slug)}
    />
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

function OperationsTabInner({ facilityNumber }: { facilityNumber: string }) {
  // URL-driven sub-view + selected tracker (Bug 3). A hard refresh on any
  // operations URL restores the exact module the operator was on. Internal
  // axes that don't deep-link (calendar date, tracker tab/filters) stay in
  // useState below.
  const route = useFacilityPortalRoute();
  const subView: SubView | null = route.subView;
  const selectedTrackerSlug: string | null = route.trackerSlug;

  // Day-scoped sub-views (currently just emar) read this to open on the
  // correct date when navigation comes from a calendar chip. Transient —
  // intentionally not in the URL.
  const [subViewDate, setSubViewDate] = useState<string | null>(null);
  const [trackerTab, setTrackerTab] = useState<TrackerMode>("quick");
  const [trackerFilters, setTrackerFilters] = useState<TrackerFilters>(() => ({
    date: startOfDay(Date.now()),
    shift: deriveCurrentShift(),
  }));
  const [showShortcuts, setShowShortcuts] = useState(false);
  const [showAllAlerts, setShowAllAlerts] = useState(false);
  const [needsAttentionOpen, setNeedsAttentionOpen] = useState(true);
  // Sidebar: "Trackers" expands to show each tracker as a sub-item. Auto-
  // expanded whenever the user is inside the tracker sub-view so the active
  // tracker is always visible in the rail.
  const [trackersNavOpen, setTrackersNavOpen] = useState(false);
  const [lensOverride, setLensOverride] = useState<Role | null>(null);
  const [addTaskOpen, setAddTaskOpen] = useState(false);
  // Bug #2: when the in-tracker "View all" banner is clicked we unwind to
  // the overview AND set this filter slug so the TrackerAlertsCard scopes to
  // that tracker. Cleared via the chip's X.
  const [alertsFilterSlug, setAlertsFilterSlug] = useState<string | null>(null);
  const trackerAlertsCardRef = useRef<HTMLDivElement | null>(null);

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

  // Cache key is `[base, date]` so it shares a prefix with EmarContent.tsx —
  // EMAR's chart mutation invalidates the `[base]` prefix, which propagates to
  // both this dashboard query and EMAR's own day-scoped query in one call.
  // Custom queryFn so the date stays a `?date=` query param on the URL and
  // doesn't accidentally become a path segment (the previous bug that made
  // this endpoint 404 silently).
  const medPassDate = todayIso();
  const { data: medEnv, isLoading: medLoading } = useQuery<
    { success: boolean; data: MedPassEntry[] } | null
  >({
    queryKey: [`/api/ops/facilities/${facilityNumber}/med-pass`, medPassDate],
    queryFn: async () => {
      const res = await fetch(
        `/api/ops/facilities/${facilityNumber}/med-pass?date=${medPassDate}`,
        { credentials: "include" },
      );
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
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

  // ADL tracker entries logged in the current shift today — drives the
  // "Tracker" KPI tile. Bounded by [todayStart, todayEnd] so the count
  // resets cleanly on a date change. Reuses the same hook the tracker
  // sub-view uses, so cache stays warm when the user drills in.
  const todayStartMs = startOfDay(Date.now());
  const todayEndMs = todayStartMs + 86_400_000;
  const currentShift = deriveCurrentShift();
  const trackerEntriesQuery = useTrackerEntries({
    slug: "adl",
    from: todayStartMs,
    to: todayEndMs,
    shift: currentShift,
    limit: 50,
    enabled,
  });
  const trackerThisShiftCount =
    trackerEntriesQuery.data?.pages?.[0]?.data?.items?.length ?? 0;
  const trackerLoading = trackerEntriesQuery.isLoading;

  // Active tracker alerts — used both for the unified alerts list (only the
  // criticals merge into "Needs attention") and as the per-slug count source
  // for the tracker picker badges. Same query the dedicated card uses, so
  // React Query dedupes.
  const trackerAlertsQuery = useTrackerAlerts(
    { status: "active", limit: 100 },
    { enabled, staleTime: 30_000 },
  );
  const activeTrackerAlerts = trackerAlertsQuery.data?.data?.items ?? [];

  // Lightweight summary for the "Tracker alerts" KPI tile — counts only,
  // separate from the detailed list query so the KPI doesn't pay the cost
  // of pulling 100 items just to render a number. Auto-refreshes 60 s.
  const trackerAlertSummaryQuery = useTrackerAlertSummary({ enabled });
  const trackerAlertSummary =
    trackerAlertSummaryQuery.data?.data ??
    { active: 0, critical: 0, warn: 0, info: 0 };

  // Slug → active alert count map for TrackerCard badges.
  const trackerAlertCountsBySlug = useMemo(() => {
    const map = new Map<string, number>();
    for (const a of activeTrackerAlerts) {
      map.set(a.trackerSlug, (map.get(a.trackerSlug) ?? 0) + 1);
    }
    return map;
  }, [activeTrackerAlerts]);

  const dashboard = dashEnv?.data ?? null;
  const medPasses = medEnv?.data ?? [];
  const incidents = incEnv?.data ?? [];
  const overdueCompliance = ovdCompEnv?.data ?? [];
  const allCompliance = compEnv?.data ?? [];
  const staff = staffEnv?.data ?? [];
  const notes = notesEnv?.data?.items ?? [];

  // ── Sidebar counts ─────────────────────────────────────────────────────────
  // Same metric per sidebar item that the matching KPI card shows. Keyed by
  // SubView so the sidebar render can look up count + tone without inlining
  // dashboard logic. Items without a meaningful count (Dashboard, Staff,
  // Calendar) are omitted and render label-only.
  type NavTone = "ok" | "info" | "warn" | "danger";
  const navCounts: Partial<Record<SubView, { count: number; tone: NavTone }>> = useMemo(() => {
    const out: Partial<Record<SubView, { count: number; tone: NavTone }>> = {};
    if (dashboard) {
      out.residents = { count: dashboard.activeResidents, tone: "info" };

      const lateMissed = medPasses.filter(
        (m) => m.status === "late" || m.status === "missed",
      ).length;
      out.emar = {
        count: dashboard.pendingMedPasses,
        tone: lateMissed > 0
          ? "danger"
          : dashboard.pendingMedPasses > 0
            ? "info"
            : "ok",
      };

      // Sidebar Tasks badge: prefer todaysOpenTasks (today's pending
      // work) over overdueTasks. A task dated today isn't overdue but
      // the operator still needs to see it; the KPI tile below keeps
      // the strict "Overdue Tasks" semantic via dashboard.overdueTasks.
      // Falls back to overdueTasks for older server builds that don't
      // include the new field. Tone is "danger" only when there's
      // actually past-due work — today's open count alone shouldn't
      // colour the rail red.
      const taskCount = dashboard.todaysOpenTasks ?? dashboard.overdueTasks;
      out.tasks = {
        count: taskCount,
        tone: dashboard.overdueTasks > 0
          ? "danger"
          : taskCount > 0
            ? "info"
            : "ok",
      };

      out.incidents = {
        count: dashboard.openIncidents,
        tone: dashboard.openIncidents > 0 ? "danger" : "ok",
      };

      out.crm = {
        count: dashboard.pendingLeads,
        tone: dashboard.pendingLeads > 0 ? "info" : "ok",
      };

      out.compliance = {
        count: dashboard.overdueCompliance,
        tone: dashboard.overdueCompliance > 0 ? "warn" : "ok",
      };
    }
    out.tracker = {
      count: trackerAlertSummary.active,
      tone: trackerAlertSummary.critical > 0
        ? "danger"
        : trackerAlertSummary.warn > 0
          ? "warn"
          : trackerAlertSummary.active > 0
            ? "info"
            : "ok",
    };
    return out;
  }, [dashboard, medPasses, trackerAlertSummary]);

  const goToSubView = (sv: SubView, date: string | null = null) => {
    setSubViewDate(date);
    // Entering tracker via the overview always lands on the picker; users
    // can re-enter the same tracker if they want by clicking its card.
    // The hook's cross-axis invariants also auto-clear trackerSlug when
    // subView !== "tracker", and clear residentId when subView !== "residents".
    route.navigate({
      tab: "operations",
      subView: sv,
      trackerSlug: null,
    });
  };

  // Tracker definitions feed the sidebar's expandable Trackers sub-list. The
  // query is also called inside TrackerSubView; React Query dedupes by key.
  const { data: trackerDefsEnv } = useTrackerDefinitions();
  const trackerDefinitions = trackerDefsEnv?.data ?? [];

  // Direct-navigate to a specific tracker (used by sidebar sub-items). Sets
  // the same state TrackerSubView's onSelectTracker does, so deep-linking
  // from the rail behaves identically to picking a card from the grid.
  const navigateToTracker = (def: SerializedTrackerDefinition) => {
    const defaultMode = (def.defaultMode as TrackerMode | undefined) ?? "quick";
    setTrackerTab(defaultMode);
    setTrackerFilters({
      date: startOfDay(Date.now()),
      shift: deriveCurrentShift(),
    });
    setSubViewDate(null);
    route.navigate({
      tab: "operations",
      subView: "tracker",
      trackerSlug: def.slug,
    });
  };

  // Auto-expand the Trackers nav group when the user is inside a tracker
  // sub-view, so the active tracker is always visible in the rail.
  useEffect(() => {
    if (subView === "tracker") setTrackersNavOpen(true);
  }, [subView]);

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
        setSubViewDate(null);
        route.navigate({ tab: "operations", subView: "emar" });
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
          t: "tracker",
        };
        const dest = map[e.key];
        prefix = null;
        if (prefixTimeout) clearTimeout(prefixTimeout);
        if (dest) {
          e.preventDefault();
          if (dest === "notes") {
            openNotesBell();
          } else {
            setSubViewDate(null);
            route.navigate({
              tab: "operations",
              subView: dest,
              trackerSlug: null,
            });
          }
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (prefixTimeout) clearTimeout(prefixTimeout);
    };
    // route.navigate is stable across renders (useCallback with empty deps
    // inside useFacilityPortalRoute), so reading it via the captured `route`
    // snapshot is safe — but we depend on `route` here to keep ESLint happy
    // about the closure capture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Smart KPI tiles ────────────────────────────────────────────────────────
  // 7 tiles, one per metric, in canonical scan order. Per-role lenses in
  // roleLens.ts trim/reorder for each role's workflow. Tracker alerts +
  // staff license expiries surface in the dedicated TrackerAlertsCard and
  // the cross-module "Needs attention" panel rather than competing for KPI
  // grid real-estate.
  const kpiTiles: KpiTile[] = useMemo(() => {
    if (!dashboard) return [];
    const lateMissed = medPasses.filter(
      (m) => m.status === "late" || m.status === "missed",
    ).length;
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
        subtitle:
          dashboard.activeResidents === 0
            ? "No residents on census"
            : "On census today",
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
        tone:
          lateMissed > 0
            ? "danger"
            : approachingMeds > 0
              ? "warn"
              : dashboard.pendingMedPasses > 0
                ? "info"
                : "ok",
        subView: "emar",
      },
      {
        key: "tasks",
        // KPI mirrors the sidebar Tasks badge: today's pending workload,
        // falling back to overdueTasks for older server builds. Tone stays
        // tied to actual past-due work so a normal today queue doesn't go red.
        label: "Open Tasks Today",
        count: dashboard.todaysOpenTasks ?? dashboard.overdueTasks,
        subtitle:
          (dashboard.todaysOpenTasks ?? dashboard.overdueTasks) > 0
            ? dashboard.overdueTasks > 0
              ? "Includes past due"
              : "Due today"
            : "Caught up",
        icon: ClipboardList,
        tone: dashboard.overdueTasks > 0 ? "danger" : "ok",
        subView: "tasks",
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
        subtitle:
          dashboard.pendingLeads > 0 ? "Awaiting follow-up" : "Pipeline clear",
        icon: UserPlus,
        tone: dashboard.pendingLeads > 0 ? "info" : "ok",
        subView: "crm",
      },
      {
        key: "compliance",
        label: "Overdue Compliance",
        count: dashboard.overdueCompliance,
        subtitle:
          dashboard.overdueCompliance > 0
            ? "Regulatory exposure"
            : "On track",
        icon: ShieldCheck,
        tone: dashboard.overdueCompliance > 0 ? "warn" : "ok",
        subView: "compliance",
      },
    ];
  }, [dashboard, medPasses, staff, trackerThisShiftCount, trackerAlertSummary]);

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
      const typeLabel = (inc.incidentType ?? "incident").replace(/_/g, " ");
      out.push({
        id: `inc-notify-${inc.id}`,
        tier: "regulatory",
        urgency: "open",
        icon: AlertTriangle,
        title: `${typeLabel}${inc.residentName ? ` · ${inc.residentName}` : ""}`,
        detail: `Missing notification: ${missing.join(", ")}`,
        whenLabel: relativeTime(inc.incidentDate),
        actionLabel: "Open",
        subView: "incidents",
        sortKey: inc.incidentDate,
      });
    }

    for (const inc of incidents) {
      if (!inc.lic624Required || inc.lic624Submitted) continue;
      const typeLabel = (inc.incidentType ?? "incident").replace(/_/g, " ");
      out.push({
        id: `inc-lic-${inc.id}`,
        tier: "regulatory",
        urgency: "approaching",
        icon: ShieldCheck,
        title: `LIC 624 needed · ${typeLabel}`,
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
      const body = n.body ?? "";
      out.push({
        id: `note-${n.id}`,
        tier: "care",
        urgency: "open",
        icon: MessageSquare,
        title: "Urgent note awaiting acknowledgement",
        detail: body.slice(0, 80) + (body.length > 80 ? "…" : ""),
        whenLabel: relativeTime(n.createdAt),
        actionLabel: "Open",
        subView: "notes",
        sortKey: n.createdAt,
      });
    }

    // Critical tracker alerts merge into the unified list as `tier: clinical`
    // with `urgency: overdue` so they sort to the top alongside late meds.
    // Warn / info tracker alerts stay in the dedicated <TrackerAlertsCard />
    // to avoid drowning the Needs-attention panel.
    for (const ta of activeTrackerAlerts) {
      if (ta.severity !== "critical") continue;
      out.push({
        id: `trk-alert-${ta.id}`,
        tier: "clinical",
        urgency: "overdue",
        icon: AlertTriangle,
        title: ta.message,
        detail: ta.detail ?? `Tracker: ${ta.trackerSlug}`,
        whenLabel: relativeTime(ta.createdAt),
        actionLabel: "Review",
        subView: "tracker",
        sortKey: ta.createdAt,
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
  }, [medPasses, incidents, overdueCompliance, allCompliance, staff, notes, activeTrackerAlerts, lens]);

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
      const typeLabel = (inc.incidentType ?? "incident").replace(/_/g, " ");
      out.push({
        id: `mine-inc-${inc.id}`,
        tier: "regulatory",
        urgency: "open",
        icon: AlertTriangle,
        title: `${typeLabel}${inc.residentName ? ` · ${inc.residentName}` : ""}`,
        detail: "You reported this — still open",
        whenLabel: relativeTime(inc.incidentDate),
        actionLabel: "Open",
        subView: "incidents",
        sortKey: inc.incidentDate,
      });
    }

    for (const n of notes) {
      if (n.status !== "open") continue;
      const isMine = (n.authorDisplayName ?? "").toLowerCase() === usernameLc;
      const needsAck = n.priority === "urgent" && n.ackRequired === 1;
      if (!isMine && !needsAck) continue;
      const body = n.body ?? "";
      out.push({
        id: `mine-note-${n.id}`,
        tier: "care",
        urgency: needsAck ? "open" : "scheduled",
        icon: MessageSquare,
        title: needsAck ? "Acknowledge urgent note" : "Your note",
        detail: body.slice(0, 80) + (body.length > 80 ? "…" : ""),
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
  const subViewBack = () => {
    setSubViewDate(null);
    route.navigate({ tab: "operations", subView: null, trackerSlug: null });
  };
  const trackerBack = () => {
    // Inside the tracker sub-view, "Back" returns to the tracker picker.
    // From the picker, it returns to the overview.
    if (selectedTrackerSlug !== null) {
      route.navigate({
        tab: "operations",
        subView: "tracker",
        trackerSlug: null,
      });
    } else {
      subViewBack();
    }
  };
  const subViewContent: React.ReactNode =
    subView === "residents"  ? <ResidentsContent  facilityNumber={facilityNumber} onBack={subViewBack} /> :
    subView === "emar"       ? <EmarContent       facilityNumber={facilityNumber} onBack={subViewBack} initialDate={subViewDate ?? undefined} /> :
    subView === "tasks"      ? <TasksContent      facilityNumber={facilityNumber} onBack={subViewBack} /> :
    subView === "incidents"  ? <IncidentsContent  facilityNumber={facilityNumber} onBack={subViewBack} /> :
    subView === "crm"        ? <CrmContent        facilityNumber={facilityNumber} onBack={subViewBack} /> :
    subView === "staff"      ? <StaffContent      facilityNumber={facilityNumber} onBack={subViewBack} /> :
    subView === "compliance" ? <ComplianceContent facilityNumber={facilityNumber} onBack={subViewBack} /> :
    subView === "audit_readiness" ? <AuditReadinessContent facilityNumber={facilityNumber} onBack={subViewBack} /> :
    subView === "reports"    ? <ReportsContent      facilityNumber={facilityNumber} onBack={subViewBack} /> :
    subView === "calendar"   ? (
      <OpsCalendar
        facilityNumber={facilityNumber}
        onNavigate={(sv, date) => {
          goToSubView(sv as SubView, date ?? null);
        }}
      />
    ) :
    subView === "tracker"    ? (
      <TrackerSubView
        slug={selectedTrackerSlug}
        tab={trackerTab}
        filters={trackerFilters}
        alertCountsBySlug={trackerAlertCountsBySlug}
        onSelectTracker={(slug, def) => {
          // Seed tab from the definition's defaultMode (falls back to quick).
          const defaultMode = (def.defaultMode as TrackerMode | undefined) ?? "quick";
          setTrackerTab(defaultMode);
          // Re-seed filters in case the user has been on the picker for a
          // while — pick up "today" + the current shift fresh on entry.
          setTrackerFilters({
            date: startOfDay(Date.now()),
            shift: deriveCurrentShift(),
          });
          route.navigate({
            tab: "operations",
            subView: "tracker",
            trackerSlug: slug,
          });
        }}
        onTabChange={setTrackerTab}
        onFiltersChange={(patch) =>
          setTrackerFilters((prev) => ({ ...prev, ...patch }))
        }
        onBack={trackerBack}
        onViewAllAlerts={(s) => {
          // Bug #2: scope the overview's TrackerAlertsCard to this slug,
          // unwind sub-view, and scroll the card into view next frame
          // (after the overview re-renders).
          setAlertsFilterSlug(s);
          subViewBack();
          requestAnimationFrame(() => {
            trackerAlertsCardRef.current?.scrollIntoView({
              behavior: "smooth",
              block: "start",
            });
          });
        }}
      />
    ) :
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
    <div className="space-y-6">
      {/* ── Page header ──────────────────────────────────────────────────
       * Identity is carried by the FacilityPortal top bar above; this
       * header focuses on the *operational state*: today's date, status
       * sentence, and role-lens / shortcuts utilities.
       */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="min-w-0">
          <p className="portal-eyebrow inline-flex items-center gap-1.5">
            <CalendarIcon className="h-3 w-3" aria-hidden="true" />
            {dateLabel}
            <span aria-hidden="true" className="text-stone-300">·</span>
            <span className="portal-num">{currentShift}</span> shift
            <span aria-hidden="true" className="text-stone-300">·</span>
            <Users className="h-3 w-3" aria-hidden="true" />
            <span className="portal-num">{dashboard?.activeResidents ?? "—"}</span> on census
          </p>
          <h2 className="text-[18px] font-semibold mt-1.5 text-stone-900 leading-tight">
            {greeting()}{me?.username ? `, ${me.username}` : ""}.{" "}
            {alertsLoading ? (
              <span className="text-muted-foreground font-normal">Checking status…</span>
            ) : alerts.length === 0 ? (
              <span className="text-[var(--portal-status-ok)] font-normal">All clear today.</span>
            ) : (
              <span className="text-muted-foreground font-normal">
                {overdueCount > 0 && (
                  <>
                    <span className="text-[var(--portal-status-critical)] font-medium portal-num">{overdueCount}</span>{" "}
                    overdue
                  </>
                )}
                {overdueCount > 0 && approachingCount > 0 && <>, </>}
                {approachingCount > 0 && (
                  <>
                    <span className="text-[var(--portal-status-warning)] font-medium portal-num">{approachingCount}</span>{" "}
                    approaching
                  </>
                )}
                .
              </span>
            )}
          </h2>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {isAdmin && (
            <div className="flex items-center gap-2">
              <span className="portal-eyebrow hidden md:inline">View as</span>
              <RoleLensSwitcher
                activeRole={activeRole}
                userRole={userRole}
                isPreviewing={isPreviewing}
                onChange={(r) => setLensOverride(r === userRole ? null : r)}
              />
            </div>
          )}

          {/* Quick actions — primary action surfaced as a solid button,
              the rest live under a "More" dropdown. Trackers is reachable
              via its own KPI tile, so we never duplicate it here. */}
          {(() => {
            const primaryKey = lens.quickActions[0];
            const primary = primaryKey ? QUICK_ACTIONS[primaryKey] : null;
            const rest = lens.quickActions.slice(1);
            const PIcon = primary?.icon ?? Plus;
            return (
              <>
                {primary && (
                  <Button
                    size="sm"
                    variant="default"
                    onClick={() => navigateTarget(primary.subView)}
                    className="gap-1.5 h-8"
                  >
                    <PIcon className="h-4 w-4" />
                    {primary.label}
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      size="sm"
                      variant="outline"
                      className="gap-1 h-8"
                      aria-label="More quick actions"
                    >
                      More
                      <ChevronDown className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    {rest.map((key) => {
                      const a = QUICK_ACTIONS[key];
                      const A = a.icon;
                      return (
                        <DropdownMenuItem
                          key={key}
                          onClick={() => navigateTarget(a.subView)}
                          className="gap-2 cursor-pointer"
                        >
                          <A className="h-4 w-4 text-stone-500" />
                          {a.label}
                        </DropdownMenuItem>
                      );
                    })}
                    <DropdownMenuItem
                      onClick={() => setAddTaskOpen(true)}
                      className="gap-2 cursor-pointer"
                    >
                      <ClipboardList className="h-4 w-4 text-stone-500" />
                      Add task
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            );
          })()}

          <Button
            size="icon"
            variant="ghost"
            onClick={() => setShowShortcuts(true)}
            className="h-8 w-8 text-muted-foreground hover:text-foreground"
            aria-label="Keyboard shortcuts"
            title="Keyboard shortcuts (?)"
          >
            <Keyboard className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {isPreviewing && (
        <div
          className="rounded-md border px-3 py-2 text-[12px] flex items-center justify-between gap-2"
          style={{
            borderColor: "var(--portal-status-warning-border)",
            background: "var(--portal-status-warning-bg)",
            color: "var(--portal-status-warning)",
          }}
        >
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

      {/* ── Mobile nav strip (horizontal scroll) ──────────────────────── */}
      <div className="lg:hidden -mx-1 px-1 overflow-x-auto">
        <div className="inline-flex gap-1.5 whitespace-nowrap pb-1">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const isActive = subView === item.key;
            return (
              <button
                key={item.key ?? "dashboard"}
                type="button"
                onClick={() => {
                  if (item.key === null) subViewBack();
                  else goToSubView(item.key);
                }}
                className={cn(
                  "inline-flex items-center gap-1.5 px-3 h-8 rounded-full border text-[12px] transition-colors",
                  isActive
                    ? "bg-stone-900 text-white border-stone-900"
                    : "bg-white text-stone-700 border-stone-200 hover:bg-stone-50",
                )}
                aria-current={isActive ? "page" : undefined}
              >
                <Icon className="h-3.5 w-3.5" />
                {item.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="flex gap-6">
        {/* ── Sidebar (lg+) ─────────────────────────────────────────────── */}
        <aside className="hidden lg:block w-60 shrink-0">
          <nav className="space-y-2 sticky top-4" aria-label="Operations navigation">
            {NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = subView === item.key;
              const data = item.key ? navCounts[item.key] : undefined;
              const isTrackersItem = item.key === "tracker";
              const trackersExpanded =
                isTrackersItem && trackersNavOpen && trackerDefinitions.length > 0;
              const countClass = !data
                ? ""
                : isActive
                  ? "text-white"
                  : data.tone === "danger"
                    ? "text-red-700"
                    : data.tone === "warn"
                      ? "text-amber-800"
                      : data.tone === "info"
                        ? "text-stone-900"
                        : "text-stone-400";
              const dotClass = !data
                ? ""
                : data.tone === "danger"
                  ? "bg-red-500"
                  : data.tone === "warn"
                    ? "bg-amber-500"
                    : data.tone === "info"
                      ? "bg-stone-300"
                      : "bg-emerald-500";
              return (
                <div key={item.key ?? "dashboard"}>
                  <div
                    className={cn(
                      "w-full flex items-stretch rounded-lg border transition-all overflow-hidden",
                      isActive
                        ? "bg-stone-900 text-white border-stone-900 shadow-sm"
                        : "bg-white text-stone-800 border-stone-200 hover:bg-stone-50 hover:border-stone-300",
                    )}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        if (item.key === null) subViewBack();
                        else goToSubView(item.key);
                        if (isTrackersItem) setTrackersNavOpen(true);
                      }}
                      className="flex items-center gap-3 p-3 text-left flex-1 min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
                      aria-current={isActive ? "page" : undefined}
                    >
                      <span
                        className={cn(
                          "h-9 w-9 rounded-md flex items-center justify-center shrink-0",
                          isActive ? "bg-white/15" : "bg-stone-100",
                        )}
                        aria-hidden="true"
                      >
                        <Icon
                          className={cn(
                            "h-4 w-4",
                            isActive ? "text-white" : "text-stone-600",
                          )}
                        />
                      </span>
                      <span className="font-medium text-[13px] truncate flex-1">
                        {item.label}
                      </span>
                      {data ? (
                        <span className="flex items-center gap-1.5 shrink-0">
                          <span
                            className={cn(
                              "h-1.5 w-1.5 rounded-full",
                              isActive ? "bg-white/50" : dotClass,
                            )}
                            aria-hidden="true"
                          />
                          <span
                            className={cn(
                              "text-[14px] font-semibold portal-num leading-none",
                              countClass,
                            )}
                          >
                            {data.count}
                          </span>
                        </span>
                      ) : null}
                    </button>
                    {isTrackersItem && trackerDefinitions.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setTrackersNavOpen((v) => !v)}
                        className={cn(
                          "px-2 flex items-center justify-center shrink-0 border-l focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary",
                          isActive
                            ? "border-white/20 hover:bg-white/10"
                            : "border-stone-200 hover:bg-stone-100",
                        )}
                        aria-label={trackersExpanded ? "Collapse trackers list" : "Expand trackers list"}
                        aria-expanded={trackersExpanded}
                      >
                        {trackersExpanded ? (
                          <ChevronUp className="h-4 w-4" />
                        ) : (
                          <ChevronDown className="h-4 w-4" />
                        )}
                      </button>
                    )}
                  </div>

                  {/* Trackers sub-list — each tracker definition rendered as
                      an indented row with its own icon + colored dot. Click
                      navigates directly to that tracker (not the picker). */}
                  {trackersExpanded && (
                    <ul className="mt-1 ml-3 pl-3 border-l space-y-0.5"
                        style={{ borderColor: "var(--portal-border-subtle)" }}>
                      {trackerDefinitions.map((def) => {
                        const TIcon = resolveTrackerIcon(def.icon);
                        const isThisActive =
                          subView === "tracker" && selectedTrackerSlug === def.slug;
                        const dotColor = TRACKER_DOT_COLOR[def.slug] ?? "bg-stone-400";
                        return (
                          <li key={def.slug}>
                            <button
                              type="button"
                              onClick={() => navigateToTracker(def)}
                              className={cn(
                                "w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-left text-[12.5px] transition-colors",
                                isThisActive
                                  ? "bg-stone-100 text-stone-900 font-medium"
                                  : "text-stone-600 hover:bg-stone-50 hover:text-stone-900",
                              )}
                              aria-current={isThisActive ? "page" : undefined}
                            >
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full shrink-0",
                                  dotColor,
                                )}
                                aria-hidden="true"
                              />
                              <TIcon className="h-3.5 w-3.5 text-stone-400 shrink-0" />
                              <span className="truncate">{def.shortName ?? def.name}</span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>

        {/* ── Main content ─────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 space-y-6">
      {subView && subViewContent ? (
        <SubViewErrorBoundary key={subView} onBack={subViewBack}>
          {subViewContent}
        </SubViewErrorBoundary>
      ) : (
        <>
      {/* ── Alerts (unified) ───────────────────────────────────────────────
       * Single container holds two sub-sections — cross-module "Needs
       * attention" on top, "Tracker alerts" below — separated by a hairline
       * rule. Matches the CaringData pattern of co-locating related alert
       * surfaces under one card so the page reads as one decision per row.
       */}
      <section aria-label="Alerts and exceptions">
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div
              className="portal-section-header"
              style={{ borderColor: "var(--portal-border-subtle)" }}
            >
              <button
                type="button"
                onClick={() => setNeedsAttentionOpen((v) => !v)}
                className="portal-section-header__title flex items-center gap-1.5 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
                aria-expanded={needsAttentionOpen}
                aria-controls="needs-attention-body"
              >
                {needsAttentionOpen ? (
                  <ChevronUp className="h-3.5 w-3.5 text-stone-500" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 text-stone-500" />
                )}
                <Bell className="h-3.5 w-3.5 text-stone-500" />
                Needs attention
                {!alertsLoading && alerts.length > 0 && (
                  <Badge
                    variant="outline"
                    className="h-5 text-[10px] font-medium portal-num bg-stone-50 text-stone-600 border-stone-200"
                  >
                    {alerts.length}
                  </Badge>
                )}
                {!alertsLoading && overdueCount > 0 && (
                  <Badge
                    className="h-5 text-[10px] font-medium portal-num bg-[var(--portal-status-critical-bg)] text-[var(--portal-status-critical)] border-[var(--portal-status-critical-border)] hover:bg-[var(--portal-status-critical-bg)]"
                  >
                    {overdueCount} overdue
                  </Badge>
                )}
              </button>
              {needsAttentionOpen && !alertsLoading && alerts.length > 6 && (
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

            {needsAttentionOpen && (
              <div id="needs-attention-body">
                {alertsLoading ? (
                  <div className="p-4 space-y-2">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-10 w-3/4" />
                  </div>
                ) : alerts.length === 0 ? (
                  <div className="px-5 py-4 flex items-center gap-3">
                    <CheckCircle2 className="h-4 w-4 text-[var(--portal-status-ok)] shrink-0" />
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium leading-tight text-stone-900">All caught up</p>
                      <p className="text-[12px] text-muted-foreground mt-0.5">
                        {medPasses.length > 0 ? (
                          <>
                            Next med pass at{" "}
                            <span className="font-medium text-stone-700 portal-num">
                              {medPasses.find((m) => m.status === "pending")?.scheduledTime ?? "—"}
                            </span>
                            .
                          </>
                        ) : (
                          <>Nothing urgent right now.</>
                        )}
                      </p>
                    </div>
                  </div>
                ) : (
                  <ul>
                    {visibleAlerts.map((a) => (
                      <AlertRow key={a.id} alert={a} onAct={navigateTarget} />
                    ))}
                  </ul>
                )}
              </div>
            )}

            {/* Tracker alerts — embedded as a sub-section under the same Card,
                divided by a hairline rule. */}
            <div
              className="border-t"
              style={{ borderColor: "var(--portal-border-subtle)" }}
            />
            <TrackerAlertsCard
              ref={trackerAlertsCardRef}
              facilityNumber={facilityNumber}
              slug={alertsFilterSlug ?? undefined}
              onClearFilter={
                alertsFilterSlug ? () => setAlertsFilterSlug(null) : undefined
              }
              embedded
            />
          </CardContent>
        </Card>
      </section>

      {/* ── KPIs ────────────────────────────────────────────────────────
       * 2 × 4 symmetric grid on lg+. Lens-filtered operational counts in
       * scan order, with a "Trackers" tile appended as the entry point to
       * the tracker sub-view (replaces the duplicate "Trackers" button
       * that used to live in the sticky action bar). For roles whose
       * lens trims the KPI list, the grid wraps naturally — no dangling
       * rows.
       */}
      <section aria-label="Key indicators">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
          {dashLoading ? (
            Array.from({ length: 8 }).map((_, i) => <KpiSkeleton key={i} />)
          ) : orderedKpis.length > 0 ? (
            <>
              {orderedKpis.map((t) => (
                <KpiCard
                  key={t.label}
                  tile={t}
                  onClick={() => goToSubView(t.subView)}
                  onChipClick={(sv) => goToSubView(sv)}
                />
              ))}
              {/* Trackers tile — count is total active tracker alerts; tone
                  follows severity. Renders even when zero so the entry
                  point is always discoverable. */}
              {(() => {
                const trkCount = trackerAlertSummary.active;
                const trkTone: KpiTile["tone"] =
                  trackerAlertSummary.critical > 0
                    ? "danger"
                    : trackerAlertSummary.warn > 0
                      ? "warn"
                      : trkCount > 0
                        ? "info"
                        : "ok";
                const trkSubtitle =
                  trackerAlertSummary.critical > 0
                    ? `${trackerAlertSummary.critical} critical`
                    : trackerAlertSummary.warn > 0
                      ? `${trackerAlertSummary.warn} warning`
                      : trkCount > 0
                        ? `${trkCount} active`
                        : "Open trackers";
                const trackerTile: KpiTile = {
                  key: "residents", // not lens-keyed; placeholder
                  label: "Trackers",
                  count: trkCount,
                  subtitle: trkSubtitle,
                  icon: Activity,
                  tone: trkTone,
                  subView: "tracker",
                };
                return (
                  <KpiCard
                    key="trackers-tile"
                    tile={trackerTile}
                    onClick={() => goToSubView("tracker")}
                  />
                );
              })()}
            </>
          ) : (
            <div className="col-span-2 md:col-span-3 lg:col-span-4 rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground">
              {!facilityNumber
                ? "Facility not found. Please log out and back in."
                : "Could not load operations data. Try refreshing the page."}
            </div>
          )}
        </div>
      </section>

      {/* ── Calendar embedded on the dashboard ─────────────────────────── */}
      {facilityNumber && (
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
        </main>
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

export default function OperationsTab({ facilityNumber }: { facilityNumber: string }) {
  return (
    <OperationsErrorBoundary>
      <OperationsTabInner facilityNumber={facilityNumber} />
    </OperationsErrorBoundary>
  );
}
