/**
 * Phase 5 — Scheduler advisory-lock tests.
 *
 * Covers the shared multi-machine-safety pattern used by
 * dailySummaryScheduler and obligationExpireScheduler. The schedulers
 * each export `_phase5Internals.with*Lock` for unit testing the lock
 * semantics in isolation (without the surrounding tick body).
 *
 * The three assertions match the spec:
 *  - Single-process call runs the inner fn exactly once and returns its
 *    value (not null).
 *  - A SECOND concurrent caller, while the first still holds the lock,
 *    fails the try-lock and immediately returns null without running its
 *    inner fn.
 *  - After the first unlocks, a third caller succeeds again.
 *
 * Distinct lock keys mean the daily-summary and obligation-expire
 * schedulers never block each other — verified explicitly because using
 * the same key by accident would have caused every-other-hour starvation
 * across the two crons.
 */

import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pool } from "../../db/index";
import { _phase5Internals as dailySummaryInternals } from "../../ops/dailySummaryScheduler";
import { _phase5Internals as obligationExpireInternals } from "../../ops/obligationExpireScheduler";

beforeAll(async () => {
  // The advisory-lock primitive doesn't need any schema bootstrapped —
  // pg_try_advisory_lock is a built-in. Connecting once here verifies
  // the DATABASE_URL works before the assertions run.
  await pool.query("SELECT 1");
});

afterAll(async () => {
  await pool.end();
});

describe("withDailySummaryLock", () => {
  const { withDailySummaryLock, DAILY_SUMMARY_LOCK_KEY } = dailySummaryInternals;

  it("runs the inner function exactly once when uncontended", async () => {
    let calls = 0;
    const result = await withDailySummaryLock(async () => {
      calls += 1;
      return "ok";
    });
    expect(calls).toBe(1);
    expect(result).toBe("ok");
  });

  it("returns null when another caller already holds the lock", async () => {
    // Hold the lock on a manually-acquired client so the second caller
    // sees a genuine cross-connection conflict.
    const holder = await pool.connect();
    try {
      const got = await holder.query<{ pg_try_advisory_lock: boolean }>(
        `SELECT pg_try_advisory_lock($1) AS pg_try_advisory_lock`,
        [DAILY_SUMMARY_LOCK_KEY],
      );
      expect(got.rows[0].pg_try_advisory_lock).toBe(true);

      let calls = 0;
      const result = await withDailySummaryLock(async () => {
        calls += 1;
        return "should-not-run";
      });
      expect(calls).toBe(0);
      expect(result).toBeNull();
    } finally {
      await holder.query(`SELECT pg_advisory_unlock($1)`, [DAILY_SUMMARY_LOCK_KEY]);
      holder.release();
    }
  });

  it("succeeds again after the previous holder unlocks (finally path)", async () => {
    // First call runs and releases.
    await withDailySummaryLock(async () => "first");
    // Third call (sequential after the unlock) should re-acquire fine.
    let calls = 0;
    const result = await withDailySummaryLock(async () => {
      calls += 1;
      return "third";
    });
    expect(calls).toBe(1);
    expect(result).toBe("third");
  });

  it("releases the lock even when the inner function throws", async () => {
    await expect(
      withDailySummaryLock(async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    // Lock should be released; a follow-up call must succeed.
    const result = await withDailySummaryLock(async () => "after-throw");
    expect(result).toBe("after-throw");
  });
});

describe("withObligationExpireLock", () => {
  const { withObligationExpireLock, OBLIGATION_EXPIRE_LOCK_KEY } =
    obligationExpireInternals;

  it("runs the inner function exactly once when uncontended", async () => {
    let calls = 0;
    const result = await withObligationExpireLock(async () => {
      calls += 1;
      return 42;
    });
    expect(calls).toBe(1);
    expect(result).toBe(42);
  });

  it("returns null when another caller already holds the lock", async () => {
    const holder = await pool.connect();
    try {
      await holder.query(`SELECT pg_advisory_lock($1)`, [
        OBLIGATION_EXPIRE_LOCK_KEY,
      ]);
      let calls = 0;
      const result = await withObligationExpireLock(async () => {
        calls += 1;
        return "should-not-run";
      });
      expect(calls).toBe(0);
      expect(result).toBeNull();
    } finally {
      await holder.query(`SELECT pg_advisory_unlock($1)`, [
        OBLIGATION_EXPIRE_LOCK_KEY,
      ]);
      holder.release();
    }
  });
});

describe("lock-key separation", () => {
  it("daily-summary and obligation-expire use distinct keys", () => {
    // Sanity guard: copy-paste typos would collapse the two schedulers
    // into the same lock and starve one of them every hour.
    expect(dailySummaryInternals.DAILY_SUMMARY_LOCK_KEY).not.toBe(
      obligationExpireInternals.OBLIGATION_EXPIRE_LOCK_KEY,
    );
  });

  it("holding the daily-summary lock does not block obligation-expire", async () => {
    const holder = await pool.connect();
    try {
      await holder.query(`SELECT pg_advisory_lock($1)`, [
        dailySummaryInternals.DAILY_SUMMARY_LOCK_KEY,
      ]);
      // Obligation-expire must still run despite the daily-summary lock
      // being held by another connection.
      const result = await obligationExpireInternals.withObligationExpireLock(
        async () => "ok",
      );
      expect(result).toBe("ok");
    } finally {
      await holder.query(`SELECT pg_advisory_unlock($1)`, [
        dailySummaryInternals.DAILY_SUMMARY_LOCK_KEY,
      ]);
      holder.release();
    }
  });
});
