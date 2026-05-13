/**
 * <RegSettingsContent> smoke tests — Wave 0 A13.
 *
 * Covers per Phase 4 §10 acceptance:
 *   - Sections render with the documented headings.
 *   - [V] chip is visible for placeholder rows.
 *   - Entering a source note + clicking Save issues a PUT, and on success the
 *     [V] chip flips off (replaced with the Validated emerald chip).
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

function settingsPayload(): { success: true; data: RegSettingRow[] } {
  return {
    success: true,
    data: [
      {
        key: "HOT_WATER_MAX_F",
        value: "110",
        placeholder: true,
        validated: false,
      },
      {
        key: "FRIDGE_MIN_F",
        value: "32",
        placeholder: true,
        validated: false,
      },
      {
        key: "INCIDENT_VERBAL_SERIOUS_HOURS",
        value: "2",
        placeholder: true,
        validated: false,
      },
    ],
  };
}

beforeEach(() => {
  mockApi.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("RegSettingsContent — sections + [V] chip", () => {
  it("renders Environment and Incident SLAs section headings with rows", async () => {
    const qc = freshClient();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(settingsPayload()),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(
      <RegSettingsContent facilityNumber="197600001" />,
      { wrapper: wrapper(qc) },
    );

    expect(
      await screen.findByText("Environment"),
    ).toBeInTheDocument();
    expect(screen.getByText("Incident SLAs")).toBeInTheDocument();

    // [V] chips for placeholder rows.
    const chips = screen.getAllByTestId("reg-setting-v-chip");
    expect(chips.length).toBeGreaterThanOrEqual(3);
  });

  it("typing a source note and clicking Save issues PUT and flips the [V] chip off", async () => {
    const qc = freshClient();
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(settingsPayload()),
    );
    vi.stubGlobal("fetch", fetchMock);

    mockApi.mockResolvedValue(
      jsonResponse({
        success: true,
        data: {
          key: "HOT_WATER_MAX_F",
          value: "110",
          placeholder: true,
          validated: true,
          sourceNote: "Title 22 §87303(g)",
        },
      }),
    );

    render(
      <RegSettingsContent facilityNumber="197600001" />,
      { wrapper: wrapper(qc) },
    );

    // Wait for the HOT_WATER row.
    await screen.findByTestId("reg-setting-input-HOT_WATER_MAX_F");

    // Expand the source note for that row by clicking the toggle.
    const noteToggles = screen
      .getAllByRole("button", { name: /toggle source note/i });
    // The first toggle corresponds to the first rendered row (HOT_WATER_MAX_F).
    fireEvent.click(noteToggles[0]);

    const noteField = screen.getByTestId(
      "reg-setting-note-HOT_WATER_MAX_F",
    ) as HTMLTextAreaElement;
    fireEvent.change(noteField, {
      target: { value: "Title 22 §87303(g) per CCLD 2026-05-10" },
    });

    const saveBtn = screen.getByTestId("reg-setting-save-HOT_WATER_MAX_F");
    fireEvent.click(saveBtn);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalled();
    });
    expect(mockApi).toHaveBeenCalledWith(
      "PUT",
      "/api/ops/reg-settings/HOT_WATER_MAX_F",
      expect.objectContaining({
        value: "110",
        sourceNote: "Title 22 §87303(g) per CCLD 2026-05-10",
        validated: true,
      }),
    );

    // The Validated emerald chip now shows on this row's section in optimistic update.
    await waitFor(() => {
      const validated = screen.getAllByText(/^Validated$/);
      expect(validated.length).toBeGreaterThan(0);
    });
  });
});
