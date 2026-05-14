/**
 * <VendorsContent> — Wave 1 W9 (B7).
 *
 * One row per vendor with COI expiry, license expiry, vendor type, status,
 * and a renewal-nudge surface. Threshold from F1 reg settings (default 60d).
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Page heading + gradient primary action:    ComplianceContent.tsx:280-286
 *   - Summary tile grid:                         ComplianceContent.tsx:289-302
 *   - AddX dialog skeleton + onSubmitKey:        ComplianceContent.tsx:55-204
 *   - <FormField> usage:                         components/operations/FormField.tsx
 *   - Loading skeletons / Empty state:           ComplianceContent.tsx:311-318
 *   - Error banner:                              ComplianceContent.tsx:305-307
 *   - useMutation + invalidate + toast:          ComplianceContent.tsx:88-106
 *   - Optimistic update pattern on archive:      AttachEvidence.tsx:215-243
 *   - StaffContent table pattern:                StaffContent.tsx:419-468
 *   - Status badge tone palette:                 EmarContent.tsx:55-62
 *   - <AttachEvidence> for COI:                  components/operations/AttachEvidence.tsx
 *   - Date helpers:                              lib/datetime.ts
 *
 * API contract (Phase 4 §7.6):
 *   GET    /api/ops/facilities/:fn/vendors?expiringWithinDays=&page=&limit=
 *   POST   /api/ops/vendors
 *   PUT    /api/ops/vendors/:id
 *   POST   /api/ops/vendors/:id/archive
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
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
import {
  AttachEvidence,
  type AttachEvidenceHandle,
} from "@/components/operations/AttachEvidence";
import { Plus, Building2 } from "lucide-react";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Vendor {
  id: number;
  facilityNumber: string;
  name: string;
  type: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  coiExpires: number | null;
  licenseExpires: number | null;
  notes: string | null;
  status: "active" | "archived";
  createdAt: number;
}

const VENDOR_TYPES = [
  "pharmacy",
  "food",
  "pest",
  "medical",
  "maintenance",
  "linen",
  "other",
];

type FilterPill = "all" | "60" | "30" | "14";

const PAGE_LIMIT = 20;

// ── Helpers ───────────────────────────────────────────────────────────────────

function daysUntil(ms: number | null): number | null {
  if (ms === null) return null;
  return Math.ceil((ms - Date.now()) / (24 * 60 * 60 * 1000));
}

function expiryBadge(ms: number | null) {
  if (ms === null) return null;
  const days = daysUntil(ms)!;
  if (days < 0)
    return {
      label: "Expired",
      cls: "bg-red-100 text-red-700 border-red-200",
    };
  if (days <= 60)
    return {
      label: "Expiring",
      cls: "bg-amber-100 text-amber-700 border-amber-200",
    };
  return {
    label: "Active",
    cls: "bg-emerald-100 text-emerald-700 border-emerald-200",
  };
}

function fmtDate(ms: number | null): string {
  if (ms === null) return "—";
  return new Date(ms).toLocaleDateString();
}

// ── Add Vendor dialog ─────────────────────────────────────────────────────────

interface VendorFormData {
  name: string;
  type: string;
  contactName: string;
  contactPhone: string;
  contactEmail: string;
  coiExpires: string;
  licenseExpires: string;
  notes: string;
}

const EMPTY_VENDOR: VendorFormData = {
  name: "",
  type: "pharmacy",
  contactName: "",
  contactPhone: "",
  contactEmail: "",
  coiExpires: "",
  licenseExpires: "",
  notes: "",
};

function AddVendorDialog({
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
  const [form, setForm] = useState<VendorFormData>(EMPTY_VENDOR);
  const [showErrors, setShowErrors] = useState(false);
  const evidenceRef = useRef<AttachEvidenceHandle | null>(null);

  useEffect(() => {
    if (open) setForm(EMPTY_VENDOR);
  }, [open]);

  const set = <K extends keyof VendorFormData>(key: K, value: VendorFormData[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/ops/vendors`, {
        vendorName: form.name.trim(),
        vendorType: form.type,
        contactName: form.contactName.trim() || undefined,
        contactPhone: form.contactPhone.trim() || undefined,
        contactEmail: form.contactEmail.trim() || undefined,
        coiExpiresAt: form.coiExpires ? toLocalEpochMs(form.coiExpires) : undefined,
        licenseExpiresAt: form.licenseExpires ? toLocalEpochMs(form.licenseExpires) : undefined,
        notes: form.notes.trim() || undefined,
      });
      const json = (await res.json()) as { success: boolean; data: Vendor };
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
        queryKey: [`/api/ops/facilities/${facilityNumber}/vendors`],
      });
      toast({ title: "Vendor added" });
      onOpenChange(false);
      setShowErrors(false);
    },
    onError: (err: Error) => {
      toast({ title: "Couldn't save vendor", description: err.message, variant: "destructive" });
    },
  });

  const errors = {
    name: !form.name.trim() ? "Give the vendor a name" : undefined,
    type: !form.type ? "Pick a vendor type" : undefined,
  };
  const isValid = !errors.name && !errors.type;
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
          <DialogTitle>Add vendor</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField label="Name" required error={showErrors ? errors.name : undefined}>
            <Input
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              placeholder="ABC Pharmacy"
              data-testid="vendor-name"
            />
          </FormField>
          <FormField label="Type" required error={showErrors ? errors.type : undefined}>
            <Select value={form.type} onValueChange={(v) => set("type", v)}>
              <SelectTrigger data-testid="vendor-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VENDOR_TYPES.map((t) => (
                  <SelectItem key={t} value={t} className="capitalize">
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Contact name">
              <Input
                value={form.contactName}
                onChange={(e) => set("contactName", e.target.value)}
              />
            </FormField>
            <FormField label="Contact phone">
              <Input
                value={form.contactPhone}
                onChange={(e) => set("contactPhone", e.target.value)}
                placeholder="(555) 555-5555"
              />
            </FormField>
          </div>
          <FormField label="Contact email">
            <Input
              type="email"
              value={form.contactEmail}
              onChange={(e) => set("contactEmail", e.target.value)}
            />
          </FormField>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="COI expires">
              <Input
                type="date"
                value={form.coiExpires}
                onChange={(e) => set("coiExpires", e.target.value)}
                data-testid="vendor-coi"
              />
            </FormField>
            <FormField label="License expires">
              <Input
                type="date"
                value={form.licenseExpires}
                onChange={(e) => set("licenseExpires", e.target.value)}
              />
            </FormField>
          </div>
          <FormField label="Notes">
            <Textarea
              value={form.notes}
              onChange={(e) => set("notes", e.target.value)}
              className="resize-none min-h-[48px]"
            />
          </FormField>
          <FormField label="Evidence">
            <AttachEvidence
              ref={evidenceRef}
              entityType="ops_vendor"
              entityId={undefined}
              facilityNumber={facilityNumber}
              triggerLabel="Add COI PDF"
            />
          </FormField>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={mutation.isPending} data-testid="vendor-save">
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

export function VendorsContent({ facilityNumber }: { facilityNumber: string }) {
  const [addOpen, setAddOpen] = useState(false);
  const [filter, setFilter] = useState<FilterPill>("all");
  const [limit, setLimit] = useState(PAGE_LIMIT);
  const { toast } = useToast();
  const qc = useQueryClient();

  // Compose query URL — vendors endpoint accepts expiringWithinDays + paging.
  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (filter !== "all") params.set("expiringWithinDays", filter);
    params.set("page", "1");
    params.set("limit", String(limit));
    return `/api/ops/facilities/${facilityNumber}/vendors?${params.toString()}`;
  }, [facilityNumber, filter, limit]);

  const { data, isLoading, error } = useQuery<{ success: boolean; data: Vendor[] } | null>({
    queryKey: [queryUrl],
    queryFn: async () => {
      const res = await fetch(queryUrl, { credentials: "include" });
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const vendors = data?.data ?? [];

  const archiveMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest("POST", `/api/ops/vendors/${id}/archive`);
      return res.json();
    },
    onMutate: async (id: number) => {
      await qc.cancelQueries({ queryKey: [queryUrl] });
      const prev = qc.getQueryData<{ success: boolean; data: Vendor[] }>([queryUrl]);
      if (prev?.data) {
        qc.setQueryData([queryUrl], {
          ...prev,
          data: prev.data.map((v) =>
            v.id === id ? { ...v, status: "archived" as const } : v,
          ),
        });
      }
      return { prev };
    },
    onError: (err: Error, _id, ctx) => {
      if (ctx?.prev) qc.setQueryData([queryUrl], ctx.prev);
      toast({ title: "Couldn't archive", description: err.message, variant: "destructive" });
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: [queryUrl] });
    },
  });

  // Summary (active / expiring60 / expired) computed from current page; if
  // the user filters by 14/30 the active count is informational only.
  const active = vendors.filter((v) => v.status === "active").length;
  const expiring60 = vendors.filter((v) => {
    if (v.status !== "active" || v.coiExpires === null) return false;
    const d = daysUntil(v.coiExpires)!;
    return d >= 0 && d <= 60;
  }).length;
  const expired = vendors.filter((v) => {
    if (v.coiExpires === null) return false;
    return daysUntil(v.coiExpires)! < 0;
  }).length;

  const filterPills: Array<{ key: FilterPill; label: string }> = [
    { key: "all", label: "All" },
    { key: "60", label: "Expiring within 60 days" },
    { key: "30", label: "30 days" },
    { key: "14", label: "14 days" },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-xl font-semibold" style={{ color: "#1E1B4B" }}>
          Vendors
        </h1>
        <Button size="sm" variant="gradient" onClick={() => setAddOpen(true)} data-testid="vendor-add-trigger">
          <Plus className="h-4 w-4 mr-1.5" />
          Add vendor
        </Button>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-lg p-3 text-center" style={{ background: "#F0F4FF", border: "1px solid #E0E7FF" }}>
          <p className="text-xl font-bold portal-num text-emerald-700">{active}</p>
          <p className="text-xs text-muted-foreground">Active</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
          <p className="text-xl font-bold portal-num text-amber-700">{expiring60}</p>
          <p className="text-xs text-amber-700">Expiring (60d)</p>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-center">
          <p className="text-xl font-bold portal-num text-red-700">{expired}</p>
          <p className="text-xs text-red-700">Expired</p>
        </div>
      </div>

      <div className="flex items-center gap-2 flex-wrap" data-testid="vendor-filters">
        {filterPills.map((p) => (
          <button
            key={p.key}
            onClick={() => setFilter(p.key)}
            className={cn(
              "inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all",
              filter === p.key
                ? "bg-gray-900 text-white border-gray-900"
                : "bg-white text-gray-600 border-gray-200 hover:border-gray-400",
            )}
            aria-pressed={filter === p.key}
          >
            {p.label}
          </button>
        ))}
      </div>

      {error && (
        <div
          className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive"
          role="alert"
        >
          Failed to load vendors.
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : vendors.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center" data-testid="vendor-empty">
          <Building2 className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            No vendors yet. Start with your pharmacy and food vendor.
          </p>
          <Button size="sm" variant="gradient" onClick={() => setAddOpen(true)}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add vendor
          </Button>
        </div>
      ) : (
        <>
          <div className="rounded-lg border overflow-hidden" data-testid="vendor-list">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Name</th>
                  <th className="text-left px-4 py-2 font-medium">Type</th>
                  <th className="text-left px-4 py-2 font-medium">COI expiry</th>
                  <th className="text-left px-4 py-2 font-medium">License expiry</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-right px-4 py-2 font-medium">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {vendors.map((v) => {
                  const coiBadge = expiryBadge(v.coiExpires);
                  const days = daysUntil(v.coiExpires);
                  return (
                    <tr key={v.id} className="hover:bg-stone-50/50 transition-colors">
                      <td className="px-4 py-3 font-medium">{v.name}</td>
                      <td className="px-4 py-3">
                        <Badge variant="secondary" className="capitalize text-xs">
                          {v.type}
                        </Badge>
                      </td>
                      <td className="px-4 py-3 portal-num">
                        <div className="flex items-center gap-2">
                          <span>{fmtDate(v.coiExpires)}</span>
                          {coiBadge && (
                            <span
                              className={cn(
                                "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] border capitalize",
                                coiBadge.cls,
                              )}
                            >
                              {coiBadge.label}
                              {coiBadge.label === "Expiring" && days !== null
                                ? ` · ${days}d`
                                : ""}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 portal-num">{fmtDate(v.licenseExpires)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={cn(
                            "inline-flex items-center px-1.5 py-0.5 rounded text-xs border capitalize",
                            v.status === "active"
                              ? "bg-emerald-100 text-emerald-700 border-emerald-200"
                              : "bg-slate-100 text-slate-700 border-slate-200",
                          )}
                        >
                          {v.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        {v.status === "active" && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => archiveMutation.mutate(v.id)}
                            disabled={archiveMutation.isPending}
                            data-testid={`vendor-archive-${v.id}`}
                            aria-label={`Archive ${v.name}`}
                          >
                            Archive
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {vendors.length >= limit && (
            <div className="text-center">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLimit((l) => l + PAGE_LIMIT)}
                data-testid="vendor-load-more"
              >
                Load more
              </Button>
            </div>
          )}
        </>
      )}

      <AddVendorDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        facilityNumber={facilityNumber}
      />
    </div>
  );
}
