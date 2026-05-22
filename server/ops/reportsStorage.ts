/**
 * Wave 5 — Reports Hub storage layer.
 *
 * Pattern mirrors server/ops/preauditPullsStorage.ts and server/ops/
 * evidenceStorage.ts:
 *   - module-level async functions on the shared Drizzle `db` /
 *     pool from `server/db/index.ts`.
 *   - tenant isolation enforced at the storage layer — facility_number is
 *     in every WHERE clause for defense in depth.
 *   - audit-trail emission via recordAudit, wrapped in try/catch so an
 *     audit failure never rolls back the user-visible mutation.
 *
 * File persistence delegates to the existing FlyVolumeAdapter from
 * evidenceStorage.ts (extended with an optional `subdir` arg). Report
 * bytes land at:
 *     /data/evidence/<facility>/reports/ops_report/<report_id>/<filename>
 * which keeps generated reports visually separate from raw evidence
 * uploads on disk while reusing the proven storage path + sha256 +
 * sanitization stack.
 *
 * Lifecycle:
 *   createReportStub  → status='generating', storage_uri=null
 *   markReportReady   → file bytes written, sha256 + byte_size set,
 *                       status='ready'
 *   markReportFailed  → terminal; failure_reason set
 *   streamReport      → bumps download_count, returns a readable stream
 *                       (never buffers the file into memory)
 *   softDeleteReport  → sets deleted_at; file bytes stay on disk until
 *                       the retention cron purges them
 */

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { and, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";

import { db } from "../db/index";
import { opsReports, type OpsReport } from "./opsSchema";
import { recordAudit, type AuditActor } from "./auditStorage";
import {
  getStorageAdapter,
  type StorageAdapter,
} from "./evidenceStorage";
import {
  REPORT_DEFAULT_RETENTION_DAYS,
  reportExtensionForMime,
  buildReportFilename,
  type ReportKind,
  type ReportStatus,
  type ReportMimeType,
} from "@shared/reports";

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per-report byte cap. Reports can be substantially larger than evidence
 * attachments (a monthly statement PDF or a tracker CSV across 92 days
 * can run multiple MB), so we lift the evidence 5 MB cap to 50 MB here.
 * Generators that exceed this throw before persist.
 */
export const MAX_REPORT_BYTES = 50 * 1024 * 1024;

/**
 * Truncate a free-text failure reason to a sensible bound before we write
 * it to the row. We don't want a stack trace blob to blow up the column.
 */
const FAILURE_REASON_MAX = 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Input shapes
// ─────────────────────────────────────────────────────────────────────────────

export interface CreateReportInput {
  facilityNumber: string;
  reportKind: ReportKind;
  title: string;
  description?: string;
  parameters?: unknown;
  sourceEntityType?: string;
  sourceEntityId?: number;
  retentionDays?: number;
  generatedBy: string;
}

export interface ListReportsOpts {
  reportKind?: ReportKind;
  status?: ReportStatus;
  generatedBy?: string;
  sinceMs?: number;
  untilMs?: number;
  page: number;
  limit: number;
  includeDeleted?: boolean;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

async function safeAudit(args: {
  facilityNumber: string;
  actor: AuditActor;
  action: "create" | "update" | "delete" | "download";
  entityId: number;
  before?: unknown;
  after?: unknown;
}): Promise<void> {
  try {
    await recordAudit({
      facilityNumber: args.facilityNumber,
      actorId: args.actor.id,
      actorRole: args.actor.role,
      // recordAudit's AuditAction union doesn't include 'download' as a
      // first-class value; cast at the boundary so the report-specific
      // download events still flow through the same append-only path.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      action: args.action as any,
      entityType: "ops_report",
      entityId: args.entityId,
      before: args.before,
      after: args.after,
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[ops] audit emit failed for ops_report#${args.entityId} action=${args.action}`,
      err,
    );
  }
}

// Phase 2 R2: parameters_json is JSONB now — Drizzle stores the value
// directly. We still gate on serialisability so a circular ref doesn't
// blow up the insert; callers receive a JS value (or null) suitable for
// passing as `parametersJson` in a Drizzle insert.
function serializeParams(params: unknown): unknown | null {
  if (params === undefined || params === null) return null;
  try {
    JSON.stringify(params); // shape-check; throws on circular refs
    return params;
  } catch {
    return null;
  }
}

function truncateReason(reason: string): string {
  if (reason.length <= FAILURE_REASON_MAX) return reason;
  return reason.slice(0, FAILURE_REASON_MAX - 14) + "...(truncated)";
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / finalize / fail
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Insert a stub row with status='generating'. Caller is responsible for
 * invoking markReportReady (success) or markReportFailed (terminal) before
 * the request returns; otherwise the row will sit in 'generating' forever
 * (a future cron sweeps stale generating rows to 'failed').
 */
export async function createReportStub(
  input: CreateReportInput,
  actor: AuditActor,
): Promise<OpsReport> {
  if (!input.facilityNumber) throw new Error("facilityNumber is required");
  if (!input.reportKind) throw new Error("reportKind is required");
  if (!input.title) throw new Error("title is required");
  if (!input.generatedBy) throw new Error("generatedBy is required");

  const now = Date.now();
  const retentionDays =
    typeof input.retentionDays === "number"
      ? input.retentionDays
      : REPORT_DEFAULT_RETENTION_DAYS[input.reportKind] ?? null;

  const rows = await db
    .insert(opsReports)
    .values({
      facilityNumber: input.facilityNumber,
      reportKind: input.reportKind,
      title: input.title,
      description: input.description ?? null,
      parametersJson: serializeParams(input.parameters),
      storageUri: null,
      mimeType: null,
      filename: null,
      byteSize: null,
      sha256: null,
      status: "generating",
      failureReason: null,
      sourceEntityType: input.sourceEntityType ?? null,
      sourceEntityId:
        typeof input.sourceEntityId === "number" ? input.sourceEntityId : null,
      retentionDays,
      generatedBy: input.generatedBy,
      generatedAt: now,
      downloadCount: 0,
      lastDownloadedAt: null,
      notes: null,
      deletedAt: null,
    })
    .returning();
  const row = rows[0] as OpsReport;

  await safeAudit({
    facilityNumber: row.facilityNumber,
    actor,
    action: "create",
    entityId: row.id,
    after: {
      id: row.id,
      reportKind: row.reportKind,
      title: row.title,
      status: row.status,
      generatedBy: row.generatedBy,
      sourceEntityType: row.sourceEntityType,
      sourceEntityId: row.sourceEntityId,
    },
  });

  return row;
}

/**
 * Finalize a stub: persist the bytes via the storage adapter, then UPDATE
 * the row to status='ready' with storage_uri / mime / filename / byte_size /
 * sha256. The byte cap (MAX_REPORT_BYTES) is enforced here — generators
 * that exceed it throw before any bytes hit disk.
 */
export async function markReportReady(
  id: number,
  facilityNumber: string,
  body: { bytes: Buffer; mime: ReportMimeType },
  actor: AuditActor,
  adapter: StorageAdapter = getStorageAdapter(),
): Promise<OpsReport> {
  if (!body.bytes || body.bytes.byteLength === 0) {
    throw new Error("report body is empty");
  }
  if (body.bytes.byteLength > MAX_REPORT_BYTES) {
    throw new Error(
      `report exceeds MAX_REPORT_BYTES (${body.bytes.byteLength} > ${MAX_REPORT_BYTES})`,
    );
  }

  // The row must already exist, be generating, and be on the right tenant
  // — otherwise we refuse to finalize.
  const existing = await getReport(id, facilityNumber);
  if (!existing) throw new Error(`ops_report#${id} not found`);
  if (existing.status !== "generating") {
    throw new Error(
      `ops_report#${id} cannot transition to ready from status=${existing.status}`,
    );
  }

  const ext = reportExtensionForMime(body.mime);
  const filename = buildReportFilename(
    existing.reportKind as ReportKind,
    existing.generatedAt,
    existing.id,
    ext,
  );

  const put = await adapter.put({
    facilityNumber,
    entityType: "ops_report",
    entityId: id,
    filename,
    bytes: body.bytes,
    subdir: "reports",
  });

  const rows = await db
    .update(opsReports)
    .set({
      storageUri: put.uri,
      mimeType: body.mime,
      filename,
      byteSize: put.byteSize,
      sha256: put.sha256,
      status: "ready",
      failureReason: null,
    })
    .where(
      and(
        eq(opsReports.id, id),
        eq(opsReports.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const row = rows[0] as OpsReport;

  await safeAudit({
    facilityNumber,
    actor,
    action: "update",
    entityId: id,
    before: { status: existing.status },
    after: {
      status: row.status,
      mime: row.mimeType,
      filename: row.filename,
      byteSize: row.byteSize,
      sha256: row.sha256,
    },
  });

  return row;
}

/**
 * Mark a generating row as failed. Idempotent for already-failed rows
 * (no row update, but still returns the row so callers can render the
 * error consistently). Returns undefined when the row does not exist
 * for the tenant.
 */
export async function markReportFailed(
  id: number,
  facilityNumber: string,
  reason: string,
  actor: AuditActor,
): Promise<OpsReport | undefined> {
  const existing = await getReport(id, facilityNumber);
  if (!existing) return undefined;
  if (existing.status === "failed") return existing;

  const rows = await db
    .update(opsReports)
    .set({
      status: "failed",
      failureReason: truncateReason(reason ?? "unknown"),
    })
    .where(
      and(
        eq(opsReports.id, id),
        eq(opsReports.facilityNumber, facilityNumber),
      ),
    )
    .returning();
  const row = rows[0] as OpsReport | undefined;
  if (!row) return undefined;

  await safeAudit({
    facilityNumber,
    actor,
    action: "update",
    entityId: id,
    before: { status: existing.status },
    after: { status: row.status, failureReason: row.failureReason },
  });

  return row;
}

// ─────────────────────────────────────────────────────────────────────────────
// Reads
// ─────────────────────────────────────────────────────────────────────────────

export async function listReports(
  facilityNumber: string,
  opts: ListReportsOpts,
): Promise<{ rows: OpsReport[]; total: number }> {
  const conds = [eq(opsReports.facilityNumber, facilityNumber)];
  if (opts.reportKind) conds.push(eq(opsReports.reportKind, opts.reportKind));
  if (opts.status) conds.push(eq(opsReports.status, opts.status));
  if (opts.generatedBy) conds.push(eq(opsReports.generatedBy, opts.generatedBy));
  if (typeof opts.sinceMs === "number") {
    conds.push(gte(opsReports.generatedAt, opts.sinceMs));
  }
  if (typeof opts.untilMs === "number") {
    conds.push(lt(opsReports.generatedAt, opts.untilMs));
  }
  if (!opts.includeDeleted) {
    conds.push(isNull(opsReports.deletedAt));
  }
  const where = and(...conds);

  const offset = (opts.page - 1) * opts.limit;
  const [rows, countRows] = await Promise.all([
    db
      .select()
      .from(opsReports)
      .where(where)
      .orderBy(desc(opsReports.generatedAt), desc(opsReports.id))
      .limit(opts.limit)
      .offset(offset),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(opsReports)
      .where(where),
  ]);
  return { rows: rows as OpsReport[], total: countRows[0]?.count ?? 0 };
}

/**
 * Fetch a single report row by id, scoped to the facility. Returns
 * undefined for "row not found OR not yours OR deleted" — the route
 * handler maps that to a 404, which is how we avoid leaking existence to
 * a cross-tenant probe.
 */
export async function getReport(
  id: number,
  facilityNumber: string,
): Promise<OpsReport | undefined> {
  const rows = await db
    .select()
    .from(opsReports)
    .where(
      and(
        eq(opsReports.id, id),
        eq(opsReports.facilityNumber, facilityNumber),
        isNull(opsReports.deletedAt),
      ),
    )
    .limit(1);
  return rows[0] as OpsReport | undefined;
}

// ─────────────────────────────────────────────────────────────────────────────
// Download (stream)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve a ready report to a readable stream + denormalized metadata for
 * the route handler. Bumps download_count + last_downloaded_at atomically
 * via an UPDATE … RETURNING, then opens a Node fs read stream against the
 * adapter-resolved path.
 *
 * Returns undefined when:
 *   - row not found / wrong tenant / soft-deleted
 *   - status !== 'ready' (failed / generating / expired)
 *   - bytes are missing on disk (race with retention purge)
 *
 * Audit emission tags action='download'. Stream errors after the
 * counter bump are still counted — matches the typical S3 "GET billed
 * even on partial read" semantic.
 */
export async function streamReport(
  id: number,
  facilityNumber: string,
  actor: AuditActor,
  adapter: StorageAdapter = getStorageAdapter(),
): Promise<
  | {
      row: OpsReport;
      stream: NodeJS.ReadableStream;
      mime: string;
      byteSize: number;
      filename: string;
    }
  | undefined
> {
  // Single UPDATE … RETURNING gives us tenant scope + freshness + counter
  // bump in one round-trip. The WHERE clause excludes deleted / non-ready
  // rows so a hostile id probe gets the same 404 as a missing row.
  const now = Date.now();
  const rows = await db
    .update(opsReports)
    .set({
      downloadCount: sql`${opsReports.downloadCount} + 1`,
      lastDownloadedAt: now,
    })
    .where(
      and(
        eq(opsReports.id, id),
        eq(opsReports.facilityNumber, facilityNumber),
        eq(opsReports.status, "ready"),
        isNull(opsReports.deletedAt),
      ),
    )
    .returning();
  const row = rows[0] as OpsReport | undefined;
  if (!row || !row.storageUri) return undefined;

  const abs = adapter.resolve(row.storageUri);
  try {
    await stat(abs);
  } catch {
    return undefined;
  }

  await safeAudit({
    facilityNumber,
    actor,
    action: "download",
    entityId: id,
    after: {
      filename: row.filename,
      byteSize: row.byteSize,
      sha256: row.sha256,
      downloadCount: row.downloadCount,
    },
  });

  return {
    row,
    stream: createReadStream(abs),
    mime: row.mimeType ?? "application/octet-stream",
    byteSize: row.byteSize ?? 0,
    filename: row.filename ?? `report-${id}.bin`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Soft delete
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Soft-delete a report row. The underlying file is NOT removed here —
 * that's the retention cron's job. Returns true on a successful state
 * change, false on "row not found / already deleted / wrong tenant".
 */
export async function softDeleteReport(
  id: number,
  facilityNumber: string,
  actor: AuditActor,
): Promise<boolean> {
  const existing = await getReport(id, facilityNumber);
  if (!existing) return false;
  const now = Date.now();
  const rows = await db
    .update(opsReports)
    .set({ deletedAt: now })
    .where(
      and(
        eq(opsReports.id, id),
        eq(opsReports.facilityNumber, facilityNumber),
        isNull(opsReports.deletedAt),
      ),
    )
    .returning();
  if (rows.length === 0) return false;

  await safeAudit({
    facilityNumber,
    actor,
    action: "delete",
    entityId: id,
    before: {
      status: existing.status,
      filename: existing.filename,
    },
    after: { deletedAt: now },
  });
  return true;
}
