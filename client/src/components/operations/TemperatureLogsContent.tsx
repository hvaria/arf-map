/**
 * <TemperatureLogsContent> — Wave 1 W7 (B3).
 *
 * Daily temperature entries per fixture (fridge, freezer, hot water, dish
 * machine). Out-of-range readings auto-flag and the BE creates a follow-up
 * obligation; UI displays it inline on the fixture row.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Page heading + gradient primary action:    ComplianceContent.tsx:280-286
 *   - Summary tile grid:                         ComplianceContent.tsx:289-302
 *   - Loading skeleton row pattern:              ComplianceContent.tsx:311-313
 *   - Empty state dashed border:                 ComplianceContent.tsx:315-318
 *   - Error banner:                              ComplianceContent.tsx:305-307
 *   - AddX dialog skeleton + onSubmitKey:        ComplianceContent.tsx:55-204
 *   - <FormField> usage:                         components/operations/FormField.tsx
 *   - Status badge tone (emerald/amber/red):     EmarContent.tsx:55-62
 *   - useMutation + invalidate + toast:          ComplianceContent.tsx:88-106
 *   - useSession for "Recorded by" default:      hooks/useSession.ts
 *   - <AttachEvidence> for optional photo:       components/operations/AttachEvidence.tsx
 *
 * Phase 5 §6 corrections covered:
 *   A.1 — "Recorded by" free-text input, default = session user, editable.
 *
 * API contract (Phase 4 §7.4):
 *   GET  /api/ops/facilities/:fn/temp-fixtures
 *   POST /api/ops/temp-fixtures
 *   GET  /api/ops/facilities/:fn/temp-logs?fixtureKey=&sinceMs=&outOfRangeOnly=
 *   POST /api/ops/temp-logs
 *   POST /api/ops/temp-logs/:id/resolve
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
import { useSession } from "@/hooks/useSession";
import { cn } from "@/lib/utils";
import { FormField, onSubmitKey } from "@/components/operations/FormField";
import { AttachEvidence, type AttachEvidenceHandle } from "@/components/operations/AttachEvidence";
import {
  Plus,
  Thermometer,
  CheckCircle2,
  AlertTriangle,
  Clock,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TempFixture {
  id: number;
  facilityNumber: string;
  fixtureKey: string;
  fixtureLabel: string;
  kind: string;
  unit: "F" | "C";
  requiredMin: number | null;
  requiredMax: number | null;
  status?: "active" | "inactive";
}

export interface TempLog {
  id: number;
  facilityNumber: string;
  fixtureId: number;
  fixtureKey: string;
  readingValue: number;
  unit: "F" | "C";
  thresholdMin: number | null;
  thresholdMax: number | null;
  outOfRange: number | boolean;
  readingAt: number;
  recordedBy: string;
  note: string | null;
  followUpDueAt: number | null;
  resolvedAt?: number | null;
  createdAt: number;
}

const FIXTURE_KINDS = [
  "fridge",
  "freezer",
  "hot_water",
  "dish_machine",
  "other",
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isToday(ms: number): boolean {
  const d = new Date(ms);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
}

function fmtRelative(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

function slugifyKey(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

function isOutOfRange(
  value: number,
  min: number | null,
  max: number | null,
): boolean {
  if (min !== null && value < min) return true;
  if (max !== null && value > max) return true;
  return false;
}

// ── Add Fixture dialog ────────────────────────────────────────────────────────

function AddFixtureDialog({
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
    name: "",
    kind: "fridge",
    unit: "F",
    requiredMin: "",
    requiredMax: "",
  });
  const [showErrors, setShowErrors] = useState(false);

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  const fixtureKey = useMemo(() => slugifyKey(form.name), [form.name]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/temp-fixtures`, {
        fixtureKey,
        fixtureLabel: form.name.trim(),
        kind: form.kind,
        unit: form.unit,
        requiredMin: form.requiredMin ? Number(form.requiredMin) : undefined,
        requiredMax: form.requiredMax ? Number(form.requiredMax) : undefined,
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/temp-fixtures`],
      });
      toast({ title: "Fixture added" });
      onOpenChange(false);
      setForm({ name: "", kind: "fridge", unit: "F", requiredMin: "", requiredMax: "" });
      setShowErrors(false);
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't add fixture", description: err.message, variant: "destructive" });
    },
  });

  const errors = {
    name: !form.name.trim() ? "Give the fixture a name (e.g., Fridge — Kitchen 1)" : undefined,
    kind: !form.kind ? "Pick a fixture kind" : undefined,
  };
  const isValid = !errors.name && !errors.kind;
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
          <DialogTitle>Add fixture</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField
            label="Name"
            required
            error={showErrors ? errors.name : undefined}
            hint={fixtureKey ? `Key: ${fixtureKey}` : undefined}
          >
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="Fridge — Kitchen 1"
              data-testid="temp-fixture-name"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Kind" required error={showErrors ? errors.kind : undefined}>
              <Select value={form.kind} onValueChange={(v) => set("kind", v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select kind" />
                </SelectTrigger>
                <SelectContent>
                  {FIXTURE_KINDS.map((k) => (
                    <SelectItem key={k} value={k} className="capitalize">
                      {k.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Unit">
              <Select value={form.unit} onValueChange={(v) => set("unit", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="F">°F</SelectItem>
                  <SelectItem value="C">°C</SelectItem>
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Required min" hint="Optional">
              <Input
                type="number"
                value={form.requiredMin}
                onChange={(e) => set("requiredMin", e.target.value)}
                placeholder="e.g., 32"
              />
            </FormField>
            <FormField label="Required max" hint="Optional">
              <Input
                type="number"
                value={form.requiredMax}
                onChange={(e) => set("requiredMax", e.target.value)}
                placeholder="e.g., 40"
              />
            </FormField>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={mutation.isPending}
              data-testid="temp-fixture-save"
            >
              {mutation.isPending ? "Saving…" : "Save fixture"}
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

// ── Record Reading dialog (mobile-first) ──────────────────────────────────────

function RecordReadingDialog({
  open,
  onOpenChange,
  facilityNumber,
  fixtures,
  initialFixtureId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilityNumber: string;
  fixtures: TempFixture[];
  initialFixtureId?: number;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: session } = useSession();
  const defaultRecordedBy = session?.username ?? "";

  const nowLocal = () => {
    const d = new Date();
    d.setSeconds(0, 0);
    return new Date(d.getTime() - d.getTimezoneOffset() * 60_000)
      .toISOString()
      .slice(0, 16);
  };

  const [form, setForm] = useState(() => ({
    fixtureId: initialFixtureId ? String(initialFixtureId) : "",
    readingValue: "",
    readingAt: nowLocal(),
    recordedBy: defaultRecordedBy,
    note: "",
  }));
  const [showErrors, setShowErrors] = useState(false);
  const [pendingOor, setPendingOor] = useState<{ value: number; min: number | null; max: number | null; unit: string } | null>(null);
  const evidenceRef = useRef<AttachEvidenceHandle | null>(null);

  const set = (k: keyof typeof form, v: string) =>
    setForm((f) => ({ ...f, [k]: v }));

  // Seed initial fixture / recordedBy when the dialog opens.
  useEffect(() => {
    if (!open) return;
    setForm((f) => ({
      ...f,
      fixtureId: initialFixtureId ? String(initialFixtureId) : f.fixtureId,
      recordedBy: f.recordedBy || defaultRecordedBy,
    }));
  }, [open, initialFixtureId, defaultRecordedBy]);

  const fixture = fixtures.find((f) => String(f.id) === form.fixtureId);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/temp-logs`, {
        fixtureId: Number(form.fixtureId),
        readingValue: Number(form.readingValue),
        readingAt: new Date(form.readingAt).getTime(),
        recordedBy: form.recordedBy.trim() || defaultRecordedBy,
        note: form.note.trim() || undefined,
      });
      const json = (await res.json()) as { success: boolean; data: TempLog };
      // Flush pre-save evidence (optional kitchen photo) per Phase 3 §4.2.
      if (json?.data?.id && evidenceRef.current?.pendingCount) {
        try {
          await evidenceRef.current.flushAttach(json.data.id);
        } catch {
          // The AttachEvidence component surfaces its own retry UI; we don't
          // need to fail the parent save.
        }
      }
      return json;
    },
    onSuccess: (json) => {
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/temp-logs`],
      });
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/temp-fixtures`],
      });
      if (json?.data?.outOfRange) {
        toast({
          title: "Reading saved — out of range",
          description: "Follow-up obligation created with a 24h due date.",
          variant: "destructive",
        });
      } else {
        toast({ title: "Reading saved" });
      }
      onOpenChange(false);
      setPendingOor(null);
      setForm({
        fixtureId: "",
        readingValue: "",
        readingAt: nowLocal(),
        recordedBy: defaultRecordedBy,
        note: "",
      });
      setShowErrors(false);
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't save reading", description: err.message, variant: "destructive" });
    },
  });

  const errors = {
    fixtureId: !form.fixtureId ? "Select a fixture" : undefined,
    readingValue:
      form.readingValue === "" || Number.isNaN(Number(form.readingValue))
        ? "Enter the temperature value"
        : undefined,
    readingAt: !form.readingAt ? "When was it taken?" : undefined,
  };
  const isValid = !errors.fixtureId && !errors.readingValue && !errors.readingAt;

  const submit = () => {
    if (!isValid || mutation.isPending) {
      setShowErrors(true);
      return;
    }
    // OOR pre-check from F1 thresholds — surface §4.2 confirmation modal
    // before we POST so the user is briefed on the follow-up obligation.
    if (fixture) {
      const value = Number(form.readingValue);
      if (isOutOfRange(value, fixture.requiredMin, fixture.requiredMax)) {
        setPendingOor({
          value,
          min: fixture.requiredMin,
          max: fixture.requiredMax,
          unit: fixture.unit,
        });
        return;
      }
    }
    mutation.mutate();
  };

  const confirmOor = () => {
    setPendingOor(null);
    mutation.mutate();
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Record reading</DialogTitle>
          </DialogHeader>
          <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
            <FormField
              label="Fixture"
              required
              error={showErrors ? errors.fixtureId : undefined}
            >
              <Select
                value={form.fixtureId}
                onValueChange={(v) => set("fixtureId", v)}
              >
                <SelectTrigger data-testid="temp-record-fixture">
                  <SelectValue placeholder="Select fixture" />
                </SelectTrigger>
                <SelectContent>
                  {fixtures.map((f) => (
                    <SelectItem key={f.id} value={String(f.id)}>
                      {f.fixtureLabel}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField
              label={`Reading${fixture ? ` (°${fixture.unit})` : ""}`}
              required
              error={showErrors ? errors.readingValue : undefined}
            >
              <Input
                type="number"
                inputMode="decimal"
                value={form.readingValue}
                onChange={(e) => set("readingValue", e.target.value)}
                placeholder="e.g., 38"
                data-testid="temp-record-value"
              />
            </FormField>
            <FormField
              label="When"
              required
              error={showErrors ? errors.readingAt : undefined}
            >
              <Input
                type="datetime-local"
                value={form.readingAt}
                onChange={(e) => set("readingAt", e.target.value)}
              />
            </FormField>
            <FormField
              label="Recorded by"
              hint="Free-text. Defaults to your account; editable for now."
            >
              <Input
                value={form.recordedBy}
                onChange={(e) => set("recordedBy", e.target.value)}
                placeholder="Staff name"
                data-testid="temp-record-recorded-by"
              />
            </FormField>
            <FormField label="Note">
              <Textarea
                value={form.note}
                onChange={(e) => set("note", e.target.value)}
                placeholder="Optional observation"
                className="resize-none min-h-[48px]"
              />
            </FormField>
            <FormField label="Evidence">
              <AttachEvidence
                ref={evidenceRef}
                entityType="ops_temperature_log"
                entityId={undefined}
                facilityNumber={facilityNumber}
                triggerLabel="Add photo (optional)"
              />
            </FormField>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={mutation.isPending}
                data-testid="temp-record-save"
              >
                {mutation.isPending ? "Saving…" : "Save"}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground -mt-1 text-right">
              <kbd className="px-1 rounded border bg-gray-50">Enter</kbd> to save
            </p>
          </div>
        </DialogContent>
      </Dialog>

      {/* Out-of-range confirmation modal per Phase 3 §4.2 */}
      <Dialog open={!!pendingOor} onOpenChange={(o) => !o && setPendingOor(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Out of range</DialogTitle>
          </DialogHeader>
          {pendingOor && (
            <div className="space-y-3 text-sm">
              <p>
                This reading (<span className="font-semibold">{pendingOor.value} °{pendingOor.unit}</span>)
                {pendingOor.min !== null && pendingOor.value < pendingOor.min
                  ? ` is below the threshold (≥ ${pendingOor.min} °${pendingOor.unit}).`
                  : pendingOor.max !== null && pendingOor.value > pendingOor.max
                    ? ` exceeds the threshold (≤ ${pendingOor.max} °${pendingOor.unit}).`
                    : ` is out of range.`}
              </p>
              <p className="text-muted-foreground">
                A follow-up obligation will be created with a due date of tomorrow.
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setPendingOor(null)}>
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={confirmOor}
                  disabled={mutation.isPending}
                  data-testid="temp-record-confirm-oor"
                >
                  Save anyway & create follow-up
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

// ── Resolve dialog ───────────────────────────────────────────────────────────

function ResolveLogDialog({
  open,
  onOpenChange,
  facilityNumber,
  log,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilityNumber: string;
  log: TempLog | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!log) throw new Error("No log selected");
      const res = await apiRequest("POST", `/api/ops/temp-logs/${log.id}/resolve`, {
        note: note.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/temp-logs`],
      });
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/temp-fixtures`],
      });
      toast({ title: "Marked resolved" });
      onOpenChange(false);
      setNote("");
      setShowErrors(false);
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't resolve", description: err.message, variant: "destructive" });
    },
  });

  const error = note.trim().length === 0 ? "Add a closing note explaining the fix" : undefined;
  const submit = () => {
    if (error || mutation.isPending) {
      setShowErrors(true);
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Resolve out-of-range reading</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField label="Closing note" required error={showErrors ? error : undefined}>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="What action was taken?"
              className="resize-none min-h-[72px]"
              data-testid="temp-resolve-note"
            />
          </FormField>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={mutation.isPending} data-testid="temp-resolve-save">
              {mutation.isPending ? "Saving…" : "Save & resolve"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function TemperatureLogsContent({ facilityNumber }: { facilityNumber: string }) {
  const [recordOpen, setRecordOpen] = useState(false);
  const [addFixtureOpen, setAddFixtureOpen] = useState(false);
  const [resolveTarget, setResolveTarget] = useState<TempLog | null>(null);
  const [initialFixtureId, setInitialFixtureId] = useState<number | undefined>();

  const fixturesQuery = useQuery<{ success: boolean; data: TempFixture[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/temp-fixtures`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const logsQuery = useQuery<{ success: boolean; data: TempLog[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/temp-logs`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const fixtures = fixturesQuery.data?.data ?? [];
  const logs = logsQuery.data?.data ?? [];

  // Index latest log per fixture
  const latestByFixture = useMemo(() => {
    const m = new Map<number, TempLog>();
    for (const log of logs) {
      const prev = m.get(log.fixtureId);
      if (!prev || log.readingAt > prev.readingAt) m.set(log.fixtureId, log);
    }
    return m;
  }, [logs]);

  // Unresolved out-of-range logs
  const unresolvedOor = useMemo(
    () => logs.filter((l) => l.outOfRange && !l.resolvedAt),
    [logs],
  );

  // Today readings count
  const todaysLogs = useMemo(() => logs.filter((l) => isToday(l.readingAt)), [logs]);
  const fixturesWithReadingToday = new Set(todaysLogs.map((l) => l.fixtureId)).size;

  // Latest reading across all fixtures (for "Last reading" tile)
  const latestLog = useMemo(() => {
    if (logs.length === 0) return null;
    return logs.reduce((acc, l) => (l.readingAt > acc.readingAt ? l : acc), logs[0]);
  }, [logs]);
  const latestFixture = latestLog ? fixtures.find((f) => f.id === latestLog.fixtureId) : null;

  // After 14:00 local, fixtures with no reading today get a "Missing today" amber chip.
  const now = new Date();
  const isAfter14Local = now.getHours() >= 14;

  const error = fixturesQuery.error || logsQuery.error;
  const isLoading = fixturesQuery.isLoading || logsQuery.isLoading;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold" style={{ color: "#1E1B4B" }}>
          Temperature Logs
        </h1>
        <Button
          size="sm"
          variant="gradient"
          onClick={() => {
            setInitialFixtureId(undefined);
            setRecordOpen(true);
          }}
          disabled={fixtures.length === 0}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Record reading
        </Button>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-3 gap-3">
        <div
          className="rounded-lg p-3 text-center"
          style={{ background: "#F0F4FF", border: "1px solid #E0E7FF" }}
        >
          <p className="text-xl font-bold portal-num">
            {fixturesWithReadingToday}
            <span className="text-muted-foreground"> / {fixtures.length}</span>
          </p>
          <p className="text-xs text-muted-foreground">Fixtures logged today</p>
        </div>
        <div
          className={cn(
            "rounded-lg p-3 text-center border",
            unresolvedOor.length > 0
              ? "bg-red-50 border-red-200"
              : "bg-emerald-50 border-emerald-200",
          )}
        >
          <p
            className={cn(
              "text-xl font-bold portal-num",
              unresolvedOor.length > 0 ? "text-red-700" : "text-emerald-700",
            )}
          >
            {unresolvedOor.length}
          </p>
          <p
            className={cn(
              "text-xs",
              unresolvedOor.length > 0 ? "text-red-600" : "text-emerald-600",
            )}
          >
            Out of range
          </p>
        </div>
        <div className="rounded-lg p-3 text-center border bg-stone-50 border-stone-200">
          {latestLog && latestFixture ? (
            <>
              <p className="text-sm font-semibold truncate">{latestFixture.fixtureLabel}</p>
              <p className="text-xs text-muted-foreground">
                {fmtRelative(latestLog.readingAt)}
              </p>
            </>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">—</p>
              <p className="text-xs text-muted-foreground">No readings yet</p>
            </>
          )}
        </div>
      </div>

      {error && (
        <div
          className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive"
          role="alert"
        >
          Failed to load temperature logs.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : fixtures.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center" data-testid="temp-empty">
          <Thermometer className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            Add the first fixture you log daily — typically Fridge, Freezer, and Hot Water.
          </p>
          <Button size="sm" variant="gradient" onClick={() => setAddFixtureOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add fixture
          </Button>
        </div>
      ) : (
        <>
          <h2 className="text-sm font-medium text-muted-foreground">Fixtures</h2>
          <ul className="space-y-2" data-testid="temp-fixture-list">
            {fixtures.map((fixture) => {
              const latest = latestByFixture.get(fixture.id);
              const hasReadingToday = latest ? isToday(latest.readingAt) : false;
              const missingToday = !hasReadingToday && isAfter14Local;
              const oor = latest ? Boolean(latest.outOfRange) && !latest.resolvedAt : false;

              return (
                <li
                  key={fixture.id}
                  className={cn(
                    "rounded-lg border p-4",
                    oor ? "border-red-200 bg-red-50" : "border-stone-200 bg-white",
                  )}
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0">
                      <p className="font-medium text-sm">{fixture.fixtureLabel}</p>
                      {latest ? (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Last:{" "}
                          <span className="font-semibold portal-num">
                            {latest.readingValue} °{latest.unit}
                          </span>{" "}
                          · {fmtTime(latest.readingAt)}
                          {fixture.requiredMin !== null || fixture.requiredMax !== null ? (
                            <>
                              {" "}· Threshold:{" "}
                              {fixture.requiredMin !== null && fixture.requiredMax !== null
                                ? `${fixture.requiredMin}–${fixture.requiredMax}`
                                : fixture.requiredMin !== null
                                  ? `≥ ${fixture.requiredMin}`
                                  : `≤ ${fixture.requiredMax}`}{" "}
                              °{fixture.unit}
                            </>
                          ) : null}
                        </p>
                      ) : (
                        <p className="text-xs text-muted-foreground mt-0.5">
                          No readings yet
                        </p>
                      )}
                      {oor && latest?.followUpDueAt && (
                        <p className="text-xs text-red-700 mt-1">
                          Follow-up obligation created · due{" "}
                          {new Date(latest.followUpDueAt).toLocaleDateString()}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {oor ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-red-100 text-red-700 border border-red-200 capitalize">
                          <AlertTriangle className="h-3 w-3" />
                          Out of range
                        </span>
                      ) : latest ? (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-emerald-100 text-emerald-700 border border-emerald-200 capitalize">
                          <CheckCircle2 className="h-3 w-3" />
                          In range
                        </span>
                      ) : null}
                      {missingToday && (
                        <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-700 border border-amber-200 capitalize">
                          <Clock className="h-3 w-3" />
                          Missing today
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setInitialFixtureId(fixture.id);
                          setRecordOpen(true);
                        }}
                        data-testid={`temp-record-trigger-${fixture.id}`}
                      >
                        Record
                      </Button>
                      {oor && latest && (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={() => setResolveTarget(latest)}
                          data-testid={`temp-resolve-${latest.id}`}
                        >
                          Resolve
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
          <div className="pt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setAddFixtureOpen(true)}
              data-testid="temp-add-fixture"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Add fixture
            </Button>
          </div>
        </>
      )}

      <RecordReadingDialog
        open={recordOpen}
        onOpenChange={setRecordOpen}
        facilityNumber={facilityNumber}
        fixtures={fixtures}
        initialFixtureId={initialFixtureId}
      />
      <AddFixtureDialog
        open={addFixtureOpen}
        onOpenChange={setAddFixtureOpen}
        facilityNumber={facilityNumber}
      />
      <ResolveLogDialog
        open={!!resolveTarget}
        onOpenChange={(o) => !o && setResolveTarget(null)}
        facilityNumber={facilityNumber}
        log={resolveTarget}
      />

    </div>
  );
}
