/**
 * <TemperatureLogsContent> smoke tests — Wave 1 B3.
 *
 * Covers:
 *   - Empty state when no fixtures.
 *   - Renders fixtures + latest reading + In-range badge.
 *   - Record-reading dialog opens, submits, POST issued with expected payload.
 *   - Failure path surfaces a toast (mocked).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

const toastMock = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  return { ...actual, apiRequest: vi.fn() };
});

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({ data: { id: 1, facilityNumber: "197600001", username: "maria.s" } }),
}));

import { apiRequest } from "@/lib/queryClient";
import {
  TemperatureLogsContent,
  type TempFixture,
  type TempLog,
} from "../components/operations/TemperatureLogsContent";

const mockApi = apiRequest as unknown as ReturnType<typeof vi.fn>;

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

function fixture(overrides: Partial<TempFixture> = {}): TempFixture {
  return {
    id: 1,
    facilityNumber: "197600001",
    fixtureKey: "fridge_kitchen_1",
    name: "Fridge — Kitchen 1",
    kind: "fridge",
    unit: "F",
    requiredMin: 32,
    requiredMax: 40,
    ...overrides,
  };
}

function log(overrides: Partial<TempLog> = {}): TempLog {
  return {
    id: 100,
    facilityNumber: "197600001",
    fixtureId: 1,
    fixtureKey: "fridge_kitchen_1",
    readingValue: 38,
    unit: "F",
    thresholdMin: 32,
    thresholdMax: 40,
    outOfRange: 0,
    readingAt: Date.now() - 30 * 60_000,
    recordedBy: "maria.s",
    note: null,
    followUpDueAt: null,
    resolvedAt: null,
    createdAt: Date.now() - 30 * 60_000,
    ...overrides,
  };
}

beforeEach(() => {
  mockApi.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("TemperatureLogsContent — render", () => {
  it("renders the empty state when no fixtures exist", async () => {
    const qc = freshClient();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<TemperatureLogsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    expect(await screen.findByTestId("temp-empty")).toBeInTheDocument();
    expect(
      screen.getByText(/Add the first fixture you log daily/i),
    ).toBeInTheDocument();
  });

  it("renders fixtures with the latest reading and In-range badge", async () => {
    const qc = freshClient();
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("temp-fixtures")) {
        return Promise.resolve(jsonResponse({ success: true, data: [fixture()] }));
      }
      if (url.includes("temp-logs")) {
        return Promise.resolve(jsonResponse({ success: true, data: [log()] }));
      }
      return Promise.resolve(jsonResponse({ success: true, data: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<TemperatureLogsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    // "Fridge — Kitchen 1" appears in both the latest-reading tile and the fixture row.
    const matches = await screen.findAllByText("Fridge — Kitchen 1");
    expect(matches.length).toBeGreaterThan(0);
    expect(screen.getAllByText(/In range/i).length).toBeGreaterThan(0);
  });
});

describe("TemperatureLogsContent — record dialog", () => {
  it("opens dialog, submits a reading, and issues POST /api/ops/temp-logs", async () => {
    const qc = freshClient();
    const fetchMock = vi.fn();
    fetchMock.mockImplementation((url: string) => {
      if (url.includes("temp-fixtures")) {
        return Promise.resolve(jsonResponse({ success: true, data: [fixture()] }));
      }
      if (url.includes("temp-logs")) {
        return Promise.resolve(jsonResponse({ success: true, data: [log()] }));
      }
      // evidence list (post-save)
      return Promise.resolve(jsonResponse({ success: true, data: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);
    mockApi.mockResolvedValue(
      jsonResponse({ success: true, data: log({ id: 200, outOfRange: 0 }) }),
    );

    render(<TemperatureLogsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    await screen.findAllByText("Fridge — Kitchen 1");
    fireEvent.click(screen.getByTestId("temp-record-trigger-1"));

    // The reading input is present.
    const valueInput = await screen.findByTestId("temp-record-value");
    fireEvent.change(valueInput, { target: { value: "38" } });

    fireEvent.click(screen.getByTestId("temp-record-save"));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "POST",
        "/api/ops/temp-logs",
        expect.objectContaining({
          fixtureId: 1,
          readingValue: 38,
          unit: "F",
          recordedBy: expect.any(String),
        }),
      );
    });
  });
});

describe("TemperatureLogsContent — error path", () => {
  it("renders the error banner when the fixtures query fails", async () => {
    const qc = freshClient();
    const fetchMock = vi
      .fn()
      .mockRejectedValue(new Error("boom"));
    vi.stubGlobal("fetch", fetchMock);

    render(<TemperatureLogsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    await waitFor(() => {
      expect(
        screen.getByText(/Failed to load temperature logs/i),
      ).toBeInTheDocument();
    });
  });
});
