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

export interface JobSeekerProfile {
  id: number;
  email: string;
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

/** POST /api/jobseeker/login */
export async function loginJobSeeker(
  credentials: LoginCredentials,
): Promise<JobSeekerProfile> {
  const res = await fetch("/api/jobseeker/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    },
    credentials: "include",
    body: JSON.stringify(credentials),
  });
  return handleResponse<JobSeekerProfile>(res);
}

/** POST /api/jobseeker/logout */
export async function logoutJobSeeker(): Promise<void> {
  const res = await fetch("/api/jobseeker/logout", {
    method: "POST",
    headers: { "X-Requested-With": "XMLHttpRequest" },
    credentials: "include",
  });
  await handleResponse<{ ok: boolean }>(res);
}

/** GET /api/jobseeker/me — rehydrates the session from the server cookie */
export async function getCurrentJobSeeker(): Promise<JobSeekerProfile | null> {
  const res = await fetch("/api/jobseeker/me", { credentials: "include" });
  if (res.status === 401) return null;
  return handleResponse<JobSeekerProfile>(res);
}
