/**
 * ResidentProfileContent — "Open trust account" trust-section tests.
 *
 * Closes the QA-flagged coverage gap on the Profile-tab trust section. The
 * single highest-value assertion is AC4's dual cache-key invalidation: on a
 * successful open, BOTH the per-resident trust key AND the un-parameterized
 * facility trust key (the Reports monthly-trust picker key at
 * ReportsContent.tsx:278) must be invalidated — if the second invalidation
 * regresses, the picker silently stops refreshing.
 *
 * Also covers the display states + gating:
 *   1. Trust enabled + no account + writable  → "Open trust account" + helper.
 *   2. Trust enabled + active account          → read-only Active/Balance, NO button.
 *   3. Trust disabled (reg-setting !== "true") → section not rendered.
 *   4. Auditor / not writable                  → no "Open trust account" button.
 *   5. Click fires apiRequest POST { residentId } and invalidates BOTH keys.
 *
 * Harness mirrored from: client/src/__tests__/ResidentProfileEdit.test.tsx
 *   - same QueryClient + provider/auditorWrapper helpers
 *   - same fetch URL-routing stub approach (extended for reg-settings + trust)
 *   - same apiRequest mock + jsonResponse helper
 *   - same ChartCompleteness / AddTaskDialog / MedicationFormDialog stubs
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
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

// Stub heavy sub-panels so the test focuses on the trust section.
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

const FACILITY = "197600001";
const RESIDENT_ID = 42;

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
          facilityNumber: FACILITY,
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
    id: RESIDENT_ID,
    facilityNumber: FACILITY,
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

interface TrustAccountFixture {
  id: number;
  residentId: number;
  status: string;
  balanceCents: number;
}

/**
 * Route the component's GET queries:
 *   - single-resident GET            → the resident fixture
 *   - reg-settings                   → RESIDENT_TRUST_ENABLED = "true"/"false"
 *   - trust/accounts?residentId=...  → the supplied trust-account list
 *   - everything else (assessments,  → empty list
 *     care-plan, daily-tasks,
 *     medications, incidents)
 */
function stubFetchGet(opts: {
  body: ResidentFixture;
  trustEnabled: boolean;
  trustAccounts?: TrustAccountFixture[];
}) {
  const { body, trustEnabled, trustAccounts = [] } = opts;
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation((url: string) => {
      if (url.includes("/reg-settings")) {
        return Promise.resolve(
          jsonResponse({
            success: true,
            data: [
              { key: "RESIDENT_TRUST_ENABLED", value: trustEnabled ? "true" : "false" },
            ],
          }),
        );
      }
      if (url.includes("/trust/accounts")) {
        return Promise.resolve(jsonResponse({ success: true, data: trustAccounts }));
      }
      // Single-resident GET — must not collide with the nested resource paths.
      if (
        url.includes(`/residents/${body.id}`) &&
        !url.includes("/assessments") &&
        !url.includes("/care-plan") &&
        !url.includes("/daily-tasks") &&
        !url.includes("/medications") &&
        !url.includes("/incidents")
      ) {
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

// Note: the Element.prototype.scrollIntoView polyfill that Radix Select needs
// under jsdom lives in the shared setup file (client/src/__tests__/setup.ts).

beforeEach(() => {
  mockApi.mockReset();
  toastMock.mockReset();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("ResidentProfileContent — trust section gating + display", () => {
  it("trust enabled + no account + writable → shows Open button + helper", async () => {
    const r = resident();
    stubFetchGet({ body: r, trustEnabled: true, trustAccounts: [] });
    const qc = freshClient();

    render(
      <ResidentProfileContent facilityNumber={r.facilityNumber} residentId={r.id} />,
      { wrapper: wrapper(qc) },
    );

    expect(
      await screen.findByText(/No trust account on file for this resident\./i),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Open trust account/i }),
    ).toBeInTheDocument();
  });

  it("trust enabled + active account → read-only Active/Balance, NO button", async () => {
    const r = resident();
    stubFetchGet({
      body: r,
      trustEnabled: true,
      trustAccounts: [
        { id: 7, residentId: r.id, status: "active", balanceCents: 0 },
      ],
    });
    const qc = freshClient();

    render(
      <ResidentProfileContent facilityNumber={r.facilityNumber} residentId={r.id} />,
      { wrapper: wrapper(qc) },
    );

    // "Trust account · Active · Balance $0.00" — the balance is unique to the
    // trust line ($0.00 appears nowhere else), and the same <p> carries the
    // Active + Trust account text, so assert on that single node. ("Active"
    // alone is ambiguous with the resident status chip "active".)
    const trustLine = await screen.findByText(/Trust account.*Active.*Balance/i);
    expect(trustLine).toBeInTheDocument();
    expect(trustLine).toHaveTextContent("$0.00");
    expect(
      screen.queryByRole("button", { name: /Open trust account/i }),
    ).not.toBeInTheDocument();
  });

  it("trust disabled (reg-setting !== 'true') → trust section not rendered", async () => {
    const r = resident();
    stubFetchGet({ body: r, trustEnabled: false, trustAccounts: [] });
    const qc = freshClient();

    render(
      <ResidentProfileContent facilityNumber={r.facilityNumber} residentId={r.id} />,
      { wrapper: wrapper(qc) },
    );

    // Wait for the resident to render so the profile tab is settled.
    await waitFor(() => {
      expect(screen.getByText("Ada Lovelace")).toBeInTheDocument();
    });

    expect(screen.queryByText(/Trust account/i)).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Open trust account/i }),
    ).not.toBeInTheDocument();
  });

  it("auditor / not writable → no Open trust account button (even with no account)", async () => {
    const r = resident();
    stubFetchGet({ body: r, trustEnabled: true, trustAccounts: [] });
    const qc = freshClient();

    render(
      <ResidentProfileContent facilityNumber={r.facilityNumber} residentId={r.id} />,
      { wrapper: auditorWrapper(qc) },
    );

    // Helper text still shows (section is enabled), but the write action is gated.
    expect(
      await screen.findByText(/No trust account on file for this resident\./i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /Open trust account/i }),
    ).not.toBeInTheDocument();
  });
});

describe("ResidentProfileContent — Open trust account mutation (AC4)", () => {
  it("POSTs { residentId } and invalidates BOTH the per-resident and un-parameterized trust keys", async () => {
    const r = resident();
    stubFetchGet({ body: r, trustEnabled: true, trustAccounts: [] });
    mockApi.mockResolvedValue(
      jsonResponse({ success: true, data: { id: 9, residentId: r.id, status: "active", balanceCents: 0 } }),
    );
    const qc = freshClient();
    const invalidateSpy = vi.spyOn(qc, "invalidateQueries");

    render(
      <ResidentProfileContent facilityNumber={r.facilityNumber} residentId={r.id} />,
      { wrapper: wrapper(qc) },
    );

    fireEvent.click(await screen.findByRole("button", { name: /Open trust account/i }));

    // POST body is exactly { residentId } (number, not stringified).
    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "POST",
        "/api/ops/trust/accounts",
        { residentId: r.id },
      );
    });

    const perResidentKey = `/api/ops/facilities/${FACILITY}/trust/accounts?residentId=${r.id}`;
    const unParameterizedKey = `/api/ops/facilities/${FACILITY}/trust/accounts`;

    // AC4 — both cache keys invalidated on success.
    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [perResidentKey] });
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: [unParameterizedKey] });
    });
  });
});
