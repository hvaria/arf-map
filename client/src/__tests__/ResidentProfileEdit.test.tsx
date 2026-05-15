/**
 * ResidentProfileContent — Edit / Discharge / Reactivate smoke tests.
 *
 * Covers:
 *   - Edit button hidden in auditor mode (useIsWritable() === false).
 *   - Edit dialog opens prefilled with current resident values.
 *   - Submit issues PUT /api/ops/residents/:id with the diff.
 *   - Discharge action sets status='discharged' via PUT.
 *   - Reactivate action flips status back to 'active'.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - QueryClient + provider wrapper:      AuditTrailButton.test.tsx:37-50
 *   - fetch URL-routing mock:              IncidentLifecycle.test.tsx:32-37
 *   - AuditorProvider wrapper for read-only assertion:
 *                                          ReportsContent.test.tsx:73-89
 *   - apiRequest mock + jsonResponse:      IncidentLifecycle.test.tsx:32-55
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

// Stub heavy sub-panels so the test focuses on the header edit flow.
vi.mock("@/components/operations/ChartCompletenessBanner", () => ({
  ChartCompletenessPanel: () => <div data-testid="chart-panel-stub" />,
  ChartCompletenessChip: () => null,
  ChartCompletenessChipSkeleton: () => null,
}));
vi.mock("@/hooks/useChartCompleteness", () => ({
  useChartCompletenessForResident: () => ({ data: null, isLoading: false }),
  useChartCompletenessForFacility: () => ({
    byResidentId: new Map(),
    isLoading: false,
  }),
}));
vi.mock("@/components/operations/AddTaskDialog", () => ({
  AddTaskDialog: () => null,
}));
vi.mock("@/components/medications/MedicationFormDialog", () => ({
  MedicationFormDialog: () => null,
}));

import { apiRequest } from "@/lib/queryClient";
import { ResidentProfileContent } from "../components/operations/ResidentProfileContent";
import { AuditorProvider } from "@/context/AuditorContext";

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

function auditorWrapper(qc: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={qc}>
      <AuditorProvider
        value={{
          token: "test-token",
          facilityNumber: "197600001",
          expiresAt: Date.now() + 86_400_000,
          audience: "cdss",
          readOnly: true,
        }}
      >
        {children}
      </AuditorProvider>
    </QueryClientProvider>
  );
}

interface ResidentFixture {
  id: number;
  facilityNumber: string;
  firstName: string;
  lastName: string;
  dob: number;
  gender: string;
  roomNumber: string;
  admissionDate: number;
  primaryDx: string;
  levelOfCare: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  fundingSource: string;
  status: string;
}

function resident(overrides: Partial<ResidentFixture> = {}): ResidentFixture {
  return {
    id: 42,
    facilityNumber: "197600001",
    firstName: "Ada",
    lastName: "Lovelace",
    dob: new Date("1950-06-15").getTime(),
    gender: "female",
    roomNumber: "101",
    admissionDate: new Date("2024-01-10").getTime(),
    primaryDx: "Dementia",
    levelOfCare: "memory_care",
    emergencyContactName: "Ann Lovelace",
    emergencyContactPhone: "555-0100",
    fundingSource: "private_pay",
    status: "active",
    ...overrides,
  };
}

function stubFetchGet(body: ResidentFixture) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      // Only the single-resident GET matters; everything else returns empty.
      if (url.includes(`/residents/${body.id}`) && !url.includes("/assessments") && !url.includes("/care-plan") && !url.includes("/daily-tasks") && !url.includes("/medications") && !url.includes("/incidents")) {
        return Promise.resolve(jsonResponse({ success: true, data: body }));
      }
      if (
        url.includes("/care-plan") ||
        url.includes("/assessments") ||
        url.includes("/daily-tasks") ||
        url.includes("/medications") ||
        url.includes("/incidents")
      ) {
        return Promise.resolve(jsonResponse({ success: true, data: [] }));
      }
      return Promise.resolve(jsonResponse({ success: true, data: null }));
    }),
  );
}

beforeEach(() => {
  mockApi.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ResidentProfileContent — auditor mode", () => {
  it("hides Edit / Discharge triggers when inside an auditor session", async () => {
    const r = resident();
    stubFetchGet(r);
    const qc = freshClient();

    render(
      <ResidentProfileContent facilityNumber={r.facilityNumber} residentId={r.id} />,
      { wrapper: auditorWrapper(qc) },
    );

    await waitFor(() => {
      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("resident-edit-trigger")).not.toBeInTheDocument();
    expect(screen.queryByTestId("resident-discharge-trigger")).not.toBeInTheDocument();
    expect(screen.queryByTestId("resident-reactivate-trigger")).not.toBeInTheDocument();
  });
});

describe("ResidentProfileContent — Edit dialog", () => {
  it("opens prefilled with current resident values", async () => {
    const r = resident();
    stubFetchGet(r);
    const qc = freshClient();

    render(
      <ResidentProfileContent facilityNumber={r.facilityNumber} residentId={r.id} />,
      { wrapper: wrapper(qc) },
    );

    const editBtn = await screen.findByTestId("resident-edit-trigger");
    fireEvent.click(editBtn);

    // Prefilled values appear in the form inputs.
    await waitFor(() => {
      const first = screen.getByLabelText(/First Name/i) as HTMLInputElement;
      const last = screen.getByLabelText(/Last Name/i) as HTMLInputElement;
      expect(first.value).toBe("Ada");
      expect(last.value).toBe("Lovelace");
    });
  });

  it("PUTs the diff to /api/ops/residents/:id on save", async () => {
    const r = resident();
    stubFetchGet(r);
    mockApi.mockResolvedValue(
      jsonResponse({ success: true, data: { ...r, lastName: "Byron" } }),
    );
    const qc = freshClient();

    render(
      <ResidentProfileContent facilityNumber={r.facilityNumber} residentId={r.id} />,
      { wrapper: wrapper(qc) },
    );

    fireEvent.click(await screen.findByTestId("resident-edit-trigger"));

    const lastInput = await screen.findByLabelText(/Last Name/i);
    fireEvent.change(lastInput, { target: { value: "Byron" } });

    fireEvent.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "PUT",
        "/api/ops/residents/42",
        expect.objectContaining({ lastName: "Byron" }),
      );
    });
  });
});

describe("ResidentProfileContent — Discharge / Reactivate", () => {
  it("Discharge action PUTs status='discharged'", async () => {
    const r = resident();
    stubFetchGet(r);
    mockApi.mockResolvedValue(
      jsonResponse({ success: true, data: { ...r, status: "discharged" } }),
    );
    const qc = freshClient();

    render(
      <ResidentProfileContent facilityNumber={r.facilityNumber} residentId={r.id} />,
      { wrapper: wrapper(qc) },
    );

    fireEvent.click(await screen.findByTestId("resident-discharge-trigger"));

    const confirm = await screen.findByRole("button", { name: /^Discharge$/i });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "PUT",
        "/api/ops/residents/42",
        { status: "discharged" },
      );
    });
  });

  it("Reactivate (visible only for discharged) PUTs status='active'", async () => {
    const r = resident({ status: "discharged" });
    stubFetchGet(r);
    mockApi.mockResolvedValue(
      jsonResponse({ success: true, data: { ...r, status: "active" } }),
    );
    const qc = freshClient();

    render(
      <ResidentProfileContent facilityNumber={r.facilityNumber} residentId={r.id} />,
      { wrapper: wrapper(qc) },
    );

    // The discharge trigger is replaced by reactivate when status='discharged'.
    expect(await screen.findByTestId("resident-reactivate-trigger")).toBeInTheDocument();
    expect(screen.queryByTestId("resident-discharge-trigger")).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId("resident-reactivate-trigger"));
    const confirm = await screen.findByRole("button", { name: /^Reactivate$/i });
    fireEvent.click(confirm);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "PUT",
        "/api/ops/residents/42",
        { status: "active" },
      );
    });
  });
});
