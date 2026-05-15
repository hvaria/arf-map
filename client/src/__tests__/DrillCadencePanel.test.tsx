/**
 * <DrillCadencePanel> smoke tests — Wave 4 W6.
 *
 * Covers:
 *   - Renders three shift cells (AM / PM / NOC).
 *   - When worst === "behind", border + amber copy show the deficit hint.
 *
 * Patterns reused:
 *   - QueryClient + wrapper helpers:        VendorsContent.test.tsx:49-62
 *   - vi.stubGlobal("fetch", …) JSON mock:  VendorsContent.test.tsx:96-99
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { DrillCadencePanel } from "../components/operations/DrillsContent";

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

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("DrillCadencePanel — three-cell row", () => {
  it("renders an AM/PM/NOC cell each with logged/required text", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          data: {
            facilityNumber: "197600001",
            quarterStartAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
            quarterEndAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
            fire: [
              { shift: "AM", required: 1, logged: 1, deficit: 0, status: "ok" },
              { shift: "PM", required: 1, logged: 1, deficit: 0, status: "ok" },
              { shift: "NOC", required: 1, logged: 1, deficit: 0, status: "ok" },
            ],
            totalRequired: 3,
            totalLogged: 3,
            totalDeficit: 0,
            worst: "ok",
          },
        }),
      ),
    );

    render(<DrillCadencePanel facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    await screen.findByTestId("drill-cadence-panel");
    expect(screen.getByTestId("drill-cadence-shift-AM")).toBeInTheDocument();
    expect(screen.getByTestId("drill-cadence-shift-PM")).toBeInTheDocument();
    expect(screen.getByTestId("drill-cadence-shift-NOC")).toBeInTheDocument();
    expect(screen.getAllByText(/On track/).length).toBe(3);
  });
});

describe("DrillCadencePanel — behind cadence", () => {
  it("surfaces the amber 'Behind cadence' message + deficit hint", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          success: true,
          data: {
            facilityNumber: "197600001",
            quarterStartAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
            quarterEndAt: Date.now() + 60 * 24 * 60 * 60 * 1000,
            fire: [
              { shift: "AM", required: 1, logged: 0, deficit: 1, status: "behind" },
              { shift: "PM", required: 1, logged: 1, deficit: 0, status: "ok" },
              { shift: "NOC", required: 1, logged: 0, deficit: 1, status: "behind" },
            ],
            totalRequired: 3,
            totalLogged: 1,
            totalDeficit: 2,
            worst: "behind",
          },
        }),
      ),
    );

    render(<DrillCadencePanel facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    const panel = await screen.findByTestId("drill-cadence-panel");
    expect(panel.className).toMatch(/border-amber-300/);
    await waitFor(() => {
      expect(screen.getByText(/Behind cadence/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/log 2 more drills/i)).toBeInTheDocument();
  });
});
