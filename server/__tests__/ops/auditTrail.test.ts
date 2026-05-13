/**
 * Audit-trail (F3) — server-side unit tests.
 *
 * Coverage:
 *  - Append-only: the module exposes recordAudit + listAuditForEntity +
 *    listAuditForFacility only. No update / delete sibling.
 *  - listByEntity returns rows in chronological ascending order.
 *  - before_json / after_json truncated at 16 KB with a marker.
 *  - Tenant scope enforced — facility A's audit is invisible from
 *    facility B's listAuditForEntity.
 *  - Pagination by listAuditForFacility returns newest-first paged.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { bootstrapOpsSchema } from "../../ops/opsStorage";
import * as auditModule from "../../ops/auditStorage";
import {
  AUDIT_JSON_MAX_BYTES,
  listAuditForEntity,
  listAuditForFacility,
  recordAudit,
} from "../../ops/auditStorage";

const FACILITY_A = "TEST-FAC-AT-A";
const FACILITY_B = "TEST-FAC-AT-B";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;

beforeAll(async () => {
  await bootstrapMainSchema();
  await bootstrapOpsSchema();
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM ops_audit_trail WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    `DELETE FROM ops_audit_trail WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
});

describe("auditTrail — append-only API surface", () => {
  it("exports no update / delete / clear / truncate functions", () => {
    const exported = Object.keys(auditModule);
    for (const banned of ["updateAudit", "deleteAudit", "clearAudit", "truncateAudit"]) {
      expect(exported).not.toContain(banned);
    }
    // The only mutation surface is recordAudit (an INSERT).
    expect(exported).toContain("recordAudit");
    expect(exported).toContain("listAuditForEntity");
    expect(exported).toContain("listAuditForFacility");
  });
});

describe("auditTrail — chronological listing", () => {
  it("listAuditForEntity returns rows in ascending occurred_at order", async () => {
    // Force occurred_at via direct INSERT so we don't depend on Date.now
    // monotonicity inside a tight loop.
    const base = Date.now();
    for (let i = 0; i < 5; i += 1) {
      await pool.query(
        `INSERT INTO ops_audit_trail
           (facility_number, actor_id, actor_role, action, entity_type, entity_id,
            before_json, after_json, occurred_at)
         VALUES ($1, $2, 'admin', 'update', 'ops_vendor', 1, NULL, $3, $4)`,
        [FACILITY_A, `actor-${i}`, JSON.stringify({ step: i }), base + i * 1000],
      );
    }
    const rows = await listAuditForEntity(FACILITY_A, "ops_vendor", 1);
    expect(rows.length).toBe(5);
    for (let i = 1; i < rows.length; i += 1) {
      expect(rows[i].occurredAt).toBeGreaterThanOrEqual(rows[i - 1].occurredAt);
    }
    expect(rows[0].actorId).toBe("actor-0");
    expect(rows[4].actorId).toBe("actor-4");
  });
});

describe("auditTrail — JSON truncation at 16 KB", () => {
  it("clips before/after JSON to AUDIT_JSON_MAX_BYTES and adds a marker", async () => {
    const big = "x".repeat(AUDIT_JSON_MAX_BYTES + 5000);
    await recordAudit({
      facilityNumber: FACILITY_A,
      actorId: "alice",
      actorRole: "admin",
      action: "update",
      entityType: "ops_complaint",
      entityId: 99,
      before: { blob: big },
      after: { blob: big + "-new" },
    });
    const r = await pool.query<{ before_json: string; after_json: string }>(
      `SELECT before_json, after_json FROM ops_audit_trail
        WHERE facility_number = $1 AND entity_type = 'ops_complaint' AND entity_id = 99`,
      [FACILITY_A],
    );
    expect(r.rows.length).toBe(1);
    const { before_json, after_json } = r.rows[0];
    expect(Buffer.byteLength(before_json, "utf8")).toBeLessThanOrEqual(
      AUDIT_JSON_MAX_BYTES,
    );
    expect(Buffer.byteLength(after_json, "utf8")).toBeLessThanOrEqual(
      AUDIT_JSON_MAX_BYTES,
    );
    expect(before_json.endsWith("...(truncated)")).toBe(true);
    expect(after_json.endsWith("...(truncated)")).toBe(true);
  });

  it("leaves small payloads untouched", async () => {
    await recordAudit({
      facilityNumber: FACILITY_A,
      actorId: "alice",
      actorRole: "admin",
      action: "create",
      entityType: "ops_vendor",
      entityId: 5,
      after: { name: "ABC Pharmacy", coi: "2026-01-01" },
    });
    const r = await pool.query<{ after_json: string }>(
      `SELECT after_json FROM ops_audit_trail
        WHERE facility_number = $1 AND entity_type = 'ops_vendor' AND entity_id = 5`,
      [FACILITY_A],
    );
    expect(r.rows[0].after_json.endsWith("...(truncated)")).toBe(false);
    expect(JSON.parse(r.rows[0].after_json).name).toBe("ABC Pharmacy");
  });
});

describe("auditTrail — tenant isolation", () => {
  it("listAuditForEntity does not return another facility's rows", async () => {
    await recordAudit({
      facilityNumber: FACILITY_A,
      actorId: "alice",
      actorRole: "admin",
      action: "create",
      entityType: "ops_vendor",
      entityId: 1,
      after: { name: "A's pharmacy" },
    });
    await recordAudit({
      facilityNumber: FACILITY_B,
      actorId: "bob",
      actorRole: "admin",
      action: "create",
      entityType: "ops_vendor",
      entityId: 1, // same entity_id, different facility
      after: { name: "B's pharmacy" },
    });
    const a = await listAuditForEntity(FACILITY_A, "ops_vendor", 1);
    const b = await listAuditForEntity(FACILITY_B, "ops_vendor", 1);
    expect(a.length).toBe(1);
    expect(b.length).toBe(1);
    expect(a[0].actorId).toBe("alice");
    expect(b[0].actorId).toBe("bob");
  });
});

describe("auditTrail — paged facility listing", () => {
  it("listAuditForFacility paginates newest-first", async () => {
    const base = Date.now();
    for (let i = 0; i < 30; i += 1) {
      await pool.query(
        `INSERT INTO ops_audit_trail
           (facility_number, actor_id, actor_role, action, entity_type, entity_id,
            before_json, after_json, occurred_at)
         VALUES ($1, $2, 'admin', 'update', 'ops_vendor', $3, NULL, $4, $5)`,
        [FACILITY_A, `actor-${i}`, i, JSON.stringify({ i }), base + i * 1000],
      );
    }
    const page1 = await listAuditForFacility(FACILITY_A, { page: 1, limit: 10 });
    expect(page1.rows.length).toBe(10);
    expect(page1.total).toBe(30);
    // Newest first.
    expect(page1.rows[0].actorId).toBe("actor-29");

    const page2 = await listAuditForFacility(FACILITY_A, { page: 2, limit: 10 });
    expect(page2.rows.length).toBe(10);
    expect(page2.rows[0].actorId).toBe("actor-19");
  });

  it("filters by (entityType, entityId) when provided", async () => {
    await recordAudit({
      facilityNumber: FACILITY_A,
      actorId: "a",
      actorRole: "admin",
      action: "create",
      entityType: "ops_vendor",
      entityId: 1,
    });
    await recordAudit({
      facilityNumber: FACILITY_A,
      actorId: "b",
      actorRole: "admin",
      action: "create",
      entityType: "ops_complaint",
      entityId: 1,
    });
    const r = await listAuditForFacility(FACILITY_A, {
      entityType: "ops_vendor",
      page: 1,
      limit: 20,
    });
    expect(r.rows.length).toBe(1);
    expect(r.rows[0].entityType).toBe("ops_vendor");
  });
});
