/**
 * TrackerAlertsCard — surfaces active tracker alerts on the OperationsTab
 * overview. Lists top-3 by default (sorted critical → warn → info, then
 * createdAt DESC), expands to all on demand, and provides Acknowledge /
 * Resolve actions per row.
 *
 * Visual language matches the existing OperationsTab "Needs attention" card:
 * border-l-4 severity tint, Card+CardContent shell, Badge accents.
 */
import { useMemo, useState } from "react";
import {
  AlertOctagon,
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  Info,
  Loader2,
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
  border: string;
  rowBg: string;
  iconBg: string;
  iconColor: string;
  icon: React.ElementType;
  badge: string;
  label: string;
}

const SEVERITY_THEME: Record<AlertSeverity, SeverityTheme> = {
  critical: {
    border: "border-l-red-500",
    rowBg: "bg-red-50/60",
    iconBg: "bg-red-100",
    iconColor: "text-red-700",
    icon: AlertOctagon,
    badge: "bg-red-100 text-red-700 border-red-200",
    label: "Critical",
  },
  warn: {
    border: "border-l-amber-500",
    rowBg: "bg-amber-50/60",
    iconBg: "bg-amber-100",
    iconColor: "text-amber-700",
    icon: AlertTriangle,
    badge: "bg-amber-100 text-amber-800 border-amber-200",
    label: "Warning",
  },
  info: {
    border: "border-l-sky-500",
    rowBg: "bg-sky-50/60",
    iconBg: "bg-sky-100",
    iconColor: "text-sky-700",
    icon: Info,
    badge: "bg-sky-100 text-sky-700 border-sky-200",
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
            className="text-sm font-medium text-gray-700"
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
        "flex flex-col gap-2 px-3 py-3 border-b border-gray-100 last:border-0",
        "animate-in fade-in slide-in-from-top-1 duration-200",
        theme.rowBg,
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "h-9 w-9 rounded-md flex items-center justify-center shrink-0",
            theme.iconBg,
            theme.iconColor,
          )}
          aria-hidden="true"
        >
          <Icon className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold leading-tight">
              {alert.message}
            </span>
            <Badge
              variant="outline"
              className="h-5 text-[10px] font-semibold capitalize"
            >
              {trackerName}
            </Badge>
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {relativeTime(alert.createdAt)}
            </span>
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {residentLabel(resident)}
            {alert.shift ? ` · ${alert.shift}` : ""}
            {isAcknowledged ? (
              <span className="ml-2 inline-flex items-center gap-1 text-emerald-700 font-medium">
                <CheckCircle2 className="h-3 w-3" />
                {isResolved ? "resolved" : "ack'd"}
              </span>
            ) : null}
          </p>
          {alert.detail ? (
            <p className="text-xs text-gray-700 mt-1 leading-relaxed">
              {alert.detail}
            </p>
          ) : null}
        </div>
      </div>

      {!isResolved && (
        <div className="flex items-center gap-2 pl-12">
          <Button
            size="sm"
            variant="outline"
            disabled={ack.isPending || isAcknowledged}
            onClick={() => setAckOpen(true)}
            className={cn(
              "h-9 min-h-[44px] text-xs gap-1.5",
              flash === "ack" && "border-emerald-400 text-emerald-700",
            )}
            aria-label={`Acknowledge alert: ${alert.message}`}
          >
            {ack.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : flash === "ack" || isAcknowledged ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
            ) : null}
            {isAcknowledged ? "Acknowledged" : "Acknowledge"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={resolve.isPending}
            onClick={() => setResolveOpen(true)}
            className={cn(
              "h-9 min-h-[44px] text-xs gap-1.5",
              flash === "resolved" &&
                "border-emerald-400 text-emerald-700 line-through",
            )}
            aria-label={`Resolve alert: ${alert.message}`}
          >
            {resolve.isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : flash === "resolved" ? (
              <Check className="h-3.5 w-3.5 text-emerald-600" aria-hidden="true" />
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
}

export function TrackerAlertsCard({ facilityNumber }: TrackerAlertsCardProps) {
  const [showAll, setShowAll] = useState(false);

  // List query — defaults to status=active. Auto-refresh every 60 s so newly
  // fired alerts surface without a manual reload (matches the summary hook
  // cadence).
  const {
    data: alertsEnv,
    isLoading,
    isError,
  } = useTrackerAlerts(
    { enabled: !!facilityNumber, limit: 50 },
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
  const hasAlerts = counts.total > 0;

  // Border tone follows highest-severity present.
  const cardBorder = !hasAlerts
    ? "border-l-gray-200"
    : counts.critical > 0
      ? "border-l-red-500"
      : counts.warn > 0
        ? "border-l-amber-500"
        : "border-l-sky-500";

  return (
    <section aria-label="Tracker alerts">
      <Card className={cn("border-l-4 transition-colors", cardBorder)}>
        <CardContent className="p-0">
          <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100 gap-2 flex-wrap">
            <div className="flex items-center gap-2 min-w-0">
              <Bell
                className={cn(
                  "h-4 w-4",
                  counts.critical > 0
                    ? "text-red-600"
                    : counts.warn > 0
                      ? "text-amber-600"
                      : counts.info > 0
                        ? "text-sky-600"
                        : "text-gray-400",
                )}
              />
              <h2 className="text-sm font-semibold">Tracker alerts</h2>
              {hasAlerts && (
                <div className="flex items-center gap-1.5 flex-wrap">
                  {counts.critical > 0 && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-5 text-[10px] font-semibold tabular-nums",
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
                        "h-5 text-[10px] font-semibold tabular-nums",
                        SEVERITY_THEME.warn.badge,
                      )}
                    >
                      {counts.warn} warn
                    </Badge>
                  )}
                  {counts.info > 0 && (
                    <Badge
                      variant="outline"
                      className={cn(
                        "h-5 text-[10px] font-semibold tabular-nums",
                        SEVERITY_THEME.info.badge,
                      )}
                    >
                      {counts.info} info
                    </Badge>
                  )}
                </div>
              )}
            </div>
            {!isLoading && counts.total > 3 && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={() => setShowAll((v) => !v)}
                aria-expanded={showAll}
              >
                {showAll
                  ? "Show top 3"
                  : `Show all ${counts.total} active`}
              </Button>
            )}
          </div>

          {isLoading ? (
            <div className="p-3 space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
            </div>
          ) : isError ? (
            <div className="px-4 py-3 text-sm text-destructive">
              Couldn't load tracker alerts. Try refreshing the page.
            </div>
          ) : counts.total === 0 ? (
            <div className="px-4 py-4 flex items-center gap-3">
              <CheckCircle2
                className="h-5 w-5 text-emerald-500 shrink-0"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm font-semibold leading-tight">
                  All clear
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  No active tracker alerts. New criticals will surface here
                  automatically.
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
        </CardContent>
      </Card>
    </section>
  );
}
