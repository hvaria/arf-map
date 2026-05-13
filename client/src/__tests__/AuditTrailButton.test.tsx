/**
 * <AuditTrailButton> smoke tests — Wave 0 A13.
 *
 * Covers per Phase 4 §10 acceptance:
 *   - Renders an icon button with the documented aria-label.
 *   - Click opens the Sheet (slide-in panel).
 *   - Loading state shows skeleton rows.
 *   - Empty list renders the "No history yet." copy.
 *   - Populated list renders rows; expanding a row reveals before/after JSON.
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

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { AuditTrailButton } from "../components/operations/AuditTrailButton";
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

describe("AuditTrailButton — trigger", () => {
  it("renders an icon button with the documented aria-label", () => {
    const qc = freshClient();
    render(
      <AuditTrailButton
        entityType="ops_vendor"
        entityId={12}
        facilityNumber="197600001"
      />,
      { wrapper: wrapper(qc) },
    );
    const btn = screen.getByTestId("audit-trail-button");
    expect(btn).toHaveAttribute("aria-label", "View history for this item");
  });
});

describe("AuditTrailButton — opens Sheet and shows states", () => {
  it("opening the Sheet renders 3 skeleton rows while loading", async () => {
    const qc = freshClient();
    // Never-resolving fetch keeps the query in flight.
    const fetchMock = vi.fn().mockImplementation(() => new Promise(() => {}));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuditTrailButton
        entityType="ops_vendor"
        entityId={12}
        facilityNumber="197600001"
      />,
      { wrapper: wrapper(qc) },
    );
    fireEvent.click(screen.getByTestId("audit-trail-button"));
    expect(await screen.findByTestId("audit-trail-loading")).toBeInTheDocument();
  });

  it("renders the empty state when the API returns no events", async () => {
    const qc = freshClient();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, data: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuditTrailButton
        entityType="ops_vendor"
        entityId={12}
        facilityNumber="197600001"
      />,
      { wrapper: wrapper(qc) },
    );
    fireEvent.click(screen.getByTestId("audit-trail-button"));

    await waitFor(() =>
      expect(screen.getByTestId("audit-trail-empty")).toBeInTheDocument(),
    );
    expect(screen.getByText(/no history yet/i)).toBeInTheDocument();
  });

  it("renders event rows and expanding one reveals before/after JSON", async () => {
    const qc = freshClient();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        success: true,
        data: [event({ id: 7 })],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AuditTrailButton
        entityType="ops_vendor"
        entityId={12}
        facilityNumber="197600001"
      />,
      { wrapper: wrapper(qc) },
    );
    fireEvent.click(screen.getByTestId("audit-trail-button"));

    const row = await screen.findByTestId("audit-event-row");
    // Collapsed by default — details should not be present.
    expect(
      screen.queryByTestId("audit-event-details"),
    ).not.toBeInTheDocument();

    // Click the row's toggle button.
    const toggle = row.querySelector("button");
    expect(toggle).toBeTruthy();
    fireEvent.click(toggle as HTMLButtonElement);

    await waitFor(() =>
      expect(screen.getByTestId("audit-event-details")).toBeInTheDocument(),
    );

    // The pre blocks should contain something parsed from the JSON.
    expect(screen.getByText(/Acme Pharmacy/)).toBeInTheDocument();
  });
});
