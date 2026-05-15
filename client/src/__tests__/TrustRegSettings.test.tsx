/**
 * <RegSettingsContent> — Resident trust section smoke tests (Wave 4 W12).
 *
 * Covers:
 *   - Toggling RESIDENT_TRUST_ENABLED issues PUT /api/ops/reg-settings/...
 *   - Max held balance input accepts "$1,000", "1000.00", "1000" — all
 *     parsed via the shared dollarsToCents() into the same integer cents.
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
import { RegSettingsContent } from "../components/operations/RegSettingsContent";
import type { RegSettingRow } from "../components/operations/RegSettingsContent";

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

function trustEnabledPayload(): { success: true; data: RegSettingRow[] } {
  return {
    success: true,
    data: [
      {
        key: "RESIDENT_TRUST_ENABLED",
        value: "true",
        placeholder: false,
        validated: true,
      },
      {
        key: "RESIDENT_TRUST_DUAL_SIG_REQUIRED",
        value: "true",
        placeholder: true,
        validated: false,
      },
      {
        key: "RESIDENT_TRUST_MAX_HELD_BALANCE_CENTS",
        value: "100000",
        placeholder: true,
        validated: false,
      },
      {
        key: "RESIDENT_TRUST_STATEMENT_AUTO_GENERATE",
        value: "false",
        placeholder: false,
        validated: true,
      },
    ],
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

describe("RegSettingsContent — Resident trust section", () => {
  it("toggling the enabled switch PUTs RESIDENT_TRUST_ENABLED", async () => {
    const qc = freshClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(trustEnabledPayload()));
    vi.stubGlobal("fetch", fetchMock);
    mockApi.mockResolvedValue(jsonResponse({ success: true }));

    render(<RegSettingsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    const toggle = await screen.findByTestId("trust-settings-switch-enabled");
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "PUT",
        "/api/ops/reg-settings/RESIDENT_TRUST_ENABLED",
        expect.objectContaining({ value: "false", validated: true }),
      );
    });
  });

  it("max-held-balance input accepts '1000' and saves as integer cents", async () => {
    const qc = freshClient();
    // Seed with a different starting value so dirty flips when we type 1000.
    const payload = {
      success: true as const,
      data: trustEnabledPayload().data.map((r) =>
        r.key === "RESIDENT_TRUST_MAX_HELD_BALANCE_CENTS"
          ? { ...r, value: "50000" }
          : r,
      ),
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal("fetch", fetchMock);
    mockApi.mockResolvedValue(jsonResponse({ success: true }));

    render(<RegSettingsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    const input = (await screen.findByTestId(
      "trust-settings-maxbalance-input",
    )) as HTMLInputElement;

    // "1000" → 100000 cents
    fireEvent.change(input, { target: { value: "1000" } });
    fireEvent.click(
      await screen.findByTestId("trust-settings-maxbalance-save"),
    );

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "PUT",
        "/api/ops/reg-settings/RESIDENT_TRUST_MAX_HELD_BALANCE_CENTS",
        expect.objectContaining({ value: "100000", validated: true }),
      );
    });
  });

  it("max-held-balance input accepts '$1,000' (commas + $) and saves as cents", async () => {
    const qc = freshClient();
    const payload = {
      success: true as const,
      data: trustEnabledPayload().data.map((r) =>
        r.key === "RESIDENT_TRUST_MAX_HELD_BALANCE_CENTS"
          ? { ...r, value: "50000" }
          : r,
      ),
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal("fetch", fetchMock);
    mockApi.mockResolvedValue(jsonResponse({ success: true }));

    render(<RegSettingsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    const input = (await screen.findByTestId(
      "trust-settings-maxbalance-input",
    )) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "$1,000" } });
    fireEvent.click(
      await screen.findByTestId("trust-settings-maxbalance-save"),
    );

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "PUT",
        "/api/ops/reg-settings/RESIDENT_TRUST_MAX_HELD_BALANCE_CENTS",
        expect.objectContaining({ value: "100000", validated: true }),
      );
    });
  });

  it("max-held-balance input accepts '1000.00' decimal form and saves as cents", async () => {
    const qc = freshClient();
    // Seed the row with a different cents value so a value of "1000.00"
    // is a real change (triggers `dirty=true`, which reveals Save).
    const payload = {
      success: true as const,
      data: trustEnabledPayload().data.map((r) =>
        r.key === "RESIDENT_TRUST_MAX_HELD_BALANCE_CENTS"
          ? { ...r, value: "50000" }
          : r,
      ),
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(payload));
    vi.stubGlobal("fetch", fetchMock);
    mockApi.mockResolvedValue(jsonResponse({ success: true }));

    render(<RegSettingsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    const input = (await screen.findByTestId(
      "trust-settings-maxbalance-input",
    )) as HTMLInputElement;

    fireEvent.change(input, { target: { value: "1000.00" } });
    fireEvent.click(
      await screen.findByTestId("trust-settings-maxbalance-save"),
    );

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "PUT",
        "/api/ops/reg-settings/RESIDENT_TRUST_MAX_HELD_BALANCE_CENTS",
        expect.objectContaining({ value: "100000", validated: true }),
      );
    });
  });
});
