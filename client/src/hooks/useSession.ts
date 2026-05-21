/**
 * useSession — single source of truth for the current facility-portal user.
 *
 * Replaces 17 hand-rolled `useQuery(["/api/facility/me"])` blocks across
 * the codebase. React Query's cache already deduped the network request,
 * but each call site duplicated the query config + the type definition,
 * which had drifted (some had `role?`, some didn't). One hook fixes both.
 *
 * Phase 1 CSRF — the `/api/facility/me` response now carries a `csrfToken`
 * field that the FE must replay on every mutation. This hook is the single
 * consumer of facility /me, so it's the right (only) place to capture the
 * token into the module-level store. See `lib/csrfToken.ts`.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { setCsrfTokenFromMeBody } from "@/lib/csrfToken";
import type { SessionUser } from "@/types/session";

export function useSession() {
  const query = useQuery<SessionUser | null>({
    queryKey: ["/api/facility/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000,
  });

  // Capture csrfToken from every successful /me round-trip. Runs once per
  // data change (including the initial 401→null transition which leaves the
  // existing token alone — setCsrfTokenFromMeBody is a no-op on null).
  useEffect(() => {
    if (query.data) setCsrfTokenFromMeBody(query.data);
  }, [query.data]);

  return query;
}
