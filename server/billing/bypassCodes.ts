/**
 * Owner-controlled bypass codes — flip a facility account to `active`
 * WITHOUT going through Stripe.
 *
 * Why this exists: the owner needs a way to comp themselves, internal
 * testers, partners, and stakeholders without creating Stripe customers,
 * subscriptions, or $0 invoices. Stripe Coupons (allow_promotion_codes
 * in Checkout) still go through Stripe and leave a paper trail there;
 * these codes are pure in-app — no Stripe API call, no customer record,
 * no webhook traffic.
 *
 * Config: `OPERATIONS_BYPASS_CODES` env var = comma-separated list of
 * accepted codes (e.g. `OWNER_FOREVER,STAFF_2026`). Whitespace is
 * trimmed; empty entries are ignored. Codes are case-sensitive.
 *
 * Rotation: change the env var and `fly secrets set` redeploys. There
 * is no DB store, so revocation is instant and global.
 *
 * Audit: each redemption is `console.log`-ed by the route handler (no
 * full code, just the user id and code prefix). Phase 3's admin view
 * will surface comped-vs-paying separately by inspecting whether the
 * account has a corresponding facility_subscriptions row with a
 * non-null stripe_customer_id.
 */

import { timingSafeEqual } from "node:crypto";

const ENV_VAR = "OPERATIONS_BYPASS_CODES";

function getConfiguredCodes(): string[] {
  const raw = process.env[ENV_VAR];
  if (!raw) return [];
  return raw
    .split(",")
    .map((c) => c.trim())
    .filter((c) => c.length > 0);
}

/**
 * Constant-time comparison so brute-force timing attacks can't shave
 * bits off the code character-by-character. Pads the shorter string so
 * timingSafeEqual doesn't throw on length mismatch.
 */
function constantTimeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.length !== bBuf.length) {
    // Still do a comparison to keep timing roughly uniform; result is false.
    timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

export function isValidBypassCode(submitted: string): boolean {
  if (!submitted || typeof submitted !== "string") return false;
  const configured = getConfiguredCodes();
  if (configured.length === 0) return false;
  // OR across all configured codes via constant-time compare.
  let anyMatch = false;
  for (const code of configured) {
    if (constantTimeEquals(submitted, code)) anyMatch = true;
  }
  return anyMatch;
}

export function bypassCodesAreConfigured(): boolean {
  return getConfiguredCodes().length > 0;
}
