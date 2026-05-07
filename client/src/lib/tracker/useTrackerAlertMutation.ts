/**
 * Mutation hooks for tracker alerts.
 *
 * Backend:
 *   POST /api/ops/trackers/alerts/:id/acknowledge   { note?: string }
 *   POST /api/ops/trackers/alerts/:id/resolve       { note?: string }
 *
 * Each returns `{ success, data: AlertRow }`. On success we invalidate both
 * the list query (every filter variant) and the summary query.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { AlertRow } from "./useTrackerAlerts";

interface MutationInput {
  id: number;
  note?: string;
}

interface MutationResponse {
  success: true;
  data: AlertRow;
}

function invalidateAlerts(qc: ReturnType<typeof useQueryClient>) {
  // Prefix-match every list variant ([..., {filters}]).
  qc.invalidateQueries({ queryKey: ["/api/ops/trackers/alerts"] });
  qc.invalidateQueries({
    queryKey: ["/api/ops/trackers/alerts/summary"],
  });
}

/** Acknowledge an alert. Optional note is stored alongside the alert. */
export function useAcknowledgeAlert() {
  const qc = useQueryClient();
  return useMutation<MutationResponse, Error, MutationInput>({
    mutationFn: async ({ id, note }) => {
      const res = await apiRequest(
        "POST",
        `/api/ops/trackers/alerts/${id}/acknowledge`,
        note !== undefined && note.trim().length > 0 ? { note } : {},
      );
      return (await res.json()) as MutationResponse;
    },
    onSuccess: () => invalidateAlerts(qc),
  });
}

/** Resolve an alert. Mirrors `useAcknowledgeAlert`. */
export function useResolveAlert() {
  const qc = useQueryClient();
  return useMutation<MutationResponse, Error, MutationInput>({
    mutationFn: async ({ id, note }) => {
      const res = await apiRequest(
        "POST",
        `/api/ops/trackers/alerts/${id}/resolve`,
        note !== undefined && note.trim().length > 0 ? { note } : {},
      );
      return (await res.json()) as MutationResponse;
    },
    onSuccess: () => invalidateAlerts(qc),
  });
}
