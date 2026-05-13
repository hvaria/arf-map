/**
 * <AuditTrailButton> — Wave 0 F3 component (Phase 3 IA §2.2, Phase 4 §10).
 *
 * 24×24 icon button rendered on every Wave 1 detail/edit view. Click opens
 * a slide-in shadcn <Sheet> from the right with the change-event history
 * for one entity.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Real <button> with aria-label per accessibility §7:   ComplianceContent.tsx:367-369
 *   - Loading skeleton row pattern:                          ComplianceContent.tsx:311-313
 *   - Empty-state dashed border:                             ComplianceContent.tsx:315-318
 *   - useQuery + getQueryFn on protected endpoint:           ComplianceContent.tsx:222-226
 *   - Tone palette (slate/blue/emerald/red) for action chip: EmarContent.tsx:55-62
 *   - Use lucide `History` icon (preferred over Clock here): lucide-react
 *
 * Read-only per Phase 4 §7.3 — the trail is append-only on the server.
 *
 * API contract (Phase 4 §7.3):
 *   GET /api/ops/facilities/:facilityNumber/audit-trail?entityType=&entityId=&page=&limit=
 */
import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { History, ChevronDown, ChevronRight, Copy, FileText } from "lucide-react";

interface Props {
  entityType: string;
  entityId: number;
  facilityNumber: string;
  /** Visible label override; defaults to icon-only with aria-label. */
  labelText?: string;
  className?: string;
}

export interface AuditEventRow {
  id: number;
  facilityNumber: string;
  actorId: string;
  actorRole: string;
  action:
    | "create"
    | "update"
    | "delete"
    | "attach_evidence"
    | "detach_evidence"
    | "resolve"
    | "close"
    | "reopen";
  entityType: string;
  entityId: number;
  beforeJson: string | null;
  afterJson: string | null;
  occurredAt: number;
}

// ── Tone palette per Phase 3 §2 / EmarContent.tsx:55-62 ───────────────────────
const ACTION_TONE: Record<AuditEventRow["action"], string> = {
  create: "bg-emerald-100 text-emerald-700 border-emerald-200",
  update: "bg-blue-100 text-blue-700 border-blue-200",
  delete: "bg-red-100 text-red-700 border-red-200",
  attach_evidence: "bg-blue-100 text-blue-700 border-blue-200",
  detach_evidence: "bg-slate-100 text-slate-700 border-slate-200",
  resolve: "bg-emerald-100 text-emerald-700 border-emerald-200",
  close: "bg-slate-100 text-slate-700 border-slate-200",
  reopen: "bg-amber-100 text-amber-700 border-amber-200",
};

function actionLabel(a: AuditEventRow["action"]): string {
  return a.replace(/_/g, " ");
}

function fmtRelative(ms: number): string {
  const diff = Date.now() - ms;
  const minutes = Math.round(diff / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function fmtAbsolute(ms: number): string {
  return new Date(ms).toLocaleString();
}

function safeFormatJson(raw: string | null): string {
  if (!raw) return "—";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

// ── EventRow ──────────────────────────────────────────────────────────────────

function EventRow({ ev }: { ev: AuditEventRow }) {
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const beforeText = useMemo(() => safeFormatJson(ev.beforeJson), [ev.beforeJson]);
  const afterText = useMemo(() => safeFormatJson(ev.afterJson), [ev.afterJson]);

  const copy = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast({ title: `${label} copied` });
    } catch {
      toast({
        title: "Couldn't copy",
        description: "Clipboard access was denied.",
        variant: "destructive",
      });
    }
  };

  return (
    <li
      className="rounded-md border bg-white p-3 text-sm"
      data-testid="audit-event-row"
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-start justify-between gap-2 text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
        aria-expanded={open}
        aria-label={`${open ? "Collapse" : "Expand"} ${actionLabel(ev.action)} event`}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap mb-0.5">
            <span
              className={cn(
                "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border capitalize",
                ACTION_TONE[ev.action] ??
                  "bg-slate-100 text-slate-700 border-slate-200",
              )}
            >
              {actionLabel(ev.action)}
            </span>
            <span className="text-xs font-medium text-gray-800">
              {ev.actorId}
            </span>
            <span className="text-[10px] text-muted-foreground capitalize">
              {ev.actorRole}
            </span>
          </div>
          <div
            className="text-[11px] text-muted-foreground"
            title={fmtAbsolute(ev.occurredAt)}
          >
            {fmtRelative(ev.occurredAt)}
          </div>
        </div>
        <span className="text-muted-foreground shrink-0 pt-0.5">
          {open ? (
            <ChevronDown className="h-3.5 w-3.5" />
          ) : (
            <ChevronRight className="h-3.5 w-3.5" />
          )}
        </span>
      </button>

      {open && (
        <div className="mt-2 space-y-2" data-testid="audit-event-details">
          {ev.beforeJson !== null && (
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Before
                </span>
                <button
                  type="button"
                  onClick={() => copy(beforeText, "Before")}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label="Copy before snapshot"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
              <pre className="text-[11px] bg-gray-50 border rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
                {beforeText}
              </pre>
            </div>
          )}
          {ev.afterJson !== null && (
            <div>
              <div className="flex items-center justify-between mb-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                  After
                </span>
                <button
                  type="button"
                  onClick={() => copy(afterText, "After")}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                  aria-label="Copy after snapshot"
                >
                  <Copy className="h-3 w-3" />
                </button>
              </div>
              <pre className="text-[11px] bg-gray-50 border rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
                {afterText}
              </pre>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

// ── AuditTrailButton ──────────────────────────────────────────────────────────

export function AuditTrailButton({
  entityType,
  entityId,
  facilityNumber,
  labelText,
  className,
}: Props) {
  const [open, setOpen] = useState(false);

  const listKey = [
    `/api/ops/facilities/${facilityNumber}/audit-trail`,
    { entityType, entityId, page: 1, limit: 50 },
  ] as const;

  const { data, isLoading, error } = useQuery<{
    success: boolean;
    data: AuditEventRow[];
  } | null>({
    queryKey: listKey,
    queryFn: async () => {
      const params = new URLSearchParams({
        entityType,
        entityId: String(entityId),
        page: "1",
        limit: "50",
      });
      const res = await fetch(
        `/api/ops/facilities/${facilityNumber}/audit-trail?${params}`,
        { credentials: "include" },
      );
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: open && !!facilityNumber && Number.isFinite(entityId),
    staleTime: 60_000,
  });

  const events = data?.data ?? [];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:text-foreground hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          className,
        )}
        aria-label="View history for this item"
        data-testid="audit-trail-button"
      >
        <History className="h-3.5 w-3.5" />
        {labelText && <span>{labelText}</span>}
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md overflow-y-auto"
          data-testid="audit-trail-sheet"
        >
          <SheetHeader>
            <SheetTitle>History</SheetTitle>
            <SheetDescription>
              Change events for this item. Read-only.
            </SheetDescription>
          </SheetHeader>

          <div className="mt-4 space-y-2">
            {isLoading && (
              <ul className="space-y-2" data-testid="audit-trail-loading">
                {Array.from({ length: 3 }).map((_, i) => (
                  <li key={i}>
                    <Skeleton className="h-16 w-full rounded-md" />
                  </li>
                ))}
              </ul>
            )}

            {error && !isLoading && (
              <div
                className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive"
                role="alert"
              >
                Couldn't load history — please try again.
              </div>
            )}

            {!isLoading && !error && events.length === 0 && (
              <div
                className="rounded-lg border border-dashed p-8 text-center"
                data-testid="audit-trail-empty"
              >
                <FileText className="h-7 w-7 mx-auto text-muted-foreground mb-2" />
                <p className="text-sm text-muted-foreground">
                  No history yet.
                </p>
              </div>
            )}

            {!isLoading && !error && events.length > 0 && (
              <ul className="space-y-2">
                {events.map((ev) => (
                  <EventRow key={ev.id} ev={ev} />
                ))}
              </ul>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
