/**
 * <PreAuditPullDialog> — Wave 3 Phase 3.2 (W2 one-click pre-audit pull).
 *
 * Lets an admin assemble a pre-audit bundle for a chosen audience + window
 * + section list, then either download it as JSON or hand it off as a
 * read-only share-link. Mirrors the same auditor section catalogue used
 * server-side (single source of truth in shared/auditor.ts).
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Dialog skeleton + FormField + onSubmitKey:
 *       client/src/components/operations/AddTaskDialog.tsx:35-226
 *   - useMutation + invalidate + toast:
 *       client/src/components/operations/AddTaskDialog.tsx:73-113
 *   - useQuery for an active list:
 *       client/src/components/operations/AuditTrailViewer.tsx:262-294
 *   - Audience select + copy-link affordance:
 *       client/src/components/operations/ShareWithInspectorDialog.tsx
 *
 * API contract:
 *   POST  /api/ops/facilities/:fn/preaudit-pull
 *   GET   /api/ops/facilities/:fn/preaudit-pulls?page=&limit=
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { FormField, onSubmitKey } from "@/components/operations/FormField";
import { Copy, Download } from "lucide-react";
import {
  AUDITOR_AUDIENCES,
  AUDITOR_AUDIENCE_LABELS,
  PREAUDIT_SECTIONS,
  PREAUDIT_SECTION_LABELS,
  DEFAULT_SHARE_LINK_DURATION_DAYS,
  buildAuditorViewerUrl,
  type AuditorAudience,
  type PreauditSection,
  type PreauditPullResult,
  type DeliveryMethod,
} from "@shared/auditor";

// ── Duration presets (mirrors ShareWithInspectorDialog) ──────────────────────

const DURATION_PRESETS = [
  { key: "24h", label: "24 hours", days: 1 },
  { key: "3d", label: "3 days", days: 3 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "14d", label: "14 days", days: 14 },
];

// ── Window presets ───────────────────────────────────────────────────────────

const WINDOW_PRESETS = [
  { key: "6m", label: "Last 6 months", months: 6 },
  { key: "12m", label: "Last 12 months", months: 12 },
  { key: "custom", label: "Custom range…", months: 0 },
];

// ── Wire shapes ──────────────────────────────────────────────────────────────

interface PreauditPullResponse {
  success: boolean;
  data: PreauditPullResult & { deliveryMethod: DeliveryMethod };
}

interface RecentPullRow {
  id: number;
  audience: AuditorAudience;
  audienceLabel: string | null;
  windowStartAt: number;
  windowEndAt: number;
  deliveryMethod: DeliveryMethod;
  generatedAt: number;
  generatedBy: string;
  shareLinkId: number | null;
}

interface ListPullsResponse {
  success: boolean;
  data: RecentPullRow[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function monthsAgoMs(months: number): number {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return d.getTime();
}

function isoDate(ms: number): string {
  // YYYY-MM-DD shape suitable for an <input type="date"> value.
  return new Date(ms).toISOString().slice(0, 10);
}

function parseLocalDate(value: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(`${value}T00:00:00`).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

// The pre-audit pull is materialized server-side as a PDF report row; we
// download it via the Reports streaming endpoint (Content-Disposition wins)
// rather than building a client-side file. A plain `<a download>` click is
// all that's needed.
function triggerReportDownload(reportId: number): void {
  const a = document.createElement("a");
  a.href = `/api/ops/reports/${reportId}/download`;
  a.rel = "noopener";
  a.setAttribute("download", "");
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function fmtRelativeFuture(ms: number): string {
  const diff = ms - Date.now();
  if (diff <= 0) return "expired";
  const hours = Math.round(diff / 3_600_000);
  if (hours < 1) return "expires soon";
  if (hours < 24) return `in ${hours}h`;
  const days = Math.round(hours / 24);
  return `in ${days}d`;
}

// ── Component ────────────────────────────────────────────────────────────────

export function PreAuditPullDialog({
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

  const [audience, setAudience] = useState<AuditorAudience>("cdss");
  const [windowKey, setWindowKey] = useState<string>("6m");
  const [customStart, setCustomStart] = useState<string>(
    isoDate(monthsAgoMs(6)),
  );
  const [customEnd, setCustomEnd] = useState<string>(isoDate(Date.now()));
  const [sections, setSections] = useState<Record<PreauditSection, boolean>>(
    () => {
      const all: Record<PreauditSection, boolean> = {} as Record<
        PreauditSection,
        boolean
      >;
      PREAUDIT_SECTIONS.forEach((s) => {
        all[s] = true;
      });
      return all;
    },
  );
  const [delivery, setDelivery] = useState<DeliveryMethod>("download");
  const [shareDurationKey, setShareDurationKey] = useState<string>("7d");
  const [showErrors, setShowErrors] = useState(false);
  const [generated, setGenerated] = useState<
    (PreauditPullResult & { deliveryMethod: DeliveryMethod }) | null
  >(null);
  // Wave 5 — opt-in to mirror this pull into the Reports library so the
  // artifact persists for audit retrieval even after the share-link expires
  // or the download folder is cleared. Default ON; the BE materializes a
  // row when `saveToReports` is truthy and surfaces `savedReportId` in the
  // response so we can deep-link to the library.
  const [saveToReports, setSaveToReports] = useState<boolean>(true);
  const [savedReportId, setSavedReportId] = useState<number | null>(null);

  // Reset whenever the dialog re-opens.
  useEffect(() => {
    if (!open) return;
    setAudience("cdss");
    setWindowKey("6m");
    setCustomStart(isoDate(monthsAgoMs(6)));
    setCustomEnd(isoDate(Date.now()));
    setDelivery("download");
    setShareDurationKey("7d");
    setShowErrors(false);
    setGenerated(null);
    setSaveToReports(true);
    setSavedReportId(null);
    const all: Record<PreauditSection, boolean> = {} as Record<
      PreauditSection,
      boolean
    >;
    PREAUDIT_SECTIONS.forEach((s) => {
      all[s] = true;
    });
    setSections(all);
  }, [open]);

  const recentPullsKey = `/api/ops/facilities/${facilityNumber}/preaudit-pulls?page=1&limit=5`;
  const recentPullsQ = useQuery<ListPullsResponse | null>({
    queryKey: [recentPullsKey],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: open && !!facilityNumber,
    staleTime: 30_000,
  });

  const selectedSections: PreauditSection[] = useMemo(
    () => PREAUDIT_SECTIONS.filter((s) => sections[s]),
    [sections],
  );

  const computeWindow = (): { startMs?: number; endMs?: number } => {
    if (windowKey === "custom") {
      return {
        startMs: parseLocalDate(customStart),
        endMs: parseLocalDate(customEnd),
      };
    }
    const preset = WINDOW_PRESETS.find((p) => p.key === windowKey);
    const months = preset?.months ?? 6;
    return { startMs: monthsAgoMs(months), endMs: Date.now() };
  };

  const errors = {
    sections:
      selectedSections.length === 0 ? "Pick at least one section" : undefined,
    window:
      (() => {
        const { startMs, endMs } = computeWindow();
        if (!startMs || !endMs) return "Pick a valid window";
        if (startMs >= endMs) return "Start must be before end";
        return undefined;
      })(),
  };

  const isValid = !errors.sections && !errors.window;

  const mutation = useMutation({
    mutationFn: async () => {
      const { startMs, endMs } = computeWindow();
      if (!startMs || !endMs) throw new Error("Invalid window");
      const body: Record<string, unknown> = {
        audience,
        windowStartAt: startMs,
        windowEndAt: endMs,
        sections: selectedSections,
        deliveryMethod: delivery,
        // The "download" delivery hands back a server-rendered PDF, which is
        // the persisted report row — so a download always materializes one
        // (regardless of the share_link-only "save to library" toggle below).
        saveToReports: delivery === "download" ? true : saveToReports,
      };
      if (delivery === "share_link") {
        const preset =
          DURATION_PRESETS.find((p) => p.key === shareDurationKey) ??
          DURATION_PRESETS[2];
        body.shareDurationDays = preset.days;
      }
      const res = await apiRequest(
        "POST",
        `/api/ops/facilities/${facilityNumber}/preaudit-pull`,
        body,
      );
      return (await res.json()) as PreauditPullResponse;
    },
    onSuccess: (resp) => {
      const result = resp.data as PreauditPullResult & {
        deliveryMethod: DeliveryMethod;
        reportId?: number | null;
      };
      setGenerated(result);
      // The pull is persisted as a PDF report row (always for download,
      // opt-in for share_link). Capture its id for the in-dialog deep-link
      // and trigger the PDF download.
      const reportId = result.reportId ?? null;
      if (reportId) {
        setSavedReportId(reportId);
        void qc.invalidateQueries({
          predicate: (q) => {
            const k = q.queryKey[0];
            return (
              typeof k === "string" &&
              k.startsWith(`/api/ops/facilities/${facilityNumber}/reports`)
            );
          },
        });
      }
      toast({ title: "Pre-audit pull generated" });
      void qc.invalidateQueries({
        predicate: (q) => {
          const k = q.queryKey[0];
          if (typeof k !== "string") return false;
          return (
            k.startsWith(`/api/ops/facilities/${facilityNumber}/preaudit-pulls`) ||
            k.startsWith(`/api/ops/facilities/${facilityNumber}/share-links`)
          );
        },
      });

      if (result.deliveryMethod === "download") {
        if (reportId) {
          triggerReportDownload(reportId);
        } else {
          toast({
            title: "Pull saved, but the PDF export didn't finish",
            description: "Open it from the Reports library to retry.",
            variant: "destructive",
          });
        }
      }
    },
    onError: (e: Error) => {
      toast({
        title: "Couldn't generate pull",
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

  const viewerUrl = useMemo(() => {
    if (!generated?.shareToken) return "";
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    return buildAuditorViewerUrl(origin, generated.shareToken);
  }, [generated]);

  const copyLink = async () => {
    if (!viewerUrl) return;
    try {
      await navigator.clipboard.writeText(viewerUrl);
      toast({ title: "Link copied" });
    } catch {
      toast({
        title: "Couldn't copy link",
        description: "Copy the URL manually from the input.",
        variant: "destructive",
      });
    }
  };

  const allChecked = selectedSections.length === PREAUDIT_SECTIONS.length;
  const noneChecked = selectedSections.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-xl max-h-[90vh] overflow-y-auto"
        data-testid="preaudit-pull-dialog"
      >
        <DialogHeader>
          <DialogTitle>
            {generated ? "Pre-audit pull ready" : "Pre-audit pull"}
          </DialogTitle>
        </DialogHeader>

        {generated ? (
          <div className="space-y-4">
            {generated.deliveryMethod === "download" ? (
              <div className="rounded-lg border bg-emerald-50 border-emerald-200 p-3">
                <p className="text-xs text-emerald-700 mb-1.5 font-medium">
                  <Download className="h-3.5 w-3.5 inline mr-1" />
                  PDF downloaded
                </p>
                <p className="text-[11px] text-emerald-700">
                  Your browser saved the PDF. Check your Downloads folder.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border bg-emerald-50 border-emerald-200 p-3">
                <p className="text-xs text-emerald-700 mb-1.5 font-medium">
                  Share link generated
                </p>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={viewerUrl}
                    aria-label="Share link URL"
                    data-testid="preaudit-pull-url"
                    className="font-mono text-xs bg-white"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    type="button"
                    size="sm"
                    variant="gradient"
                    onClick={copyLink}
                    data-testid="preaudit-pull-copy"
                    aria-label="Copy share link"
                  >
                    <Copy className="h-4 w-4 mr-1.5" />
                    Copy
                  </Button>
                </div>
              </div>
            )}

            {savedReportId !== null && (
              <div
                className="rounded-lg border bg-emerald-50 border-emerald-200 p-3"
                data-testid="preaudit-pull-saved-report"
              >
                <p className="text-xs text-emerald-700 mb-1 font-medium">
                  Saved to library (id #{savedReportId})
                </p>
                <a
                  href={`#/facility-portal?ops=reports&reportId=${savedReportId}`}
                  className="text-xs text-emerald-800 underline hover:no-underline"
                  data-testid="preaudit-pull-open-in-reports"
                >
                  Open in Reports library →
                </a>
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-muted-foreground mb-1.5">
                Totals
              </p>
              <ul className="space-y-1 text-xs">
                {(Object.keys(generated.totals) as PreauditSection[]).map(
                  (section) => {
                    const t = generated.totals[section];
                    return (
                      <li
                        key={section}
                        className="flex items-center justify-between gap-2 rounded border bg-white p-1.5"
                        data-testid={`preaudit-pull-total-${section}`}
                      >
                        <span className="truncate">
                          {PREAUDIT_SECTION_LABELS[section]}
                        </span>
                        <span className="portal-num font-medium">
                          {t.included}
                          {t.excluded > 0 ? (
                            <span className="text-muted-foreground ml-1">
                              ({t.excluded} excluded)
                            </span>
                          ) : null}
                        </span>
                      </li>
                    );
                  },
                )}
              </ul>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
            <FormField label="Audience" required>
              <Select
                value={audience}
                onValueChange={(v) => setAudience(v as AuditorAudience)}
              >
                <SelectTrigger
                  aria-label="Pull audience"
                  data-testid="preaudit-pull-audience"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {AUDITOR_AUDIENCES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {AUDITOR_AUDIENCE_LABELS[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </FormField>

            <FormField
              label="Window"
              required
              error={showErrors ? errors.window : undefined}
            >
              <Select value={windowKey} onValueChange={setWindowKey}>
                <SelectTrigger
                  aria-label="Pull window"
                  data-testid="preaudit-pull-window"
                >
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
                    data-testid="preaudit-pull-start"
                  />
                </FormField>
                <FormField label="End" required>
                  <Input
                    type="date"
                    value={customEnd}
                    onChange={(e) => setCustomEnd(e.target.value)}
                    data-testid="preaudit-pull-end"
                  />
                </FormField>
              </div>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-sm font-medium">Sections</p>
                <div className="flex gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => {
                      const all: Record<PreauditSection, boolean> = {} as Record<
                        PreauditSection,
                        boolean
                      >;
                      PREAUDIT_SECTIONS.forEach((s) => {
                        all[s] = true;
                      });
                      setSections(all);
                    }}
                    disabled={allChecked}
                    className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                    data-testid="preaudit-pull-select-all"
                  >
                    Select all
                  </button>
                  <span className="text-muted-foreground">·</span>
                  <button
                    type="button"
                    onClick={() => {
                      const none: Record<PreauditSection, boolean> = {} as Record<
                        PreauditSection,
                        boolean
                      >;
                      PREAUDIT_SECTIONS.forEach((s) => {
                        none[s] = false;
                      });
                      setSections(none);
                    }}
                    disabled={noneChecked}
                    className="text-primary hover:underline disabled:text-muted-foreground disabled:no-underline"
                    data-testid="preaudit-pull-deselect-all"
                  >
                    Deselect all
                  </button>
                </div>
              </div>
              <ul
                className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 rounded-md border p-2"
                data-testid="preaudit-pull-sections"
              >
                {PREAUDIT_SECTIONS.map((s) => (
                  <li
                    key={s}
                    className="flex items-start gap-2 text-xs leading-tight"
                  >
                    <Checkbox
                      id={`preaudit-section-${s}`}
                      checked={!!sections[s]}
                      onCheckedChange={(v) =>
                        setSections((prev) => ({ ...prev, [s]: v === true }))
                      }
                      data-testid={`preaudit-pull-section-${s}`}
                      aria-label={PREAUDIT_SECTION_LABELS[s]}
                    />
                    <label
                      htmlFor={`preaudit-section-${s}`}
                      className="select-none cursor-pointer pt-0.5"
                    >
                      {PREAUDIT_SECTION_LABELS[s]}
                    </label>
                  </li>
                ))}
              </ul>
              {showErrors && errors.sections && (
                <p className="text-[11px] text-red-600 mt-1" role="alert">
                  {errors.sections}
                </p>
              )}
            </div>

            {/* For a download, the PDF *is* the persisted report row, so it's
                always saved — this opt-in only applies to the share-link flow. */}
            {delivery === "share_link" && (
              <label
                className="flex items-start gap-2 rounded-md border bg-stone-50 p-2.5 text-xs cursor-pointer"
                data-testid="preaudit-pull-save-to-reports"
              >
                <Checkbox
                  checked={saveToReports}
                  onCheckedChange={(v) => setSaveToReports(v === true)}
                  aria-label="Save to reports library"
                  className="mt-0.5"
                />
                <span>
                  <span className="font-medium block">Save to reports library</span>
                  <span className="text-muted-foreground">
                    Mirror this pull into the Reports hub so auditors can retrieve
                    it later, even after a share-link expires.
                  </span>
                </span>
              </label>
            )}

            <fieldset className="rounded-md border p-2.5 space-y-1.5">
              <legend className="text-xs font-medium text-muted-foreground px-1">
                Delivery
              </legend>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="preaudit-delivery"
                  value="download"
                  checked={delivery === "download"}
                  onChange={() => setDelivery("download")}
                  data-testid="preaudit-pull-delivery-download"
                />
                Download PDF
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="preaudit-delivery"
                  value="share_link"
                  checked={delivery === "share_link"}
                  onChange={() => setDelivery("share_link")}
                  data-testid="preaudit-pull-delivery-share"
                />
                Generate share link
              </label>
              {delivery === "share_link" && (
                <div className="pt-1">
                  <FormField label="Link duration" required>
                    <Select
                      value={shareDurationKey}
                      onValueChange={setShareDurationKey}
                    >
                      <SelectTrigger
                        aria-label="Share link duration"
                        data-testid="preaudit-pull-share-duration"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DURATION_PRESETS.map((p) => (
                          <SelectItem key={p.key} value={p.key}>
                            {p.label}
                            {p.days === DEFAULT_SHARE_LINK_DURATION_DAYS
                              ? " (default)"
                              : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </FormField>
                </div>
              )}
            </fieldset>

            <div className="flex gap-2 justify-end pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={mutation.isPending}
                data-testid="preaudit-pull-submit"
              >
                {mutation.isPending ? "Generating…" : "Generate"}
              </Button>
            </div>

            <div className="border-t pt-3">
              <RecentPullsList
                rows={recentPullsQ.data?.data ?? []}
                isLoading={recentPullsQ.isLoading}
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Recent pulls sub-list ────────────────────────────────────────────────────

function RecentPullsList({
  rows,
  isLoading,
}: {
  rows: RecentPullRow[];
  isLoading: boolean;
}) {
  return (
    <div data-testid="preaudit-pull-recent-list">
      <p className="text-xs font-medium text-muted-foreground mb-2">
        Recent pulls
      </p>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-full rounded-md" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-center">
          <p className="text-xs text-muted-foreground">No pulls yet.</p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((r) => (
            <li
              key={r.id}
              className="rounded-md border bg-white p-2 text-xs"
              data-testid={`preaudit-pull-recent-row-${r.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium truncate">
                  {AUDITOR_AUDIENCE_LABELS[r.audience]}
                  {r.audienceLabel ? ` — ${r.audienceLabel}` : ""}
                </span>
                <span className="text-[10px] text-muted-foreground">
                  {new Date(r.generatedAt).toLocaleDateString()}
                </span>
              </div>
              <p className="text-[10px] text-muted-foreground mt-0.5">
                {new Date(r.windowStartAt).toLocaleDateString()} —{" "}
                {new Date(r.windowEndAt).toLocaleDateString()}
                {" · "}
                {r.deliveryMethod === "download" ? "downloaded" : "shared"}
                {" · "}
                {r.generatedBy}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Re-export the future-relative helper so the surrounding shell can use it.
export { fmtRelativeFuture };
