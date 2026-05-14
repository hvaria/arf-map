/**
 * <InspectionsContent> — Wave 1 W13 (B11).
 *
 * Records inspector visits (CDSS CCLD, Ombudsman, Fire Marshal, Health Dept,
 * internal). Citations link to corrective actions; close gating prevents
 * inspection closure while citations are open.
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
 *   - <AuditTrailButton> in detail header:       components/operations/AuditTrailButton.tsx
 *   - <AttachEvidence> for inspection report:    components/operations/AttachEvidence.tsx
 *   - Optimistic update pattern:                 AttachEvidence.tsx:215-243
 *
 * API contract (Phase 4 §7.8):
 *   GET    /api/ops/facilities/:fn/inspections?page=&limit=
 *   GET    /api/ops/inspections/:id              (detail incl. citations + evidence)
 *   POST   /api/ops/inspections
 *   POST   /api/ops/inspections/:id/close        (requires all citations closed)
 *   POST   /api/ops/inspections/:id/citations    (add citation)
 *   POST   /api/ops/citations/:id/close          { closureNote }
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
import { toLocalEpochMs } from "@/lib/datetime";
import { FormField, onSubmitKey } from "@/components/operations/FormField";
import { AuditTrailButton } from "@/components/operations/AuditTrailButton";
import {
  AttachEvidence,
  type AttachEvidenceHandle,
} from "@/components/operations/AttachEvidence";
import {
  Plus,
  ClipboardCheck,
  ArrowLeft,
  ChevronRight,
  Trash2,
} from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface InspectionRow {
  id: number;
  facilityNumber: string;
  inspectorOrg: string;
  purpose: string;
  visitAt: number;
  inspectorName: string | null;
  findings: string[];
  status: "open" | "cited" | "remediating" | "closed";
  createdAt: number;
  citationCount?: number;
  openCitationCount?: number;
}

export interface Citation {
  id: number;
  inspectionId: number;
  title: string;
  detail: string | null;
  dueAt: number | null;
  status: "open" | "remediating" | "closed";
  closureNote: string | null;
  closedAt: number | null;
}

export interface InspectionDetailRow extends InspectionRow {
  citations: Citation[];
}

const INSPECTOR_ORGS = [
  "CDSS CCLD",
  "Ombudsman",
  "Fire Marshal",
  "Health Department",
  "Internal/Corporate",
  "Other",
];

const PURPOSES = ["annual", "complaint", "follow-up", "incident", "other"];

const STATUS_BADGE: Record<InspectionRow["status"], string> = {
  open: "bg-red-100 text-red-700 border-red-200",
  cited: "bg-red-100 text-red-700 border-red-200",
  remediating: "bg-amber-100 text-amber-700 border-amber-200",
  closed: "bg-slate-100 text-slate-700 border-slate-200",
};

const CITATION_BADGE: Record<Citation["status"], string> = {
  open: "bg-red-100 text-red-700 border-red-200",
  remediating: "bg-amber-100 text-amber-700 border-amber-200",
  closed: "bg-emerald-100 text-emerald-700 border-emerald-200",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString();
}

function inspectionLabel(status: InspectionRow["status"]): string {
  if (status === "open") return "Open";
  if (status === "cited") return "Cited";
  if (status === "remediating") return "Remediating";
  return "Closed";
}

// ── Log Inspection dialog ─────────────────────────────────────────────────────

interface InspectionFormData {
  inspectorOrg: string;
  purpose: string;
  visitAt: string;
  inspectorName: string;
  findings: string[];
}

function emptyForm(): InspectionFormData {
  const d = new Date();
  return {
    inspectorOrg: "CDSS CCLD",
    purpose: "annual",
    visitAt: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    inspectorName: "",
    findings: [""],
  };
}

function LogInspectionDialog({
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
  const [form, setForm] = useState<InspectionFormData>(emptyForm);
  const [showErrors, setShowErrors] = useState(false);
  const evidenceRef = useRef<AttachEvidenceHandle | null>(null);

  useEffect(() => {
    if (open) setForm(emptyForm());
  }, [open]);

  const set = <K extends keyof InspectionFormData>(
    key: K,
    value: InspectionFormData[K],
  ) => setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation({
    mutationFn: async () => {
      const findings = form.findings.map((f) => f.trim()).filter(Boolean);
      const res = await apiRequest("POST", `/api/ops/inspections`, {
        facilityNumber,
        inspectorOrg: form.inspectorOrg,
        purpose: form.purpose,
        visitAt: toLocalEpochMs(form.visitAt),
        inspectorName: form.inspectorName.trim() || null,
        findings,
      });
      const json = (await res.json()) as { success: boolean; data: InspectionRow };
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
        queryKey: [`/api/ops/facilities/${facilityNumber}/inspections`],
      });
      toast({ title: "Inspection logged" });
      onOpenChange(false);
      setShowErrors(false);
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't save inspection", description: err.message, variant: "destructive" });
    },
  });

  const errors = {
    visitAt: !form.visitAt ? "When did the inspector visit?" : undefined,
  };
  const isValid = !errors.visitAt;
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
          <DialogTitle>Log inspection</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Inspector org" required>
              <Select
                value={form.inspectorOrg}
                onValueChange={(v) => set("inspectorOrg", v)}
              >
                <SelectTrigger data-testid="inspection-org">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {INSPECTOR_ORGS.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
            <FormField label="Purpose" required>
              <Select value={form.purpose} onValueChange={(v) => set("purpose", v)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PURPOSES.map((p) => (
                    <SelectItem key={p} value={p} className="capitalize">
                      {p}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>
          </div>
          <FormField
            label="Visit date"
            required
            error={showErrors ? errors.visitAt : undefined}
          >
            <Input
              type="date"
              value={form.visitAt}
              onChange={(e) => set("visitAt", e.target.value)}
            />
          </FormField>
          <FormField label="Inspector name">
            <Input
              value={form.inspectorName}
              onChange={(e) => set("inspectorName", e.target.value)}
              placeholder="A. Garcia"
            />
          </FormField>
          <FormField label="Findings" hint="Add each finding separately">
            <div className="space-y-2" data-testid="inspection-findings">
              {form.findings.map((finding, i) => (
                <div key={i} className="flex gap-2 items-start">
                  <Textarea
                    value={finding}
                    onChange={(e) => {
                      const next = [...form.findings];
                      next[i] = e.target.value;
                      set("findings", next);
                    }}
                    placeholder="Describe a finding"
                    className="resize-none min-h-[40px]"
                  />
                  {form.findings.length > 1 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const next = form.findings.filter((_, idx) => idx !== i);
                        set("findings", next);
                      }}
                      aria-label={`Remove finding ${i + 1}`}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ))}
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => set("findings", [...form.findings, ""])}
                data-testid="inspection-add-finding"
              >
                <Plus className="h-3.5 w-3.5 mr-1" />
                Add finding
              </Button>
            </div>
          </FormField>
          <FormField label="Evidence">
            <AttachEvidence
              ref={evidenceRef}
              entityType="ops_inspection"
              entityId={undefined}
              facilityNumber={facilityNumber}
              triggerLabel="Add inspection report"
            />
          </FormField>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={mutation.isPending} data-testid="inspection-save">
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

// ── Inspection detail view ───────────────────────────────────────────────────

function CloseCitationDialog({
  open,
  onOpenChange,
  citationId,
  inspectionId,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  citationId: number | null;
  inspectionId: number;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open) setNote("");
  }, [open]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (citationId === null) throw new Error("No citation selected");
      const res = await apiRequest("POST", `/api/ops/citations/${citationId}/close`, {
        closureNote: note.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [`/api/ops/inspections/${inspectionId}`] });
      qc.invalidateQueries({
        queryKey: [`/api/ops/facilities/${facilityNumber}/inspections`],
      });
      toast({ title: "Citation closed" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't close citation", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Close citation</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(() => mutation.mutate())}>
          <FormField label="Closure note" required>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className="resize-none min-h-[72px]"
              placeholder="What corrective action closed this?"
              data-testid="citation-close-note"
            />
          </FormField>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => mutation.mutate()}
              disabled={!note.trim() || mutation.isPending}
              data-testid="citation-close-save"
            >
              {mutation.isPending ? "Saving…" : "Close citation"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function InspectionDetail({
  facilityNumber,
  inspectionId,
  onBack,
}: {
  facilityNumber: string;
  inspectionId: number;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [closeCitationId, setCloseCitationId] = useState<number | null>(null);
  const [citationForm, setCitationForm] = useState({
    title: "",
    detail: "",
    dueAt: "",
  });
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false);

  const detailKey = [`/api/ops/inspections/${inspectionId}`] as const;
  const listKey = [`/api/ops/facilities/${facilityNumber}/inspections`] as const;

  const { data, isLoading, error } = useQuery<{
    success: boolean;
    data: InspectionDetailRow;
  } | null>({
    queryKey: detailKey,
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: Number.isFinite(inspectionId),
  });

  const insp = data?.data ?? null;

  const addCitationMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/ops/inspections/${inspectionId}/citations`,
        {
          title: citationForm.title.trim(),
          detail: citationForm.detail.trim() || null,
          dueAt: citationForm.dueAt ? toLocalEpochMs(citationForm.dueAt) : null,
        },
      );
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: listKey });
      toast({ title: "Citation added" });
      setCitationForm({ title: "", detail: "", dueAt: "" });
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't add citation", description: err.message, variant: "destructive" });
    },
  });

  const closeInspectionMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/inspections/${inspectionId}/close`);
      return res.json();
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't close inspection", description: err.message, variant: "destructive" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: listKey });
      toast({ title: "Inspection closed" });
      setConfirmCloseOpen(false);
    },
  });

  const openCitations = insp?.citations.filter((c) => c.status !== "closed") ?? [];
  const canClose = openCitations.length === 0 && insp?.status !== "closed";

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Inspections
      </button>

      {isLoading && (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      )}

      {error && !isLoading && (
        <div
          className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive"
          role="alert"
        >
          Failed to load inspection.
        </div>
      )}

      {insp && (
        <>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold" style={{ color: "#1E1B4B" }}>
                {insp.inspectorOrg} · <span className="capitalize">{insp.purpose}</span>
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Visit {fmtDate(insp.visitAt)}
                {insp.inspectorName ? ` · Inspector: ${insp.inspectorName}` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center px-1.5 py-0.5 rounded text-xs border capitalize",
                  STATUS_BADGE[insp.status],
                )}
              >
                {inspectionLabel(insp.status)}
              </span>
              <AuditTrailButton
                entityType="ops_inspection"
                entityId={insp.id}
                facilityNumber={facilityNumber}
                labelText="History"
              />
            </div>
          </div>

          {insp.findings && insp.findings.length > 0 && (
            <div>
              <h2 className="text-sm font-medium text-muted-foreground mb-2">Findings</h2>
              <ul className="space-y-1.5 list-disc pl-5 text-sm">
                {insp.findings.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            </div>
          )}

          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">
              Citations ({insp.citations.length})
            </h2>
            <ul className="space-y-2" data-testid="citation-list">
              {insp.citations.length === 0 && (
                <li className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  No citations recorded.
                </li>
              )}
              {insp.citations.map((c) => (
                <li
                  key={c.id}
                  className="rounded-md border bg-white p-3 flex items-start justify-between gap-3 flex-wrap"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">{c.title}</p>
                    {c.detail && (
                      <p className="text-xs text-muted-foreground mt-0.5 whitespace-pre-wrap">
                        {c.detail}
                      </p>
                    )}
                    {c.dueAt && (
                      <p className="text-[11px] text-muted-foreground mt-0.5">
                        Due {fmtDate(c.dueAt)}
                      </p>
                    )}
                    {c.closureNote && (
                      <p className="text-[11px] text-emerald-700 mt-0.5">
                        Closure: {c.closureNote}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={cn(
                        "inline-flex items-center px-1.5 py-0.5 rounded text-xs border capitalize",
                        CITATION_BADGE[c.status],
                      )}
                    >
                      {c.status}
                    </span>
                    {c.status !== "closed" && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setCloseCitationId(c.id)}
                        data-testid={`citation-close-${c.id}`}
                      >
                        Close citation
                      </Button>
                    )}
                  </div>
                </li>
              ))}
            </ul>

            {insp.status !== "closed" && (
              <div
                className="mt-3 rounded-md border bg-white p-3 space-y-2"
                onKeyDown={onSubmitKey(() => {
                  if (citationForm.title.trim()) addCitationMutation.mutate();
                })}
              >
                <p className="text-sm font-medium">Add citation</p>
                <FormField label="Title" required>
                  <Input
                    value={citationForm.title}
                    onChange={(e) =>
                      setCitationForm((f) => ({ ...f, title: e.target.value }))
                    }
                    placeholder="Posting #2 missing"
                    data-testid="citation-title"
                  />
                </FormField>
                <FormField label="Detail">
                  <Textarea
                    value={citationForm.detail}
                    onChange={(e) =>
                      setCitationForm((f) => ({ ...f, detail: e.target.value }))
                    }
                    className="resize-none min-h-[48px]"
                  />
                </FormField>
                <FormField label="Due date">
                  <Input
                    type="date"
                    value={citationForm.dueAt}
                    onChange={(e) =>
                      setCitationForm((f) => ({ ...f, dueAt: e.target.value }))
                    }
                  />
                </FormField>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => addCitationMutation.mutate()}
                    disabled={!citationForm.title.trim() || addCitationMutation.isPending}
                    data-testid="citation-add"
                  >
                    {addCitationMutation.isPending ? "Saving…" : "Add citation"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          {insp.status !== "closed" && (
            <div className="pt-2">
              <Button
                variant="outline"
                onClick={() => {
                  if (!canClose) {
                    toast({
                      title: "Cannot close inspection",
                      description: "All citations must be closed first.",
                      variant: "destructive",
                    });
                    return;
                  }
                  setConfirmCloseOpen(true);
                }}
                data-testid="inspection-close-trigger"
              >
                Close inspection
              </Button>
            </div>
          )}

          <Dialog open={confirmCloseOpen} onOpenChange={setConfirmCloseOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Close this inspection?</DialogTitle>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                All citations are closed. This will be kept in history.
              </p>
              <div className="flex gap-2 justify-end">
                <Button variant="outline" onClick={() => setConfirmCloseOpen(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={() => closeInspectionMutation.mutate()}
                  disabled={closeInspectionMutation.isPending}
                  data-testid="inspection-close-confirm"
                >
                  {closeInspectionMutation.isPending ? "Closing…" : "Close inspection"}
                </Button>
              </div>
            </DialogContent>
          </Dialog>

          <CloseCitationDialog
            open={closeCitationId !== null}
            onOpenChange={(o) => !o && setCloseCitationId(null)}
            citationId={closeCitationId}
            inspectionId={insp.id}
            facilityNumber={facilityNumber}
          />

          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">Evidence</h2>
            <AttachEvidence
              entityType="ops_inspection"
              entityId={insp.id}
              facilityNumber={facilityNumber}
            />
          </div>
        </>
      )}
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function InspectionsContent({ facilityNumber }: { facilityNumber: string }) {
  const [addOpen, setAddOpen] = useState(false);
  const [openId, setOpenId] = useState<number | null>(null);

  const { data, isLoading, error } = useQuery<{ success: boolean; data: InspectionRow[] } | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/inspections`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const inspections = data?.data ?? [];

  // Tiles
  const startOfYear = new Date(new Date().getFullYear(), 0, 1).getTime();
  const thisYear = inspections.filter((i) => i.visitAt >= startOfYear).length;
  const openCitations = inspections.reduce(
    (acc, i) => acc + (i.openCitationCount ?? 0),
    0,
  );

  const sorted = useMemo(
    () => [...inspections].sort((a, b) => b.visitAt - a.visitAt),
    [inspections],
  );

  if (openId !== null) {
    return (
      <InspectionDetail
        facilityNumber={facilityNumber}
        inspectionId={openId}
        onBack={() => setOpenId(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold" style={{ color: "#1E1B4B" }}>
          Inspections
        </h1>
        <Button
          size="sm"
          variant="gradient"
          onClick={() => setAddOpen(true)}
          data-testid="inspection-add-trigger"
        >
          <Plus className="h-4 w-4 mr-1.5" />
          Log inspection
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div
          className="rounded-lg p-3 text-center"
          style={{ background: "#F0F4FF", border: "1px solid #E0E7FF" }}
        >
          <p className="text-xl font-bold portal-num">{thisYear}</p>
          <p className="text-xs text-muted-foreground">This year</p>
        </div>
        <div
          className={cn(
            "rounded-lg p-3 text-center border",
            openCitations > 0
              ? "border-red-200 bg-red-50"
              : "border-emerald-200 bg-emerald-50",
          )}
        >
          <p
            className={cn(
              "text-xl font-bold portal-num",
              openCitations > 0 ? "text-red-700" : "text-emerald-700",
            )}
          >
            {openCitations}
          </p>
          <p
            className={cn(
              "text-xs",
              openCitations > 0 ? "text-red-700" : "text-emerald-700",
            )}
          >
            Open citations
          </p>
        </div>
        <div className="rounded-lg border bg-stone-50 border-stone-200 p-3 text-center">
          <p className="text-sm font-semibold">—</p>
          <p className="text-xs text-muted-foreground">Next due</p>
          <p className="text-[10px] text-muted-foreground mt-0.5">Wave 4</p>
        </div>
      </div>

      {error && (
        <div
          className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive"
          role="alert"
        >
          Failed to load inspections.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : inspections.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center" data-testid="inspection-empty">
          <ClipboardCheck className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            No inspections logged. Log past visits to build a closed-loop history.
          </p>
          <Button size="sm" variant="gradient" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Log inspection
          </Button>
        </div>
      ) : (
        <>
          <h2 className="text-sm font-medium text-muted-foreground">History</h2>
          <ul className="space-y-2" data-testid="inspection-list">
            {sorted.map((i) => (
              <li key={i.id}>
                <button
                  onClick={() => setOpenId(i.id)}
                  className="w-full text-left rounded-lg border bg-white p-4 hover:bg-stone-50/50 transition-colors flex items-start justify-between gap-3"
                  data-testid={`inspection-open-${i.id}`}
                  aria-label={`Open inspection ${i.id}`}
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {i.inspectorOrg}{" "}
                      <span className="text-muted-foreground capitalize">
                        · {i.purpose}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fmtDate(i.visitAt)}
                      {i.inspectorName ? ` · Inspector: ${i.inspectorName}` : ""}
                      {typeof i.citationCount === "number"
                        ? ` · Citations: ${i.citationCount}`
                        : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span
                      className={cn(
                        "inline-flex items-center px-1.5 py-0.5 rounded text-xs border capitalize",
                        STATUS_BADGE[i.status],
                      )}
                    >
                      {inspectionLabel(i.status)}
                    </span>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <LogInspectionDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        facilityNumber={facilityNumber}
      />
    </div>
  );
}
