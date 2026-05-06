/**
 * Mutation hooks for tracker entries.
 *
 * Each hook funnels through `apiRequest` which automatically attaches
 * `X-Requested-With: XMLHttpRequest` (CSRF) and `Content-Type` for JSON
 * bodies. On success we invalidate the list cache for the affected slug; on
 * the by-id endpoints we additionally invalidate the single-entry key.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { Shift } from "@shared/tracker-schemas";
import type { TrackerEntryRow } from "./useTrackerEntries";

export interface CreateEntryInput {
  /** UUID v4 — caller MUST persist across retries. */
  clientId: string;
  residentId?: number;
  shift?: Shift;
  occurredAt: number;
  payload: unknown;
  isIncident?: boolean;
}

interface CreateEntryResponse {
  success: true;
  data: TrackerEntryRow;
  duplicate: boolean;
}

/** Generic UUIDv4 — Capacitor webview lacks `crypto.randomUUID` in some older Android variants. */
export function makeClientId(): string {
  if (
    typeof crypto !== "undefined" &&
    typeof crypto.randomUUID === "function"
  ) {
    return crypto.randomUUID();
  }
  // RFC4122-compliant fallback. Sufficient for client idempotency tokens.
  const buf = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < 16; i++) buf[i] = Math.floor(Math.random() * 256);
  }
  buf[6] = (buf[6] & 0x0f) | 0x40;
  buf[8] = (buf[8] & 0x3f) | 0x80;
  const hex = Array.from(buf, (b) => b.toString(16).padStart(2, "0"));
  return `${hex.slice(0, 4).join("")}-${hex.slice(4, 6).join("")}-${hex
    .slice(6, 8)
    .join("")}-${hex.slice(8, 10).join("")}-${hex.slice(10, 16).join("")}`;
}

/** Create a single tracker entry. */
export function useCreateTrackerEntry(slug: string) {
  const qc = useQueryClient();
  return useMutation<CreateEntryResponse, Error, CreateEntryInput>({
    mutationFn: async (input) => {
      const res = await apiRequest(
        "POST",
        `/api/ops/trackers/${slug}/entries`,
        input,
      );
      return (await res.json()) as CreateEntryResponse;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ops/trackers", slug, "entries"] });
    },
  });
}

export interface PatchEntryInput {
  payload?: unknown;
  shift?: Shift | null;
  occurredAt?: number;
  isIncident?: boolean;
  changeReason?: string;
}

/** Patch a single tracker entry by id. */
export function usePatchTrackerEntry(slug: string) {
  const qc = useQueryClient();
  return useMutation<
    { success: true; data: TrackerEntryRow },
    Error,
    { id: number; patch: PatchEntryInput }
  >({
    mutationFn: async ({ id, patch }) => {
      const res = await apiRequest(
        "PATCH",
        `/api/ops/trackers/entries/${id}`,
        patch,
      );
      return (await res.json()) as { success: true; data: TrackerEntryRow };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ops/trackers", slug, "entries"] });
    },
  });
}

/** Soft-delete a single tracker entry. */
export function useDeleteTrackerEntry(slug: string) {
  const qc = useQueryClient();
  return useMutation<
    { success: true; data: TrackerEntryRow },
    Error,
    { id: number }
  >({
    mutationFn: async ({ id }) => {
      const res = await apiRequest(
        "DELETE",
        `/api/ops/trackers/entries/${id}`,
      );
      return (await res.json()) as { success: true; data: TrackerEntryRow };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/ops/trackers", slug, "entries"] });
    },
  });
}
