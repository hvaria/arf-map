/**
 * <ReportsContent> — Reports Hub (top-level Operations sub-view).
 *
 * Persistent answer to Phase 1 §9 evidence-retrieval pain ("what auditors
 * ask for"). One library row per generated artifact across all kinds
 * (pre-audit pulls, incident summaries, MAR exports, audit trail extracts,
 * monthly trust statements, tracker exports, etc.).
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Page heading + gradient primary action:       ComplianceContent.tsx:654-664
 *   - Summary tile grid + tone palette:             ComplianceContent.tsx:666-683
 *   - Group-by-month list + AddX dialog skeleton:   ComplianceContent.tsx:481-489, 194-477
 *   - `<FormField>` + onSubmitKey:                  components/operations/FormField.tsx
 *   - Status badge tone palette:                    EmarContent.tsx:55-62
 *   - Filter pill bar:                              VendorsContent.tsx (pill row)
 *   - apiRequest / getQueryFn envelope:             client/src/lib/queryClient.ts
 *   - useIsWritable() admin gating:                 context/AuditorContext.tsx:53-56
 *   - Loading skeletons / Empty state:              ComplianceContent.tsx:691-703
 *   - Reports domain (kinds/labels/extensions):     shared/reports.ts
 *
 * 60s staleTime is the default; while any row is `status='generating'` the
 * list refetches every 5s and stops once nothing is still generating (or
 * after the 90s safety timeout per row).
 *
 * API contract (BE in flight):
 *   GET    /api/ops/facilities/:fn/reports?reportKind=&page=&limit=
 *   GET    /api/ops/reports/:id
 *   POST   /api/ops/facilities/:fn/reports/generate { reportKind, ... }
 *   GET    /api/ops/reports/:id/download                # streams w/ Content-Disposition
 *   DELETE /api/ops/reports/:id                         # soft delete
 */
import { useEffect, useMemo, useState } from "react";
import {
  useQuery,
  useMutation,
  useQueryClient,
} from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { FormField, onSubmitKey } from "@/components/operations/FormField";
import {
  Plus,
  FileText,
  Download,
  RefreshCw,
  Trash2,
  ArrowLeft,
  Loader2,
  AlertCircle,
} from "lucide-react";
import { useIsWritable } from "@/context/AuditorContext";
import {
  REPORT_KINDS,
  REPORT_KIND_LABELS,
  REPORT_DEFAULT_RETENTION_DAYS,
  type ReportKind,
  type ReportStatus,
} from "@shared/reports";

// ── Wire shapes ──────────────────────────────────────────────────────────────

export interface ReportRow {
  id: number;
  facilityNumber: string;
  reportKind: ReportKind | string;
  title: string;
  description?: string | null;
  parametersJson?: string | null;
  storageUri?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  byteSize?: number | null;
  sha256?: string | null;
  status: ReportStatus;
  failureReason?: string | null;
  sourceEntityType?: string | null;
  sourceEntityId?: number | null;
  retentionDays?: number | null;
  generatedBy: string;
  generatedAt: number;
  downloadCount: number;
  lastDownloadedAt?: number | null;
  notes?: string | null;
}

interface ReportsListEnvelope {
  success: boolean;
  data: ReportRow[];
}

// Minimal trust-account shape consumed by the monthly_trust_statement picker.
interface TrustAccountRow {
  id: number;
  residentId: number;
  status: string;
  balanceCents: number;
}

interface TrustAccountsEnvelope {
  success: boolean;
  data: TrustAccountRow[];
}

// Minimal resident shape used to label trust-account options.
interface ResidentRow {
  id: number;
  firstName: string;
  lastName: string;
}

interface ResidentsEnvelope {
  success: boolean;
  data: ResidentRow[];
}

// ── Visual tone palette ──────────────────────────────────────────────────────
// Status tones mirror EmarContent.tsx:55-62 (badge shape + tones).

const STATUS_STYLES: Record<ReportStatus, string> = {
  ready: "bg-emerald-100 text-emerald-700 border-emerald-200",
  generating: "bg-amber-100 text-amber-700 border-amber-200",
  failed: "bg-rose-100 text-rose-700 border-rose-200",
  expired: "bg-slate-100 text-slate-600 border-slate-200",
};

const STATUS_LABELS: Record<ReportStatus, string> = {
  ready: "Ready",
  generating: "Generating",
  failed: "Failed",
  expired: "Expired",
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function formatRelative(ms: number | null | undefined): string {
  if (!ms) return "—";
  const diff = Date.now() - ms;
  if (diff < 0) return "in the future";
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.floor(months / 12)}y ago`;
}

function reportTitle(r: ReportRow): string {
  if (r.title && r.title.trim().length > 0) return r.title;
  const kindLabel =
    REPORT_KIND_LABELS[r.reportKind as ReportKind] ?? String(r.reportKind);
  return `${kindLabel} · ${new Date(r.generatedAt).toLocaleDateString()}`;
}

// Group items by month — preserves ComplianceContent.tsx:481-489 pattern.
function groupByMonth(items: ReportRow[]): Record<string, ReportRow[]> {
  return items.reduce<Record<string, ReportRow[]>>((acc, item) => {
    const d = new Date(item.generatedAt);
    const key = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    if (!acc[key]) acc[key] = [];
    acc[key].push(item);
    return acc;
  }, {});
}

// ── Window presets shared with the Generate dialog ───────────────────────────

const WINDOW_PRESETS = [
  { key: "30d", label: "Last 30 days", days: 30 },
  { key: "90d", label: "Last 90 days", days: 90 },
  { key: "6m", label: "Last 6 months", days: 180 },
  { key: "12m", label: "Last 12 months", days: 365 },
  { key: "custom", label: "Custom range…", days: 0 },
];

function daysAgoMs(days: number): number {
  return Date.now() - days * 24 * 60 * 60 * 1000;
}

function isoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function parseLocalDate(value: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

// Which kinds need a window picker for parameters.
const WINDOW_KINDS = new Set<ReportKind>([
  "incident_summary",
  "mar_export",
  "audit_trail",
  "drill_log_export",
  "posting_verification_log",
  "complaint_log",
  "vendor_coi_matrix",
  "chart_completeness_snapshot",
  "credentials_matrix",
]);

// ── Generate Report dialog ───────────────────────────────────────────────────

function GenerateReportDialog({
  open,
  onOpenChange,
  facilityNumber,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  facilityNumber: string;
  onCreated: (row: ReportRow) => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [kind, setKind] = useState<ReportKind | "">("");
  const [titleOverride, setTitleOverride] = useState("");
  const [description, setDescription] = useState("");
  const [retentionDaysOverride, setRetentionDaysOverride] = useState<string>("");

  // Window picker state (used by most kinds).
  const [windowKey, setWindowKey] = useState<string>("90d");
  const [customStart, setCustomStart] = useState<string>(isoDate(daysAgoMs(90)));
  const [customEnd, setCustomEnd] = useState<string>(isoDate(Date.now()));

  // monthly_trust_statement params.
  const [trustAccountId, setTrustAccountId] = useState<string>("");
  const [trustMonth, setTrustMonth] = useState<string>(
    new Date().toISOString().slice(0, 7),
  );

  // tracker_export params.
  const [trackerSlug, setTrackerSlug] = useState<string>("");

  // custom params.
  const [customJson, setCustomJson] = useState<string>("{}");

  const [showErrors, setShowErrors] = useState(false);

  // Trust accounts + residents — fetched only for the trust-statement kind so
  // the picker can show friendly labels instead of asking for a raw account id.
  // Both fail soft (getQueryFn 401 → null) so an errored query degrades to the
  // empty-list guidance rather than crashing the dialog.
  const trustAccountsEnabled = open && kind === "monthly_trust_statement";
  const trustAccountsKey = `/api/ops/facilities/${facilityNumber}/trust/accounts`;
  const trustAccountsQuery = useQuery<TrustAccountsEnvelope | null>({
    queryKey: [trustAccountsKey],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: trustAccountsEnabled && !!facilityNumber,
    staleTime: 60_000,
  });
  // `?limit=100` because the residents list endpoint is paginated and defaults
  // to limit 20 — without this, accounts owned by residents past the first 20
  // silently fall back to the "Account #<id>" label (the trust-accounts
  // endpoint is unpaginated, so the two must match cardinality). 100 is the
  // endpoint's hard cap; a facility with >100 trust-account-holding residents
  // would still hit the fallback, but that's well beyond any realistic ARF.
  //
  // The `?limit=100` is baked into the queryKey (getQueryFn fetches
  // queryKey.join("/") verbatim) so this is INTENTIONALLY a distinct cache
  // entry from the canonical `…/residents` key that useResidents /
  // AdmissionsContent share. Sharing that key here would mean this full-roster
  // read and the default 20-row read would clobber each other depending on
  // mount order; a label-only lookup that needs full cardinality should not
  // depend on (or pollute) the shared 20-row cache.
  const residentsQuery = useQuery<ResidentsEnvelope | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/residents?limit=100`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: trustAccountsEnabled && !!facilityNumber,
    staleTime: 60_000,
  });

  const trustAccounts = trustAccountsQuery.data?.data ?? [];
  const residentNameById = useMemo(() => {
    const map = new Map<number, string>();
    for (const r of residentsQuery.data?.data ?? []) {
      const name = `${r.firstName ?? ""} ${r.lastName ?? ""}`.trim();
      if (name) map.set(r.id, name);
    }
    return map;
  }, [residentsQuery.data]);

  const trustAccountsLoaded =
    trustAccountsEnabled && !trustAccountsQuery.isLoading;
  const trustAccountsEmpty = trustAccountsLoaded && trustAccounts.length === 0;

  const trustAccountLabel = (acc: TrustAccountRow): string => {
    const name = residentNameById.get(acc.residentId);
    const statusLabel = acc.status
      ? acc.status.charAt(0).toUpperCase() + acc.status.slice(1)
      : "Unknown";
    return name ? `${name} — ${statusLabel}` : `Account #${acc.id}`;
  };

  // Reset whenever the dialog re-opens.
  useEffect(() => {
    if (!open) return;
    setKind("");
    setTitleOverride("");
    setDescription("");
    setRetentionDaysOverride("");
    setWindowKey("90d");
    setCustomStart(isoDate(daysAgoMs(90)));
    setCustomEnd(isoDate(Date.now()));
    setTrustAccountId("");
    setTrustMonth(new Date().toISOString().slice(0, 7));
    setTrackerSlug("");
    setCustomJson("{}");
    setShowErrors(false);
  }, [open]);

  // Compute the window param object for the wire.
  const computeWindow = (): { windowStartAt: number; windowEndAt: number } | null => {
    if (windowKey === "custom") {
      const startMs = parseLocalDate(customStart);
      const endMs = parseLocalDate(customEnd);
      if (!startMs || !endMs || startMs >= endMs) return null;
      return { windowStartAt: startMs, windowEndAt: endMs };
    }
    const preset = WINDOW_PRESETS.find((p) => p.key === windowKey);
    const days = preset?.days ?? 90;
    return { windowStartAt: daysAgoMs(days), windowEndAt: Date.now() };
  };

  // Build the parameters payload for the chosen kind.
  const buildParameters = (): Record<string, unknown> | null => {
    if (!kind) return null;
    if (kind === "preaudit_pull") {
      // UX recommends using the PreAuditPullDialog with "Save to library";
      // surface it but allow a basic default.
      const win = computeWindow();
      if (!win) return null;
      return win;
    }
    if (kind === "monthly_trust_statement") {
      const [y, m] = trustMonth.split("-").map(Number);
      if (!y || !m) return null;
      const accId = Number(trustAccountId);
      if (!Number.isFinite(accId) || accId <= 0) return null;
      return {
        accountId: accId,
        year: y,
        month: m,
      };
    }
    if (kind === "tracker_export") {
      if (!trackerSlug) return null;
      const win = computeWindow();
      if (!win) return null;
      return { slug: trackerSlug, ...win, format: "csv" };
    }
    if (kind === "custom") {
      try {
        const parsed = JSON.parse(customJson);
        return typeof parsed === "object" && parsed !== null
          ? (parsed as Record<string, unknown>)
          : { value: parsed };
      } catch {
        return null;
      }
    }
    if (WINDOW_KINDS.has(kind)) {
      const win = computeWindow();
      if (!win) return null;
      return win;
    }
    return {};
  };

  const errors = {
    kind: !kind ? "Pick a report kind" : undefined,
    params: (() => {
      if (!kind) return undefined;
      const params = buildParameters();
      if (params === null) return "Fill out the required parameters";
      return undefined;
    })(),
    retention:
      retentionDaysOverride.trim().length > 0 &&
      (!Number.isFinite(Number(retentionDaysOverride)) ||
        Number(retentionDaysOverride) <= 0)
        ? "Retention must be a positive integer"
        : undefined,
  };
  const isValid = !errors.kind && !errors.params && !errors.retention;

  const mutation = useMutation({
    mutationFn: async () => {
      const parameters = buildParameters();
      if (!kind || parameters === null) throw new Error("Invalid parameters");
      const body: Record<string, unknown> = {
        reportKind: kind,
        parameters,
      };
      if (titleOverride.trim()) body.title = titleOverride.trim();
      if (description.trim()) body.description = description.trim();
      if (retentionDaysOverride.trim()) {
        body.retentionDays = Number(retentionDaysOverride);
      }
      const res = await apiRequest(
        "POST",
        `/api/ops/facilities/${facilityNumber}/reports/generate`,
        body,
      );
      return (await res.json()) as { success: boolean; data: ReportRow };
    },
    onSuccess: (resp) => {
      qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          return (
            typeof k === "string" &&
            k.startsWith(`/api/ops/facilities/${facilityNumber}/reports`)
          );
        },
      });
      onCreated(resp.data);
      if (resp.data.status === "ready") {
        toast({ title: "Report ready — opening download" });
        // Trigger an immediate download.
        triggerDownload(resp.data.id);
      } else {
        toast({
          title: "Report queued",
          description: "It will appear in the library when generation finishes.",
        });
      }
      onOpenChange(false);
    },
    onError: (e: Error) => {
      // Intentionally coupled to the backend TrustDomainError message literal:
      // queryClient surfaces only `error.message`, dropping the structured
      // `code` field, so we have to branch on the human-readable string. A
      // future BE reword of this message would silently break this branch and
      // must update it here too.
      if (e.message === "Trust account not found") {
        // Stale picker selection — the account was closed/moved. Refresh the
        // list so the user can pick a valid one.
        qc.invalidateQueries({ queryKey: [trustAccountsKey] });
        toast({
          title: "Trust account unavailable",
          description:
            "This trust account no longer exists or was moved. Pick another account and try again.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Couldn't generate report",
        description: e.message,
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

  const defaultRetention = kind ? REPORT_DEFAULT_RETENTION_DAYS[kind] : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl max-h-[90vh] overflow-y-auto"
        data-testid="generate-report-dialog"
      >
        <DialogHeader>
          <DialogTitle>Generate report</DialogTitle>
        </DialogHeader>
        <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
          <FormField
            label="Report kind"
            required
            error={showErrors ? errors.kind : undefined}
          >
            <Select
              value={kind || undefined}
              onValueChange={(v) => setKind(v as ReportKind)}
            >
              <SelectTrigger
                aria-label="Report kind"
                data-testid="generate-report-kind"
              >
                <SelectValue placeholder="Select kind…" />
              </SelectTrigger>
              <SelectContent>
                {REPORT_KINDS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {REPORT_KIND_LABELS[k]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>

          {/* Window picker for the common case */}
          {kind && (WINDOW_KINDS.has(kind) || kind === "preaudit_pull") && (
            <>
              <FormField
                label="Window"
                required
                error={showErrors ? errors.params : undefined}
              >
                <Select value={windowKey} onValueChange={setWindowKey}>
                  <SelectTrigger aria-label="Window">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WINDOW_PRESETS.map((p) => (
                      <SelectItem key={p.key} value={p.key}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              {windowKey === "custom" && (
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Start" required>
                    <Input
                      type="date"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                    />
                  </FormField>
                  <FormField label="End" required>
                    <Input
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                    />
                  </FormField>
                </div>
              )}
            </>
          )}

          {/* monthly_trust_statement */}
          {kind === "monthly_trust_statement" &&
            (trustAccountsEmpty ? (
              <p
                className="text-sm text-muted-foreground rounded-md border border-dashed p-3"
                data-testid="generate-report-trust-empty"
              >
                This facility has no resident trust accounts yet. Open one from
                a resident&apos;s profile (Operations &rarr; Residents &rarr;
                select a resident &rarr; Profile tab &rarr; Trust account), then
                generate a monthly statement.
              </p>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                <FormField
                  label="Trust account"
                  required
                  error={showErrors ? errors.params : undefined}
                >
                  <Select
                    value={trustAccountId || undefined}
                    onValueChange={setTrustAccountId}
                    disabled={trustAccountsQuery.isLoading}
                  >
                    <SelectTrigger
                      aria-label="Trust account"
                      data-testid="generate-report-trust-account"
                    >
                      <SelectValue
                        placeholder={
                          trustAccountsQuery.isLoading
                            ? "Loading accounts…"
                            : "Select an account…"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      {trustAccounts.map((acc) => (
                        <SelectItem key={acc.id} value={String(acc.id)}>
                          {trustAccountLabel(acc)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FormField>
                <FormField label="Month" required>
                  <Input
                    type="month"
                    value={trustMonth}
                    onChange={(e) => setTrustMonth(e.target.value)}
                    aria-label="Statement month"
                  />
                </FormField>
              </div>
            ))}

          {/* tracker_export */}
          {kind === "tracker_export" && (
            <>
              <FormField
                label="Tracker"
                required
                error={showErrors ? errors.params : undefined}
              >
                <Select
                  value={trackerSlug || undefined}
                  onValueChange={setTrackerSlug}
                >
                  <SelectTrigger
                    aria-label="Tracker slug"
                    data-testid="generate-report-tracker"
                  >
                    <SelectValue placeholder="Pick a tracker…" />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      "adl",
                      "vitals",
                      "toileting",
                      "hygiene",
                      "skin_check",
                      "seizure",
                      "sleep",
                      "inventory",
                      "cleaning",
                    ].map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              <FormField label="Window" required>
                <Select value={windowKey} onValueChange={setWindowKey}>
                  <SelectTrigger aria-label="Window">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WINDOW_PRESETS.map((p) => (
                      <SelectItem key={p.key} value={p.key}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </FormField>
              {windowKey === "custom" && (
                <div className="grid grid-cols-2 gap-3">
                  <FormField label="Start" required>
                    <Input
                      type="date"
                      value={customStart}
                      onChange={(e) => setCustomStart(e.target.value)}
                    />
                  </FormField>
                  <FormField label="End" required>
                    <Input
                      type="date"
                      value={customEnd}
                      onChange={(e) => setCustomEnd(e.target.value)}
                    />
                  </FormField>
                </div>
              )}
            </>
          )}

          {/* custom */}
          {kind === "custom" && (
            <FormField
              label="Parameters (JSON)"
              required
              error={showErrors ? errors.params : undefined}
              hint="Power-user payload. Server validates the JSON object."
            >
              <Textarea
                value={customJson}
                onChange={(e) => setCustomJson(e.target.value)}
                className="font-mono text-xs min-h-[80px]"
                aria-label="Custom JSON parameters"
              />
            </FormField>
          )}

          <FormField label="Title">
            <Input
              value={titleOverride}
              onChange={(e) => setTitleOverride(e.target.value)}
              placeholder="Optional — auto-generated if empty"
              aria-label="Report title"
            />
          </FormField>

          <FormField label="Description">
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional context for this report"
              className="resize-none min-h-[60px]"
              aria-label="Report description"
            />
          </FormField>

          <FormField
            label="Retention (days)"
            error={showErrors ? errors.retention : undefined}
            hint={
              defaultRetention !== null && defaultRetention !== undefined
                ? `Default for this kind: ${defaultRetention} days`
                : undefined
            }
          >
            <Input
              type="number"
              min={1}
              value={retentionDaysOverride}
              onChange={(e) => setRetentionDaysOverride(e.target.value)}
              placeholder={
                defaultRetention !== null && defaultRetention !== undefined
                  ? String(defaultRetention)
                  : "Default"
              }
              aria-label="Retention days override"
            />
          </FormField>

          <div className="flex gap-2 justify-end pt-1">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              onClick={submit}
              disabled={mutation.isPending}
              data-testid="generate-report-submit"
            >
              {mutation.isPending ? "Generating…" : "Generate"}
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

// ── Download helper ──────────────────────────────────────────────────────────
// The BE responds with `Content-Disposition: attachment` so a plain
// programmatic `<a download>` click triggers the file save.

function triggerDownload(reportId: number): void {
  const url = `/api/ops/reports/${reportId}/download`;
  const a = document.createElement("a");
  a.href = url;
  a.rel = "noopener";
  // The download attribute is a hint; CD header on the server still wins.
  a.setAttribute("download", "");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

// ── ReportsContent ───────────────────────────────────────────────────────────

interface ReportsContentProps {
  facilityNumber: string;
  onBack?: () => void;
  /** Optional initial filter applied via URL deep-link from elsewhere. */
  initialReportId?: number;
}

export function ReportsContent({
  facilityNumber,
  onBack,
  initialReportId,
}: ReportsContentProps) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const isWritable = useIsWritable();

  const [kindFilter, setKindFilter] = useState<ReportKind | "all">("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [generateOpen, setGenerateOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

  // Build the query URL with filters baked in (server-side filter).
  const queryUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (kindFilter !== "all") params.set("reportKind", kindFilter);
    const qs = params.toString();
    return `/api/ops/facilities/${facilityNumber}/reports${qs ? `?${qs}` : ""}`;
  }, [facilityNumber, kindFilter]);

  const listQuery = useQuery<ReportsListEnvelope | null>({
    queryKey: [queryUrl],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000,
    // Poll every 5s while any row is still generating; otherwise no polling.
    refetchInterval: (q) => {
      const data = q.state.data as ReportsListEnvelope | null | undefined;
      const rows = data?.data ?? [];
      const stillGenerating = rows.some((r) => r.status === "generating");
      return stillGenerating ? 5_000 : false;
    },
  });

  const allRows: ReportRow[] = listQuery.data?.data ?? [];

  // Stop polling rows that have been generating for > 90s. We surface a
  // "stuck" badge but the actual transition to `failed` is owned by the BE.
  const STALE_TIMEOUT_MS = 90_000;
  const stillGenerating = allRows.some(
    (r) =>
      r.status === "generating" &&
      Date.now() - r.generatedAt < STALE_TIMEOUT_MS,
  );

  // Apply the client-side search filter on top.
  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allRows;
    return allRows.filter((r) => {
      const title = reportTitle(r).toLowerCase();
      const kindLabel = (
        REPORT_KIND_LABELS[r.reportKind as ReportKind] ?? String(r.reportKind)
      ).toLowerCase();
      const filename = (r.filename ?? "").toLowerCase();
      const generatedBy = (r.generatedBy ?? "").toLowerCase();
      return (
        title.includes(q) ||
        kindLabel.includes(q) ||
        filename.includes(q) ||
        generatedBy.includes(q)
      );
    });
  }, [allRows, search]);

  // Counts driven by the unfiltered list so tiles don't jump as you filter.
  const counts = useMemo(() => {
    const total = allRows.length;
    let ready = 0;
    let generating = 0;
    let failed = 0;
    for (const r of allRows) {
      if (r.status === "ready") ready++;
      else if (r.status === "generating") generating++;
      else if (r.status === "failed") failed++;
    }
    return { total, ready, generating, failed };
  }, [allRows]);

  const sorted = useMemo(
    () => [...filteredRows].sort((a, b) => b.generatedAt - a.generatedAt),
    [filteredRows],
  );
  const grouped = useMemo(() => groupByMonth(sorted), [sorted]);

  // Optionally focus on a deep-linked row.
  useEffect(() => {
    if (!initialReportId) return;
    // Scroll into view once data lands.
    const el = document.querySelector(
      `[data-testid="report-row-${initialReportId}"]`,
    );
    if (el) (el as HTMLElement).scrollIntoView({ behavior: "smooth", block: "center" });
  }, [initialReportId, sorted]);

  // ── Mutations ──────────────────────────────────────────────────────────────

  const regenerateMutation = useMutation({
    mutationFn: async (row: ReportRow) => {
      const params: Record<string, unknown> = (() => {
        try {
          return row.parametersJson ? JSON.parse(row.parametersJson) : {};
        } catch {
          return {};
        }
      })();
      const body: Record<string, unknown> = {
        reportKind: row.reportKind,
        parameters: params,
        title: row.title,
      };
      if (row.description) body.description = row.description;
      if (row.retentionDays) body.retentionDays = row.retentionDays;
      const res = await apiRequest(
        "POST",
        `/api/ops/facilities/${facilityNumber}/reports/generate`,
        body,
      );
      return (await res.json()) as { success: boolean; data: ReportRow };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryUrl] });
      toast({ title: "Regeneration queued" });
    },
    onError: (e: Error) => {
      toast({
        title: "Couldn't regenerate",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiRequest("DELETE", `/api/ops/reports/${id}`);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: [queryUrl] });
      toast({ title: "Report deleted" });
      setConfirmDeleteId(null);
    },
    onError: (e: Error) => {
      toast({
        title: "Couldn't delete",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const handleDownload = (row: ReportRow) => {
    if (row.status !== "ready") return;
    triggerDownload(row.id);
    // Refresh the list shortly so downloadCount / lastDownloadedAt update.
    setTimeout(() => qc.invalidateQueries({ queryKey: [queryUrl] }), 1000);
  };

  const toggleSelected = (id: number) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleBulkDownload = () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    // Naive v0: stagger each download so the browser doesn't drop any.
    ids.forEach((id, i) => {
      setTimeout(() => triggerDownload(id), i * 350);
    });
    toast({
      title: `Downloading ${ids.length} report${ids.length === 1 ? "" : "s"}`,
    });
  };

  // ── Render ─────────────────────────────────────────────────────────────────

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
          Reports
        </h1>
        {isWritable && (
          <Button
            size="sm"
            variant="gradient"
            onClick={() => setGenerateOpen(true)}
            data-testid="generate-report-button"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Generate report
          </Button>
        )}
      </div>

      {/* Summary tile grid — tone palette preserved from ComplianceContent. */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3" data-testid="reports-tiles">
        <div
          className="rounded-lg p-3 text-center"
          style={{ background: "#F0F4FF", border: "1px solid #E0E7FF" }}
        >
          <p className="text-xl font-bold portal-num">{counts.total}</p>
          <p className="text-xs text-muted-foreground">Total</p>
        </div>
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-center">
          <p className="text-xl font-bold text-emerald-700 portal-num">{counts.ready}</p>
          <p className="text-xs text-emerald-700">Ready</p>
        </div>
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-center">
          <p className="text-xl font-bold text-amber-700 portal-num">
            {counts.generating}
          </p>
          <p className="text-xs text-amber-700">Generating</p>
        </div>
        <div className="rounded-lg border border-rose-200 bg-rose-50 p-3 text-center">
          <p className="text-xl font-bold text-rose-700 portal-num">{counts.failed}</p>
          <p className="text-xs text-rose-700">Failed</p>
        </div>
      </div>

      {/* Filter row */}
      <div
        className="flex flex-wrap items-center gap-2"
        data-testid="reports-filters"
      >
        <Select
          value={kindFilter}
          onValueChange={(v) => setKindFilter(v as typeof kindFilter)}
        >
          <SelectTrigger
            className="h-9 w-[180px]"
            aria-label="Filter by report kind"
            data-testid="reports-filter-kind"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All kinds</SelectItem>
            {REPORT_KINDS.map((k) => (
              <SelectItem key={k} value={k}>
                {REPORT_KIND_LABELS[k]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search title, kind, filename…"
          className="h-9 max-w-xs"
          aria-label="Search reports"
          data-testid="reports-search"
        />

        {selectedIds.size > 0 && (
          <Button
            size="sm"
            variant="outline"
            onClick={handleBulkDownload}
            data-testid="reports-bulk-download"
          >
            <Download className="h-3.5 w-3.5 mr-1.5" />
            Download selected ({selectedIds.size})
          </Button>
        )}

        {stillGenerating && (
          <span
            className="inline-flex items-center gap-1 text-[11px] text-amber-700"
            aria-live="polite"
          >
            <Loader2 className="h-3 w-3 animate-spin" />
            Refreshing…
          </span>
        )}
      </div>

      {listQuery.error && (
        <div
          className="rounded-md bg-destructive/10 border border-destructive/30 p-4 text-sm text-destructive"
          role="alert"
        >
          Failed to load reports.
        </div>
      )}

      {listQuery.isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      ) : allRows.length === 0 ? (
        <div
          className="rounded-lg border border-dashed p-10 text-center"
          data-testid="reports-empty"
        >
          <FileText className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground mb-3">
            No reports yet. Generate your first report to start your library.
          </p>
          {isWritable && (
            <Button
              size="sm"
              variant="gradient"
              onClick={() => setGenerateOpen(true)}
              data-testid="reports-empty-cta"
            >
              <Plus className="h-4 w-4 mr-1.5" />
              Generate report
            </Button>
          )}
        </div>
      ) : sorted.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center">
          <p className="text-sm text-muted-foreground">
            No reports match the current filters.
          </p>
        </div>
      ) : (
        <div className="space-y-6" data-testid="reports-list">
          {Object.entries(grouped).map(([month, monthItems]) => (
            <div key={month}>
              <h2 className="text-sm font-medium text-muted-foreground mb-2">
                {month}
              </h2>
              <div className="space-y-2">
                {monthItems.map((row) => {
                  const kindLabel =
                    REPORT_KIND_LABELS[row.reportKind as ReportKind] ??
                    String(row.reportKind);
                  const statusLabel =
                    STATUS_LABELS[row.status] ?? String(row.status);
                  const isReady = row.status === "ready";
                  const isHighlighted = initialReportId === row.id;
                  return (
                    <div
                      key={row.id}
                      data-testid={`report-row-${row.id}`}
                      className={cn(
                        "rounded-lg border p-4 flex items-start gap-3 bg-white",
                        isHighlighted && "ring-2 ring-primary",
                      )}
                    >
                      <Checkbox
                        checked={selectedIds.has(row.id)}
                        onCheckedChange={() => toggleSelected(row.id)}
                        aria-label={`Select report ${row.id}`}
                        className="mt-1"
                        data-testid={`report-select-${row.id}`}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge
                            variant="outline"
                            className="text-[11px] border-stone-300 text-stone-700"
                            data-testid={`report-kind-${row.id}`}
                          >
                            {kindLabel}
                          </Badge>
                          <Badge
                            className={cn(
                              "text-[11px] border",
                              STATUS_STYLES[row.status] ??
                                "bg-stone-100 text-stone-700 border-stone-200",
                            )}
                            aria-label={`Status ${statusLabel}`}
                            data-testid={`report-status-${row.id}`}
                          >
                            {row.status === "generating" && (
                              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                            )}
                            {row.status === "failed" && (
                              <AlertCircle className="h-3 w-3 mr-1" />
                            )}
                            {statusLabel}
                          </Badge>
                        </div>
                        <p className="text-sm font-medium mt-1 truncate">
                          {reportTitle(row)}
                        </p>
                        {row.description && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                            {row.description}
                          </p>
                        )}
                        {row.status === "failed" && row.failureReason && (
                          <p className="text-xs text-rose-700 mt-1" role="alert">
                            {row.failureReason}
                          </p>
                        )}
                        <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground flex-wrap">
                          <span>{formatBytes(row.byteSize)}</span>
                          <span>·</span>
                          <span>
                            {row.downloadCount} download
                            {row.downloadCount === 1 ? "" : "s"}
                          </span>
                          {row.lastDownloadedAt && (
                            <>
                              <span>·</span>
                              <span>
                                last {formatRelative(row.lastDownloadedAt)}
                              </span>
                            </>
                          )}
                          <span>·</span>
                          <span>by {row.generatedBy}</span>
                          <span>·</span>
                          <span>
                            generated {formatRelative(row.generatedAt)}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 shrink-0">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() => handleDownload(row)}
                          disabled={!isReady}
                          aria-disabled={!isReady}
                          aria-label="Download report"
                          data-testid={`report-download-${row.id}`}
                        >
                          <Download className="h-3.5 w-3.5 mr-1" />
                          Download
                        </Button>
                        {isWritable && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0"
                            onClick={() => regenerateMutation.mutate(row)}
                            disabled={regenerateMutation.isPending}
                            aria-label="Regenerate report"
                            title="Regenerate"
                            data-testid={`report-regenerate-${row.id}`}
                          >
                            <RefreshCw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                        {isWritable && (
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 w-8 p-0 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                            onClick={() => setConfirmDeleteId(row.id)}
                            aria-label="Delete report"
                            title="Delete"
                            data-testid={`report-delete-${row.id}`}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
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

      {/* Generate dialog */}
      <GenerateReportDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        facilityNumber={facilityNumber}
        onCreated={() => {
          /* invalidate happens inside the dialog; nothing else to do here */
        }}
      />

      {/* Delete confirmation */}
      <Dialog
        open={confirmDeleteId !== null}
        onOpenChange={(v) => !v && setConfirmDeleteId(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete report?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This soft-deletes the report. The file is retained for the
            configured retention period but the entry is hidden from the
            library.
          </p>
          <div className="flex gap-2 justify-end pt-2">
            <Button
              variant="outline"
              onClick={() => setConfirmDeleteId(null)}
              disabled={deleteMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() =>
                confirmDeleteId !== null &&
                deleteMutation.mutate(confirmDeleteId)
              }
              disabled={deleteMutation.isPending}
              data-testid="report-delete-confirm"
            >
              {deleteMutation.isPending ? "Deleting…" : "Delete"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
