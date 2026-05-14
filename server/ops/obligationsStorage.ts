/**
 * Wave 2 finale — Obligation engine storage (BA §4.3, §6, §9 G3).
 *
 * Mirrors the established pattern of `server/ops/opsStorage.ts` Modules
 * 1–8 and `server/ops/staff-credentials` storage: module-level async
 * functions, shared `db` from `server/db/index`, Drizzle for typed CRUD,
 * raw SQL only when a JOIN or partial-index hit matters.
 *
 * Tenant isolation is enforced at the storage layer — `facility_number`
 * is on every WHERE clause. Soft-delete via `deleted_at IS NULL` filter
 * on list/get unless `includeDeleted=true` is passed.
 *
 * Every mutation emits an audit row via `recordAudit({ entityType:
 * 'ops_obligation', ... })`, wrapped in try/catch so an audit failure
 * never rolls back the user-visible mutation.
 *
 * The state machine (BA §6) is encoded in `ALLOWED_TRANSITIONS`.
 * `expired` is admin-initiated only — Wave 4 will add a cron-driven
 * auto-expire pass; that is NOT implemented in this module.
 *
 * Recurrence handling reuses `nextDueAt` + `parseRecurrence` from
 * `shared/obligations.ts` — we do NOT reimplement the calendar math.
 */

import { and, desc, eq, gte, isNull, lte, lt, sql } from "drizzle-orm";
import { db, pool } from "../db/index";
import { opsObligations } from "./opsSchema";
import type { InsertOpsObligation, OpsObligation } from "./opsSchema";
import {
  isTerminalStatus,
  nextDueAt,
  type ObligationStatus,
} from "@shared/obligations";
import { recordAudit, type AuditActor } from "./auditStorage";

// ─────────────────────────────────────────────────────────────────────────────
// State machine — BA §6 row "obligation"
// ─────────────────────────────────────────────────────────────────────────────
//
// pending → in_progress → submitted → under_review → approved | rejected
// approved   → closed       (Admin terminal close)
// rejected   → pending      (reopen for rework)
// pending    → expired      (admin action only, when overdue — Wave 4 adds
//                             a cron-driven auto-expire pass)
// in_progress→ expired      (same)
//
// Terminal statuses (closed | expired | rejected | approved) reject any
// further outbound transition with one exception:
//   rejected → pending  (explicitly allowed so the assignee can rework).
//
// We allow non-monotonic moves inside the active set (e.g. submitted →
// in_progress) to support an assignee pulling work back from review.
// The BA wording ("pending → any active") is interpreted strictly:
// from `pending` you can move to any other active state, and from any
// non-terminal active state you can move forward, drop back to
// `in_progress`, or be closed/rejected/expired by admin.

const ALLOWED_TRANSITIONS: Record<ObligationStatus, ObligationStatus[]> = {
  pending: ["in_progress", "submitted", "under_review", "expired", "rejected"],
  in_progress: ["pending", "submitted", "under_review", "expired", "rejected"],
  submitted: ["in_progress", "under_review", "approved", "rejected"],
  under_review: ["in_progress", "submitted", "approved", "rejected"],
  approved: ["closed"],
  rejected: ["pending"],
  closed: [],
  expired: [],
};

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function pgFirst<T>(q: Promise<T[]>): Promise<T | undefined> {
  return (await q)[0];
}

async function safeAudit(args: {
  facilityNumber: string;
  actor: AuditActor;
  action: "create" | "update" | "delete" | "resolve" | "close" | "reopen";
  before?: unknown;
  after?: unknown;
  entityId: number;
}): Promise<void> {
  try {
    await recordAudit({
      facilityNumber: args.facilityNumber,
      actorId: args.actor.id,
      actorRole: args.actor.role,
      action: args.action,
      entityType: "ops_obligation",
      entityId: args.entityId,
      before: args.before,
      after: args.after,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[ops] audit emit failed for ops_obligation#${args.entityId}`, err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────────

export interface ListObligationsOpts {
  status?: ObligationStatus;
  obligationType?: string;
  targetType?: string;
  targetId?: number;
  severity?: string;
  assignedTo?: string;
  /** due_at <= now + N days AND status non-terminal. */
  dueWithinDays?: number;
  /** due_at < now AND status non-terminal. Hot daily-triage query. */
  overdueOnly?: boolean;
  sourceEntityType?: string;
  sourceEntityId?: number;
  page: number;
  limit: number;
  includeDeleted?: boolean;
}

const NON_TERMINAL_STATUSES: ObligationStatus[] = [
  "pending",
  "in_progress",
  "submitted",
  "under_review",
];

/**
 * Paginated list with the shape `{ rows, total }` to match the rest of
 * the ops storage modules. `dueWithinDays` and `overdueOnly` are
 * mutually composable with the active-status filter so the hot daily
 * triage path hits `idx_ops_obligations_status_due`.
 */
export async function listObligations(
  facilityNumber: string,
  opts: ListObligationsOpts,
): Promise<{ rows: OpsObligation[]; total: number }> {
  const conds = [eq(opsObligations.facilityNumber, facilityNumber)];

  if (!opts.includeDeleted) {
    conds.push(isNull(opsObligations.deletedAt));
  }
  if (opts.status) conds.push(eq(opsObligations.status, opts.status));
  if (opts.obligationType) conds.push(eq(opsObligations.obligationType, opts.obligationType));
  if (opts.targetType) conds.push(eq(opsObligations.targetType, opts.targetType));
  if (typeof opts.targetId === "number") {
    conds.push(eq(opsObligations.targetId, opts.targetId));
  }
  if (opts.severity) conds.push(eq(opsObligations.severity, opts.severity));
  if (opts.assignedTo) conds.push(eq(opsObligations.assignedTo, opts.assignedTo));
  if (opts.sourceEntityType) {
    conds.push(eq(opsObligations.sourceEntityType, opts.sourceEntityType));
  }
  if (typeof opts.sourceEntityId === "number") {
    conds.push(eq(opsObligations.sourceEntityId, opts.sourceEntityId));
  }

  const now = Date.now();

  // overdueOnly + dueWithinDays both imply the obligation is in a
  // non-terminal status. We add the IN-list inline so the planner can
  // collapse against the (status, due_at) composite index.
  if (opts.overdueOnly) {
    conds.push(lt(opsObligations.dueAt, now));
    conds.push(
      sql`${opsObligations.status} IN ('pending','in_progress','submitted','under_review')`,
    );
  } else if (typeof opts.dueWithinDays === "number" && opts.dueWithinDays >= 0) {
    const cutoff = now + opts.dueWithinDays * 24 * 60 * 60 * 1000;
    conds.push(lte(opsObligations.dueAt, cutoff));
    conds.push(
      sql`${opsObligations.status} IN ('pending','in_progress','submitted','under_review')`,
    );
  }

  const where = and(...conds);
  const offset = (opts.page - 1) * opts.limit;

  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(opsObligations)
      .where(where)
      .orderBy(opsObligations.dueAt, desc(opsObligations.id))
      .limit(opts.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsObligations)
      .where(where),
  ]);
  // Silence unused-import warning for the `gte` helper (kept for future
  // range filters without re-import churn).
  void gte;

  return { rows, total: countRows[0]?.count ?? 0 };
}

export async function getObligation(
  id: number,
  facilityNumber: string,
  opts: { includeDeleted?: boolean } = {},
): Promise<OpsObligation | undefined> {
  const cond = opts.includeDeleted
    ? and(
        eq(opsObligations.id, id),
        eq(opsObligations.facilityNumber, facilityNumber),
      )
    : and(
        eq(opsObligations.id, id),
        eq(opsObligations.facilityNumber, facilityNumber),
        isNull(opsObligations.deletedAt),
      );
  return pgFirst(db.select().from(opsObligations).where(cond));
}

export async function createObligation(
  data: InsertOpsObligation,
  actor: AuditActor,
): Promise<OpsObligation> {
  const now = Date.now();
  const rows = await db
    .insert(opsObligations)
    .values({
      ...data,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    })
    .returning();
  const row = rows[0] as OpsObligation;
  await safeAudit({
    facilityNumber: row.facilityNumber,
    actor,
    action: "create",
    entityId: row.id,
    after: row,
  });
  return row;
}

export async function updateObligation(
  id: number,
  facilityNumber: string,
  partial: Partial<InsertOpsObligation>,
  actor: AuditActor,
): Promise<OpsObligation | undefined> {
  const before = await getObligation(id, facilityNumber);
  if (!before) return undefined;
  // Strip server-managed fields so a careless caller can't reset them.
  const {
    id: _ignoreId,
    facilityNumber: _ignoreFn,
    createdAt: _ignoreCreated,
    deletedAt: _ignoreDeleted,
    ...safe
  } = partial as Record<string, unknown>;
  void _ignoreId;
  void _ignoreFn;
  void _ignoreCreated;
  void _ignoreDeleted;

  const now = Date.now();
  const rows = await db
    .update(opsObligations)
    .set({ ...(safe as Partial<InsertOpsObligation>), updatedAt: now })
    .where(
      and(
        eq(opsObligations.id, id),
        eq(opsObligations.facilityNumber, facilityNumber),
        isNull(opsObligations.deletedAt),
      ),
    )
    .returning();
  const after = rows[0] as OpsObligation | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "update",
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

/**
 * State-machine-validated status transition. Throws a domain error on
 * an illegal move so the route layer can map to HTTP 400. Approval +
 * close + rejected are audit-tagged with the matching action verb so
 * the audit-trail viewer surfaces them cleanly.
 */
export async function transitionObligation(
  id: number,
  facilityNumber: string,
  toStatus: ObligationStatus,
  actor: AuditActor,
  opts: { note?: string; completedBy?: string } = {},
): Promise<OpsObligation | undefined> {
  const before = await getObligation(id, facilityNumber);
  if (!before) return undefined;

  const from = before.status as ObligationStatus;
  if (from === toStatus) {
    // No-op, but still return the row so the route is idempotent.
    return before;
  }

  const allowed = ALLOWED_TRANSITIONS[from] ?? [];
  if (!allowed.includes(toStatus)) {
    throw new Error(`Cannot transition from ${from} to ${toStatus}`);
  }

  const now = Date.now();
  const set: Partial<InsertOpsObligation> = {
    status: toStatus,
    updatedAt: now,
  };
  // Closure side-effects: when we move to a terminal `closed`, stamp
  // completed_at/by if not already set. We do NOT auto-set completed_*
  // for `approved` / `expired` — those are distinct lifecycle states.
  if (toStatus === "closed") {
    if (!before.completedAt) set.completedAt = now;
    if (opts.completedBy) set.completedBy = opts.completedBy;
  }
  if (opts.note) {
    // Append note rather than overwrite so the obligation accumulates
    // transition context. Cheap text concat; field is unbounded TEXT.
    const prefix = before.notes ? `${before.notes}\n` : "";
    set.notes = `${prefix}[${new Date(now).toISOString()}] ${from}→${toStatus}: ${opts.note}`;
  }

  const rows = await db
    .update(opsObligations)
    .set(set)
    .where(
      and(
        eq(opsObligations.id, id),
        eq(opsObligations.facilityNumber, facilityNumber),
        isNull(opsObligations.deletedAt),
      ),
    )
    .returning();
  const after = rows[0] as OpsObligation | undefined;
  if (after) {
    // Map terminal verbs to audit actions for the W15 viewer's filter.
    const action: "update" | "close" | "resolve" | "reopen" =
      toStatus === "closed"
        ? "close"
        : toStatus === "approved"
          ? "resolve"
          : from === "rejected" && toStatus === "pending"
            ? "reopen"
            : "update";
    await safeAudit({
      facilityNumber,
      actor,
      action,
      entityId: after.id,
      before,
      after,
    });
  }
  return after;
}

/**
 * Terminal-close + recurrence roll-forward. Sets the current row to
 * `closed`, stamps `completed_at`/`completed_by`, then — if a
 * `recurrence_rule` is configured — inserts a new pending row for the
 * next cycle with `due_at = nextDueAt(prev.due_at, rule)` and
 * `source_entity_type='ops_obligation', source_entity_id=<previous id>`
 * so the lineage is queryable.
 *
 * `nextDueAt` (shared/obligations.ts) is the single source of truth for
 * the calendar math — this module does NOT recompute days/months.
 *
 * Spec note: the worst-case duplicate next-cycle is acceptable (admin
 * can soft-delete) — see CLAUDE.md required reading. We therefore
 * accept two consecutive statements + audit emissions, no Postgres tx.
 */
export async function completeObligation(
  id: number,
  facilityNumber: string,
  by: string,
  actor: AuditActor,
  note?: string,
): Promise<{ closed: OpsObligation; next?: OpsObligation } | undefined> {
  const before = await getObligation(id, facilityNumber);
  if (!before) return undefined;
  if (isTerminalStatus(before.status as ObligationStatus)) {
    throw new Error(
      `Cannot complete obligation in terminal status: ${before.status}`,
    );
  }

  const now = Date.now();
  const closedRows = await db
    .update(opsObligations)
    .set({
      status: "closed",
      completedAt: now,
      completedBy: by,
      notes: note
        ? `${before.notes ? `${before.notes}\n` : ""}[${new Date(now).toISOString()}] completed by ${by}: ${note}`
        : before.notes,
      updatedAt: now,
    })
    .where(
      and(
        eq(opsObligations.id, id),
        eq(opsObligations.facilityNumber, facilityNumber),
        isNull(opsObligations.deletedAt),
      ),
    )
    .returning();
  const closed = closedRows[0] as OpsObligation | undefined;
  if (!closed) return undefined;

  await safeAudit({
    facilityNumber,
    actor,
    action: "close",
    entityId: closed.id,
    before,
    after: closed,
  });

  // Recurrence — only if rule parses to a future due_at.
  let next: OpsObligation | undefined;
  const rule = (before.recurrenceRule ?? null) as
    | "annual"
    | "quarterly"
    | "monthly"
    | `every_n_days:${number}`
    | null;
  if (rule) {
    const nextDue = nextDueAt(before.dueAt, rule);
    if (nextDue !== null) {
      const insertRows = await db
        .insert(opsObligations)
        .values({
          facilityNumber: before.facilityNumber,
          obligationType: before.obligationType,
          targetType: before.targetType,
          targetId: before.targetId,
          title: before.title,
          description: before.description,
          dueAt: nextDue,
          completedAt: null,
          completedBy: null,
          assignedTo: before.assignedTo,
          severity: before.severity,
          status: "pending",
          evidenceRequired: before.evidenceRequired,
          recurrenceRule: before.recurrenceRule,
          reminderDaysBefore: before.reminderDaysBefore,
          // Carry lineage — the new cycle is sourced from the closed row.
          sourceEntityType: "ops_obligation",
          sourceEntityId: before.id,
          notes: null,
          createdBy: actor.id,
          createdAt: now,
          updatedAt: now,
          deletedAt: null,
        })
        .returning();
      next = insertRows[0] as OpsObligation | undefined;
      if (next) {
        await safeAudit({
          facilityNumber,
          actor,
          action: "create",
          entityId: next.id,
          after: next,
        });
      }
    }
  }

  return { closed, next };
}

export async function softDeleteObligation(
  id: number,
  facilityNumber: string,
  actor: AuditActor,
): Promise<boolean> {
  const before = await getObligation(id, facilityNumber);
  if (!before) return false;
  const now = Date.now();
  const rows = await db
    .update(opsObligations)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(opsObligations.id, id),
        eq(opsObligations.facilityNumber, facilityNumber),
        isNull(opsObligations.deletedAt),
      ),
    )
    .returning({ id: opsObligations.id });
  if (rows.length > 0) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "delete",
      entityId: id,
      before,
      after: { ...before, deletedAt: now },
    });
  }
  return rows.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Legacy compliance backfill (idempotent)
// ─────────────────────────────────────────────────────────────────────────────

interface LegacyComplianceRow {
  id: number;
  facility_number: string;
  item_type: string;
  description: string;
  due_date: number;
  completed_date: number | null;
  assigned_to: string | null;
  status: string;
  reminder_days_before: number | null;
  created_at: number;
}

/**
 * Map the legacy `ops_compliance_calendar.status` enum onto the
 * obligation state machine. Legacy "overdue" is collapsed to "pending"
 * because the obligation engine derives overdue from `due_at < now`
 * dynamically — there is no static overdue state.
 */
function mapLegacyStatus(legacy: string): {
  status: ObligationStatus;
  setCompletedAt: boolean;
} {
  switch (legacy) {
    case "completed":
      return { status: "closed", setCompletedAt: true };
    case "pending":
    case "overdue":
    default:
      return { status: "pending", setCompletedAt: false };
  }
}

/**
 * One-time idempotent backfill from `ops_compliance_calendar`. For each
 * legacy row that does not already have a matching obligation
 * (`source_entity_type='legacy_compliance'`, `source_entity_id=<legacy
 * id>`), insert one. Safe to call multiple times — the `source_entity_*`
 * lookup gates re-creation.
 *
 * Returns `{ created, skipped }`.
 */
export async function backfillLegacyComplianceItems(
  facilityNumber: string,
  actor: AuditActor,
): Promise<{ created: number; skipped: number }> {
  // Pull all legacy rows for this tenant.
  const legacyRes = await pool.query<LegacyComplianceRow>(
    `SELECT id, facility_number, item_type, description, due_date,
            completed_date, assigned_to, status, reminder_days_before, created_at
       FROM ops_compliance_calendar
      WHERE facility_number = $1`,
    [facilityNumber],
  );
  if (legacyRes.rows.length === 0) return { created: 0, skipped: 0 };

  // Find which legacy ids already have an obligation. One query, tenant
  // scoped — hits idx_ops_obligations_source.
  const idsRes = await pool.query<{ source_entity_id: number }>(
    `SELECT source_entity_id
       FROM ops_obligations
      WHERE facility_number = $1
        AND source_entity_type = 'legacy_compliance'
        AND source_entity_id IS NOT NULL`,
    [facilityNumber],
  );
  const seen = new Set<number>(
    idsRes.rows.map((r) => Number(r.source_entity_id)),
  );

  let created = 0;
  let skipped = 0;
  const now = Date.now();

  for (const row of legacyRes.rows) {
    if (seen.has(Number(row.id))) {
      skipped += 1;
      continue;
    }

    const mapped = mapLegacyStatus(row.status);
    const title =
      row.description && row.description.trim().length > 0
        ? row.description
        : `Compliance: ${row.item_type}`;

    const inserted = await db
      .insert(opsObligations)
      .values({
        facilityNumber,
        obligationType: row.item_type,
        targetType: "facility",
        targetId: null,
        title,
        description: row.description ?? null,
        dueAt: Number(row.due_date),
        completedAt: mapped.setCompletedAt
          ? row.completed_date !== null
            ? Number(row.completed_date)
            : now
          : null,
        completedBy: null,
        assignedTo: row.assigned_to,
        severity: "medium",
        status: mapped.status,
        evidenceRequired: 0,
        recurrenceRule: null,
        reminderDaysBefore: row.reminder_days_before ?? 30,
        sourceEntityType: "legacy_compliance",
        sourceEntityId: Number(row.id),
        notes: null,
        createdBy: actor.id,
        createdAt: row.created_at ? Number(row.created_at) : now,
        updatedAt: now,
        deletedAt: null,
      })
      .returning();

    const newRow = inserted[0] as OpsObligation | undefined;
    if (newRow) {
      created += 1;
      await safeAudit({
        facilityNumber,
        actor,
        action: "create",
        entityId: newRow.id,
        after: newRow,
      });
    }
  }

  return { created, skipped };
}

// ─────────────────────────────────────────────────────────────────────────────
// Backward-compat shim — legacy `/compliance` endpoints
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Shape returned by the legacy `GET /api/ops/facilities/:fn/compliance`
 * route. Matches `OpsComplianceItem` from opsSchema.ts so the existing
 * `ComplianceContent.tsx` rendering keeps working unchanged.
 */
export interface LegacyComplianceShape {
  id: number;
  facilityNumber: string;
  itemType: string;
  description: string;
  dueDate: number;
  completedDate: number | null;
  assignedTo: string | null;
  status: string;
  reminderDaysBefore: number | null;
  createdAt: number;
}

/**
 * Map an obligation row down to the legacy compliance-item shape so the
 * existing frontend renders without changes. The route layer first
 * backfills, then calls this against the obligation table — see
 * `opsRouter.ts` GET /facilities/:fn/compliance.
 */
function obligationToLegacyShape(o: OpsObligation): LegacyComplianceShape {
  // Map obligation.status back to the legacy enum the FE expects.
  // Anything closed/approved => 'completed'; anything else => 'pending'
  // (with overdue derived dynamically by the FE from due_date < now,
  // which is how ComplianceContent already works).
  const legacyStatus: string =
    o.status === "closed" || o.status === "approved"
      ? "completed"
      : "pending";
  return {
    id: o.id,
    facilityNumber: o.facilityNumber,
    itemType: o.obligationType,
    description:
      o.description && o.description.length > 0 ? o.description : o.title,
    dueDate: o.dueAt,
    completedDate: o.completedAt,
    assignedTo: o.assignedTo,
    status: legacyStatus,
    reminderDaysBefore: o.reminderDaysBefore,
    createdAt: o.createdAt,
  };
}

/**
 * Legacy GET shim — read obligations for the facility and project them
 * down to the historic compliance shape. Tenant filter is on the query;
 * caller should run `backfillLegacyComplianceItems` first.
 */
export async function listObligationsAsLegacyCompliance(
  facilityNumber: string,
  status?: string,
): Promise<LegacyComplianceShape[]> {
  const conds = [
    eq(opsObligations.facilityNumber, facilityNumber),
    isNull(opsObligations.deletedAt),
  ];
  if (status === "completed") {
    conds.push(
      sql`${opsObligations.status} IN ('closed','approved')`,
    );
  } else if (status === "pending" || status === "overdue") {
    // Legacy "overdue" is derived (due_date < now) — both map to the
    // active set for the obligation engine.
    conds.push(
      sql`${opsObligations.status} IN ('pending','in_progress','submitted','under_review','rejected')`,
    );
  }
  const rows = await db
    .select()
    .from(opsObligations)
    .where(and(...conds))
    .orderBy(opsObligations.dueAt);
  return rows.map(obligationToLegacyShape);
}

/**
 * Legacy POST shim — accept the old compliance-item create shape and
 * write into `ops_obligations`. Defaults: target_type='facility',
 * severity='medium', evidence_required=0. The legacy table is left
 * untouched.
 */
export async function createObligationFromLegacyShape(
  data: {
    facilityNumber: string;
    itemType: string;
    description: string;
    dueDate: number;
    assignedTo?: string | null;
    status?: string | null;
    reminderDaysBefore?: number | null;
  },
  actor: AuditActor,
): Promise<LegacyComplianceShape> {
  const now = Date.now();
  const mapped = data.status
    ? mapLegacyStatus(data.status)
    : { status: "pending" as ObligationStatus, setCompletedAt: false };
  const row = await createObligation(
    {
      facilityNumber: data.facilityNumber,
      obligationType: data.itemType,
      targetType: "facility",
      targetId: null,
      title: data.description,
      description: data.description,
      dueAt: data.dueDate,
      completedAt: mapped.setCompletedAt ? now : null,
      completedBy: null,
      assignedTo: data.assignedTo ?? null,
      severity: "medium",
      status: mapped.status,
      evidenceRequired: 0,
      recurrenceRule: null,
      reminderDaysBefore: data.reminderDaysBefore ?? 30,
      sourceEntityType: null,
      sourceEntityId: null,
      notes: null,
      createdBy: actor.id,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    },
    actor,
  );
  return obligationToLegacyShape(row);
}

/**
 * Legacy PUT-complete shim — close an obligation by id. Falls back to a
 * legacy-source lookup if the caller passed a legacy compliance id that
 * hasn't been backfilled yet (rare; the GET path calls backfill first).
 */
export async function completeObligationFromLegacyShape(
  id: number,
  facilityNumber: string,
  completedDate: number,
  actor: AuditActor,
): Promise<boolean> {
  // First try id-direct.
  const direct = await getObligation(id, facilityNumber);
  if (direct) {
    if (isTerminalStatus(direct.status as ObligationStatus)) return true;
    const closed = await db
      .update(opsObligations)
      .set({
        status: "closed",
        completedAt: completedDate,
        updatedAt: Date.now(),
      })
      .where(
        and(
          eq(opsObligations.id, id),
          eq(opsObligations.facilityNumber, facilityNumber),
          isNull(opsObligations.deletedAt),
        ),
      )
      .returning();
    const after = closed[0] as OpsObligation | undefined;
    if (after) {
      await safeAudit({
        facilityNumber,
        actor,
        action: "close",
        entityId: after.id,
        before: direct,
        after,
      });
      return true;
    }
    return false;
  }
  // Fallback: maybe `id` references a legacy row that wasn't backfilled.
  const bySource = await pgFirst(
    db
      .select()
      .from(opsObligations)
      .where(
        and(
          eq(opsObligations.facilityNumber, facilityNumber),
          eq(opsObligations.sourceEntityType, "legacy_compliance"),
          eq(opsObligations.sourceEntityId, id),
          isNull(opsObligations.deletedAt),
        ),
      ),
  );
  if (!bySource) return false;
  if (isTerminalStatus(bySource.status as ObligationStatus)) return true;
  const closed = await db
    .update(opsObligations)
    .set({
      status: "closed",
      completedAt: completedDate,
      updatedAt: Date.now(),
    })
    .where(eq(opsObligations.id, bySource.id))
    .returning();
  const after = closed[0] as OpsObligation | undefined;
  if (after) {
    await safeAudit({
      facilityNumber,
      actor,
      action: "close",
      entityId: after.id,
      before: bySource,
      after,
    });
    return true;
  }
  return false;
}

/**
 * Legacy overdue read — same projection as
 * `listObligationsAsLegacyCompliance` but with the additional
 * `due_at < now` and "not yet closed/approved" filter.
 */
export async function listOverdueObligationsAsLegacy(
  facilityNumber: string,
): Promise<LegacyComplianceShape[]> {
  const now = Date.now();
  const rows = await db
    .select()
    .from(opsObligations)
    .where(
      and(
        eq(opsObligations.facilityNumber, facilityNumber),
        isNull(opsObligations.deletedAt),
        lt(opsObligations.dueAt, now),
        sql`${opsObligations.status} IN ('pending','in_progress','submitted','under_review','rejected')`,
      ),
    )
    .orderBy(opsObligations.dueAt);
  return rows.map(obligationToLegacyShape);
}

// Re-export for callers that want the canonical helper / type list.
export { NON_TERMINAL_STATUSES, ALLOWED_TRANSITIONS };
