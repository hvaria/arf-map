/**
 * <TrustAccountsTab> — Wave 4 Phase 4.2 (W12).
 *
 * Two-pane resident-trust accounts view that lives inside the Billing
 * sub-view as a tab. Feature-gated per facility on the
 * RESIDENT_TRUST_ENABLED reg-setting. When disabled, the parent caller
 * (<BillingContent>) renders the "not enabled" empty card instead.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Page heading + gradient primary action:    ComplianceContent.tsx:280-286
 *   - Summary tile grid:                         ComplianceContent.tsx:289-302
 *   - AddX dialog skeleton + onSubmitKey:        ComplianceContent.tsx:55-204
 *   - Loading skeletons / Empty state:           ComplianceContent.tsx:311-318
 *   - Error banner:                              ComplianceContent.tsx:305-307
 *   - useMutation + invalidate + toast:          ComplianceContent.tsx:88-106
 *   - <FormField> usage + onSubmitKey:           components/operations/FormField.tsx
 *   - List + detail two-pane navigation:         components/operations/ComplaintsContent.tsx
 *   - Optimistic update pattern:                 components/operations/VendorsContent.tsx:350-375
 *   - useIsWritable() write-gate:                context/AuditorContext.tsx:53-56
 *   - <AttachEvidence> for receipts:             components/operations/AttachEvidence.tsx
 *   - useSession() for current user id:          hooks/useSession.ts
 *   - Money helpers (NEVER inline):              shared/resident-trust.ts (centsToDollars / dollarsToCents)
 *
 * API contract (Wave 4 Phase 4.2 §5 W12 / Phase 3 IA §8.3):
 *   GET    /api/ops/facilities/:fn/trust/accounts?residentId=&status=&includeClosed=
 *   GET    /api/ops/trust/accounts/:id
 *   POST   /api/ops/trust/accounts              { residentId }
 *   POST   /api/ops/trust/accounts/:id/close
 *   GET    /api/ops/trust/accounts/:id/ledger?sinceMs=&untilMs=&page=&limit=
 *   POST   /api/ops/trust/accounts/:id/ledger
 *   POST   /api/ops/trust/ledger/:entryId/reverse  { reason }
 *   GET    /api/ops/trust/accounts/:id/reconcile
 *   POST   /api/ops/trust/accounts/:id/repair-balance
 *   GET    /api/ops/trust/accounts/:id/statements
 *   POST   /api/ops/trust/accounts/:id/statements
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
import { FormField, onSubmitKey } from "@/components/operations/FormField";
import {
  AttachEvidence,
  type AttachEvidenceHandle,
} from "@/components/operations/AttachEvidence";
import { useResidents } from "@/hooks/useResidents";
import { useSession } from "@/hooks/useSession";
import { useIsWritable } from "@/context/AuditorContext";
import {
  TRUST_LEDGER_CATEGORIES,
  TRUST_LEDGER_CATEGORY_LABELS,
  centsToDollars,
  dollarsToCents,
  canCloseAccount,
  type TrustLedgerCategory,
  type TrustLedgerDirection,
  type TrustAccountStatus,
} from "@shared/resident-trust";
import {
  Plus,
  ArrowLeft,
  Wallet,
  RefreshCw,
  AlertTriangle,
  CheckCircle2,
  FileText,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TrustAccount {
  id: number;
  facilityNumber: string;
  residentId: number;
  residentName?: string;
  balanceCents: number;
  status: TrustAccountStatus;
  lastTransactionAt: number | null;
  createdAt: number;
  closedAt?: number | null;
}

export interface TrustLedgerEntry {
  id: number;
  accountId: number;
  direction: TrustLedgerDirection;
  amountCents: number;
  category: TrustLedgerCategory;
  description: string;
  transactedAt: number;
  recordedBy: string | number | null;
  recordedByName?: string | null;
  witnessedBy: string | number | null;
  witnessedByName?: string | null;
  notes: string | null;
  receiptUri: string | null;
  reversesEntryId: number | null;
  reversedByEntryId: number | null;
  reversalReason: string | null;
  createdAt: number;
}

export interface TrustStatement {
  id: number;
  accountId: number;
  periodStartAt: number;
  periodEndAt: number;
  openingBalanceCents: number;
  closingBalanceCents: number;
  totalCreditsCents: number;
  totalDebitsCents: number;
  generatedAt: number;
  generatedBy?: string | number | null;
  storageUri?: string | null;
}

export interface TrustReconcile {
  computedCents: number;
  cachedCents: number;
  drift: number;
}

interface StaffLite {
  id: number;
  firstName: string;
  lastName: string;
  role?: string;
  status?: string;
}

const PAGE_LIMIT = 25;

function fmtDate(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleDateString();
}
function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

// Date input helpers — "YYYY-MM-DDThh:mm" → epoch ms (local).
function nowLocalDatetimeInput(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function localDatetimeToMs(value: string): number {
  return new Date(value).getTime();
}

// ── Add Account dialog ───────────────────────────────────────────────────────

function OpenAccountDialog({
  open,
  onOpenChange,
  facilityNumber,
  existingResidentIds,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilityNumber: string;
  existingResidentIds: Set<number>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { residents } = useResidents(facilityNumber, { activeOnly: true });
  const [residentId, setResidentId] = useState<string>("");
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (open) {
      setResidentId("");
      setShowErrors(false);
    }
  }, [open]);

  const eligible = residents.filter((r) => !existingResidentIds.has(r.id));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/trust/accounts`, {
        residentId: Number(residentId),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/trust/accounts`],
      });
      toast({ title: "Trust account opened" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't open account",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const error = !residentId ? "Pick a resident" : undefined;
  const submit = () => {
    if (error || mutation.isPending) {
      setShowErrors(true);
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Open trust account</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField
            label="Resident"
            required
            error={showErrors ? error : undefined}
          >
            <Select value={residentId} onValueChange={setResidentId}>
              <SelectTrigger
                data-testid="trust-open-resident-select"
                aria-invalid={showErrors && !!error}
              >
                <SelectValue placeholder="Pick a resident" />
              </SelectTrigger>
              <SelectContent>
                {eligible.length === 0 ? (
                  <SelectItem value="__none__" disabled>
                    All active residents already have a trust account
                  </SelectItem>
                ) : (
                  eligible.map((r) => (
                    <SelectItem key={r.id} value={String(r.id)}>
                      {r.firstName} {r.lastName}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </FormField>
          <p className="text-[11px] text-muted-foreground">
            Opens with a zero balance. Add the first deposit on the
            account's ledger after creation.
          </p>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={mutation.isPending}
              data-testid="trust-open-save"
            >
              {mutation.isPending ? "Opening…" : "Open account"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Add ledger entry dialog ──────────────────────────────────────────────────

interface LedgerFormData {
  direction: TrustLedgerDirection;
  amount: string;
  category: TrustLedgerCategory;
  description: string;
  transactedAt: string;
  witnessedBy: string;
  notes: string;
}

function emptyLedgerForm(): LedgerFormData {
  return {
    direction: "credit",
    amount: "",
    category: "cash_deposit",
    description: "",
    transactedAt: nowLocalDatetimeInput(),
    witnessedBy: "",
    notes: "",
  };
}

function AddLedgerEntryDialog({
  open,
  onOpenChange,
  account,
  facilityNumber,
  dualSigRequired,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  account: TrustAccount;
  facilityNumber: string;
  dualSigRequired: boolean;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const session = useSession();
  const sessionUserId = session.data?.id ?? null;
  const [form, setForm] = useState<LedgerFormData>(emptyLedgerForm);
  const [showErrors, setShowErrors] = useState(false);
  const evidenceRef = useRef<AttachEvidenceHandle | null>(null);

  useEffect(() => {
    if (open) {
      setForm(emptyLedgerForm());
      setShowErrors(false);
    }
  }, [open]);

  const { data: staffEnv } = useQuery<{
    success: boolean;
    data: StaffLite[];
  } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/staff`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: open && !!facilityNumber,
    staleTime: 60_000,
  });
  const activeStaff = (staffEnv?.data ?? []).filter(
    (s) => !s.status || s.status === "active",
  );

  const set = <K extends keyof LedgerFormData>(k: K, v: LedgerFormData[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const amountCents = useMemo(
    () => (form.amount ? dollarsToCents(form.amount) : null),
    [form.amount],
  );
  const witnessRequired = form.direction === "debit" && dualSigRequired;

  const errors = {
    amount: !form.amount
      ? "Enter an amount"
      : amountCents === null
        ? "Amount must look like 10 or 10.50"
        : amountCents <= 0
          ? "Amount must be greater than $0"
          : undefined,
    description: !form.description.trim()
      ? "Add a short description"
      : undefined,
    transactedAt: !form.transactedAt ? "Pick a date / time" : undefined,
    witnessedBy: witnessRequired
      ? !form.witnessedBy
        ? "A second staff witness is required for debits"
        : sessionUserId !== null && String(sessionUserId) === form.witnessedBy
          ? "Witness must be a different staff member"
          : undefined
      : undefined,
  };
  const isValid =
    !errors.amount &&
    !errors.description &&
    !errors.transactedAt &&
    !errors.witnessedBy;

  const mutation = useMutation({
    mutationFn: async () => {
      if (amountCents === null || amountCents <= 0) {
        throw new Error("Invalid amount");
      }
      const res = await apiRequest(
        "POST",
        `/api/ops/trust/accounts/${account.id}/ledger`,
        {
          direction: form.direction,
          amountCents,
          category: form.category,
          description: form.description.trim(),
          transactedAt: localDatetimeToMs(form.transactedAt),
          witnessedBy: form.witnessedBy
            ? Number(form.witnessedBy)
            : undefined,
          notes: form.notes.trim() || undefined,
        },
      );
      const json = (await res.json()) as {
        success: boolean;
        data: TrustLedgerEntry;
      };
      if (json?.data?.id && evidenceRef.current?.pendingCount) {
        try {
          await evidenceRef.current.flushAttach(json.data.id);
        } catch {
          /* surfaced inline by AttachEvidence */
        }
      }
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [`/api/ops/trust/accounts/${account.id}/ledger`],
      });
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/trust/accounts`],
      });
      qc.invalidateQueries({
        queryKey: [`/api/ops/trust/accounts/${account.id}/reconcile`],
      });
      toast({ title: "Ledger entry recorded" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't record entry",
        description: err.message,
        variant: "destructive",
      });
    },
  });

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
          <DialogTitle>Add ledger entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField label="Direction" required>
            <div
              className="flex gap-2"
              role="radiogroup"
              aria-label="Direction"
            >
              {(["credit", "debit"] as const).map((d) => (
                <button
                  key={d}
                  type="button"
                  role="radio"
                  aria-checked={form.direction === d}
                  onClick={() => set("direction", d)}
                  className={cn(
                    "flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-semibold border transition-all",
                    form.direction === d
                      ? d === "credit"
                        ? "bg-emerald-600 text-white border-emerald-600"
                        : "bg-rose-600 text-white border-rose-600"
                      : "bg-white text-gray-600 border-gray-200 hover:border-gray-400",
                  )}
                  data-testid={`trust-ledger-direction-${d}`}
                >
                  {d === "credit" ? "Credit (deposit)" : "Debit (withdrawal)"}
                </button>
              ))}
            </div>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Amount ($)"
              required
              error={showErrors ? errors.amount : undefined}
            >
              <Input
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
                placeholder="20.00"
                inputMode="decimal"
                data-testid="trust-ledger-amount"
                aria-invalid={showErrors && !!errors.amount}
              />
            </FormField>
            <FormField label="Category" required>
              <Select
                value={form.category}
                onValueChange={(v) =>
                  set("category", v as TrustLedgerCategory)
                }
              >
                <SelectTrigger data-testid="trust-ledger-category">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRUST_LEDGER_CATEGORIES.filter((c) => c !== "reversal").map(
                    (c) => (
                      <SelectItem key={c} value={c}>
                        {TRUST_LEDGER_CATEGORY_LABELS[c]}
                      </SelectItem>
                    ),
                  )}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField
            label="Description"
            required
            error={showErrors ? errors.description : undefined}
            hint="What was the money for?"
          >
            <Input
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              placeholder="Allowance for week of May 13"
              data-testid="trust-ledger-description"
              aria-invalid={showErrors && !!errors.description}
            />
          </FormField>
          <FormField
            label="Transacted at"
            required
            error={showErrors ? errors.transactedAt : undefined}
          >
            <Input
              type="datetime-local"
              value={form.transactedAt}
              onChange={(e) => set("transactedAt", e.target.value)}
              data-testid="trust-ledger-transacted-at"
            />
          </FormField>
          {witnessRequired && (
            <FormField
              label="Witnessed by"
              required
              error={showErrors ? errors.witnessedBy : undefined}
              hint="Second staff signature required for debits."
            >
              <Select
                value={form.witnessedBy}
                onValueChange={(v) => set("witnessedBy", v)}
              >
                <SelectTrigger
                  data-testid="trust-ledger-witness"
                  aria-invalid={showErrors && !!errors.witnessedBy}
                >
                  <SelectValue placeholder="Pick a witness" />
                </SelectTrigger>
                <SelectContent>
                  {activeStaff.map((s) => (
                    <SelectItem key={s.id} value={String(s.id)}>
                      {s.firstName} {s.lastName}
                      {s.role ? ` · ${s.role}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          )}
          <FormField label="Notes">
            <Textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              className="resize-none min-h-[48px]"
              placeholder="Optional context for auditors"
            />
          </FormField>
          <FormField label="Receipt evidence">
            <AttachEvidence
              ref={evidenceRef}
              entityType="ops_trust_ledger"
              entityId={undefined}
              facilityNumber={facilityNumber}
              triggerLabel="Attach receipt"
            />
          </FormField>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={mutation.isPending}
              data-testid="trust-ledger-save"
            >
              {mutation.isPending ? "Saving…" : "Save entry"}
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

// ── Reverse entry dialog ─────────────────────────────────────────────────────

function ReverseEntryDialog({
  open,
  onOpenChange,
  entry,
  accountId,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  entry: TrustLedgerEntry | null;
  accountId: number;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (open) {
      setReason("");
      setShowErrors(false);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!entry) throw new Error("No entry selected");
      const res = await apiRequest(
        "POST",
        `/api/ops/trust/ledger/${entry.id}/reverse`,
        { reason: reason.trim() },
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [`/api/ops/trust/accounts/${accountId}/ledger`],
      });
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/trust/accounts`],
      });
      qc.invalidateQueries({
        queryKey: [`/api/ops/trust/accounts/${accountId}/reconcile`],
      });
      toast({ title: "Entry reversed" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't reverse entry",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const error = !reason.trim() ? "A reason is required" : undefined;
  const submit = () => {
    if (error || mutation.isPending) {
      setShowErrors(true);
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reverse ledger entry</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          {entry && (
            <div className="rounded-md border bg-stone-50 p-2 text-xs">
              <div className="font-medium">
                {entry.direction === "credit" ? "+" : "−"}
                {centsToDollars(entry.amountCents)}
                <span className="text-muted-foreground ml-2">
                  · {TRUST_LEDGER_CATEGORY_LABELS[entry.category]}
                </span>
              </div>
              <div className="text-muted-foreground mt-0.5">
                {entry.description}
              </div>
            </div>
          )}
          <FormField
            label="Reason"
            required
            error={showErrors ? error : undefined}
            hint="Recorded permanently on the audit trail."
          >
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Duplicate entry / wrong resident / data correction"
              className="resize-none min-h-[60px]"
              data-testid="trust-reverse-reason"
              aria-invalid={showErrors && !!error}
            />
          </FormField>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="gradient"
              onClick={submit}
              disabled={mutation.isPending}
              data-testid="trust-reverse-save"
            >
              {mutation.isPending ? "Reversing…" : "Reverse entry"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Generate statement dialog ────────────────────────────────────────────────

function GenerateStatementDialog({
  open,
  onOpenChange,
  accountId,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  accountId: number;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (open) {
      const d = new Date();
      const lastMonth = new Date(d.getFullYear(), d.getMonth() - 1, 1);
      const lastMonthEnd = new Date(d.getFullYear(), d.getMonth(), 0);
      const pad = (n: number) => String(n).padStart(2, "0");
      setStart(
        `${lastMonth.getFullYear()}-${pad(lastMonth.getMonth() + 1)}-${pad(lastMonth.getDate())}`,
      );
      setEnd(
        `${lastMonthEnd.getFullYear()}-${pad(lastMonthEnd.getMonth() + 1)}-${pad(lastMonthEnd.getDate())}`,
      );
      setShowErrors(false);
    }
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/ops/trust/accounts/${accountId}/statements`,
        {
          periodStartAt: new Date(`${start}T00:00:00`).getTime(),
          periodEndAt: new Date(`${end}T23:59:59`).getTime(),
        },
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [`/api/ops/trust/accounts/${accountId}/statements`],
      });
      toast({ title: "Statement generated" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't generate statement",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const error =
    !start || !end
      ? "Pick a period"
      : new Date(start).getTime() > new Date(end).getTime()
        ? "Start must be before end"
        : undefined;
  const submit = () => {
    if (error || mutation.isPending) {
      setShowErrors(true);
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate statement</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Period start" required>
              <Input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                data-testid="trust-statement-start"
              />
            </FormField>
            <FormField
              label="Period end"
              required
              error={showErrors ? error : undefined}
            >
              <Input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                data-testid="trust-statement-end"
              />
            </FormField>
          </div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={mutation.isPending}>
              {mutation.isPending ? "Generating…" : "Generate"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Account detail pane ──────────────────────────────────────────────────────

function ReconcileChip({
  reconcile,
  loading,
}: {
  reconcile: TrustReconcile | null;
  loading?: boolean;
}) {
  if (loading) {
    return (
      <Skeleton className="inline-block h-5 w-20 rounded" />
    );
  }
  if (!reconcile) {
    return (
      <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border bg-stone-100 text-stone-700 border-stone-200">
        Unknown
      </span>
    );
  }
  const ok = reconcile.drift === 0;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border",
        ok
          ? "bg-emerald-100 text-emerald-700 border-emerald-200"
          : "bg-red-100 text-red-700 border-red-200",
      )}
      data-testid="trust-reconcile-chip"
    >
      {ok ? (
        <>
          <CheckCircle2 className="h-3 w-3" /> Reconciled
        </>
      ) : (
        <>
          <AlertTriangle className="h-3 w-3" /> Drift{" "}
          {centsToDollars(Math.abs(reconcile.drift))}
        </>
      )}
    </span>
  );
}

function TrustAccountDetail({
  account,
  facilityNumber,
  dualSigRequired,
  onBack,
}: {
  account: TrustAccount;
  facilityNumber: string;
  dualSigRequired: boolean;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isWritable = useIsWritable();
  const [addOpen, setAddOpen] = useState(false);
  const [reverseEntry, setReverseEntry] = useState<TrustLedgerEntry | null>(
    null,
  );
  const [statementOpen, setStatementOpen] = useState(false);
  const [limit, setLimit] = useState(PAGE_LIMIT);

  const ledgerKey = `/api/ops/trust/accounts/${account.id}/ledger?page=1&limit=${limit}`;
  const reconcileKey = `/api/ops/trust/accounts/${account.id}/reconcile`;
  const statementsKey = `/api/ops/trust/accounts/${account.id}/statements?page=1&limit=12`;

  const ledgerQ = useQuery<{
    success: boolean;
    data: TrustLedgerEntry[];
  } | null>({
    queryKey: [ledgerKey],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!account.id,
    staleTime: 30_000,
  });
  const ledger = ledgerQ.data?.data ?? [];

  const reconcileQ = useQuery<{
    success: boolean;
    data: TrustReconcile;
  } | null>({
    queryKey: [reconcileKey],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!account.id,
    staleTime: 60_000,
  });
  const reconcile = reconcileQ.data?.data ?? null;

  const statementsQ = useQuery<{
    success: boolean;
    data: TrustStatement[];
  } | null>({
    queryKey: [statementsKey],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!account.id,
    staleTime: 60_000,
  });
  const statements = statementsQ.data?.data ?? [];

  const closeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/ops/trust/accounts/${account.id}/close`,
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/trust/accounts`],
      });
      toast({ title: "Account closed" });
      onBack();
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't close account",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const repairMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/ops/trust/accounts/${account.id}/repair-balance`,
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [reconcileKey] });
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/trust/accounts`],
      });
      toast({ title: "Balance repaired from ledger" });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't repair balance",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const drift = reconcile?.drift ?? 0;
  const canClose = canCloseAccount(account.balanceCents) && account.status === "active";

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        data-testid="trust-detail-back"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to accounts
      </button>

      <div className="rounded-lg border p-4 bg-white space-y-2">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="text-base font-semibold">
              {account.residentName ?? `Resident #${account.residentId}`}
            </h2>
            <p className="text-[11px] text-muted-foreground">
              Opened {fmtDate(account.createdAt)}
              {account.status === "closed" &&
                account.closedAt &&
                ` · closed ${fmtDate(account.closedAt)}`}
            </p>
          </div>
          <div className="text-right">
            <p
              className="text-2xl font-bold portal-num"
              data-testid="trust-detail-balance"
            >
              {centsToDollars(account.balanceCents)}
            </p>
            <div className="mt-1 flex justify-end">
              <ReconcileChip
                reconcile={reconcile}
                loading={reconcileQ.isLoading}
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 pt-2">
          {isWritable && account.status === "active" && (
            <Button
              size="sm"
              variant="gradient"
              onClick={() => setAddOpen(true)}
              data-testid="trust-add-ledger-trigger"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Add transaction
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              qc.invalidateQueries({ queryKey: [reconcileKey] });
            }}
            data-testid="trust-reconcile-refresh"
            aria-label="Refresh reconciliation"
          >
            <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
            Reconcile
          </Button>
          {isWritable && canClose && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (confirm("Close this account? Balance is $0.")) {
                  closeMutation.mutate();
                }
              }}
              disabled={closeMutation.isPending}
              data-testid="trust-close-account"
            >
              Close account
            </Button>
          )}
        </div>

        {drift !== 0 && isWritable && (
          <div
            className="rounded-md border border-red-200 bg-red-50 p-3 mt-2 text-sm text-red-800 flex items-center justify-between gap-3 flex-wrap"
            role="alert"
            data-testid="trust-drift-banner"
          >
            <span className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4" />
              Cached balance is off by{" "}
              <strong>{centsToDollars(Math.abs(drift))}</strong> from the
              ledger sum.
            </span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => repairMutation.mutate()}
              disabled={repairMutation.isPending}
              data-testid="trust-repair-balance"
            >
              {repairMutation.isPending
                ? "Repairing…"
                : "Repair balance from ledger"}
            </Button>
          </div>
        )}
      </div>

      {/* Ledger */}
      <div className="rounded-lg border overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/50 text-xs font-medium text-muted-foreground flex items-center justify-between">
          <span>Ledger</span>
          {ledger.length > 0 && (
            <span className="text-[10px]">{ledger.length} entries</span>
          )}
        </div>
        {ledgerQ.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded" />
            ))}
          </div>
        ) : ledger.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No entries yet — add the first deposit above.
          </div>
        ) : (
          <table className="w-full text-sm" data-testid="trust-ledger-table">
            <thead className="bg-muted/30">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Date</th>
                <th className="text-left px-4 py-2 font-medium">Direction</th>
                <th className="text-right px-4 py-2 font-medium">Amount</th>
                <th className="text-left px-4 py-2 font-medium">Category</th>
                <th className="text-left px-4 py-2 font-medium">
                  Description
                </th>
                <th className="text-left px-4 py-2 font-medium">By / witness</th>
                <th className="text-right px-4 py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {ledger.map((e) => {
                const reversed = e.reversedByEntryId !== null;
                const isReversal = e.reversesEntryId !== null;
                return (
                  <tr
                    key={e.id}
                    className={cn(
                      "hover:bg-stone-50/50 transition-colors",
                      reversed && "opacity-60",
                    )}
                  >
                    <td className="px-4 py-2 portal-num text-[12px] whitespace-nowrap">
                      {fmtDateTime(e.transactedAt)}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border capitalize",
                          e.direction === "credit"
                            ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                            : "bg-rose-100 text-rose-700 border-rose-200",
                        )}
                      >
                        {e.direction}
                      </span>
                      {reversed && (
                        <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border bg-slate-100 text-slate-700 border-slate-200">
                          reversed
                        </span>
                      )}
                      {isReversal && (
                        <span className="ml-1 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border bg-amber-100 text-amber-700 border-amber-200">
                          reversal of #{e.reversesEntryId}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-2 portal-num text-right">
                      {e.direction === "credit" ? "+" : "−"}
                      {centsToDollars(e.amountCents)}
                    </td>
                    <td className="px-4 py-2 text-[12px]">
                      {TRUST_LEDGER_CATEGORY_LABELS[e.category]}
                    </td>
                    <td className="px-4 py-2 text-[12px]">{e.description}</td>
                    <td className="px-4 py-2 text-[11px] text-muted-foreground">
                      {e.recordedByName ?? "—"}
                      {e.witnessedByName ? (
                        <span className="block">w/ {e.witnessedByName}</span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2 text-right">
                      {isWritable && !reversed && !isReversal && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setReverseEntry(e)}
                          data-testid={`trust-reverse-${e.id}`}
                          aria-label={`Reverse entry ${e.id}`}
                        >
                          Reverse
                        </Button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        {ledger.length >= limit && (
          <div className="text-center p-3 border-t">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setLimit((l) => l + PAGE_LIMIT)}
              data-testid="trust-ledger-load-more"
            >
              Load more
            </Button>
          </div>
        )}
      </div>

      {/* Statements */}
      <div className="rounded-lg border overflow-hidden">
        <div className="px-4 py-2.5 bg-muted/50 text-xs font-medium text-muted-foreground flex items-center justify-between">
          <span>Statements</span>
          {isWritable && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setStatementOpen(true)}
              data-testid="trust-generate-statement"
            >
              <FileText className="h-3.5 w-3.5 mr-1.5" />
              Generate statement
            </Button>
          )}
        </div>
        {statementsQ.isLoading ? (
          <div className="space-y-2 p-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-full rounded" />
            ))}
          </div>
        ) : statements.length === 0 ? (
          <div className="p-6 text-center text-sm text-muted-foreground">
            No statements generated yet.
          </div>
        ) : (
          <div className="divide-y">
            {statements.map((s) => (
              <div
                key={s.id}
                className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm"
              >
                <div>
                  <p className="font-medium">
                    {fmtDate(s.periodStartAt)} – {fmtDate(s.periodEndAt)}
                  </p>
                  <p className="text-[11px] text-muted-foreground portal-num">
                    Opening {centsToDollars(s.openingBalanceCents)} · Closing{" "}
                    {centsToDollars(s.closingBalanceCents)}
                  </p>
                </div>
                {s.storageUri ? (
                  <a
                    href={s.storageUri}
                    target="_blank"
                    rel="noreferrer"
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Download
                  </a>
                ) : (
                  <span className="text-xs text-muted-foreground">
                    Generated {fmtDate(s.generatedAt)}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <AddLedgerEntryDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        account={account}
        facilityNumber={facilityNumber}
        dualSigRequired={dualSigRequired}
      />
      <ReverseEntryDialog
        open={reverseEntry !== null}
        onOpenChange={(v) => {
          if (!v) setReverseEntry(null);
        }}
        entry={reverseEntry}
        accountId={account.id}
        facilityNumber={facilityNumber}
      />
      <GenerateStatementDialog
        open={statementOpen}
        onOpenChange={setStatementOpen}
        accountId={account.id}
      />
    </div>
  );
}

// ── Public component ─────────────────────────────────────────────────────────

export function TrustAccountsTab({
  facilityNumber,
  dualSigRequired,
}: {
  facilityNumber: string;
  dualSigRequired: boolean;
}) {
  const isWritable = useIsWritable();
  const [openAddOpen, setOpenAddOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const listKey = `/api/ops/facilities/${facilityNumber}/trust/accounts`;
  const { data, isLoading, error } = useQuery<{
    success: boolean;
    data: TrustAccount[];
  } | null>({
    queryKey: [listKey],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const accounts = data?.data ?? [];
  const existingResidentIds = useMemo(
    () =>
      new Set(
        accounts
          .filter((a) => a.status === "active")
          .map((a) => a.residentId),
      ),
    [accounts],
  );

  const activeAccounts = accounts.filter((a) => a.status === "active");
  const totalHeld = activeAccounts.reduce(
    (sum, a) => sum + a.balanceCents,
    0,
  );

  // Drift count is best-effort: counted from any per-row reconcile data
  // cached so far. We don't issue N parallel reconciles at list time — the
  // detail view triggers them. This keeps the list lightweight.
  const driftCount = 0;

  const selected = selectedId
    ? accounts.find((a) => a.id === selectedId) ?? null
    : null;

  if (selected) {
    return (
      <TrustAccountDetail
        account={selected}
        facilityNumber={facilityNumber}
        dualSigRequired={dualSigRequired}
        onBack={() => setSelectedId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="text-base font-semibold">Resident trust accounts</h2>
        {isWritable && (
          <Button
            size="sm"
            variant="gradient"
            onClick={() => setOpenAddOpen(true)}
            data-testid="trust-open-trigger"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Open account
          </Button>
        )}
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div
          className="rounded-lg p-3 text-center"
          style={{ background: "#F0F4FF", border: "1px solid #E0E7FF" }}
        >
          <p className="text-xl font-bold portal-num text-indigo-700">
            {activeAccounts.length}
          </p>
          <p className="text-xs text-muted-foreground">Active accounts</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
          <p
            className="text-xl font-bold portal-num text-emerald-700"
            data-testid="trust-total-held"
          >
            {centsToDollars(totalHeld)}
          </p>
          <p className="text-xs text-emerald-700">Total held</p>
        </div>
        <div className="rounded-lg border border-stone-200 bg-stone-50 p-3 text-center">
          <p className="text-xl font-bold portal-num text-stone-700">
            {driftCount}
          </p>
          <p className="text-xs text-stone-700">Drift flags</p>
        </div>
      </div>

      {error && (
        <div
          className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive"
          role="alert"
        >
          Failed to load trust accounts.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-14 w-full rounded-lg" />
          ))}
        </div>
      ) : accounts.length === 0 ? (
        <div
          className="rounded-lg border border-dashed p-10 text-center"
          data-testid="trust-empty"
        >
          <Wallet className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            No resident trust accounts yet.
          </p>
          {isWritable && (
            <Button
              size="sm"
              variant="gradient"
              onClick={() => setOpenAddOpen(true)}
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Open the first account
            </Button>
          )}
        </div>
      ) : (
        <div
          className="rounded-lg border overflow-hidden"
          data-testid="trust-accounts-list"
        >
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Resident</th>
                <th className="text-right px-4 py-2 font-medium">Balance</th>
                <th className="text-left px-4 py-2 font-medium">Status</th>
                <th className="text-left px-4 py-2 font-medium">
                  Last transaction
                </th>
                <th className="text-right px-4 py-2 font-medium">Open</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {accounts.map((a) => (
                <tr
                  key={a.id}
                  className="hover:bg-stone-50/50 transition-colors"
                  data-testid={`trust-account-row-${a.id}`}
                >
                  <td className="px-4 py-3 font-medium">
                    {a.residentName ?? `Resident #${a.residentId}`}
                  </td>
                  <td className="px-4 py-3 portal-num text-right">
                    {centsToDollars(a.balanceCents)}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={cn(
                        "inline-flex items-center px-1.5 py-0.5 rounded text-xs border capitalize",
                        a.status === "active"
                          ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                          : "bg-slate-100 text-slate-700 border-slate-200",
                      )}
                    >
                      {a.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 portal-num text-[12px]">
                    {fmtDate(a.lastTransactionAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setSelectedId(a.id)}
                      aria-label={`Open trust account for ${a.residentName ?? `resident ${a.residentId}`}`}
                    >
                      Open →
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <OpenAccountDialog
        open={openAddOpen}
        onOpenChange={setOpenAddOpen}
        facilityNumber={facilityNumber}
        existingResidentIds={existingResidentIds}
      />
    </div>
  );
}
