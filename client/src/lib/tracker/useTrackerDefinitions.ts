/**
 * Fetch the list of active tracker definitions from the server.
 *
 * The server returns the JSON-safe shape (Zod payloadSchema stripped). The
 * client carries its own per-tracker schemas locally — see
 * `@shared/tracker-schemas/index.ts`.
 */
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import type { SerializedTrackerDefinition } from "@shared/tracker-schemas";

interface DefinitionsEnvelope {
  success: boolean;
  data: SerializedTrackerDefinition[];
}

export function useTrackerDefinitions() {
  return useQuery<DefinitionsEnvelope | null>({
    queryKey: ["/api/ops/trackers/definitions"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000,
  });
}
