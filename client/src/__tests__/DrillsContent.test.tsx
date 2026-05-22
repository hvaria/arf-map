/**
 * <DrillsContent> smoke tests — Wave 1 B5.
 *
 * Covers:
 *   - Empty state with "Log your first drill" CTA.
 *   - List render with execution badge.
 *   - Dialog opens, mm:ss parsed to seconds in POST.
 *   - mm:ss validation surfaces inline error.
 *   - Wave 4 W6 — drill cadence panel renders in place of the old footnote.
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

import { apiRequest } from "@/lib/queryClient";
import {
  DrillsContent,
  type DrillLog,
} from "../components/operations/DrillsContent";

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

function drill(overrides: Partial<DrillLog> = {}): DrillLog {
  return {
    id: 1,
    facilityNumber: "197600001",
    drillKind: "fire",
    shift: "AM",
    scenario: "Kitchen fire",
    executedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    leader: "Maria S.",
    evacuationSeconds: 118,
    debriefNotes: null,
    status: "executed",
    createdBy: "test",
    createdAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    updatedAt: Date.now() - 5 * 24 * 60 * 60 * 1000,
    // Phase 2 R2: server's decodeDrillLog decodes the JSONB columns into
    // these arrays and strips the raw *Json keys from the wire.
    participants: ["Anil P.", "Tom L."],
    residentsInvolved: [],
    correctiveActions: [],
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

describe("DrillsContent — empty + cadence panel", () => {
  it("renders the empty state and the Wave 4 cadence panel below it", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/drills/cadence")) {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: {
                facilityNumber: "197600001",
                quarterStartAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
                quarterEndAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
                fire: [
                  { shift: "AM", required: 1, logged: 0, deficit: 1, status: "behind" },
                  { shift: "PM", required: 1, logged: 0, deficit: 1, status: "behind" },
                  { shift: "NOC", required: 1, logged: 0, deficit: 1, status: "behind" },
                ],
                totalRequired: 3,
                totalLogged: 0,
                totalDeficit: 3,
                worst: "behind",
              },
            }),
          );
        }
        return Promise.resolve(jsonResponse({ success: true, data: [] }));
      }),
    );

    render(<DrillsContent facilityNumber="197600001" />, { wrapper: wrapper(qc) });

    expect(await screen.findByTestId("drill-empty")).toBeInTheDocument();
    expect(await screen.findByTestId("drill-cadence-panel")).toBeInTheDocument();
    expect(
      screen.queryByText(/Quarter cadence enforcement arrives in a later release/i),
    ).not.toBeInTheDocument();
  });
});

describe("DrillsContent — list", () => {
  it("renders drills with leader, evac time, and Executed badge", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [drill()] })),
    );

    render(<DrillsContent facilityNumber="197600001" />, { wrapper: wrapper(qc) });

    expect(await screen.findByTestId("drill-list")).toBeInTheDocument();
    expect(screen.getByText(/fire drill/i)).toBeInTheDocument();
    expect(screen.getAllByText(/Evac 1:58/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Executed/i).length).toBeGreaterThan(0);
  });
});

describe("DrillsContent — form submit", () => {
  it("opens dialog, parses mm:ss to integer seconds, and POSTs the drill", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] })),
    );
    mockApi.mockResolvedValue(jsonResponse({ success: true, data: drill() }));

    render(<DrillsContent facilityNumber="197600001" />, { wrapper: wrapper(qc) });

    fireEvent.click(await screen.findByTestId("drill-log-trigger"));
    const evac = await screen.findByTestId("drill-evac");
    fireEvent.change(evac, { target: { value: "2:34" } });

    fireEvent.click(screen.getByTestId("drill-save"));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "POST",
        "/api/ops/drills",
        expect.objectContaining({
          drillKind: "fire",
          evacuationSeconds: 2 * 60 + 34,
        }),
      );
    });
  });

  it("rejects an invalid mm:ss value with an inline error", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] })),
    );

    render(<DrillsContent facilityNumber="197600001" />, { wrapper: wrapper(qc) });

    fireEvent.click(await screen.findByTestId("drill-log-trigger"));
    const evac = await screen.findByTestId("drill-evac");
    fireEvent.change(evac, { target: { value: "abc" } });

    fireEvent.click(screen.getByTestId("drill-save"));

    await waitFor(() => {
      expect(screen.getByText(/mm:ss format/i)).toBeInTheDocument();
    });
    expect(mockApi).not.toHaveBeenCalled();
  });
});
