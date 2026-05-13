/**
 * Evidence storage (F2) — server-side unit tests.
 *
 * Coverage:
 *  - Mime sniff mismatch rejection (declared image/png, actual PDF → reject).
 *  - DISALLOWED_MIME rejection for plain text / GIF / etc.
 *  - Size cap enforcement at the storage layer.
 *  - SHA256 stable across repeat writes of identical bytes.
 *  - Soft-delete preserves the underlying row (deleted_at set, not gone).
 *  - Tenant isolation: facility A cannot read facility B's evidence
 *    even with the raw id.
 *  - readEvidenceStream returns undefined for soft-deleted rows.
 *  - Audit emission on attach + detach.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pool } from "../../db/index";
import { bootstrapOpsSchema } from "../../ops/opsStorage";
import { bootstrapMainSchema } from "../../db/bootstrap";
import {
  EVIDENCE_MAX_BYTES,
  EvidenceValidationError,
  FlyVolumeAdapter,
  attachEvidence,
  getEvidenceById,
  listEvidence,
  readEvidenceStream,
  sanitizeFilename,
  setStorageAdapterForTests,
  softDeleteEvidence,
  validateMimeOrThrow,
} from "../../ops/evidenceStorage";

const FACILITY_A = "TEST-FAC-EV-A";
const FACILITY_B = "TEST-FAC-EV-B";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;

// Tiny PNG (1×1 transparent) — the smallest valid PNG file-type can sniff.
const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000156a14eaf0000000049454e44ae426082",
  "hex",
);

// Minimal JPEG (SOI + APP0 + SOS + EOI) is a few kB; use a known-good JPEG
// signature instead by constructing one programmatically. We use a tiny
// real JPEG generated offline — small enough to inline as base64.
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/2wBDAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQH/wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAr/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAAAP/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AL+AB//Z",
  "base64",
);

// Minimal valid PDF (4-byte header is enough for file-type to sniff).
const TINY_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<<>>\n%%EOF",
  "ascii",
);

let tempRoot: string;

beforeAll(async () => {
  await bootstrapMainSchema();
  await bootstrapOpsSchema();
  tempRoot = await mkdtemp(join(tmpdir(), "arf-evidence-"));
  setStorageAdapterForTests(new FlyVolumeAdapter(tempRoot));
});

afterAll(async () => {
  setStorageAdapterForTests(null);
  await pool.query(
    `DELETE FROM ops_evidence_attachments WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await rm(tempRoot, { recursive: true, force: true });
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    `DELETE FROM ops_evidence_attachments WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
});

describe("evidenceStorage — mime sniff + size cap", () => {
  it("rejects empty payloads", async () => {
    await expect(
      validateMimeOrThrow(Buffer.alloc(0), "application/pdf"),
    ).rejects.toBeInstanceOf(EvidenceValidationError);
  });

  it("rejects payloads over the 5 MB cap", async () => {
    const big = Buffer.alloc(EVIDENCE_MAX_BYTES + 1, 0x41);
    await expect(
      validateMimeOrThrow(big, "application/pdf"),
    ).rejects.toMatchObject({ code: "FILE_TOO_LARGE" });
  });

  it("rejects disallowed mime types (gif)", async () => {
    // GIF87a header.
    const gif = Buffer.from(
      "GIF87a\x01\x00\x01\x00\x00\x00\x00",
      "binary",
    );
    await expect(
      validateMimeOrThrow(gif, "image/gif"),
    ).rejects.toMatchObject({ code: "DISALLOWED_MIME" });
  });

  it("rejects declared/actual mime mismatch (claimed PNG but actual PDF)", async () => {
    await expect(
      validateMimeOrThrow(TINY_PDF, "image/png"),
    ).rejects.toMatchObject({ code: "MIME_MISMATCH" });
  });

  it("accepts allow-listed PNG", async () => {
    const mime = await validateMimeOrThrow(TINY_PNG, "image/png");
    expect(mime).toBe("image/png");
  });

  it("accepts allow-listed PDF", async () => {
    const mime = await validateMimeOrThrow(TINY_PDF, "application/pdf");
    expect(mime).toBe("application/pdf");
  });
});

describe("evidenceStorage — attach / list / soft-delete", () => {
  it("attaches a PNG, lists it, sets sha256 + byte size, emits audit", async () => {
    const row = await attachEvidence({
      facilityNumber: FACILITY_A,
      entityType: "ops_drill_log",
      entityId: 42,
      kind: "photo",
      filename: "evidence.png",
      mime: "image/png",
      bytes: TINY_PNG,
      uploadedBy: "alice",
      actorRole: "admin",
    });
    expect(row.facilityNumber).toBe(FACILITY_A);
    expect(row.entityType).toBe("ops_drill_log");
    expect(row.entityId).toBe(42);
    expect(row.mime).toBe("image/png");
    expect(row.byteSize).toBe(TINY_PNG.byteLength);
    expect(row.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(row.deletedAt).toBeNull();

    const list = await listEvidence(FACILITY_A, "ops_drill_log", 42);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe(row.id);

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM ops_audit_trail
        WHERE facility_number = $1
          AND entity_type = 'ops_drill_log'
          AND entity_id = 42`,
      [FACILITY_A],
    );
    expect(audit.rows.length).toBe(1);
    expect(audit.rows[0].action).toBe("attach_evidence");
  });

  it("SHA256 is stable across rewrites of identical bytes", async () => {
    const a = await attachEvidence({
      facilityNumber: FACILITY_A,
      entityType: "ops_vendor",
      entityId: 1,
      kind: "file",
      filename: "coi.pdf",
      mime: "application/pdf",
      bytes: TINY_PDF,
      uploadedBy: "alice",
      actorRole: "admin",
    });
    const b = await attachEvidence({
      facilityNumber: FACILITY_A,
      entityType: "ops_vendor",
      entityId: 1,
      kind: "file",
      filename: "coi-duplicate.pdf",
      mime: "application/pdf",
      bytes: TINY_PDF,
      uploadedBy: "alice",
      actorRole: "admin",
    });
    expect(a.sha256).toBeTruthy();
    expect(b.sha256).toBe(a.sha256);
  });

  it("rejects mime mismatch at the attach boundary (declared PNG, actual PDF)", async () => {
    await expect(
      attachEvidence({
        facilityNumber: FACILITY_A,
        entityType: "ops_vendor",
        entityId: 1,
        kind: "file",
        filename: "trick.png",
        mime: "image/png",
        bytes: TINY_PDF, // PDF bytes, declared as PNG → mismatch.
        uploadedBy: "alice",
        actorRole: "admin",
      }),
    ).rejects.toMatchObject({ code: "MIME_MISMATCH" });
  });

  it("soft-delete preserves the row (deleted_at set, not gone)", async () => {
    const row = await attachEvidence({
      facilityNumber: FACILITY_A,
      entityType: "ops_complaint",
      entityId: 7,
      kind: "file",
      filename: "complaint.pdf",
      mime: "application/pdf",
      bytes: TINY_PDF,
      uploadedBy: "alice",
      actorRole: "admin",
    });

    const deleted = await softDeleteEvidence(FACILITY_A, row.id, {
      id: "alice",
      role: "admin",
    });
    expect(deleted).toBeDefined();
    expect(deleted?.deletedAt).toBeGreaterThan(0);

    // Active list omits the deleted row.
    const active = await listEvidence(FACILITY_A, "ops_complaint", 7);
    expect(active.length).toBe(0);

    // Direct fetch (which filters deleted_at) returns undefined.
    expect(await getEvidenceById(FACILITY_A, row.id)).toBeUndefined();

    // But the raw row is still in the DB (deleted_at IS NOT NULL).
    const raw = await pool.query<{ id: number; deleted_at: number | null }>(
      `SELECT id, deleted_at FROM ops_evidence_attachments WHERE id = $1`,
      [row.id],
    );
    expect(raw.rows.length).toBe(1);
    expect(raw.rows[0].deleted_at).not.toBeNull();

    // Detach audit emitted.
    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM ops_audit_trail
        WHERE facility_number = $1
          AND entity_type = 'ops_complaint'
          AND entity_id = 7
        ORDER BY occurred_at ASC`,
      [FACILITY_A],
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      "attach_evidence",
      "detach_evidence",
    ]);
  });

  it("readEvidenceStream returns undefined for soft-deleted rows", async () => {
    const row = await attachEvidence({
      facilityNumber: FACILITY_A,
      entityType: "ops_inspection",
      entityId: 11,
      kind: "file",
      filename: "report.pdf",
      mime: "application/pdf",
      bytes: TINY_PDF,
      uploadedBy: "alice",
      actorRole: "admin",
    });
    // While active, the stream resolves.
    const ok = await readEvidenceStream(FACILITY_A, row.id);
    expect(ok).toBeDefined();
    // Consume the stream so the file handle closes before delete (Windows).
    if (ok) {
      await new Promise<void>((resolve, reject) => {
        ok.stream.on("data", () => {});
        ok.stream.on("end", () => resolve());
        ok.stream.on("error", reject);
      });
    }
    await softDeleteEvidence(FACILITY_A, row.id, { id: "alice", role: "admin" });
    const gone = await readEvidenceStream(FACILITY_A, row.id);
    expect(gone).toBeUndefined();
  });
});

describe("evidenceStorage — tenant isolation", () => {
  it("facility A cannot read facility B's evidence even with the raw id", async () => {
    const bRow = await attachEvidence({
      facilityNumber: FACILITY_B,
      entityType: "ops_vendor",
      entityId: 1,
      kind: "file",
      filename: "b-secret.pdf",
      mime: "application/pdf",
      bytes: TINY_PDF,
      uploadedBy: "bob",
      actorRole: "admin",
    });
    // Direct fetch under facility A → undefined (not "not found": absent).
    expect(await getEvidenceById(FACILITY_A, bRow.id)).toBeUndefined();
    // List under facility A doesn't see it either.
    const listed = await listEvidence(FACILITY_A, "ops_vendor", 1);
    expect(listed.length).toBe(0);
    // softDelete refuses (returns undefined) — does not silently delete.
    const x = await softDeleteEvidence(FACILITY_A, bRow.id, {
      id: "alice",
      role: "admin",
    });
    expect(x).toBeUndefined();
    // ReadStream refuses too.
    const stream = await readEvidenceStream(FACILITY_A, bRow.id);
    expect(stream).toBeUndefined();

    // And the row is still active for facility B.
    const stillThere = await getEvidenceById(FACILITY_B, bRow.id);
    expect(stillThere).toBeDefined();
    expect(stillThere?.deletedAt).toBeNull();
  });
});

describe("evidenceStorage — sanitize", () => {
  it("strips parent-dir escapes from filenames", () => {
    expect(sanitizeFilename("../../etc/passwd")).not.toContain("..");
    expect(sanitizeFilename("../../etc/passwd")).not.toContain("/");
  });
  it("strips control characters", () => {
    const out = sanitizeFilename("evil\x00name.pdf");
    expect(out).toBe("evilname.pdf");
  });
  it("falls back to upload.bin for empty input", () => {
    expect(sanitizeFilename("")).toBe("upload.bin");
    expect(sanitizeFilename(null)).toBe("upload.bin");
    // After collapsing separators / control chars, anything non-empty is
    // accepted; "/// " becomes "_" — still a valid filename, not the
    // fallback.
    expect(sanitizeFilename("   ")).toBe("upload.bin");
  });
  it("clamps long names to 200 chars", () => {
    const out = sanitizeFilename("a".repeat(500) + ".pdf");
    expect(out.length).toBeLessThanOrEqual(200);
  });
});

describe("evidenceStorage — JPEG happy path", () => {
  it("accepts the inline tiny JPEG without throwing", async () => {
    const row = await attachEvidence({
      facilityNumber: FACILITY_A,
      entityType: "ops_drill_log",
      entityId: 99,
      kind: "photo",
      filename: "snap.jpg",
      mime: "image/jpeg",
      bytes: TINY_JPEG,
      uploadedBy: "alice",
      actorRole: "admin",
    });
    expect(row.mime).toBe("image/jpeg");
  });
});
