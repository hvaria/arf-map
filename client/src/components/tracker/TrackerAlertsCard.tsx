/**
 * TrackerAlertsCard — surfaces active tracker alerts on the OperationsTab
 * overview. Lists top-3 by default (sorted critical → warn → info, then
 * createdAt DESC), expands to all on demand, and provides Acknowledge /
 * Resolve actions per row.
 *
 * Visual language matches the existing OperationsTab "Needs attention" card:
 * border-l-4 severity tint, Card+CardContent shell, Badge accents.
 */
import { forwardRef, useMemo, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Info,
  Loader2,
  X,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useTrackerAlerts, type AlertRow } from "@/lib/tracker/useTrackerAlerts";
import {
  useAcknowledgeAlert,
  useResolveAlert,
} from "@/lib/tracker/useTrackerAlertMutation";
import { useTrackerDefinitions } from "@/lib/tracker/useTrackerDefinitions";
import { useResidents, type Resident } from "@/hooks/useResidents";
import type { AlertSeverity } from "@shared/tracker-schemas";

// ── Severity theming ─────────────────────────────────────────────────────────

const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 0,
  warn: 1,
  info: 2,
};

interface SeverityTheme {
  icon: React.ElementType;
  /** Pill-style badge using portal status tokens — same idiom as URGENCY_BADGE. */
  badge: string;
  label: string;
}

const SEVERITY_THEME: Record<AlertSeverity, SeverityTheme> = {
  critical: {
    icon: AlertOctagon,
    badge:
      "bg-[var(--portal-status-critical-bg)] text-[var(--portal-status-critical)] border-[var(--portal-status-critical-border)]",
    label: "Critical",
  },
  warn: {
    icon: AlertTriangle,
    badge:
      "bg-[var(--portal-status-warning-bg)] text-[var(--portal-status-warning)] border-[var(--portal-status-warning-border)]",
    label: "Warning",
  },
  info: {
    icon: Info,
    badge: "bg-stone-50 text-stone-600 border-stone-200",
    label: "Info",
  },
};

// ── Helpers ──────────────────────────────────────────────────────────────────

function relativeTime(ts: number | null | undefined): string {
  if (ts == null || !Number.isFinite(ts)) return "—";
  return formatDistanceToNow(new Date(ts), { addSuffix: true });
}

function residentLabel(resident: Resident | undefined): string {
  if (!resident) return "Resident #—";
  const name = `${resident.firstName ?? ""} ${resident.lastName ?? ""}`.trim();
  return name || `Resident #${resident.id}`;
}

// ── Confirm-with-note dialog ─────────────────────────────────────────────────

interface NotePromptProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description: string;
  primaryLabel: string;
  primaryTone: "default" | "destructive";
  loading: boolean;
  onConfirm: (note: string) => void;
}

function NotePromptDialog({
  open,
  onOpenChange,
  title,
  description,
  primaryLabel,
  primaryTone,
  loading,
  onConfirm,
}: NotePromptProps) {
  const [note, setNote] = useState("");
  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) setNote("");
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-2">
          <label
            htmlFor="alert-note"
            className="text-sm font-medium text-stone-700"
          >
            {description}
          </label>
          <Textarea
            id="alert-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Optional — add context for the audit trail"
            rows={3}
            disabled={loading}
            aria-label="Optional note"
          />
        </div>
        <DialogFooter>
          <Button
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={loading}
          >
            Cancel
          </Button>
          <Button
            variant={primaryTone === "destructive" ? "default" : "default"}
            onClick={() => onConfirm(note)}
            disabled={loading}
            className={cn(
              "gap-1.5 min-w-[44px] min-h-[44px]",
              primaryTone === "destructive" &&
                "bg-emerald-600 hover:bg-emerald-700",
            )}
          >
            {loading ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            ) : null}
            {primaryLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Per-row ──────────────────────────────────────────────────────────────────

interface AlertRowProps {
  alert: AlertRow;
  trackerName: string;
  resident: Resident | undefined;
}

function TrackerAlertRow({ alert, trackerName, resident }: AlertRowProps) {
  const theme = SEVERITY_THEME[alert.severity];
  const Icon = theme.icon;

  const ack = useAcknowledgeAlert();
  const resolve = useResolveAlert();

  const [ackOpen, setAckOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  // Brief success flash after a mutation settles — gives the user feedback
  // even though the row itself will disappear from the active list shortly
  // after invalidation.
  const [flash, setFlash] = useState<"ack" | "resolved" | null>(null);

  const isAcknowledged =
    alert.status === "acknowledged" || alert.status === "resolved";
  const isResolved = alert.status === "resolved";

  function flashThen(state: "ack" | "resolved") {
    setFlash(state);
    window.setTimeout(() => setFlash(null), 1000);
  }

  return (
    <li
      className={cn(
        "group flex items-start gap-3 px-5 py-3 hover:bg-stone-50/70 transition-colors border-b last:border-0",
        "animate-in fade-in slide-in-from-top-1 duration-200",
      )}
      style={{ borderColor: "var(--portal-border-subtle)" }}
    >
      <div
        className="h-7 w-7 rounded-md bg-stone-50 border flex items-center justify-center shrink-0"
        style={{ borderColor: "var(--portal-border-subtle)" }}
        aria-hidden="true"
      >
        <Icon className="h-3.5 w-3.5 text-stone-600" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[13px] font-medium text-stone-900 truncate">
            {alert.message}
          </span>
          <Badge
            variant="outline"
            className={cn("h-5 text-[10px] font-medium px-1.5", theme.badge)}
          >
            {theme.label}
          </Badge>
          <Badge
            variant="outline"
            className="h-5 text-[10px] font-medium px-1.5 bg-stone-50 text-stone-600 border-stone-200 capitalize"
          >
            {trackerName}
          </Badge>
        </div>
        <p className="text-[12px] text-muted-foreground truncate mt-0.5">
          {residentLabel(resident)}
          {alert.shift ? (
            <>
              {" "}
              <span aria-hidden="true" className="text-stone-300">
                ·
              </span>{" "}
              <span className="portal-num">{alert.shift}</span>
            </>
          ) : null}{" "}
          <span aria-hidden="true" className="text-stone-300">
            ·
          </span>{" "}
          <span className="portal-num">{relativeTime(alert.createdAt)}</span>
          {isAcknowledged ? (
            <span className="ml-2 inline-flex items-center gap-1 text-[var(--portal-status-ok)] font-medium">
              <CheckCircle2 className="h-3 w-3" />
              {isResolved ? "resolved" : "ack'd"}
            </span>
          ) : null}
        </p>
        {alert.detail ? (
          <p className="text-[12px] text-muted-foreground mt-1 leading-relaxed">
            {alert.detail}
          </p>
        ) : null}
      </div>

      {!isResolved && (
        <div className="flex items-center gap-1.5 shrink-0">
          <Button
            size="sm"
            variant="outline"
            disabled={ack.isPending || isAcknowledged}
            onClick={() => setAckOpen(true)}
            className={cn(
              "h-8 text-xs gap-1",
              flash === "ack" && "border-[var(--portal-status-ok-border)] text-[var(--portal-status-ok)]",
            )}
            aria-label={`Acknowledge alert: ${alert.message}`}
          >
            {ack.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : flash === "ack" || isAcknowledged ? (
              <Check className="h-3.5 w-3.5 text-[var(--portal-status-ok)]" aria-hidden="true" />
            ) : null}
            {isAcknowledged ? "Acknowledged" : "Acknowledge"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={resolve.isPending}
            onClick={() => setResolveOpen(true)}
            className={cn(
              "h-8 text-xs gap-1",
              flash === "resolved" &&
                "border-[var(--portal-status-ok-border)] text-[var(--portal-status-ok)] line-through",
            )}
            aria-label={`Resolve alert: ${alert.message}`}
          >
            {resolve.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : flash === "resolved" ? (
              <Check className="h-3.5 w-3.5 text-[var(--portal-status-ok)]" aria-hidden="true" />
            ) : null}
            Resolve
          </Button>
        </div>
      )}

      <NotePromptDialog
        open={ackOpen}
        onOpenChange={setAckOpen}
        title="Acknowledge alert"
        description="Mark this alert as seen. Note is optional."
        primaryLabel="Acknowledge"
        primaryTone="default"
        loading={ack.isPending}
        onConfirm={(note) => {
          ack.mutate(
            { id: alert.id, note },
            {
              onSuccess: () => {
                setAckOpen(false);
                flashThen("ack");
              },
            },
          );
        }}
      />
      <NotePromptDialog
        open={resolveOpen}
        onOpenChange={setResolveOpen}
        title="Resolve alert"
        description="Close out this alert. Note is optional."
        primaryLabel="Resolve"
        primaryTone="destructive"
        loading={resolve.isPending}
        onConfirm={(note) => {
          resolve.mutate(
            { id: alert.id, note },
            {
              onSuccess: () => {
                setResolveOpen(false);
                flashThen("resolved");
              },
            },
          );
        }}
      />
    </li>
  );
}

// ── Card ─────────────────────────────────────────────────────────────────────

export interface TrackerAlertsCardProps {
  facilityNumber: string;
  /**
   * When set, scopes the alert list to a single tracker slug. Drives the
   * filtered-card title and renders a clear-filter chip above the list. Used
   * by OperationsTab to honor the per-tracker "View all" banner action. See
   * Bug #2.
   */
  slug?: string;
  /** Called when the user clicks the X on the filter chip. */
  onClearFilter?: () => void;
  /**
   * Render without the outer Card chrome so a parent can co-locate this card
   * with another alerts surface in one container. The parent supplies the
   * Card/section wrapper; we only render the section-header + list body.
   */
  embedded?: boolean;
}

export const TrackerAlertsCard = forwardRef<
  HTMLDivElement,
  TrackerAlertsCardProps
>(function TrackerAlertsCard(
  { facilityNumber, slug, onClearFilter, embedded = false },
  ref,
) {
  const [showAll, setShowAll] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  // List query — defaults to status=active. Auto-refresh every 60 s so newly
  // fired alerts surface without a manual reload (matches the summary hook
  // cadence).
  const {
    data: alertsEnv,
    isLoading,
    isError,
  } = useTrackerAlerts(
    { enabled: !!facilityNumber, limit: 50, slug },
    { refetchInterval: 60_000 },
  );

  // Tracker definitions for slug → name lookup. Cached 5 min, shared with the
  // tracker picker.
  const { data: defsEnv } = useTrackerDefinitions();
  const trackerNameBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const d of defsEnv?.data ?? []) {
      map.set(d.slug, d.shortName ?? d.name);
    }
    return map;
  }, [defsEnv]);

  // Residents for id → display-name lookup.
  const { residents } = useResidents(facilityNumber, { activeOnly: false });
  const residentById = useMemo(() => {
    const map = new Map<number, Resident>();
    for (const r of residents) map.set(r.id, r);
    return map;
  }, [residents]);

  const allAlerts = alertsEnv?.data?.items ?? [];
  const sorted = useMemo(() => {
    return [...allAlerts].sort((a, b) => {
      const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (sev !== 0) return sev;
      return b.createdAt - a.createdAt;
    });
  }, [allAlerts]);

  const counts = useMemo(() => {
    let critical = 0;
    let warn = 0;
    let info = 0;
    for (const a of sorted) {
      if (a.severity === "critical") critical += 1;
      else if (a.severity === "warn") warn += 1;
      else info += 1;
    }
    return { critical, warn, info, total: sorted.length };
  }, [sorted]);

  const visible = showAll ? sorted : sorted.slice(0, 3);

  // Filter-related display state. When `slug` is set we know the chip
  // resolves; otherwise the unfiltered title applies.
  const filteredTrackerName = slug
    ? trackerNameBySlug.get(slug) ?? slug
    : null;
  const isFiltered = !!slug;

  const ariaLabel = isFiltered
    ? `Tracker alerts filtered to ${filteredTrackerName}`
    : "Tracker alerts";

  const body = (
    <>
          <div
            className="portal-section-header"
            style={{ borderColor: "var(--portal-border-subtle)" }}
          >
            <button
              type="button"
              onClick={() => setCollapsed((v) => !v)}
              className="portal-section-header__title flex items-center gap-1.5 hover:text-stone-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded-sm"
              aria-expanded={!collapsed}
              aria-controls="tracker-alerts-body"
            >
              {collapsed ? (
                <ChevronDown className="h-3.5 w-3.5 text-stone-500" />
              ) : (
                <ChevronUp className="h-3.5 w-3.5 text-stone-500" />
              )}
              <Bell className="h-3.5 w-3.5 text-stone-500" />
              {isFiltered ? (
                <>Active alerts — {filteredTrackerName}</>
              ) : (
                <>Tracker alerts</>
              )}
              {counts.total > 0 && (
                <Badge
                  variant="outline"
                  className="h-5 text-[10px] font-medium portal-num bg-stone-50 text-stone-600 border-stone-200"
                >
                  {counts.total}
                </Badge>
              )}
              {counts.critical > 0 && (
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 text-[10px] font-medium px-1.5 portal-num",
                    SEVERITY_THEME.critical.badge,
                  )}
                >
                  {counts.critical} critical
                </Badge>
              )}
              {counts.warn > 0 && (
                <Badge
                  variant="outline"
                  className={cn(
                    "h-5 text-[10px] font-medium px-1.5 portal-num",
                    SEVERITY_THEME.warn.badge,
                  )}
                >
                  {counts.warn} warn
                </Badge>
              )}
            </button>
            {!collapsed && !isLoading && counts.total > 3 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setShowAll((v) => !v)}
                aria-expanded={showAll}
              >
                {showAll ? "Show top 3" : `Show all ${counts.total} active`}
              </Button>
            )}
          </div>

          {!collapsed && isFiltered && onClearFilter && (
            <div
              className="px-5 py-2 border-b flex items-center gap-2"
              style={{ borderColor: "var(--portal-border-subtle)" }}
            >
              <span className="text-[11px] font-medium text-stone-500 uppercase tracking-wide">
                Filtered
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-stone-200 bg-stone-50 px-2 py-0.5 text-[12px] font-medium text-stone-700">
                {filteredTrackerName}
                <button
                  type="button"
                  onClick={onClearFilter}
                  aria-label={`Clear ${filteredTrackerName} filter`}
                  className="inline-flex items-center justify-center rounded-full hover:bg-stone-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400"
                >
                  <X className="h-3 w-3 text-stone-500" aria-hidden="true" />
                </button>
              </span>
            </div>
          )}

          {!collapsed && (
            <div id="tracker-alerts-body">
              {isLoading ? (
                <div className="p-4 space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-3/4" />
                </div>
              ) : isError ? (
                <div className="px-5 py-4 text-[13px] text-destructive">
                  Couldn't load tracker alerts. Try refreshing the page.
                </div>
              ) : counts.total === 0 ? (
                <div className="px-5 py-4 flex items-center gap-3">
                  <CheckCircle2
                    className="h-4 w-4 text-[var(--portal-status-ok)] shrink-0"
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium leading-tight text-stone-900">
                      {isFiltered
                        ? `No active alerts for ${filteredTrackerName}`
                        : "All clear"}
                    </p>
                    <p className="text-[12px] text-muted-foreground mt-0.5">
                      {isFiltered
                        ? "Other trackers may still have active alerts — clear the filter to see them."
                        : "No active tracker alerts. New criticals will surface here automatically."}
                    </p>
                  </div>
                </div>
              ) : (
                <ul>
                  {visible.map((a) => (
                    <TrackerAlertRow
                      key={a.id}
                      alert={a}
                      trackerName={
                        trackerNameBySlug.get(a.trackerSlug) ?? a.trackerSlug
                      }
                      resident={
                        a.residentId != null
                          ? residentById.get(a.residentId)
                          : undefined
                      }
                    />
                  ))}
                </ul>
              )}
            </div>
          )}
    </>
  );

  if (embedded) {
    return (
      <div ref={ref} aria-label={ariaLabel} role="region">
        {body}
      </div>
    );
  }

  return (
    <section ref={ref} aria-label={ariaLabel}>
      <Card>
        <CardContent className="p-0">{body}</CardContent>
      </Card>
    </section>
  );
});
