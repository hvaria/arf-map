/**
 * <ReportsContent> smoke tests — Wave 5 Reports Hub.
 *
 * Covers:
 *   - Empty state with the "Generate your first report" CTA.
 *   - List render with status chips.
 *   - Filter by kind narrows results (re-issues GET with reportKind=).
 *   - Download button disabled when status='generating'.
 *   - Generate dialog opens, picks a kind, submits, toasts.
 *   - Auditor mode hides Generate / Regenerate / Delete.
 *
 * Pattern reused:
 *   - apiRequest + QueryClient setup:
 *       client/src/__tests__/VendorsContent.test.tsx:10-90
 *   - Auditor-mode provider wrap:
 *       client/src/context/AuditorContext.tsx
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
  ReportsContent,
  type ReportRow,
} from "../components/operations/ReportsContent";
import { AuditorProvider } from "@/context/AuditorContext";

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

function auditorWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <AuditorProvider
        value={{
          token: "test-token",
          facilityNumber: "197600001",
          expiresAt: Date.now() + 86_400_000,
          audience: "cdss",
          readOnly: true,
        }}
      >
        {children}
      </AuditorProvider>
    </QueryClientProvider>
  );
}

function report(overrides: Partial<ReportRow> = {}): ReportRow {
  return {
    id: 1,
    facilityNumber: "197600001",
    reportKind: "incident_summary",
    title: "Incident summary · Last 30 days",
    description: null,
    parametersJson: null,
    storageUri: null,
    mimeType: "application/pdf",
    filename: "incident_summary_20260515_1.pdf",
    byteSize: 102_400,
    sha256: null,
    status: "ready",
    failureReason: null,
    sourceEntityType: null,
    sourceEntityId: null,
    retentionDays: 1095,
    generatedBy: "admin@example.com",
    generatedAt: Date.now() - 60_000,
    downloadCount: 0,
    lastDownloadedAt: null,
    notes: null,
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

describe("ReportsContent — empty", () => {
  it("renders the empty state with the 'Generate your first report' CTA", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] })),
    );

    render(<ReportsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    expect(await screen.findByTestId("reports-empty")).toBeInTheDocument();
    expect(
      screen.getByText(/Generate your first report to start your library/i),
    ).toBeInTheDocument();
    expect(screen.getByTestId("reports-empty-cta")).toBeInTheDocument();
  });
});

describe("ReportsContent — list", () => {
  it("renders rows with the status chip", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          data: [report(), report({ id: 2, status: "generating" })],
        }),
      ),
    );

    render(<ReportsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    expect(await screen.findByTestId("reports-list")).toBeInTheDocument();
    expect(screen.getByTestId("report-status-1")).toHaveTextContent(/Ready/i);
    expect(screen.getByTestId("report-status-2")).toHaveTextContent(
      /Generating/i,
    );
  });

  it("download button is disabled when status='generating'", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          data: [report({ id: 7, status: "generating" })],
        }),
      ),
    );

    render(<ReportsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    const btn = await screen.findByTestId("report-download-7");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("aria-disabled", "true");
  });

  it("filter by kind re-issues a GET with reportKind=", async () => {
    const qc = freshClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: [report()] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<ReportsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    await screen.findByTestId("reports-list");
    // Open the kind filter and select a specific kind.
    fireEvent.click(screen.getByTestId("reports-filter-kind"));
    // Use the option list — radix renders into a portal; querying by role.
    const option = await screen.findByRole("option", {
      name: /Incident summary/i,
    });
    fireEvent.click(option);

    await waitFor(() => {
      const called = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("reportKind=incident_summary"),
      );
      expect(called).toBeTruthy();
    });
  });
});

describe("ReportsContent — generate dialog", () => {
  it("opens the dialog and POSTs /reports/generate on submit", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] })),
    );
    mockApi.mockResolvedValue(
      jsonResponse({
        success: true,
        data: report({ id: 99, status: "ready" }),
      }),
    );

    render(<ReportsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    await screen.findByTestId("reports-empty");
    fireEvent.click(screen.getByTestId("reports-empty-cta"));

    expect(
      await screen.findByTestId("generate-report-dialog"),
    ).toBeInTheDocument();

    // Pick a kind.
    fireEvent.click(screen.getByTestId("generate-report-kind"));
    const opt = await screen.findByRole("option", {
      name: /Incident summary/i,
    });
    fireEvent.click(opt);

    fireEvent.click(screen.getByTestId("generate-report-submit"));

    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
    const [method, url, body] = mockApi.mock.calls[0];
    expect(method).toBe("POST");
    expect(url).toBe("/api/ops/facilities/197600001/reports/generate");
    expect(body).toMatchObject({ reportKind: "incident_summary" });

    // Toast fires for the ready response.
    await waitFor(() => expect(toastMock).toHaveBeenCalled());
  });
});

describe("ReportsContent — auditor mode", () => {
  it("hides Generate / Regenerate / Delete in auditor mode", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(jsonResponse({ success: true, data: [report()] })),
    );

    render(<ReportsContent facilityNumber="197600001" />, {
      wrapper: auditorWrapper(qc),
    });

    await screen.findByTestId("reports-list");
    expect(screen.queryByTestId("generate-report-button")).toBeNull();
    expect(screen.queryByTestId("report-regenerate-1")).toBeNull();
    expect(screen.queryByTestId("report-delete-1")).toBeNull();
    // Auditor still sees the Download button.
    expect(screen.getByTestId("report-download-1")).toBeInTheDocument();
  });
});
