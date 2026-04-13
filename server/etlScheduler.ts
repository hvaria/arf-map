/**
 * server/etlScheduler.ts
 *
 * Schedules the nightly CCLD enrichment job to run inside the same Fly.io
 * machine as the app, avoiding any volume-sharing conflict.
 *
 * The enrichment script (dist/enrich.cjs) runs as a child process so it gets
 * its own event loop and does not block the HTTP server. SQLite WAL mode
 * (already enabled in server/db/index.ts) allows the app to serve reads
 * concurrently while the enrichment process writes.
 *
 * Logs are written to the child process's stdout, which Fly.io's log
 * aggregator captures and makes visible in `fly logs`.
 */

import { spawn, ChildProcess } from "child_process";
import path from "path";

// ── State ─────────────────────────────────────────────────────────────────────

let runningProc: ChildProcess | null = null;

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[etl-scheduler ${ts}] ${msg}`);
}

// ── Runner ────────────────────────────────────────────────────────────────────

function runEnrichment(trigger: "scheduled" | "manual" = "scheduled") {
  if (runningProc) {
    log("skipping — previous run still in progress");
    return;
  }

  const scriptPath = path.resolve(process.cwd(), "dist/enrich.cjs");
  log(`starting enrichment (trigger=${trigger}) → node ${scriptPath}`);

  runningProc = spawn("node", [scriptPath, "--trigger", trigger], {
    cwd:   process.cwd(),
    env:   process.env,
    // inherit: child writes directly to this process's stdout/stderr so
    // fly logs picks it up without any piping code here.
    stdio: "inherit",
  });

  runningProc.on("exit", (code) => {
    log(`enrichment finished — exit code ${code ?? "?"}`);
    runningProc = null;
  });

  runningProc.on("error", (err) => {
    log(`enrichment process error: ${err.message}`);
    runningProc = null;
  });
}

// ── Scheduler (no external dependency — plain setTimeout) ─────────────────────

/**
 * Returns the number of milliseconds until the next occurrence of `hour:00 UTC`.
 * Always at least 1 minute in the future so an exact-second startup doesn't
 * fire twice.
 */
function msUntilNextHourUtc(hour: number): number {
  const now  = new Date();
  const next = new Date(now);
  next.setUTCHours(hour, 0, 0, 0);
  if (next.getTime() - now.getTime() < 60_000) {
    // already past — target tomorrow
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next.getTime() - now.getTime();
}

function scheduleNext(hourUtc: number) {
  const delay = msUntilNextHourUtc(hourUtc);
  const nextRun = new Date(Date.now() + delay);
  log(`next enrichment run scheduled at ${nextRun.toUTCString()}`);

  setTimeout(() => {
    runEnrichment();
    scheduleNext(hourUtc); // re-arm for the following day
  }, delay);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Call once at app startup (production only).
 *
 * @param hourUtc  UTC hour to run enrichment (default: 2 = 2 AM UTC).
 *                 Override via ETL_HOUR_UTC env var.
 */
export function startEtlScheduler(hourUtc = 2) {
  const hour = parseInt(process.env.ETL_HOUR_UTC ?? String(hourUtc), 10);
  log(`daily CCLD enrichment scheduler started (runs at ${hour}:00 UTC)`);
  scheduleNext(hour);
}

/**
 * Trigger enrichment immediately (e.g. from the admin endpoint).
 * No-ops if a run is already in progress.
 */
export function triggerEnrichmentNow() {
  runEnrichment("manual");
}

/** True if enrichment is currently running. */
export function isEnrichmentRunning() {
  return runningProc !== null;
}
