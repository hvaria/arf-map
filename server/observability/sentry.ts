/**
 * Sentry wiring.
 *
 * Sentry is optional: when SENTRY_DSN is unset the app boots normally and
 * captureException becomes a silent no-op. This keeps local/dev/test
 * workflows zero-config while still giving us crash reporting in prod.
 *
 * The module exposes:
 *   - initSentry()              call once at process boot, before middleware
 *   - isSentryEnabled()         test hook + guards
 *   - captureExceptionFromRequest(err, req)
 *       attaches request context (method, url, route, user agent) and ships
 *       the error. Never throws — failures are swallowed and logged.
 */

import * as Sentry from "@sentry/node";
import type { Request } from "express";

let enabled = false;

export function isSentryEnabled(): boolean {
  return enabled;
}

/** Reset internal state — for tests only. */
export function __resetSentryForTests(): void {
  enabled = false;
}

/**
 * Initialise Sentry if SENTRY_DSN is present. Idempotent: a second call is
 * a no-op so a re-import in tests can't double-init.
 *
 * Logs a single line on either path so operators can confirm config from logs.
 */
export function initSentry(): void {
  if (enabled) return;

  const dsn = process.env.SENTRY_DSN;
  if (!dsn) {
    // eslint-disable-next-line no-console
    console.log("[sentry] disabled (no DSN)");
    return;
  }

  const environment = process.env.NODE_ENV ?? "development";
  const release =
    process.env.FLY_IMAGE_REF ?? process.env.npm_package_version ?? undefined;

  Sentry.init({
    dsn,
    environment,
    tracesSampleRate: environment === "production" ? 0.1 : 1.0,
    release,
    // Express integration enriches errors/transactions with the matched
    // route name. Note: full OpenTelemetry-based tracing instrumentation
    // requires Sentry to load before Express; because ESM hoists imports
    // we can't fully guarantee that ordering here without a separate
    // --import preload file. captureException still works regardless;
    // tracing depth is best-effort.
    integrations: [Sentry.expressIntegration()],
  });

  enabled = true;
  // eslint-disable-next-line no-console
  console.log(`[sentry] enabled (env=${environment}${release ? `, release=${release}` : ""})`);
}

/**
 * Send an error to Sentry with request context attached. Safe to call
 * unconditionally — when Sentry is disabled this is a cheap no-op.
 *
 * Intentionally fire-and-forget: Sentry batches sends internally; awaiting
 * here would block the error response.
 */
export function captureExceptionFromRequest(err: unknown, req: Request): void {
  if (!enabled) return;

  try {
    Sentry.withScope((scope) => {
      scope.setTag("method", req.method);
      scope.setTag("path", req.path);
      // route is populated by Express once the matching layer runs
      const route = (req as Request & { route?: { path?: string } }).route?.path;
      if (route) scope.setTag("route", route);

      const ua = req.headers["user-agent"];
      if (typeof ua === "string") scope.setTag("user_agent", ua);

      scope.setContext("request", {
        method: req.method,
        url: req.originalUrl ?? req.url,
        path: req.path,
        query: req.query,
      });

      Sentry.captureException(err);
    });
  } catch (sentryErr) {
    // Never let observability break the error path.
    // eslint-disable-next-line no-console
    console.error("[sentry] captureException failed:", sentryErr);
  }
}
