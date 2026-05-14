/**
 * <AuditTrailViewer> — Wave 2 W15 (top-level audit trail explorer).
 *
 * Lives inside Audit Readiness as a sibling of the Reg Settings (⚙) tab.
 * Lets an admin filter the facility-wide change-log by entity type, action,
 * actor, and a date range, paginated 50 rows at a time with "Load more".
 *
 * Consumes the EXTENDED Wave 2 query params on the existing endpoint:
 *   GET /api/ops/facilities/:fn/audit-trail
 *     ?entityType=&action=&actor=&sinceMs=&untilMs=&page=&limit=
 * (Wave 0 mounted entityType + entityId + page + limit. The Wave 2 server
 * change extends that strict zod schema with the new fields. No new endpoint.)
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Action chip tone palette + EventRow expand/before-after pattern:
 *       client/src/components/operations/AuditTrailButton.tsx:65-220
 *   - Filter bar form fields wrapped by <FormField>:
 *       client/src/components/operations/FormField.tsx
 *   - <Select> shadcn primitive:
 *       client/src/components/operations/ResidentsContent.tsx:168-176
 *   - useQuery + URL-shaped key (no `fetch()` for plain GETs):
 *       client/src/components/operations/AuditTrailButton.tsx:238-260
 *   - Loading skeleton row pattern:
 *       client/src/components/operations/AuditTrailButton.tsx:294-302
 *   - Empty state — dashed border + icon + muted text:
 *       client/src/components/operations/AuditTrailButton.tsx:313-322
 *   - Full-page form layout & section subheading style:
 *       client/src/components/operations/RegSettingsContent.tsx:484-516
 *   - 60s staleTime on aggregated reads:
 *       client/src/components/operations/AuditReadinessContent.tsx:144-147
 *
 * Read-only per Phase 4 §7.3 — append-only on the server, no mutations here.
 */
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
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
import { FormField } from "@/components/operations/FormField";
import { cn } from "@/lib/utils";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Filter,
  RefreshCw,
} from "lucide-react";
import type { AuditEventRow } from "@/components/operations/AuditTrailButton";

// ── Filter option presets (mirrors Wave 0 docs §7.3) ────────────────────────

const ENTITY_TYPES = [
  "ops_vendor",
  "ops_drill_log",
  "ops_complaint",
  "ops_inspection",
  "ops_temperature_log",
  "ops_staff_credential",
  "ops_incident",
  "ops_evidence_attachment",
  "ops_facility_setting",
] as const;

const ACTIONS = [
  "create",
  "update",
  "delete",
  "resolve",
  "close",
  "reopen",
  "attach_evidence",
  "detach_evidence",
  "manage_settings",
] as const;

const PAGE_LIMIT = 50;

// ── Tone palette (mirror AuditTrailButton.tsx:65-75) ────────────────────────

const ACTION_TONE: Record<string, string> = {
  create: "bg-emerald-100 text-emerald-700 border-emerald-200",
  update: "bg-blue-100 text-blue-700 border-blue-200",
  delete: "bg-red-100 text-red-700 border-red-200",
  attach_evidence: "bg-blue-100 text-blue-700 border-blue-200",
  detach_evidence: "bg-slate-100 text-slate-700 border-slate-200",
  resolve: "bg-emerald-100 text-emerald-700 border-emerald-200",
  close: "bg-slate-100 text-slate-700 border-slate-200",
  reopen: "bg-amber-100 text-amber-700 border-amber-200",
  manage_settings: "bg-indigo-100 text-indigo-700 border-indigo-200",
};

function fmtAbsolute(ms: number): string {
  return new Date(ms).toLocaleString();
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

function safeFormatJson(raw: string | null): string {
  if (!raw) return "—";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function epochOrUndef(dateStr: string): number | undefined {
  if (!dateStr) return undefined;
  const ms = new Date(dateStr).getTime();
  return Number.isFinite(ms) ? ms : undefined;
}

// ── Filter state shape ──────────────────────────────────────────────────────

interface AppliedFilters {
  entityType: string; // "" = all
  action: string; // "" = all
  actor: string; // free text
  sinceMs?: number;
  untilMs?: number;
}

const EMPTY_FILTERS: AppliedFilters = {
  entityType: "",
  action: "",
  actor: "",
};

// ── Event row (mirrors AuditTrailButton EventRow) ───────────────────────────

function EventTableRow({ ev }: { ev: AuditEventRow }) {
  const [open, setOpen] = useState(false);
  const beforeText = useMemo(
    () => safeFormatJson(ev.beforeJson),
    [ev.beforeJson],
  );
  const afterText = useMemo(
    () => safeFormatJson(ev.afterJson),
    [ev.afterJson],
  );

  return (
    <>
      <tr
        className="border-t bg-white hover:bg-gray-50"
        data-testid="audit-viewer-row"
      >
        <td className="px-3 py-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-label={`${open ? "Collapse" : "Expand"} event ${ev.id}`}
            className="inline-flex items-center text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-primary rounded"
          >
            {open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )}
          </button>
        </td>
        <td
          className="px-3 py-2 text-[11px] text-muted-foreground whitespace-nowrap"
          title={fmtAbsolute(ev.occurredAt)}
        >
          {fmtRelative(ev.occurredAt)}
        </td>
        <td className="px-3 py-2 text-xs">
          <div className="font-medium text-gray-800">{ev.actorId}</div>
          <div className="text-[10px] text-muted-foreground capitalize">
            {ev.actorRole}
          </div>
        </td>
        <td className="px-3 py-2">
          <span
            className={cn(
              "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold border capitalize",
              ACTION_TONE[ev.action] ??
                "bg-slate-100 text-slate-700 border-slate-200",
            )}
          >
            {ev.action.replace(/_/g, " ")}
          </span>
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground">
          {ev.entityType}
        </td>
        <td className="px-3 py-2 text-xs text-muted-foreground portal-num">
          #{ev.entityId}
        </td>
      </tr>
      {open && (
        <tr className="bg-gray-50" data-testid="audit-viewer-row-details">
          <td colSpan={6} className="px-3 py-2">
            <div className="grid md:grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                  Before
                </p>
                <pre className="text-[11px] bg-white border rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
                  {beforeText}
                </pre>
              </div>
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-0.5">
                  After
                </p>
                <pre className="text-[11px] bg-white border rounded p-2 overflow-x-auto whitespace-pre-wrap break-words">
                  {afterText}
                </pre>
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ── Main viewer ─────────────────────────────────────────────────────────────

export function AuditTrailViewer({
  facilityNumber,
}: {
  facilityNumber: string;
}) {
  // Local "draft" filter state (what the form holds), and the "applied"
  // state that's actually used in the query key. Applied is the source of
  // truth for the request; we only update it when the user clicks Apply.
  const [draftEntity, setDraftEntity] = useState("");
  const [draftAction, setDraftAction] = useState("");
  const [draftActor, setDraftActor] = useState("");
  const [draftSince, setDraftSince] = useState("");
  const [draftUntil, setDraftUntil] = useState("");

  const [applied, setApplied] = useState<AppliedFilters>(EMPTY_FILTERS);
  const [page, setPage] = useState(1);

  const queryKey = [
    `/api/ops/facilities/${facilityNumber}/audit-trail`,
    { ...applied, page, limit: PAGE_LIMIT },
  ] as const;

  const { data, isLoading, isFetching, error } = useQuery<
    | {
        success: boolean;
        data: AuditEventRow[];
        meta?: { total: number; page: number; limit: number };
      }
    | null
  >({
    queryKey,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (applied.entityType) params.set("entityType", applied.entityType);
      if (applied.action) params.set("action", applied.action);
      if (applied.actor.trim()) params.set("actor", applied.actor.trim());
      if (applied.sinceMs !== undefined)
        params.set("sinceMs", String(applied.sinceMs));
      if (applied.untilMs !== undefined)
        params.set("untilMs", String(applied.untilMs));
      params.set("page", String(page));
      params.set("limit", String(PAGE_LIMIT));
      const res = await fetch(
        `/api/ops/facilities/${facilityNumber}/audit-trail?${params}`,
        { credentials: "include" },
      );
      if (res.status === 401) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    },
    enabled: !!facilityNumber,
    staleTime: 60_000,
    // keep previous page on "load more" so the UI doesn't flicker
    placeholderData: (prev) => prev,
  });

  const rows = data?.data ?? [];
  const total = data?.meta?.total ?? rows.length;
  const hasMore = data?.meta ? page * PAGE_LIMIT < (data.meta.total ?? 0) : false;

  function apply() {
    setApplied({
      entityType: draftEntity,
      action: draftAction,
      actor: draftActor,
      sinceMs: epochOrUndef(draftSince),
      untilMs: epochOrUndef(draftUntil),
    });
    setPage(1);
  }

  function clear() {
    setDraftEntity("");
    setDraftAction("");
    setDraftActor("");
    setDraftSince("");
    setDraftUntil("");
    setApplied(EMPTY_FILTERS);
    setPage(1);
  }

  return (
    <div className="space-y-4 max-w-5xl" data-testid="audit-trail-viewer">
      {/* Filter bar */}
      <section
        className="rounded-lg border bg-white p-3 space-y-3"
        aria-label="Audit trail filters"
      >
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Filter className="h-4 w-4" aria-hidden />
          Filters
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
          <FormField label="Entity">
            <Select value={draftEntity || "all"} onValueChange={(v) => setDraftEntity(v === "all" ? "" : v)}>
              <SelectTrigger
                aria-label="Filter by entity type"
                data-testid="audit-filter-entity"
              >
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {ENTITY_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t.replace(/^ops_/, "").replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Action">
            <Select value={draftAction || "all"} onValueChange={(v) => setDraftAction(v === "all" ? "" : v)}>
              <SelectTrigger
                aria-label="Filter by action"
                data-testid="audit-filter-action"
              >
                <SelectValue placeholder="All" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                {ACTIONS.map((a) => (
                  <SelectItem key={a} value={a}>
                    {a.replace(/_/g, " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </FormField>
          <FormField label="Actor">
            <Input
              value={draftActor}
              onChange={(e) => setDraftActor(e.target.value)}
              placeholder="email or role"
              aria-label="Filter by actor"
              data-testid="audit-filter-actor"
            />
          </FormField>
          <FormField label="Since">
            <Input
              type="date"
              value={draftSince}
              onChange={(e) => setDraftSince(e.target.value)}
              aria-label="Filter since date"
              data-testid="audit-filter-since"
            />
          </FormField>
          <FormField label="Until">
            <Input
              type="date"
              value={draftUntil}
              onChange={(e) => setDraftUntil(e.target.value)}
              aria-label="Filter until date"
              data-testid="audit-filter-until"
            />
          </FormField>
        </div>
        <div className="flex items-center justify-end gap-2">
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={clear}
            data-testid="audit-filter-clear"
          >
            Clear
          </Button>
          <Button
            type="button"
            size="sm"
            variant="gradient"
            onClick={apply}
            data-testid="audit-filter-apply"
          >
            Apply
          </Button>
        </div>
      </section>

      {/* Results */}
      <section
        className="rounded-lg border bg-white"
        aria-label="Audit trail results"
      >
        <div className="px-3 py-2 border-b flex items-center justify-between">
          <h2 className="text-sm font-medium" style={{ color: "#1E1B4B" }}>
            Events
          </h2>
          {!isLoading && (
            <span className="text-[11px] text-muted-foreground portal-num">
              {total} total
              {isFetching && (
                <RefreshCw className="inline h-3 w-3 ml-1 animate-spin" />
              )}
            </span>
          )}
        </div>

        {error && (
          <div
            className="m-3 rounded-md bg-destructive/10 border border-destructive/30 p-3 text-sm text-destructive"
            role="alert"
          >
            Couldn't load audit events — please try again.
          </div>
        )}

        {isLoading ? (
          <div className="p-3 space-y-2" data-testid="audit-viewer-loading">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full rounded-md" />
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div
            className="m-3 rounded-lg border border-dashed p-8 text-center"
            data-testid="audit-viewer-empty"
          >
            <FileText
              className="h-7 w-7 mx-auto text-muted-foreground mb-2"
              aria-hidden
            />
            <p className="text-sm text-muted-foreground">
              No audit events match these filters.
            </p>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-stone-50 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                    <th className="px-3 py-2 w-8"></th>
                    <th className="px-3 py-2 font-medium">When</th>
                    <th className="px-3 py-2 font-medium">Actor</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                    <th className="px-3 py-2 font-medium">Entity</th>
                    <th className="px-3 py-2 font-medium">ID</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((ev) => (
                    <EventTableRow key={ev.id} ev={ev} />
                  ))}
                </tbody>
              </table>
            </div>
            {hasMore && (
              <div className="border-t p-2 text-center">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={isFetching}
                  data-testid="audit-viewer-load-more"
                >
                  {isFetching ? "Loading…" : "Load more"}
                </Button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
