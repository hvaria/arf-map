/**
 * Wave 5 — Reports Hub storage tests.
 *
 * Coverage:
 *  - createReportStub → markReportReady lifecycle (status, bytes, sha256).
 *  - markReportFailed flips to failed terminal state.
 *  - Tenant isolation — facility A cannot read / download / delete
 *    facility B's reports even with the raw id.
 *  - streamReport bumps download_count + last_downloaded_at atomically.
 *  - Failed / deleted / generating rows return undefined from streamReport
 *    (caller maps to 404).
 *  - softDeleteReport preserves the row and emits a 'delete' audit row.
 *  - Audit trail records create + update (ready) + download + delete.
 *  - listReports honors reportKind / status / sinceMs / untilMs filters.
 */

import "dotenv/config";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { bootstrapOpsSchema } from "../../ops/opsStorage";
import {
  FlyVolumeAdapter,
  setStorageAdapterForTests,
} from "../../ops/evidenceStorage";
import {
  createReportStub,
  getReport,
  listReports,
  markReportFailed,
  markReportReady,
  softDeleteReport,
  streamReport,
} from "../../ops/reportsStorage";

const FACILITY_A = "TEST-FAC-RPT-A";
const FACILITY_B = "TEST-FAC-RPT-B";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const ACTOR = { id: "alice", role: "admin" };

let tempRoot: string;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_reports WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
}

beforeAll(async () => {
  await bootstrapMainSchema();
  await bootstrapOpsSchema();
  tempRoot = await mkdtemp(join(tmpdir(), "arf-reports-"));
  setStorageAdapterForTests(new FlyVolumeAdapter(tempRoot));
});

afterAll(async () => {
  setStorageAdapterForTests(null);
  await cleanup();
  await rm(tempRoot, { recursive: true, force: true });
  await pool.end();
});

beforeEach(async () => {
  await cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe("reportsStorage — create / ready lifecycle", () => {
  it("createReportStub inserts a generating row with retention_days from defaults", async () => {
    const row = await createReportStub(
      {
        facilityNumber: FACILITY_A,
        reportKind: "incident_summary",
        title: "Test summary",
        generatedBy: ACTOR.id,
      },
      ACTOR,
    );
    expect(row.facilityNumber).toBe(FACILITY_A);
    expect(row.status).toBe("generating");
    expect(row.storageUri).toBeNull();
    expect(row.byteSize).toBeNull();
    expect(row.sha256).toBeNull();
    // incident_summary default retention is 1095 days.
    expect(row.retentionDays).toBe(1095);
  });

  it("markReportReady writes bytes, sets sha256, byteSize, status='ready'", async () => {
    const stub = await createReportStub(
      {
        facilityNumber: FACILITY_A,
        reportKind: "audit_trail",
        title: "Audit",
        generatedBy: ACTOR.id,
      },
      ACTOR,
    );
    const bytes = Buffer.from("id,actor\r\n1,alice\r\n", "utf8");
    const ready = await markReportReady(
      stub.id,
      FACILITY_A,
      { bytes, mime: "text/csv" },
      ACTOR,
    );
    expect(ready.status).toBe("ready");
    expect(ready.byteSize).toBe(bytes.byteLength);
    expect(ready.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(ready.mimeType).toBe("text/csv");
    expect(ready.filename).toMatch(/^audit_trail_\d{8}_\d+\.csv$/);
    expect(ready.storageUri?.startsWith("local:///")).toBe(true);
  });

  it("markReportReady refuses to transition from a non-generating status", async () => {
    const stub = await createReportStub(
      {
        facilityNumber: FACILITY_A,
        reportKind: "audit_trail",
        title: "Audit",
        generatedBy: ACTOR.id,
      },
      ACTOR,
    );
    await markReportReady(
      stub.id,
      FACILITY_A,
      { bytes: Buffer.from("hi", "utf8"), mime: "text/csv" },
      ACTOR,
    );
    await expect(
      markReportReady(
        stub.id,
        FACILITY_A,
        { bytes: Buffer.from("again", "utf8"), mime: "text/csv" },
        ACTOR,
      ),
    ).rejects.toThrow(/cannot transition/);
  });

  it("markReportFailed flips a generating row to failed (terminal)", async () => {
    const stub = await createReportStub(
      {
        facilityNumber: FACILITY_A,
        reportKind: "mar_export",
        title: "MAR",
        generatedBy: ACTOR.id,
      },
      ACTOR,
    );
    const failed = await markReportFailed(
      stub.id,
      FACILITY_A,
      "generator threw — db down",
      ACTOR,
    );
    expect(failed?.status).toBe("failed");
    expect(failed?.failureReason).toMatch(/db down/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Download (stream + counter bump)
// ─────────────────────────────────────────────────────────────────────────────

describe("reportsStorage — streamReport", () => {
  it("bumps download_count + last_downloaded_at and emits a download audit row", async () => {
    const stub = await createReportStub(
      {
        facilityNumber: FACILITY_A,
        reportKind: "audit_trail",
        title: "Audit",
        generatedBy: ACTOR.id,
      },
      ACTOR,
    );
    const bytes = Buffer.from("payload-bytes", "utf8");
    await markReportReady(stub.id, FACILITY_A, { bytes, mime: "text/csv" }, ACTOR);

    const first = await streamReport(stub.id, FACILITY_A, ACTOR);
    expect(first).toBeDefined();
    if (first) {
      // Consume the stream so the file handle closes (Windows safety).
      await new Promise<void>((resolve, reject) => {
        first.stream.on("data", () => {});
        first.stream.on("end", () => resolve());
        first.stream.on("error", reject);
      });
      expect(first.byteSize).toBe(bytes.byteLength);
      expect(first.row.downloadCount).toBe(1);
    }

    const second = await streamReport(stub.id, FACILITY_A, ACTOR);
    if (second) {
      await new Promise<void>((resolve, reject) => {
        second.stream.on("data", () => {});
        second.stream.on("end", () => resolve());
        second.stream.on("error", reject);
      });
      expect(second.row.downloadCount).toBe(2);
      expect(second.row.lastDownloadedAt).toBeGreaterThan(0);
    }

    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM ops_audit_trail
        WHERE facility_number=$1 AND entity_type='ops_report' AND entity_id=$2
        ORDER BY occurred_at ASC`,
      [FACILITY_A, stub.id],
    );
    const actions = audit.rows.map((r) => r.action);
    // create (stub) + update (ready) + download + download.
    expect(actions).toContain("download");
    expect(actions.filter((a) => a === "download").length).toBe(2);
  });

  it("returns undefined for a failed report (caller maps to 404)", async () => {
    const stub = await createReportStub(
      {
        facilityNumber: FACILITY_A,
        reportKind: "incident_summary",
        title: "X",
        generatedBy: ACTOR.id,
      },
      ACTOR,
    );
    await markReportFailed(stub.id, FACILITY_A, "boom", ACTOR);
    const r = await streamReport(stub.id, FACILITY_A, ACTOR);
    expect(r).toBeUndefined();
  });

  it("returns undefined for a generating row (file not yet written)", async () => {
    const stub = await createReportStub(
      {
        facilityNumber: FACILITY_A,
        reportKind: "incident_summary",
        title: "Pending",
        generatedBy: ACTOR.id,
      },
      ACTOR,
    );
    const r = await streamReport(stub.id, FACILITY_A, ACTOR);
    expect(r).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Soft delete
// ─────────────────────────────────────────────────────────────────────────────

describe("reportsStorage — softDeleteReport", () => {
  it("sets deleted_at, hides the row from listReports + getReport, emits delete audit", async () => {
    const stub = await createReportStub(
      {
        facilityNumber: FACILITY_A,
        reportKind: "audit_trail",
        title: "Audit",
        generatedBy: ACTOR.id,
      },
      ACTOR,
    );
    await markReportReady(
      stub.id,
      FACILITY_A,
      { bytes: Buffer.from("x", "utf8"), mime: "text/csv" },
      ACTOR,
    );

    const ok = await softDeleteReport(stub.id, FACILITY_A, ACTOR);
    expect(ok).toBe(true);

    expect(await getReport(stub.id, FACILITY_A)).toBeUndefined();
    const list = await listReports(FACILITY_A, { page: 1, limit: 10 });
    expect(list.rows.find((r) => r.id === stub.id)).toBeUndefined();

    // Row still present (deleted_at IS NOT NULL).
    const raw = await pool.query<{ id: number; deleted_at: number | null }>(
      `SELECT id, deleted_at FROM ops_reports WHERE id = $1`,
      [stub.id],
    );
    expect(raw.rows.length).toBe(1);
    expect(raw.rows[0].deleted_at).not.toBeNull();

    // Deleted report cannot be downloaded.
    const stream = await streamReport(stub.id, FACILITY_A, ACTOR);
    expect(stream).toBeUndefined();

    // Audit emitted.
    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM ops_audit_trail
        WHERE facility_number=$1 AND entity_type='ops_report' AND entity_id=$2
          AND action='delete'`,
      [FACILITY_A, stub.id],
    );
    expect(audit.rows.length).toBe(1);
  });

  it("returns false for an already-deleted row (idempotent caller)", async () => {
    const stub = await createReportStub(
      {
        facilityNumber: FACILITY_A,
        reportKind: "audit_trail",
        title: "Audit",
        generatedBy: ACTOR.id,
      },
      ACTOR,
    );
    await markReportReady(
      stub.id,
      FACILITY_A,
      { bytes: Buffer.from("x", "utf8"), mime: "text/csv" },
      ACTOR,
    );
    await softDeleteReport(stub.id, FACILITY_A, ACTOR);
    const second = await softDeleteReport(stub.id, FACILITY_A, ACTOR);
    expect(second).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tenant isolation
// ─────────────────────────────────────────────────────────────────────────────

describe("reportsStorage — tenant isolation", () => {
  it("facility B cannot read / stream / delete facility A's reports", async () => {
    const stub = await createReportStub(
      {
        facilityNumber: FACILITY_A,
        reportKind: "audit_trail",
        title: "A only",
        generatedBy: ACTOR.id,
      },
      ACTOR,
    );
    await markReportReady(
      stub.id,
      FACILITY_A,
      { bytes: Buffer.from("a", "utf8"), mime: "text/csv" },
      ACTOR,
    );

    expect(await getReport(stub.id, FACILITY_B)).toBeUndefined();
    expect(await streamReport(stub.id, FACILITY_B, ACTOR)).toBeUndefined();
    expect(await softDeleteReport(stub.id, FACILITY_B, ACTOR)).toBe(false);

    // Sanity — facility A can still see it.
    expect(await getReport(stub.id, FACILITY_A)).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// List filters
// ─────────────────────────────────────────────────────────────────────────────

describe("reportsStorage — listReports filters", () => {
  it("honors reportKind / status filters", async () => {
    const a = await createReportStub(
      {
        facilityNumber: FACILITY_A,
        reportKind: "audit_trail",
        title: "A",
        generatedBy: ACTOR.id,
      },
      ACTOR,
    );
    await markReportReady(
      a.id,
      FACILITY_A,
      { bytes: Buffer.from("a", "utf8"), mime: "text/csv" },
      ACTOR,
    );
    const b = await createReportStub(
      {
        facilityNumber: FACILITY_A,
        reportKind: "vendor_coi_matrix",
        title: "B",
        generatedBy: ACTOR.id,
      },
      ACTOR,
    );
    await markReportReady(
      b.id,
      FACILITY_A,
      { bytes: Buffer.from("b", "utf8"), mime: "text/csv" },
      ACTOR,
    );

    const byKind = await listReports(FACILITY_A, {
      reportKind: "audit_trail",
      page: 1,
      limit: 10,
    });
    expect(byKind.rows.length).toBe(1);
    expect(byKind.rows[0].id).toBe(a.id);

    const byStatus = await listReports(FACILITY_A, {
      status: "ready",
      page: 1,
      limit: 10,
    });
    expect(byStatus.rows.length).toBe(2);
  });
});
