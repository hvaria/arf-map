/**
 * <PreAuditPullDialog> smoke tests — Wave 3 Phase 3.2 W2.
 *
 * Covers:
 *   - The form fields render (audience / window / sections checklist /
 *     delivery radio) + Generate CTA.
 *   - Submitting issues a POST /preaudit-pull with the selected audience,
 *     section list, and delivery method.
 *   - Section "Deselect all" disables the Generate button (validation).
 *   - Choosing "share_link" reveals the duration select.
 *
 * Pattern reused:
 *   - apiRequest + QueryClient setup:
 *       client/src/__tests__/ShareWithInspectorDialog.test.tsx
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
import { PreAuditPullDialog } from "../components/operations/PreAuditPullDialog";

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

function renderDialog(qc: QueryClient) {
  return render(
    <PreAuditPullDialog
      open
      onOpenChange={() => undefined}
      facilityNumber="197600001"
    />,
    { wrapper: wrapper(qc) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default GET /preaudit-pulls → empty list.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] })),
  );
  // Stub clipboard so the share-link branch doesn't blow up.
  Object.defineProperty(navigator, "clipboard", {
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("PreAuditPullDialog", () => {
  it("renders the form (audience / window / sections / delivery)", async () => {
    renderDialog(freshClient());
    expect(screen.getByTestId("preaudit-pull-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("preaudit-pull-audience")).toBeInTheDocument();
    expect(screen.getByTestId("preaudit-pull-window")).toBeInTheDocument();
    expect(screen.getByTestId("preaudit-pull-sections")).toBeInTheDocument();
    expect(
      screen.getByTestId("preaudit-pull-delivery-download"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("preaudit-pull-delivery-share"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("preaudit-pull-submit")).toBeInTheDocument();
    // Recent pulls list is fetched on mount.
    await waitFor(() =>
      expect(
        screen.getByTestId("preaudit-pull-recent-list"),
      ).toBeInTheDocument(),
    );
  });

  it("submitting POSTs /preaudit-pull with the selected sections + delivery", async () => {
    mockApi.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          preauditPullId: 1,
          generatedAt: Date.now(),
          windowStartAt: Date.now() - 30 * 86400000,
          windowEndAt: Date.now(),
          totals: {},
          bundle: {},
          deliveryMethod: "download",
        },
      }),
    );

    renderDialog(freshClient());
    fireEvent.click(screen.getByTestId("preaudit-pull-submit"));

    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
    const [method, url, body] = mockApi.mock.calls[0];
    expect(method).toBe("POST");
    expect(url).toBe("/api/ops/facilities/197600001/preaudit-pull");
    expect(body).toMatchObject({
      audience: "cdss",
      deliveryMethod: "download",
    });
    expect(Array.isArray(body.sections)).toBe(true);
    expect(body.sections.length).toBeGreaterThan(0);
  });

  it("Deselect all + submit surfaces a validation error", async () => {
    renderDialog(freshClient());
    fireEvent.click(screen.getByTestId("preaudit-pull-deselect-all"));
    fireEvent.click(screen.getByTestId("preaudit-pull-submit"));
    // No POST should have been issued, and the error message appears.
    await waitFor(() => {
      expect(screen.getByText(/Pick at least one section/i)).toBeInTheDocument();
    });
    expect(mockApi).not.toHaveBeenCalled();
  });

  it("share_link delivery reveals the duration select", async () => {
    renderDialog(freshClient());
    fireEvent.click(screen.getByTestId("preaudit-pull-delivery-share"));
    await waitFor(() =>
      expect(
        screen.getByTestId("preaudit-pull-share-duration"),
      ).toBeInTheDocument(),
    );
  });
});
