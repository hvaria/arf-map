/**
 * Wave 3 W14 — Daily-summary scheduler tests.
 *
 * Coverage:
 *  - DAILY_SUMMARY_ENABLED=false (default) → skipped, no notification row.
 *  - manualTest=true → bypasses both the enable + hour-check guards.
 *  - Empty DAILY_SUMMARY_RECIPIENTS → falls back to facility_account.email.
 *  - One notification_log row inserted per recipient when fan-out > 1.
 *  - Resend send is mocked; verify subject + plaintext include the counts.
 *  - Idempotency: a second call inside the same UTC day is skipped because
 *    a daily_summary row already exists today.
 *
 * Conventions reused from server/__tests__/ops/obligations.test.ts.
 */

import "dotenv/config";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { bootstrapOpsSchema } from "../../ops/opsStorage";
import { sendDailySummaryForFacility } from "../../ops/dailySummaryScheduler";
import { setRegSetting } from "../../ops/regSettings";
import {
  cleanFacilityAccounts,
  seedFacility,
} from "../trackers/setupTestApp";

// Mock the email module before anything that imports it loads.
vi.mock("../../email", () => {
  return {
    sendEmail: vi.fn(async () => ({ messageId: "mock-msg-id" })),
    sendVerificationEmail: vi.fn(async () => undefined),
    sendPasswordResetEmail: vi.fn(async () => undefined),
  };
});

const FACILITY_A = "TEST-FAC-DSE-A";
const ALL_FN = [FACILITY_A] as const;
const ACTOR_OPTS = { actorId: "test-runner", actorRole: "admin" };

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_notification_log    WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail         WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_facility_settings   WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
}

beforeAll(async () => {
  await bootstrapMainSchema();
  await bootstrapOpsSchema();
  await seedFacility({
    facilityNumber: FACILITY_A,
    username: "test-dse-a-user",
    password: "test-pw-dse-a-12345!",
    email: "dse-a-primary@example.com",
  });
});

afterAll(async () => {
  await cleanup();
  await cleanFacilityAccounts(ALL_FN);
  await pool.end();
});

beforeEach(async () => {
  await cleanup();
  const email = await import("../../email");
  (email.sendEmail as ReturnType<typeof vi.fn>).mockClear();
});

describe("dailySummaryScheduler — disabled facility is skipped", () => {
  it("returns skipped + writes no notification row", async () => {
    // DAILY_SUMMARY_ENABLED defaults to 'false' per the catalogue. Don't
    // touch the setting — confirm the default-disabled path.
    const r = await sendDailySummaryForFacility(FACILITY_A);
    expect(r.sent).toBe(0);
    expect(r.skipped).toContain("disabled");
    const count = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM ops_notification_log WHERE facility_number = $1`,
      [FACILITY_A],
    );
    expect(Number(count.rows[0].c)).toBe(0);

    const email = await import("../../email");
    expect((email.sendEmail as ReturnType<typeof vi.fn>)).not.toHaveBeenCalled();
  });
});

describe("dailySummaryScheduler — manualTest bypasses gates", () => {
  it("sends regardless of enable/hour and writes a notification row", async () => {
    const r = await sendDailySummaryForFacility(FACILITY_A, {
      manualTest: true,
      overrideRecipients: ["override@example.com"],
    });
    expect(r.sent).toBe(1);
    expect(r.recipients).toEqual(["override@example.com"]);
    const rows = await pool.query<{ kind: string; recipient: string; subject: string; body_preview: string }>(
      `SELECT kind, recipient, subject, body_preview FROM ops_notification_log
        WHERE facility_number = $1`,
      [FACILITY_A],
    );
    expect(rows.rows.length).toBe(1);
    expect(rows.rows[0].kind).toBe("manual_test");
    expect(rows.rows[0].recipient).toBe("override@example.com");
    expect(rows.rows[0].subject).toContain("[Audit Readiness] Daily summary");
    // Plaintext bodyPreview should at minimum mention the section labels.
    expect(rows.rows[0].body_preview.toLowerCase()).toContain("overdue obligations");
  });
});

describe("dailySummaryScheduler — fallback to facility_account.email", () => {
  it("uses primary account email when DAILY_SUMMARY_RECIPIENTS is empty", async () => {
    await setRegSetting(FACILITY_A, "DAILY_SUMMARY_RECIPIENTS", "", {
      actorId: ACTOR_OPTS.actorId,
      actorRole: ACTOR_OPTS.actorRole,
    });
    const r = await sendDailySummaryForFacility(FACILITY_A, { manualTest: true });
    expect(r.recipients).toEqual(["dse-a-primary@example.com"]);
    expect(r.sent).toBe(1);
  });
});

describe("dailySummaryScheduler — per-recipient log rows", () => {
  it("inserts one notification row per recipient on fan-out", async () => {
    const r = await sendDailySummaryForFacility(FACILITY_A, {
      manualTest: true,
      overrideRecipients: ["a@example.com", "b@example.com", "c@example.com"],
    });
    expect(r.sent).toBe(3);
    const rows = await pool.query<{ recipient: string }>(
      `SELECT recipient FROM ops_notification_log WHERE facility_number = $1
        ORDER BY recipient ASC`,
      [FACILITY_A],
    );
    expect(rows.rows.map((x) => x.recipient)).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
  });
});

describe("dailySummaryScheduler — Resend mock surface", () => {
  it("forwards subject + plaintext text body to sendEmail", async () => {
    const email = await import("../../email");
    const spy = email.sendEmail as ReturnType<typeof vi.fn>;
    await sendDailySummaryForFacility(FACILITY_A, {
      manualTest: true,
      overrideRecipients: ["watch@example.com"],
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const arg = spy.mock.calls[0][0];
    expect(arg.subject).toContain("Daily summary");
    expect(typeof arg.html).toBe("string");
    expect(typeof arg.text).toBe("string");
    expect(arg.text.toLowerCase()).toContain("counts");
  });
});

describe("dailySummaryScheduler — idempotency inside one UTC day", () => {
  it("second non-manual call inside the same UTC day is skipped", async () => {
    // Enable + pin the hour to the current UTC hour so both calls match.
    await setRegSetting(FACILITY_A, "DAILY_SUMMARY_ENABLED", "true", ACTOR_OPTS);
    const currentHour = new Date().getUTCHours();
    await setRegSetting(
      FACILITY_A,
      "DAILY_SUMMARY_HOUR_UTC",
      String(currentHour),
      ACTOR_OPTS,
    );
    await setRegSetting(
      FACILITY_A,
      "DAILY_SUMMARY_RECIPIENTS",
      "first-call@example.com",
      ACTOR_OPTS,
    );

    const first = await sendDailySummaryForFacility(FACILITY_A);
    expect(first.sent).toBe(1);

    const second = await sendDailySummaryForFacility(FACILITY_A);
    expect(second.sent).toBe(0);
    expect(second.skipped).toContain("already_sent_today");

    const count = await pool.query<{ c: number }>(
      `SELECT COUNT(*)::int AS c FROM ops_notification_log
        WHERE facility_number = $1 AND kind = 'daily_summary'`,
      [FACILITY_A],
    );
    expect(Number(count.rows[0].c)).toBe(1);
  });
});
