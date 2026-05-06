/**
 * useSession — single source of truth for the current facility-portal user.
 *
 * Replaces 17 hand-rolled `useQuery(["/api/facility/me"])` blocks across
 * the codebase. React Query's cache already deduped the network request,
 * but each call site duplicated the query config + the type definition,
 * which had drifted (some had `role?`, some didn't). One hook fixes both.
 */
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { SessionUser } from "@/types/session";

export function useSession() {
  return useQuery<SessionUser | null>({
    queryKey: ["/api/facility/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000,
  });
}
