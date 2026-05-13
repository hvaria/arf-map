/**
 * F3 — Audit trail storage (append-only).
 *
 * Pattern reused: mirrors the storage-function shape of
 * `server/ops/opsStorage.ts` (Module 1–6) — module-level async functions
 * that use the shared Drizzle `db` from `server/db/index.ts`, no class
 * wrappers, no fresh pool connections.
 *
 * Tamper-evidence v0 = "the table has no mutation surface in code." We
 * deliberately do NOT export update/delete helpers. The only writer is
 * `recordAudit()`; the only reader is `listAuditForEntity()`.
 *
 * Risk R6 mitigation: cap `before_json` / `after_json` at 16 KB per
 * column. Anything larger gets a trailing `...(truncated)` marker so the
 * row is still useful for an inspector without leaking arbitrarily large
 * PHI payloads into the audit table.
 */

import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "../db/index";
import {
  opsAuditTrail,
  type OpsAuditTrailEntry,
} from "./opsSchema";

// Cap each JSON blob at 16 KB. Pick the value once; share it with the
// tests so the truncation behavior stays observable.
export const AUDIT_JSON_MAX_BYTES = 16 * 1024;
const TRUNCATION_MARKER = "...(truncated)";

export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "attach_evidence"
  | "detach_evidence"
  | "resolve"
  | "close"
  | "reopen";

export interface AuditEvent {
  facilityNumber: string;
  actorId: string;
  actorRole: string;
  action: AuditAction;
  entityType: string;
  entityId: number;
  before?: unknown;
  after?: unknown;
}

/**
 * Serialize a value to JSON and truncate to AUDIT_JSON_MAX_BYTES bytes
 * (UTF-8). When truncated, append a marker so readers know data was
 * cut. Returns null for null/undefined input.
 */
function serializeAndCap(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    // Circular ref or non-serializable — store a stub rather than throw.
    return "(unserializable)";
  }
  // Byte-length check via TextEncoder so we don't mis-measure multi-byte
  // characters. If under the cap, return as-is.
  const enc = new TextEncoder();
  const bytes = enc.encode(json);
  if (bytes.byteLength <= AUDIT_JSON_MAX_BYTES) return json;
  // Truncate by characters until under (cap - marker length) bytes. Then
  // append the marker. This is O(n) at worst but acceptable on a 16 KB
  // budget that fires only on outliers.
  const budget = AUDIT_JSON_MAX_BYTES - TRUNCATION_MARKER.length;
  // Binary search for the largest substring whose byte length fits.
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

/**
 * Append a single audit-trail row. Insert-only by design — there is no
 * update/delete sibling. Callers wrap their invocation in try/catch
 * because an audit failure must not roll back the user-visible mutation.
 */
export async function recordAudit(ev: AuditEvent): Promise<void> {
  if (!ev.facilityNumber) throw new Error("facilityNumber is required");
  if (!ev.actorId) throw new Error("actorId is required");
  await db.insert(opsAuditTrail).values({
    facilityNumber: ev.facilityNumber,
    actorId: ev.actorId,
    actorRole: ev.actorRole,
    action: ev.action,
    entityType: ev.entityType,
    entityId: ev.entityId,
    beforeJson: serializeAndCap(ev.before),
    afterJson: serializeAndCap(ev.after),
    occurredAt: Date.now(),
  });
}

/**
 * List audit rows for one (entity_type, entity_id) tuple, scoped to a
 * facility. Tenant filter is enforced here at the storage layer — not just
 * at the router — so a misplaced caller can't accidentally cross-read.
 *
 * Returns rows in chronological ascending order (oldest first) so the UI
 * renders the history top→bottom without an additional sort. Capped at
 * 500 rows; if a single entity has more than that, surface the most
 * recent 500.
 */
export async function listAuditForEntity(
  facilityNumber: string,
  entityType: string,
  entityId: number,
): Promise<OpsAuditTrailEntry[]> {
  return db
    .select({
      id: opsAuditTrail.id,
      facilityNumber: opsAuditTrail.facilityNumber,
      actorId: opsAuditTrail.actorId,
      actorRole: opsAuditTrail.actorRole,
      action: opsAuditTrail.action,
      entityType: opsAuditTrail.entityType,
      entityId: opsAuditTrail.entityId,
      beforeJson: opsAuditTrail.beforeJson,
      afterJson: opsAuditTrail.afterJson,
      occurredAt: opsAuditTrail.occurredAt,
    })
    .from(opsAuditTrail)
    .where(
      and(
        eq(opsAuditTrail.facilityNumber, facilityNumber),
        eq(opsAuditTrail.entityType, entityType),
        eq(opsAuditTrail.entityId, entityId),
      ),
    )
    .orderBy(asc(opsAuditTrail.occurredAt), asc(opsAuditTrail.id))
    .limit(500);
}

/**
 * Paginated list of audit rows for a facility, optionally filtered by
 * (entity_type, entity_id). Used by the GET /api/ops/facilities/:fn/audit-trail
 * route. Newest first to match the typical "what happened recently" UI.
 */
export async function listAuditForFacility(
  facilityNumber: string,
  opts: {
    entityType?: string;
    entityId?: number;
    page: number;
    limit: number;
  },
): Promise<{ rows: OpsAuditTrailEntry[]; total: number }> {
  // Build conditions dynamically — Drizzle's `and(...)` happily takes
  // undefined entries via filtering.
  const conds = [eq(opsAuditTrail.facilityNumber, facilityNumber)];
  if (opts.entityType) conds.push(eq(opsAuditTrail.entityType, opts.entityType));
  if (typeof opts.entityId === "number") {
    conds.push(eq(opsAuditTrail.entityId, opts.entityId));
  }
  const where = and(...conds);

  const offset = (opts.page - 1) * opts.limit;
  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(opsAuditTrail)
      .where(where)
      .orderBy(desc(opsAuditTrail.occurredAt), desc(opsAuditTrail.id))
      .limit(opts.limit)
      .offset(offset),
    db.select({ count: sql<number>`count(*)::int` }).from(opsAuditTrail).where(where),
  ]);
  return { rows, total: countRows[0]?.count ?? 0 };
}
