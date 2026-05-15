/**
 * <ShareWithInspectorDialog> — Wave 3 Phase 3.2.
 *
 * Mints a read-only auditor share-link scoped to Audit Readiness. The
 * admin picks an audience tag + duration; the server returns a token and
 * an absolute viewer URL of the form `/#/auditor/{token}`. The dialog
 * then flips to a success layout with a copy-link affordance and a list
 * of currently-active links the admin can revoke.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Dialog skeleton + onSubmitKey + FormField:
 *       client/src/components/operations/AddTaskDialog.tsx:35-226
 *   - useMutation + invalidate + toast pattern:
 *       client/src/components/operations/AddTaskDialog.tsx:73-113
 *   - useQuery for an active list:
 *       client/src/components/operations/AuditTrailViewer.tsx:262-294
 *   - Tone palette for action chips:
 *       client/src/components/operations/AuditTrailViewer.tsx:87-97
 *
 * Reuses shared/auditor.ts for the audience enum + viewer-URL helper —
 * single source of truth shared with the server.
 *
 * API contract:
 *   POST   /api/ops/facilities/:fn/share-links
 *   GET    /api/ops/facilities/:fn/share-links?includeRevoked=&includeExpired=
 *   POST   /api/ops/share-links/:id/revoke
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
import { Copy, ExternalLink, Trash2 } from "lucide-react";
import {
  AUDITOR_AUDIENCES,
  AUDITOR_AUDIENCE_LABELS,
  DEFAULT_SHARE_LINK_DURATION_DAYS,
  buildAuditorViewerUrl,
  type AuditorAudience,
} from "@shared/auditor";

// ── Duration presets (server clamps to allowed range) ────────────────────────

interface DurationPreset {
  key: string;
  label: string;
  days: number; // fractional supported for sub-day windows
}

const DURATION_PRESETS: DurationPreset[] = [
  { key: "4h", label: "4 hours", days: 4 / 24 },
  { key: "24h", label: "24 hours", days: 1 },
  { key: "3d", label: "3 days", days: 3 },
  { key: "7d", label: "7 days", days: 7 },
  { key: "14d", label: "14 days", days: 14 },
];

const DEFAULT_PRESET_KEY = "7d";

// ── Wire shapes ──────────────────────────────────────────────────────────────

interface CreateShareLinkResponse {
  success: boolean;
  data: {
    id: number;
    token: string;
    expiresAt: number;
    scope: string;
    audience: AuditorAudience;
    audienceLabel?: string | null;
  };
}

interface ShareLinkRow {
  id: number;
  token: string;
  scope: string;
  audience: AuditorAudience;
  audienceLabel: string | null;
  expiresAt: number;
  createdAt: number;
  revokedAt: number | null;
  lastVisitAt: number | null;
  visitCount: number;
}

interface ListShareLinksResponse {
  success: boolean;
  data: ShareLinkRow[];
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtAbsolute(ms: number): string {
  return new Date(ms).toLocaleString();
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

export function ShareWithInspectorDialog({
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
  const [audienceLabel, setAudienceLabel] = useState("");
  const [presetKey, setPresetKey] = useState<string>(DEFAULT_PRESET_KEY);
  const [showErrors, setShowErrors] = useState(false);
  const [created, setCreated] = useState<CreateShareLinkResponse["data"] | null>(
    null,
  );

  // Reset form whenever the dialog re-opens — keep the next session clean.
  useEffect(() => {
    if (!open) return;
    setAudience("cdss");
    setAudienceLabel("");
    setPresetKey(DEFAULT_PRESET_KEY);
    setShowErrors(false);
    setCreated(null);
  }, [open]);

  const activeLinksKey = `/api/ops/facilities/${facilityNumber}/share-links`;
  const activeLinksQ = useQuery<ListShareLinksResponse | null>({
    queryKey: [activeLinksKey],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: open && !!facilityNumber,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: async () => {
      const preset =
        DURATION_PRESETS.find((p) => p.key === presetKey) ??
        DURATION_PRESETS.find((p) => p.key === DEFAULT_PRESET_KEY)!;
      const body: Record<string, unknown> = {
        audience,
        durationDays: preset.days,
      };
      const trimmedLabel = audienceLabel.trim();
      if (trimmedLabel) body.audienceLabel = trimmedLabel;
      const res = await apiRequest(
        "POST",
        `/api/ops/facilities/${facilityNumber}/share-links`,
        body,
      );
      return (await res.json()) as CreateShareLinkResponse;
    },
    onSuccess: (resp) => {
      setCreated(resp.data);
      toast({ title: "Share link created" });
      void qc.invalidateQueries({ queryKey: [activeLinksKey] });
    },
    onError: (e: Error) => {
      toast({
        title: "Couldn't create share link",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const revokeMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await apiRequest(
        "POST",
        `/api/ops/share-links/${id}/revoke`,
      );
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Link revoked" });
      void qc.invalidateQueries({ queryKey: [activeLinksKey] });
    },
    onError: (e: Error) => {
      toast({
        title: "Couldn't revoke link",
        description: e.message,
        variant: "destructive",
      });
    },
  });

  const audienceError = !audience ? "Pick an audience" : undefined;
  const isValid = !audienceError;
  const submit = () => {
    if (!isValid || createMutation.isPending) {
      setShowErrors(true);
      return;
    }
    createMutation.mutate();
  };

  const viewerUrl = useMemo(() => {
    if (!created) return "";
    const origin =
      typeof window !== "undefined" ? window.location.origin : "";
    return buildAuditorViewerUrl(origin, created.token);
  }, [created]);

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

  const activeLinks = (activeLinksQ.data?.data ?? []).filter(
    (l) => l.revokedAt === null && l.expiresAt > Date.now(),
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid="share-inspector-dialog">
        <DialogHeader>
          <DialogTitle>
            {created ? "Share link ready" : "Share with inspector"}
          </DialogTitle>
        </DialogHeader>

        {created ? (
          <div className="space-y-4">
            <div className="rounded-lg border bg-emerald-50 border-emerald-200 p-3">
              <p className="text-xs text-emerald-700 mb-1.5 font-medium">
                Send this URL to your inspector
              </p>
              <div className="flex items-center gap-2">
                <Input
                  readOnly
                  value={viewerUrl}
                  aria-label="Share link URL"
                  data-testid="share-inspector-url"
                  className="font-mono text-xs bg-white"
                  onFocus={(e) => e.currentTarget.select()}
                />
                <Button
                  type="button"
                  size="sm"
                  variant="gradient"
                  onClick={copyLink}
                  data-testid="share-inspector-copy"
                  aria-label="Copy share link"
                >
                  <Copy className="h-4 w-4 mr-1.5" />
                  Copy
                </Button>
              </div>
              <p className="text-[11px] text-emerald-700 mt-2">
                Expires {fmtRelativeFuture(created.expiresAt)} ·{" "}
                {fmtAbsolute(created.expiresAt)}
              </p>
            </div>

            <div className="rounded-md border border-stone-200 bg-stone-50 p-3 text-xs text-stone-700">
              This link is <strong>read-only</strong>. Every visit is logged,
              and you can revoke it any time from the list below.
            </div>

            <ActiveLinksList
              links={activeLinks}
              isLoading={activeLinksQ.isLoading}
              onRevoke={(id) => revokeMutation.mutate(id)}
              isRevokingId={
                revokeMutation.isPending
                  ? (revokeMutation.variables as number | undefined)
                  : undefined
              }
            />

            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3" onKeyDown={onSubmitKey(submit)}>
            <FormField
              label="Audience"
              required
              error={showErrors ? audienceError : undefined}
            >
              <Select
                value={audience}
                onValueChange={(v) => setAudience(v as AuditorAudience)}
              >
                <SelectTrigger
                  aria-label="Inspector audience"
                  data-testid="share-inspector-audience"
                >
                  <SelectValue placeholder="Pick an audience" />
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
              label="Audience label"
              hint='Optional free text — e.g. "A. Garcia, CCLD Analyst"'
            >
              <Input
                value={audienceLabel}
                onChange={(e) => setAudienceLabel(e.target.value)}
                placeholder="Name + title (optional)"
                data-testid="share-inspector-label"
              />
            </FormField>

            <FormField label="Duration" required>
              <Select value={presetKey} onValueChange={setPresetKey}>
                <SelectTrigger
                  aria-label="Link duration"
                  data-testid="share-inspector-duration"
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

            <p className="text-[11px] text-muted-foreground">
              The link is scoped to Audit Readiness and is read-only. Every
              visit is logged in your audit trail.
            </p>

            <div className="flex gap-2 justify-end pt-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button
                onClick={submit}
                disabled={createMutation.isPending}
                data-testid="share-inspector-submit"
              >
                {createMutation.isPending ? "Creating…" : "Create link"}
              </Button>
            </div>

            <div className="border-t pt-3">
              <ActiveLinksList
                links={activeLinks}
                isLoading={activeLinksQ.isLoading}
                onRevoke={(id) => revokeMutation.mutate(id)}
                isRevokingId={
                  revokeMutation.isPending
                    ? (revokeMutation.variables as number | undefined)
                    : undefined
                }
              />
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Active links sub-list ────────────────────────────────────────────────────

function ActiveLinksList({
  links,
  isLoading,
  onRevoke,
  isRevokingId,
}: {
  links: ShareLinkRow[];
  isLoading: boolean;
  onRevoke: (id: number) => void;
  isRevokingId?: number;
}) {
  return (
    <div data-testid="share-inspector-active-list">
      <p className="text-xs font-medium text-muted-foreground mb-2">
        Active share links
      </p>
      {isLoading ? (
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full rounded-md" />
          ))}
        </div>
      ) : links.length === 0 ? (
        <div className="rounded-md border border-dashed p-3 text-center">
          <p className="text-xs text-muted-foreground">
            No active share links.
          </p>
        </div>
      ) : (
        <ul className="space-y-1.5">
          {links.map((l) => (
            <li
              key={l.id}
              className="rounded-md border bg-white p-2 flex items-center justify-between gap-2"
              data-testid={`share-inspector-row-${l.id}`}
            >
              <div className="min-w-0">
                <p className="text-xs font-medium truncate">
                  {AUDITOR_AUDIENCE_LABELS[l.audience]}
                  {l.audienceLabel ? ` — ${l.audienceLabel}` : ""}
                </p>
                <p className="text-[10px] text-muted-foreground">
                  Expires {fmtRelativeFuture(l.expiresAt)}
                  {" · "}
                  {l.visitCount} {l.visitCount === 1 ? "visit" : "visits"}
                  {l.lastVisitAt
                    ? ` · last ${new Date(l.lastVisitAt).toLocaleDateString()}`
                    : ""}
                </p>
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => onRevoke(l.id)}
                disabled={isRevokingId === l.id}
                data-testid={`share-inspector-revoke-${l.id}`}
                aria-label={`Revoke share link ${l.id}`}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
                {isRevokingId === l.id ? "Revoking…" : "Revoke"}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// Re-export ExternalLink so the audit-readiness header can render the icon
// without re-importing lucide. Not strictly required — kept inline above.
export { ExternalLink };
