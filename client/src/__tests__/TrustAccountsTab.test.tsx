/**
 * <TrustAccountsTab> + <BillingContent> Trust tab smoke tests — Wave 4 W12.
 *
 * Covers:
 *   - Feature-gated empty state when RESIDENT_TRUST_ENABLED='false'.
 *   - Account list renders with balances formatted via centsToDollars.
 *   - "+ Open account" dialog opens.
 *   - Ledger entry dialog rejects debit without witnessedBy when dual-sig required.
 *   - Reversal action POSTs `/api/ops/trust/ledger/:id/reverse`.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
  within,
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

import { apiRequest } from "@/lib/queryClient";
import { BillingContent } from "../components/operations/BillingContent";
import {
  TrustAccountsTab,
  type TrustAccount,
  type TrustLedgerEntry,
} from "../components/operations/TrustAccountsTab";
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

function account(overrides: Partial<TrustAccount> = {}): TrustAccount {
  return {
    id: 1,
    facilityNumber: "197600001",
    residentId: 42,
    residentName: "Jane Doe",
    balanceCents: 125000, // $1,250.00
    status: "active",
    lastTransactionAt: Date.now() - 1 * 24 * 60 * 60 * 1000,
    createdAt: Date.now() - 30 * 24 * 60 * 60 * 1000,
    ...overrides,
  };
}

function regSetting(key: string, value: string): RegSettingRow {
  return { key, value, placeholder: false, validated: true };
}

function ledgerEntry(
  overrides: Partial<TrustLedgerEntry> = {},
): TrustLedgerEntry {
  return {
    id: 100,
    accountId: 1,
    direction: "credit",
    amountCents: 5000,
    category: "cash_deposit",
    description: "Cash from family",
    transactedAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
    recordedBy: 7,
    recordedByName: "Alice S.",
    witnessedBy: null,
    witnessedByName: null,
    notes: null,
    receiptUri: null,
    reversesEntryId: null,
    reversedByEntryId: null,
    reversalReason: null,
    createdAt: Date.now() - 2 * 24 * 60 * 60 * 1000,
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

// ── 1. Feature-gated empty state ─────────────────────────────────────────────

describe("BillingContent — Trust tab feature gate", () => {
  it("shows the disabled card when RESIDENT_TRUST_ENABLED is not true", async () => {
    const qc = freshClient();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/reg-settings")) {
        return Promise.resolve(
          jsonResponse({
            success: true,
            data: [regSetting("RESIDENT_TRUST_ENABLED", "false")],
          }),
        );
      }
      return Promise.resolve(jsonResponse({ success: true, data: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = userEvent.setup();
    render(<BillingContent facilityNumber="197600001" />, {
      wrapper: wrapper(qc),
    });

    // Radix tabs interact via pointer events — fireEvent.click doesn't
    // change the active tab on its own. userEvent.click() emulates the
    // full pointer sequence.
    await user.click(await screen.findByTestId("billing-tab-trust"));
    expect(
      await screen.findByTestId("trust-feature-disabled"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Resident trust accounts are not enabled/i),
    ).toBeInTheDocument();
  });
});

// ── 2. Account list with formatted balance ───────────────────────────────────

describe("TrustAccountsTab — list renders", () => {
  it("renders the account list with the balance formatted as dollars", async () => {
    const qc = freshClient();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ success: true, data: [account()] }));
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TrustAccountsTab
        facilityNumber="197600001"
        dualSigRequired={true}
      />,
      { wrapper: wrapper(qc) },
    );

    expect(
      await screen.findByTestId("trust-accounts-list"),
    ).toBeInTheDocument();
    expect(screen.getByText("Jane Doe")).toBeInTheDocument();
    // The dollar value appears in both the row balance cell and the total
    // held tile — use getAllByText to confirm centsToDollars formatting
    // appears at least once.
    expect(screen.getAllByText("$1,250.00").length).toBeGreaterThanOrEqual(1);
    // Total held tile also uses centsToDollars.
    expect(screen.getByTestId("trust-total-held").textContent).toContain(
      "$1,250.00",
    );
  });

  it("opens the '+ Open account' dialog when the trigger is clicked", async () => {
    const qc = freshClient();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/residents")) {
        return Promise.resolve(
          jsonResponse({
            success: true,
            data: [
              {
                id: 99,
                firstName: "New",
                lastName: "Resident",
                status: "active",
              },
            ],
          }),
        );
      }
      return Promise.resolve(jsonResponse({ success: true, data: [] }));
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TrustAccountsTab
        facilityNumber="197600001"
        dualSigRequired={true}
      />,
      { wrapper: wrapper(qc) },
    );

    fireEvent.click(await screen.findByTestId("trust-open-trigger"));
    expect(
      await screen.findByTestId("trust-open-resident-select"),
    ).toBeInTheDocument();
  });
});

// ── 3. Dual-sig requirement: debit without witness blocked ───────────────────

describe("TrustAccountsTab — dual-sig enforcement on debit", () => {
  it("blocks save when debit lacks a witness and dual-sig is required", async () => {
    const qc = freshClient();
    const accountRow = account();
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/trust/accounts/1/ledger")) {
        return Promise.resolve(jsonResponse({ success: true, data: [] }));
      }
      if (url.includes("/trust/accounts/1/reconcile")) {
        return Promise.resolve(
          jsonResponse({
            success: true,
            data: { computedCents: 125000, cachedCents: 125000, drift: 0 },
          }),
        );
      }
      if (url.includes("/trust/accounts/1/statements")) {
        return Promise.resolve(jsonResponse({ success: true, data: [] }));
      }
      if (url.includes("/staff")) {
        return Promise.resolve(jsonResponse({ success: true, data: [] }));
      }
      if (url.includes("/facility/me")) {
        return Promise.resolve(
          jsonResponse({ id: 1, facilityNumber: "197600001", username: "x" }),
        );
      }
      // list of accounts
      return Promise.resolve(
        jsonResponse({ success: true, data: [accountRow] }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <TrustAccountsTab
        facilityNumber="197600001"
        dualSigRequired={true}
      />,
      { wrapper: wrapper(qc) },
    );

    // Click into the account detail.
    fireEvent.click(
      await screen.findByLabelText(/Open trust account for Jane Doe/i),
    );
    fireEvent.click(await screen.findByTestId("trust-add-ledger-trigger"));

    // Switch to debit
    fireEvent.click(
      await screen.findByTestId("trust-ledger-direction-debit"),
    );
    // Fill amount + description
    fireEvent.change(screen.getByTestId("trust-ledger-amount"), {
      target: { value: "25.00" },
    });
    fireEvent.change(screen.getByTestId("trust-ledger-description"), {
      target: { value: "Haircut" },
    });
    fireEvent.click(screen.getByTestId("trust-ledger-save"));

    await waitFor(() => {
      expect(
        screen.getByText(/A second staff witness is required for debits/i),
      ).toBeInTheDocument();
    });
    // No POST was issued because validation blocked.
    expect(mockApi).not.toHaveBeenCalled();
  });
});

// ── 4. Reversal POST ─────────────────────────────────────────────────────────

describe("TrustAccountsTab — reverse entry", () => {
  it("submits POST /api/ops/trust/ledger/:id/reverse with the reason", async () => {
    const qc = freshClient();
    const accountRow = account();
    const entry = ledgerEntry({ id: 555 });

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/trust/accounts/1/ledger")) {
        return Promise.resolve(
          jsonResponse({ success: true, data: [entry] }),
        );
      }
      if (url.includes("/trust/accounts/1/reconcile")) {
        return Promise.resolve(
          jsonResponse({
            success: true,
            data: { computedCents: 125000, cachedCents: 125000, drift: 0 },
          }),
        );
      }
      if (url.includes("/trust/accounts/1/statements")) {
        return Promise.resolve(jsonResponse({ success: true, data: [] }));
      }
      if (url.includes("/staff")) {
        return Promise.resolve(jsonResponse({ success: true, data: [] }));
      }
      return Promise.resolve(
        jsonResponse({ success: true, data: [accountRow] }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    mockApi.mockResolvedValue(jsonResponse({ success: true, data: entry }));

    render(
      <TrustAccountsTab
        facilityNumber="197600001"
        dualSigRequired={false}
      />,
      { wrapper: wrapper(qc) },
    );

    fireEvent.click(
      await screen.findByLabelText(/Open trust account for Jane Doe/i),
    );

    // Trigger reverse
    fireEvent.click(await screen.findByTestId("trust-reverse-555"));
    const reasonField = await screen.findByTestId("trust-reverse-reason");
    fireEvent.change(reasonField, { target: { value: "Duplicate entry" } });
    fireEvent.click(screen.getByTestId("trust-reverse-save"));

    await waitFor(() => {
      expect(mockApi).toHaveBeenCalledWith(
        "POST",
        "/api/ops/trust/ledger/555/reverse",
        expect.objectContaining({ reason: "Duplicate entry" }),
      );
    });
  });
});

// Re-export to silence the unused `within` import lint when not used.
void within;
