/**
 * <StaffContent> Wave 2 W3 — staff-credentials smoke tests.
 *
 * Pattern citations (Implementation Contract §2.5):
 *   - Mock skeleton + jsonResponse helper:    AttachEvidence.test.tsx:30-67
 *   - apiRequest mock + fetch stub:           DrillsContent.test.tsx:28-58
 *   - Optimistic delete pattern reference:    AttachEvidence.test.tsx:178-220
 *
 * Covers:
 *   - Credentials tab renders empty state when no staff present.
 *   - Per-staff detail view shows required-vs-additional grouping.
 *   - AddCredentialDialog: opens, validates `note required when type=other`,
 *     submits a valid create + flushes pending evidence.
 *   - AddShiftDialog credential check: warning state renders amber alert
 *     without blocking save; expired state blocks save until override-with-
 *     reason is provided.
 */
import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from "vitest";
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

// Radix Select + Tabs use pointer-capture APIs and `scrollIntoView` that
// jsdom doesn't implement. Polyfill once so user-event clicks succeed.
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
  useSession: () => ({ data: { id: 1, facilityNumber: "197600001", username: "admin@example.com" } }),
}));

vi.mock("@/lib/queryClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/queryClient")>(
    "@/lib/queryClient",
  );
  return { ...actual, apiRequest: vi.fn() };
});

import { apiRequest } from "@/lib/queryClient";
import { StaffContent } from "../components/operations/StaffContent";

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

interface StaffRow {
  id: number;
  facilityNumber: string;
  firstName: string;
  lastName: string;
  role: string;
  status: "active" | "inactive" | "on_leave";
  hireDate: number;
  licenseExpiry: number | null;
  email: string;
  phone: string;
}

function staffMember(overrides: Partial<StaffRow> = {}): StaffRow {
  return {
    id: 1,
    facilityNumber: "197600001",
    firstName: "Maria",
    lastName: "Sanchez",
    role: "caregiver",
    status: "active",
    hireDate: Date.now() - 365 * 24 * 60 * 60 * 1000,
    licenseExpiry: null,
    email: "maria@example.com",
    phone: "5550100",
    ...overrides,
  };
}

/**
 * Build a fetch mock that routes by URL fragment. Falls through to a default
 * empty-data response so unrelated lookups don't blow up the render.
 */
function makeFetchRouter(routes: Array<{ match: (url: string) => boolean; respond: () => Response }>) {
  const fn = vi.fn();
  fn.mockImplementation(async (input: unknown) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    for (const r of routes) {
      if (r.match(url)) return r.respond();
    }
    return jsonResponse({ success: true, data: [] });
  });
  return fn;
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

describe("StaffContent — Credentials tab empty state", () => {
  it("renders the Credentials tab trigger and shows empty state when no staff exists", async () => {
    const qc = freshClient();
    vi.stubGlobal(
      "fetch",
      makeFetchRouter([
        {
          match: (u) => u.includes("/staff?") || u.endsWith("/staff"),
          respond: () => jsonResponse({ success: true, data: [] }),
        },
        {
          match: (u) => u.includes("/staff-credentials"),
          respond: () => jsonResponse({ success: true, data: [] }),
        },
        {
          match: (u) => u.includes("/reg-settings"),
          respond: () =>
            jsonResponse({
              success: true,
              data: [{ key: "CREDENTIAL_WARNING_DAYS", value: "60" }],
            }),
        },
      ]),
    );

    const user = userEvent.setup();
    render(<StaffContent facilityNumber="197600001" />, { wrapper: wrapper(qc) });

    const credTab = await screen.findByTestId("cred-tab-trigger");
    expect(credTab).toBeInTheDocument();
    await user.click(credTab);

    expect(await screen.findByTestId("cred-empty")).toBeInTheDocument();
    expect(
      screen.getByText(/Add staff in the Directory tab to start tracking credentials/i),
    ).toBeInTheDocument();
  });
});

describe("StaffContent — Credentials detail view (required vs additional)", () => {
  it("shows required-for-role and additional credential groups", async () => {
    const qc = freshClient();
    const staff = [staffMember({ id: 7, role: "caregiver" })];
    // caregiver requires: tb_clearance, fingerprint_clearance, cpr, first_aid,
    // pre_service_hours. We seed an active TB row + an "other" credential to
    // verify both groups render.
    const creds = [
      {
        id: 11,
        facilityNumber: "197600001",
        staffId: 7,
        credentialType: "tb_clearance",
        issuedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
        expiresAt: Date.now() + 365 * 24 * 60 * 60 * 1000,
        verifiedAt: null,
        verifiedBy: "admin@example.com",
        status: "active",
        note: null,
        createdBy: "admin@example.com",
        createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
        deletedAt: null,
      },
      {
        id: 12,
        facilityNumber: "197600001",
        staffId: 7,
        credentialType: "dementia_training",
        issuedAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
        expiresAt: null,
        verifiedAt: null,
        verifiedBy: null,
        status: "active",
        note: "Completed extended dementia module",
        createdBy: "admin@example.com",
        createdAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
        updatedAt: Date.now() - 60 * 24 * 60 * 60 * 1000,
        deletedAt: null,
      },
    ];
    vi.stubGlobal(
      "fetch",
      makeFetchRouter([
        {
          match: (u) => u.endsWith("/staff") || u.includes("/staff?"),
          respond: () => jsonResponse({ success: true, data: staff }),
        },
        {
          match: (u) => u.includes("/staff-credentials"),
          respond: () => jsonResponse({ success: true, data: creds }),
        },
        {
          match: (u) => u.includes("/reg-settings"),
          respond: () =>
            jsonResponse({
              success: true,
              data: [{ key: "CREDENTIAL_WARNING_DAYS", value: "60" }],
            }),
        },
        {
          match: (u) => u.includes("/schedule"),
          respond: () => jsonResponse({ success: true, data: [] }),
        },
      ]),
    );

    const user = userEvent.setup();
    render(<StaffContent facilityNumber="197600001" />, { wrapper: wrapper(qc) });

    await user.click(await screen.findByTestId("cred-tab-trigger"));
    // The View Credentials button appears once the staff list + summary load.
    const viewBtn = await screen.findByTestId("cred-view-7");
    await user.click(viewBtn);

    expect(await screen.findByTestId("cred-detail-view")).toBeInTheDocument();
    expect(screen.getByTestId("cred-required-group")).toBeInTheDocument();
    expect(screen.getByTestId("cred-additional-group")).toBeInTheDocument();
    // TB row is in required group; dementia is in additional group.
    expect(screen.getAllByText(/TB clearance/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Dementia training/i)).toBeInTheDocument();
  });
});

describe("AddCredentialDialog — 'other' requires a note", () => {
  it("blocks save with an inline error when type=other and note is empty, then submits when note is filled", async () => {
    const qc = freshClient();
    const staff = [staffMember({ id: 7, role: "caregiver" })];
    vi.stubGlobal(
      "fetch",
      makeFetchRouter([
        {
          match: (u) => u.endsWith("/staff") || u.includes("/staff?"),
          respond: () => jsonResponse({ success: true, data: staff }),
        },
        {
          match: (u) => u.includes("/staff-credentials"),
          respond: () => jsonResponse({ success: true, data: [] }),
        },
        {
          match: (u) => u.includes("/reg-settings"),
          respond: () =>
            jsonResponse({
              success: true,
              data: [{ key: "CREDENTIAL_WARNING_DAYS", value: "60" }],
            }),
        },
        {
          match: (u) => u.includes("/evidence"),
          respond: () => jsonResponse({ success: true, data: [] }),
        },
      ]),
    );
    mockApi.mockResolvedValue(jsonResponse({ success: true, data: { id: 99 } }));

    const user = userEvent.setup();
    render(<StaffContent facilityNumber="197600001" />, { wrapper: wrapper(qc) });

    await user.click(await screen.findByTestId("cred-tab-trigger"));
    await user.click(await screen.findByTestId("cred-view-7"));
    await user.click(await screen.findByTestId("cred-add-trigger"));

    // Pick "Other" via the trigger then a SelectItem option.
    const trigger = await screen.findByTestId("cred-type-trigger");
    await user.click(trigger);
    // The Radix Select renders options as role="option". "Other" is the
    // CREDENTIAL_LABELS["other"] label.
    const otherOption = await screen.findByRole("option", { name: "Other" });
    await user.click(otherOption);

    // Save without filling the note — should show the inline error and
    // never POST.
    await user.click(screen.getByTestId("cred-save"));
    await waitFor(() => {
      expect(
        screen.getByText(/Note is required when type is Other/i),
      ).toBeInTheDocument();
    });
    expect(mockApi).not.toHaveBeenCalled();

    // Fill the note and submit — POST goes out with credentialType=other.
    const noteEl = screen.getByTestId("cred-note");
    fireEvent.change(noteEl, { target: { value: "Live Scan re-roll receipt" } });
    await user.click(screen.getByTestId("cred-save"));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "POST",
        "/api/ops/staff-credentials",
        expect.objectContaining({
          staffId: 7,
          credentialType: "other",
          note: "Live Scan re-roll receipt",
        }),
      );
    });
  });
});

describe("AddShiftDialog — credential check warning is non-blocking", () => {
  it("renders an amber alert without disabling Save when worst=warning", async () => {
    const qc = freshClient();
    const staff = [staffMember({ id: 7, role: "caregiver" })];
    vi.stubGlobal(
      "fetch",
      makeFetchRouter([
        {
          match: (u) => u.endsWith("/staff") || u.includes("/staff?"),
          respond: () => jsonResponse({ success: true, data: staff }),
        },
        {
          match: (u) => u.includes("/staff-credentials"),
          respond: () => jsonResponse({ success: true, data: [] }),
        },
        {
          match: (u) => u.includes("/schedule"),
          respond: () => jsonResponse({ success: true, data: [] }),
        },
        {
          match: (u) => u.includes("/reg-settings"),
          respond: () =>
            jsonResponse({
              success: true,
              data: [{ key: "CREDENTIAL_WARNING_DAYS", value: "60" }],
            }),
        },
      ]),
    );
    // First apiRequest call = evaluate-shift (warning). Subsequent = shift POST.
    mockApi.mockImplementation(async (method: string, url: string) => {
      if (url.includes("/credentials/evaluate-shift")) {
        return jsonResponse({
          success: true,
          data: {
            worst: "warning",
            missing: [],
            expired: [],
            warning: ["cpr"],
            ok: ["tb_clearance"],
          },
        });
      }
      return jsonResponse({ success: true, data: { id: 5 } });
    });

    const user = userEvent.setup();
    render(<StaffContent facilityNumber="197600001" />, { wrapper: wrapper(qc) });

    // Open Schedule tab.
    await user.click(await screen.findByRole("tab", { name: /schedule/i }));
    // Click "Add Shift" button.
    await user.click(await screen.findByRole("button", { name: /add shift/i }));

    // Pick the staff member — radix renders the trigger as combobox; the
    // first combobox in the dialog is Staff Member (followed by Shift Type).
    await waitFor(() => {
      expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
    });
    const comboboxes = screen.getAllByRole("combobox");
    await user.click(comboboxes[0]);
    await user.click(await screen.findByRole("option", { name: /Maria Sanchez/i }));

    // Wait for the warning alert.
    await waitFor(() => {
      expect(screen.getByTestId("shift-cred-warning")).toBeInTheDocument();
    });
    const saveBtn = screen.getByTestId("shift-save");
    expect(saveBtn).not.toBeDisabled();

    // The blocked alert + override controls should NOT be present.
    expect(screen.queryByTestId("shift-cred-blocked")).not.toBeInTheDocument();
    expect(screen.queryByTestId("shift-override-toggle")).not.toBeInTheDocument();
  });
});

describe("AddShiftDialog — expired blocks save until override-with-reason", () => {
  it("disables Save when worst=expired and re-enables it after the override reason is filled in", async () => {
    const qc = freshClient();
    const staff = [staffMember({ id: 7, role: "caregiver" })];
    vi.stubGlobal(
      "fetch",
      makeFetchRouter([
        {
          match: (u) => u.endsWith("/staff") || u.includes("/staff?"),
          respond: () => jsonResponse({ success: true, data: staff }),
        },
        {
          match: (u) => u.includes("/staff-credentials"),
          respond: () => jsonResponse({ success: true, data: [] }),
        },
        {
          match: (u) => u.includes("/schedule"),
          respond: () => jsonResponse({ success: true, data: [] }),
        },
        {
          match: (u) => u.includes("/reg-settings"),
          respond: () =>
            jsonResponse({
              success: true,
              data: [{ key: "CREDENTIAL_WARNING_DAYS", value: "60" }],
            }),
        },
      ]),
    );
    mockApi.mockImplementation(async (method: string, url: string) => {
      if (url.includes("/credentials/evaluate-shift")) {
        return jsonResponse({
          success: true,
          data: {
            worst: "expired",
            missing: ["tb_clearance"],
            expired: ["cpr"],
            warning: [],
            ok: [],
          },
        });
      }
      return jsonResponse({ success: true, data: { id: 5 } });
    });

    const user = userEvent.setup();
    render(<StaffContent facilityNumber="197600001" />, { wrapper: wrapper(qc) });

    await user.click(await screen.findByRole("tab", { name: /schedule/i }));
    await user.click(await screen.findByRole("button", { name: /add shift/i }));
    await waitFor(() => {
      expect(screen.getAllByRole("combobox").length).toBeGreaterThan(0);
    });
    const comboboxes = screen.getAllByRole("combobox");
    await user.click(comboboxes[0]);
    await user.click(await screen.findByRole("option", { name: /Maria Sanchez/i }));

    // Blocked notice + disabled Save.
    await waitFor(() => {
      expect(screen.getByTestId("shift-cred-blocked")).toBeInTheDocument();
    });
    expect(screen.getByTestId("shift-save")).toBeDisabled();

    // Toggle override; Save still disabled because reason is empty.
    await user.click(screen.getByTestId("shift-override-toggle"));
    expect(screen.getByTestId("shift-save")).toBeDisabled();

    // Fill in the reason — Save becomes enabled.
    fireEvent.change(screen.getByTestId("shift-override-reason"), {
      target: { value: "Pending CPR re-cert exam scheduled for tomorrow." },
    });
    await waitFor(() => {
      expect(screen.getByTestId("shift-save")).not.toBeDisabled();
    });
  });
});
