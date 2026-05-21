/**
 * client/src/lib/csrfToken.ts
 *
 * Per-session CSRF token store for the FE side of Phase 1 backend hardening.
 *
 * The server middleware in `server/middleware/csrfToken.ts` rejects every
 * state-changing `/api/*` request (POST/PUT/PATCH/DELETE) whose
 * `X-CSRF-Token` header doesn't match `req.session.csrfToken`. The token is
 * lazily minted in the `/api/facility/me` and `/api/jobseeker/me` handlers
 * and surfaced in the response body. This module is the single place the FE
 * keeps that token after we read it from `/me`.
 *
 * Why a module-level store and not a React context?
 *   - The CSRF token is needed inside `apiRequest()` in `lib/queryClient.ts`,
 *     which is called from non-React surfaces (TanStack Query mutationFn
 *     callbacks, lib/auth.ts, direct fetches). A React-only context can't be
 *     read from there.
 *   - We already use the same pattern for `queryClient` itself.
 *
 * Lifecycle:
 *   1. App boots. AuthContext fires `getCurrentJobSeeker()` and useSession
 *      fires `useQuery(["/api/facility/me"])`. Both helpers call
 *      `setCsrfTokenIfPresent()` with whatever they got back (200 body or
 *      401 body, if the BE chooses to include the token there too).
 *   2. apiRequest() reads the current token via `getCsrfToken()` and attaches
 *      it as `X-CSRF-Token`. If no token is known, the header is omitted —
 *      the server will return 403 `CSRF_TOKEN_INVALID` and apiRequest's
 *      one-shot retry path will refetch `/me` and try again.
 *   3. On logout, the session is destroyed server-side and a new token will
 *      be minted on the next `/me` round-trip. We clear the local copy so a
 *      stale token isn't replayed against the new session.
 *
 * KNOWN BE GAP (as of Phase 1 BE merge):
 *   Both `/me` endpoints currently return `csrfToken` ONLY on the
 *   authenticated 200 response. The 401 path returns `{ message }` with no
 *   token, which means pre-auth POSTs (register, login, verify-email,
 *   resend-otp, forgot-password, reset-password) have nothing to send and
 *   will 403. This module is written so it'll start working immediately if
 *   the BE is patched to mint+return a token on the 401 path too:
 *   `setCsrfTokenIfPresent` will pick it up unchanged.
 */

let currentToken: string | null = null;

/** Returns the currently-known CSRF token, or null if none has been seen. */
export function getCsrfToken(): string | null {
  return currentToken;
}

/** Replace (or clear, with null) the in-memory token. */
export function setCsrfToken(token: string | null): void {
  currentToken = token;
}

/**
 * Read `csrfToken` off any /me-shaped response body and stash it. Tolerates
 * non-objects, missing fields, and wrong types — `useSession`'s
 * `getQueryFn({ on401: "returnNull" })` may pass `null`, and an old
 * pre-Phase-1 server build won't include the field at all. In both cases we
 * leave the existing token alone.
 *
 * Intentionally does NOT clear the token when the field is absent: a stale
 * token is still better than no token because the 403 retry path can recover
 * once the next /me round-trip lands.
 */
export function setCsrfTokenFromMeBody(body: unknown): void {
  if (!body || typeof body !== "object") return;
  const raw = (body as { csrfToken?: unknown }).csrfToken;
  if (typeof raw === "string" && raw.length > 0) {
    currentToken = raw;
  }
}

/**
 * Refetch `/me` for the given scope and push any csrfToken it returns into
 * the store. Used by `apiRequest()`'s 403-recovery path so a stale token gets
 * replaced without bouncing through the full AuthContext rehydration.
 *
 * scope = "jobseeker"  → GET /api/jobseeker/me
 * scope = "facility"   → GET /api/facility/me
 *
 * The function attempts to parse the response body whether the status is 200
 * or 401 — both can legitimately carry a token once the BE gap is closed.
 * Network errors are swallowed; we'd rather let the caller surface the
 * original 403 than overlay a misleading "couldn't refresh CSRF" message.
 */
export async function refreshCsrfTokenFromMe(
  scope: "facility" | "jobseeker",
  apiBase: string = "",
): Promise<void> {
  const path = scope === "jobseeker" ? "/api/jobseeker/me" : "/api/facility/me";
  try {
    const res = await fetch(`${apiBase}${path}`, { credentials: "include" });
    // Try to parse the body whether 200, 401, or anything else. If the body
    // isn't JSON or doesn't include `csrfToken`, setCsrfTokenFromMeBody is a
    // no-op.
    const body = await res.json().catch(() => null);
    setCsrfTokenFromMeBody(body);
  } catch {
    // Swallow — see docstring rationale.
  }
}

/**
 * Decide which /me endpoint to refresh based on the URL that just 403'd.
 * Job-seeker URLs live under /api/jobseeker; everything else (facility
 * portal, ops, billing, trackers) is on the facility session. Mirrors the
 * cookie dispatcher in server/index.ts.
 */
export function pickScopeForUrl(url: string): "facility" | "jobseeker" {
  return url.startsWith("/api/jobseeker") ? "jobseeker" : "facility";
}
