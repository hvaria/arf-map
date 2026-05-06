/**
 * OpsCalendar — unified month/week operations calendar.
 * Shows meds, tasks, incidents, leads, billing, and compliance events
 * aggregated per day. Clicking any event chip navigates to that sub-view.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useResidents } from "@/hooks/useResidents";
import { apiRequest } from "@/lib/queryClient";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  ChevronLeft, ChevronRight,
  Pill, ClipboardList, AlertTriangle,
  UserPlus, Receipt, ShieldCheck,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface DayOpsEvent {
  date: string;
  medsTotal: number; medsGiven: number; medsPending: number; medsLate: number; medsMissed: number;
  tasksTotal: number; tasksCompleted: number; tasksOverdue: number;
  incidentsTotal: number; incidentsOpen: number;
  leadsFollowups: number;
  billingDue: number;
  complianceDue: number;
}

type CalView = "day" | "week" | "month";
type SubView = "emar" | "residents" | "incidents" | "crm" | "billing" | "compliance";

// Filter applied across all calendar views. "all" = no filter (default);
// any other value narrows the calendar to that single category.
type FilterKey = "all" | SubView;

const FILTER_LABEL: Record<FilterKey, string> = {
  all: "events",
  emar: "meds",
  residents: "tasks",
  incidents: "incidents",
  crm: "leads",
  billing: "billing items",
  compliance: "compliance items",
};


// ── Time-grid types (Day + Week hourly views) ─────────────────────────────────

// Unified event shape from /api/ops/facilities/:f/calendar/events. Mirrors
// CalendarEventRow in server/ops/opsStorage.ts.
type EventType = "meds" | "tasks" | "incidents" | "leads" | "billing" | "compliance";

interface CalendarEvent {
  id: string;                   // namespaced: "meds-123", "tasks-45"
  type: EventType;
  title: string;
  subtitle: string;
  date: string;                 // YYYY-MM-DD
  scheduledAt: number;          // Unix ms
  scheduledTime: string;        // "HH:MM" (24h); also tolerated as "8:00 AM"
  status: string;
  allDay: boolean;
}

// Type → SubView mapping (for navigation drill-down and filter-key alignment
// with the existing CHIPS array, which is keyed by SubView).
const SUBVIEW_BY_TYPE: Record<EventType, SubView> = {
  meds:       "emar",
  tasks:      "residents",
  incidents:  "incidents",
  leads:      "crm",
  billing:    "billing",
  compliance: "compliance",
};
const TYPE_BY_SUBVIEW = Object.fromEntries(
  Object.entries(SUBVIEW_BY_TYPE).map(([k, v]) => [v, k as EventType]),
) as Record<SubView, EventType>;

// Default chip color per event type — pastel palette matching the legend.
const TYPE_STYLE: Record<EventType, string> = {
  meds:       "bg-indigo-100  text-indigo-800  border-indigo-300",
  tasks:      "bg-violet-100  text-violet-800  border-violet-300",
  incidents:  "bg-orange-100  text-orange-800  border-orange-300",
  leads:      "bg-blue-100    text-blue-800    border-blue-300",
  billing:    "bg-emerald-100 text-emerald-800 border-emerald-300",
  compliance: "bg-rose-100    text-rose-800    border-rose-300",
};

// Med-pass status — used for status-aware coloring of meds chips and the
// status legend strip in DayTimeGrid.
type MedStatus = "pending" | "given" | "late" | "missed" | "refused" | "held";

// Operational hour range surfaced by default. NOC shift (00:00–05:00) is
// hidden behind a toggle so the grid stays compact.
const DEFAULT_HOUR_START = 6;    // 6 AM
const DEFAULT_HOUR_END   = 23;   // up to 23:59
const HOUR_PX            = 56;   // row height for one hour
// Each med chip occupies a visual "scheduled window" so it's findable in the
// grid even though a single med pass is a point-in-time event. 30 min in Day
// view, 15 min in compact Week view; both are clamped to a readable minimum.
const DAY_WINDOW_MIN     = 30;
const WEEK_WINDOW_MIN    = 15;
const MIN_CHIP_PX        = 22;

interface OpsCalendarProps {
  facilityNumber: string;
  /** date is the ISO day clicked, when navigation comes from a day cell or chip. */
  onNavigate: (subView: SubView, date?: string) => void;
}

// ── Date helpers ──────────────────────────────────────────────────────────────

// Local-date ISO (YYYY-MM-DD). Using toISOString() returns UTC, which means
// users west of UTC see "tomorrow" highlighted after late afternoon — the
// Today button + cell highlight then disagree with what the wall clock says.
function isoDate(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
function today() { return isoDate(new Date()); }

function addDays(iso: string, n: number) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return isoDate(d);
}
function startOfWeek(iso: string) {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() - d.getDay());
  return isoDate(d);
}
function startOfMonth(iso: string) { return iso.slice(0, 7) + "-01"; }
function endOfMonth(iso: string) {
  const d = new Date(iso.slice(0, 7) + "-01T12:00:00");
  d.setMonth(d.getMonth() + 1); d.setDate(0);
  return isoDate(d);
}
function monthGridDays(ms: string) {
  const first = new Date(ms + "T12:00:00");
  const gs = new Date(first); gs.setDate(first.getDate() - first.getDay());
  const last = new Date(ms.slice(0, 7) + "-01T12:00:00");
  last.setMonth(last.getMonth() + 1); last.setDate(last.getDate() - 1);
  const weeks = Math.ceil((first.getDay() + last.getDate()) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(gs); d.setDate(d.getDate() + i); return isoDate(d);
  });
}

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// Parse a scheduled time string into {hour, minute}. Tolerates both formats
// the backend can emit:
//   • 24-hour zero-padded   — "08:00", "20:30"   (current /med-pass shape)
//   • 12-hour with meridiem — "8:00 AM", "10:30 PM"
// Returns null on garbage so the caller can drop unparseable rows.
function parseAmPm(t: string): { hour: number; minute: number } | null {
  if (!t) return null;
  const trimmed = t.trim();

  // 12-hour with AM/PM
  const ampm = trimmed.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (ampm) {
    let hour = parseInt(ampm[1], 10);
    const minute = parseInt(ampm[2], 10);
    const pm = ampm[3].toUpperCase() === "PM";
    if (pm && hour !== 12) hour += 12;
    if (!pm && hour === 12) hour = 0;
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    return { hour, minute };
  }

  // 24-hour
  const h24 = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (h24) {
    const hour = parseInt(h24[1], 10);
    const minute = parseInt(h24[2], 10);
    if (Number.isNaN(hour) || Number.isNaN(minute)) return null;
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
    return { hour, minute };
  }

  return null;
}

// Display helper — render any parsed time as "8:00 AM" / "12:30 PM" so the
// chip label stays consistent regardless of which format the backend used.
function formatTimeLabel(t: string): string {
  const p = parseAmPm(t);
  if (!p) return t;
  const ampm = p.hour < 12 ? "AM" : "PM";
  const h12 = p.hour === 0 ? 12 : p.hour > 12 ? p.hour - 12 : p.hour;
  return `${h12}:${String(p.minute).padStart(2, "0")} ${ampm}`;
}

// Minute offset from the hour-window start, used to position event chips.
function minuteOffset(hour: number, minute: number, hourStart: number): number {
  return (hour - hourStart) * 60 + minute;
}

// Color rules per med-pass status — same vocabulary as EmarPage so users
// don't relearn it. For non-meds events, TYPE_STYLE drives the color.
const MED_STATUS_STYLE: Record<MedStatus, string> = {
  pending: "bg-indigo-100  text-indigo-800  border-indigo-300",
  given:   "bg-emerald-100 text-emerald-800 border-emerald-300",
  late:    "bg-amber-100   text-amber-900   border-amber-400",
  missed:  "bg-red-100     text-red-800     border-red-400",
  refused: "bg-slate-100   text-slate-700   border-slate-300",
  held:    "bg-yellow-100  text-yellow-800  border-yellow-300",
};

// Picks the right palette for an event chip:
//   • meds  → status-driven (clinical signal matters)
//   • other → type default
function chipStyleFor(event: CalendarEvent): string {
  if (event.type === "meds") {
    const s = event.status as MedStatus;
    return MED_STATUS_STYLE[s] ?? TYPE_STYLE.meds;
  }
  // For non-meds, dim "completed/closed/paid" so they recede visually.
  const closed = ["completed", "closed", "paid", "void"];
  if (closed.includes(event.status)) {
    return cn(TYPE_STYLE[event.type], "opacity-60");
  }
  return TYPE_STYLE[event.type];
}

// Lucide icon per type — matches CHIPS legend.
const TYPE_ICON: Record<EventType, React.ElementType> = {
  meds:       Pill,
  tasks:      ClipboardList,
  incidents:  AlertTriangle,
  leads:      UserPlus,
  billing:    Receipt,
  compliance: ShieldCheck,
};

// ── Event chip definitions ────────────────────────────────────────────────────

interface ChipDef {
  key: SubView;
  Icon: React.ElementType;
  label: string;
  count: (e: DayOpsEvent) => number;
  urgent: (e: DayOpsEvent) => boolean;
  chip: string;          // Tailwind classes when normal
  chipUrgent: string;    // Tailwind classes when urgent
}

const CHIPS: ChipDef[] = [
  {
    key: "emar",
    Icon: Pill,
    label: "meds",
    count: (e) => e.medsTotal,
    urgent: (e) => (e.medsLate + e.medsMissed) > 0,
    chip:       "bg-indigo-100 text-indigo-700 border-indigo-200",
    chipUrgent: "bg-amber-100  text-amber-800  border-amber-300",
  },
  {
    key: "residents",
    Icon: ClipboardList,
    label: "tasks",
    count: (e) => e.tasksTotal,
    urgent: (e) => e.tasksOverdue > 0,
    chip:       "bg-violet-100 text-violet-700 border-violet-200",
    chipUrgent: "bg-red-100    text-red-700    border-red-300",
  },
  {
    key: "incidents",
    Icon: AlertTriangle,
    label: "incidents",
    count: (e) => e.incidentsTotal,
    urgent: (e) => e.incidentsOpen > 0,
    chip:       "bg-orange-100 text-orange-700 border-orange-200",
    chipUrgent: "bg-red-100    text-red-700    border-red-300",
  },
  {
    key: "crm",
    Icon: UserPlus,
    label: "leads",
    count: (e) => e.leadsFollowups,
    urgent: () => false,
    chip:       "bg-blue-100   text-blue-700   border-blue-200",
    chipUrgent: "bg-blue-100   text-blue-700   border-blue-200",
  },
  {
    key: "billing",
    Icon: Receipt,
    label: "due",
    count: (e) => e.billingDue,
    urgent: (e) => e.billingDue > 0,
    chip:       "bg-emerald-100 text-emerald-700 border-emerald-200",
    chipUrgent: "bg-red-100     text-red-700     border-red-300",
  },
  {
    key: "compliance",
    Icon: ShieldCheck,
    label: "compliance",
    count: (e) => e.complianceDue,
    urgent: (e) => e.complianceDue > 0,
    chip:       "bg-rose-100   text-rose-700   border-rose-200",
    chipUrgent: "bg-red-100    text-red-700    border-red-300",
  },
];

// ── EventChips ────────────────────────────────────────────────────────────────

function EventChips({
  event, onNavigate, compact = false, filter = "all",
}: {
  event: DayOpsEvent;
  onNavigate: (sv: SubView, date?: string) => void;
  compact?: boolean;
  /** When set to anything other than "all", only chips matching that key
   * appear. Hides categories the user has filtered out. */
  filter?: FilterKey;
}) {
  const active = CHIPS
    .filter((c) => c.count(event) > 0)
    .filter((c) => filter === "all" || c.key === filter);
  if (active.length === 0) return null;

  const visible = compact ? active.slice(0, 3) : active;
  const overflow = compact ? active.length - 3 : 0;

  return (
    <div className={cn("flex flex-col gap-0.5 w-full mt-1", compact && "gap-px")}>
      {visible.map((c) => {
        const count = c.count(event);
        const isUrgent = c.urgent(event);
        return (
          <button
            key={c.key}
            onClick={(e) => { e.stopPropagation(); onNavigate(c.key, event.date); }}
            className={cn(
              "flex items-center gap-1 w-full rounded border text-left transition-all hover:brightness-95",
              compact ? "px-1 py-0.5" : "px-1.5 py-1",
              isUrgent ? c.chipUrgent : c.chip
            )}
          >
            <c.Icon className={cn("shrink-0", compact ? "h-2.5 w-2.5" : "h-3 w-3")} />
            <span className={cn("font-semibold tabular-nums leading-none", compact ? "text-[10px]" : "text-xs")}>
              {count}
            </span>
            {!compact && (
              <span className="text-[10px] leading-none opacity-80 truncate">{c.label}</span>
            )}
          </button>
        );
      })}
      {overflow > 0 && (
        <span className="text-[9px] text-gray-400 font-medium pl-0.5">+{overflow} more</span>
      )}
    </div>
  );
}

// ── Hour rail (shared by Day and Week time grids) ─────────────────────────────

function HourRail({
  hourStart,
  hourEnd,
  showNowLine,
  isToday,
}: {
  hourStart: number;
  hourEnd: number;
  showNowLine: boolean;
  isToday: boolean;
}) {
  const hours = Array.from({ length: hourEnd - hourStart + 1 }, (_, i) => hourStart + i);
  const totalHeight = (hourEnd - hourStart + 1) * HOUR_PX;
  const now = new Date();
  const nowOffset =
    isToday && showNowLine
      ? (now.getHours() - hourStart) * HOUR_PX + (now.getMinutes() / 60) * HOUR_PX
      : -1;
  const nowVisible = nowOffset >= 0 && nowOffset <= totalHeight;

  return (
    <div className="relative" style={{ height: totalHeight }}>
      {hours.map((h, i) => (
        <div
          key={h}
          className={cn(
            "border-t text-[10px] text-gray-400 pl-1 pr-2 box-border",
            i === 0 && "border-t-0",
          )}
          style={{ height: HOUR_PX }}
        >
          {h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`}
        </div>
      ))}
      {nowVisible && (
        <div
          className="absolute left-0 right-0 z-10 pointer-events-none"
          style={{ top: nowOffset }}
        >
          <div className="h-px bg-red-500" />
          <span className="absolute -left-0.5 -top-1 h-2 w-2 rounded-full bg-red-500" />
        </div>
      )}
    </div>
  );
}

function HourLanes({
  hourStart,
  hourEnd,
  isToday,
  children,
}: {
  hourStart: number;
  hourEnd: number;
  isToday: boolean;
  children?: React.ReactNode;
}) {
  const hours = Array.from({ length: hourEnd - hourStart + 1 }, (_, i) => hourStart + i);
  const totalHeight = (hourEnd - hourStart + 1) * HOUR_PX;
  const now = new Date();
  const nowOffset = isToday
    ? (now.getHours() - hourStart) * HOUR_PX + (now.getMinutes() / 60) * HOUR_PX
    : -1;
  const nowVisible = nowOffset >= 0 && nowOffset <= totalHeight;

  return (
    <div className="relative bg-white" style={{ height: totalHeight }}>
      {hours.map((h, i) => (
        <div
          key={h}
          className={cn("border-t border-gray-100", i === 0 && "border-t-0")}
          style={{ height: HOUR_PX }}
        />
      ))}
      {nowVisible && (
        <div
          className="absolute left-0 right-0 z-10 h-px bg-red-500 pointer-events-none"
          style={{ top: nowOffset }}
        />
      )}
      {children}
    </div>
  );
}

// ── Time-grid event chip ──────────────────────────────────────────────────────

function EventChip({
  event,
  hourStart,
  compact = false,
  laneIndex = 0,
  laneCount = 1,
  onClick,
}: {
  event: CalendarEvent;
  hourStart: number;
  compact?: boolean;
  /** When multiple chips overlap on the same time, each is assigned a
   * horizontal lane so they render side-by-side instead of stacking. */
  laneIndex?: number;
  laneCount?: number;
  onClick?: () => void;
}) {
  const parsed = parseAmPm(event.scheduledTime);
  if (!parsed) return null;
  const top = (minuteOffset(parsed.hour, parsed.minute, hourStart) / 60) * HOUR_PX;
  if (top < 0) return null;

  const windowMin = compact ? WEEK_WINDOW_MIN : DAY_WINDOW_MIN;
  const height = Math.max(MIN_CHIP_PX, (windowMin / 60) * HOUR_PX);

  const leftPct  = (laneIndex / laneCount) * 100;
  const widthPct = (1 / laneCount) * 100;

  const Icon = TYPE_ICON[event.type];

  return (
    <button
      onClick={onClick}
      title={`${event.scheduledTime} · ${event.title} · ${event.subtitle} · ${event.status}`}
      className={cn(
        "absolute rounded border text-left overflow-hidden transition-all hover:brightness-95 hover:shadow-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
        chipStyleFor(event),
        compact ? "px-1 py-0.5 text-[10px] leading-tight" : "px-1.5 py-1 text-[11px] leading-tight",
      )}
      style={{
        top,
        height,
        left:  `calc(${leftPct}% + 2px)`,
        width: `calc(${widthPct}% - 4px)`,
      }}
    >
      <div className="flex items-center gap-1 font-semibold tabular-nums">
        <Icon className={cn(compact ? "h-2.5 w-2.5" : "h-3 w-3", "shrink-0")} />
        <span className="truncate">
          {event.allDay ? "All day" : formatTimeLabel(event.scheduledTime)}
        </span>
        {!compact && <span className="opacity-70 truncate">· {event.title}</span>}
      </div>
      {!compact && (
        <div className="opacity-80 truncate">{event.subtitle}</div>
      )}
      {compact && (
        <div className="opacity-80 truncate text-[9px]">{event.title}</div>
      )}
    </button>
  );
}

// Compute lane (column slot) for each chip so overlapping events show
// side-by-side instead of stacked. Greedy: walk events in time order, assign
// each to the first lane that's free at its start time (lane is free if its
// previous event's window has ended).
function assignLanes(
  events: CalendarEvent[],
  windowMin: number,
): Array<{ event: CalendarEvent; laneIndex: number; laneCount: number }> {
  const items = events
    .map((e) => {
      const p = parseAmPm(e.scheduledTime);
      if (!p) return null;
      const start = p.hour * 60 + p.minute;
      return { e, start, end: start + windowMin };
    })
    .filter((x): x is { e: CalendarEvent; start: number; end: number } => x !== null)
    .sort((a, b) => a.start - b.start);

  const laneEnds: number[] = [];
  const placed: Array<{ event: CalendarEvent; laneIndex: number }> = [];

  for (const it of items) {
    let lane = laneEnds.findIndex((end) => end <= it.start);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(it.end);
    } else {
      laneEnds[lane] = it.end;
    }
    placed.push({ event: it.e, laneIndex: lane });
  }

  const laneCount = Math.max(1, laneEnds.length);
  return placed.map((p) => ({ ...p, laneCount }));
}

// ── Hook: unified calendar events for a date range ────────────────────────────
// Replaces the old per-day med-pass fetch. One request returns events from
// every source module (meds, tasks, incidents, leads, billing, compliance).
// Optional `types` narrows the request server-side so the filter chip applies
// at the network level too.

function fetchCalendarEvents(
  facilityNumber: string,
  fromIso: string,
  toIso: string,
  types?: ReadonlyArray<EventType>,
) {
  return async (): Promise<{ success: boolean; data: CalendarEvent[] } | null> => {
    const params = new URLSearchParams({ from: fromIso, to: toIso });
    if (types && types.length > 0) params.set("type", types.join(","));
    const res = await apiRequest(
      "GET",
      `/api/ops/facilities/${facilityNumber}/calendar/events?${params.toString()}`,
    );
    return res.json();
  };
}

// ── Seed demo button + status legend ──────────────────────────────────────────

function SeedDemoButton({ facilityNumber }: { facilityNumber: string }) {
  const qc = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/ops/facilities/${facilityNumber}/seed-demo`,
      );
      return res.json() as Promise<{
        success: boolean;
        data?: {
          skipped: boolean;
          reason?: string;
          residentsCreated: number;
          medicationsCreated: number;
          medPassesGenerated: number;
          medPassesUpdated: number;
        };
        error?: string;
      }>;
    },
    onSuccess: (resp) => {
      if (resp.data?.skipped) {
        setMessage(resp.data.reason ?? "Already seeded");
      } else if (resp.data) {
        setMessage(
          `Seeded ${resp.data.residentsCreated} residents, ${resp.data.medicationsCreated} meds, ${resp.data.medPassesGenerated} passes`,
        );
      }
      // Refresh every cached calendar / med-pass query so the new chips
      // light up immediately.
      void qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return (
            typeof k === "string" &&
            (k.startsWith(`/api/ops/facilities/${facilityNumber}/med-pass`) ||
             k.startsWith(`/api/ops/facilities/${facilityNumber}/calendar`) ||
             k.startsWith(`/api/ops/facilities/${facilityNumber}/dashboard`) ||
             k.startsWith(`/api/ops/facilities/${facilityNumber}/residents`))
          );
        },
      });
    },
    onError: (e: Error) => setMessage(`Failed: ${e.message}`),
  });

  return (
    <div className="flex flex-col items-center gap-1.5">
      <button
        type="button"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending}
        className="text-xs font-semibold px-3 py-1.5 rounded-md border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition-colors disabled:opacity-60"
      >
        {mutation.isPending ? "Seeding…" : "Seed demo data"}
      </button>
      {message && (
        <p className="text-[10px] text-muted-foreground">{message}</p>
      )}
    </div>
  );
}

const STATUS_LEGEND: Array<{ status: MedStatus; label: string }> = [
  { status: "pending", label: "Pending" },
  { status: "given",   label: "Given"   },
  { status: "late",    label: "Late"    },
  { status: "missed",  label: "Missed"  },
  { status: "refused", label: "Refused" },
  { status: "held",    label: "Held"    },
];

function StatusLegend({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center gap-1.5 flex-wrap", className)}>
      {STATUS_LEGEND.map(({ status, label }) => (
        <span
          key={status}
          className={cn(
            "inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold",
            MED_STATUS_STYLE[status],
          )}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
          {label}
        </span>
      ))}
    </div>
  );
}

// ── DayTimeGrid: vertical hour rail for a single day ──────────────────────────

function DayTimeGrid({
  facilityNumber,
  dateIso,
  todayIso,
  onNavigate,
  filter,
}: {
  facilityNumber: string;
  dateIso: string;
  todayIso: string;
  onNavigate: (sv: SubView, date?: string) => void;
  filter: FilterKey;
}) {
  const [showOvernight, setShowOvernight] = useState(false);
  const isToday = dateIso === todayIso;
  const containerRef = useRef<HTMLDivElement>(null);

  const hourStart = showOvernight ? 0 : DEFAULT_HOUR_START;
  const hourEnd   = showOvernight ? 23 : DEFAULT_HOUR_END;

  // Server-side type filter when the user has narrowed by category. "all"
  // sends no filter; the SubView keys (emar, residents, …) map back to
  // event types via TYPE_BY_SUBVIEW.
  const typeFilter: ReadonlyArray<EventType> | undefined =
    filter === "all" ? undefined : [TYPE_BY_SUBVIEW[filter]];

  const { data, isLoading } = useQuery<{ success: boolean; data: CalendarEvent[] } | null>({
    queryKey: [
      `/api/ops/facilities/${facilityNumber}/calendar/events`,
      dateIso, dateIso, typeFilter?.join(",") ?? "all",
    ],
    queryFn: fetchCalendarEvents(facilityNumber, dateIso, dateIso, typeFilter),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const items = data?.data ?? [];
  const visibleLanes = useMemo(
    () => {
      const within = items.filter((e) => {
        const p = parseAmPm(e.scheduledTime);
        if (!p) return false;
        return p.hour >= hourStart && p.hour <= hourEnd;
      });
      return assignLanes(within, DAY_WINDOW_MIN);
    },
    [items, hourStart, hourEnd],
  );

  // Auto-scroll to "now" on first render when viewing today.
  useEffect(() => {
    if (!isToday || !containerRef.current) return;
    const now = new Date();
    if (now.getHours() < hourStart || now.getHours() > hourEnd) return;
    const offset =
      (now.getHours() - hourStart) * HOUR_PX +
      (now.getMinutes() / 60) * HOUR_PX -
      80; // bias up so the "now" line isn't pinned to the top
    containerRef.current.scrollTop = Math.max(0, offset);
  }, [isToday, hourStart, hourEnd]);

  // Counts shown in the day header, grouped by event type. Falls back to the
  // meds-only summary (given/pending/late) when the user is filtered to meds.
  const totals = useMemo(() => {
    const byType: Record<EventType, number> = {
      meds: 0, tasks: 0, incidents: 0, leads: 0, billing: 0, compliance: 0,
    };
    let medsGiven = 0, medsPending = 0, medsLateMissed = 0;
    for (const e of items) {
      byType[e.type] += 1;
      if (e.type === "meds") {
        if (e.status === "given") medsGiven += 1;
        else if (e.status === "pending") medsPending += 1;
        else if (e.status === "late" || e.status === "missed") medsLateMissed += 1;
      }
    }
    return { byType, total: items.length, medsGiven, medsPending, medsLateMissed };
  }, [items]);

  return (
    <div>
      {/* Day header strip — meds-detail summary when meds are visible,
          otherwise per-type counts. */}
      <div className="flex items-center justify-between px-1 pb-2 mb-2 border-b border-gray-100 flex-wrap gap-2">
        <div className="text-xs text-gray-600 tabular-nums">
          {isLoading ? (
            <Skeleton className="h-4 w-40 inline-block" />
          ) : totals.byType.meds > 0 ? (
            <>
              <span className="font-semibold text-gray-800">{totals.byType.meds}</span> meds
              <span className="mx-1.5 text-gray-300">·</span>
              <span className="text-emerald-700">{totals.medsGiven} given</span>
              <span className="mx-1.5 text-gray-300">·</span>
              <span className="text-indigo-700">{totals.medsPending} pending</span>
              {totals.medsLateMissed > 0 && (
                <>
                  <span className="mx-1.5 text-gray-300">·</span>
                  <span className="text-red-700 font-medium">{totals.medsLateMissed} late/missed</span>
                </>
              )}
              {(totals.total - totals.byType.meds) > 0 && (
                <>
                  <span className="mx-1.5 text-gray-300">·</span>
                  <span>{totals.total - totals.byType.meds} other</span>
                </>
              )}
            </>
          ) : totals.total > 0 ? (
            <>
              <span className="font-semibold text-gray-800">{totals.total}</span> events
            </>
          ) : (
            <span>No events scheduled</span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {(filter === "all" || filter === "emar") && (
            <StatusLegend className="hidden md:flex" />
          )}
          <button
            type="button"
            onClick={() => setShowOvernight((v) => !v)}
            className="text-[11px] font-medium text-indigo-600 hover:underline"
          >
            {showOvernight ? "Hide overnight (12am–6am)" : "Show overnight (12am–6am)"}
          </button>
        </div>
      </div>

      {/* Time grid */}
      <div
        ref={containerRef}
        className="grid grid-cols-[56px_1fr] border border-gray-100 rounded-lg overflow-y-auto"
        style={{ maxHeight: 520 }}
      >
        <div className="border-r border-gray-100 bg-gray-50">
          <HourRail hourStart={hourStart} hourEnd={hourEnd} showNowLine={isToday} isToday={isToday} />
        </div>
        <HourLanes hourStart={hourStart} hourEnd={hourEnd} isToday={isToday}>
          {!isLoading &&
            visibleLanes.map(({ event, laneIndex, laneCount }) => (
              <EventChip
                key={event.id}
                event={event}
                hourStart={hourStart}
                laneIndex={laneIndex}
                laneCount={laneCount}
                onClick={() => onNavigate(SUBVIEW_BY_TYPE[event.type], dateIso)}
              />
            ))}
        </HourLanes>
      </div>

      {/* Empty state */}
      {!isLoading && items.length === 0 && (
        <div className="flex flex-col items-center gap-2 mt-4 text-center">
          <p className="text-xs text-gray-500">
            No {FILTER_LABEL[filter]} scheduled for this day.
          </p>
          {filter === "all" && <SeedDemoButton facilityNumber={facilityNumber} />}
        </div>
      )}
    </div>
  );
}

// ── WeekTimeGrid: 7-column hourly grid ────────────────────────────────────────

function WeekTimeGrid({
  facilityNumber,
  weekStart,
  todayIso,
  onNavigate,
  filter,
}: {
  facilityNumber: string;
  weekStart: string;
  todayIso: string;
  onNavigate: (sv: SubView, date?: string) => void;
  filter: FilterKey;
}) {
  const [showOvernight, setShowOvernight] = useState(false);
  const hourStart = showOvernight ? 0 : DEFAULT_HOUR_START;
  const hourEnd   = showOvernight ? 23 : DEFAULT_HOUR_END;

  const days = useMemo(
    () => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)),
    [weekStart],
  );
  const weekEnd = days[days.length - 1];

  const typeFilter: ReadonlyArray<EventType> | undefined =
    filter === "all" ? undefined : [TYPE_BY_SUBVIEW[filter]];

  // Single range query covers all 7 days and every event type the user wants.
  // Replaces the old 7× per-day med-pass fan-out.
  const { data, isLoading } = useQuery<{ success: boolean; data: CalendarEvent[] } | null>({
    queryKey: [
      `/api/ops/facilities/${facilityNumber}/calendar/events`,
      weekStart, weekEnd, typeFilter?.join(",") ?? "all",
    ],
    queryFn: fetchCalendarEvents(facilityNumber, weekStart, weekEnd, typeFilter),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of data?.data ?? []) {
      if (!map.has(e.date)) map.set(e.date, []);
      map.get(e.date)!.push(e);
    }
    return map;
  }, [data]);

  return (
    <div>
      <div className="flex items-center justify-end mb-2">
        <button
          type="button"
          onClick={() => setShowOvernight((v) => !v)}
          className="text-[11px] font-medium text-indigo-600 hover:underline"
        >
          {showOvernight ? "Hide overnight" : "Show overnight"}
        </button>
      </div>

      <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))] border border-gray-100 rounded-lg overflow-hidden">
        {/* Header row */}
        <div className="bg-gray-50 border-b border-r border-gray-100" />
        {days.map((iso) => {
          const d = new Date(iso + "T12:00:00");
          const isToday = iso === todayIso;
          // Day-header click drills into the most relevant sub-view: when a
          // filter is active, that filter's section; otherwise eMAR (default).
          const headerSub: SubView = filter === "all" ? "emar" : (filter as SubView);
          return (
            <button
              key={`h-${iso}`}
              onClick={() => onNavigate(headerSub, iso)}
              className={cn(
                "text-center py-1.5 border-b border-l border-gray-100 transition-colors hover:bg-indigo-50/40",
                isToday && "bg-indigo-50",
              )}
            >
              <div className="text-[10px] uppercase tracking-wide text-gray-500">
                {DOW[d.getDay()]}
              </div>
              <div
                className={cn(
                  "inline-flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold mt-0.5",
                  isToday ? "bg-indigo-600 text-white" : "text-gray-700",
                )}
              >
                {d.getDate()}
              </div>
            </button>
          );
        })}

        {/* Hour rail + 7 day lanes — wrapped in a max-height scroll container.
            We put it as a contiguous grid row spanning all 8 columns so the
            hour lines stay aligned. */}
        <div
          className="col-span-8 overflow-y-auto"
          style={{ maxHeight: 520 }}
        >
          <div className="grid grid-cols-[56px_repeat(7,minmax(0,1fr))]">
            <div className="bg-gray-50 border-r border-gray-100">
              <HourRail
                hourStart={hourStart}
                hourEnd={hourEnd}
                showNowLine
                isToday={days.includes(todayIso)}
              />
            </div>
            {days.map((iso) => {
              const items = eventsByDate.get(iso) ?? [];
              const isToday = iso === todayIso;
              const within = items.filter((e) => {
                const p = parseAmPm(e.scheduledTime);
                if (!p) return false;
                return p.hour >= hourStart && p.hour <= hourEnd;
              });
              const lanes = assignLanes(within, WEEK_WINDOW_MIN);
              return (
                <div
                  key={`l-${iso}`}
                  className={cn("border-l border-gray-100", isToday && "bg-indigo-50/30")}
                >
                  <HourLanes hourStart={hourStart} hourEnd={hourEnd} isToday={isToday}>
                    {!isLoading &&
                      lanes.map(({ event, laneIndex, laneCount }) => (
                        <EventChip
                          key={`${iso}-${event.id}`}
                          event={event}
                          hourStart={hourStart}
                          compact
                          laneIndex={laneIndex}
                          laneCount={laneCount}
                          onClick={() => onNavigate(SUBVIEW_BY_TYPE[event.type], iso)}
                        />
                      ))}
                  </HourLanes>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── MonthGrid ─────────────────────────────────────────────────────────────────

function MonthGrid({
  monthStart, byDate, isLoading, todayIso, onNavigate, flashTick, filter,
}: {
  monthStart: string;
  byDate: Map<string, DayOpsEvent>;
  isLoading: boolean;
  todayIso: string;
  onNavigate: (sv: SubView, date?: string) => void;
  flashTick: number;
  filter: FilterKey;
}) {
  const days   = monthGridDays(monthStart);
  const prefix = monthStart.slice(0, 7);

  // When a filter is active, cell tinting (urgent / hasAny) only considers
  // chips that match the filter, so a filtered-out category doesn't keep a
  // day looking "busy" when nothing of that kind is scheduled there.
  const matches = (c: typeof CHIPS[number]) => filter === "all" || c.key === filter;
  const cellHasUrgent = (ev: DayOpsEvent) => CHIPS.some((c) => matches(c) && c.urgent(ev) && c.count(ev) > 0);
  const cellHasAny    = (ev: DayOpsEvent) => CHIPS.some((c) => matches(c) && c.count(ev) > 0);

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {DOW.map((d) => (
          <div key={d} className="text-center text-[10px] font-semibold text-gray-400 py-1 uppercase tracking-wide">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((iso) => {
          const inMonth = iso.startsWith(prefix);
          const isToday = iso === todayIso;
          const ev = byDate.get(iso);
          const hasUrgent = ev && cellHasUrgent(ev);
          const hasAny    = ev && cellHasAny(ev);

          if (isLoading && inMonth) {
            return (
              <div key={iso} className="min-h-[80px] rounded-xl border border-gray-100 bg-gray-50 p-1.5 space-y-1 animate-pulse">
                <Skeleton className="h-5 w-5 rounded-full" />
                <Skeleton className="h-4 w-full rounded" />
                <Skeleton className="h-4 w-3/4 rounded" />
              </div>
            );
          }

          return (
            <div
              key={isToday ? `${iso}-${flashTick}` : iso}
              className={cn(
                "min-h-[80px] rounded-xl border p-1.5 flex flex-col transition-all",
                !inMonth && "opacity-20 bg-gray-50 border-gray-50 pointer-events-none",
                isToday   ? "border-indigo-300 bg-indigo-50/70 shadow-sm ring-2 ring-indigo-400 ring-offset-1" :
                hasUrgent ? "border-amber-300 bg-amber-50/50 hover:shadow-sm" :
                hasAny    ? "border-indigo-100 bg-white hover:border-indigo-200 hover:shadow-sm" :
                            "bg-white border-gray-100"
              )}
            >
              <span className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold leading-none",
                isToday ? "bg-indigo-600 text-white" : "text-gray-700"
              )}>
                {new Date(iso + "T12:00:00").getDate()}
              </span>
              {inMonth && ev && (
                <EventChips event={ev} onNavigate={onNavigate} compact filter={filter} />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── OpsCalendar ───────────────────────────────────────────────────────────────

// Pull initial filter from the URL query string so a "compliance only"
// calendar link stays meaningful when shared. We use raw window.location
// rather than wouter because the calendar mounts inside OperationsTab and
// reads any `?calFilter=` token a user may have appended to the hash URL.
function readFilterFromUrl(): FilterKey {
  if (typeof window === "undefined") return "all";
  const hash = window.location.hash; // wouter useHashLocation
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) return "all";
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  const raw = params.get("calFilter");
  const valid: FilterKey[] = ["all", "emar", "residents", "incidents", "crm", "billing", "compliance"];
  return valid.includes(raw as FilterKey) ? (raw as FilterKey) : "all";
}

function writeFilterToUrl(filter: FilterKey) {
  if (typeof window === "undefined") return;
  const hash = window.location.hash;
  const qIdx = hash.indexOf("?");
  const path = qIdx === -1 ? hash : hash.slice(0, qIdx);
  const params = new URLSearchParams(qIdx === -1 ? "" : hash.slice(qIdx + 1));
  if (filter === "all") params.delete("calFilter");
  else params.set("calFilter", filter);
  const qs = params.toString();
  const next = qs ? `${path}?${qs}` : path;
  if (next !== hash) window.history.replaceState(null, "", `${window.location.pathname}${next}`);
}

export default function OpsCalendar({ facilityNumber, onNavigate }: OpsCalendarProps) {
  const todayIso = today();
  const [view, setView]     = useState<CalView>("day");
  const [anchor, setAnchor] = useState(() => todayIso);
  const [flashTick, setFlashTick] = useState(0);
  const [filter, setFilterState] = useState<FilterKey>(() => readFilterFromUrl());
  const setFilter = (next: FilterKey) => {
    setFilterState(next);
    writeFilterToUrl(next);
  };

  const range = useMemo(() => {
    if (view === "month") return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
    if (view === "day")   return { from: anchor, to: anchor };
    const ws = startOfWeek(anchor);
    return { from: ws, to: addDays(ws, 6) };
  }, [view, anchor]);

  const periodLabel = useMemo(() => {
    if (view === "month") {
      const d = new Date(range.from + "T12:00:00");
      return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
    if (view === "day") {
      const d = new Date(range.from + "T12:00:00");
      return d.toLocaleDateString("en-US", {
        weekday: "long", month: "long", day: "numeric", year: "numeric",
      });
    }
    const d1 = new Date(range.from + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const d2 = new Date(range.to   + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `${d1} – ${d2}`;
  }, [view, range]);

  // Calendar aggregate is only needed for Month view. Day and Week views
  // pull med-pass data directly from /med-pass for hour-level placement.
  const { data: envelope, isLoading } = useQuery<{ success: boolean; data: DayOpsEvent[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/calendar`, range.from, range.to],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/ops/facilities/${facilityNumber}/calendar?from=${range.from}&to=${range.to}`,
      );
      return res.json();
    },
    enabled: !!facilityNumber && view === "month",
    staleTime: 60_000,
  });

  const byDate = useMemo(() => {
    const m = new Map<string, DayOpsEvent>();
    for (const e of envelope?.data ?? []) m.set(e.date, e);
    return m;
  }, [envelope]);

  // Detect a fully-empty facility (no residents) so we can offer a global
  // "Seed demo data" affordance that's reachable from any view. activeOnly
  // is false so a facility with only discharged residents doesn't trigger
  // the empty-state banner.
  const { all: allResidents, isFetched: residentsFetched } = useResidents(
    facilityNumber,
    { activeOnly: false },
  );
  const facilityIsEmpty = residentsFetched && allResidents.length === 0;

  function navigate(dir: -1 | 1) {
    if (view === "month") {
      setAnchor((a) => {
        const d = new Date(a + "T12:00:00");
        d.setMonth(d.getMonth() + dir);
        return startOfMonth(isoDate(d));
      });
    } else if (view === "day") {
      setAnchor((a) => addDays(a, dir));
    } else {
      setAnchor((a) => addDays(startOfWeek(a), dir * 7));
    }
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-white shadow-sm overflow-hidden">
      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100"
        style={{ background: "linear-gradient(120deg,#EEF2FF,#FFF0F6)" }}>
        {/* Left: prev/next + label */}
        <div className="flex items-center gap-1.5">
          <button type="button" onClick={() => navigate(-1)}
            className="h-7 w-7 rounded-lg bg-white/70 border border-white flex items-center justify-center hover:bg-white transition-colors"
            aria-label="Previous">
            <ChevronLeft className="h-4 w-4 text-gray-600" />
          </button>
          <button type="button" onClick={() => navigate(1)}
            className="h-7 w-7 rounded-lg bg-white/70 border border-white flex items-center justify-center hover:bg-white transition-colors"
            aria-label="Next">
            <ChevronRight className="h-4 w-4 text-gray-600" />
          </button>
          <span className="text-sm font-bold ml-1" style={{ color: "#1E1B4B" }}>{periodLabel}</span>
        </div>

        {/* Right: view toggle */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-0.5 bg-white/60 rounded-lg p-0.5 border border-white">
            {(["day", "week", "month"] as CalView[]).map((v) => (
              <button key={v} type="button" onClick={() => {
                setView(v);
                setAnchor(
                  v === "month" ? startOfMonth(todayIso)
                : v === "week"  ? startOfWeek(todayIso)
                                : todayIso,
                );
              }}
                className={cn(
                  "px-2.5 py-1 rounded text-xs font-semibold capitalize transition-all",
                  view === v ? "bg-indigo-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-800"
                )}>
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Category filter bar ──
          Click a chip to filter the calendar to that category in place.
          Click again (or click "All") to reset. Active filter is filled +
          ringed; inactive chips are translucent. */}
      <div
        className="flex items-center gap-2 px-4 py-2 border-b border-gray-50 flex-wrap"
        role="toolbar"
        aria-label="Filter calendar by category"
      >
        <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-400 mr-1">
          Filter
        </span>
        <button
          type="button"
          onClick={() => setFilter("all")}
          aria-pressed={filter === "all"}
          className={cn(
            "inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border transition-all",
            filter === "all"
              ? "bg-indigo-600 text-white border-indigo-600 shadow-sm"
              : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50",
          )}
        >
          All
        </button>
        {CHIPS.map((c) => {
          const isActive = filter === c.key;
          return (
            <button
              key={c.key}
              type="button"
              aria-pressed={isActive}
              onClick={() => setFilter(isActive ? "all" : c.key)}
              className={cn(
                "inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border transition-all hover:brightness-95",
                c.chip,
                isActive && "ring-2 ring-offset-1 ring-indigo-500 brightness-95",
              )}
            >
              <c.Icon className="h-2.5 w-2.5 shrink-0" />{c.label}
            </button>
          );
        })}
        {filter !== "all" && (
          <span className="ml-auto text-[10px] text-gray-500">
            Showing only <span className="font-semibold">{FILTER_LABEL[filter]}</span>
          </span>
        )}
      </div>

      {/* ── Empty-facility banner — visible from any view ── */}
      {facilityIsEmpty && (
        <div className="px-4 py-3 border-b border-amber-100 bg-amber-50 flex items-center justify-between gap-3 flex-wrap">
          <div className="text-xs text-amber-900">
            <span className="font-semibold">No residents or medications yet.</span>{" "}
            Seed sample data to see the calendar's color states in action.
          </div>
          <SeedDemoButton facilityNumber={facilityNumber} />
        </div>
      )}

      {/* ── Calendar body ── */}
      <div className="p-3">
        {view === "month" && (
          <MonthGrid
            monthStart={range.from}
            byDate={byDate}
            isLoading={isLoading}
            todayIso={todayIso}
            onNavigate={onNavigate}
            flashTick={flashTick}
            filter={filter}
          />
        )}
        {view === "week" && (
          <WeekTimeGrid
            facilityNumber={facilityNumber}
            weekStart={range.from}
            todayIso={todayIso}
            onNavigate={onNavigate}
            filter={filter}
          />
        )}
        {view === "day" && (
          <DayTimeGrid
            facilityNumber={facilityNumber}
            dateIso={range.from}
            todayIso={todayIso}
            onNavigate={onNavigate}
            filter={filter}
          />
        )}
      </div>
    </div>
  );
}