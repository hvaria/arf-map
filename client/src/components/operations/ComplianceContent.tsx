/**
 * ComplianceContent — Wave 2 finale: switched from the legacy
 * `/api/ops/facilities/:fn/compliance` endpoint to the richer
 * `/api/ops/facilities/:fn/obligations` endpoint (BA §4.3, §5
 * obligation workflows, §6 state machine). The legacy compliance
 * endpoint still works as a backward-compat shim on the server, but
 * the obligation engine surfaces severity, recurrence, source-link
 * info, and the full §6 state machine that the legacy shape cannot.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Page heading style:                       ComplianceContent.tsx:281 (preserved)
 *   - Summary tile grid + tone palette:         ComplianceContent.tsx:289-302 (preserved)
 *   - Group-by-month list + per-row card:       ComplianceContent.tsx:207-215, 320-380 (preserved)
 *   - Status badge tone palette:                EmarContent.tsx:55-62
 *   - `<AddXDialog>` skeleton (header/body/footer/kbd hint):
 *                                                ComplianceContent.tsx:55-204 (preserved)
 *   - `<FormField>` + `onSubmitKey`:            client/src/components/operations/FormField.tsx
 *   - shadcn `<DropdownMenu>` transition menu:  OperationsTab.tsx:1947-1982
 *   - apiRequest / getQueryFn envelope:         client/src/lib/queryClient.ts
 *   - Obligation domain (types/labels/statuses/recurrence):
 *                                                shared/obligations.ts
 *
 * Backward-compat:
 *   - The "Complete" inline action used to PUT `/api/ops/compliance/:id`
 *     with `{status:"completed"}`. It now POSTs `/api/ops/obligations/:id/complete`
 *     and surfaces `next` (the recurrence-driven follow-up cycle) when
 *     the BE returns one.
 *   - The Add dialog used to POST `/api/ops/compliance`. It now POSTs
 *     `/api/ops/obligations` with the richer payload (severity,
 *     recurrenceRule, title, targetType).
 *
 * 30s staleTime: obligations move (transition, complete, recur) more
 * often than the chart-completeness aggregate (60s) but rarely enough
 * that an immediate refetch every render would be wasteful. Mutations
 * invalidate the key on success for instant freshness.
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getQueryFn, apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useSession } from "@/hooks/useSession";
import { cn } from "@/lib/utils";
import { toLocalEpochMs } from "@/lib/datetime";
import { FormField, onSubmitKey } from "@/components/operations/FormField";
import {
  Plus,
  ShieldCheck,
  Check,
  AlertCircle,
  Clock,
  ArrowLeft,
  Repeat,
  Link2,
  MoreHorizontal,
} from "lucide-react";
import {
  OBLIGATION_TYPES,
  OBLIGATION_TYPE_LABELS,
  OBLIGATION_SEVERITIES,
  type ObligationType,
  type ObligationSeverity,
  type ObligationStatus,
  type RecurrenceRule,
  parseRecurrence,
  isTerminalStatus,
} from "@shared/obligations";

// ─────────────────────────────────────────────────────────────────────────────
// Row shape — mirrors `ops_obligations` (server/ops/opsSchema.ts:702-726).
// ─────────────────────────────────────────────────────────────────────────────

export interface Obligation {
  id: number;
  facilityNumber: string;
  obligationType: ObligationType | string;
  targetType: "facility" | "resident" | "staff" | "vendor" | "room";
  targetId: number | null;
  title: string;
  description: string | null;
  dueAt: number;
  completedAt: number | null;
  completedBy: string | null;
  assignedTo: string | null;
  severity: ObligationSeverity;
  status: ObligationStatus;
  recurrenceRule: RecurrenceRule | string | null;
  sourceEntityType: string | null;
  sourceEntityId: number | null;
  createdAt: number;
  updatedAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Visual tone palettes — reuse the existing Wave 1 palette.
// Severity tones cite EmarContent.tsx:55-62 (badge shape + tones).
// ─────────────────────────────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<ObligationSeverity, string> = {
  high: "bg-red-100 text-red-700 border-red-200",
  medium: "bg-amber-100 text-amber-700 border-amber-200",
  low: "bg-slate-100 text-slate-600 border-slate-200",
};

const SEVERITY_LABELS: Record<ObligationSeverity, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

// Status tones — extends the legacy 3-state palette to the full §6
// machine. Terminal states use the same muted/neutral feel; in-flight
// states use blue/amber.
const STATUS_STYLES: Record<ObligationStatus, string> = {
  pending: "bg-blue-100 text-blue-700",
  in_progress: "bg-indigo-100 text-indigo-700",
  submitted: "bg-violet-100 text-violet-700",
  under_review: "bg-amber-100 text-amber-700",
  approved: "bg-emerald-100 text-emerald-700",
  rejected: "bg-rose-100 text-rose-700",
  expired: "bg-stone-200 text-stone-700",
  closed: "bg-green-100 text-green-700",
};

const STATUS_LABELS: Record<ObligationStatus, string> = {
  pending: "Pending",
  in_progress: "In progress",
  submitted: "Submitted",
  under_review: "Under review",
  approved: "Approved",
  rejected: "Rejected",
  expired: "Expired",
  closed: "Closed",
};

// Recurrence chip copy.
function recurrenceLabel(rule: RecurrenceRule | string | null | undefined): string | null {
  if (!rule) return null;
  if (rule === "annual") return "Annual";
  if (rule === "quarterly") return "Quarterly";
  if (rule === "monthly") return "Monthly";
  const parsed = parseRecurrence(typeof rule === "string" ? rule : null);
  if (parsed && parsed.kind === "every_n_days") return `Every ${parsed.days} days`;
  return null;
}

// Source-entity chip copy.
const SOURCE_LABELS: Record<string, string> = {
  ops_staff_credential: "from credential",
  ops_temperature_log: "from temp log",
  ops_complaint: "from complaint",
  ops_inspection: "from inspection",
  legacy_compliance: "from legacy compliance",
};

function sourceLabel(t: string | null | undefined): string | null {
  if (!t) return null;
  return SOURCE_LABELS[t] ?? `from ${t.replace(/^ops_/, "").replace(/_/g, " ")}`;
}

interface StaffLite {
  id: number;
  firstName: string;
  lastName: string;
  role?: string;
  status?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// AddObligationDialog — formerly AddComplianceDialog. POSTs to
// `/api/ops/obligations` with the Wave 2 finale payload.
// Skeleton citation: ComplianceContent.tsx:55-204 (preserved structure).
// ─────────────────────────────────────────────────────────────────────────────

function AddObligationDialog({
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
  const [form, setForm] = useState({
    obligationType: "",
    title: "",
    description: "",
    dueAt: "",
    assignedTo: "",
    severity: "medium" as ObligationSeverity,
    recurrence: "none" as "none" | "annual" | "quarterly" | "monthly" | "every_n_days",
    everyNDays: "30",
  });

  // Staff list drives the assignee dropdown — same rationale as the
  // legacy AddComplianceDialog (free-text broke "My work" matching).
  const { data: staffEnv } = useQuery<{ success: boolean; data: StaffLite[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/staff`],
    enabled: open && !!facilityNumber,
    staleTime: 60_000,
  });
  const activeStaff = (staffEnv?.data ?? []).filter(
    (s) => !s.status || s.status === "active",
  );

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const [showErrors, setShowErrors] = useState(false);

  // Compose the recurrence rule for the wire (matches shared/obligations.ts
  // `RecurrenceRule` grammar).
  const recurrenceRule: RecurrenceRule | null = (() => {
    if (form.recurrence === "none") return null;
    if (form.recurrence === "every_n_days") {
      const n = parseInt(form.everyNDays, 10);
      if (!Number.isFinite(n) || n <= 0) return null;
      return `every_n_days:${n}` as RecurrenceRule;
    }
    return form.recurrence as RecurrenceRule;
  })();

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/obligations`, {
        obligationType: form.obligationType,
        title: form.title,
        description: form.description || undefined,
        severity: form.severity,
        recurrenceRule: recurrenceRule ?? undefined,
        dueAt: form.dueAt ? toLocalEpochMs(form.dueAt) : null,
        assignedTo: form.assignedTo || undefined,
        targetType: "facility",
        targetId: null,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/obligations`],
      });
      toast({ title: "Obligation added" });
      onOpenChange(false);
      setForm({
        obligationType: "",
        title: "",
        description: "",
        dueAt: "",
        assignedTo: "",
        severity: "medium",
        recurrence: "none",
        everyNDays: "30",
      });
      setShowErrors(false);
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // Mirror server-side validation; server still owns correctness.
  const dueAtMs = form.dueAt ? toLocalEpochMs(form.dueAt) : null;
  const todayMidnight = (() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  })();
  const errors = {
    obligationType: !form.obligationType ? "Pick an obligation type" : undefined,
    title: !form.title.trim() ? "Title is required" : undefined,
    dueAt:
      dueAtMs !== null && dueAtMs < todayMidnight
        ? "Due date must be today or later"
        : undefined,
    everyNDays:
      form.recurrence === "every_n_days" &&
      (!Number.isFinite(parseInt(form.everyNDays, 10)) ||
        parseInt(form.everyNDays, 10) <= 0)
        ? "Enter a positive number of days"
        : undefined,
  };
  const isValid =
    !errors.obligationType && !errors.title && !errors.dueAt && !errors.everyNDays;
  const submit = () => {
    if (!isValid || mutation.isPending) {
      setShowErrors(true);
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Obligation</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField
            label="Type"
            required
            error={showErrors ? errors.obligationType : undefined}
          >
            <Select
              value={form.obligationType}
              onValueChange={(v) => set("obligationType", v)}
            >
              <SelectTrigger
                aria-invalid={!!(showErrors && errors.obligationType)}
                aria-label="Obligation type"
              >
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                {OBLIGATION_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {OBLIGATION_TYPE_LABELS[t]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          <FormField label="Title" required error={showErrors ? errors.title : undefined}>
            <Input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              aria-invalid={!!(showErrors && errors.title)}
              aria-label="Obligation title"
              placeholder="e.g. Annual fire-extinguisher service"
            />
          </FormField>

          <FormField label="Description">
            <Textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Optional context, scope, or remediation notes…"
              className="resize-none min-h-[60px]"
            />
          </FormField>

          <div className="grid grid-cols-2 gap-3">
            <FormField label="Severity" required>
              <Select
                value={form.severity}
                onValueChange={(v) => set("severity", v as ObligationSeverity)}
              >
                <SelectTrigger aria-label="Severity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OBLIGATION_SEVERITIES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {SEVERITY_LABELS[s]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Recurrence">
              <Select
                value={form.recurrence}
                onValueChange={(v) => set("recurrence", v as typeof form.recurrence)}
              >
                <SelectTrigger aria-label="Recurrence">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">One-time</SelectItem>
                  <SelectItem value="annual">Annual</SelectItem>
                  <SelectItem value="quarterly">Quarterly</SelectItem>
                  <SelectItem value="monthly">Monthly</SelectItem>
                  <SelectItem value="every_n_days">Every N days</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>

          {form.recurrence === "every_n_days" && (
            <FormField
              label="Every N days"
              required
              error={showErrors ? errors.everyNDays : undefined}
            >
              <Input
                type="number"
                min={1}
                value={form.everyNDays}
                onChange={(e) => set("everyNDays", e.target.value)}
                aria-invalid={!!(showErrors && errors.everyNDays)}
                aria-label="Recurrence interval in days"
              />
            </FormField>
          )}

          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Due Date"
              required
              error={showErrors ? errors.dueAt : undefined}
            >
              <Input
                type="date"
                value={form.dueAt}
                min={new Date().toISOString().slice(0, 10)}
                onChange={(e) => set("dueAt", e.target.value)}
                aria-invalid={!!(showErrors && errors.dueAt)}
              />
            </FormField>
            <FormField label="Assigned To">
              <Select
                value={form.assignedTo || "__unassigned__"}
                onValueChange={(v) =>
                  set("assignedTo", v === "__unassigned__" ? "" : v)
                }
              >
                <SelectTrigger aria-label="Assigned to">
                  <SelectValue placeholder="Select staff…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassigned__">Unassigned</SelectItem>
                  {activeStaff.length === 0 ? (
                    <div className="px-2 py-1.5 text-xs text-muted-foreground">
                      No active staff
                    </div>
                  ) : (
                    activeStaff.map((s) => {
                      const fullName = `${s.firstName} ${s.lastName}`.trim();
                      return (
                        <SelectItem key={s.id} value={fullName}>
                          {fullName}
                          {s.role ? ` · ${s.role.replace(/_/g, " ")}` : ""}
                        </SelectItem>
                      );
                    })
                  )}
                </SelectContent>
              </Select>
            </FormField>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? "Adding..." : "Add Obligation"}
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

// Group items by month — preserves ComplianceContent.tsx:207-215.
function groupByMonth(items: Obligation[]): Record<string, Obligation[]> {
  return items.reduce<Record<string, Obligation[]>>((acc, item) => {
    const d = new Date(item.dueAt);
    const key = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

// Transitions the user can request from a non-terminal row. Mirrors
// BA §6 forward edges. Server still owns correctness — the menu just
// exposes the affordance.
const TRANSITION_TARGETS: { value: ObligationStatus; label: string }[] = [
  { value: "in_progress", label: "Mark in progress" },
  { value: "submitted", label: "Mark submitted" },
  { value: "under_review", label: "Mark under review" },
  { value: "approved", label: "Mark approved" },
  { value: "rejected", label: "Mark rejected" },
  { value: "expired", label: "Mark expired" },
];

export function ComplianceContent({
  facilityNumber,
  onBack,
}: {
  facilityNumber: string;
  onBack?: () => void;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const sessionQ = useSession();
  const sessionUser = sessionQ.data?.username ?? "system";

  const queryKey = [`/api/ops/facilities/${facilityNumber}/obligations`];

  const {
    data: envelope,
    isLoading,
    error,
  } = useQuery<{ success: boolean; data: Obligation[] } | null>({
    queryKey,
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 30_000,
  });

  const items = envelope?.data ?? [];

  // ── Optimistic complete ──────────────────────────────────────────────
  const completeMutation = useMutation<
    { success: boolean; data: Obligation; next?: { id: number; dueAt: number } | null },
    Error,
    number,
    { previous?: { success: boolean; data: Obligation[] } | null }
  >({
    mutationFn: async (itemId) => {
      const res = await apiRequest("POST", `/api/ops/obligations/${itemId}/complete`, {
        by: sessionUser,
      });
      return res.json();
    },
    onMutate: async (itemId) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<{ success: boolean; data: Obligation[] } | null>(
        queryKey,
      );
      if (previous?.data) {
        qc.setQueryData<{ success: boolean; data: Obligation[] } | null>(queryKey, {
          ...previous,
          data: previous.data.map((o) =>
            o.id === itemId
              ? { ...o, status: "closed" as ObligationStatus, completedAt: Date.now() }
              : o,
          ),
        });
      }
      return { previous };
    },
    onSuccess: (resp) => {
      qc.invalidateQueries({ queryKey });
      if (resp.next?.dueAt) {
        const when = new Date(resp.next.dueAt).toLocaleDateString();
        toast({
          title: "Obligation closed",
          description: `Next cycle scheduled for ${when}.`,
        });
      } else {
        toast({ title: "Obligation closed" });
      }
    },
    onError: (err, _id, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  // ── Optimistic transition ────────────────────────────────────────────
  const transitionMutation = useMutation<
    { success: boolean; data: Obligation },
    Error,
    { id: number; status: ObligationStatus },
    { previous?: { success: boolean; data: Obligation[] } | null }
  >({
    mutationFn: async ({ id, status }) => {
      const res = await apiRequest("POST", `/api/ops/obligations/${id}/transition`, {
        status,
        by: sessionUser,
      });
      return res.json();
    },
    onMutate: async ({ id, status }) => {
      await qc.cancelQueries({ queryKey });
      const previous = qc.getQueryData<{ success: boolean; data: Obligation[] } | null>(
        queryKey,
      );
      if (previous?.data) {
        qc.setQueryData<{ success: boolean; data: Obligation[] } | null>(queryKey, {
          ...previous,
          data: previous.data.map((o) => (o.id === id ? { ...o, status } : o)),
        });
      }
      return { previous };
    },
    onSuccess: (_resp, vars) => {
      qc.invalidateQueries({ queryKey });
      toast({ title: `Marked ${STATUS_LABELS[vars.status]}` });
    },
    onError: (err, _vars, ctx) => {
      if (ctx?.previous) qc.setQueryData(queryKey, ctx.previous);
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const now = Date.now();
  const oneWeek = 7 * 24 * 60 * 60 * 1000;

  const isOpen = (o: Obligation) => !isTerminalStatus(o.status);
  const isOverdueRow = (o: Obligation) =>
    o.status === "expired" || (isOpen(o) && o.dueAt < now);

  const pending = items.filter(isOpen);
  const overdue = items.filter(isOverdueRow);
  const dueThisWeek = items.filter(
    (i) => isOpen(i) && i.dueAt >= now && i.dueAt <= now + oneWeek,
  );

  // Sort: overdue first, then by due date.
  const sorted = [...items].sort((a, b) => {
    const aOverdue = isOverdueRow(a);
    const bOverdue = isOverdueRow(b);
    if (aOverdue && !bOverdue) return -1;
    if (!aOverdue && bOverdue) return 1;
    return a.dueAt - b.dueAt;
  });

  const grouped = groupByMonth(sorted);

  return (
    <div className="space-y-4">
      {onBack && (
        <button
          onClick={onBack}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground mb-4 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Overview
        </button>
      )}

      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold" style={{ color: "#1E1B4B" }}>
          Compliance
        </h1>
        <Button size="sm" variant="gradient" onClick={() => setAddOpen(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add Item
        </Button>
      </div>

      {/* Summary bar — preserved tone palette from legacy ComplianceContent. */}
      <div className="grid grid-cols-3 gap-3">
        <div
          className="rounded-lg p-3 text-center"
          style={{ background: "#F0F4FF", border: "1px solid #E0E7FF" }}
        >
          <p className="text-xl font-bold">{pending.length}</p>
          <p className="text-xs text-muted-foreground">Open</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center">
          <p className="text-xl font-bold text-red-700">{overdue.length}</p>
          <p className="text-xs text-red-600">Overdue</p>
        </div>
        <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-center">
          <p className="text-xl font-bold text-yellow-700">{dueThisWeek.length}</p>
          <p className="text-xs text-yellow-600">Due This Week</p>
        </div>
      </div>

      {error && (
        <div className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive">
          Failed to load obligations.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <ShieldCheck className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            No obligations. Add your first item.
          </p>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([month, monthItems]) => (
            <div key={month}>
              <h2 className="text-sm font-medium text-muted-foreground mb-2">
                {month}
              </h2>
              <div className="space-y-2">
                {monthItems.map((item) => {
                  const overdueRow = isOverdueRow(item);
                  const closed = isTerminalStatus(item.status);
                  const typeLabel =
                    OBLIGATION_TYPE_LABELS[item.obligationType as ObligationType] ??
                    String(item.obligationType).replace(/_/g, " ");
                  const recLabel = recurrenceLabel(item.recurrenceRule);
                  const srcLabel = sourceLabel(item.sourceEntityType);
                  return (
                    <div
                      key={item.id}
                      data-testid={`obligation-row-${item.id}`}
                      className={cn(
                        "rounded-lg border p-4 flex items-start gap-3",
                        overdueRow
                          ? "border-red-200 bg-red-50"
                          : closed
                          ? "opacity-60"
                          : "",
                      )}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-sm">{typeLabel}</span>
                          <Badge
                            className={cn("text-xs border", SEVERITY_STYLES[item.severity])}
                            aria-label={`Severity ${SEVERITY_LABELS[item.severity]}`}
                            data-testid={`obligation-severity-${item.id}`}
                          >
                            {SEVERITY_LABELS[item.severity]}
                          </Badge>
                          {recLabel && (
                            <Badge
                              variant="outline"
                              className="text-xs border-stone-300 text-stone-700"
                              aria-label={`Recurs ${recLabel}`}
                              data-testid={`obligation-recurrence-${item.id}`}
                            >
                              <Repeat className="h-3 w-3 mr-0.5" />
                              {recLabel}
                            </Badge>
                          )}
                          {srcLabel && (
                            <span
                              className="inline-flex items-center gap-0.5 text-[11px] text-muted-foreground px-1.5 py-0.5 rounded border border-stone-200 bg-stone-50"
                              aria-label={`Linked ${srcLabel}`}
                              data-testid={`obligation-source-${item.id}`}
                            >
                              <Link2 className="h-3 w-3" />
                              {srcLabel}
                            </span>
                          )}
                          {overdueRow && (
                            <Badge className="bg-red-100 text-red-700 text-xs">
                              <AlertCircle className="h-3 w-3 mr-0.5" />
                              Overdue
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm font-medium mt-0.5">{item.title}</p>
                        {item.description && (
                          <p className="text-sm text-muted-foreground mt-0.5">
                            {item.description}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <Clock className="h-3 w-3" />
                            Due {new Date(item.dueAt).toLocaleDateString()}
                          </span>
                          {item.assignedTo && <span>Assigned: {item.assignedTo}</span>}
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={cn(
                            "text-xs px-1.5 py-0.5 rounded",
                            STATUS_STYLES[item.status] ?? "",
                          )}
                          aria-label={`Status ${STATUS_LABELS[item.status]}`}
                        >
                          {STATUS_LABELS[item.status]}
                        </span>
                        {!closed && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            onClick={() => completeMutation.mutate(item.id)}
                            disabled={completeMutation.isPending}
                            aria-label="Mark complete"
                            data-testid={`obligation-complete-${item.id}`}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {!closed && (
                          <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-7 w-7 p-0"
                                aria-label="More actions"
                                data-testid={`obligation-more-${item.id}`}
                              >
                                <MoreHorizontal className="h-3.5 w-3.5" />
                              </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-44">
                              {TRANSITION_TARGETS.filter(
                                (t) => t.value !== item.status,
                              ).map((t) => (
                                <DropdownMenuItem
                                  key={t.value}
                                  onClick={() =>
                                    transitionMutation.mutate({
                                      id: item.id,
                                      status: t.value,
                                    })
                                  }
                                  className="text-xs cursor-pointer"
                                >
                                  {t.label}
                                </DropdownMenuItem>
                              ))}
                            </DropdownMenuContent>
                          </DropdownMenu>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <AddObligationDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        facilityNumber={facilityNumber}
      />
    </div>
  );
}
