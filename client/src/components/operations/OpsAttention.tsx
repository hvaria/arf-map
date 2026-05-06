/**
 * OpsAttention — two cross-module panels for the Operations tab inside
 * FacilityPortal:
 *
 *   1. "Needs attention" — urgency-ranked exceptions across med passes,
 *      incidents, compliance, staff licenses, and urgent notes.
 *   2. "My work" — items the current user owns or must respond to,
 *      derived from existing data (compliance.assignedTo, incident
 *      reportedBy, notes mentioning the user).
 *
 * Designed to be dropped in between the KPI grid and OpsCalendar without
 * touching the surrounding structure. Navigation is delegated to the
 * parent so it can swap sub-views via setSubView state instead of
 * routing.
 */

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { getQueryFn } from "@/lib/queryClient";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/useSession";
import { todayLocal, parseAmPm } from "@/lib/datetime";
import { cn } from "@/lib/utils";
import {
  Pill, AlertTriangle, ShieldCheck, MessageSquare,
  ArrowRight, Sparkles, Bell, Inbox, CheckCircle2,
} from "lucide-react";

// ── Sub-view keys mirror what OperationsTab.setSubView accepts ──────────────
export type OpsSubView =
  | "emar" | "residents" | "incidents" | "crm" | "billing" | "compliance";

// ── Source data shapes ──────────────────────────────────────────────────────

interface MedPassEntry {
  id: number;
  residentName: string;
  roomNumber: string;
  drugName: string;
  dosage: string;
  scheduledTime: string;
  status: "pending" | "given" | "late" | "missed" | "refused" | "held";
}

interface IncidentRow {
  id: number;
  residentName?: string;
  incidentType: string;
  incidentDate: number;
  status: string;
  reportedBy?: string;
  supervisorNotified: boolean;
  familyNotified: boolean;
  physicianNotified: boolean;
  lic624Required: boolean;
  lic624Submitted: boolean;
}

interface ComplianceItem {
  id: number;
  itemType: string;
  description: string;
  dueDate: number;
  status: string;
  assignedTo: string | null;
}

interface StaffMember {
  id: number;
  firstName: string;
  lastName: string;
  role: string;
  status: string;
  licenseExpiry: number | null;
}

interface NoteListItem {
  id: number;
  body: string;
  authorDisplayName: string;
  priority: "normal" | "urgent";
  status: "open" | "archived" | "deleted";
  ackRequired: number;
  createdAt: number;
}

// ── Urgency / tier model ────────────────────────────────────────────────────

const APPROACHING_MED_MINUTES = 60;
const APPROACHING_COMPLIANCE_DAYS = 30;
const APPROACHING_LICENSE_DAYS = 30;

type Urgency = "overdue" | "approaching" | "scheduled" | "open";
type Tier = "clinical" | "regulatory" | "care" | "ops" | "info";

const URGENCY_RANK: Record<Urgency, number> = {
  overdue: 0, approaching: 1, open: 2, scheduled: 3,
};
const TIER_RANK: Record<Tier, number> = {
  clinical: 0, regulatory: 1, care: 2, ops: 3, info: 4,
};

const URGENCY_BADGE: Record<Urgency, string> = {
  overdue:     "bg-red-100   text-red-700   border-red-200",
  approaching: "bg-amber-100 text-amber-800 border-amber-200",
  open:        "bg-orange-100 text-orange-700 border-orange-200",
  scheduled:   "bg-slate-100 text-slate-600  border-slate-200",
};
const URGENCY_LABEL: Record<Urgency, string> = {
  overdue: "Overdue", approaching: "Approaching", open: "Open", scheduled: "Scheduled",
};

interface AlertItem {
  id: string;
  tier: Tier;
  urgency: Urgency;
  icon: React.ElementType;
  title: string;
  detail: string;
  whenLabel: string;
  actionLabel: string;
  subView: OpsSubView;
  sortKey: number;
}

function parseScheduledTimeToToday(scheduled: string): number | null {
  const p = parseAmPm(scheduled);
  if (!p) return null;
  const d = new Date();
  d.setHours(p.hour, p.minute, 0, 0);
  return d.getTime();
}

function relativeTime(ts: number): string {
  const diff = ts - Date.now();
  if (Math.abs(diff) < 60_000) return diff >= 0 ? "in <1 min" : "<1 min ago";
  return formatDistanceToNow(new Date(ts), { addSuffix: true });
}

// ── AlertRow ────────────────────────────────────────────────────────────────

function AlertRow({
  alert, onAct,
}: {
  alert: AlertItem;
  onAct: (sv: OpsSubView, date?: string) => void;
}) {
  const Icon = alert.icon;
  return (
    <li className="group flex items-center gap-3 px-3 py-2.5 hover:bg-indigo-50/40 transition-colors border-b border-gray-50 last:border-0">
      <div className="h-8 w-8 rounded-md bg-white border border-gray-200 flex items-center justify-center shrink-0">
        <Icon className="h-4 w-4 text-gray-600" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium truncate">{alert.title}</span>
          <Badge
            variant="outline"
            className={cn("h-5 text-[10px] font-semibold", URGENCY_BADGE[alert.urgency])}
          >
            {URGENCY_LABEL[alert.urgency]}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground truncate mt-0.5">
          {alert.detail} · <span className="tabular-nums">{alert.whenLabel}</span>
        </p>
      </div>
      <Button
        size="sm"
        variant="ghost"
        className="shrink-0 h-8 text-xs gap-1 opacity-70 group-hover:opacity-100"
        onClick={() => onAct(alert.subView)}
      >
        {alert.actionLabel}
        <ArrowRight className="h-3.5 w-3.5" />
      </Button>
    </li>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export function OpsAttention({
  facilityNumber,
  onNavigate,
}: {
  facilityNumber: string;
  /** Same signature OperationsTab uses to swap sub-views via state. */
  onNavigate: (sv: OpsSubView, date?: string) => void;
}) {
  const { data: me } = useSession();
  const enabled = !!facilityNumber;

  const { data: medEnv, isLoading: medLoading } = useQuery<
    { success: boolean; data: MedPassEntry[] } | null
  >({
    queryKey: [`/api/ops/facilities/${facilityNumber}/med-pass`, todayLocal()],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled,
    staleTime: 60_000,
  });

  const { data: incEnv, isLoading: incLoading } = useQuery<
    { success: boolean; data: IncidentRow[] } | null
  >({
    queryKey: [`/api/ops/facilities/${facilityNumber}/incidents`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled,
    staleTime: 60_000,
  });

  const { data: ovdCompEnv, isLoading: ovdLoading } = useQuery<
    { success: boolean; data: ComplianceItem[] } | null
  >({
    queryKey: [`/api/ops/facilities/${facilityNumber}/compliance/overdue`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled,
    staleTime: 60_000,
  });

  const { data: compEnv, isLoading: compLoading } = useQuery<
    { success: boolean; data: ComplianceItem[] } | null
  >({
    queryKey: [`/api/ops/facilities/${facilityNumber}/compliance`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled,
    staleTime: 60_000,
  });

  const { data: staffEnv, isLoading: staffLoading } = useQuery<
    { success: boolean; data: StaffMember[] } | null
  >({
    queryKey: [`/api/ops/facilities/${facilityNumber}/staff`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled,
    staleTime: 5 * 60_000,
  });

  // Reuses the shared notes query key — React Query dedupes with the
  // existing OperationsTab notes-count fetch.
  const { data: notesEnv, isLoading: notesLoading } = useQuery<
    { success: boolean; data: { items: NoteListItem[] } } | null
  >({
    queryKey: ["/api/ops/notes?status=open&limit=50"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled,
    staleTime: 30_000,
  });

  const medPasses = medEnv?.data ?? [];
  const incidents = incEnv?.data ?? [];
  const overdueCompliance = ovdCompEnv?.data ?? [];
  const allCompliance = compEnv?.data ?? [];
  const staff = staffEnv?.data ?? [];
  const notes = notesEnv?.data?.items ?? [];

  // ── Cross-module alerts ───────────────────────────────────────────────────
  const alerts: AlertItem[] = useMemo(() => {
    const out: AlertItem[] = [];
    const now = Date.now();

    for (const m of medPasses) {
      if (m.status !== "late" && m.status !== "missed") continue;
      const t = parseScheduledTimeToToday(m.scheduledTime);
      out.push({
        id: `med-${m.id}`,
        tier: "clinical",
        urgency: "overdue",
        icon: Pill,
        title: `${m.status === "late" ? "Late" : "Missed"} med · ${m.residentName}`,
        detail: `${m.drugName} ${m.dosage}`.trim() + (m.roomNumber ? ` · Rm ${m.roomNumber}` : ""),
        whenLabel: `scheduled ${m.scheduledTime}`,
        actionLabel: "Chart",
        subView: "emar",
        sortKey: t ?? now,
      });
    }
    for (const m of medPasses) {
      if (m.status !== "pending") continue;
      const t = parseScheduledTimeToToday(m.scheduledTime);
      if (t == null) continue;
      const minsAway = (t - now) / 60_000;
      if (minsAway < 0 || minsAway > APPROACHING_MED_MINUTES) continue;
      out.push({
        id: `med-app-${m.id}`,
        tier: "clinical",
        urgency: "approaching",
        icon: Pill,
        title: `${m.residentName} · ${m.drugName}`.trim(),
        detail: `${m.dosage}`.trim() + (m.roomNumber ? ` · Rm ${m.roomNumber}` : ""),
        whenLabel: relativeTime(t),
        actionLabel: "Chart",
        subView: "emar",
        sortKey: t,
      });
    }

    for (const inc of incidents) {
      if (inc.status !== "open") continue;
      const missing: string[] = [];
      if (!inc.supervisorNotified) missing.push("supervisor");
      if (!inc.familyNotified) missing.push("family");
      if (!inc.physicianNotified) missing.push("physician");
      if (missing.length === 0) continue;
      out.push({
        id: `inc-notify-${inc.id}`,
        tier: "regulatory",
        urgency: "open",
        icon: AlertTriangle,
        title: `${inc.incidentType.replace(/_/g, " ")}${inc.residentName ? ` · ${inc.residentName}` : ""}`,
        detail: `Missing notification: ${missing.join(", ")}`,
        whenLabel: relativeTime(inc.incidentDate),
        actionLabel: "Open",
        subView: "incidents",
        sortKey: inc.incidentDate,
      });
    }

    for (const inc of incidents) {
      if (!inc.lic624Required || inc.lic624Submitted) continue;
      out.push({
        id: `inc-lic-${inc.id}`,
        tier: "regulatory",
        urgency: "approaching",
        icon: ShieldCheck,
        title: `LIC 624 needed · ${inc.incidentType.replace(/_/g, " ")}`,
        detail: inc.residentName ?? "Reportable incident",
        whenLabel: relativeTime(inc.incidentDate),
        actionLabel: "File",
        subView: "incidents",
        sortKey: inc.incidentDate,
      });
    }

    for (const c of overdueCompliance) {
      out.push({
        id: `cmp-ovd-${c.id}`,
        tier: "regulatory",
        urgency: "overdue",
        icon: ShieldCheck,
        title: c.description || c.itemType,
        detail: c.assignedTo ? `Assigned to ${c.assignedTo}` : "Unassigned",
        whenLabel: `due ${relativeTime(c.dueDate)}`,
        actionLabel: "Review",
        subView: "compliance",
        sortKey: c.dueDate,
      });
    }

    const APPROACH_MS = APPROACHING_COMPLIANCE_DAYS * 86_400_000;
    for (const c of allCompliance) {
      if (c.status === "completed") continue;
      const ms = c.dueDate - now;
      if (ms <= 0 || ms > APPROACH_MS) continue;
      out.push({
        id: `cmp-app-${c.id}`,
        tier: "regulatory",
        urgency: "approaching",
        icon: ShieldCheck,
        title: c.description || c.itemType,
        detail: c.assignedTo ? `Assigned to ${c.assignedTo}` : "Unassigned",
        whenLabel: `due ${relativeTime(c.dueDate)}`,
        actionLabel: "Review",
        subView: "compliance",
        sortKey: c.dueDate,
      });
    }

    const LIC_APPROACH_MS = APPROACHING_LICENSE_DAYS * 86_400_000;
    for (const s of staff) {
      if (s.licenseExpiry == null || s.status !== "active") continue;
      const ms = s.licenseExpiry - now;
      if (ms <= 0) {
        out.push({
          id: `lic-${s.id}`,
          tier: "regulatory",
          urgency: "overdue",
          icon: ShieldCheck,
          title: `License expired · ${s.firstName} ${s.lastName}`,
          detail: `Role: ${s.role.replace(/_/g, " ")}`,
          whenLabel: relativeTime(s.licenseExpiry),
          actionLabel: "Update",
          subView: "compliance", // staff sub-view uses different key; compliance is closest fit for the action
          sortKey: s.licenseExpiry,
        });
      } else if (ms <= LIC_APPROACH_MS) {
        out.push({
          id: `lic-${s.id}`,
          tier: "regulatory",
          urgency: "approaching",
          icon: ShieldCheck,
          title: `License expiring · ${s.firstName} ${s.lastName}`,
          detail: `Role: ${s.role.replace(/_/g, " ")}`,
          whenLabel: relativeTime(s.licenseExpiry),
          actionLabel: "Update",
          subView: "compliance",
          sortKey: s.licenseExpiry,
        });
      }
    }

    for (const n of notes) {
      if (n.priority !== "urgent" || n.status !== "open") continue;
      out.push({
        id: `note-${n.id}`,
        tier: "care",
        urgency: "open",
        icon: MessageSquare,
        title: "Urgent note awaiting acknowledgement",
        detail: n.body.slice(0, 80) + (n.body.length > 80 ? "…" : ""),
        whenLabel: relativeTime(n.createdAt),
        actionLabel: "Open",
        subView: "residents", // notes don't map to a sub-view — closest fit; user can also use the Notes Sheet
        sortKey: n.createdAt,
      });
    }

    out.sort((a, b) => {
      const tier = TIER_RANK[a.tier] - TIER_RANK[b.tier];
      if (tier !== 0) return tier;
      const urg = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (urg !== 0) return urg;
      return a.sortKey - b.sortKey;
    });

    return out;
  }, [medPasses, incidents, overdueCompliance, allCompliance, staff, notes]);

  // ── Personal Work Queue ──────────────────────────────────────────────────
  // Heuristic match against username (until per-staff auth lands and we can
  // use stable IDs).
  const myQueue: AlertItem[] = useMemo(() => {
    if (!me) return [];
    const usernameLc = me.username.toLowerCase();
    const out: AlertItem[] = [];
    const now = Date.now();

    for (const c of allCompliance) {
      if (c.status === "completed") continue;
      if (!c.assignedTo) continue;
      if (c.assignedTo.toLowerCase() !== usernameLc) continue;
      const overdue = c.dueDate <= now;
      out.push({
        id: `mine-cmp-${c.id}`,
        tier: "regulatory",
        urgency: overdue ? "overdue" : "approaching",
        icon: ShieldCheck,
        title: c.description || c.itemType,
        detail: `Assigned to you · ${overdue ? "overdue" : "upcoming"}`,
        whenLabel: `due ${relativeTime(c.dueDate)}`,
        actionLabel: "Open",
        subView: "compliance",
        sortKey: c.dueDate,
      });
    }

    for (const inc of incidents) {
      if (inc.status !== "open") continue;
      if (!inc.reportedBy) continue;
      if (inc.reportedBy.toLowerCase() !== usernameLc) continue;
      out.push({
        id: `mine-inc-${inc.id}`,
        tier: "regulatory",
        urgency: "open",
        icon: AlertTriangle,
        title: `${inc.incidentType.replace(/_/g, " ")}${inc.residentName ? ` · ${inc.residentName}` : ""}`,
        detail: "You reported this — still open",
        whenLabel: relativeTime(inc.incidentDate),
        actionLabel: "Open",
        subView: "incidents",
        sortKey: inc.incidentDate,
      });
    }

    for (const n of notes) {
      if (n.status !== "open") continue;
      const isMine = n.authorDisplayName.toLowerCase() === usernameLc;
      const needsAck = n.priority === "urgent" && n.ackRequired === 1;
      if (!isMine && !needsAck) continue;
      out.push({
        id: `mine-note-${n.id}`,
        tier: "care",
        urgency: needsAck ? "open" : "scheduled",
        icon: MessageSquare,
        title: needsAck ? "Acknowledge urgent note" : "Your note",
        detail: n.body.slice(0, 80) + (n.body.length > 80 ? "…" : ""),
        whenLabel: relativeTime(n.createdAt),
        actionLabel: "Open",
        subView: "residents",
        sortKey: n.createdAt,
      });
    }

    out.sort((a, b) => {
      const urg = URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency];
      if (urg !== 0) return urg;
      return a.sortKey - b.sortKey;
    });
    return out;
  }, [me, allCompliance, incidents, notes]);

  const alertsLoading =
    medLoading || incLoading || ovdLoading || compLoading || staffLoading || notesLoading;
  const queueLoading = compLoading || incLoading || notesLoading;

  // Show top 6 by default; expand to all when user opts in.
  const visibleAlerts = alerts.slice(0, 6);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* ── Alerts & Exceptions ──────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Bell className="h-4 w-4 text-amber-600" />
              <h2 className="text-sm font-semibold">Needs attention</h2>
              {!alertsLoading && alerts.length > 0 && (
                <Badge variant="outline" className="h-5 text-[10px]">
                  {alerts.length}
                </Badge>
              )}
            </div>
          </div>

          {alertsLoading ? (
            <div className="p-3 space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-3/4" />
            </div>
          ) : alerts.length === 0 ? (
            <div className="p-6 text-center">
              <Sparkles className="h-7 w-7 text-emerald-500 mx-auto mb-2" />
              <p className="text-sm font-semibold">All caught up</p>
              <p className="text-xs text-muted-foreground mt-1">
                {medPasses.length > 0 ? (
                  <>
                    Next med pass at{" "}
                    <span className="font-medium">
                      {medPasses.find((m) => m.status === "pending")?.scheduledTime ?? "—"}
                    </span>
                    .
                  </>
                ) : (
                  <>No urgent items right now. Check the calendar for what's coming up.</>
                )}
              </p>
            </div>
          ) : (
            <ul>
              {visibleAlerts.map((a) => (
                <AlertRow key={a.id} alert={a} onAct={onNavigate} />
              ))}
              {alerts.length > 6 && (
                <li className="px-3 py-2 text-[11px] text-muted-foreground text-center border-t border-gray-50">
                  +{alerts.length - 6} more — narrow by category in the calendar legend
                </li>
              )}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* ── My work ──────────────────────────────────────────── */}
      <Card>
        <CardContent className="p-0">
          <div className="px-4 py-3 flex items-center justify-between border-b border-gray-100">
            <div className="flex items-center gap-2">
              <Inbox className="h-4 w-4 text-indigo-500" />
              <h2 className="text-sm font-semibold">My work</h2>
              {!queueLoading && myQueue.length > 0 && (
                <Badge variant="outline" className="h-5 text-[10px]">
                  {myQueue.length}
                </Badge>
              )}
            </div>
            {me && (
              <span className="text-[11px] text-muted-foreground hidden sm:inline">
                Assigned to <span className="font-medium">{me.username}</span>
              </span>
            )}
          </div>

          {queueLoading ? (
            <div className="p-3 space-y-2">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-3/4" />
            </div>
          ) : myQueue.length === 0 ? (
            <div className="p-5 text-center">
              <CheckCircle2 className="h-6 w-6 text-emerald-500 mx-auto mb-1.5" />
              <p className="text-sm font-medium">Nothing on your queue</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                When something is assigned to you or needs your acknowledgement, it'll show up here.
              </p>
            </div>
          ) : (
            <ul>
              {myQueue.slice(0, 6).map((a) => (
                <AlertRow key={a.id} alert={a} onAct={onNavigate} />
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
