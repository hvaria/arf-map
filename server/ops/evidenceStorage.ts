/**
 * F2 — Evidence attachment storage.
 *
 * Pattern reused: storage shape mirrors `server/ops/opsStorage.ts` (Module
 * 1–6) — module-level async functions on shared `db` from
 * `server/db/index.ts`. DB rows live in `ops_evidence_attachments`
 * (DDL: `server/ops/opsSchema.ts:464-480`).
 *
 * v0 storage adapter is the Fly volume (mounted at /data by fly.toml).
 * Files are laid out at:
 *   /data/evidence/<facility>/<entity_type>/<entity_id>/<sha8>-<filename>
 *
 * Hard constraints (§8 of the engineering plan):
 *   - Allowed MIME: application/pdf, image/jpeg, image/png — strict allow-list.
 *   - Size cap: 5 MB / file.
 *   - SHA256 stored on the row for tamper detection + path uniqueness.
 *   - Mime sniff (`file-type`) must match the declared mime, otherwise reject.
 *   - Soft delete only — `deleted_at IS NULL` filter on every list/read.
 *   - Tenant scope enforced at the storage layer (facility_number in every WHERE).
 *   - Path-traversal defense: filename sanitized before disk write.
 */

import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileTypeFromBuffer } from "file-type";
import { and, desc, eq, isNull, sql } from "drizzle-orm";

import { db } from "../db/index";
import {
  opsEvidenceAttachments,
  type OpsEvidenceAttachment,
} from "./opsSchema";
import { recordAudit } from "./auditStorage";
import { bumpVerificationEvidenceCount } from "./postingsStorage";

// ─────────────────────────────────────────────────────────────────────────────
// Constraints
// ─────────────────────────────────────────────────────────────────────────────

export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024; // 5 MB
export const EVIDENCE_ALLOWED_MIME = new Set<string>([
  "application/pdf",
  "image/jpeg",
  "image/png",
]);
export const EVIDENCE_KIND_VALUES = ["file", "photo", "external_link"] as const;
export type EvidenceKind = (typeof EVIDENCE_KIND_VALUES)[number];

// Default mount path. Override in tests via env. Production points at
// /data/evidence (the Fly volume mount).
export const EVIDENCE_ROOT =
  process.env.OPS_EVIDENCE_ROOT ?? "/data/evidence";

// ─────────────────────────────────────────────────────────────────────────────
// StorageAdapter — pluggable so Wave 2+ can swap to S3/R2 without touching
// the route handlers or the DB layer.
// ─────────────────────────────────────────────────────────────────────────────

export interface StorageAdapter {
  put(input: {
    facilityNumber: string;
    entityType: string;
    entityId: number;
    filename: string;
    bytes: Buffer;
  }): Promise<{ uri: string; sha256: string; byteSize: number; absolutePath: string }>;
  resolve(uri: string): string;
}

function sha256(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

// Regex literal built dynamically so the source file stays free of raw
// control characters (which some serialization pipelines strip).
const CONTROL_CHAR_RE = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

/**
 * Sanitize a user-supplied filename so it is safe to write to disk:
 *   - NFKC-normalize to collapse exotic Unicode lookalikes.
 *   - Strip control characters and embedded NULs.
 *   - Strip path separators and parent-dir escapes.
 *   - Trim leading dots so we don't write dot-files unintentionally.
 *   - Clamp to 200 chars to keep the path well under FS limits.
 *   - Fall back to a deterministic name when the result is empty.
 */
export function sanitizeFilename(input: string | undefined | null): string {
  if (!input) return "upload.bin";
  let s = String(input).normalize("NFKC");
  s = s.replace(CONTROL_CHAR_RE, "");
  // Strip path separators and parent escapes.
  s = s.replace(/[\\/]+/g, "_").replace(/\.\.+/g, "_");
  // Strip leading dots, whitespace, and quotes.
  s = s.replace(/^[.\s"']+/, "").trim();
  if (s.length > 200) s = s.slice(0, 200);
  if (!s) return "upload.bin";
  return s;
}

function safePathSegment(s: string): string {
  // Used for facility / entity_type / entity_id directory components.
  // entity_type comes from app code so this is belt-and-suspenders; it
  // would still be wrong to write user-supplied tokens into a path
  // without normalizing them.
  return String(s).normalize("NFKC").replace(/[^A-Za-z0-9._-]/g, "_");
}

export class FlyVolumeAdapter implements StorageAdapter {
  constructor(private readonly root: string = EVIDENCE_ROOT) {}

  async put(input: {
    facilityNumber: string;
    entityType: string;
    entityId: number;
    filename: string;
    bytes: Buffer;
  }): Promise<{ uri: string; sha256: string; byteSize: number; absolutePath: string }> {
    const hash = sha256(input.bytes);
    const sha8 = hash.slice(0, 8);
    const safeName = sanitizeFilename(input.filename);
    const dir = join(
      this.root,
      safePathSegment(input.facilityNumber),
      safePathSegment(input.entityType),
      safePathSegment(String(input.entityId)),
    );
    await mkdir(dir, { recursive: true });
    const filename = `${sha8}-${safeName}`;
    const absolutePath = join(dir, filename);
    await writeFile(absolutePath, input.bytes, { flag: "w" });
    // URI uses the `local:` scheme so the read path can re-resolve it
    // against the current EVIDENCE_ROOT (handy in tests).
    const relative = absolutePath.slice(this.root.length).replace(/^[/\\]+/, "");
    const uri = `local:///${relative.replace(/\\/g, "/")}`;
    return { uri, sha256: hash, byteSize: input.bytes.byteLength, absolutePath };
  }

  resolve(uri: string): string {
    if (!uri.startsWith("local:///")) {
      throw new Error(`Unsupported storage uri: ${uri}`);
    }
    const relative = uri.slice("local:///".length);
    // Re-resolve under the current root. Defense against ".." escape
    // even though sanitize ran on write.
    const safeRel = relative.replace(/\.\.+/g, "_");
    return join(this.root, safeRel);
  }
}

// Lazily-initialized default adapter so import-time work is cheap.
let _defaultAdapter: StorageAdapter | null = null;
export function getStorageAdapter(): StorageAdapter {
  if (!_defaultAdapter) _defaultAdapter = new FlyVolumeAdapter();
  return _defaultAdapter;
}

// Test seam — override the adapter (e.g., point at a tmpdir).
export function setStorageAdapterForTests(adapter: StorageAdapter | null): void {
  _defaultAdapter = adapter;
}

// ─────────────────────────────────────────────────────────────────────────────
// Mime validation
// ─────────────────────────────────────────────────────────────────────────────

export class EvidenceValidationError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "EvidenceValidationError";
  }
}

/**
 * Sniff the binary's actual mime via `file-type` magic numbers and
 * confirm:
 *   1. file-type returned a result (otherwise the file is suspicious).
 *   2. The sniffed mime is in the allow-list.
 *   3. The sniffed mime matches the declared (form-data) mime.
 *
 * Returns the canonical mime (sniffed value) on success; throws
 * EvidenceValidationError otherwise.
 */
export async function validateMimeOrThrow(
  bytes: Buffer,
  declaredMime: string | undefined,
): Promise<string> {
  if (bytes.byteLength === 0) {
    throw new EvidenceValidationError("EMPTY_FILE", "File is empty");
  }
  if (bytes.byteLength > EVIDENCE_MAX_BYTES) {
    throw new EvidenceValidationError("FILE_TOO_LARGE", "File exceeds 5 MB limit");
  }
  // fileTypeFromBuffer accepts Uint8Array; Buffer is a subclass.
  const detected = await fileTypeFromBuffer(bytes);
  if (!detected) {
    throw new EvidenceValidationError("UNKNOWN_MIME", "Could not determine file type");
  }
  if (!EVIDENCE_ALLOWED_MIME.has(detected.mime)) {
    throw new EvidenceValidationError(
      "DISALLOWED_MIME",
      `Mime ${detected.mime} is not allowed`,
    );
  }
  if (declaredMime && declaredMime !== detected.mime) {
    throw new EvidenceValidationError(
      "MIME_MISMATCH",
      `Declared mime ${declaredMime} does not match detected ${detected.mime}`,
    );
  }
  return detected.mime;
}

// ─────────────────────────────────────────────────────────────────────────────
// Storage-layer fns
// ─────────────────────────────────────────────────────────────────────────────

export interface AttachEvidenceInput {
  facilityNumber: string;
  entityType: string;
  entityId: number;
  kind: EvidenceKind;
  filename?: string;
  mime?: string;
  bytes?: Buffer;
  externalUri?: string;
  uploadedBy: string;
  actorRole: string;
}

/**
 * Attach a file or external-link evidence row to (entity_type, entity_id)
 * for the given facility. Validates mime + size for file/photo kinds;
 * external_link rows skip the binary path and store the URI directly.
 * Emits an `attach_evidence` audit row.
 */
export async function attachEvidence(
  input: AttachEvidenceInput,
  adapter: StorageAdapter = getStorageAdapter(),
): Promise<OpsEvidenceAttachment> {
  if (!input.facilityNumber) throw new Error("facilityNumber is required");
  if (!input.entityType) throw new Error("entityType is required");
  if (!input.entityId) throw new Error("entityId is required");
  if (!EVIDENCE_KIND_VALUES.includes(input.kind)) {
    throw new EvidenceValidationError("INVALID_KIND", `Invalid kind: ${input.kind}`);
  }

  const now = Date.now();
  let storageUri: string;
  let mime: string | null = null;
  let filename: string | null = null;
  let byteSize: number | null = null;
  let shaHex: string | null = null;

  if (input.kind === "external_link") {
    if (!input.externalUri || !/^https?:\/\//i.test(input.externalUri)) {
      throw new EvidenceValidationError(
        "INVALID_EXTERNAL_URI",
        "external_link requires a valid http(s) URI",
      );
    }
    storageUri = input.externalUri;
  } else {
    if (!input.bytes) {
      throw new EvidenceValidationError(
        "MISSING_BYTES",
        "file/photo kind requires bytes",
      );
    }
    mime = await validateMimeOrThrow(input.bytes, input.mime);
    filename = sanitizeFilename(input.filename);
    byteSize = input.bytes.byteLength;
    const put = await adapter.put({
      facilityNumber: input.facilityNumber,
      entityType: input.entityType,
      entityId: input.entityId,
      filename,
      bytes: input.bytes,
    });
    storageUri = put.uri;
    shaHex = put.sha256;
  }

  // Project the row back so we can audit it.
  const rows = await db
    .insert(opsEvidenceAttachments)
    .values({
      facilityNumber: input.facilityNumber,
      entityType: input.entityType,
      entityId: input.entityId,
      kind: input.kind,
      filename,
      mime,
      byteSize,
      storageUri,
      sha256: shaHex,
      uploadedBy: input.uploadedBy,
      uploadedAt: now,
      deletedAt: null,
    })
    .returning();
  const row = rows[0] as OpsEvidenceAttachment;

  // Audit emission — never throw past the user mutation.
  try {
    await recordAudit({
      facilityNumber: input.facilityNumber,
      actorId: input.uploadedBy,
      actorRole: input.actorRole,
      action: "attach_evidence",
      entityType: input.entityType,
      entityId: input.entityId,
      after: {
        evidenceId: row.id,
        kind: row.kind,
        filename: row.filename,
        mime: row.mime,
        byteSize: row.byteSize,
        sha256: row.sha256,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[evidenceStorage] audit emit failed", err);
  }

  // Wave 4 Phase 4.1 (W6) — bump denormalized evidence_count on the parent
  // verification row so list reads can render badge counts without a JOIN.
  // Best-effort only — failure must NOT roll back the attach.
  if (input.entityType === "ops_posting_verification") {
    await bumpVerificationEvidenceCount(input.entityId, input.facilityNumber, +1);
  }

  return row;
}

/**
 * List active (non-deleted) evidence rows for one (entity_type, entity_id)
 * pair, scoped to the facility. Newest first to match the UI.
 */
export async function listEvidence(
  facilityNumber: string,
  entityType: string,
  entityId: number,
): Promise<OpsEvidenceAttachment[]> {
  return db
    .select()
    .from(opsEvidenceAttachments)
    .where(
      and(
        eq(opsEvidenceAttachments.facilityNumber, facilityNumber),
        eq(opsEvidenceAttachments.entityType, entityType),
        eq(opsEvidenceAttachments.entityId, entityId),
        isNull(opsEvidenceAttachments.deletedAt),
      ),
    )
    .orderBy(desc(opsEvidenceAttachments.uploadedAt));
}

/**
 * Fetch a single evidence row by id, enforcing tenant scope and the
 * soft-delete filter. Returns undefined for "row not found OR not
 * yours OR deleted" — the route handler maps that to a 404, which is
 * how we avoid leaking existence to a cross-tenant probe.
 */
export async function getEvidenceById(
  facilityNumber: string,
  id: number,
): Promise<OpsEvidenceAttachment | undefined> {
  const rows = await db
    .select()
    .from(opsEvidenceAttachments)
    .where(
      and(
        eq(opsEvidenceAttachments.id, id),
        eq(opsEvidenceAttachments.facilityNumber, facilityNumber),
        isNull(opsEvidenceAttachments.deletedAt),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Soft-delete an evidence row by id, enforcing tenant scope. Emits a
 * `detach_evidence` audit row keyed to the parent entity so the
 * inspector trail on that entity shows the detach event.
 */
export async function softDeleteEvidence(
  facilityNumber: string,
  evidenceId: number,
  actor: { id: string; role: string },
): Promise<OpsEvidenceAttachment | undefined> {
  const existing = await getEvidenceById(facilityNumber, evidenceId);
  if (!existing) return undefined;
  const now = Date.now();
  const rows = await db
    .update(opsEvidenceAttachments)
    .set({ deletedAt: now })
    .where(
      and(
        eq(opsEvidenceAttachments.id, evidenceId),
        eq(opsEvidenceAttachments.facilityNumber, facilityNumber),
        isNull(opsEvidenceAttachments.deletedAt),
      ),
    )
    .returning();
  const row = rows[0];
  if (!row) return undefined;

  try {
    await recordAudit({
      facilityNumber,
      actorId: actor.id,
      actorRole: actor.role,
      action: "detach_evidence",
      entityType: existing.entityType,
      entityId: existing.entityId,
      before: {
        evidenceId: existing.id,
        filename: existing.filename,
        mime: existing.mime,
        byteSize: existing.byteSize,
        sha256: existing.sha256,
      },
    });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("[evidenceStorage] detach audit emit failed", err);
  }

  // Wave 4 Phase 4.1 (W6) — keep the denormalized evidence_count in sync
  // with soft-deletes. Best-effort; mirrors the attach hook above.
  if (existing.entityType === "ops_posting_verification") {
    await bumpVerificationEvidenceCount(existing.entityId, facilityNumber, -1);
  }

  return row;
}

/**
 * Resolve a stored evidence row to a readable stream. Caller is
 * responsible for setting Content-Type / Content-Disposition headers
 * from the row metadata. Returns undefined for not-found / wrong tenant
 * / deleted / external_link rows (which have no local stream).
 */
export async function readEvidenceStream(
  facilityNumber: string,
  evidenceId: number,
  adapter: StorageAdapter = getStorageAdapter(),
): Promise<
  | {
      stream: NodeJS.ReadableStream;
      mime: string;
      byteSize: number;
      filename: string;
      row: OpsEvidenceAttachment;
    }
  | undefined
> {
  const row = await getEvidenceById(facilityNumber, evidenceId);
  if (!row) return undefined;
  if (row.kind === "external_link") return undefined;
  const abs = adapter.resolve(row.storageUri);
  // stat() verifies the file actually exists before we hand the stream
  // back. createReadStream by itself won't throw until the first read.
  try {
    await stat(abs);
  } catch {
    return undefined;
  }
  return {
    stream: createReadStream(abs),
    mime: row.mime ?? "application/octet-stream",
    byteSize: row.byteSize ?? 0,
    filename: row.filename ?? "evidence.bin",
    row,
  };
}

/**
 * Diagnostics — count active rows per facility. Used by /seed-demo /
 * smoke tests; never exposed via an end-user route. Tenant-scoped.
 */
export async function countActiveEvidence(facilityNumber: string): Promise<number> {
  const r = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(opsEvidenceAttachments)
    .where(
      and(
        eq(opsEvidenceAttachments.facilityNumber, facilityNumber),
        isNull(opsEvidenceAttachments.deletedAt),
      ),
    );
  return r[0]?.count ?? 0;
}
