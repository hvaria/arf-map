/**
 * Fetch a single tracker definition by slug. Returns null on 401 (caller
 * routes to login), or `data === null` when the slug is unknown (the server
 * 404s → `getQueryFn` "throw" mode would surface as a query error; we use
 * "returnNull" here and let the caller render a 404 page when the data is
 * absent).
 */
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { SerializedTrackerDefinition } from "@shared/tracker-schemas";

interface DefinitionEnvelope {
  success: boolean;
  data: SerializedTrackerDefinition;
}

export function useTrackerDefinition(slug: string | undefined) {
  return useQuery<DefinitionEnvelope | null>({
    queryKey: ["/api/ops/trackers/definitions", slug ?? ""],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!slug,
    staleTime: 5 * 60 * 1000,
  });
}
