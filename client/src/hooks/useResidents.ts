/**
 * useResidents — single source of truth for a facility's resident list.
 *
 * Replaces 6 hand-rolled fetchers across IncidentsPage, BillingPage,
 * NotesPage, OpsCalendar, AddTaskDialog, ResidentsPage. Each had its own
 * `interface Resident` with a different field subset, which made cross-page
 * resident data unreliable.
 *
 * `activeOnly` is the default because most forms (Incidents, Tasks,
 * Billing) should only allow active residents. Pages that need the full
 * list (admin/audit views) opt in.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { getQueryFn } from "@/lib/queryClient";

export interface Resident {
  id: number;
  firstName: string;
  lastName: string;
  status?: string;
  roomNumber?: string | null;
  bedNumber?: string | null;
  primaryDx?: string | null;
}

interface ListResponse {
  success: boolean;
  data: Resident[];
}

export function useResidents(
  facilityNumber: string,
  opts: { activeOnly?: boolean } = { activeOnly: true },
) {
  const query = useQuery<ListResponse | null>({
    queryKey: [`/api/ops/facilities/${facilityNumber}/residents`],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!facilityNumber,
    staleTime: 60_000,
  });

  const all = useMemo(() => query.data?.data ?? [], [query.data]);
  const visible = useMemo(
    () => (opts.activeOnly === false ? all : all.filter((r) => !r.status || r.status === "active")),
    [all, opts.activeOnly],
  );

  return { ...query, residents: visible, all };
}
