/**
 * client/src/lib/subscription.ts
 *
 * Shared subscription typings + the single gate predicate used to decide
 * whether the Operations toolkit is unlocked for a given facility account.
 *
 * The server augments `GET /api/facility/me` with a `subscription` object
 * (see `server/routes.ts`). This module mirrors that shape so every call
 * site that gates a feature on subscription state imports the same types
 * and the same predicate — drift between an `OperationsTab` gate and the
 * `/facility-portal/notes` deep-link gate is the bug we explicitly want to
 * prevent.
 *
 * Phase 0: only `status` and `currentPeriodEnd` are populated by the
 * backend; the remaining fields are stubbed `null` and will be filled in
 * by the Stripe webhook writer in Phase 1. The frontend reads everything
 * defensively — a missing `subscription` field (e.g. backend not yet
 * deployed) is treated the same as `status: null` and shows the paywall.
 */

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "unpaid"
  | "incomplete"
  | "incomplete_expired"
  | "paused";

export interface FacilitySubscription {
  status: SubscriptionStatus | null;
  currentPeriodEnd: number | null;
  cancelAtPeriodEnd: boolean;
  planId: string | null;
  latestInvoiceUrl: string | null;
  lastFour: string | null;
  cardBrand: string | null;
}

/**
 * Returns `true` when the Operations toolkit (residents, eMAR, trackers,
 * notes, etc.) should be unlocked for this account.
 *
 * Locked decision (Phase 0): only `active` and `trialing` unlock. Every
 * other status — including `past_due`, `canceled`, `null`, or a missing
 * subscription object — shows the paywall.
 */
export function isOperationsActive(
  sub: FacilitySubscription | null | undefined,
): boolean {
  if (!sub || !sub.status) return false;
  return sub.status === "active" || sub.status === "trialing";
}

/**
 * Centralized pricing copy for the Operations Pro paywall.
 *
 * Phase 1 ships a single $99/month plan; Phase 4 will add an annual plan,
 * at which point this becomes a record keyed by plan id. Keeping the
 * string here (instead of inlining $99 in OperationsPaywall) means a
 * future change touches a single line and never drifts between
 * surfaces (paywall card, billing settings, past-due banners).
 */
export const OPERATIONS_PRO_PRICE_LABEL =
  "$99 / month per facility account" as const;
