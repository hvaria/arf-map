/**
 * Chart completeness smoke tests — Wave 2 W8.
 *
 * Covers:
 *   - <ResidentsContent> renders a chart chip per row given a mocked aggregate
 *     response (one row "ok", one row "missing · 3 missing", one row "stale").
 *   - The "Chart incomplete · N missing" chip surfaces the correct N.
 *   - <AuditReadinessContent> Overview tile "Charts incomplete" shows the
 *     correct count from the list endpoint's `total`.
 *
 * Pattern reused:
 *   - QueryClient + provider wrapper:
 *       client/src/__tests__/AuditTrailButton.test.tsx:37-50
 *   - vi.stubGlobal("fetch", …) URL-routing mock:
 *       client/src/__tests__/AuditTrailButton.test.tsx:108-129
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { ResidentsContent } from "../components/operations/ResidentsContent";
import { AuditReadinessContent } from "../components/operations/AuditReadinessContent";
import type { ChartCompletenessPayload } from "../components/operations/ChartCompletenessBanner";

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function freshClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0, gcTime: 0 },
      mutations: { retry: false },
    },
  });
}

function wrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>{children}</QueryClientProvider>
  );
}

function residentRow(id: number, first: string, last: string) {
  return {
    id,
    firstName: first,
    lastName: last,
    status: "active",
    roomNumber: "101",
    admissionDate: Date.now() - 90 * 24 * 60 * 60 * 1000,
    levelOfCare: "assisted_living",
  };
}

function chartRow(
  residentId: number,
  worst: "ok" | "stale" | "missing",
  missingCount = 0,
): ChartCompletenessPayload {
  const items = Array.from({ length: 7 }).map((_, i) => ({
    key: ("lic_601" as const),
    status: i < missingCount && worst === "missing" ? ("missing" as const) : ("ok" as const),
    asOf: Date.now(),
  }));
  return {
    residentId,
    items,
    completedCount: items.filter((i) => i.status === "ok").length,
    totalCount: items.length,
    missing: items.filter((i) => i.status === "missing").map((i) => i.key),
    stale: [],
    worst,
  } as ChartCompletenessPayload;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ResidentsContent — chart-completeness chips", () => {
  it("renders a chip per resident with the correct missing count", async () => {
    const qc = freshClient();

    // URL-routing mock: residents list + chart-completeness aggregate.
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/chart-completeness")) {
        return Promise.resolve(
          jsonResponse({
            success: true,
            data: {
              rows: [
                chartRow(1, "ok"),
                chartRow(2, "missing", 3),
                chartRow(3, "stale"),
              ],
              total: 1,
              complete: 1,
            },
          }),
        );
      }
      if (url.includes("/residents")) {
        return Promise.resolve(
          jsonResponse({
            success: true,
            data: [
              residentRow(1, "Alice", "Anderson"),
              residentRow(2, "Bob", "Brown"),
              residentRow(3, "Carla", "Cruz"),
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse({ success: true, data: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ResidentsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    // The list renders both the desktop table AND mobile cards, so every
    // chip appears twice. getAllBy* + check the first.
    await waitFor(() => {
      expect(screen.getAllByTestId("chart-chip-1").length).toBeGreaterThan(0);
    });
    const okChips = screen.getAllByTestId("chart-chip-1");
    expect(okChips[0]).toHaveAttribute("data-worst", "ok");
    expect(okChips[0].textContent).toContain("Chart ok");

    // Chip for the resident with status "missing" and the count.
    const missingChips = screen.getAllByTestId("chart-chip-2");
    expect(missingChips[0]).toHaveAttribute("data-worst", "missing");
    expect(missingChips[0].textContent).toMatch(/Chart incomplete · 3 missing/);

    // Chip for the resident with status "stale".
    const staleChips = screen.getAllByTestId("chart-chip-3");
    expect(staleChips[0]).toHaveAttribute("data-worst", "stale");
    expect(staleChips[0].textContent).toMatch(/Chart stale/);
  });
});

describe("AuditReadinessContent — Charts incomplete tile", () => {
  it("renders the tile with the count from the W8 list endpoint", async () => {
    const qc = freshClient();

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/chart-completeness")) {
        // Tile only consumes data.total — irrelevant to rows here.
        return Promise.resolve(
          jsonResponse({ success: true, data: { rows: [], total: 4, complete: 0 } }),
        );
      }
      // All the other Overview tile endpoints — empty payloads keep them at 0.
      return Promise.resolve(jsonResponse({ success: true, data: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AuditReadinessContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    const tile = await screen.findByTestId(
      "audit-overview-charts-incomplete-tile",
    );
    await waitFor(() => {
      expect(tile.textContent).toContain("Charts incomplete");
      // The Tile renders value + label as siblings; textContent concatenates
      // them with no separator (e.g. "4Charts incomplete"). Just assert the
      // count appears somewhere in the tile.
      expect(tile.textContent).toContain("4");
    });
  });
});
