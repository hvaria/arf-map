/**
 * <ComplaintDetail> — Wave 1 W10 (B9) drill-down.
 *
 * Mirrors IncidentsContent's inline detail pattern: header + intake notes +
 * investigation log + resolution block + evidence list + AuditTrailButton.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Page heading style:                     ComplianceContent.tsx:281
 *   - Back-to-overview link:                  ComplianceContent.tsx:270-278
 *   - <FormField> + onSubmitKey:              components/operations/FormField.tsx
 *   - <AuditTrailButton> in header:           components/operations/AuditTrailButton.tsx
 *   - <AttachEvidence> for evidence list:     components/operations/AttachEvidence.tsx
 *   - useMutation + invalidate + toast:       ComplianceContent.tsx:88-106
 *   - Status badge tone palette:              EmarContent.tsx:55-62
 *   - A.3 em-dash for anonymous fields:       Phase 5 §6.A.3
 *
 * API contract (Phase 4 §7.7):
 *   GET    /api/ops/complaints/:id
 *   PUT    /api/ops/complaints/:id              (status transitions)
 *   POST   /api/ops/complaints/:id/notes        { note }
 *   POST   /api/ops/complaints/:id/resolve      { resolutionNote }
 *   POST   /api/ops/complaints/:id/close
 */
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FormField, onSubmitKey } from "@/components/operations/FormField";
import { AuditTrailButton } from "@/components/operations/AuditTrailButton";
import { AttachEvidence } from "@/components/operations/AttachEvidence";
import { ArrowLeft, MessageSquare } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ComplaintDetailRow {
  id: number;
  facilityNumber: string;
  complainantType: string;
  complainantName: string | null;
  complainantRelation: string | null;
  nature: string;
  receivedAt: number;
  intakeNotes: string | null;
  externalRef: string | null;
  assignedTo: string | null;
  status: "open" | "investigating" | "resolved" | "closed";
  resolutionNote: string | null;
  resolvedAt: number | null;
  closedAt: number | null;
  createdAt: number;
  notes?: InvestigationNote[];
}

export interface InvestigationNote {
  id: number;
  complaintId: number;
  note: string;
  authoredBy: string;
  authoredAt: number;
}

const STATUS_BADGE: Record<ComplaintDetailRow["status"], string> = {
  open: "bg-red-100 text-red-700 border-red-200",
  investigating: "bg-amber-100 text-amber-700 border-amber-200",
  resolved: "bg-emerald-100 text-emerald-700 border-emerald-200",
  closed: "bg-slate-100 text-slate-700 border-slate-200",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(ms: number): string {
  return new Date(ms).toLocaleDateString();
}

function fmtDateTime(ms: number): string {
  return new Date(ms).toLocaleString();
}

/** A.3 anonymous handling — em-dash when blank to keep layout intact. */
function dashIfBlank(v: string | null | undefined): string {
  if (!v || !v.trim()) return "—";
  return v;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ComplaintDetail({
  facilityNumber,
  complaintId,
  onBack,
}: {
  facilityNumber: string;
  complaintId: number;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newNote, setNewNote] = useState("");
  const [resolutionNote, setResolutionNote] = useState("");
  const [showResolveErrors, setShowResolveErrors] = useState(false);

  const detailKey = [`/api/ops/complaints/${complaintId}`] as const;
  const listKey = [`/api/ops/facilities/${facilityNumber}/complaints`] as const;

  const { data, isLoading, error } = useQuery<{ success: boolean; data: ComplaintDetailRow } | null>({
    queryKey: detailKey,
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: Number.isFinite(complaintId),
  });

  const c = data?.data ?? null;

  const addNoteMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/complaints/${complaintId}/notes`, {
        note: newNote.trim(),
      });
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: detailKey });
      toast({ title: "Note added" });
      setNewNote("");
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't add note", description: err.message, variant: "destructive" });
    },
  });

  const resolveMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/complaints/${complaintId}/resolve`, {
        resolutionNote: resolutionNote.trim(),
      });
      return res.json();
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: detailKey });
      const prev = qc.getQueryData<{ success: boolean; data: ComplaintDetailRow }>(detailKey);
      if (prev?.data) {
        qc.setQueryData(detailKey, {
          ...prev,
          data: { ...prev.data, status: "resolved" as const, resolutionNote: resolutionNote.trim() },
        });
      }
      return { prev };
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(detailKey, ctx.prev);
      toast({ title: "Couldn't resolve", description: err.message, variant: "destructive" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: listKey });
      toast({ title: "Complaint resolved" });
      setResolutionNote("");
      setShowResolveErrors(false);
    },
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/complaints/${complaintId}/close`);
      return res.json();
    },
    onMutate: async () => {
      await qc.cancelQueries({ queryKey: detailKey });
      const prev = qc.getQueryData<{ success: boolean; data: ComplaintDetailRow }>(detailKey);
      if (prev?.data) {
        qc.setQueryData(detailKey, {
          ...prev,
          data: { ...prev.data, status: "closed" as const, closedAt: Date.now() },
        });
      }
      return { prev };
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData(detailKey, ctx.prev);
      toast({ title: "Couldn't close", description: err.message, variant: "destructive" });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: detailKey });
      qc.invalidateQueries({ queryKey: listKey });
      toast({ title: "Complaint closed" });
    },
  });

  return (
    <div className="space-y-4">
      <button
        onClick={onBack}
        className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Complaints
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
          Failed to load complaint detail.
        </div>
      )}

      {c && (
        <>
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              <h1 className="text-xl font-semibold" style={{ color: "#1E1B4B" }}>
                Complaint #{c.id}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Received {fmtDate(c.receivedAt)}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center px-1.5 py-0.5 rounded text-xs border capitalize",
                  STATUS_BADGE[c.status],
                )}
              >
                {c.status}
              </span>
              <AuditTrailButton
                entityType="ops_complaint"
                entityId={c.id}
                facilityNumber={facilityNumber}
                labelText="History"
              />
            </div>
          </div>

          {/* Header facts */}
          <div className="rounded-lg border bg-white p-4 grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">From</p>
              <p>
                <span className="capitalize">{c.complainantType.replace(/_/g, " ")}</span>
                {c.complainantName ? ` · ${c.complainantName}` : ""}
                {c.complainantRelation ? ` (${c.complainantRelation})` : ""}
                {!c.complainantName && !c.complainantRelation && c.complainantType === "anonymous"
                  ? " · —"
                  : ""}
              </p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Nature</p>
              <p>{c.nature}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Assigned</p>
              <p>{dashIfBlank(c.assignedTo)}</p>
            </div>
            <div>
              <p className="text-[11px] uppercase tracking-wide text-muted-foreground">External ref</p>
              <p>{dashIfBlank(c.externalRef)}</p>
            </div>
          </div>

          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">Intake notes</h2>
            <div className="rounded-lg border bg-stone-50 p-3 text-sm whitespace-pre-wrap">
              {c.intakeNotes && c.intakeNotes.trim()
                ? c.intakeNotes
                : <span className="text-muted-foreground">—</span>}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">
              Investigation log
            </h2>
            <ul className="space-y-2" data-testid="complaint-notes">
              {(c.notes ?? []).map((n) => (
                <li key={n.id} className="rounded-md border bg-white p-3 text-sm">
                  <p className="text-[11px] text-muted-foreground">
                    {fmtDateTime(n.authoredAt)} · {n.authoredBy}
                  </p>
                  <p className="mt-1 whitespace-pre-wrap">{n.note}</p>
                </li>
              ))}
              {(c.notes ?? []).length === 0 && (
                <li className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
                  No notes yet.
                </li>
              )}
            </ul>
            {c.status !== "closed" && (
              <div
                className="mt-2 rounded-md border bg-white p-3 space-y-2"
                onKeyDown={onSubmitKey(() => addNoteMutation.mutate())}
              >
                <FormField label="Add investigation note">
                  <Textarea
                    value={newNote}
                    onChange={(e) => setNewNote(e.target.value)}
                    className="resize-none min-h-[60px]"
                    placeholder="Interviewed cook; reviewed dietary order…"
                    data-testid="complaint-note-input"
                  />
                </FormField>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => addNoteMutation.mutate()}
                    disabled={!newNote.trim() || addNoteMutation.isPending}
                    data-testid="complaint-note-save"
                  >
                    <MessageSquare className="h-3.5 w-3.5 mr-1" />
                    {addNoteMutation.isPending ? "Saving…" : "Add note"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">Resolution</h2>
            {c.status === "resolved" || c.status === "closed" ? (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-sm">
                <p className="font-medium">
                  {c.status === "closed" ? "Closed" : "Resolved"}
                  {c.resolvedAt ? ` · ${fmtDate(c.resolvedAt)}` : ""}
                </p>
                {c.resolutionNote && (
                  <p className="mt-1 whitespace-pre-wrap">{c.resolutionNote}</p>
                )}
                {c.status === "resolved" && (
                  <div className="mt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => closeMutation.mutate()}
                      disabled={closeMutation.isPending}
                      data-testid="complaint-close"
                    >
                      {closeMutation.isPending ? "Closing…" : "Close complaint"}
                    </Button>
                  </div>
                )}
              </div>
            ) : (
              <div
                className="rounded-lg border bg-white p-3 space-y-2"
                onKeyDown={onSubmitKey(() => {
                  if (!resolutionNote.trim()) {
                    setShowResolveErrors(true);
                    return;
                  }
                  resolveMutation.mutate();
                })}
              >
                <p className="text-sm text-muted-foreground">Not yet resolved.</p>
                <FormField
                  label="Resolution note"
                  required
                  error={showResolveErrors && !resolutionNote.trim() ? "Describe how this was resolved" : undefined}
                >
                  <Textarea
                    value={resolutionNote}
                    onChange={(e) => setResolutionNote(e.target.value)}
                    className="resize-none min-h-[60px]"
                    placeholder="Outcome, corrective action, follow-up plan…"
                    data-testid="complaint-resolution-input"
                  />
                </FormField>
                <div className="flex justify-end">
                  <Button
                    size="sm"
                    onClick={() => {
                      if (!resolutionNote.trim()) {
                        setShowResolveErrors(true);
                        return;
                      }
                      resolveMutation.mutate();
                    }}
                    disabled={resolveMutation.isPending}
                    data-testid="complaint-resolve"
                  >
                    {resolveMutation.isPending ? "Saving…" : "Add resolution & close"}
                  </Button>
                </div>
              </div>
            )}
          </div>

          <div>
            <h2 className="text-sm font-medium text-muted-foreground mb-2">Evidence</h2>
            <AttachEvidence
              entityType="ops_complaint"
              entityId={c.id}
              facilityNumber={facilityNumber}
            />
          </div>
        </>
      )}
    </div>
  );
}
