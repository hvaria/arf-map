/**
 * <DrillsContent> — Wave 1 W5 (B5).
 *
 * Records fire / disaster / active-threat drills with shift, scenario,
 * evacuation time, participants, debrief. Wave 4 Phase 4.1 swaps the
 * "Quarter cadence enforcement arrives in a later release" footnote for
 * a live `<DrillCadencePanel>` that reads the new
 * `/api/ops/facilities/:fn/drills/cadence` endpoint.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Page heading + gradient primary action:    ComplianceContent.tsx:280-286
 *   - Summary tile grid:                         ComplianceContent.tsx:289-302
 *   - AddX dialog skeleton + onSubmitKey:        ComplianceContent.tsx:55-204
 *   - <FormField> usage:                         components/operations/FormField.tsx
 *   - Loading skeletons / Empty state:           ComplianceContent.tsx:311-318
 *   - Error banner:                              ComplianceContent.tsx:305-307
 *   - useMutation + invalidate + toast:          ComplianceContent.tsx:88-106
 *   - Date helpers (`toLocalEpochMsWithTime`):   lib/datetime.ts
 *   - <AttachEvidence> for sign-in sheet:        components/operations/AttachEvidence.tsx
 *   - Inline cadence panel chips (emerald/red):  EmarContent.tsx:55-62
 *
 * Phase 5 §6 corrections covered:
 *   A.2 — evacuation_seconds entered as mm:ss in UI, parsed to int seconds
 *         before POST. FormField hint reads "Format: mm:ss".
 *
 * API contract (Phase 4 §7.5):
 *   GET  /api/ops/facilities/:fn/drills?kind=&sinceMs=&page=&limit=
 *   POST /api/ops/drills
 *   PUT  /api/ops/drills/:id
 *   DELETE /api/ops/drills/:id
 *   GET  /api/ops/facilities/:fn/drills/cadence       (Wave 4 W6)
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { toLocalEpochMsWithTime, todayLocal } from "@/lib/datetime";
import { FormField, onSubmitKey } from "@/components/operations/FormField";
import {
  AttachEvidence,
  type AttachEvidenceHandle,
} from "@/components/operations/AttachEvidence";
import { Plus, Siren, Info } from "lucide-react";
import { useIsWritable } from "@/context/AuditorContext";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DrillLog {
  id: number;
  facilityNumber: string;
  drillKind: "fire" | "disaster" | "active_threat" | "other";
  shift: "AM" | "PM" | "NOC" | null;
  scenario: string | null;
  executedAt: number;
  leader: string | null;
  evacuationSeconds: number | null;
  debriefNotes: string | null;
  status: "executed" | "scheduled" | "completed" | "cancelled" | "deleted";
  createdBy: string;
  createdAt: number;
  updatedAt: number;
  // Server's decodeDrillLog() decodes the JSONB columns and strips the raw
  // *Json keys from the wire payload. The FE only ever consumes these
  // decoded arrays. (Phase 2 R2: columns flipped from TEXT-JSON to JSONB;
  // the wire shape no longer includes participantsJson / residentsInvolvedJson /
  // correctiveActionsJson under any key.)
  participants: string[];
  residentsInvolved: string[];
  correctiveActions: string[];
}

const DRILL_KINDS = ["fire", "disaster", "active_threat", "other"] as const;
const SHIFTS = ["AM", "PM", "NOC"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtMmSs(seconds: number | null): string {
  if (seconds === null || Number.isNaN(seconds)) return "—";
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Parse "mm:ss" to integer seconds. Accepts "1:58", "01:58", "10:00", "0:30". */
function parseMmSsToSeconds(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d{1,3}):([0-5]?\d)$/);
  if (!m) return Number.NaN;
  const minutes = parseInt(m[1], 10);
  const seconds = parseInt(m[2], 10);
  if (Number.isNaN(minutes) || Number.isNaN(seconds)) return Number.NaN;
  return minutes * 60 + seconds;
}

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function fmtRelativeDays(ms: number): string {
  const diff = Date.now() - ms;
  const days = Math.round(diff / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return `${months} mo ago`;
}

function quarterOf(ms: number): { year: number; quarter: number } {
  const d = new Date(ms);
  return { year: d.getFullYear(), quarter: Math.floor(d.getMonth() / 3) + 1 };
}

function isWithin12Mo(ms: number): boolean {
  return Date.now() - ms <= 365 * 24 * 60 * 60 * 1000;
}

// ── Log Drill dialog ──────────────────────────────────────────────────────────

interface DrillFormData {
  kind: string;
  shift: string;
  scenario: string;
  date: string;
  time: string;
  leader: string;
  participants: string;
  residents: string;
  evacMmSs: string;
  debrief: string;
  correctiveActions: string;
}

function emptyDrillForm(): DrillFormData {
  const d = new Date();
  return {
    kind: "fire",
    shift: "AM",
    scenario: "",
    date: todayLocal(),
    time: d.toTimeString().slice(0, 5),
    leader: "",
    participants: "",
    residents: "",
    evacMmSs: "",
    debrief: "",
    correctiveActions: "",
  };
}

function LogDrillDialog({
  open,
  onOpenChange,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<DrillFormData>(emptyDrillForm);
  const [showErrors, setShowErrors] = useState(false);
  const evidenceRef = useRef<AttachEvidenceHandle | null>(null);

  useEffect(() => {
    if (open) setForm(emptyDrillForm());
  }, [open]);

  const set = <K extends keyof DrillFormData>(key: K, value: DrillFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const evacSeconds = useMemo(() => parseMmSsToSeconds(form.evacMmSs), [form.evacMmSs]);

  const mutation = useMutation({
    mutationFn: async () => {
      const participants = form.participants
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const residents = form.residents
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      const correctiveActions = form.correctiveActions
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean);

      const res = await apiRequest("POST", `/api/ops/drills`, {
        drillKind: form.kind,
        shift: form.shift || undefined,
        scenario: form.scenario.trim() || undefined,
        executedAt: toLocalEpochMsWithTime(form.date, form.time),
        leader: form.leader.trim() || undefined,
        participants,
        residentsInvolved: residents,
        evacuationSeconds:
          evacSeconds === null || Number.isNaN(evacSeconds) ? undefined : evacSeconds,
        debriefNotes: form.debrief.trim() || undefined,
        correctiveActions,
        status: "executed" as const,
      });
      const json = (await res.json()) as { success: boolean; data: DrillLog };
      if (json?.data?.id && evidenceRef.current?.pendingCount) {
        try {
          await evidenceRef.current.flushAttach(json.data.id);
        } catch {
          /* component surfaces retry UI */
        }
      }
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/drills`],
      });
      toast({ title: "Drill logged" });
      onOpenChange(false);
      setShowErrors(false);
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't save drill", description: err.message, variant: "destructive" });
    },
  });

  const errors = {
    kind: !form.kind ? "Pick a drill kind" : undefined,
    date: !form.date ? "When did the drill happen?" : undefined,
    evac:
      form.evacMmSs && evacSeconds !== null && Number.isNaN(evacSeconds)
        ? "Use mm:ss format (e.g., 1:58)"
        : undefined,
  };
  const isValid = !errors.kind && !errors.date && !errors.evac;
  const submit = () => {
    if (!isValid || mutation.isPending) {
      setShowErrors(true);
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Log drill</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Drill kind" required error={showErrors ? errors.kind : undefined}>
              <Select value={form.kind} onValueChange={(v) => set("kind", v)}>
                <SelectTrigger data-testid="drill-kind">
                  <SelectValue placeholder="Select kind" />
                </SelectTrigger>
                <SelectContent>
                  {DRILL_KINDS.map((k) => (
                    <SelectItem key={k} value={k} className="capitalize">
                      {k.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Shift">
              <Select
                value={form.shift || "__none__"}
                onValueChange={(v) => set("shift", v === "__none__" ? "" : v)}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Shift" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Not shift-specific</SelectItem>
                  {SHIFTS.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField label="Scenario">
            <Input
              value={form.scenario}
              onChange={(e) => set("scenario", e.target.value)}
              placeholder="Kitchen fire, 72-hr power outage, …"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Executed on" required error={showErrors ? errors.date : undefined}>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
              />
            </FormField>
            <FormField label="Time">
              <Input
                type="time"
                value={form.time}
                onChange={(e) => set("time", e.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Leader">
            <Input
              value={form.leader}
              onChange={(e) => set("leader", e.target.value)}
              placeholder="Maria S."
            />
          </FormField>
          <FormField label="Participants" hint="Comma- or newline-separated names">
            <Textarea
              value={form.participants}
              onChange={(e) => set("participants", e.target.value)}
              className="resize-none min-h-[48px]"
              placeholder="Anil P., Maria S., Tom L."
            />
          </FormField>
          <FormField label="Residents (optional)" hint="Comma- or newline-separated">
            <Textarea
              value={form.residents}
              onChange={(e) => set("residents", e.target.value)}
              className="resize-none min-h-[40px]"
            />
          </FormField>
          <FormField
            label="Evacuation"
            hint="Format: mm:ss"
            error={showErrors ? errors.evac : undefined}
          >
            <Input
              value={form.evacMmSs}
              onChange={(e) => set("evacMmSs", e.target.value)}
              placeholder="1:58"
              data-testid="drill-evac"
            />
          </FormField>
          <FormField label="Debrief">
            <Textarea
              value={form.debrief}
              onChange={(e) => set("debrief", e.target.value)}
              className="resize-none min-h-[60px]"
              placeholder="What went well, what to improve…"
            />
          </FormField>
          <FormField
            label="Corrective actions"
            hint="One per line"
          >
            <Textarea
              value={form.correctiveActions}
              onChange={(e) => set("correctiveActions", e.target.value)}
              className="resize-none min-h-[40px]"
              placeholder="Replace extinguisher in pantry"
            />
          </FormField>
          <FormField label="Evidence">
            <AttachEvidence
              ref={evidenceRef}
              entityType="ops_drill_log"
              entityId={undefined}
              facilityNumber={facilityNumber}
              triggerLabel="Add sign-in sheet"
            />
          </FormField>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={mutation.isPending} data-testid="drill-save">
              {mutation.isPending ? "Saving…" : "Save drill"}
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground -mt-1 text-right">
            <kbd className="px-1 rounded border bg-gray-50">Enter</kbd> to save
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Drill cadence panel (Wave 4 W6) ──────────────────────────────────────────

interface CadenceShiftRow {
  shift: "AM" | "PM" | "NOC";
  required: number;
  logged: number;
  deficit: number;
  status: "ok" | "behind";
}

interface DrillCadencePayload {
  facilityNumber: string;
  quarterStartAt: number;
  quarterEndAt: number;
  fire: CadenceShiftRow[];
  totalRequired: number;
  totalLogged: number;
  totalDeficit: number;
  worst: "ok" | "behind";
}

function fmtQuarterLabel(startMs: number): string {
  const d = new Date(startMs);
  const q = Math.floor(d.getMonth() / 3) + 1;
  return `Q${q} ${d.getFullYear()}`;
}

function fmtShortDate(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function DrillCadencePanel({ facilityNumber }: { facilityNumber: string }) {
  const { data, isLoading, error } = useQuery<{
    success: boolean;
    data: DrillCadencePayload;
  } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/drills/cadence`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div
        className="rounded-md border border-dashed border-stone-200 bg-stone-50 p-3"
        data-testid="drill-cadence-loading"
      >
        <Skeleton className="h-4 w-40 mb-2" />
        <div className="grid grid-cols-3 gap-2">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      </div>
    );
  }
  if (error || !data?.data || !Array.isArray(data.data.fire)) {
    return (
      <div
        className="rounded-md border border-dashed border-stone-200 bg-stone-50 p-3 text-xs text-muted-foreground flex items-start gap-2"
        data-testid="drill-cadence-error"
      >
        <Info className="h-3.5 w-3.5 mt-0.5 shrink-0" />
        <span>Quarter cadence is unavailable right now.</span>
      </div>
    );
  }

  const p = data.data;
  const isBehind = p.worst === "behind";
  const quarterLabel = fmtQuarterLabel(p.quarterStartAt);
  const containerCls = cn(
    "rounded-md border border-dashed p-3",
    isBehind ? "border-amber-300 bg-amber-50/60" : "border-stone-200 bg-stone-50",
  );

  return (
    <div className={containerCls} data-testid="drill-cadence-panel">
      <div className="flex items-start gap-2 text-xs text-muted-foreground mb-2">
        <Info
          className={cn(
            "h-3.5 w-3.5 mt-0.5 shrink-0",
            isBehind && "text-amber-700",
          )}
          aria-hidden
        />
        <div className="flex-1">
          <p className={cn("font-medium", isBehind ? "text-amber-800" : "text-foreground")}>
            Fire-drill cadence · {quarterLabel}
          </p>
          <p className={cn("text-xs mt-0.5", isBehind && "text-amber-700")}>
            {isBehind ? (
              <>
                Behind cadence — log {p.totalDeficit} more drill
                {p.totalDeficit === 1 ? "" : "s"} before quarter end (
                {fmtShortDate(p.quarterEndAt)}).
              </>
            ) : (
              <>
                {p.totalLogged} of {p.totalRequired} required
              </>
            )}
          </p>
        </div>
      </div>
      <div
        className="grid grid-cols-3 gap-2"
        data-testid="drill-cadence-shifts"
      >
        {p.fire.map((row) => {
          const ok = row.status === "ok";
          return (
            <div
              key={row.shift}
              className={cn(
                "rounded border bg-white p-2 text-center",
                ok
                  ? "border-emerald-200"
                  : "border-red-200 bg-red-50",
              )}
              data-testid={`drill-cadence-shift-${row.shift}`}
            >
              <p className="text-[10px] text-muted-foreground font-semibold uppercase tracking-wide">
                {row.shift}
              </p>
              <p className="text-sm font-medium portal-num mt-0.5">
                {row.logged}
                <span className="text-muted-foreground"> / {row.required}</span>
              </p>
              <span
                className={cn(
                  "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border mt-1 capitalize",
                  ok
                    ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                    : "bg-red-100 text-red-700 border-red-200",
                )}
                aria-label={`Shift ${row.shift} ${row.status}`}
              >
                {ok ? "On track" : "Behind"}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function DrillsContent({ facilityNumber }: { facilityNumber: string }) {
  const [logOpen, setLogOpen] = useState(false);
  // Wave 3 Phase 3.2 — admin sees write actions; auditor session does not.
  const isWritable = useIsWritable();

  const { data, isLoading, error } = useQuery<{ success: boolean; data: DrillLog[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/drills`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const drills = data?.data ?? [];

  const last12 = useMemo(() => drills.filter((d) => isWithin12Mo(d.executedAt)), [drills]);
  const currentQ = quarterOf(Date.now());
  const thisQuarter = useMemo(
    () =>
      drills.filter((d) => {
        const q = quarterOf(d.executedAt);
        return q.year === currentQ.year && q.quarter === currentQ.quarter;
      }),
    [drills, currentQ.year, currentQ.quarter],
  );

  const fireThisQ = thisQuarter.filter((d) => d.drillKind === "fire").length;
  const disasterThisQ = thisQuarter.filter((d) => d.drillKind === "disaster").length;

  const avgEvac = useMemo(() => {
    const withEvac = last12.filter(
      (d) => d.evacuationSeconds !== null && d.evacuationSeconds !== undefined,
    );
    if (withEvac.length === 0) return null;
    const sum = withEvac.reduce((acc, d) => acc + (d.evacuationSeconds ?? 0), 0);
    return Math.round(sum / withEvac.length);
  }, [last12]);

  const latest = useMemo(() => {
    if (drills.length === 0) return null;
    return drills.reduce((acc, d) => (d.executedAt > acc.executedAt ? d : acc), drills[0]);
  }, [drills]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold" style={{ color: "#1E1B4B" }}>
          Drills
        </h1>
        {isWritable && (
          <Button size="sm" variant="gradient" onClick={() => setLogOpen(true)} data-testid="drill-log-trigger">
            <Plus className="h-4 w-4 mr-1.5" />
            Log drill
          </Button>
        )}
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg p-3 text-center" style={{ background: "#F0F4FF", border: "1px solid #E0E7FF" }}>
          <p className="text-xl font-bold portal-num">{thisQuarter.length}</p>
          <p className="text-xs text-muted-foreground">
            This quarter
          </p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            Fire {fireThisQ} · Disaster {disasterThisQ}
          </p>
        </div>
        <div className="rounded-lg border bg-stone-50 border-stone-200 p-3 text-center">
          <p className="text-xl font-bold portal-num">{last12.length}</p>
          <p className="text-xs text-muted-foreground">Last 12 mo</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {avgEvac !== null ? `Avg evac ${fmtMmSs(avgEvac)}` : "—"}
          </p>
        </div>
        <div className="rounded-lg border bg-stone-50 border-stone-200 p-3 text-center">
          {latest ? (
            <>
              <p className="text-sm font-semibold capitalize">
                {latest.drillKind.replace(/_/g, " ")} · {latest.shift ?? "—"}
              </p>
              <p className="text-xs text-muted-foreground">{fmtRelativeDays(latest.executedAt)}</p>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground">No drills logged</p>
            </>
          )}
        </div>
      </div>

      {error && (
        <div
          className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive"
          role="alert"
        >
          Failed to load drills.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : drills.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center" data-testid="drill-empty">
          <Siren className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            No drills logged yet. Most facilities log fire drills monthly.
          </p>
          {isWritable && (
            <Button size="sm" variant="gradient" onClick={() => setLogOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Log your first drill
            </Button>
          )}
        </div>
      ) : (
        <>
          <h2 className="text-sm font-medium text-muted-foreground">Recent (12 months)</h2>
          <ul className="space-y-2" data-testid="drill-list">
            {[...last12]
              .sort((a, b) => b.executedAt - a.executedAt)
              .map((d) => {
                // Server's decodeDrillLog parses JSONB into arrays and strips
                // the raw *Json keys from the wire payload, so consume the
                // decoded arrays directly (no fallback needed).
                const participants = d.participants ?? [];
                const residents = d.residentsInvolved ?? [];
                return (
                  <li
                    key={d.id}
                    className={cn(
                      "rounded-lg border p-4",
                      "border-stone-200 bg-white",
                    )}
                  >
                    <div className="flex items-start justify-between gap-3 flex-wrap">
                      <div className="min-w-0">
                        <p className="font-medium text-sm capitalize">
                          {d.drillKind.replace(/_/g, " ")} drill
                          {d.shift ? ` · ${d.shift} shift` : ""}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {fmtDate(d.executedAt)}
                          {d.leader ? ` · Leader: ${d.leader}` : ""}
                          {participants.length > 0 ? ` · ${participants.length} staff` : ""}
                          {residents.length > 0 ? ` · ${residents.length} residents` : ""}
                          {d.evacuationSeconds !== null && d.evacuationSeconds !== undefined
                            ? ` · Evac ${fmtMmSs(d.evacuationSeconds)}`
                            : ""}
                        </p>
                        {d.scenario && (
                          <p className="text-xs text-muted-foreground mt-1">
                            Scenario: {d.scenario}
                          </p>
                        )}
                        {d.debriefNotes && (
                          <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                            Debrief: {d.debriefNotes}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700 border border-emerald-200 capitalize">
                        Executed
                      </span>
                    </div>
                  </li>
                );
              })}
          </ul>
        </>
      )}

      <DrillCadencePanel facilityNumber={facilityNumber} />

      <LogDrillDialog
        open={logOpen}
        onOpenChange={setLogOpen}
        facilityNumber={facilityNumber}
      />
    </div>
  );
}
