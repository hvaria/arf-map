/**
 * Medication Edit / Discontinue smoke tests.
 *
 * The Medication CRUD lives inside ResidentProfileContent's Medications tab
 * (line 984), NOT EmarContent — EmarContent is the med-pass administration
 * surface. We test the Edit + Discontinue actions directly on the medication
 * row rendered in the resident profile.
 *
 * Covers:
 *   - Edit dialog opens prefilled with current medication values.
 *   - Submit issues PUT /api/ops/medications/:id with the updated fields.
 *   - Discontinue modal issues DELETE /api/ops/medications/:id with reason.
 *     (Server route: DELETE /api/ops/medications/:id; the task spec lists
 *     POST /discontinue but the actual BE endpoint is DELETE — see
 *     server/ops/opsRouter.ts:1131.)
 *   - Discontinued row hides further Edit / Discontinue actions because the
 *     filter on line ~1005 of ResidentProfileContent excludes discontinued.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - apiRequest mock + fetch stub:    IncidentLifecycle.test.tsx:32-55
 *   - QueryClient wrapper:             AuditTrailButton.test.tsx:37-50
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

import { apiRequest } from "@/lib/queryClient";
import { ResidentProfileContent } from "../components/operations/ResidentProfileContent";

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

const residentFixture = {
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
};

interface MedFixture {
  id: number;
  drugName: string;
  dosage: string;
  route: string;
  frequency: string;
  frequencyLabel: string;
  frequencyRaw: string | null;
  scheduledTimes: string | null;
  scheduledTimesArray: string[];
  status: string;
  prescriberName: string | null;
}

function med(overrides: Partial<MedFixture> = {}): MedFixture {
  return {
    id: 1,
    drugName: "Lisinopril",
    dosage: "10 mg",
    route: "oral",
    frequency: "once_daily",
    frequencyLabel: "Once daily (qd)",
    frequencyRaw: null,
    scheduledTimes: "09:00",
    scheduledTimesArray: ["09:00"],
    status: "active",
    prescriberName: "Dr. Smith",
    ...overrides,
  };
}

function stubFetch(meds: MedFixture[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.endsWith(`/medications`)) {
        return Promise.resolve(jsonResponse({ success: true, data: meds }));
      }
      if (url.endsWith(`/residents/${residentFixture.id}`)) {
        return Promise.resolve(jsonResponse({ success: true, data: residentFixture }));
      }
      if (url.endsWith("/care-plan")) {
        // Resident profile reads as object; treat absence as 404 → null.
        return Promise.resolve(jsonResponse({ success: false, data: null }, 404));
      }
      // Default empty list for assessments / daily-tasks / incidents.
      return Promise.resolve(jsonResponse({ success: true, data: [] }));
    }),
  );
}

async function navigateToMedicationsTab(user: ReturnType<typeof userEvent.setup>) {
  // Wait for the resident header to render so we know data has loaded
  // before flipping tabs. Radix tabs interact via pointer events —
  // fireEvent.click doesn't change the active tab on its own; userEvent
  // emulates the full pointer sequence. Reference:
  //   client/src/__tests__/TrustAccountsTab.test.tsx:146-149.
  await screen.findByText(/Ada Lovelace/);
  const tab = await screen.findByRole("tab", { name: /Medications/i });
  await user.click(tab);
}

beforeEach(() => {
  mockApi.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("Medication — Edit dialog", () => {
  it("opens prefilled with the current medication values", async () => {
    const m = med();
    stubFetch([m]);
    const qc = freshClient();
    const user = userEvent.setup();

    render(
      <ResidentProfileContent
        facilityNumber={residentFixture.facilityNumber}
        residentId={residentFixture.id}
      />,
      { wrapper: wrapper(qc) },
    );

    await navigateToMedicationsTab(user);

    const editBtn = await screen.findByTestId(`med-edit-${m.id}`);
    await user.click(editBtn);

    await waitFor(() => {
      const drug = screen.getByLabelText(/Drug Name/i) as HTMLInputElement;
      const dosage = screen.getByLabelText(/Dosage/i) as HTMLInputElement;
      expect(drug.value).toBe("Lisinopril");
      expect(dosage.value).toBe("10 mg");
    });
  });

  it("PUTs to /api/ops/medications/:id on save", async () => {
    const m = med();
    stubFetch([m]);
    mockApi.mockResolvedValue(
      jsonResponse({ success: true, data: { ...m, dosage: "20 mg" } }),
    );
    const qc = freshClient();
    const user = userEvent.setup();

    render(
      <ResidentProfileContent
        facilityNumber={residentFixture.facilityNumber}
        residentId={residentFixture.id}
      />,
      { wrapper: wrapper(qc) },
    );
    await navigateToMedicationsTab(user);
    await user.click(await screen.findByTestId(`med-edit-${m.id}`));

    const dosage = await screen.findByLabelText(/Dosage/i);
    fireEvent.change(dosage, { target: { value: "20 mg" } });

    await user.click(screen.getByRole("button", { name: /Save Changes/i }));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "PUT",
        `/api/ops/medications/${m.id}`,
        expect.objectContaining({ dosage: "20 mg" }),
      );
    });
  });
});

describe("Medication — Discontinue", () => {
  it("issues DELETE /api/ops/medications/:id with the chosen reason", async () => {
    const m = med();
    stubFetch([m]);
    mockApi.mockResolvedValue(jsonResponse({ success: true }));
    const qc = freshClient();
    const user = userEvent.setup();

    render(
      <ResidentProfileContent
        facilityNumber={residentFixture.facilityNumber}
        residentId={residentFixture.id}
      />,
      { wrapper: wrapper(qc) },
    );
    await navigateToMedicationsTab(user);
    await user.click(await screen.findByTestId(`med-discontinue-${m.id}`));

    // The dialog defaults to "completed_course"; just confirm.
    const confirmBtn = await screen.findByRole("button", {
      name: /^Discontinue$/i,
    });
    await user.click(confirmBtn);

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "DELETE",
        `/api/ops/medications/${m.id}`,
        expect.objectContaining({ reason: "completed_course" }),
      );
    });
  });

  it("hides Edit / Discontinue controls for discontinued rows", async () => {
    const m = med({ status: "discontinued" });
    stubFetch([m]);
    const qc = freshClient();
    const user = userEvent.setup();

    render(
      <ResidentProfileContent
        facilityNumber={residentFixture.facilityNumber}
        residentId={residentFixture.id}
      />,
      { wrapper: wrapper(qc) },
    );
    await navigateToMedicationsTab(user);

    // Active list is empty → no edit/discontinue controls visible.
    await waitFor(() => {
      expect(screen.getByText(/No active medications\./i)).toBeInTheDocument();
    });
    expect(screen.queryByTestId(`med-edit-${m.id}`)).not.toBeInTheDocument();
    expect(screen.queryByTestId(`med-discontinue-${m.id}`)).not.toBeInTheDocument();
  });
});
