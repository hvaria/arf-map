/**
 * <ComplaintsContent> — Wave 1 W10 (B9).
 *
 * Intake → investigation → resolution → closure. Anonymous intake is
 * supported (em-dash rendering per Phase 5 §6.A.3). External-ref field
 * per Phase 5 §6.B.2.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Page heading + gradient primary action:    ComplianceContent.tsx:280-286
 *   - Summary tile grid:                         ComplianceContent.tsx:289-302
 *   - AddX dialog skeleton + onSubmitKey:        ComplianceContent.tsx:55-204
 *   - Loading skeletons / Empty state:           ComplianceContent.tsx:311-318
 *   - Error banner:                              ComplianceContent.tsx:305-307
 *   - useMutation + invalidate + toast:          ComplianceContent.tsx:88-106
 *   - <FormField> usage:                         components/operations/FormField.tsx
 *   - Status badge palette:                      EmarContent.tsx:55-62
 *   - Staff dropdown query:                      ComplianceContent.tsx:76-83
 *   - IncidentsContent inline-detail navigation: IncidentsContent.tsx (state-driven)
 *   - <AttachEvidence> for COI/etc.:             components/operations/AttachEvidence.tsx
 *
 * API contract (Phase 4 §7.7):
 *   GET    /api/ops/facilities/:fn/complaints?status=&page=&limit=
 *   POST   /api/ops/complaints
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
import { ComplaintDetail } from "@/components/operations/ComplaintDetail";
import { Plus, MessageSquare, ChevronRight } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ComplaintRow {
  id: number;
  facilityNumber: string;
  complainantType:
    | "resident"
    | "family"
    | "staff"
    | "ombudsman"
    | "regulator"
    | "anonymous"
    | "other";
  complainantName: string | null;
  complainantRelation: string | null;
  nature: string;
  receivedAt: number;
  intakeNotes: string | null;
  externalRef: string | null;
  assignedTo: string | null;
  status: "open" | "investigating" | "resolved" | "closed";
  createdAt: number;
}

interface StaffLite {
  id: number;
  firstName: string;
  lastName: string;
  role?: string;
  status?: string;
}

const COMPLAINANT_TYPES = [
  "resident",
  "family",
  "staff",
  "ombudsman",
  "regulator",
  "anonymous",
  "other",
];

const STATUS_BADGE: Record<ComplaintRow["status"], string> = {
  open: "bg-red-100 text-red-700 border-red-200",
  investigating: "bg-amber-100 text-amber-700 border-amber-200",
  resolved: "bg-emerald-100 text-emerald-700 border-emerald-200",
  closed: "bg-slate-100 text-slate-700 border-slate-200",
};

const PAGE_LIMIT = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString();
}

function dashIfBlank(v: string | null | undefined): string {
  if (!v || !v.trim()) return "—";
  return v;
}

// ── Add Complaint dialog ──────────────────────────────────────────────────────

interface ComplaintFormData {
  complainantType: string;
  complainantName: string;
  complainantRelation: string;
  nature: string;
  receivedAt: string;
  intakeNotes: string;
  externalRef: string;
  assignedTo: string;
}

function emptyForm(): ComplaintFormData {
  const d = new Date();
  return {
    complainantType: "family",
    complainantName: "",
    complainantRelation: "",
    nature: "",
    receivedAt: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    intakeNotes: "",
    externalRef: "",
    assignedTo: "",
  };
}

function LogComplaintDialog({
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
  const [form, setForm] = useState<ComplaintFormData>(emptyForm);
  const [showErrors, setShowErrors] = useState(false);
  const evidenceRef = useRef<AttachEvidenceHandle | null>(null);

  useEffect(() => {
    if (open) setForm(emptyForm());
  }, [open]);

  const set = <K extends keyof ComplaintFormData>(
    key: K,
    value: ComplaintFormData[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const isAnonymous = form.complainantType === "anonymous";

  const { data: staffEnv } = useQuery<{ success: boolean; data: StaffLite[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/staff`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: open && !!facilityNumber,
    staleTime: 60_000,
  });
  const activeStaff = (staffEnv?.data ?? []).filter(
    (s) => !s.status || s.status === "active",
  );

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/complaints`, {
        complainantType: form.complainantType,
        complainantName: isAnonymous ? undefined : form.complainantName.trim() || undefined,
        complainantRelation: isAnonymous
          ? undefined
          : form.complainantRelation.trim() || undefined,
        nature: form.nature.trim(),
        receivedAt: new Date(`${form.receivedAt}T00:00:00`).getTime(),
        intakeNotes: form.intakeNotes.trim() || undefined,
        externalRef: form.externalRef.trim() || undefined,
        assignedTo: form.assignedTo || undefined,
      });
      const json = (await res.json()) as { success: boolean; data: ComplaintRow };
      if (json?.data?.id && evidenceRef.current?.pendingCount) {
        try {
          await evidenceRef.current.flushAttach(json.data.id);
        } catch {
          /* retry surfaced inline */
        }
      }
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/complaints`],
      });
      toast({ title: "Complaint logged" });
      onOpenChange(false);
      setShowErrors(false);
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't log complaint", description: err.message, variant: "destructive" });
    },
  });

  const errors = {
    nature: !form.nature.trim() ? "Briefly summarise the nature" : undefined,
    receivedAt: !form.receivedAt ? "When was it received?" : undefined,
    intakeNotes: !form.intakeNotes.trim() ? "Add intake notes" : undefined,
  };
  const isValid = !errors.nature && !errors.receivedAt && !errors.intakeNotes;
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
          <DialogTitle>Log complaint</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField label="Complainant" required>
            <Select
              value={form.complainantType}
              onValueChange={(v) => set("complainantType", v)}
            >
              <SelectTrigger data-testid="complaint-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {COMPLAINANT_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          {!isAnonymous ? (
            <div className="grid grid-cols-2 gap-3">
              <FormField label="Name">
                <Input
                  value={form.complainantName}
                  onChange={(e) => set("complainantName", e.target.value)}
                  placeholder="Jane K."
                />
              </FormField>
              <FormField label="Relation">
                <Input
                  value={form.complainantRelation}
                  onChange={(e) => set("complainantRelation", e.target.value)}
                  placeholder="Daughter of resident B."
                />
              </FormField>
            </div>
          ) : (
            <p className="text-[11px] text-muted-foreground -mt-2">
              Name and relation are hidden for anonymous complaints.
            </p>
          )}
          <FormField
            label="Nature"
            required
            error={showErrors ? errors.nature : undefined}
            hint="Short summary: meal quality, staffing levels, room temp…"
          >
            <Input
              value={form.nature}
              onChange={(e) => set("nature", e.target.value)}
              placeholder="Meal quality"
              data-testid="complaint-nature"
            />
          </FormField>
          <FormField
            label="Received on"
            required
            error={showErrors ? errors.receivedAt : undefined}
          >
            <Input
              type="date"
              value={form.receivedAt}
              onChange={(e) => set("receivedAt", e.target.value)}
            />
          </FormField>
          <FormField
            label="Intake notes"
            required
            error={showErrors ? errors.intakeNotes : undefined}
          >
            <Textarea
              value={form.intakeNotes}
              onChange={(e) => set("intakeNotes", e.target.value)}
              className="resize-none min-h-[72px]"
              placeholder="Caller says her mother has skipped lunch 4 times this week…"
              data-testid="complaint-intake"
            />
          </FormField>
          <FormField
            label="External reference"
            hint="Optional — Ombudsman case #, regulator reference, internal ticket"
          >
            <Input
              value={form.externalRef}
              onChange={(e) => set("externalRef", e.target.value)}
              placeholder="Ombudsman case #, regulator reference, internal ticket"
              data-testid="complaint-external-ref"
            />
          </FormField>
          <FormField label="Assigned to">
            <Select
              value={form.assignedTo || "__unassigned__"}
              onValueChange={(v) =>
                set("assignedTo", v === "__unassigned__" ? "" : v)
              }
            >
              <SelectTrigger>
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
                    const name = `${s.firstName} ${s.lastName}`.trim();
                    return (
                      <SelectItem key={s.id} value={name}>
                        {name}
                      </SelectItem>
                    );
                  })
                )}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Evidence">
            <AttachEvidence
              ref={evidenceRef}
              entityType="ops_complaint"
              entityId={undefined}
              facilityNumber={facilityNumber}
            />
          </FormField>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={mutation.isPending} data-testid="complaint-save">
              {mutation.isPending ? "Saving…" : "Save"}
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

// ── Page ──────────────────────────────────────────────────────────────────────

export function ComplaintsContent({ facilityNumber }: { facilityNumber: string }) {
  const [addOpen, setAddOpen] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery<{ success: boolean; data: ComplaintRow[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/complaints`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const complaints = data?.data ?? [];

  // Tiles
  const open = complaints.filter((c) => c.status === "open").length;
  const investigating = complaints.filter((c) => c.status === "investigating").length;
  const ninetyDays = Date.now() - 90 * 24 * 60 * 60 * 1000;
  const resolved90 = complaints.filter(
    (c) =>
      (c.status === "resolved" || c.status === "closed") && c.receivedAt >= ninetyDays,
  ).length;

  const visible = useMemo(
    () =>
      [...complaints]
        .filter((c) => c.status === "open" || c.status === "investigating")
        .sort((a, b) => b.receivedAt - a.receivedAt),
    [complaints],
  );

  if (openId !== null) {
    return (
      <ComplaintDetail
        facilityNumber={facilityNumber}
        complaintId={openId}
        onBack={() => setOpenId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold" style={{ color: "#1E1B4B" }}>
          Complaints
        </h1>
        <Button size="sm" variant="gradient" onClick={() => setAddOpen(true)} data-testid="complaint-add-trigger">
          <Plus className="h-4 w-4 mr-1.5" />
          Log complaint
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center">
          <p className="text-xl font-bold portal-num text-red-700">{open}</p>
          <p className="text-xs text-red-700">Open</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
          <p className="text-xl font-bold portal-num text-amber-700">{investigating}</p>
          <p className="text-xs text-amber-700">Investigating</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
          <p className="text-xl font-bold portal-num text-emerald-700">{resolved90}</p>
          <p className="text-xs text-emerald-700">Resolved (90d)</p>
        </div>
      </div>

      {error && (
        <div
          className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive"
          role="alert"
        >
          Failed to load complaints.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : complaints.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center" data-testid="complaint-empty">
          <MessageSquare className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            No complaints logged. Log walk-up concerns here too.
          </p>
          <Button size="sm" variant="gradient" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Log complaint
          </Button>
        </div>
      ) : (
        <>
          <h2 className="text-sm font-medium text-muted-foreground">
            Open &amp; investigating
          </h2>
          <ul className="space-y-2" data-testid="complaint-list">
            {visible.length === 0 ? (
              <li className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                No open or investigating complaints.
              </li>
            ) : (
              visible.map((c) => {
                const isAnon = c.complainantType === "anonymous";
                return (
                  <li key={c.id}>
                    <button
                      onClick={() => setOpenId(c.id)}
                      className="w-full text-left rounded-lg border bg-white p-4 hover:bg-stone-50/50 transition-colors flex items-start justify-between gap-3"
                      data-testid={`complaint-open-${c.id}`}
                      aria-label={`Open complaint ${c.id}`}
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">
                          <span className="capitalize">{c.complainantType}</span>
                          {" · "}
                          {isAnon
                            ? dashIfBlank(null)
                            : c.complainantName
                              ? c.complainantName
                              : dashIfBlank(null)}
                          {c.complainantRelation
                            ? ` (${c.complainantRelation})`
                            : ""}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Received {fmtDate(c.receivedAt)} · Nature: {c.nature}
                        </p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Assigned: {dashIfBlank(c.assignedTo)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <span
                          className={cn(
                            "inline-flex items-center px-1.5 py-0.5 rounded text-xs border capitalize",
                            STATUS_BADGE[c.status],
                          )}
                        >
                          {c.status}
                        </span>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </div>
                    </button>
                  </li>
                );
              })
            )}
            {complaints.length > PAGE_LIMIT && (
              <li className="text-center pt-2 text-xs text-muted-foreground">
                Showing latest. Full history is available in pre-audit export.
              </li>
            )}
          </ul>
        </>
      )}

      <LogComplaintDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        facilityNumber={facilityNumber}
      />
    </div>
  );
}
