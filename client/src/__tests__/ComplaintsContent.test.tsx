/**
 * <ComplaintsContent> smoke tests — Wave 1 B9.
 *
 * Covers:
 *   - Empty state with "Log walk-up concerns here too." copy.
 *   - Anonymous complaints render em-dash placeholders (A.3).
 *   - Open & investigating list renders status badge.
 *   - LogComplaint dialog issues POST with external_ref (B.2).
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
  ComplaintsContent,
  type ComplaintRow,
} from "../components/operations/ComplaintsContent";

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

function complaint(overrides: Partial<ComplaintRow> = {}): ComplaintRow {
  return {
    id: 142,
    facilityNumber: "197600001",
    complainantType: "family",
    complainantName: "Jane K.",
    complainantRelation: "daughter of resident B.",
    nature: "Meal quality",
    receivedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
    intakeNotes: "Caller said meals are cold.",
    externalRef: null,
    assignedTo: "Himanshu T.",
    status: "investigating",
    createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
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

describe("ComplaintsContent — empty", () => {
  it("renders the empty state with the walk-up copy", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] })),
    );

    render(<ComplaintsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    expect(await screen.findByTestId("complaint-empty")).toBeInTheDocument();
    expect(
      screen.getByText(/Log walk-up concerns here too/i),
    ).toBeInTheDocument();
  });
});

describe("ComplaintsContent — list", () => {
  it("renders the open + investigating list with the status badge", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ success: true, data: [complaint()] })),
    );

    render(<ComplaintsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    expect(await screen.findByTestId("complaint-list")).toBeInTheDocument();
    expect(screen.getByText(/Jane K\./)).toBeInTheDocument();
    expect(screen.getAllByText(/investigating/i).length).toBeGreaterThan(0);
  });

  it("renders em-dash for anonymous complaints (A.3)", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          data: [
            complaint({
              complainantType: "anonymous",
              complainantName: null,
              complainantRelation: null,
              status: "open",
            }),
          ],
        }),
      ),
    );

    render(<ComplaintsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    const list = await screen.findByTestId("complaint-list");
    expect(list.textContent).toMatch(/—/); // em-dash present
    expect(screen.getAllByText(/anonymous/i).length).toBeGreaterThan(0);
  });
});

describe("ComplaintsContent — log dialog", () => {
  it("opens dialog and POSTs with externalRef when set", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] })),
    );
    mockApi.mockResolvedValue(
      jsonResponse({ success: true, data: complaint({ id: 200 }) }),
    );

    render(<ComplaintsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    fireEvent.click(await screen.findByTestId("complaint-add-trigger"));
    fireEvent.change(await screen.findByTestId("complaint-nature"), {
      target: { value: "Staffing levels" },
    });
    fireEvent.change(screen.getByTestId("complaint-intake"), {
      target: { value: "Family complaint about staffing overnight." },
    });
    fireEvent.change(screen.getByTestId("complaint-external-ref"), {
      target: { value: "Ombudsman 2026-19" },
    });

    fireEvent.click(screen.getByTestId("complaint-save"));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "POST",
        "/api/ops/complaints",
        expect.objectContaining({
          nature: "Staffing levels",
          externalRef: "Ombudsman 2026-19",
        }),
      );
    });
  });
});
