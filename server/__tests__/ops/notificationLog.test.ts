/**
 * Wave 3 W14 — Notification-log storage tests.
 *
 * Coverage mirrors `auditTrail.test.ts`:
 *  - Insert-only API surface: no update / delete / clear sibling exposed.
 *  - recordNotification persists + listNotifications round-trips.
 *  - Filters by kind / deliveryStatus / time range.
 *  - Tenant isolation: facility A's rows are invisible from facility B.
 *  - triage_snapshot JSON capped at 16 KB with the truncation marker.
 *  - body_preview defensively trimmed at 500 chars.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { bootstrapOpsSchema } from "../../ops/opsStorage";
import * as notifModule from "../../ops/notificationStorage";
import {
  NOTIFICATION_BODY_PREVIEW_MAX,
  NOTIFICATION_SNAPSHOT_MAX_BYTES,
  listNotifications,
  recordNotification,
} from "../../ops/notificationStorage";

const FACILITY_A = "TEST-FAC-NOTIF-A";
const FACILITY_B = "TEST-FAC-NOTIF-B";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;

beforeAll(async () => {
  await bootstrapMainSchema();
  await bootstrapOpsSchema();
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM ops_notification_log WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    `DELETE FROM ops_notification_log WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
});

describe("notificationLog — append-only API surface", () => {
  it("exports no update / delete / clear / truncate functions", () => {
    const exported = Object.keys(notifModule);
    for (const banned of [
      "updateNotification",
      "deleteNotification",
      "clearNotifications",
      "truncateNotifications",
    ]) {
      expect(exported).not.toContain(banned);
    }
    expect(exported).toContain("recordNotification");
    expect(exported).toContain("listNotifications");
  });
});

describe("notificationLog — persist + list round-trip", () => {
  it("recordNotification persists rows visible to listNotifications", async () => {
    const scheduledFor = Date.now();
    await recordNotification({
      facilityNumber: FACILITY_A,
      channel: "email",
      kind: "daily_summary",
      recipient: "admin@example.com",
      subject: "Daily summary",
      bodyPreview: "Hello world",
      scheduledFor,
      deliveryStatus: "sent",
      sentAt: scheduledFor + 100,
      resendMessageId: "abc-123",
    });
    const { rows, total } = await listNotifications(FACILITY_A, {
      page: 1,
      limit: 10,
    });
    expect(total).toBe(1);
    expect(rows[0].recipient).toBe("admin@example.com");
    expect(rows[0].deliveryStatus).toBe("sent");
    expect(rows[0].resendMessageId).toBe("abc-123");
  });

  it("filters by kind + deliveryStatus + time range", async () => {
    const base = Date.now();
    for (let i = 0; i < 4; i += 1) {
      await recordNotification({
        facilityNumber: FACILITY_A,
        channel: "email",
        kind: i % 2 === 0 ? "daily_summary" : "manual_test",
        recipient: `admin-${i}@example.com`,
        subject: `Subj ${i}`,
        scheduledFor: base + i * 1000,
        deliveryStatus: i === 3 ? "failed" : "sent",
      });
    }
    const summaryOnly = await listNotifications(FACILITY_A, {
      kind: "daily_summary",
      page: 1,
      limit: 10,
    });
    expect(summaryOnly.total).toBe(2);

    const failedOnly = await listNotifications(FACILITY_A, {
      deliveryStatus: "failed",
      page: 1,
      limit: 10,
    });
    expect(failedOnly.total).toBe(1);
    expect(failedOnly.rows[0].recipient).toBe("admin-3@example.com");

    // Window covers rows 1+2 only (sinceMs inclusive, untilMs exclusive).
    const window = await listNotifications(FACILITY_A, {
      sinceMs: base + 1000,
      untilMs: base + 3000,
      page: 1,
      limit: 10,
    });
    expect(window.total).toBe(2);
  });
});

describe("notificationLog — tenant isolation", () => {
  it("listNotifications does not return another facility's rows", async () => {
    const now = Date.now();
    await recordNotification({
      facilityNumber: FACILITY_A,
      channel: "email",
      kind: "daily_summary",
      recipient: "a@example.com",
      subject: "A",
      scheduledFor: now,
      deliveryStatus: "sent",
    });
    await recordNotification({
      facilityNumber: FACILITY_B,
      channel: "email",
      kind: "daily_summary",
      recipient: "b@example.com",
      subject: "B",
      scheduledFor: now,
      deliveryStatus: "sent",
    });
    const a = await listNotifications(FACILITY_A, { page: 1, limit: 10 });
    const b = await listNotifications(FACILITY_B, { page: 1, limit: 10 });
    expect(a.total).toBe(1);
    expect(b.total).toBe(1);
    expect(a.rows[0].recipient).toBe("a@example.com");
    expect(b.rows[0].recipient).toBe("b@example.com");
  });
});

describe("notificationLog — JSON + bodyPreview truncation", () => {
  it("triage_snapshot is clipped to NOTIFICATION_SNAPSHOT_MAX_BYTES with marker", async () => {
    const big = "x".repeat(NOTIFICATION_SNAPSHOT_MAX_BYTES + 5000);
    await recordNotification({
      facilityNumber: FACILITY_A,
      channel: "email",
      kind: "daily_summary",
      recipient: "admin@example.com",
      subject: "Big",
      triageSnapshot: { blob: big },
      scheduledFor: Date.now(),
      deliveryStatus: "sent",
    });
    // Phase 2 R2: triage_snapshot is JSONB. Oversized payloads are replaced
    // with a sentinel object (was a byte-truncated string with a marker).
    const r = await pool.query<{ triage_snapshot: unknown }>(
      `SELECT triage_snapshot FROM ops_notification_log WHERE facility_number = $1`,
      [FACILITY_A],
    );
    expect(r.rows.length).toBe(1);
    const snapshot = r.rows[0].triage_snapshot as {
      _truncated: boolean;
      _originalSizeBytes: number;
      _maxBytes: number;
      _preview: string;
    };
    expect(snapshot._truncated).toBe(true);
    expect(snapshot._originalSizeBytes).toBeGreaterThan(NOTIFICATION_SNAPSHOT_MAX_BYTES);
    expect(snapshot._maxBytes).toBe(NOTIFICATION_SNAPSHOT_MAX_BYTES);
    expect(typeof snapshot._preview).toBe("string");
    expect(snapshot._preview.length).toBeLessThanOrEqual(512);
  });

  it("body_preview is trimmed to NOTIFICATION_BODY_PREVIEW_MAX chars", async () => {
    const longBody = "y".repeat(NOTIFICATION_BODY_PREVIEW_MAX + 500);
    await recordNotification({
      facilityNumber: FACILITY_A,
      channel: "email",
      kind: "daily_summary",
      recipient: "admin@example.com",
      subject: "Long",
      bodyPreview: longBody,
      scheduledFor: Date.now(),
      deliveryStatus: "sent",
    });
    const r = await pool.query<{ body_preview: string }>(
      `SELECT body_preview FROM ops_notification_log WHERE facility_number = $1`,
      [FACILITY_A],
    );
    expect(r.rows[0].body_preview.length).toBeLessThanOrEqual(
      NOTIFICATION_BODY_PREVIEW_MAX,
    );
  });

  it("leaves small payloads untouched", async () => {
    await recordNotification({
      facilityNumber: FACILITY_A,
      channel: "email",
      kind: "daily_summary",
      recipient: "admin@example.com",
      subject: "Small",
      bodyPreview: "ok",
      triageSnapshot: { totalItems: 0 },
      scheduledFor: Date.now(),
      deliveryStatus: "sent",
    });
    // Phase 2 R2: triage_snapshot is JSONB. node-postgres returns the parsed
    // value directly — no JSON.parse needed.
    const r = await pool.query<{ body_preview: string; triage_snapshot: unknown }>(
      `SELECT body_preview, triage_snapshot FROM ops_notification_log WHERE facility_number = $1`,
      [FACILITY_A],
    );
    expect(r.rows[0].body_preview).toBe("ok");
    expect(r.rows[0].triage_snapshot).toEqual({ totalItems: 0 });
  });
});
