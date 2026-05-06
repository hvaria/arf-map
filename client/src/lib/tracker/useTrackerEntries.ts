/**
 * Tracker entries query — cursor-paginated via `useInfiniteQuery`.
 *
 * Cursor is a JSON `{ occurredAt, id }` value, URL-encoded once into the
 * `cursor` query parameter exactly as the backend expects. Filters compose
 * into the same querystring; we keep the cache key shape stable to make
 * invalidation simple.
 */
import { useInfiniteQuery } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Shift } from "@shared/tracker-schemas";

export interface TrackerEntryRow {
  id: number;
  clientId: string;
  trackerSlug: string;
  trackerDefinitionId: number;
  facilityNumber: string;
  residentId: number | null;
  shift: Shift | null;
  occurredAt: number;
  reportedByFacilityAccountId: number;
  reportedByStaffId: number | null;
  reportedByDisplayName: string;
  reportedByRole: string;
  payload: unknown;
  status: "active" | "edited" | "deleted";
  isIncident: number;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  deletedByAccountId: number | null;
}

export interface TrackerEntriesPage {
  items: TrackerEntryRow[];
  nextCursor?: { occurredAt: number; id: number };
}

export interface EntriesEnvelope {
  success: boolean;
  data: TrackerEntriesPage;
}

export interface TrackerEntriesFilters {
  slug: string;
  /** Inclusive lower bound on occurred_at (epoch ms). */
  from?: number;
  /** Inclusive upper bound on occurred_at (epoch ms). */
  to?: number;
  shift?: Shift;
  residentId?: number;
  /** Optional page size; backend default is 50, max 200. */
  limit?: number;
  /** Disable while we don't have a slug yet. */
  enabled?: boolean;
}

function buildPath(
  filters: TrackerEntriesFilters,
  cursor?: { occurredAt: number; id: number },
): string {
  const params = new URLSearchParams();
  if (filters.from !== undefined) params.set("from", String(filters.from));
  if (filters.to !== undefined) params.set("to", String(filters.to));
  if (filters.shift !== undefined) params.set("shift", filters.shift);
  if (filters.residentId !== undefined)
    params.set("residentId", String(filters.residentId));
  if (filters.limit !== undefined) params.set("limit", String(filters.limit));
  if (cursor) params.set("cursor", JSON.stringify(cursor));
  const qs = params.toString();
  return `/api/ops/trackers/${filters.slug}/entries${qs ? `?${qs}` : ""}`;
}

export function useTrackerEntries(filters: TrackerEntriesFilters) {
  const { slug, enabled = true, ...rest } = filters;

  return useInfiniteQuery<EntriesEnvelope>({
    // Stable, structured cache key. TanStack Query v5 hashes objects
    // deterministically with sorted keys, so `rest` as-is is safe — and
    // prefix-matching `["/api/ops/trackers", slug, "entries"]` still
    // invalidates every cached filter variant.
    queryKey: ["/api/ops/trackers", slug, "entries", rest],
    enabled: enabled && !!slug,
    initialPageParam: undefined as
      | { occurredAt: number; id: number }
      | undefined,
    queryFn: async ({ pageParam }) => {
      // Use the shared `apiRequest` helper so error envelopes are parsed
      // through the same `throwIfResNotOk` path every other hook uses.
      const res = await apiRequest(
        "GET",
        buildPath(filters, pageParam as { occurredAt: number; id: number } | undefined),
      );
      return (await res.json()) as EntriesEnvelope;
    },
    getNextPageParam: (lastPage) => lastPage.data.nextCursor ?? undefined,
    staleTime: 30_000,
  });
}
