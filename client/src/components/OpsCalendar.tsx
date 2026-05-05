/**
 * OpsCalendar — unified month/week operations calendar.
 * Shows meds, tasks, incidents, leads, billing, and compliance events
 * aggregated per day. Clicking any event chip navigates to that sub-view.
 */
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

type CalView = "month" | "week";
type SubView = "emar" | "residents" | "incidents" | "crm" | "billing" | "compliance";

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
  event, onNavigate, compact = false,
}: {
  event: DayOpsEvent;
  onNavigate: (sv: SubView, date?: string) => void;
  compact?: boolean;
}) {
  const active = CHIPS.filter((c) => c.count(event) > 0);
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

// ── MonthGrid ─────────────────────────────────────────────────────────────────

function MonthGrid({
  monthStart, byDate, isLoading, todayIso, onNavigate, flashTick,
}: {
  monthStart: string;
  byDate: Map<string, DayOpsEvent>;
  isLoading: boolean;
  todayIso: string;
  onNavigate: (sv: SubView, date?: string) => void;
  flashTick: number;
}) {
  const days   = monthGridDays(monthStart);
  const prefix = monthStart.slice(0, 7);

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
          const hasUrgent = ev && CHIPS.some((c) => c.urgent(ev) && c.count(ev) > 0);
          const hasAny    = ev && CHIPS.some((c) => c.count(ev) > 0);

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
              // Re-keying today's cell on every Today-click forces a remount
              // so the indigo highlight replays even when anchor didn't change.
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
              {inMonth && ev && <EventChips event={ev} onNavigate={onNavigate} compact />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── WeekGrid ──────────────────────────────────────────────────────────────────

function WeekGrid({
  weekStart, byDate, isLoading, todayIso, onNavigate, flashTick,
}: {
  weekStart: string;
  byDate: Map<string, DayOpsEvent>;
  isLoading: boolean;
  todayIso: string;
  onNavigate: (sv: SubView, date?: string) => void;
  flashTick: number;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((iso) => {
        const d = new Date(iso + "T12:00:00");
        const ev = byDate.get(iso);
        const isToday   = iso === todayIso;
        const hasUrgent = ev && CHIPS.some((c) => c.urgent(ev) && c.count(ev) > 0);
        const hasAny    = ev && CHIPS.some((c) => c.count(ev) > 0);

        if (isLoading) {
          return (
            <div key={iso} className="rounded-xl border border-gray-100 bg-gray-50 p-2.5 flex flex-col items-center gap-1.5 min-h-[160px] animate-pulse">
              <Skeleton className="h-3 w-6 rounded" />
              <Skeleton className="h-7 w-7 rounded-full" />
              <Skeleton className="h-5 w-full rounded" />
              <Skeleton className="h-5 w-full rounded" />
              <Skeleton className="h-5 w-4/5 rounded" />
            </div>
          );
        }

        return (
          <div
            key={isToday ? `${iso}-${flashTick}` : iso}
            className={cn(
              "rounded-xl border p-2 flex flex-col items-center transition-all min-h-[160px]",
              isToday   ? "border-indigo-300 bg-indigo-50/70 shadow-sm ring-2 ring-indigo-400 ring-offset-1" :
              hasUrgent ? "border-amber-300 bg-amber-50/50" :
              hasAny    ? "border-indigo-100 bg-white" :
                          "bg-white border-gray-100"
            )}
          >
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{DOW[d.getDay()]}</span>
            <span className={cn(
              "h-7 w-7 flex items-center justify-center rounded-full text-sm font-bold mt-0.5 mb-1.5",
              isToday ? "bg-indigo-600 text-white" : "text-gray-800"
            )}>
              {d.getDate()}
            </span>
            <div className="w-full flex-1">
              {ev
                ? <EventChips event={ev} onNavigate={onNavigate} compact={false} />
                : <p className="text-center text-[10px] text-gray-300 mt-2">—</p>
              }
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── OpsCalendar ───────────────────────────────────────────────────────────────

export default function OpsCalendar({ facilityNumber, onNavigate }: OpsCalendarProps) {
  const queryClient = useQueryClient();
  const todayIso = today();
  const [view, setView]     = useState<CalView>("month");
  const [anchor, setAnchor] = useState(() => startOfMonth(todayIso));
  const [flashTick, setFlashTick] = useState(0);

  const range = useMemo(() => {
    if (view === "month") return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
    const ws = startOfWeek(anchor);
    return { from: ws, to: addDays(ws, 6) };
  }, [view, anchor]);

  const periodLabel = useMemo(() => {
    if (view === "month") {
      const d = new Date(range.from + "T12:00:00");
      return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
    const d1 = new Date(range.from + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
    const d2 = new Date(range.to   + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
    return `${d1} – ${d2}`;
  }, [view, range]);

  const { data: envelope, isLoading } = useQuery<{ success: boolean; data: DayOpsEvent[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/calendar`, range.from, range.to],
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        `/api/ops/facilities/${facilityNumber}/calendar?from=${range.from}&to=${range.to}`,
      );
      return res.json();
    },
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const byDate = useMemo(() => {
    const m = new Map<string, DayOpsEvent>();
    for (const e of envelope?.data ?? []) m.set(e.date, e);
    return m;
  }, [envelope]);

  function navigate(dir: -1 | 1) {
    if (view === "month") {
      setAnchor((a) => {
        const d = new Date(a + "T12:00:00");
        d.setMonth(d.getMonth() + dir);
        return startOfMonth(isoDate(d));
      });
    } else {
      setAnchor((a) => addDays(startOfWeek(a), dir * 7));
    }
  }

  function goToday() {
    // Recompute fresh in case the tab has been open across midnight.
    const fresh = today();
    // Always snap to month view of today — most predictable behavior.
    setView("month");
    setAnchor(startOfMonth(fresh));
    // Bump a flash counter so the "today" cell visibly pulses even when
    // anchor was already today's month (setAnchor with the same value is
    // a React no-op, so without this the user sees no feedback).
    setFlashTick((t) => t + 1);
    // refetchQueries forces a foreground fetch (isLoading flips), giving
    // visible loading state in the cells. invalidateQueries only does a
    // background refetch which is effectively invisible.
    void queryClient.refetchQueries({
      predicate: (q) => {
        const k = q.queryKey[0];
        return (
          typeof k === "string" &&
          k.startsWith(`/api/ops/facilities/${facilityNumber}/calendar`)
        );
      },
    });
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

        {/* Right: Today + view toggle */}
        <div className="flex items-center gap-2">
          <button type="button" onClick={goToday}
            className="text-xs font-semibold px-2.5 py-1 rounded-lg bg-white/70 border border-white hover:bg-white transition-colors text-indigo-600">
            Today
          </button>
          <div className="flex items-center gap-0.5 bg-white/60 rounded-lg p-0.5 border border-white">
            {(["month", "week"] as CalView[]).map((v) => (
              <button key={v} type="button" onClick={() => {
                setView(v);
                setAnchor(v === "month" ? startOfMonth(todayIso) : startOfWeek(todayIso));
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

      {/* ── Legend ── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-50 flex-wrap">
        {CHIPS.map((c) => (
          <button key={c.key} onClick={() => onNavigate(c.key)}
            className={cn("inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded border transition-all hover:brightness-95", c.chip)}>
            <c.Icon className="h-2.5 w-2.5 shrink-0" />{c.label}
          </button>
        ))}
      </div>

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
          />
        )}
        {view === "week" && (
          <WeekGrid
            weekStart={range.from}
            byDate={byDate}
            isLoading={isLoading}
            todayIso={todayIso}
            onNavigate={onNavigate}
            flashTick={flashTick}
          />
        )}
      </div>
    </div>
  );
}