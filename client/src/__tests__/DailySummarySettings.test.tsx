/**
 * <DailySummarySection> (inside RegSettingsContent) — Wave 3 W14 tests.
 *
 * Covers:
 *   - All 9 W14 fields render with the expected defaults.
 *   - Toggling DAILY_SUMMARY_ENABLED PUTs to
 *     /api/ops/reg-settings/DAILY_SUMMARY_ENABLED with value=true.
 *   - "Send test email now" POSTs to
 *     /api/ops/facilities/:fn/daily-summary/test-send and toasts the
 *     recipient count on 200.
 *
 * Patterns reused:
 *   - QueryClient + wrapper helpers:           RegSettingsContent.test.tsx:49-62
 *   - apiRequest mock contract:                RegSettingsContent.test.tsx:25-39
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
  return {
    ...actual,
    apiRequest: vi.fn(),
  };
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

/**
 * BE may or may not have seeded the W14 keys yet. Empty payload exercises
 * the client-side defaults; that's the most common pre-rollout state and
 * is more useful as a smoke test.
 */
function emptySettingsPayload(): {
  success: true;
  data: RegSettingRow[];
} {
  return { success: true, data: [] };
}

beforeEach(() => {
  mockApi.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DailySummarySection — Wave 3 W14", () => {
  it("renders all 9 W14 fields with default values", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(emptySettingsPayload())),
    );

    render(<RegSettingsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    // Section header
    expect(
      await screen.findByTestId("daily-summary-section"),
    ).toBeInTheDocument();

    // Each W14 key has its own row.
    expect(
      screen.getByTestId("daily-summary-row-DAILY_SUMMARY_ENABLED"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("daily-summary-row-DAILY_SUMMARY_HOUR_UTC"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("daily-summary-row-DAILY_SUMMARY_RECIPIENTS"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "daily-summary-row-DAILY_SUMMARY_INCLUDE_OBLIGATIONS",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "daily-summary-row-DAILY_SUMMARY_INCLUDE_INCIDENTS",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "daily-summary-row-DAILY_SUMMARY_INCLUDE_TEMPERATURE_OOR",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "daily-summary-row-DAILY_SUMMARY_INCLUDE_CREDENTIALS",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "daily-summary-row-DAILY_SUMMARY_INCLUDE_COMPLAINTS",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(
        "daily-summary-row-DAILY_SUMMARY_INCLUDE_VENDORS",
      ),
    ).toBeInTheDocument();

    // Test-send button present.
    expect(
      screen.getByTestId("daily-summary-test-send"),
    ).toBeInTheDocument();

    // Numeric default for hour-UTC field.
    const hourInput = screen.getByTestId(
      "daily-summary-input-DAILY_SUMMARY_HOUR_UTC",
    ) as HTMLInputElement;
    expect(hourInput.value).toBe("14");
  });

  it("toggling DAILY_SUMMARY_ENABLED PUTs to /reg-settings/DAILY_SUMMARY_ENABLED", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(emptySettingsPayload())),
    );

    mockApi.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          key: "DAILY_SUMMARY_ENABLED",
          value: "true",
          placeholder: false,
          validated: true,
        },
      }),
    );

    render(<RegSettingsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    const enabledSwitch = await screen.findByTestId(
      "daily-summary-switch-DAILY_SUMMARY_ENABLED",
    );
    fireEvent.click(enabledSwitch);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalled();
    });
    expect(mockApi).toHaveBeenCalledWith(
      "PUT",
      "/api/ops/reg-settings/DAILY_SUMMARY_ENABLED",
      expect.objectContaining({ value: "true", validated: true }),
    );
  });

  it("clicking 'Send test email now' POSTs and toasts on success", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(emptySettingsPayload())),
    );

    mockApi.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { sent: 2, recipients: ["a@x.com", "b@x.com"], skipped: [] },
      }),
    );

    render(<RegSettingsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    const sendBtn = await screen.findByTestId("daily-summary-test-send");
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "POST",
        "/api/ops/facilities/197600001/daily-summary/test-send",
        {},
      );
    });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: expect.stringMatching(/Sent to 2 recipients\./),
        }),
      );
    });
  });

  it("test-send failure surfaces a destructive toast with the server message", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(emptySettingsPayload())),
    );

    mockApi.mockRejectedValue(new Error("Resend timed out"));

    render(<RegSettingsContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    const sendBtn = await screen.findByTestId("daily-summary-test-send");
    fireEvent.click(sendBtn);

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't send test email",
          variant: "destructive",
        }),
      );
    });
  });
});
