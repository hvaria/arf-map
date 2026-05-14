/**
 * Obligation engine smoke tests — Wave 2 finale.
 *
 * Covers:
 *   - <ComplianceContent> renders a severity badge per row given a mocked
 *     obligation response.
 *   - The recurrence chip renders when `recurrenceRule` is set.
 *   - AddObligationDialog with recurrence='annual' POSTs the expected body
 *     to /api/ops/obligations.
 *   - Complete row action POSTs /api/ops/obligations/:id/complete; on a
 *     response that includes `next`, toast text mentions "Next cycle".
 *   - <AuditReadinessContent> "Overdue obligations" tile shows the
 *     `meta.total` count from the obligations list endpoint.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - QueryClient + provider wrapper:
 *       client/src/__tests__/AuditTrailButton.test.tsx:37-50
 *   - vi.stubGlobal("fetch", …) URL-routing mock:
 *       client/src/__tests__/ChartCompleteness.test.tsx:101-132
 *   - apiRequest mock pattern:
 *       client/src/__tests__/ComplaintsContent.test.tsx:26-38
 *   - Radix combobox userEvent pattern:
 *       client/src/__tests__/StaffCredentials.test.tsx:401-408
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
import {
  render,
  screen,
  cleanup,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// Radix Select uses pointer-capture APIs jsdom doesn't implement.
beforeAll(() => {
  if (!(Element.prototype as unknown as { hasPointerCapture?: unknown }).hasPointerCapture) {
    (Element.prototype as unknown as { hasPointerCapture: () => boolean }).hasPointerCapture =
      () => false;
  }
  if (!(Element.prototype as unknown as { releasePointerCapture?: unknown }).releasePointerCapture) {
    (Element.prototype as unknown as { releasePointerCapture: () => void }).releasePointerCapture =
      () => undefined;
  }
  if (!(Element.prototype as unknown as { scrollIntoView?: unknown }).scrollIntoView) {
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
      () => undefined;
  }
});

const toastMock = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

vi.mock("@/hooks/useSession", () => ({
  useSession: () => ({
    data: { id: 1, facilityNumber: "197600001", username: "admin@example.com" },
  }),
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  return { ...actual, apiRequest: vi.fn() };
});

import { apiRequest } from "@/lib/queryClient";
import {
  ComplianceContent,
  type Obligation,
} from "../components/operations/ComplianceContent";
import { AuditReadinessContent } from "../components/operations/AuditReadinessContent";

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

function obligation(overrides: Partial<Obligation> = {}): Obligation {
  return {
    id: 100,
    facilityNumber: "197600001",
    obligationType: "fire_safety",
    targetType: "facility",
    targetId: null,
    title: "Inspect fire extinguishers",
    description: null,
    dueAt: Date.now() + 7 * 24 * 60 * 60 * 1000,
    completedAt: null,
    completedBy: null,
    assignedTo: "Jane Doe",
    severity: "high",
    status: "pending",
    recurrenceRule: null,
    sourceEntityType: null,
    sourceEntityId: null,
    createdAt: Date.now() - 1000,
    updatedAt: Date.now() - 1000,
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

// ─────────────────────────────────────────────────────────────────────────────
// Row rendering
// ─────────────────────────────────────────────────────────────────────────────

describe("ComplianceContent — row rendering", () => {
  it("renders a severity badge per row", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/obligations")) {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: [
                obligation({ id: 1, severity: "high", title: "Hi" }),
                obligation({ id: 2, severity: "medium", title: "Med" }),
                obligation({ id: 3, severity: "low", title: "Lo" }),
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse({ success: true, data: [] }));
      }),
    );

    render(<ComplianceContent facilityNumber="197600001" />, { wrapper: wrapper(qc) });

    await waitFor(() => {
      expect(screen.getByTestId("obligation-severity-1")).toBeInTheDocument();
    });
    expect(screen.getByTestId("obligation-severity-1").textContent).toContain("High");
    expect(screen.getByTestId("obligation-severity-2").textContent).toContain("Medium");
    expect(screen.getByTestId("obligation-severity-3").textContent).toContain("Low");
  });

  it("renders a recurrence chip when recurrenceRule is set", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/obligations")) {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: [
                obligation({ id: 10, recurrenceRule: "annual" }),
                obligation({ id: 11, recurrenceRule: "every_n_days:14" }),
                obligation({ id: 12, recurrenceRule: null }),
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse({ success: true, data: [] }));
      }),
    );

    render(<ComplianceContent facilityNumber="197600001" />, { wrapper: wrapper(qc) });

    await waitFor(() => {
      expect(screen.getByTestId("obligation-recurrence-10")).toBeInTheDocument();
    });
    expect(screen.getByTestId("obligation-recurrence-10").textContent).toContain("Annual");
    expect(screen.getByTestId("obligation-recurrence-11").textContent).toContain(
      "Every 14 days",
    );
    // No recurrence => no chip.
    expect(screen.queryByTestId("obligation-recurrence-12")).not.toBeInTheDocument();
  });

  it("renders the source-link chip when sourceEntityType is set", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/obligations")) {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: [
                obligation({
                  id: 21,
                  sourceEntityType: "ops_staff_credential",
                  sourceEntityId: 9,
                }),
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse({ success: true, data: [] }));
      }),
    );

    render(<ComplianceContent facilityNumber="197600001" />, { wrapper: wrapper(qc) });

    await waitFor(() => {
      expect(screen.getByTestId("obligation-source-21")).toBeInTheDocument();
    });
    expect(screen.getByTestId("obligation-source-21").textContent).toContain(
      "from credential",
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AddObligationDialog
// ─────────────────────────────────────────────────────────────────────────────

describe("AddObligationDialog — POST", () => {
  it("POSTs to /api/ops/obligations with severity + annual recurrence", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/staff")) {
          return Promise.resolve(jsonResponse({ success: true, data: [] }));
        }
        return Promise.resolve(jsonResponse({ success: true, data: [] }));
      }),
    );
    mockApi.mockResolvedValue(
      jsonResponse({ success: true, data: { id: 999 } }),
    );

    const user = userEvent.setup();
    render(<ComplianceContent facilityNumber="197600001" />, { wrapper: wrapper(qc) });

    // Open the dialog.
    await user.click(await screen.findByRole("button", { name: /add item/i }));

    // Pick type.
    const typeTrigger = await screen.findByLabelText("Obligation type");
    await user.click(typeTrigger);
    await user.click(await screen.findByRole("option", { name: /fire safety/i }));

    // Fill title.
    const titleInput = screen.getByLabelText("Obligation title");
    await user.type(titleInput, "Annual extinguisher service");

    // Pick recurrence = Annual.
    const recurrenceTrigger = screen.getByLabelText("Recurrence");
    await user.click(recurrenceTrigger);
    await user.click(await screen.findByRole("option", { name: /^annual$/i }));

    // Set due date to tomorrow (yyyy-mm-dd). The first date input in the
    // dialog is "Due Date" — there is only one in this dialog.
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
    const iso = tomorrow.toISOString().slice(0, 10);
    const dateInputs = document.querySelectorAll<HTMLInputElement>('input[type="date"]');
    expect(dateInputs.length).toBeGreaterThan(0);
    fireEvent.change(dateInputs[0], { target: { value: iso } });

    // Submit.
    await user.click(screen.getByRole("button", { name: /^add obligation$/i }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalled();
    });
    const [method, url, body] = mockApi.mock.calls[0];
    expect(method).toBe("POST");
    expect(url).toBe("/api/ops/obligations");
    expect(body).toMatchObject({
      obligationType: "fire_safety",
      title: "Annual extinguisher service",
      severity: "medium", // default
      recurrenceRule: "annual",
      targetType: "facility",
      targetId: null,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Complete row action
// ─────────────────────────────────────────────────────────────────────────────

describe("ComplianceContent — complete action", () => {
  it("POSTs /complete and surfaces 'Next cycle' in the toast when BE returns next", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/obligations")) {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: [
                obligation({
                  id: 55,
                  title: "Recurring drill",
                  recurrenceRule: "monthly",
                }),
              ],
            }),
          );
        }
        return Promise.resolve(jsonResponse({ success: true, data: [] }));
      }),
    );

    const nextDueAt = Date.now() + 31 * 24 * 60 * 60 * 1000;
    mockApi.mockResolvedValue(
      jsonResponse({
        success: true,
        data: { id: 55, status: "closed", completedAt: Date.now() },
        next: { id: 56, dueAt: nextDueAt },
      }),
    );

    render(<ComplianceContent facilityNumber="197600001" />, { wrapper: wrapper(qc) });

    const completeBtn = await screen.findByTestId("obligation-complete-55");
    fireEvent.click(completeBtn);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalled();
    });
    const [method, url, body] = mockApi.mock.calls[0];
    expect(method).toBe("POST");
    expect(url).toBe("/api/ops/obligations/55/complete");
    expect(body).toMatchObject({ by: "admin@example.com" });

    await waitFor(() => {
      expect(toastMock).toHaveBeenCalled();
    });
    // The last toast call should mention "Next cycle".
    const allCalls = toastMock.mock.calls.map((c) => c[0]);
    const matched = allCalls.find((c) =>
      typeof c?.description === "string" && c.description.includes("Next cycle"),
    );
    expect(matched).toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// AuditReadinessContent — Overdue obligations tile
// ─────────────────────────────────────────────────────────────────────────────

describe("AuditReadinessContent — Overdue obligations tile", () => {
  it("shows the count from the obligations list endpoint's meta.total", async () => {
    const qc = freshClient();

    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((url: string) => {
        if (url.includes("/obligations")) {
          return Promise.resolve(
            jsonResponse({
              success: true,
              data: [],
              meta: { total: 7 },
            }),
          );
        }
        if (url.includes("/chart-completeness")) {
          return Promise.resolve(
            jsonResponse({ success: true, data: { rows: [], total: 0, complete: 0 } }),
          );
        }
        return Promise.resolve(jsonResponse({ success: true, data: [] }));
      }),
    );

    render(<AuditReadinessContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    const tile = await screen.findByTestId("audit-overview-overdue-obligations-tile");
    await waitFor(() => {
      expect(tile.textContent).toContain("Overdue obligations");
      expect(tile.textContent).toContain("7");
    });
  });
});
