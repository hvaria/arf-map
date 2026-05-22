import { QueryClient, QueryFunction } from "@tanstack/react-query";
import {
  getCsrfToken,
  pickScopeForUrl,
  refreshCsrfTokenFromMe,
} from "./csrfToken";
import { forceLegalModalOpen } from "@/lib/legalState";

// In native Capacitor builds, set VITE_API_URL to your deployed server, e.g.:
//   VITE_API_URL=https://your-server.com npm run mobile:build
// Exported so the ApiUnreachableOverlay diagnostic can show what
// origin every fetch is actually targeting.
export const API_BASE =
  import.meta.env.VITE_API_URL ||
  ("__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__");

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        let message = text; try { const j = JSON.parse(text); message = j.message || j.error || text; } catch {} throw new Error(message);
  }
}

/** Methods that the server's CSRF middleware gates. Mirrors the
 *  STATE_CHANGING_METHODS set in server/middleware/csrfToken.ts. */
const STATE_CHANGING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Build the request headers for a single apiRequest() call.
 *
 *  - `X-Requested-With: XMLHttpRequest` is the original CSRF sentinel; the
 *    server still enforces it as belt-and-braces. Sent on every call.
 *  - `Content-Type: application/json` only when a JSON body is being sent.
 *  - `X-CSRF-Token` is added on state-changing /api/* calls when a token has
 *    been captured from a prior /me response. If we don't have a token yet
 *    the server will respond 403 and we'll trigger the recovery path below.
 */
function buildHeaders(
  method: string,
  url: string,
  hasBody: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    "X-Requested-With": "XMLHttpRequest",
  };
  if (hasBody) headers["Content-Type"] = "application/json";

  if (
    STATE_CHANGING_METHODS.has(method.toUpperCase()) &&
    url.startsWith("/api/")
  ) {
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
  }
  return headers;
}

/**
 * Detect the 403 `CSRF_TOKEN_INVALID` response shape from
 * server/middleware/csrfToken.ts WITHOUT consuming the body — we may need
 * to surface it to the caller if the retry also fails.
 *
 * Returns the parsed body (so the caller can use it) and whether it was a
 * CSRF rejection.
 */
async function inspectCsrfFailure(
  res: Response,
): Promise<{ isCsrf: boolean; body: unknown }> {
  if (res.status !== 403) return { isCsrf: false, body: undefined };
  // Clone so the original Response is still readable by throwIfResNotOk if
  // we end up bubbling.
  let body: unknown = undefined;
  try {
    body = await res.clone().json();
  } catch {
    return { isCsrf: false, body: undefined };
  }
  const code = (body as { code?: unknown })?.code;
  return { isCsrf: code === "CSRF_TOKEN_INVALID", body };
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  // S-01 + Phase-1 CSRF token. Server middleware in `server/middleware/csrfToken.ts`
  // rejects POST/PUT/PATCH/DELETE on /api/* without a matching X-CSRF-Token.
  // The token lives in `lib/csrfToken.ts`, populated whenever /me resolves.
  //
  // Truthy-only body check preserves prior behavior (data=null/0/"" → no body,
  // no Content-Type — matches the original `if (data)` semantics that every
  // existing call site relies on).
  const hasBody = !!data;
  const body = hasBody ? JSON.stringify(data) : undefined;

  const doFetch = () =>
    fetch(`${API_BASE}${url}`, {
      method,
      credentials: "include",
      headers: buildHeaders(method, url, hasBody),
      body,
    });

  const res = await doFetch();

  // ── 403 CSRF_TOKEN_INVALID recovery ────────────────────────────────────
  // The token may have rotated (server restart, session destroy on the
  // server side, our local copy got out of sync). Refetch /me to pick up
  // the fresh token and retry the original call EXACTLY ONCE. A second
  // failure bubbles to the caller via throwIfResNotOk below so we don't
  // loop on a permanently bad token.
  if (res.status === 403) {
    const { isCsrf } = await inspectCsrfFailure(res);
    if (isCsrf) {
      await refreshCsrfTokenFromMe(pickScopeForUrl(url), API_BASE);
      const retry = await fetch(`${API_BASE}${url}`, {
        method,
        credentials: "include",
        headers: buildHeaders(method, url, hasBody),
        body,
      });
      await throwIfResNotOk(retry);
      return retry;
    }
  }

  // ── 409 LEGAL_REACCEPT_REQUIRED recovery (Phase 4) ─────────────────────
  // Server gates state-changing requests when the account's accepted legal
  // doc versions are stale vs LEGAL_DOCS. Surface the blocking modal,
  // async-refetch both /me to pick up new pendingAcceptances, then throw
  // so the caller's onError sees the original failure. The user re-clicks
  // the action naturally after accepting in the modal.
  if (res.status === 409) {
    try {
      const probe = await res.clone().json();
      if (probe && (probe as { code?: string }).code === "LEGAL_REACCEPT_REQUIRED") {
        const audience: "seeker" | "facility" | null = url.includes("/jobseeker")
          ? "seeker"
          : url.includes("/facility") || url.includes("/ops")
          ? "facility"
          : null;
        forceLegalModalOpen(audience);
        void Promise.resolve().then(async () => {
          try {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["/api/facility/me"] }),
              queryClient.invalidateQueries({ queryKey: ["/api/jobseeker/me"] }),
            ]);
          } catch {
            /* modal is already up; refetch failure is non-fatal */
          }
        });
      }
    } catch {
      /* body wasn't JSON — fall through to default handling */
    }
  }

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const res = await fetch(`${API_BASE}${queryKey.join("/")}`, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

// Default to "returnNull" on 401 — matches what every protected portal
// query has been opting in to (39 sites). Pages that need the throw
// behavior can still override per-query with getQueryFn({ on401: "throw" }).
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "returnNull" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      staleTime: Infinity,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
