/**
 * Bug #5 — Alerts query invalidation.
 *
 * After a tracker entry mutation (create / patch / delete) the success path
 * MUST invalidate three cache surfaces so that the TrackerAlertsCard count
 * and the in-tracker red banner refresh inside the same React round-trip
 * as the cell-state update:
 *   • ["/api/ops/trackers", slug, "entries"]
 *   • ["/api/ops/trackers/alerts"]
 *   • ["/api/ops/trackers/alerts/summary"]
 *
 * We mock `apiRequest` (the only network surface used by these hooks) and
 * spy on `QueryClient.invalidateQueries` to assert the exact key shapes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Mock apiRequest before importing the hooks so the import binds to the mock.
vi.mock("../lib/queryClient", () => ({
  apiRequest: vi.fn(),
}));

import { apiRequest } from "../lib/queryClient";
import {
  useCreateTrackerEntry,
  usePatchTrackerEntry,
  useDeleteTrackerEntry,
  makeClientId,
} from "../lib/tracker/useTrackerMutation";

const mockApi = apiRequest as unknown as ReturnType<typeof vi.fn>;

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: async () => body,
  } as unknown as Response;
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function freshClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

beforeEach(() => {
  mockApi.mockReset();
});

describe("Bug #5: useCreateTrackerEntry invalidates entries + alerts + summary", () => {
  it("invalidates the slug entries list, the global alerts list, and the alerts summary on success", async () => {
    const qc = freshClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    mockApi.mockResolvedValue(
      jsonResponse({
        success: true,
        duplicate: false,
        data: {
          id: 42,
          payload: { goal_id: "bathing", status: "C" },
        },
      }),
    );

    const { result } = renderHook(() => useCreateTrackerEntry("vitals"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.mutate({
        clientId: makeClientId(),
        residentId: 1,
        occurredAt: Date.now(),
        payload: { systolic: 200, diastolic: 130 },
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    // The 3 keys MUST be invalidated. Order doesn't matter.
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["/api/ops/trackers", "vitals", "entries"],
        ["/api/ops/trackers/alerts"],
        ["/api/ops/trackers/alerts/summary"],
      ]),
    );
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it("does NOT invalidate when the mutation errors (no false-positive cache busts)", async () => {
    const qc = freshClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    mockApi.mockRejectedValue(new Error("boom"));

    const { result } = renderHook(() => useCreateTrackerEntry("vitals"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.mutate({
        clientId: makeClientId(),
        occurredAt: Date.now(),
        payload: {},
      });
    });

    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(spy).not.toHaveBeenCalled();
  });

  it("invalidates with the slug passed to the hook (not the URL)", async () => {
    const qc = freshClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    mockApi.mockResolvedValue(
      jsonResponse({ success: true, duplicate: false, data: { id: 1, payload: {} } }),
    );

    const { result } = renderHook(() => useCreateTrackerEntry("adl"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.mutate({
        clientId: makeClientId(),
        occurredAt: Date.now(),
        payload: {},
      });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    // Slug should appear in the entries key.
    expect(keys).toContainEqual(["/api/ops/trackers", "adl", "entries"]);
    // Alerts keys are global (no slug fragment).
    expect(keys).toContainEqual(["/api/ops/trackers/alerts"]);
    expect(keys).toContainEqual(["/api/ops/trackers/alerts/summary"]);
  });
});

describe("Bug #5: usePatchTrackerEntry invalidates entries + alerts + summary", () => {
  it("invalidates all three keys on PATCH success", async () => {
    const qc = freshClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    mockApi.mockResolvedValue(
      jsonResponse({ success: true, data: { id: 42, payload: { note: "x" } } }),
    );

    const { result } = renderHook(() => usePatchTrackerEntry("vitals"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.mutate({ id: 42, patch: { payload: { note: "x" } } });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["/api/ops/trackers", "vitals", "entries"],
        ["/api/ops/trackers/alerts"],
        ["/api/ops/trackers/alerts/summary"],
      ]),
    );
  });
});

describe("Bug #5: useDeleteTrackerEntry invalidates entries + alerts + summary", () => {
  it("invalidates all three keys on DELETE success — so a soft-deleted entry's alert disappears immediately", async () => {
    const qc = freshClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    mockApi.mockResolvedValue(
      jsonResponse({ success: true, data: { id: 42, status: "deleted" } }),
    );

    const { result } = renderHook(() => useDeleteTrackerEntry("adl"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.mutate({ id: 42 });
    });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    const keys = spy.mock.calls.map((c) => c[0]?.queryKey);
    expect(keys).toEqual(
      expect.arrayContaining([
        ["/api/ops/trackers", "adl", "entries"],
        ["/api/ops/trackers/alerts"],
        ["/api/ops/trackers/alerts/summary"],
      ]),
    );
  });
});

describe("Bug #5 edge case: rapid successive saves invalidate every time", () => {
  it("fires invalidations once per successful mutation, not bundled or skipped", async () => {
    const qc = freshClient();
    const spy = vi.spyOn(qc, "invalidateQueries");

    mockApi.mockResolvedValue(
      jsonResponse({ success: true, duplicate: false, data: { id: 1, payload: {} } }),
    );

    const { result } = renderHook(() => useCreateTrackerEntry("vitals"), {
      wrapper: wrapper(qc),
    });

    await act(async () => {
      result.current.mutate({
        clientId: makeClientId(),
        occurredAt: Date.now(),
        payload: {},
      });
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    spy.mockClear();

    await act(async () => {
      result.current.mutate({
        clientId: makeClientId(),
        occurredAt: Date.now(),
        payload: {},
      });
    });
    await waitFor(() => expect(result.current.data).toBeDefined());

    // 3 keys, 1 second mutation → 3 invalidation calls.
    // (TanStack Query dedupes by key on the cache layer; that's fine — what
    // we're asserting here is that the hook ITSELF kicks off invalidation
    // for every successful settle, not just the first one.)
    expect(spy).toHaveBeenCalledTimes(3);
  });
});
