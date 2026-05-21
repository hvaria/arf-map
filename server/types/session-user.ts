/**
 * SessionUser — the safe-to-expose shape of an authenticated facility account.
 *
 * Why this exists.
 *   `Express.User` was previously declared as `extends FacilityAccount`. That
 *   pulled the password hash + OTP/verification columns into the type scope of
 *   every handler that touches `req.user`, which encourages accidental
 *   serialisation of secrets into a JSON response. We strip those fields at
 *   the boundary (passport.deserializeUser) and expose only this narrowed
 *   shape to route handlers.
 *
 * If a consumer really needs the full row (e.g. to re-verify a password during
 * a password-change flow) it should re-fetch it via
 * `storage.getFacilityAccount(req.user.id)` — not read it off req.user.
 */
import type { FacilityAccount } from "@shared/schema";

export type SessionUser = Omit<
  FacilityAccount,
  "password" | "verificationToken" | "verificationExpiry"
>;

/**
 * Strip sensitive fields from a facility-account row before handing it to
 * Passport's serialiser. Used in `passport.deserializeUser` so `req.user`
 * never carries the password hash or OTP token through the request lifecycle.
 */
export function toSessionUser(account: FacilityAccount): SessionUser {
  const { password: _p, verificationToken: _t, verificationExpiry: _e, ...rest } = account;
  return rest;
}
