/**
 * Tracker alert summary query — counts only.
 *
 * Backend: GET /api/ops/trackers/alerts/summary
 *   → { success, data: { active, critical, warn, info } }
 *
 * Auto-polls every 60 s so the OperationsTab badge / banners stay fresh
 * without a websocket. The list query (`useTrackerAlerts`) is the source of
 * truth for individual rows; this hook only exists so badges don't have to
 * pull the full list.
 */
import { useQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type {
  AlertSummaryEnvelope,
} from "./useTrackerAlerts";

export function useTrackerAlertSummary(opts: { enabled?: boolean } = {}) {
  const { enabled = true } = opts;
  return useQuery<AlertSummaryEnvelope>({
    queryKey: ["/api/ops/trackers/alerts/summary"],
    enabled,
    queryFn: async () => {
      const res = await apiRequest(
        "GET",
        "/api/ops/trackers/alerts/summary",
      );
      return (await res.json()) as AlertSummaryEnvelope;
    },
    // 60 s auto-refresh so the badge stays current. Window-focus refresh is
    // disabled globally; we rely on the interval.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
}
