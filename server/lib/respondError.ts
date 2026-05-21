/**
 * respondError — canonical HTTP error envelope (Phase 0).
 *
 * Goal: collapse the three error shapes currently in the codebase
 *   - `{ message }`              (server/routes.ts, server/routes/jobseekerAuth.ts, …)
 *   - `{ success: false, error }`(server/ops/opsRouter.ts)
 *   - `{ code, message? }`       (server/routes/billing.ts, requireActiveSubscription.ts)
 * into a single, machine-readable shape that the client can parse
 * unambiguously:
 *
 *     {
 *       code: string,           // stable, SCREAMING_SNAKE_CASE
 *       message: string,        // human-readable; safe to surface in UI
 *       details?: unknown,      // optional structured data (e.g. ZodIssue[])
 *     }
 *
 * Phase 0 only ships the helper + one example route. The remaining routes
 * keep their legacy shapes until Phase 6 does a mechanical migration.
 *
 * Notes on backward compatibility:
 *   - The `message` field is retained so existing FE error parsers that
 *     look at `body.message` keep working when a route is migrated.
 *   - The legacy 402 SUBSCRIPTION_REQUIRED envelope (which already carries
 *     `code` + `message` + the extra `upgradeUrl` field) is intentionally
 *     untouched — it's already aligned with the target shape.
 */

import { ZodError, type ZodIssue } from "zod";
import type { Response } from "express";

/** Canonical envelope shape returned to the client on errors. */
export interface ErrorEnvelope {
  code: string;
  message: string;
  details?: unknown;
}

/**
 * Typed error class for handlers that want to throw a domain error and let
 * `respondError` translate it into the canonical envelope.
 *
 *   throw new AppError("NOT_FOUND", "Resident not found", 404);
 *
 * Status defaults to 500 if the caller doesn't supply one.
 */
export class AppError extends Error {
  public readonly code: string;
  public readonly statusCode: number;
  public readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;
  }
}

/** Type guard: a plain object that already carries `code` + numeric status. */
function isCodedError(err: unknown): err is {
  code: string;
  statusCode: number;
  message?: string;
  details?: unknown;
} {
  if (typeof err !== "object" || err === null) return false;
  const e = err as Record<string, unknown>;
  return typeof e.code === "string" && typeof e.statusCode === "number";
}

/** True when running under `NODE_ENV=production`. */
function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Send the canonical error envelope.
 *
 *   - ZodError                → 400 VALIDATION_ERROR, details = issues
 *   - AppError / coded error  → uses .statusCode + .code
 *   - everything else         → 500 INTERNAL_ERROR (generic message)
 *
 * In non-production, a `stack` field is attached to `details` so devs can
 * see where things failed in the network panel. In production, `details`
 * is omitted for unknown errors so we never leak internals.
 *
 * The original error is always logged with `console.error` (Phase 0
 * logging — Sentry integration is a sibling task).
 */
export function respondError(res: Response, err: unknown, status?: number): Response {
  console.error("[respondError]", err);

  // 1) Zod validation — first issue's message is the user-facing string,
  //    and the full issue array is attached as `details` for the FE to
  //    render field-level errors if it wants to.
  if (err instanceof ZodError) {
    const issues: ZodIssue[] = err.errors;
    const message = issues[0]?.message ?? "Validation failed";
    const body: ErrorEnvelope = {
      code: "VALIDATION_ERROR",
      message,
      details: { issues },
    };
    return res.status(status ?? 400).json(body);
  }

  // 2) Known coded error — AppError or any object with `.code` + `.statusCode`.
  //    This is the escape hatch for domain errors thrown deep in storage.
  if (isCodedError(err)) {
    const body: ErrorEnvelope = {
      code: err.code,
      message: err.message ?? err.code,
    };
    if (err.details !== undefined) {
      body.details = err.details;
    }
    if (!isProduction() && err instanceof Error && err.stack) {
      body.details = { ...(body.details as object | undefined), stack: err.stack };
    }
    return res.status(status ?? err.statusCode).json(body);
  }

  // 3) Fall-through: anything we can't recognise. Never leak internals in
  //    prod; in dev, include the stack so failures are debuggable.
  const body: ErrorEnvelope = {
    code: "INTERNAL_ERROR",
    message: "Something went wrong. Please try again.",
  };
  if (!isProduction() && err instanceof Error) {
    body.details = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return res.status(status ?? 500).json(body);
}
