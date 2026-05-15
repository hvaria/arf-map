/**
 * <ShareWithInspectorDialog> smoke tests — Wave 3 Phase 3.2.
 *
 * Covers:
 *   - The form fields render (audience / label / duration) + Create CTA.
 *   - Submitting issues a POST /share-links with the correct payload.
 *   - After creation the success state renders the share URL + Copy button.
 *
 * Pattern reused:
 *   - QueryClient + apiRequest mock pattern:
 *       client/src/__tests__/ComplaintsContent.test.tsx:21-62
 *   - URL-capture pattern for the share URL:
 *       shared/auditor.ts buildAuditorViewerUrl
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
import { ShareWithInspectorDialog } from "../components/operations/ShareWithInspectorDialog";

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
    <ShareWithInspectorDialog
      open
      onOpenChange={() => undefined}
      facilityNumber="197600001"
    />,
    { wrapper: wrapper(qc) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default GET /share-links → empty list.
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ShareWithInspectorDialog", () => {
  it("renders the form fields and Create link CTA", async () => {
    renderDialog(freshClient());
    expect(screen.getByTestId("share-inspector-dialog")).toBeInTheDocument();
    expect(screen.getByTestId("share-inspector-audience")).toBeInTheDocument();
    expect(screen.getByTestId("share-inspector-label")).toBeInTheDocument();
    expect(screen.getByTestId("share-inspector-duration")).toBeInTheDocument();
    expect(screen.getByTestId("share-inspector-submit")).toBeInTheDocument();
    await waitFor(() =>
      expect(
        screen.getByTestId("share-inspector-active-list"),
      ).toBeInTheDocument(),
    );
  });

  it("submitting POSTs to /share-links with the picked audience + duration", async () => {
    mockApi.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          id: 1,
          token: "tok-abc",
          expiresAt: Date.now() + 7 * 24 * 3600 * 1000,
          scope: "audit_readiness",
          audience: "cdss",
        },
      }),
    );

    renderDialog(freshClient());

    fireEvent.click(screen.getByTestId("share-inspector-submit"));

    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(1));
    const [method, url, body] = mockApi.mock.calls[0];
    expect(method).toBe("POST");
    expect(url).toBe("/api/ops/facilities/197600001/share-links");
    expect(body).toMatchObject({ audience: "cdss", durationDays: 7 });
  });

  it("flips to the success state with a copyable URL after creation", async () => {
    mockApi.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: {
          id: 1,
          token: "tok-success",
          expiresAt: Date.now() + 24 * 3600 * 1000,
          scope: "audit_readiness",
          audience: "cdss",
        },
      }),
    );

    renderDialog(freshClient());

    fireEvent.click(screen.getByTestId("share-inspector-submit"));

    const urlInput = (await screen.findByTestId(
      "share-inspector-url",
    )) as HTMLInputElement;
    expect(urlInput.value).toContain("/#/auditor/tok-success");
    expect(screen.getByTestId("share-inspector-copy")).toBeInTheDocument();
  });

  it("renders an empty active-links state when the list is empty", async () => {
    renderDialog(freshClient());
    await waitFor(() =>
      expect(
        screen.getByText(/No active share links/i),
      ).toBeInTheDocument(),
    );
  });
});
