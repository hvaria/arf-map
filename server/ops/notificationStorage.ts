/**
 * Wave 3 W14 — Daily-summary notification log (append-only).
 *
 * Pattern mirrored verbatim from `server/ops/auditStorage.ts`:
 *   - Module-level async functions (no class wrappers).
 *   - Shared Drizzle `db` from `server/db/index.ts`.
 *   - Insert-only contract: the API surface exposes recordNotification +
 *     listNotifications. No update / delete / clear sibling.
 *   - Tenant isolation enforced at the storage layer — `facility_number`
 *     is on every WHERE clause.
 *
 * `triageSnapshot` is JSON-as-TEXT capped at `AUDIT_JSON_MAX_BYTES` (16 KB)
 * so an inspector can reconstruct what the daily-summary email reported on
 * without persisting an arbitrarily large blob of (potentially PHI-tinted)
 * triage payload. The truncation marker matches the audit module exactly.
 *
 * `bodyPreview` is capped at 500 chars by the caller, but we trim
 * defensively here too so a future caller that forgets the cap doesn't
 * accidentally bloat the table.
 */

import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../db/index";
import { AUDIT_JSON_MAX_BYTES } from "./auditStorage";
import {
  opsNotificationLog,
  type OpsNotificationLogEntry,
} from "./opsSchema";

export const NOTIFICATION_BODY_PREVIEW_MAX = 500;
export const NOTIFICATION_SNAPSHOT_MAX_BYTES = AUDIT_JSON_MAX_BYTES;
const TRUNCATION_MARKER = "...(truncated)";

export type NotificationKind =
  | "daily_summary"
  | "incident_sla_warning"
  | "manual_test";

export type DeliveryStatus = "queued" | "sent" | "failed";

export interface RecordNotificationInput {
  facilityNumber: string;
  channel: "email";
  kind: NotificationKind;
  recipient: string;
  subject: string;
  bodyPreview?: string;
  triageSnapshot?: unknown;
  scheduledFor: number;
  deliveryStatus: DeliveryStatus;
  deliveryError?: string;
  resendMessageId?: string;
  sentAt?: number;
}

/**
 * Cap a value to NOTIFICATION_SNAPSHOT_MAX_BYTES of serialised JSON, then
 * return a JS value suitable for a Drizzle jsonb insert.
 *
 * Phase 2 R2: triage_snapshot is JSONB now. The previous implementation
 * byte-truncated the serialised string with a "...(truncated)" marker; that
 * is INVALID JSON, which is fine for a TEXT column but fatal for JSONB on
 * subsequent reads or migration casts. The replacement substitutes a
 * sentinel object so an inspector still sees the original size + a 512-byte
 * preview without breaking JSONB shape invariants.
 *
 * Callers MUST NOT JSON.stringify the result before handing it to Drizzle —
 * jsonb wants the object itself, not a string.
 */
function serializeAndCap(value: unknown): unknown | null {
  if (value === undefined || value === null) return null;
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return { _truncated: true, _reason: "unserializable" };
  }
  const enc = new TextEncoder();
  const bytes = enc.encode(json).byteLength;
  if (bytes <= NOTIFICATION_SNAPSHOT_MAX_BYTES) return value;
  return {
    _truncated: true,
    _originalSizeBytes: bytes,
    _maxBytes: NOTIFICATION_SNAPSHOT_MAX_BYTES,
    _preview: json.slice(0, 512),
  };
}

function trimPreview(s: string | undefined): string | null {
  if (s === undefined || s === null) return null;
  if (s.length <= NOTIFICATION_BODY_PREVIEW_MAX) return s;
  return s.slice(0, NOTIFICATION_BODY_PREVIEW_MAX - TRUNCATION_MARKER.length) +
    TRUNCATION_MARKER;
}

/**
 * Append a single notification-log row. Insert-only by design — there is
 * no update/delete sibling. Callers wrap this in try/catch because a log
 * failure must not take the outbound email out (just like audit emission).
 */
export async function recordNotification(
  input: RecordNotificationInput,
): Promise<OpsNotificationLogEntry> {
  if (!input.facilityNumber) throw new Error("facilityNumber is required");
  if (!input.recipient) throw new Error("recipient is required");
  const now = Date.now();
  const rows = await db
    .insert(opsNotificationLog)
    .values({
      facilityNumber: input.facilityNumber,
      channel: input.channel,
      kind: input.kind,
      recipient: input.recipient,
      subject: input.subject,
      bodyPreview: trimPreview(input.bodyPreview),
      deliveryStatus: input.deliveryStatus,
      deliveryError: input.deliveryError ?? null,
      resendMessageId: input.resendMessageId ?? null,
      triageSnapshot: serializeAndCap(input.triageSnapshot),
      scheduledFor: input.scheduledFor,
      sentAt: input.sentAt ?? null,
      createdAt: now,
    })
    .returning();
  return rows[0] as OpsNotificationLogEntry;
}

export interface ListNotificationsOpts {
  kind?: NotificationKind;
  deliveryStatus?: DeliveryStatus;
  sinceMs?: number;
  untilMs?: number;
  page: number;
  limit: number;
}

/**
 * Paginated list of notification rows for a facility, optionally filtered
 * by kind / delivery_status and a scheduled_for time range. Newest first,
 * mirroring the audit-trail viewer.
 *
 * Tenant filter is enforced here at the storage layer for defense in depth
 * on top of the router's IDOR guard.
 */
export async function listNotifications(
  facilityNumber: string,
  opts: ListNotificationsOpts,
): Promise<{ rows: OpsNotificationLogEntry[]; total: number }> {
  const conds = [eq(opsNotificationLog.facilityNumber, facilityNumber)];
  if (opts.kind) conds.push(eq(opsNotificationLog.kind, opts.kind));
  if (opts.deliveryStatus) {
    conds.push(eq(opsNotificationLog.deliveryStatus, opts.deliveryStatus));
  }
  if (typeof opts.sinceMs === "number") {
    conds.push(gte(opsNotificationLog.scheduledFor, opts.sinceMs));
  }
  if (typeof opts.untilMs === "number") {
    conds.push(lt(opsNotificationLog.scheduledFor, opts.untilMs));
  }
  const where = and(...conds);
  const offset = (opts.page - 1) * opts.limit;
  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(opsNotificationLog)
      .where(where)
      .orderBy(
        desc(opsNotificationLog.scheduledFor),
        desc(opsNotificationLog.id),
      )
      .limit(opts.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsNotificationLog)
      .where(where),
  ]);
  return { rows, total: countRows[0]?.count ?? 0 };
}

/**
 * Count rows matching the given filter. Used by the daily-summary
 * scheduler's idempotency check ("has this facility already received a
 * daily_summary in the current UTC day?").
 */
export async function countNotifications(
  facilityNumber: string,
  opts: {
    kind?: NotificationKind;
    deliveryStatus?: DeliveryStatus;
    sinceMs?: number;
    untilMs?: number;
  },
): Promise<number> {
  const conds = [eq(opsNotificationLog.facilityNumber, facilityNumber)];
  if (opts.kind) conds.push(eq(opsNotificationLog.kind, opts.kind));
  if (opts.deliveryStatus) {
    conds.push(eq(opsNotificationLog.deliveryStatus, opts.deliveryStatus));
  }
  if (typeof opts.sinceMs === "number") {
    conds.push(gte(opsNotificationLog.scheduledFor, opts.sinceMs));
  }
  if (typeof opts.untilMs === "number") {
    conds.push(lt(opsNotificationLog.scheduledFor, opts.untilMs));
  }
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(opsNotificationLog)
    .where(and(...conds));
  return rows[0]?.count ?? 0;
}
