/**
 * Per-tracker payload validation.
 *
 * Tracker entries store free-form JSON in `tracker_entries.payload`, but each
 * tracker slug owns its own Zod schema (defined in
 * shared/tracker-schemas/<slug>.ts). This module is the single point of entry
 * for validating a payload at the API boundary.
 */

import type { ZodError } from "zod";

import { getPayloadSchema } from "./registry";

export type ValidatePayloadResult =
  | { ok: true; data: unknown }
  | { ok: false; errors: ZodError | { issues: Array<{ path: (string | number)[]; message: string }> } };

/**
 * Validate a payload for the given tracker slug. Returns a discriminated
 * result so callers can pattern-match without a try/catch.
 *
 * - Unknown slug → `{ ok: false }` with a synthetic single-issue error so the
 *   caller can surface it the same way as a Zod failure.
 * - Known slug → delegates to the registered Zod schema via `safeParse`.
 */
export function validatePayload(
  slug: string,
  payload: unknown,
): ValidatePayloadResult {
  const schema = getPayloadSchema(slug);
  if (!schema) {
    return {
      ok: false,
      errors: {
        issues: [
          {
            path: ["slug"],
            message: `Unknown tracker slug: ${slug}`,
          },
        ],
      },
    };
  }
  const parsed = schema.safeParse(payload);
  if (parsed.success) {
    return { ok: true, data: parsed.data };
  }
  return { ok: false, errors: parsed.error };
}

/**
 * Format the first issue from a payload validation result as a short string,
 * e.g. `"payload.status: Invalid enum value"`. Mirrors the helper used in
 * notesRouter.ts for Zod errors.
 */
export function formatPayloadError(
  result: Extract<ValidatePayloadResult, { ok: false }>,
): string {
  const errors = result.errors;
  // ZodError exposes `.issues`; the synthetic shape above also carries issues.
  const issues =
    "issues" in errors && Array.isArray((errors as { issues: unknown }).issues)
      ? (errors as { issues: Array<{ path: (string | number)[]; message: string }> }).issues
      : [];
  const first = issues[0];
  if (!first) return "Invalid payload";
  const path = first.path.length > 0 ? `payload.${first.path.join(".")}` : "payload";
  return `${path}: ${first.message}`;
}
