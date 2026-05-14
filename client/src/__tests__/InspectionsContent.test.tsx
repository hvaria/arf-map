/**
 * <InspectionsContent> smoke tests — Wave 1 B11.
 *
 * Covers:
 *   - Empty state with closed-loop copy.
 *   - History list renders with status badge.
 *   - Open citations tile counts from openCitationCount.
 *   - LogInspection dialog issues POST.
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
  InspectionsContent,
  type InspectionRow,
} from "../components/operations/InspectionsContent";

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

function inspection(overrides: Partial<InspectionRow> = {}): InspectionRow {
  return {
    id: 1,
    facilityNumber: "197600001",
    inspectorOrg: "CDSS CCLD",
    purpose: "annual",
    visitAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    inspectorName: "A. Garcia",
    findings: [],
    status: "closed",
    createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    citationCount: 0,
    openCitationCount: 0,
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

describe("InspectionsContent — empty", () => {
  it("renders the empty state with the closed-loop copy", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] })),
    );

    render(<InspectionsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    expect(await screen.findByTestId("inspection-empty")).toBeInTheDocument();
    expect(
      screen.getByText(/build a closed-loop history/i),
    ).toBeInTheDocument();
  });
});

describe("InspectionsContent — list + open citations tile", () => {
  it("renders the history list with status badge", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ success: true, data: [inspection()] })),
    );

    render(<InspectionsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    expect(await screen.findByTestId("inspection-list")).toBeInTheDocument();
    expect(screen.getByText(/CDSS CCLD/)).toBeInTheDocument();
    expect(screen.getAllByText(/Closed/i).length).toBeGreaterThan(0);
  });

  it("aggregates openCitationCount across inspections in the tile", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          data: [
            inspection({ id: 1, openCitationCount: 2 }),
            inspection({ id: 2, openCitationCount: 1 }),
          ],
        }),
      ),
    );

    render(<InspectionsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    await screen.findByTestId("inspection-list");
    // The tile reads "Open citations" and the value is 3 (2 + 1).
    const tile = screen.getByText(/Open citations/i).parentElement;
    expect(tile?.textContent).toMatch(/3/);
  });
});

describe("InspectionsContent — log dialog", () => {
  it("opens dialog and POSTs the new inspection", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] })),
    );
    mockApi.mockResolvedValue(
      jsonResponse({ success: true, data: inspection({ id: 9 }) }),
    );

    render(<InspectionsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    fireEvent.click(await screen.findByTestId("inspection-add-trigger"));
    fireEvent.click(await screen.findByTestId("inspection-save"));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "POST",
        "/api/ops/inspections",
        expect.objectContaining({
          inspectorOrg: "CDSS CCLD",
          purpose: "annual",
        }),
      );
    });
  });
});
