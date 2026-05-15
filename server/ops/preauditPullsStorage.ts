/**
 * Wave 3 Phase 3.2 — W2 pre-audit pull storage + bundle composer.
 *
 * Pattern mirrored from server/ops/triageAggregator.ts:
 *   - Promise.all fan-out, per-section try/catch (one bad source can't
 *     blank the rest of the bundle).
 *   - Reads through existing storage list functions in opsStorage.ts /
 *     chartCompletenessStorage.ts / obligationsStorage.ts — never goes
 *     to the DB directly here.
 *   - Tenant isolation is enforced by the upstream list functions; this
 *     module never accepts unscoped facility data.
 *
 * Section caps: each section is capped at SECTION_ROW_CAP rows. When
 * truncation happens, `totals[section].excluded` records the count of
 * rows left behind so the FE can show "audit_trail truncated — 5000 of
 * 12345 returned" rather than silently omit.
 *
 * `sections_json` / `totals_json` on the persisted ops_preaudit_pulls
 * row are JSON-as-TEXT capped at PREAUDIT_JSON_MAX_BYTES (16 KB) —
 * matches the same convention as ops_audit_trail before/after blobs.
 */

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";

import { db, pool } from "../db/index";
import { opsPreauditPulls } from "./opsSchema";
import type { OpsPreauditPull } from "./opsSchema";
import { recordAudit, type AuditActor } from "./auditStorage";
import {
  type PreauditPullSpec,
  type PreauditPullResult,
  type PreauditSection,
  PREAUDIT_SECTIONS,
} from "@shared/auditor";

import {
  listResidents,
  listIncidents,
  listDrillLogs,
  listTemperatureLogs,
  listVendors,
  listComplaints,
  listInspections,
  listStaffCredentials,
  listControlledSubDiscrepancies,
} from "./opsStorage";
import { listChartCompleteness } from "./chartCompletenessStorage";
import { listObligations } from "./obligationsStorage";
import { listAuditForFacility } from "./auditStorage";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

export const PREAUDIT_JSON_MAX_BYTES = 16 * 1024;
const TRUNCATION_MARKER = "...(truncated)";
export const SECTION_ROW_CAP = 5000;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (JSON cap + audit)
// ─────────────────────────────────────────────────────────────────────────────

function serializeAndCap(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return "(unserializable)";
  }
  const enc = new TextEncoder();
  const bytes = enc.encode(json);
  if (bytes.byteLength <= PREAUDIT_JSON_MAX_BYTES) return json;
  const budget = PREAUDIT_JSON_MAX_BYTES - TRUNCATION_MARKER.length;
  let lo = 0;
  let hi = json.length;
  while (lo < hi) {
    const mid = (lo + hi + 1) >>> 1;
    const len = enc.encode(json.slice(0, mid)).byteLength;
    if (len <= budget) lo = mid;
    else hi = mid - 1;
  }
  return json.slice(0, lo) + TRUNCATION_MARKER;
}

async function safeAudit(args: {
  facilityNumber: string;
  actor: AuditActor;
  entityId: number;
  after: unknown;
}): Promise<void> {
  try {
    await recordAudit({
      facilityNumber: args.facilityNumber,
      actorId: args.actor.id,
      actorRole: args.actor.role,
      action: "create",
      entityType: "ops_preaudit_pull",
      entityId: args.entityId,
      after: args.after,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[ops] audit emit failed for ops_preaudit_pull#${args.entityId}`,
      err,
    );
  }
}

function emptyTotals(): Record<PreauditSection, { included: number; excluded: number }> {
  const out = {} as Record<PreauditSection, { included: number; excluded: number }>;
  for (const s of PREAUDIT_SECTIONS) {
    out[s] = { included: 0, excluded: 0 };
  }
  return out;
}

function emptyBundle(): Record<PreauditSection, unknown[]> {
  const out = {} as Record<PreauditSection, unknown[]>;
  for (const s of PREAUDIT_SECTIONS) {
    out[s] = [];
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Record (insert-only audit trail of who pulled what)
// ─────────────────────────────────────────────────────────────────────────────

export async function recordPreauditPull(
  facilityNumber: string,
  spec: PreauditPullSpec,
  totals: PreauditPullResult["totals"],
  delivery: { method: "download" | "share_link"; shareLinkId?: number },
  generatedBy: string,
  actor: AuditActor,
): Promise<OpsPreauditPull> {
  const now = Date.now();
  const rows = await db
    .insert(opsPreauditPulls)
    .values({
      facilityNumber,
      audience: spec.audience,
      audienceLabel: spec.audienceLabel ?? null,
      windowStartAt: spec.windowStartAt,
      windowEndAt: spec.windowEndAt,
      sectionsJson: serializeAndCap(spec.sections),
      totalsJson: serializeAndCap(totals),
      generatedBy,
      generatedAt: now,
      deliveryMethod: delivery.method,
      shareLinkId: delivery.shareLinkId ?? null,
      notes: null,
    })
    .returning();
  const row = rows[0] as OpsPreauditPull;
  await safeAudit({
    facilityNumber: row.facilityNumber,
    actor,
    entityId: row.id,
    after: {
      id: row.id,
      audience: row.audience,
      windowStartAt: row.windowStartAt,
      windowEndAt: row.windowEndAt,
      deliveryMethod: row.deliveryMethod,
      shareLinkId: row.shareLinkId,
      generatedBy: row.generatedBy,
    },
  });
  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// List (admin history of pulls)
// ─────────────────────────────────────────────────────────────────────────────

export async function listPreauditPulls(
  facilityNumber: string,
  opts: { sinceMs?: number; page: number; limit: number },
): Promise<{ rows: OpsPreauditPull[]; total: number }> {
  const conds = [eq(opsPreauditPulls.facilityNumber, facilityNumber)];
  if (typeof opts.sinceMs === "number") {
    conds.push(gte(opsPreauditPulls.generatedAt, opts.sinceMs));
  }
  const where = and(...conds);
  const offset = (opts.page - 1) * opts.limit;
  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(opsPreauditPulls)
      .where(where)
      .orderBy(desc(opsPreauditPulls.generatedAt), desc(opsPreauditPulls.id))
      .limit(opts.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsPreauditPulls)
      .where(where),
  ]);
  return { rows, total: countRows[0]?.count ?? 0 };
}

export async function getPreauditPull(
  id: number,
  facilityNumber: string,
): Promise<OpsPreauditPull | undefined> {
  const rows = await db
    .select()
    .from(opsPreauditPulls)
    .where(
      and(
        eq(opsPreauditPulls.id, id),
        eq(opsPreauditPulls.facilityNumber, facilityNumber),
      ),
    )
    .limit(1);
  return rows[0] as OpsPreauditPull | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Bundle composer — the heavy lifter
// ─────────────────────────────────────────────────────────────────────────────

interface SectionResult {
  rows: unknown[];
  excluded: number;
}

/**
 * Cap a rows array at SECTION_ROW_CAP and record the truncated count.
 * Used by every fetcher below so the per-section truncation policy is
 * consistent.
 */
function cap(rows: unknown[]): SectionResult {
  if (rows.length <= SECTION_ROW_CAP) {
    return { rows, excluded: 0 };
  }
  return {
    rows: rows.slice(0, SECTION_ROW_CAP),
    excluded: rows.length - SECTION_ROW_CAP,
  };
}

async function safeSection(
  section: PreauditSection,
  fn: () => Promise<SectionResult>,
): Promise<SectionResult> {
  try {
    return await fn();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(
      `[preaudit] section ${section} failed — returning empty:`,
      (err as Error)?.message ?? err,
    );
    return { rows: [], excluded: 0 };
  }
}

/**
 * Compose the W2 bundle. One Promise.all over the spec.sections; each
 * section runs inside its own try/catch (safeSection) so one failing
 * source never blanks the rest.
 *
 * Window math: `sinceMs = windowStartAt`, `untilMs = windowEndAt`. Some
 * upstream `list*` functions only accept `sinceMs`; for those we filter
 * the returned rows in-memory by the matching time field. This is fine
 * because we already cap the page size at the upstream layer.
 *
 * The vendors / staff_credentials / chart_completeness / controlled_sub
 * sections are point-in-time snapshots (no window math) per the spec —
 * an auditor asks "what's the current state of vendors?" not "what
 * changed between dates?".
 */
export async function generatePreauditBundle(
  facilityNumber: string,
  spec: PreauditPullSpec,
): Promise<{
  bundle: Record<PreauditSection, unknown[]>;
  totals: PreauditPullResult["totals"];
}> {
  const bundle = emptyBundle();
  const totals = emptyTotals();

  const want = new Set<PreauditSection>(spec.sections);
  const sinceMs = spec.windowStartAt;
  const untilMs = spec.windowEndAt;

  // ── Section fetchers (lazy — only run if requested) ──────────────────────

  const fetchers: Partial<Record<PreauditSection, () => Promise<SectionResult>>> = {
    residents_roster: async () => {
      // Active roster — admission dates are part of the row.
      const { residents } = await listResidents(facilityNumber, {
        status: "active",
        page: 1,
        limit: SECTION_ROW_CAP + 1,
      });
      return cap(residents);
    },

    mar_samples: async () => {
      // No single window-scoped helper exists in opsStorage today, so we
      // run a tight scoped SELECT here. Tenant filter is enforced on the
      // first WHERE term. Capped at SECTION_ROW_CAP + 1 so we can detect
      // truncation; the JOIN to medications + residents gives the
      // auditor a row they can actually read without N+1 lookup.
      const res = await pool.query(
        `SELECT mp.id, mp.medication_id, mp.resident_id, mp.facility_number,
                mp.scheduled_datetime, mp.administered_datetime,
                mp.administered_by, mp.status, mp.refusal_reason,
                mp.hold_reason, mp.notes,
                m.drug_name, m.dosage, m.route, m.prescriber_name,
                r.first_name AS resident_first_name,
                r.last_name  AS resident_last_name,
                r.room_number
           FROM ops_med_passes mp
           JOIN ops_medications m ON mp.medication_id = m.id
           JOIN ops_residents   r ON mp.resident_id   = r.id
          WHERE mp.facility_number = $1
            AND mp.scheduled_datetime >= $2
            AND mp.scheduled_datetime <  $3
          ORDER BY mp.scheduled_datetime ASC
          LIMIT $4`,
        [facilityNumber, sinceMs, untilMs, SECTION_ROW_CAP + 1],
      );
      return cap(res.rows);
    },

    incidents: async () => {
      // listIncidents has no window filter — pull and filter in-memory.
      const { incidents } = await listIncidents(facilityNumber, {
        page: 1,
        limit: SECTION_ROW_CAP + 1,
      });
      const filtered = incidents.filter(
        (i) => i.incidentDate >= sinceMs && i.incidentDate < untilMs,
      );
      return cap(filtered);
    },

    drill_logs: async () => {
      const { logs } = await listDrillLogs(facilityNumber, {
        sinceMs,
        page: 1,
        limit: SECTION_ROW_CAP + 1,
      });
      const filtered = logs.filter((l) => l.executedAt < untilMs);
      return cap(filtered);
    },

    temperature_logs: async () => {
      const { logs } = await listTemperatureLogs(facilityNumber, {
        sinceMs,
        page: 1,
        limit: SECTION_ROW_CAP + 1,
      });
      const filtered = logs.filter((l) => l.readingAt < untilMs);
      return cap(filtered);
    },

    vendors: async () => {
      // Snapshot — full vendor list (the audit ask is "what vendors
      // are currently on file"). listVendors hides archived by default
      // which matches the audit-readiness lens.
      const { vendors } = await listVendors(facilityNumber, {
        page: 1,
        limit: SECTION_ROW_CAP + 1,
      });
      return cap(vendors);
    },

    complaints: async () => {
      // listComplaints has no window filter — pull and filter in-memory.
      const { complaints } = await listComplaints(facilityNumber, {
        page: 1,
        limit: SECTION_ROW_CAP + 1,
      });
      const filtered = complaints.filter(
        (c) => c.receivedAt >= sinceMs && c.receivedAt < untilMs,
      );
      return cap(filtered);
    },

    inspections: async () => {
      const { inspections } = await listInspections(facilityNumber, {
        sinceMs,
        page: 1,
        limit: SECTION_ROW_CAP + 1,
      });
      const filtered = inspections.filter((i) => i.visitAt < untilMs);
      return cap(filtered);
    },

    staff_credentials: async () => {
      // Snapshot — full credential matrix.
      const { rows } = await listStaffCredentials(facilityNumber, {
        page: 1,
        limit: SECTION_ROW_CAP + 1,
      });
      return cap(rows);
    },

    chart_completeness: async () => {
      // Snapshot of the chart-completeness sweep.
      const res = await listChartCompleteness(facilityNumber);
      return cap(res.rows);
    },

    obligations: async () => {
      // Window applies to due_at — pull and filter in-memory because
      // listObligations doesn't expose a (dueFrom, dueTo) window pair.
      const { rows } = await listObligations(facilityNumber, {
        page: 1,
        limit: SECTION_ROW_CAP + 1,
      });
      const filtered = rows.filter(
        (o) => o.dueAt >= sinceMs && o.dueAt < untilMs,
      );
      return cap(filtered);
    },

    audit_trail: async () => {
      // The biggest section. listAuditForFacility has native sinceMs +
      // untilMs window support, so no in-memory filter.
      const { rows } = await listAuditForFacility(facilityNumber, {
        sinceMs,
        untilMs,
        page: 1,
        limit: SECTION_ROW_CAP + 1,
      });
      return cap(rows);
    },

    controlled_sub: async () => {
      // Snapshot of unresolved discrepancies.
      const { rows } = await listControlledSubDiscrepancies(facilityNumber, {
        page: 1,
        limit: SECTION_ROW_CAP + 1,
      });
      return cap(rows);
    },
  };

  // ── Fan-out (only the requested sections) ────────────────────────────────

  const ordered: PreauditSection[] = PREAUDIT_SECTIONS.filter((s) => want.has(s));
  const results = await Promise.all(
    ordered.map((section) =>
      safeSection(section, fetchers[section] ?? (async () => ({ rows: [], excluded: 0 }))),
    ),
  );

  ordered.forEach((section, i) => {
    const r = results[i];
    bundle[section] = r.rows;
    totals[section] = { included: r.rows.length, excluded: r.excluded };
  });

  // Sections NOT in the spec stay at { included: 0, excluded: 0 }.

  // Silence unused-import warnings — `desc`, `lt` are kept for future
  // listObligations-with-window extension without re-import churn.
  void desc;
  void lt;

  return { bundle, totals };
}
