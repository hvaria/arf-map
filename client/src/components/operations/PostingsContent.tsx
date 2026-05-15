/**
 * <PostingsContent> — Wave 4 W6 (B12).
 *
 * Replaces the Wave 0 "Postings — Wave 4" placeholder in AuditReadinessContent
 * with a real posting-verification walkthrough. Per-facility catalog of
 * required postings, each row showing freshness chip (ok/stale/missing),
 * the latest verification metadata, evidence count, and per-row Verify +
 * Edit actions. Admins can also Add and Archive rows; the auditor session
 * sees a read-only view.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Page heading + gradient primary action:    ComplianceContent.tsx:280-286
 *   - Summary tile grid + tone palette:          AuditReadinessContent.tsx:129-160
 *   - AddX dialog skeleton + onSubmitKey:        VendorsContent.tsx:215-313
 *   - <FormField> usage:                         components/operations/FormField.tsx
 *   - Loading skeletons / Empty state:           VendorsContent.tsx:453-471
 *   - Error banner:                              VendorsContent.tsx:445-451
 *   - useMutation + invalidate + toast:          VendorsContent.tsx:167-200
 *   - Optimistic-update pattern on archive:      VendorsContent.tsx:350-375
 *   - Status badge tone palette:                 VendorsContent.tsx:97-114
 *   - <AttachEvidence> for verify photos:        components/operations/AttachEvidence.tsx
 *   - useIsWritable() write-action gate:         context/AuditorContext.tsx:53-56
 *   - Shared constants (POSTING_KEYS, …):        shared/postings.ts
 *
 * API contract (Phase 4 §7 — Wave 4 W6):
 *   POST   /api/ops/facilities/:fn/postings/seed
 *   GET    /api/ops/facilities/:fn/postings
 *   POST   /api/ops/postings
 *   PUT    /api/ops/postings/:id
 *   POST   /api/ops/postings/:id/archive
 *   POST   /api/ops/postings/:catalogId/verify
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
import {
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ClipboardList,
  Plus,
  Pencil,
  Camera,
} from "lucide-react";
import { useIsWritable } from "@/context/AuditorContext";
import {
  POSTING_KEYS,
  POSTING_VERIFICATION_STATUSES,
  POSTING_VERIFICATION_LABELS,
  type PostingKey,
  type PostingVerificationStatus,
} from "@shared/postings";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PostingLatestVerification {
  id: number;
  verifiedAt: number;
  verifiedBy: string;
  status: PostingVerificationStatus;
  note: string | null;
  evidenceCount: number;
}

export interface PostingRow {
  id: number;
  facilityNumber: string;
  postingKey: PostingKey;
  titleEn: string;
  titleEs?: string | null;
  locationHint: string;
  required: 0 | 1;
  cadenceDays: number;
  status: "active" | "archived";
  latestVerification: PostingLatestVerification | null;
  freshness: "ok" | "stale" | "missing";
  placeholder: boolean;
  createdAt: number;
  updatedAt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRelativeDays(ms: number): string {
  const diff = Date.now() - ms;
  const days = Math.round(diff / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  const months = Math.round(days / 30);
  return `${months} mo ago`;
}

function freshnessChip(f: PostingRow["freshness"]): {
  label: string;
  cls: string;
  icon: typeof CheckCircle2;
} {
  switch (f) {
    case "ok":
      return {
        label: "Current",
        cls: "bg-emerald-100 text-emerald-700 border-emerald-200",
        icon: CheckCircle2,
      };
    case "stale":
      return {
        label: "Stale",
        cls: "bg-amber-100 text-amber-700 border-amber-200",
        icon: AlertTriangle,
      };
    case "missing":
    default:
      return {
        label: "Missing",
        cls: "bg-red-100 text-red-700 border-red-200",
        icon: AlertCircle,
      };
  }
}

// ── Verify dialog ─────────────────────────────────────────────────────────────

interface VerifyFormData {
  status: PostingVerificationStatus;
  note: string;
  verifiedBy: string;
}

function VerifyPostingDialog({
  open,
  onOpenChange,
  row,
  facilityNumber,
  defaultVerifiedBy,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  row: PostingRow | null;
  facilityNumber: string;
  defaultVerifiedBy: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [form, setForm] = useState<VerifyFormData>({
    status: "current",
    note: "",
    verifiedBy: defaultVerifiedBy,
  });
  const [showErrors, setShowErrors] = useState(false);
  const evidenceRef = useRef<AttachEvidenceHandle | null>(null);

  useEffect(() => {
    if (open) {
      setForm({ status: "current", note: "", verifiedBy: defaultVerifiedBy });
      setShowErrors(false);
    }
  }, [open, defaultVerifiedBy]);

  const set = <K extends keyof VerifyFormData>(key: K, value: VerifyFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const listKey = `/api/ops/facilities/${facilityNumber}/postings`;

  const mutation = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error("No row");
      const res = await apiRequest("POST", `/api/ops/postings/${row.id}/verify`, {
        status: form.status,
        note: form.note.trim() || undefined,
        verifiedAt: Date.now(),
        verifiedBy: form.verifiedBy.trim() || undefined,
      });
      const json = (await res.json()) as {
        success: boolean;
        data: PostingLatestVerification;
      };
      if (json?.data?.id && evidenceRef.current?.pendingCount) {
        try {
          await evidenceRef.current.flushAttach(json.data.id);
        } catch {
          /* component surfaces retry UI */
        }
      }
      return json;
    },
    onMutate: async () => {
      if (!row) return { prev: undefined };
      await qc.cancelQueries({ queryKey: [listKey] });
      const prev = qc.getQueryData<{ success: boolean; data: PostingRow[] }>([listKey]);
      if (prev?.data) {
        qc.setQueryData([listKey], {
          ...prev,
          data: prev.data.map((r) =>
            r.id === row.id
              ? {
                  ...r,
                  freshness:
                    form.status === "current" ? ("ok" as const) : ("missing" as const),
                  latestVerification: {
                    id: r.latestVerification?.id ?? 0,
                    verifiedAt: Date.now(),
                    verifiedBy: form.verifiedBy || defaultVerifiedBy,
                    status: form.status,
                    note: form.note.trim() || null,
                    evidenceCount:
                      (r.latestVerification?.evidenceCount ?? 0) +
                      (evidenceRef.current?.pendingCount ?? 0),
                  },
                }
              : r,
          ),
        });
      }
      return { prev };
    },
    onError: (err: Error, _v, ctx) => {
      if (ctx?.prev) qc.setQueryData([listKey], ctx.prev);
      toast({
        title: "Couldn't save verification",
        description: err.message,
        variant: "destructive",
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [listKey] });
      toast({ title: "Posting verified" });
      onOpenChange(false);
    },
  });

  const errors = {
    status: !form.status ? "Pick a status" : undefined,
  };
  const isValid = !errors.status;
  const submit = () => {
    if (!isValid || mutation.isPending) {
      setShowErrors(true);
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            Verify · {row?.titleEn ?? "Posting"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          {row?.locationHint && (
            <p className="text-xs text-muted-foreground">
              Location: <span className="font-medium">{row.locationHint}</span>
            </p>
          )}
          <FormField
            label="Status"
            required
            error={showErrors ? errors.status : undefined}
          >
            <Select
              value={form.status}
              onValueChange={(v) => set("status", v as PostingVerificationStatus)}
            >
              <SelectTrigger
                data-testid="posting-verify-status"
                aria-invalid={showErrors && !!errors.status}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POSTING_VERIFICATION_STATUSES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {POSTING_VERIFICATION_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Verified by">
            <Input
              value={form.verifiedBy}
              onChange={(e) => set("verifiedBy", e.target.value)}
              placeholder="Your name"
              data-testid="posting-verify-by"
            />
          </FormField>
          <FormField label="Note" hint="Optional — what did you observe?">
            <Textarea
              value={form.note}
              onChange={(e) => set("note", e.target.value)}
              className="resize-none min-h-[60px]"
              placeholder="Posting present, legible, no curling edges."
              data-testid="posting-verify-note"
            />
          </FormField>
          <FormField label="Photo">
            <AttachEvidence
              ref={evidenceRef}
              entityType="ops_posting_verification"
              entityId={undefined}
              facilityNumber={facilityNumber}
              triggerLabel="Capture photo"
            />
          </FormField>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={mutation.isPending}
              data-testid="posting-verify-save"
            >
              {mutation.isPending ? "Saving…" : "Save verification"}
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

// ── Edit / Add dialog ─────────────────────────────────────────────────────────

interface PostingFormData {
  postingKey: PostingKey;
  titleEn: string;
  titleEs: string;
  locationHint: string;
  cadenceDays: string;
  required: boolean;
}

function EditPostingDialog({
  open,
  onOpenChange,
  row,
  facilityNumber,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When null, dialog is in "add" mode. */
  row: PostingRow | null;
  facilityNumber: string;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isAdd = row === null;
  const [form, setForm] = useState<PostingFormData>({
    postingKey: "other",
    titleEn: "",
    titleEs: "",
    locationHint: "",
    cadenceDays: "30",
    required: true,
  });
  const [showErrors, setShowErrors] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (row) {
      setForm({
        postingKey: row.postingKey,
        titleEn: row.titleEn,
        titleEs: row.titleEs ?? "",
        locationHint: row.locationHint,
        cadenceDays: String(row.cadenceDays),
        required: row.required === 1,
      });
    } else {
      setForm({
        postingKey: "other",
        titleEn: "",
        titleEs: "",
        locationHint: "",
        cadenceDays: "30",
        required: true,
      });
    }
    setShowErrors(false);
  }, [open, row]);

  const set = <K extends keyof PostingFormData>(key: K, value: PostingFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const listKey = `/api/ops/facilities/${facilityNumber}/postings`;

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        postingKey: form.postingKey,
        titleEn: form.titleEn.trim(),
        titleEs: form.titleEs.trim() || undefined,
        locationHint: form.locationHint.trim() || undefined,
        cadenceDays: parseInt(form.cadenceDays, 10),
        required: form.required ? 1 : 0,
      };
      if (isAdd) {
        const res = await apiRequest("POST", `/api/ops/postings`, {
          ...body,
          facilityNumber,
        });
        return res.json();
      }
      const res = await apiRequest("PUT", `/api/ops/postings/${row!.id}`, body);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [listKey] });
      toast({ title: isAdd ? "Posting added" : "Posting updated" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: isAdd ? "Couldn't add posting" : "Couldn't update posting",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const archiveMutation = useMutation({
    mutationFn: async () => {
      if (!row) throw new Error("No row");
      const res = await apiRequest("POST", `/api/ops/postings/${row.id}/archive`);
      return res.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [listKey] });
      toast({ title: "Posting archived" });
      onOpenChange(false);
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't archive posting",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const cadenceNum = parseInt(form.cadenceDays, 10);
  const errors = {
    titleEn: !form.titleEn.trim() ? "Give the posting a title" : undefined,
    cadence:
      !form.cadenceDays ||
      Number.isNaN(cadenceNum) ||
      cadenceNum < 1 ||
      cadenceNum > 3650
        ? "Cadence in days (1–3650)"
        : undefined,
  };
  const isValid = !errors.titleEn && !errors.cadence;
  const submit = () => {
    if (!isValid || saveMutation.isPending) {
      setShowErrors(true);
      return;
    }
    saveMutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{isAdd ? "Add posting" : "Edit posting"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField label="Posting type">
            <Select
              value={form.postingKey}
              onValueChange={(v) => set("postingKey", v as PostingKey)}
            >
              <SelectTrigger data-testid="posting-edit-key">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {POSTING_KEYS.map((k) => (
                  <SelectItem key={k} value={k} className="capitalize">
                    {k.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField
            label="Title (English)"
            required
            error={showErrors ? errors.titleEn : undefined}
          >
            <Input
              value={form.titleEn}
              onChange={(e) => set("titleEn", e.target.value)}
              placeholder="Residents' rights"
              data-testid="posting-edit-title-en"
              aria-invalid={showErrors && !!errors.titleEn}
            />
          </FormField>
          <FormField label="Title (Spanish)">
            <Input
              value={form.titleEs}
              onChange={(e) => set("titleEs", e.target.value)}
              placeholder="Derechos de los residentes"
            />
          </FormField>
          <FormField label="Location hint">
            <Input
              value={form.locationHint}
              onChange={(e) => set("locationHint", e.target.value)}
              placeholder="Common area near entrance"
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField
              label="Cadence (days)"
              required
              error={showErrors ? errors.cadence : undefined}
            >
              <Input
                type="number"
                inputMode="numeric"
                min={1}
                max={3650}
                value={form.cadenceDays}
                onChange={(e) => set("cadenceDays", e.target.value)}
                data-testid="posting-edit-cadence"
                aria-invalid={showErrors && !!errors.cadence}
              />
            </FormField>
            <FormField label="Required">
              <label className="inline-flex items-center gap-2 text-sm py-2">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={form.required}
                  onChange={(e) => set("required", e.target.checked)}
                  data-testid="posting-edit-required"
                />
                <span>Required posting</span>
              </label>
            </FormField>
          </div>
          <div className="flex gap-2 justify-end pt-1">
            {!isAdd && row && (
              <Button
                variant="outline"
                onClick={() => archiveMutation.mutate()}
                disabled={archiveMutation.isPending}
                data-testid="posting-edit-archive"
                aria-label={`Archive ${row.titleEn}`}
              >
                {archiveMutation.isPending ? "Archiving…" : "Archive"}
              </Button>
            )}
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={saveMutation.isPending}
              data-testid="posting-edit-save"
            >
              {saveMutation.isPending ? "Saving…" : "Save"}
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

// ── Tile ──────────────────────────────────────────────────────────────────────

function Tile({
  label,
  value,
  tone,
  loading,
}: {
  label: string;
  value: number;
  tone: "indigo" | "emerald" | "amber" | "red";
  loading?: boolean;
}) {
  const cls: Record<typeof tone, string> = {
    indigo: "bg-indigo-50 border-indigo-200 text-indigo-700",
    emerald: "bg-emerald-50 border-emerald-200 text-emerald-700",
    amber: "bg-amber-50 border-amber-200 text-amber-700",
    red: "bg-red-50 border-red-200 text-red-700",
  };
  return (
    <div className={cn("rounded-lg border p-3 text-center", cls[tone])}>
      {loading ? (
        <Skeleton className="h-6 w-12 mx-auto" />
      ) : (
        <p className="text-xl font-bold portal-num">{value}</p>
      )}
      <p className="text-xs">{label}</p>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function PostingsContent({ facilityNumber }: { facilityNumber: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isWritable = useIsWritable();
  const [verifyRow, setVerifyRow] = useState<PostingRow | null>(null);
  const [editRow, setEditRow] = useState<PostingRow | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);

  const listKey = `/api/ops/facilities/${facilityNumber}/postings`;
  const { data, isLoading, error } = useQuery<{
    success: boolean;
    data: PostingRow[];
  } | null>({
    queryKey: [listKey],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const seedMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest(
        "POST",
        `/api/ops/facilities/${facilityNumber}/postings/seed`,
      );
      return res.json() as Promise<{
        success: boolean;
        data: { created: number; skipped: number };
      }>;
    },
    onSuccess: (json) => {
      qc.invalidateQueries({ queryKey: [listKey] });
      toast({
        title: "Default postings seeded",
        description: `${json?.data?.created ?? 0} created · ${
          json?.data?.skipped ?? 0
        } already present`,
      });
    },
    onError: (err: Error) => {
      toast({
        title: "Couldn't seed defaults",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const rows = (data?.data ?? []).filter((r) => r.status === "active");

  const total = rows.length;
  const current = rows.filter((r) => r.freshness === "ok").length;
  const stale = rows.filter((r) => r.freshness === "stale").length;
  const missing = rows.filter((r) => r.freshness === "missing").length;

  // Group rows by freshness severity so missing/stale float to the top.
  const orderedRows = useMemo(() => {
    const order = { missing: 0, stale: 1, ok: 2 } as const;
    return [...rows].sort(
      (a, b) =>
        order[a.freshness] - order[b.freshness] ||
        a.titleEn.localeCompare(b.titleEn),
    );
  }, [rows]);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold" style={{ color: "#1E1B4B" }}>
          Postings
        </h1>
        {isWritable && rows.length > 0 && (
          <Button
            size="sm"
            variant="gradient"
            onClick={() => setAddOpen(true)}
            data-testid="posting-add-trigger"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Add posting
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Tile label="Total" value={total} tone="indigo" loading={isLoading} />
        <Tile label="Current" value={current} tone="emerald" loading={isLoading} />
        <Tile label="Stale" value={stale} tone="amber" loading={isLoading} />
        <Tile label="Missing" value={missing} tone="red" loading={isLoading} />
      </div>

      {error && (
        <div
          className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive"
          role="alert"
        >
          Failed to load postings.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div
          className="rounded-lg border border-dashed p-10 text-center"
          data-testid="posting-empty"
        >
          <ClipboardList className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            No postings on file yet. Seed the default Title 22 catalogue to start
            your monthly walkthrough.
          </p>
          {isWritable && (
            <Button
              size="sm"
              variant="gradient"
              onClick={() => seedMutation.mutate()}
              disabled={seedMutation.isPending}
              data-testid="posting-seed-trigger"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              {seedMutation.isPending ? "Seeding…" : "Seed default postings"}
            </Button>
          )}
        </div>
      ) : (
        <ul className="space-y-2" data-testid="posting-list">
          {orderedRows.map((r) => {
            const chip = freshnessChip(r.freshness);
            const Icon = chip.icon;
            return (
              <li
                key={r.id}
                className={cn(
                  "rounded-lg border p-4 bg-white",
                  r.freshness === "missing" && "border-red-200 bg-red-50/30",
                  r.freshness === "stale" && "border-amber-200 bg-amber-50/30",
                  r.freshness === "ok" && "border-stone-200",
                )}
                data-testid={`posting-row-${r.id}`}
              >
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium text-sm">{r.titleEn}</p>
                      {r.placeholder && (
                        <span
                          className="inline-flex items-center px-1 py-0.5 rounded text-[10px] bg-amber-100 text-amber-800 border border-amber-200 font-semibold"
                          title="Placeholder default — verify against Title 22 / CDSS for your facility"
                          aria-label="Placeholder default value, not validated"
                        >
                          [V]
                        </span>
                      )}
                      <span
                        className={cn(
                          "inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] border font-medium",
                          chip.cls,
                        )}
                        data-testid={`posting-row-chip-${r.id}`}
                      >
                        <Icon className="h-3 w-3" aria-hidden />
                        {chip.label}
                      </span>
                      {r.required === 1 && (
                        <span className="text-[10px] text-muted-foreground">
                          required
                        </span>
                      )}
                    </div>
                    {r.titleEs && (
                      <p className="text-xs text-muted-foreground italic mt-0.5">
                        {r.titleEs}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground mt-1">
                      Location: <span className="font-medium">{r.locationHint || "—"}</span>
                      <span className="mx-1">·</span>
                      Cadence: every {r.cadenceDays} days
                    </p>
                    {r.latestVerification ? (
                      <p className="text-xs text-muted-foreground mt-1">
                        {r.freshness === "ok" ? "Verified " : "Last verified "}
                        {fmtRelativeDays(r.latestVerification.verifiedAt)}
                        {r.latestVerification.verifiedBy
                          ? ` by ${r.latestVerification.verifiedBy}`
                          : ""}
                        {r.latestVerification.evidenceCount > 0
                          ? ` · ${r.latestVerification.evidenceCount} photo${
                              r.latestVerification.evidenceCount === 1 ? "" : "s"
                            }`
                          : ""}
                        {r.latestVerification.status !== "current"
                          ? ` · status: ${POSTING_VERIFICATION_LABELS[r.latestVerification.status]}`
                          : ""}
                      </p>
                    ) : (
                      <p className="text-xs text-red-700 mt-1">
                        Never verified.
                      </p>
                    )}
                    {r.latestVerification?.note && (
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        Note: {r.latestVerification.note}
                      </p>
                    )}
                  </div>
                  {isWritable && (
                    <div className="flex items-center gap-2 shrink-0">
                      <Button
                        size="sm"
                        variant="gradient"
                        onClick={() => setVerifyRow(r)}
                        data-testid={`posting-verify-trigger-${r.id}`}
                        aria-label={`Verify ${r.titleEn}`}
                      >
                        <Camera className="h-3.5 w-3.5 mr-1" />
                        Verify
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditRow(r);
                          setEditOpen(true);
                        }}
                        data-testid={`posting-edit-trigger-${r.id}`}
                        aria-label={`Edit ${r.titleEn}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <VerifyPostingDialog
        open={!!verifyRow}
        onOpenChange={(v) => !v && setVerifyRow(null)}
        row={verifyRow}
        facilityNumber={facilityNumber}
        defaultVerifiedBy=""
      />
      <EditPostingDialog
        open={editOpen}
        onOpenChange={(v) => {
          setEditOpen(v);
          if (!v) setEditRow(null);
        }}
        row={editRow}
        facilityNumber={facilityNumber}
      />
      <EditPostingDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        row={null}
        facilityNumber={facilityNumber}
      />
    </div>
  );
}
