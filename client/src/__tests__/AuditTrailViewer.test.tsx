/**
 * <AuditTrailViewer> smoke tests — Wave 2 W15.
 *
 * Covers:
 *   - Filter bar renders (entity / action / actor / since / until + Apply).
 *   - Applying a filter dispatches a new request with the right params.
 *   - Expanding a result row reveals before/after JSON.
 *
 * Pattern reused:
 *   - QueryClient + wrapper helpers:
 *       client/src/__tests__/AuditTrailButton.test.tsx:37-66
 *   - vi.stubGlobal("fetch", …) URL-capture mock:
 *       client/src/__tests__/AuditTrailButton.test.tsx:108-129
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { AuditTrailViewer } from "../components/operations/AuditTrailViewer";
import type { AuditEventRow } from "../components/operations/AuditTrailButton";

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

function event(overrides: Partial<AuditEventRow> = {}): AuditEventRow {
  return {
    id: 1,
    facilityNumber: "197600001",
    actorId: "admin@example.com",
    actorRole: "admin",
    action: "update",
    entityType: "ops_vendor",
    entityId: 12,
    beforeJson: JSON.stringify({ name: "Acme" }),
    afterJson: JSON.stringify({ name: "Acme Pharmacy" }),
    occurredAt: Date.now() - 5 * 60_000,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AuditTrailViewer — filter bar + results", () => {
  it("renders the filter bar fields and Apply/Clear actions", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          data: [],
          meta: { total: 0, page: 1, limit: 50 },
        }),
      ),
    );

    render(<AuditTrailViewer facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    expect(screen.getByTestId("audit-trail-viewer")).toBeInTheDocument();
    expect(screen.getByTestId("audit-filter-entity")).toBeInTheDocument();
    expect(screen.getByTestId("audit-filter-action")).toBeInTheDocument();
    expect(screen.getByTestId("audit-filter-actor")).toBeInTheDocument();
    expect(screen.getByTestId("audit-filter-since")).toBeInTheDocument();
    expect(screen.getByTestId("audit-filter-until")).toBeInTheDocument();
    expect(screen.getByTestId("audit-filter-apply")).toBeInTheDocument();
    expect(screen.getByTestId("audit-filter-clear")).toBeInTheDocument();

    // Empty results state when no events
    await waitFor(() => {
      expect(screen.getByTestId("audit-viewer-empty")).toBeInTheDocument();
    });
  });

  it("submitting a filter triggers a new request with the right params", async () => {
    const qc = freshClient();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: [],
        meta: { total: 0, page: 1, limit: 50 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AuditTrailViewer facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    // Wait for initial fetch
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const initialCalls = fetchMock.mock.calls.length;

    // Type into actor input
    const actorInput = screen.getByTestId(
      "audit-filter-actor",
    ) as HTMLInputElement;
    fireEvent.change(actorInput, { target: { value: "admin@example.com" } });

    // Click Apply
    fireEvent.click(screen.getByTestId("audit-filter-apply"));

    // A new fetch should fire with `actor=admin%40example.com`
    await waitFor(() => {
      expect(fetchMock.mock.calls.length).toBeGreaterThan(initialCalls);
    });

    const lastCallUrl = String(
      fetchMock.mock.calls[fetchMock.mock.calls.length - 1][0],
    );
    expect(lastCallUrl).toContain("actor=admin");
    expect(lastCallUrl).toContain("page=1");
    expect(lastCallUrl).toContain("limit=50");
  });

  it("expanding a row reveals before/after JSON", async () => {
    const qc = freshClient();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: [event({ id: 7 })],
        meta: { total: 1, page: 1, limit: 50 },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AuditTrailViewer facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    const row = await screen.findByTestId("audit-viewer-row");
    expect(
      screen.queryByTestId("audit-viewer-row-details"),
    ).not.toBeInTheDocument();

    // Expand toggle is the chevron button in the first cell.
    const toggle = row.querySelector("button");
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() => {
      expect(
        screen.getByTestId("audit-viewer-row-details"),
      ).toBeInTheDocument();
    });
    expect(screen.getByText(/Acme Pharmacy/)).toBeInTheDocument();
  });
});
