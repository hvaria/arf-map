/**
 * <VendorsContent> smoke tests — Wave 1 B7.
 *
 * Covers:
 *   - Empty state with "pharmacy and food vendor" copy.
 *   - List render with status badge.
 *   - Filter pill switches query URL and refetches.
 *   - AddVendor dialog issues POST.
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
  VendorsContent,
  type Vendor,
} from "../components/operations/VendorsContent";

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

function vendor(overrides: Partial<Vendor> = {}): Vendor {
  return {
    id: 1,
    facilityNumber: "197600001",
    vendorName: "ABC Pharmacy",
    vendorType: "pharmacy",
    contactName: null,
    contactPhone: null,
    contactEmail: null,
    coiExpiresAt: Date.now() + 90 * 24 * 60 * 60 * 1000,
    licenseExpiresAt: null,
    notes: null,
    status: "active",
    createdAt: Date.now(),
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

describe("VendorsContent — empty", () => {
  it("renders the empty state with the pharmacy/food copy", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] })),
    );

    render(<VendorsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    expect(await screen.findByTestId("vendor-empty")).toBeInTheDocument();
    expect(
      screen.getByText(/Start with your pharmacy and food vendor/i),
    ).toBeInTheDocument();
  });
});

describe("VendorsContent — list + filter", () => {
  it("renders the vendor list with the status badge", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [vendor()] })),
    );

    render(<VendorsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    expect(await screen.findByTestId("vendor-list")).toBeInTheDocument();
    expect(screen.getByText("ABC Pharmacy")).toBeInTheDocument();
    expect(screen.getAllByText(/Active/i).length).toBeGreaterThan(0);
  });

  it("clicking the 60-day filter re-issues a GET with expiringWithinDays=60", async () => {
    const qc = freshClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: [vendor()] }));
    vi.stubGlobal("fetch", fetchMock);

    render(<VendorsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    await screen.findByTestId("vendor-list");
    fireEvent.click(screen.getByText(/Expiring within 60 days/i));

    await waitFor(() => {
      const url = fetchMock.mock.calls.find((c) =>
        String(c[0]).includes("expiringWithinDays=60"),
      );
      expect(url).toBeTruthy();
    });
  });
});

describe("VendorsContent — add vendor", () => {
  it("opens the dialog and issues POST /api/ops/vendors on save", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse({ success: true, data: [] })),
    );
    mockApi.mockResolvedValue(jsonResponse({ success: true, data: vendor() }));

    render(<VendorsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    fireEvent.click(await screen.findByTestId("vendor-add-trigger"));
    const name = await screen.findByTestId("vendor-name");
    fireEvent.change(name, { target: { value: "Linen Co" } });
    fireEvent.click(screen.getByTestId("vendor-save"));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "POST",
        "/api/ops/vendors",
        expect.objectContaining({
          vendorName: "Linen Co",
          vendorType: "pharmacy", // default in the dropdown
        }),
      );
    });
  });
});
