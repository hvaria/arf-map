import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import PortalLayout from "./PortalLayout";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  RefreshCw, ArrowLeft, AlertTriangle, CheckCircle2, Clock,
  XCircle, ChevronDown, ChevronUp, ChevronLeft, ChevronRight,
  Sun, Moon, Sunrise, Pill,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SessionUser {
  id: number;
  facilityNumber: string;
  username: string;
}

interface MedPassEntry {
  id: number;
  residentId: number;
  residentName: string;
  roomNumber: string;
  medicationId: number;
  drugName: string;
  dosage: string;
  route: string;
  scheduledTime: string;
  prescriber: string;
  status: "pending" | "given" | "late" | "missed" | "refused" | "held";
  shift: "AM" | "PM" | "NOC";
  notes?: string;
}

interface DaySummary {
  date: string;
  total: number;
  given: number;
  pending: number;
  late: number;
  missed: number;
  refused: number;
  held: number;
}

type Shift = "ALL" | "AM" | "PM" | "NOC";
type CalendarView = "year" | "month" | "week" | "day";

// ── Constants ─────────────────────────────────────────────────────────────────

const MED_RIGHTS = [
  "Right Patient", "Right Medication", "Right Dose", "Right Route",
  "Right Time", "Right Documentation", "Right to Refuse", "Right Reason",
];

const RIGHTS_KEY_MAP: Record<string, string> = {
  "Right Patient": "rightResident",
  "Right Medication": "rightMedication",
  "Right Dose": "rightDose",
  "Right Route": "rightRoute",
  "Right Time": "rightTime",
  "Right Reason": "rightReason",
  "Right Documentation": "rightDocumentation",
  "Right to Refuse": "rightToRefuse",
};

const STATUS_CFG = {
  pending: { label: "Pending", border: "border-l-blue-500",   bg: "bg-blue-50",    badge: "bg-blue-100 text-blue-700 border-blue-200",       dot: "bg-blue-500"   },
  given:   { label: "Given",   border: "border-l-emerald-500",bg: "bg-emerald-50", badge: "bg-emerald-100 text-emerald-700 border-emerald-200",dot: "bg-emerald-500"},
  late:    { label: "Late",    border: "border-l-amber-500",  bg: "bg-amber-50",   badge: "bg-amber-100 text-amber-700 border-amber-200",     dot: "bg-amber-500"  },
  missed:  { label: "Missed",  border: "border-l-red-600",    bg: "bg-red-50",     badge: "bg-red-100 text-red-700 border-red-200",           dot: "bg-red-600"    },
  refused: { label: "Refused", border: "border-l-slate-400",  bg: "bg-slate-50",   badge: "bg-slate-100 text-slate-600 border-slate-200",     dot: "bg-slate-400"  },
  held:    { label: "Held",    border: "border-l-yellow-500", bg: "bg-yellow-50",  badge: "bg-yellow-100 text-yellow-700 border-yellow-200",  dot: "bg-yellow-500" },
} as const;

const SHIFT_META = {
  AM:  { label: "Morning",            range: "6:00 AM – 2:00 PM",  Icon: Sun,     headerStyle: { background: "linear-gradient(120deg,#FFFBEB,#FEF9C3)", border: "1px solid #FDE68A" }, iconColor: "text-amber-500" },
  PM:  { label: "Afternoon & Evening",range: "2:00 PM – 10:00 PM", Icon: Sunrise, headerStyle: { background: "linear-gradient(120deg,#EEF2FF,#FFF0F6)", border: "1px solid #E0E7FF" }, iconColor: "text-indigo-500"},
  NOC: { label: "Overnight",          range: "10:00 PM – 6:00 AM", Icon: Moon,    headerStyle: { background: "linear-gradient(120deg,#F1F5F9,#E2E8F0)", border: "1px solid #CBD5E1" }, iconColor: "text-slate-500" },
} as const;

const DOW_HDR = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

// ── Date helpers ──────────────────────────────────────────────────────────────

function isoDate(d: Date): string { return d.toISOString().slice(0, 10); }

function addDays(iso: string, n: number): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() + n);
  return isoDate(d);
}

function startOfWeek(iso: string): string {
  const d = new Date(iso + "T12:00:00");
  d.setDate(d.getDate() - d.getDay());
  return isoDate(d);
}

function startOfMonth(iso: string): string { return iso.slice(0, 7) + "-01"; }

function endOfMonth(iso: string): string {
  const d = new Date(iso.slice(0, 7) + "-01T12:00:00");
  d.setMonth(d.getMonth() + 1);
  d.setDate(0);
  return isoDate(d);
}

function monthGridDays(monthStart: string): string[] {
  const first = new Date(monthStart + "T12:00:00");
  const gridStart = new Date(first);
  gridStart.setDate(first.getDate() - first.getDay());
  const last = new Date(monthStart.slice(0, 7) + "-01T12:00:00");
  last.setMonth(last.getMonth() + 1);
  last.setDate(last.getDate() - 1);
  const weeks = Math.ceil((first.getDay() + last.getDate()) / 7);
  return Array.from({ length: weeks * 7 }, (_, i) => {
    const d = new Date(gridStart);
    d.setDate(d.getDate() + i);
    return isoDate(d);
  });
}

function fmt12(time24: string): string {
  const [h, m] = time24.split(":").map(Number);
  if (isNaN(h) || isNaN(m)) return time24;
  return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`;
}

function fmtDayLabel(iso: string): string {
  return new Date(iso + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
}

// ── StatusBadge ───────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const cfg = STATUS_CFG[status as keyof typeof STATUS_CFG];
  if (!cfg) return null;
  return (
    <span className={cn("inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold border shrink-0", cfg.badge)}>
      <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", cfg.dot)} />
      {cfg.label}
    </span>
  );
}

// ── MedCard ───────────────────────────────────────────────────────────────────

interface MedCardProps {
  entry: MedPassEntry;
  facilityNumber: string;
  isExpanded: boolean;
  onToggle: () => void;
  dateKey: string;
}

function MedCard({ entry, facilityNumber, isExpanded, onToggle, dateKey }: MedCardProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [step, setStep] = useState<"detail" | "confirm">("detail");
  const [rights, setRights] = useState<Record<string, boolean>>(
    Object.fromEntries(MED_RIGHTS.map((r) => [r, true]))
  );
  const [notes, setNotes] = useState("");
  const [refuseReason, setRefuseReason] = useState("");
  const [mode, setMode] = useState<"give" | "refuse" | "hold" | null>(null);

  const mutation = useMutation({
    mutationFn: async (data: { status: "given" | "refused" | "held"; notes?: string; refuseReason?: string; rights?: Record<string, boolean> }) => {
      const rightsPayload = data.rights
        ? Object.fromEntries(
            Object.entries(RIGHTS_KEY_MAP).map(([label, key]) => [key, data.rights![label] ? 1 : 0])
          )
        : {};
      const res = await apiRequest("PUT", `/api/ops/med-passes/${entry.id}`, {
        status: data.status,
        notes: data.notes,
        refusalReason: data.refuseReason,
        administeredDatetime: Date.now(),
        ...rightsPayload,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/facilities/${facilityNumber}/med-pass?date=${dateKey}`] });
      toast({ title: "Med pass charted" });
      onToggle();
      setStep("detail"); setMode(null); setNotes(""); setRefuseReason("");
      setRights(Object.fromEntries(MED_RIGHTS.map((r) => [r, true])));
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const cfg = STATUS_CFG[entry.status] ?? STATUS_CFG.pending;
  const isActionable = entry.status === "pending" || entry.status === "late";

  return (
    <div
      id={`med-entry-${entry.id}`}
      className={cn(
        "rounded-lg border border-l-4 bg-white transition-all",
        cfg.border,
        isActionable && "cursor-pointer hover:shadow-md",
        isExpanded && "shadow-md ring-1 ring-inset ring-gray-100"
      )}
    >
      <div
        className="p-3"
        onClick={isActionable ? onToggle : undefined}
        role={isActionable ? "button" : undefined}
        tabIndex={isActionable ? 0 : undefined}
        onKeyDown={isActionable ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onToggle(); } } : undefined}
        aria-expanded={isActionable ? isExpanded : undefined}
      >
        <div className="flex items-start justify-between gap-2 mb-1.5">
          <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
            <span className="font-semibold text-sm text-gray-900 truncate">{entry.residentName}</span>
            {entry.roomNumber && (
              <span className="shrink-0 px-1.5 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-600">Rm {entry.roomNumber}</span>
            )}
          </div>
          <div className="shrink-0 flex items-center gap-1">
            <StatusBadge status={entry.status} />
            {isActionable && (
              <span className="text-gray-400 ml-0.5">
                {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              </span>
            )}
          </div>
        </div>
        <p className="text-sm font-semibold text-gray-800 leading-tight">{entry.drugName}</p>
        <div className="flex items-center gap-1.5 mt-1 flex-wrap">
          {entry.dosage && <span className="text-xs text-gray-500">{entry.dosage}</span>}
          {entry.dosage && entry.route && <span className="text-xs text-gray-300">·</span>}
          {entry.route && <span className="text-xs text-gray-500">{entry.route}</span>}
          <span className="text-xs text-gray-300">·</span>
          <span className="text-xs font-medium text-gray-600">{fmt12(entry.scheduledTime)}</span>
        </div>
        {entry.prescriber && <p className="text-xs text-gray-400 mt-0.5 truncate">Dr. {entry.prescriber}</p>}
      </div>

      {isExpanded && isActionable && (
        <div className="border-t border-gray-100 bg-gray-50 rounded-b-lg px-3 pt-3 pb-3 space-y-3">
          {step === "detail" && (
            <>
              <div className="text-xs text-gray-600 grid grid-cols-2 gap-x-4 gap-y-0.5">
                <p><span className="text-gray-400">Drug</span> <span className="font-medium text-gray-800">{entry.drugName}</span></p>
                <p><span className="text-gray-400">Dose</span> <span className="font-medium text-gray-800">{entry.dosage}</span></p>
                <p><span className="text-gray-400">Route</span> <span className="font-medium text-gray-800">{entry.route}</span></p>
                {entry.prescriber && <p><span className="text-gray-400">Prescriber</span> <span className="font-medium text-gray-800">Dr. {entry.prescriber}</span></p>}
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs px-3"
                  onClick={(e) => { e.stopPropagation(); setMode("give"); setStep("confirm"); }}>
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1" />Give
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs px-3"
                  onClick={(e) => { e.stopPropagation(); setMode("refuse"); setStep("confirm"); }}>
                  <XCircle className="h-3.5 w-3.5 mr-1" />Refuse
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs px-3"
                  onClick={(e) => { e.stopPropagation(); mutation.mutate({ status: "held", notes: "Held" }); }}
                  disabled={mutation.isPending}>Hold
                </Button>
              </div>
            </>
          )}

          {step === "confirm" && mode === "give" && (
            <div className="space-y-2.5" onClick={(e) => e.stopPropagation()}>
              <p className="text-xs font-semibold text-gray-700">Verify 8 Rights</p>
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-3">
                {MED_RIGHTS.map((right) => (
                  <div key={right} className="flex items-center gap-1.5">
                    <Checkbox id={`right-${entry.id}-${right}`} checked={rights[right]}
                      onCheckedChange={(v) => setRights((r) => ({ ...r, [right]: !!v }))} className="h-3.5 w-3.5" />
                    <label htmlFor={`right-${entry.id}-${right}`} className="text-xs text-gray-600 cursor-pointer leading-tight">{right}</label>
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-gray-500">Notes (optional)</Label>
                <Textarea value={notes} onChange={(e) => setNotes(e.target.value)}
                  placeholder="Administration notes…" className="resize-none min-h-[48px] text-xs" />
              </div>
              <div className="flex gap-2">
                <Button size="sm" className="bg-emerald-600 hover:bg-emerald-700 text-white h-8 text-xs"
                  onClick={() => mutation.mutate({ status: "given", notes, rights })}
                  disabled={mutation.isPending || !Object.values(rights).every(Boolean)}>
                  {mutation.isPending ? "Charting…" : "Confirm & Chart"}
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs"
                  onClick={(e) => { e.stopPropagation(); setStep("detail"); setMode(null); }}>Back</Button>
              </div>
            </div>
          )}

          {step === "confirm" && mode === "refuse" && (
            <div className="space-y-2.5" onClick={(e) => e.stopPropagation()}>
              <div className="space-y-1">
                <Label className="text-xs font-semibold text-gray-700">Reason for refusal</Label>
                <Textarea value={refuseReason} onChange={(e) => setRefuseReason(e.target.value)}
                  placeholder="Document resident's reason…" className="resize-none min-h-[60px] text-xs" autoFocus />
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="destructive" className="h-8 text-xs"
                  onClick={() => mutation.mutate({ status: "refused", notes: refuseReason, refuseReason })}
                  disabled={mutation.isPending || !refuseReason.trim()}>
                  {mutation.isPending ? "Charting…" : "Chart Refused"}
                </Button>
                <Button size="sm" variant="outline" className="h-8 text-xs"
                  onClick={(e) => { e.stopPropagation(); setStep("detail"); setMode(null); }}>Back</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── TimeSlotRow ───────────────────────────────────────────────────────────────

function TimeSlotRow({ time, entries, facilityNumber, expandedId, onExpand, dateKey }: {
  time: string; entries: MedPassEntry[]; facilityNumber: string;
  expandedId: number | null; onExpand: (id: number | null) => void; dateKey: string;
}) {
  const doneCount = entries.filter((e) => ["given","refused","held"].includes(e.status)).length;
  const hasUrgent = entries.some((e) => e.status === "late" || e.status === "missed");
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2.5 px-0.5">
        <Clock className={cn("h-3.5 w-3.5 shrink-0", hasUrgent ? "text-amber-500" : "text-gray-400")} />
        <span className={cn("text-sm font-semibold tabular-nums", hasUrgent ? "text-amber-700" : "text-gray-700")}>{fmt12(time)}</span>
        <span className="h-px flex-1 bg-gray-100" />
        <span className="text-xs text-gray-400 shrink-0">{doneCount}/{entries.length} done</span>
        {hasUrgent && (
          <span className="shrink-0 inline-flex items-center gap-0.5 text-xs font-medium text-amber-600">
            <AlertTriangle className="h-3 w-3" />Attention
          </span>
        )}
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pl-5">
        {entries.map((entry) => (
          <MedCard key={entry.id} entry={entry} facilityNumber={facilityNumber}
            isExpanded={expandedId === entry.id}
            onToggle={() => onExpand(expandedId === entry.id ? null : entry.id)}
            dateKey={dateKey} />
        ))}
      </div>
    </div>
  );
}

// ── ShiftBlock ────────────────────────────────────────────────────────────────

function ShiftBlock({ shiftId, entries, facilityNumber, expandedId, onExpand, forceOpen, dateKey }: {
  shiftId: "AM" | "PM" | "NOC"; entries: MedPassEntry[]; facilityNumber: string;
  expandedId: number | null; onExpand: (id: number | null) => void; forceOpen: boolean; dateKey: string;
}) {
  const [localCollapsed, setLocalCollapsed] = useState(false);
  const collapsed = forceOpen ? false : localCollapsed;
  const meta = SHIFT_META[shiftId];
  const Icon = meta.Icon;
  if (entries.length === 0) return null;

  const doneCount    = entries.filter((e) => ["given","refused","held"].includes(e.status)).length;
  const pendingCount = entries.filter((e) => ["pending","late"].includes(e.status)).length;
  const missedCount  = entries.filter((e) => e.status === "missed").length;
  const byTime = entries.reduce<Record<string, MedPassEntry[]>>((acc, e) => { (acc[e.scheduledTime] ??= []).push(e); return acc; }, {});
  const sortedTimes = Object.keys(byTime).sort();

  return (
    <div className="mb-5">
      <button className="w-full flex items-center justify-between px-4 py-3 rounded-xl text-left hover:brightness-95 transition-all"
        style={meta.headerStyle} onClick={() => setLocalCollapsed((v) => !v)} aria-expanded={!collapsed}>
        <div className="flex items-center gap-2.5">
          <Icon className={cn("h-4 w-4 shrink-0", meta.iconColor)} />
          <span className="font-semibold text-sm" style={{ color: "#1E1B4B" }}>{meta.label}</span>
          <span className="text-xs text-gray-500 hidden sm:inline">{meta.range}</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 text-xs">
            {doneCount > 0    && <span className="text-emerald-600 font-medium">{doneCount} done</span>}
            {pendingCount > 0 && <span className="text-amber-600 font-medium">{pendingCount} pending</span>}
            {missedCount > 0  && <span className="text-red-600 font-medium">{missedCount} missed</span>}
          </div>
          {collapsed ? <ChevronDown className="h-4 w-4 text-gray-400 shrink-0" /> : <ChevronUp className="h-4 w-4 text-gray-400 shrink-0" />}
        </div>
      </button>
      {!collapsed && (
        <div className="pl-2 pt-3">
          {sortedTimes.map((time) => (
            <TimeSlotRow key={time} time={time} entries={byTime[time]} facilityNumber={facilityNumber}
              expandedId={expandedId} onExpand={onExpand} dateKey={dateKey} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── NeedsAttentionSection ─────────────────────────────────────────────────────

function NeedsAttentionSection({ entries, onFocus }: { entries: MedPassEntry[]; onFocus: (e: MedPassEntry) => void }) {
  const [expanded, setExpanded] = useState(true);
  if (entries.length === 0) return null;
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 overflow-hidden mb-4">
      <button className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-red-100/60 transition-colors"
        onClick={() => setExpanded((v) => !v)} aria-expanded={expanded}>
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0" />
          <span className="text-sm font-semibold text-red-800">
            Needs Attention — {entries.length} unresolved item{entries.length !== 1 ? "s" : ""}
          </span>
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-red-400" /> : <ChevronDown className="h-4 w-4 text-red-400" />}
      </button>
      {expanded && (
        <div className="px-4 pb-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {entries.map((entry) => (
            <button key={entry.id}
              className="w-full text-left flex items-center gap-2.5 px-3 py-2 bg-white rounded-lg border border-red-100 hover:border-red-300 hover:shadow-sm transition-all"
              onClick={() => onFocus(entry)}>
              <div className={cn("shrink-0 self-stretch w-1 rounded-full my-0.5", entry.status === "late" ? "bg-amber-500" : "bg-red-600")} />
              <div className="min-w-0 flex-1">
                <div className="mb-0.5"><StatusBadge status={entry.status} /></div>
                <p className="text-xs font-semibold text-gray-800 truncate leading-tight">{entry.drugName}</p>
                <p className="text-xs text-gray-500 truncate">{entry.residentName} · Rm {entry.roomNumber} · {fmt12(entry.scheduledTime)}</p>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── SummaryBar ────────────────────────────────────────────────────────────────

function SummaryBar({ counts }: { counts: { given: number; pending: number; late: number; missed: number } }) {
  return (
    <div className="grid grid-cols-4 gap-2 mb-4">
      {[
        { label: "Given",   count: counts.given,   Icon: CheckCircle2, color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
        { label: "Pending", count: counts.pending, Icon: Clock,        color: "text-blue-700",    bg: "bg-blue-50 border-blue-200"       },
        { label: "Late",    count: counts.late,    Icon: AlertTriangle,color: "text-amber-700",   bg: "bg-amber-50 border-amber-200"     },
        { label: "Missed",  count: counts.missed,  Icon: XCircle,      color: "text-red-700",     bg: "bg-red-50 border-red-200"         },
      ].map(({ label, count, Icon, color, bg }) => (
        <div key={label} className={cn("rounded-lg border px-2 py-1.5 flex items-center gap-1.5", bg)}>
          <Icon className={cn("h-3.5 w-3.5 shrink-0", color)} />
          <p className={cn("text-base font-bold leading-none tabular-nums", color)}>{count}</p>
          <p className={cn("text-xs font-medium opacity-70", color)}>{label}</p>
        </div>
      ))}
    </div>
  );
}

// ── DayView ───────────────────────────────────────────────────────────────────

function DayView({ facilityNumber, dateKey, medPass, isLoading, error, isFetching, onRefetch }: {
  facilityNumber: string; dateKey: string; medPass: MedPassEntry[];
  isLoading: boolean; error: Error | null; isFetching: boolean; onRefetch: () => void;
}) {
  const [shift, setShift] = useState<Shift>("ALL");
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [forcedOpenShifts, setForcedOpenShifts] = useState<Set<"AM" | "PM" | "NOC">>(new Set());

  const filtered = useMemo(
    () => (shift === "ALL" ? medPass : medPass.filter((e) => e.shift === shift)),
    [medPass, shift],
  );
  const counts = useMemo(() => ({
    given: medPass.filter((e) => e.status === "given").length,
    pending: medPass.filter((e) => e.status === "pending").length,
    late: medPass.filter((e) => e.status === "late").length,
    missed: medPass.filter((e) => e.status === "missed").length,
  }), [medPass]);
  const shiftCounts = useMemo(() => ({
    AM:  medPass.filter((e) => e.shift === "AM").length,
    PM:  medPass.filter((e) => e.shift === "PM").length,
    NOC: medPass.filter((e) => e.shift === "NOC").length,
  }), [medPass]);
  const attentionItems = useMemo(() => filtered.filter((e) => e.status === "late" || e.status === "missed"), [filtered]);
  const byShift = useMemo(() => ({
    AM:  filtered.filter((e) => e.shift === "AM"),
    PM:  filtered.filter((e) => e.shift === "PM"),
    NOC: filtered.filter((e) => e.shift === "NOC"),
  }), [filtered]);

  function handleFocusEntry(entry: MedPassEntry) {
    setForcedOpenShifts((s) => { const next = new Set(s); next.add(entry.shift); return next; });
    setShift("ALL");
    setExpandedId(entry.id);
    setTimeout(() => {
      document.getElementById(`med-entry-${entry.id}`)?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 80);
  }

  return (
    <div>
      {/* toolbar row */}
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-gray-500">{fmtDayLabel(dateKey)}</p>
        <Button size="sm" variant="outline" onClick={onRefetch} disabled={isFetching} aria-label="Refresh">
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          <span className="ml-1.5 hidden sm:inline text-xs">Refresh</span>
        </Button>
      </div>

      <SummaryBar counts={counts} />

      {/* Shift filter */}
      <div className="flex items-center gap-1.5 mb-5 flex-wrap">
        <span className="text-xs text-gray-400 mr-0.5">Shift:</span>
        {(["ALL", "AM", "PM", "NOC"] as Shift[]).map((s) => (
          <button key={s} onClick={() => setShift(s)}
            className={cn(
              "inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
              shift === s ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"
            )}>
            {s}
            {s !== "ALL" && (
              <span className={cn("text-[10px] px-1 py-0.5 rounded-full",
                shift === s ? "bg-white/20 text-white" : "bg-gray-100 text-gray-500")}>
                {shiftCounts[s as "AM" | "PM" | "NOC"]}
              </span>
            )}
          </button>
        ))}
      </div>

      {error && (
        <div className="rounded-xl bg-red-50 border border-red-200 px-4 py-3 mb-4 flex items-center gap-2 text-sm text-red-700">
          <AlertTriangle className="h-4 w-4 shrink-0" />Failed to load medication schedule. Please refresh.
        </div>
      )}

      {isLoading && (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="rounded-xl border p-4 space-y-2.5">
              <Skeleton className="h-5 w-32" />
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {Array.from({ length: 3 }).map((__, j) => <Skeleton key={j} className="h-24 rounded-lg" />)}
              </div>
            </div>
          ))}
        </div>
      )}

      {!isLoading && !error && (
        <>
          <NeedsAttentionSection entries={attentionItems} onFocus={handleFocusEntry} />
          {filtered.length === 0 && (
            <div className="rounded-xl border border-dashed border-gray-200 py-14 text-center">
              <CheckCircle2 className="h-10 w-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm font-medium text-gray-500">No medications scheduled for this shift</p>
              <p className="text-xs text-gray-400 mt-1">All clear for the selected period</p>
            </div>
          )}
          {filtered.length > 0 && (
            <div>
              {(["AM", "PM", "NOC"] as const).map((s) => (
                <ShiftBlock key={s} shiftId={s} entries={byShift[s]} facilityNumber={facilityNumber}
                  expandedId={expandedId} onExpand={(id) => { setExpandedId(id); if (id === null) setForcedOpenShifts(new Set()); }}
                  forceOpen={forcedOpenShifts.has(s)} dateKey={dateKey} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── CalendarHeader ─────────────────────────────────────────────────────────────

function CalendarHeader({ view, anchor, today, onViewChange, onNav, onBack }: {
  view: CalendarView; anchor: string; today: string;
  onViewChange: (v: CalendarView) => void; onNav: (dir: -1 | 1) => void; onBack?: () => void;
}) {
  const periodLabel = useMemo(() => {
    if (view === "year") return anchor.slice(0, 4);
    if (view === "month") {
      const d = new Date(startOfMonth(anchor) + "T12:00:00");
      return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    }
    if (view === "week") {
      const ws = startOfWeek(anchor);
      const we = addDays(ws, 6);
      const d1 = new Date(ws + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
      const d2 = new Date(we + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
      return `${d1} – ${d2}`;
    }
    return new Date(anchor + "T12:00:00").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  }, [view, anchor]);

  return (
    <div className="px-4 py-3 rounded-xl mb-4" style={{ background: "linear-gradient(120deg,#EEF2FF,#FFF0F6)", border: "1px solid #E0E7FF" }}>
      {/* row 1: back + title */}
      <div className="flex items-center justify-between mb-2.5">
        <div>
          {onBack && (
            <button onClick={onBack} className="flex items-center gap-1.5 text-sm mb-1 transition-colors" style={{ color: "#818CF8" }}>
              <ArrowLeft className="h-4 w-4" />Back to Overview
            </button>
          )}
          <h1 className="text-base font-bold leading-tight" style={{ color: "#1E1B4B" }}>Medication Administration Record</h1>
        </div>
        {/* view switcher */}
        <div className="flex items-center gap-0.5 bg-white/70 rounded-lg p-0.5 border border-white">
          {(["year","month","week","day"] as CalendarView[]).map((v) => (
            <button key={v} onClick={() => onViewChange(v)}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-semibold capitalize transition-all",
                view === v ? "bg-indigo-600 text-white shadow-sm" : "text-gray-500 hover:text-gray-800"
              )}>
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* row 2: prev / label / next + today */}
      <div className="flex items-center gap-2">
        <button onClick={() => onNav(-1)}
          className="h-7 w-7 rounded-lg border border-white/80 bg-white/60 flex items-center justify-center hover:bg-white transition-colors"
          aria-label="Previous">
          <ChevronLeft className="h-4 w-4 text-gray-600" />
        </button>
        <button onClick={() => onNav(1)}
          className="h-7 w-7 rounded-lg border border-white/80 bg-white/60 flex items-center justify-center hover:bg-white transition-colors"
          aria-label="Next">
          <ChevronRight className="h-4 w-4 text-gray-600" />
        </button>
        <span className="text-sm font-semibold" style={{ color: "#1E1B4B" }}>{periodLabel}</span>
        <button onClick={() => onViewChange("day")}
          className="ml-auto text-xs font-semibold px-2.5 py-1 rounded-lg bg-white/70 border border-white hover:bg-white transition-colors text-indigo-600">
          Today
        </button>
      </div>
    </div>
  );
}

// ── YearView ──────────────────────────────────────────────────────────────────

function YearView({ year, summaryByDate, today, onDrillMonth }: {
  year: number; summaryByDate: Map<string, DaySummary>; today: string; onDrillMonth: (ms: string) => void;
}) {
  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 gap-3">
      {Array.from({ length: 12 }, (_, m) => {
        const monthStart = `${year}-${String(m + 1).padStart(2, "0")}-01`;
        const prefix = monthStart.slice(0, 7);
        const days = monthGridDays(monthStart);
        const inMonthDays = days.filter((d) => d.startsWith(prefix));
        const hasIssue  = inMonthDays.some((d) => { const s = summaryByDate.get(d); return s && (s.late + s.missed) > 0; });
        const hasMeds   = inMonthDays.some((d) => { const s = summaryByDate.get(d); return s && s.total > 0; });
        const totalMeds = inMonthDays.reduce((acc, d) => acc + (summaryByDate.get(d)?.total ?? 0), 0);

        return (
          <button key={monthStart}
            className={cn(
              "rounded-xl border p-3 text-left hover:shadow-md transition-all group",
              hasIssue  ? "border-amber-200 bg-amber-50/60 hover:border-amber-300" :
              hasMeds   ? "border-emerald-200 bg-white hover:border-emerald-300" :
                          "border-gray-100 bg-white hover:border-gray-200"
            )}
            onClick={() => onDrillMonth(monthStart)}>
            <div className="flex items-baseline justify-between mb-2">
              <p className="text-xs font-bold text-gray-800">{MONTH_NAMES[m]}</p>
              {totalMeds > 0 && <span className="text-[10px] text-gray-400">{totalMeds} meds</span>}
            </div>
            {/* mini 7-col dot grid */}
            <div className="grid grid-cols-7 gap-px">
              {days.map((iso) => {
                const inMonth = iso.startsWith(prefix);
                const s       = summaryByDate.get(iso);
                const isToday = iso === today;
                const color   = !inMonth ? "bg-gray-50" :
                                isToday  ? "bg-indigo-500" :
                                s && s.missed > 0 ? "bg-red-500" :
                                s && s.late   > 0 ? "bg-amber-400" :
                                s && s.total  > 0 ? "bg-emerald-400" :
                                                    "bg-gray-100";
                return <div key={iso} className={cn("h-3 rounded-[2px] transition-colors", color, !inMonth && "opacity-30")} />;
              })}
            </div>
          </button>
        );
      })}
    </div>
  );
}

// ── MonthView ─────────────────────────────────────────────────────────────────

// ── DayCell (shared pill-indicator used by Month + Week) ─────────────────────

function DayPillIndicator({ s }: { s: DaySummary }) {
  const hasAlert = (s.late + s.missed) > 0;
  return (
    <div className="w-full mt-1 space-y-1">
      {/* Total count chip with Pill icon — always shown when total > 0 */}
      <div className={cn(
        "flex items-center gap-1 rounded-md px-1.5 py-1 w-full text-xs font-semibold",
        hasAlert ? "bg-amber-100 text-amber-800" : "bg-indigo-100 text-indigo-800"
      )}>
        <Pill className="h-3 w-3 shrink-0" />
        <span>{s.total} med{s.total !== 1 ? "s" : ""}</span>
      </div>
      {/* Status dots row */}
      <div className="flex items-center gap-1 flex-wrap">
        {s.given > 0 && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700">
            <CheckCircle2 className="h-2.5 w-2.5 shrink-0" />{s.given}
          </span>
        )}
        {s.pending > 0 && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700">
            <Clock className="h-2.5 w-2.5 shrink-0" />{s.pending}
          </span>
        )}
        {s.late > 0 && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700">
            <AlertTriangle className="h-2.5 w-2.5 shrink-0" />{s.late}
          </span>
        )}
        {s.missed > 0 && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-red-100 text-red-700">
            <XCircle className="h-2.5 w-2.5 shrink-0" />{s.missed}
          </span>
        )}
      </div>
    </div>
  );
}

function MonthView({ monthStart, summaryByDate, isLoading, today, selectedDate, onSelectDay }: {
  monthStart: string; summaryByDate: Map<string, DaySummary>; isLoading: boolean; today: string;
  selectedDate: string; onSelectDay: (iso: string) => void;
}) {
  const days   = monthGridDays(monthStart);
  const prefix = monthStart.slice(0, 7);

  return (
    <div>
      <div className="grid grid-cols-7 mb-1">
        {DOW_HDR.map((d) => (
          <div key={d} className="text-center text-[10px] font-semibold text-gray-400 py-1 uppercase tracking-wide">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((iso) => {
          const inMonth = iso.startsWith(prefix);
          const isToday = iso === today;
          const isSel   = iso === selectedDate;
          const s       = summaryByDate.get(iso);
          const hasAlert = s && (s.late + s.missed) > 0;

          if (isLoading && inMonth) {
            return (
              <div key={iso} className="min-h-[80px] rounded-xl border border-gray-100 bg-gray-50 p-1.5 flex flex-col gap-1.5 animate-pulse">
                <Skeleton className="h-5 w-5 rounded-full" />
                <Skeleton className="h-5 w-full rounded-md" />
                <Skeleton className="h-4 w-3/4 rounded-full" />
              </div>
            );
          }

          return (
            <button key={iso} onClick={() => inMonth && onSelectDay(iso)}
              className={cn(
                "min-h-[80px] rounded-xl border p-1.5 text-left transition-all flex flex-col",
                !inMonth && "opacity-20 pointer-events-none bg-gray-50 border-gray-50",
                isSel     ? "ring-2 ring-indigo-500 border-indigo-300 bg-indigo-50" :
                isToday   ? "border-indigo-300 bg-indigo-50/80" :
                hasAlert  ? "border-amber-300 bg-amber-50/60 hover:border-amber-400 hover:shadow-sm" :
                s && s.total > 0 ? "border-indigo-100 bg-white hover:border-indigo-200 hover:shadow-sm" :
                            "bg-white border-gray-100 hover:border-gray-200"
              )}>
              <span className={cn(
                "inline-flex h-5 w-5 items-center justify-center rounded-full text-xs font-bold",
                isToday ? "bg-indigo-600 text-white" :
                isSel   ? "bg-indigo-200 text-indigo-800" :
                          "text-gray-700"
              )}>
                {new Date(iso + "T12:00:00").getDate()}
              </span>
              {inMonth && s && s.total > 0 && <DayPillIndicator s={s} />}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// ── WeekView ──────────────────────────────────────────────────────────────────

function WeekView({ weekStart, summaryByDate, isLoading, today, selectedDate, onSelectDay }: {
  weekStart: string; summaryByDate: Map<string, DaySummary>; isLoading: boolean; today: string;
  selectedDate: string; onSelectDay: (iso: string) => void;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  return (
    <div className="grid grid-cols-7 gap-2">
      {days.map((iso) => {
        const d        = new Date(iso + "T12:00:00");
        const dayName  = DOW_HDR[d.getDay()];
        const dayNum   = d.getDate();
        const s        = summaryByDate.get(iso);
        const isToday  = iso === today;
        const isSel    = iso === selectedDate;
        const hasAlert = s && (s.late + s.missed) > 0;

        if (isLoading) {
          return (
            <div key={iso} className="rounded-xl border border-gray-100 bg-gray-50 p-2.5 flex flex-col items-center gap-2 min-h-[150px] animate-pulse">
              <Skeleton className="h-3 w-6 rounded" />
              <Skeleton className="h-7 w-7 rounded-full" />
              <Skeleton className="h-6 w-full rounded-md" />
              <Skeleton className="h-4 w-full rounded-full" />
              <Skeleton className="h-4 w-4/5 rounded-full" />
            </div>
          );
        }

        return (
          <button key={iso} onClick={() => onSelectDay(iso)}
            className={cn(
              "rounded-xl border p-2.5 flex flex-col items-center transition-all hover:shadow-md min-h-[150px]",
              isSel     ? "ring-2 ring-indigo-500 border-indigo-300 bg-indigo-50" :
              isToday   ? "border-indigo-300 bg-indigo-50/80" :
              hasAlert  ? "border-amber-300 bg-amber-50/60 hover:border-amber-400" :
              s && s.total > 0 ? "border-indigo-100 bg-white hover:border-indigo-200" :
                          "bg-white border-gray-100 hover:border-gray-200"
            )}>
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">{dayName}</span>
            <span className={cn(
              "h-7 w-7 flex items-center justify-center rounded-full text-sm font-bold mt-0.5",
              isToday ? "bg-indigo-600 text-white" :
              isSel   ? "bg-indigo-200 text-indigo-800" :
                        "text-gray-800"
            )}>
              {dayNum}
            </span>
            {s && s.total > 0
              ? <DayPillIndicator s={s} />
              : <span className="text-[10px] text-gray-300 mt-2 flex items-center gap-1"><Pill className="h-3 w-3 opacity-30" />No meds</span>
            }
          </button>
        );
      })}
    </div>
  );
}

// ── EmarContent ───────────────────────────────────────────────────────────────

export function EmarContent({ facilityNumber, onBack }: { facilityNumber: string; onBack?: () => void }) {
  const today = isoDate(new Date());
  const [view, setView]               = useState<CalendarView>("month");
  const [anchor, setAnchor]           = useState(startOfMonth(today));
  const [selectedDate, setSelectedDate] = useState(today);

  // ── Summary query (year / month / week) ──
  const summaryRange = useMemo(() => {
    if (view === "year")  return { from: `${anchor.slice(0, 4)}-01-01`, to: `${anchor.slice(0, 4)}-12-31` };
    if (view === "month") return { from: startOfMonth(anchor), to: endOfMonth(anchor) };
    if (view === "week")  { const ws = startOfWeek(anchor); return { from: ws, to: addDays(ws, 6) }; }
    return null;
  }, [view, anchor]);

  const { data: summaryEnvelope, isLoading: summaryLoading } = useQuery<{ success: boolean; data: DaySummary[] } | null>({
    queryKey: [
      `/api/ops/facilities/${facilityNumber}/med-pass/summary`,
      summaryRange?.from,
      summaryRange?.to,
    ],
    queryFn: async () => {
      if (!summaryRange) return null;
      const res = await apiRequest(
        "GET",
        `/api/ops/facilities/${facilityNumber}/med-pass/summary?from=${summaryRange.from}&to=${summaryRange.to}`,
      );
      return res.json();
    },
    enabled: !!facilityNumber && view !== "day",
    staleTime: 60_000,
  });

  const summaryByDate = useMemo(() => {
    const map = new Map<string, DaySummary>();
    for (const s of summaryEnvelope?.data ?? []) map.set(s.date, s);
    return map;
  }, [summaryEnvelope]);

  // ── Day query ──
  const {
    data: dayEnvelope, isLoading: dayLoading, error: dayError,
    refetch: dayRefetch, isFetching: dayFetching,
  } = useQuery<{ success: boolean; data: MedPassEntry[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/med-pass?date=${selectedDate}`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber && view === "day",
    refetchInterval: view === "day" ? 2 * 60 * 1000 : false,
  });

  const medPass = dayEnvelope?.data ?? [];

  // ── Navigation ──
  function navigate(dir: -1 | 1) {
    if (view === "year") {
      setAnchor((a) => `${parseInt(a.slice(0, 4)) + dir}-01-01`);
    } else if (view === "month") {
      setAnchor((a) => {
        const d = new Date(startOfMonth(a) + "T12:00:00");
        d.setMonth(d.getMonth() + dir);
        return isoDate(d);
      });
    } else if (view === "week") {
      setAnchor((a) => addDays(startOfWeek(a), dir * 7));
    } else {
      const next = addDays(selectedDate, dir);
      setSelectedDate(next);
      setAnchor(next);
    }
  }

  function handleViewChange(v: CalendarView) {
    setView(v);
    if (v === "year")  setAnchor(selectedDate.slice(0, 4) + "-01-01");
    else if (v === "month") setAnchor(startOfMonth(selectedDate));
    else if (v === "week")  setAnchor(startOfWeek(selectedDate));
    else /* day */          setAnchor(selectedDate);
  }

  function handleSelectDay(iso: string) {
    setSelectedDate(iso);
    setView("day");
    setAnchor(iso);
  }

  // "Today" button in header drills straight to day view for today
  function handleToday() {
    setSelectedDate(today);
    setView("day");
    setAnchor(today);
  }

  return (
    <div className="max-w-5xl mx-auto">
      <CalendarHeader
        view={view}
        anchor={anchor}
        today={today}
        onViewChange={handleViewChange}
        onNav={navigate}
        onBack={onBack}
      />

      {view === "year" && (
        <YearView
          year={parseInt(anchor.slice(0, 4))}
          summaryByDate={summaryByDate}
          today={today}
          onDrillMonth={(ms) => { setAnchor(ms); setView("month"); }}
        />
      )}

      {view === "month" && (
        <MonthView
          monthStart={startOfMonth(anchor)}
          summaryByDate={summaryByDate}
          isLoading={summaryLoading}
          today={today}
          selectedDate={selectedDate}
          onSelectDay={handleSelectDay}
        />
      )}

      {view === "week" && (
        <WeekView
          weekStart={startOfWeek(anchor)}
          summaryByDate={summaryByDate}
          isLoading={summaryLoading}
          today={today}
          selectedDate={selectedDate}
          onSelectDay={handleSelectDay}
        />
      )}

      {view === "day" && (
        <DayView
          facilityNumber={facilityNumber}
          dateKey={selectedDate}
          medPass={medPass}
          isLoading={dayLoading}
          error={dayError as Error | null}
          isFetching={dayFetching}
          onRefetch={() => dayRefetch()}
        />
      )}
    </div>
  );
}

// ── Default export (standalone page) ─────────────────────────────────────────

export default function EmarPage() {
  const [, navigate] = useLocation();
  const { data: me } = useQuery<SessionUser | null>({
    queryKey: ["/api/facility/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000,
  });
  const facilityNumber = me?.facilityNumber ?? "";
  useEffect(() => { if (me === null) navigate("/facility-portal"); }, [me, navigate]);
  if (me === null) return null;
  return (
    <PortalLayout>
      <EmarContent facilityNumber={facilityNumber} />
    </PortalLayout>
  );
}