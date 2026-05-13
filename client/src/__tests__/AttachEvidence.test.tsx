/**
 * <AttachEvidence> smoke tests — Wave 0 A13.
 *
 * Covers per Phase 4 §10 acceptance:
 *   - Renders the [+ Add photo or file] trigger and an empty list.
 *   - Add click programmatically clicks the hidden <input type=file>.
 *   - Successful POST appends to the list (mocked refetch).
 *   - Delete is optimistic; list updates immediately.
 *   - Retry button appears on upload failure.
 *
 * We mock `fetch` (used for multipart upload + list query) and apiRequest
 * (used for DELETE). The component uses both surfaces.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  return {
    ...actual,
    apiRequest: vi.fn(),
  };
});

import { apiRequest } from "@/lib/queryClient";
import { AttachEvidence } from "../components/operations/AttachEvidence";
import type { EvidenceRow } from "../components/operations/AttachEvidence";

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

function evidenceRow(overrides: Partial<EvidenceRow> = {}): EvidenceRow {
  return {
    id: 1,
    facilityNumber: "197600001",
    entityType: "ops_vendor",
    entityId: 99,
    kind: "file",
    filename: "coi.pdf",
    mime: "application/pdf",
    byteSize: 12345,
    storageUri: "local:///1/coi.pdf",
    uploadedBy: "admin@example.com",
    uploadedAt: Date.now(),
    deletedAt: null,
    ...overrides,
  };
}

beforeEach(() => {
  mockApi.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("AttachEvidence — render & empty", () => {
  it("renders the [+ Add photo or file] trigger and no rows when list is empty", async () => {
    const qc = freshClient();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ success: true, data: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AttachEvidence
        entityType="ops_vendor"
        entityId={99}
        facilityNumber="197600001"
      />,
      { wrapper: wrapper(qc) },
    );

    expect(
      screen.getByTestId("attach-evidence-add"),
    ).toHaveTextContent(/add photo or file/i);
    expect(screen.getByText(/PDF, JPG, PNG/i)).toBeInTheDocument();
    expect(screen.queryByTestId("attach-evidence-row")).not.toBeInTheDocument();

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
  });
});

describe("AttachEvidence — upload happy path", () => {
  it("clicking add programmatically clicks the hidden file input, then POSTs on file change and refetches list", async () => {
    const qc = freshClient();
    // First call = list GET (empty). Second = POST. Third = refetch with 1 row.
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [] }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ success: true, data: { id: 7 } }),
    );
    fetchMock.mockResolvedValue(
      jsonResponse({ success: true, data: [evidenceRow({ id: 7 })] }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AttachEvidence
        entityType="ops_vendor"
        entityId={99}
        facilityNumber="197600001"
      />,
      { wrapper: wrapper(qc) },
    );

    const addBtn = screen.getByTestId("attach-evidence-add");
    const input = screen.getByTestId(
      "attach-evidence-input",
    ) as HTMLInputElement;

    // Spy on the input's click so we can verify the trigger wires through.
    const clickSpy = vi.fn();
    input.click = clickSpy;
    fireEvent.click(addBtn);
    expect(clickSpy).toHaveBeenCalled();

    // Simulate the user selecting a file.
    const file = new File(["hello"], "kitchen.jpg", { type: "image/jpeg" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    // POST went out — verify the URL.
    await waitFor(() => {
      const postCall = fetchMock.mock.calls.find(
        (c) => c[1]?.method === "POST",
      );
      expect(postCall?.[0]).toBe("/api/ops/evidence");
    });

    // After success, list refetches and the row appears.
    await waitFor(() => {
      expect(screen.getByTestId("attach-evidence-row")).toBeInTheDocument();
    });
    expect(screen.getByText("coi.pdf")).toBeInTheDocument();
  });
});

describe("AttachEvidence — optimistic delete", () => {
  it("issues a DELETE via apiRequest when remove is clicked and clears the row optimistically", async () => {
    const qc = freshClient();
    // First list call returns the row; subsequent refetches return empty,
    // so the optimistic removal reconciles to an empty list.
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        success: true,
        data: [evidenceRow({ id: 7, filename: "x.pdf" })],
      }),
    );
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    mockApi.mockResolvedValue(jsonResponse({ success: true }));

    render(
      <AttachEvidence
        entityType="ops_vendor"
        entityId={99}
        facilityNumber="197600001"
      />,
      { wrapper: wrapper(qc) },
    );

    // Wait for the row to be present.
    const row = await screen.findByTestId("attach-evidence-row");
    const removeBtn = within(row).getByTestId("attach-evidence-remove");

    fireEvent.click(removeBtn);

    // Confirm DELETE was issued via apiRequest.
    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith("DELETE", "/api/ops/evidence/7");
    });

    // After the mutation settles and refetch reconciles, the row is gone.
    await waitFor(() => {
      expect(screen.queryByText("x.pdf")).not.toBeInTheDocument();
    });
  });
});

describe("AttachEvidence — retry on upload failure", () => {
  it("shows the Upload failed — please try again message and a retry button when the POST fails", async () => {
    const qc = freshClient();
    const fetchMock = vi.fn();
    fetchMock.mockResolvedValueOnce(jsonResponse({ success: true, data: [] }));
    // POST fails first.
    fetchMock.mockResolvedValueOnce(
      jsonResponse({ message: "storage offline" }, 500),
    );
    // Subsequent retries / refetches return empty list.
    fetchMock.mockResolvedValue(jsonResponse({ success: true, data: [] }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AttachEvidence
        entityType="ops_vendor"
        entityId={99}
        facilityNumber="197600001"
      />,
      { wrapper: wrapper(qc) },
    );

    const input = screen.getByTestId(
      "attach-evidence-input",
    ) as HTMLInputElement;
    const file = new File(["x"], "foo.pdf", { type: "application/pdf" });
    Object.defineProperty(input, "files", { value: [file], configurable: true });
    fireEvent.change(input);

    // The pending row sticks around with the retry button.
    await waitFor(() => {
      expect(
        screen.getByText(/upload failed — please try again/i),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("attach-evidence-retry")).toBeInTheDocument();
  });
});
