/**
 * client/src/lib/auth.ts
 *
 * Thin API client for job seeker authentication.
 * All network calls go through this module — the rest of the app never
 * calls fetch() directly for auth operations.
 *
 * Extension points:
 *   - OAuth / SSO:  add initiateOAuthLogin() that redirects to the IdP,
 *     and handleOAuthCallback() that exchanges the code for a session.
 *   - Token-based auth:  add getAccessToken() / refreshAccessToken() and
 *     attach the token in request headers here.
 */

import {
  getCsrfToken,
  refreshCsrfTokenFromMe,
  setCsrfTokenFromMeBody,
} from "./csrfToken";
import type { LegalDocSlug } from "@/lib/legal";

export interface JobSeekerProfile {
  id: number;
  email: string;
  /** Phase 1 CSRF — present on `/api/jobseeker/me` (200) responses.
   *  Consumers should treat absence as "no change"; the field is stripped
   *  before being stored in AuthContext so React renders don't see it. */
  csrfToken?: string;
  /**
   * Phase 4 — legal acceptance gate. Slugs the current account has NOT
   * yet accepted at the current document version. Server adds it to
   * `GET /api/jobseeker/me` responses. Older server builds may omit the
   * field; treat undefined as `[]`.
   */
  pendingAcceptances?: LegalDocSlug[];
}

export interface LoginCredentials {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface ApiError {
  message: string;
  code?: string;
}

async function handleResponse<T>(res: Response): Promise<T> {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err: ApiError = {
      message: (body as ApiError).message ?? "An unexpected error occurred.",
      code: (body as ApiError).code,
    };
    throw err;
  }
  return body as T;
}

/**
 * Build the auth-route headers. Mirrors `apiRequest()` in `lib/queryClient`
 * so these direct fetches participate in the same CSRF contract.
 *
 * These calls live OUTSIDE apiRequest() because lib/auth.ts is the public
 * interface every other surface (AuthContext, JobSeekerPage) imports, and
 * rewriting it to go through apiRequest would create a circular import
 * (apiRequest already imports csrfToken).
 */
function authHeaders(hasJsonBody: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Requested-With": "XMLHttpRequest",
  };
  if (hasJsonBody) headers["Content-Type"] = "application/json";
  const csrf = getCsrfToken();
  if (csrf) headers["X-CSRF-Token"] = csrf;
  return headers;
}

/** POST /api/jobseeker/login */
export async function loginJobSeeker(
  credentials: LoginCredentials,
): Promise<JobSeekerProfile> {
  const res = await fetch("/api/jobseeker/login", {
    method: "POST",
    headers: authHeaders(true),
    credentials: "include",
    body: JSON.stringify(credentials),
  });
  // 403 CSRF recovery — refresh /me and retry once. Login is the most
  // sensitive call here because if we don't have a token before the user
  // can authenticate, every login attempt would 403. See lib/csrfToken.ts
  // for the BE-gap note on pre-auth tokens.
  if (res.status === 403) {
    const body = await res.clone().json().catch(() => null);
    if ((body as { code?: string } | null)?.code === "CSRF_TOKEN_INVALID") {
      await refreshCsrfTokenFromMe("jobseeker");
      const retry = await fetch("/api/jobseeker/login", {
        method: "POST",
        headers: authHeaders(true),
        credentials: "include",
        body: JSON.stringify(credentials),
      });
      const profile = await handleResponse<JobSeekerProfile>(retry);
      setCsrfTokenFromMeBody(profile);
      return profile;
    }
  }
  const profile = await handleResponse<JobSeekerProfile>(res);
  // Login response carries no csrfToken today, but if a future BE patch
  // ever adds one this captures it; otherwise the AuthContext effect will
  // immediately refetch /me which surfaces the token. No-op if absent.
  setCsrfTokenFromMeBody(profile);
  return profile;
}

/** POST /api/jobseeker/logout */
export async function logoutJobSeeker(): Promise<void> {
  const res = await fetch("/api/jobseeker/logout", {
    method: "POST",
    headers: authHeaders(false),
    credentials: "include",
  });
  if (res.status === 403) {
    const body = await res.clone().json().catch(() => null);
    if ((body as { code?: string } | null)?.code === "CSRF_TOKEN_INVALID") {
      await refreshCsrfTokenFromMe("jobseeker");
      const retry = await fetch("/api/jobseeker/logout", {
        method: "POST",
        headers: authHeaders(false),
        credentials: "include",
      });
      await handleResponse<{ ok: boolean }>(retry);
      return;
    }
  }
  await handleResponse<{ ok: boolean }>(res);
}

/** GET /api/jobseeker/me — rehydrates the session from the server cookie */
export async function getCurrentJobSeeker(): Promise<JobSeekerProfile | null> {
  const res = await fetch("/api/jobseeker/me", { credentials: "include" });
  // Try to capture the csrfToken from BOTH the 200 and 401 bodies (only
  // the 200 path mints one today, but setCsrfTokenFromMeBody is a no-op
  // when the field is absent — see lib/csrfToken.ts for the BE-gap note).
  const body = await res.clone().json().catch(() => null);
  setCsrfTokenFromMeBody(body);
  if (res.status === 401) return null;
  return handleResponse<JobSeekerProfile>(res);
}
