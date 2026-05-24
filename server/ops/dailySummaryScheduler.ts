/**
 * Wave 3 W14 — Daily-summary email scheduler.
 *
 * Pattern mirrors the "nightly cron via setInterval" approach commonly
 * used elsewhere in the codebase (see `server/index.ts` autoSeedIfEmpty
 * boot hook + CLAUDE.md "ETL scheduler runs nightly at 2 AM UTC"). We
 * tick once per UTC hour:
 *   1. Find every facility where DAILY_SUMMARY_ENABLED='true'.
 *   2. Per facility, check that the current UTC hour matches its
 *      DAILY_SUMMARY_HOUR_UTC reg setting and that no daily_summary row
 *      already exists in `ops_notification_log` for today (UTC).
 *   3. If both pass: aggregate triage, render email, send via Resend
 *      (`sendEmail` in `server/email.ts`), log every recipient row.
 *
 * Resend errors mark the row `failed` and continue — the next hour does
 * NOT retry (idempotency guard would block it). Production runbook is to
 * inspect `ops_notification_log` for `delivery_status='failed'` and
 * trigger a manual test-send.
 *
 * Logging is PHI-conscious: bodyPreview is capped at 500 chars + we don't
 * persist the full message body. Triage snapshot is JSON-capped at 16KB.
 *
 * `manualTest`: bypasses both the enable + hour check + idempotency guard
 * — used by the "Send test email" admin route so an operator can verify
 * delivery without waiting for the scheduled hour to roll around.
 */

import { pool } from "../db/index";
import { aggregateTriage } from "./triageAggregator";
import {
  recordNotification,
  countNotifications,
} from "./notificationStorage";
import {
  getRegSetting,
  REG_SETTING_KEYS,
} from "./regSettings";
import { sendEmail } from "../email";
import { storage } from "../storage";
import {
  TRIAGE_SECTIONS,
  TRIAGE_SECTION_LABELS,
  type TriagePayload,
  type TriageSection,
} from "@shared/triage";

const HOUR_MS = 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────
// Phase 5 — multi-machine safety: pg_try_advisory_lock per tick.
//
// Fly.io deploys may spawn more than one machine. Each machine boots its
// own scheduler interval, so without a cross-process gate every tick would
// fan-out the daily summary email N times — once per machine. We wrap the
// per-tick body in `pg_try_advisory_lock(DAILY_SUMMARY_LOCK_KEY)`: only the
// machine that wins the lock does the work; the rest no-op. The lock is
// HELD on a dedicated client for the duration of the tick, then released
// in `finally`.
//
// Lock-key constant: 0x646169_6c79_7375_6d ≈ ASCII 'dailysum' as a u64.
// Keep stable so locks are deterministic across deploys; changing it
// would create a window where two machines both succeed because they're
// looking at different keys.
// ─────────────────────────────────────────────────────────────────────────
const DAILY_SUMMARY_LOCK_KEY = 0x6461696c7973756d; // 'dailysum'

async function withDailySummaryLock<T>(fn: () => Promise<T>): Promise<T | null> {
  const client = await pool.connect();
  try {
    const res = await client.query<{ pg_try_advisory_lock: boolean }>(
      `SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock`,
      [DAILY_SUMMARY_LOCK_KEY],
    );
    if (!res.rows[0].pg_try_advisory_lock) {
      // Another machine holds the lock; this tick is a no-op for us.
      // eslint-disable-next-line no-console
      console.log("[dailySummary] tick skipped — another machine is processing");
      return null;
    }
    try {
      return await fn();
    } finally {
      await client
        .query(`SELECT pg_advisory_unlock($1)`, [DAILY_SUMMARY_LOCK_KEY])
        .catch(() => {
          // Unlock failure isn't fatal — releasing the client will drop the
          // session-scoped lock anyway. Swallow to keep the tick clean.
        });
    }
  } finally {
    client.release();
  }
}

// Exported for tests so the lock semantics can be exercised without
// pulling the entire scheduler tick into the unit test harness.
export const _phase5Internals = {
  DAILY_SUMMARY_LOCK_KEY,
  withDailySummaryLock,
};

// ─────────────────────────────────────────────────────────────────────────
// Section → include reg-setting key. If a key is missing here, the section
// is always included (e.g. drills, charts, controlled-sub aging do not have
// dedicated toggles in Wave 3 — they ride on the umbrella "obligations"
// toggle so operators can keep the cadence email crisp).
// ─────────────────────────────────────────────────────────────────────────

const SECTION_INCLUDE_KEYS: Partial<
  Record<TriageSection, keyof typeof REG_SETTING_KEYS>
> = {
  overdue_obligations: "DAILY_SUMMARY_INCLUDE_OBLIGATIONS",
  incidents_past_sla: "DAILY_SUMMARY_INCLUDE_INCIDENTS",
  temperature_out_of_range_open: "DAILY_SUMMARY_INCLUDE_TEMPERATURE_OOR",
  credentials_expired: "DAILY_SUMMARY_INCLUDE_CREDENTIALS",
  credentials_expiring: "DAILY_SUMMARY_INCLUDE_CREDENTIALS",
  vendors_expired: "DAILY_SUMMARY_INCLUDE_VENDORS",
  vendors_expiring: "DAILY_SUMMARY_INCLUDE_VENDORS",
  complaints_open: "DAILY_SUMMARY_INCLUDE_COMPLAINTS",
};

// ─────────────────────────────────────────────────────────────────────────
// Email rendering helpers
// ─────────────────────────────────────────────────────────────────────────

function startOfUtcDay(now: number): number {
  const d = new Date(now);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderEmail(
  triage: TriagePayload,
  visibleSections: TriageSection[],
): { subject: string; html: string; text: string; bodyPreview: string } {
  const visibleCount = visibleSections.reduce(
    (n, s) => n + triage.counts[s],
    0,
  );
  const subject = `[Audit Readiness] Daily summary — ${visibleCount} item${visibleCount === 1 ? "" : "s"} need attention`;

  const sectionsWithItems = visibleSections.filter(
    (s) => triage.counts[s] > 0,
  );

  // ── Plaintext ────────────────────────────────────────────────────────
  const textLines: string[] = [];
  textLines.push(`Daily Audit Readiness summary for facility ${triage.facilityNumber}`);
  textLines.push("");
  textLines.push("Counts:");
  for (const section of visibleSections) {
    textLines.push(`  - ${TRIAGE_SECTION_LABELS[section]}: ${triage.counts[section]}`);
  }
  textLines.push("");
  for (const section of sectionsWithItems) {
    const items = triage.items
      .filter((i) => i.section === section)
      .slice(0, 5);
    if (items.length === 0) continue;
    textLines.push(`== ${TRIAGE_SECTION_LABELS[section]} (${triage.counts[section]}) ==`);
    for (const it of items) {
      textLines.push(`  • ${it.subject} — ${it.action}`);
    }
    textLines.push("");
  }
  const text = textLines.join("\n");

  // ── HTML ─────────────────────────────────────────────────────────────
  const htmlLines: string[] = [];
  htmlLines.push(
    `<div style="font-family:sans-serif;max-width:640px;margin:0 auto;padding:24px;color:#1e293b">`,
  );
  htmlLines.push(
    `<h2 style="margin:0 0 8px">Daily Audit Readiness summary</h2>`,
  );
  htmlLines.push(
    `<p style="margin:0 0 16px;color:#64748b">Facility ${escapeHtml(triage.facilityNumber)} — ${visibleCount} item${visibleCount === 1 ? "" : "s"} need attention</p>`,
  );
  htmlLines.push(
    `<table style="width:100%;border-collapse:collapse;margin-bottom:16px">`,
  );
  htmlLines.push(`<tbody>`);
  for (const section of visibleSections) {
    htmlLines.push(
      `<tr><td style="padding:4px 8px;color:#475569">${escapeHtml(TRIAGE_SECTION_LABELS[section])}</td>`
        + `<td style="padding:4px 8px;text-align:right;font-weight:600">${triage.counts[section]}</td></tr>`,
    );
  }
  htmlLines.push(`</tbody></table>`);

  for (const section of sectionsWithItems) {
    const items = triage.items
      .filter((i) => i.section === section)
      .slice(0, 5);
    if (items.length === 0) continue;
    htmlLines.push(
      `<h3 style="margin:16px 0 4px;font-size:14px">${escapeHtml(TRIAGE_SECTION_LABELS[section])} (${triage.counts[section]})</h3>`,
    );
    htmlLines.push(`<ul style="margin:0 0 12px;padding-left:18px;color:#334155">`);
    for (const it of items) {
      htmlLines.push(
        `<li style="margin:2px 0"><strong>${escapeHtml(it.subject)}</strong> — ${escapeHtml(it.action)}</li>`,
      );
    }
    htmlLines.push(`</ul>`);
  }
  htmlLines.push(`</div>`);
  const html = htmlLines.join("\n");

  // bodyPreview = first ~500 chars of the plaintext, for the
  // notification-log row. The recordNotification call trims defensively
  // so we can pass the full text without worry.
  return { subject, html, text, bodyPreview: text };
}

// ─────────────────────────────────────────────────────────────────────────
// Public API — send for one facility
// ─────────────────────────────────────────────────────────────────────────

export interface SendDailySummaryResult {
  sent: number;
  skipped: string[];
  recipients: string[];
}

export interface SendDailySummaryOpts {
  manualTest?: boolean;
  now?: number;
  /** Used by the admin "send test email" endpoint to override stored recipients. */
  overrideRecipients?: string[];
}

/**
 * Send (or skip) one facility's daily summary. Idempotent within a UTC
 * day unless `manualTest` is set.
 *
 * Skips are surfaced in the response with a short reason string so the
 * admin test endpoint can tell the operator why nothing was delivered:
 *   - "disabled"            → DAILY_SUMMARY_ENABLED !== 'true'
 *   - "wrong_hour"          → current UTC hour != DAILY_SUMMARY_HOUR_UTC
 *   - "already_sent_today"  → notification-log row already exists today
 *   - "no_recipients"       → empty list and no fallback email
 *
 * Production scheduler is best-effort: an outbound send failure marks
 * the row `failed` but is NOT re-thrown — the next hour's tick still
 * has the idempotency guard, so the email won't double-fire.
 */
export async function sendDailySummaryForFacility(
  facilityNumber: string,
  opts: SendDailySummaryOpts = {},
): Promise<SendDailySummaryResult> {
  const now = opts.now ?? Date.now();
  const manualTest = opts.manualTest === true;

  if (!manualTest) {
    const enabled = await getRegSetting(facilityNumber, "DAILY_SUMMARY_ENABLED")
      .catch(() => "false");
    if (enabled !== "true") {
      return { sent: 0, skipped: ["disabled"], recipients: [] };
    }
    const hourStr = await getRegSetting(facilityNumber, "DAILY_SUMMARY_HOUR_UTC")
      .catch(() => "14");
    const hour = parseInt(hourStr, 10);
    const currentHour = new Date(now).getUTCHours();
    if (Number.isFinite(hour) && hour !== currentHour) {
      return { sent: 0, skipped: ["wrong_hour"], recipients: [] };
    }
    // Idempotency: skip if any daily_summary row exists today (UTC).
    const dayStart = startOfUtcDay(now);
    const dayEnd = dayStart + 24 * HOUR_MS;
    const already = await countNotifications(facilityNumber, {
      kind: "daily_summary",
      sinceMs: dayStart,
      untilMs: dayEnd,
    }).catch(() => 0);
    if (already > 0) {
      return { sent: 0, skipped: ["already_sent_today"], recipients: [] };
    }
  }

  // Recipients — override > stored list > facility account fallback.
  let recipients: string[] = [];
  if (opts.overrideRecipients && opts.overrideRecipients.length > 0) {
    recipients = opts.overrideRecipients;
  } else {
    const recipStr = await getRegSetting(
      facilityNumber,
      "DAILY_SUMMARY_RECIPIENTS",
    ).catch(() => "");
    recipients = recipStr
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (recipients.length === 0) {
      const acct = await storage
        .getFacilityAccountByNumber(facilityNumber)
        .catch(() => undefined);
      if (acct?.email) recipients = [acct.email];
    }
  }
  if (recipients.length === 0) {
    return { sent: 0, skipped: ["no_recipients"], recipients: [] };
  }

  // Aggregate once.
  const triage = await aggregateTriage(facilityNumber, { now });

  // Resolve section toggles. If a toggle is "false", the section is
  // omitted from the email but still aggregated (the screen reads the
  // same payload). Per the spec.
  const visibleSections: TriageSection[] = [];
  for (const section of TRIAGE_SECTIONS) {
    const key = SECTION_INCLUDE_KEYS[section];
    if (!key) {
      visibleSections.push(section);
      continue;
    }
    const val = await getRegSetting(facilityNumber, key).catch(() => "true");
    if (val !== "false") visibleSections.push(section);
  }

  const { subject, html, text, bodyPreview } = renderEmail(
    triage,
    visibleSections,
  );

  const kind = manualTest ? "manual_test" : "daily_summary";

  let sent = 0;
  for (const recipient of recipients) {
    let deliveryStatus: "sent" | "failed" = "sent";
    let deliveryError: string | undefined;
    let resendMessageId: string | undefined;
    let sentAt: number | undefined;
    try {
      const r = await sendEmail({ to: recipient, subject, html, text });
      resendMessageId = r.messageId;
      sentAt = Date.now();
      sent += 1;
    } catch (err) {
      deliveryStatus = "failed";
      const msg = (err as Error)?.message ?? String(err);
      // Truncate the error for the log column — never persist a stack.
      deliveryError = msg.slice(0, 400);
    }
    // Logging failure must NOT take the email out (audit-trail pattern).
    try {
      await recordNotification({
        facilityNumber,
        channel: "email",
        kind,
        recipient,
        subject,
        bodyPreview,
        triageSnapshot: triage,
        scheduledFor: now,
        deliveryStatus,
        deliveryError,
        resendMessageId,
        sentAt,
      });
    } catch (logErr) {
      // eslint-disable-next-line no-console
      console.error(
        `[dailySummary] notification-log insert failed for ${facilityNumber}:`,
        (logErr as Error)?.message ?? logErr,
      );
    }
  }

  return { sent, skipped: [], recipients };
}

// ─────────────────────────────────────────────────────────────────────────
// Hourly tick — finds every opted-in facility and sends if the hour matches
// ─────────────────────────────────────────────────────────────────────────

/**
 * Run one scheduler tick. Exported for testability — the production
 * `setInterval` calls this every hour; tests can invoke it directly.
 *
 * Phase 5: wrapped in `withDailySummaryLock` so only one Fly machine runs
 * the work per tick. Returns `null` shape when another machine holds the
 * lock (`{ attempted: 0, sent: 0, skipped: 0 }` — same shape so callers
 * don't need to special-case the no-op).
 */
export async function runDailySummaryTick(
  now: number = Date.now(),
): Promise<{ attempted: number; sent: number; skipped: number }> {
  const result = await withDailySummaryLock(async () => {
    // One query lists every facility that has opted in. The tick is rare
    // (once per UTC hour) and per-facility processing is fast, so the
    // simple "fetch all enabled, then per-facility hour check" approach is
    // acceptable for the ~100 user scale.
    const res = await pool.query<{ facility_number: string }>(
      `SELECT facility_number FROM ops_facility_settings
         WHERE setting_key = 'DAILY_SUMMARY_ENABLED'
           AND setting_value = 'true'`,
    );
    let attempted = 0;
    let sent = 0;
    let skipped = 0;
    for (const row of res.rows) {
      attempted += 1;
      try {
        const r = await sendDailySummaryForFacility(row.facility_number, { now });
        sent += r.sent;
        if (r.sent === 0) skipped += 1;
      } catch (err) {
        // Top-level guard — a single facility's failure must not stop the
        // tick from processing the others.
        // eslint-disable-next-line no-console
        console.error(
          `[dailySummary] tick failed for ${row.facility_number}:`,
          (err as Error)?.message ?? err,
        );
        skipped += 1;
      }
    }
    return { attempted, sent, skipped };
  });
  return result ?? { attempted: 0, sent: 0, skipped: 0 };
}

/**
 * Start the once-per-UTC-hour scheduler. Returns a `stop` handle so a
 * future graceful shutdown can cancel the interval cleanly.
 *
 * Implementation: align the first tick to the top of the next hour via
 * `setTimeout`, then run on a fixed `setInterval(HOUR_MS)` from there.
 * If `DISABLE_DAILY_SUMMARY=1` is set in the environment, the scheduler
 * no-ops — used by staging / test deployments that share a DB with prod.
 */
export function startDailySummaryScheduler(): { stop: () => void } {
  if (process.env.DISABLE_DAILY_SUMMARY === "1") {
    // eslint-disable-next-line no-console
    console.log("[dailySummary] DISABLE_DAILY_SUMMARY=1 — scheduler not started");
    return { stop: () => {} };
  }

  let intervalHandle: NodeJS.Timeout | null = null;
  let timeoutHandle: NodeJS.Timeout | null = null;

  const now = Date.now();
  const msUntilTopOfHour = HOUR_MS - (now % HOUR_MS);

  timeoutHandle = setTimeout(() => {
    timeoutHandle = null;
    runDailySummaryTick().catch((err) => {
      // eslint-disable-next-line no-console
      console.error("[dailySummary] tick error:", (err as Error)?.message ?? err);
    });
    intervalHandle = setInterval(() => {
      runDailySummaryTick().catch((err) => {
        // eslint-disable-next-line no-console
        console.error("[dailySummary] tick error:", (err as Error)?.message ?? err);
      });
    }, HOUR_MS);
  }, msUntilTopOfHour);

  // eslint-disable-next-line no-console
  console.log(
    `[dailySummary] scheduler started — first tick in ${Math.round(msUntilTopOfHour / 60000)}m`,
  );

  return {
    stop: () => {
      if (timeoutHandle) clearTimeout(timeoutHandle);
      if (intervalHandle) clearInterval(intervalHandle);
    },
  };
}
