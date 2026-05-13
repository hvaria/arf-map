/**
 * NotesPage tests.
 *
 * Covers:
 *   - Auth gate: an unauthenticated session redirects to /facility-portal.
 *   - Authenticated render path: NotesPageShell mounts.
 *   - Slice 2: the `notes_dedicated_page` flag, when false, redirects an
 *     authenticated user to /facility-portal; when true, the shell renders.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Mock wouter's useLocation to capture navigate calls.
const navigateMock = vi.fn();
vi.mock("wouter", () => ({
  useLocation: () => ["/facility-portal/notes", navigateMock],
}));

// Mock react-query so we can drive the /api/facility/me response shape.
vi.mock("@tanstack/react-query", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...original,
    useQuery: vi.fn(),
  };
});

// Stub the shell — we're not testing its internals here.
vi.mock("@/components/notes/NotesPageShell", () => ({
  NotesPageShell: ({ facilityNumber }: { facilityNumber: string }) => (
    <div data-testid="notes-page-shell">Shell for {facilityNumber}</div>
  ),
}));

// Mock the feature-flag hook so we can drive its return value per test.
const useFeatureFlagMock = vi.fn(() => true);
vi.mock("@/lib/featureFlags", () => ({
  useFeatureFlag: () => useFeatureFlagMock(),
}));

import { useQuery } from "@tanstack/react-query";
import NotesPage from "../pages/notes/NotesPage";
import type { FacilitySubscription } from "../lib/subscription";

// Default active subscription — most tests want the happy path where the
// Operations paywall gate (Phase 0) lets the user through. The subscription-
// gate test cases below override this to assert the locked-out behaviour.
const ACTIVE_SUBSCRIPTION: FacilitySubscription = {
  status: "active",
  currentPeriodEnd: null,
  cancelAtPeriodEnd: false,
  planId: null,
  latestInvoiceUrl: null,
  lastFour: null,
  cardBrand: null,
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NotesPage />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default to the flag being ON so existing auth-gate tests still see the
  // shell rendering as before.
  useFeatureFlagMock.mockReturnValue(true);
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("NotesPage — auth gate", () => {
  it("redirects to /facility-portal when /api/facility/me returns null (401)", async () => {
    vi.mocked(useQuery).mockReturnValue({
      data: null,
      isLoading: false,
    } as unknown as ReturnType<typeof useQuery>);

    renderPage();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/facility-portal", {
        replace: true,
      });
    });
  });

  it("does NOT redirect while the auth query is still loading", async () => {
    vi.mocked(useQuery).mockReturnValue({
      data: null,
      isLoading: true,
    } as unknown as ReturnType<typeof useQuery>);

    renderPage();

    await new Promise((r) => setTimeout(r, 50));

    expect(navigateMock).not.toHaveBeenCalled();
  });

  it("renders NotesPageShell with the facility number when authenticated", async () => {
    vi.mocked(useQuery).mockReturnValue({
      data: {
        id: 1,
        facilityNumber: "197600123",
        username: "owner@facility.com",
        email: "owner@facility.com",
        emailVerified: 1,
        subscription: ACTIVE_SUBSCRIPTION,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useQuery>);

    const { getByTestId } = renderPage();

    await waitFor(() => {
      expect(getByTestId("notes-page-shell")).toHaveTextContent(
        "Shell for 197600123",
      );
    });

    expect(navigateMock).not.toHaveBeenCalled();
  });
});

describe("NotesPage — Slice 2 beta-flag gate", () => {
  it("redirects an authenticated user to /facility-portal when the flag is OFF", async () => {
    useFeatureFlagMock.mockReturnValue(false);
    vi.mocked(useQuery).mockReturnValue({
      data: {
        id: 1,
        facilityNumber: "197600123",
        username: "owner@facility.com",
        email: "owner@facility.com",
        emailVerified: 1,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useQuery>);

    const { queryByTestId } = renderPage();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/facility-portal", {
        replace: true,
      });
    });

    // Shell must NOT render while flag is off.
    expect(queryByTestId("notes-page-shell")).not.toBeInTheDocument();
  });

  it("renders the shell when the flag is ON for an authenticated user", async () => {
    useFeatureFlagMock.mockReturnValue(true);
    vi.mocked(useQuery).mockReturnValue({
      data: {
        id: 1,
        facilityNumber: "197600123",
        username: "owner@facility.com",
        email: "owner@facility.com",
        emailVerified: 1,
        subscription: ACTIVE_SUBSCRIPTION,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useQuery>);

    const { getByTestId } = renderPage();

    await waitFor(() => {
      expect(getByTestId("notes-page-shell")).toBeInTheDocument();
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("NotesPage — Phase 0 paywall gate", () => {
  it("redirects to /facility-portal?paywall=1 when subscription is null", async () => {
    useFeatureFlagMock.mockReturnValue(true);
    vi.mocked(useQuery).mockReturnValue({
      data: {
        id: 1,
        facilityNumber: "197600123",
        username: "owner@facility.com",
        email: "owner@facility.com",
        emailVerified: 1,
        subscription: null,
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useQuery>);

    const { queryByTestId } = renderPage();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/facility-portal?paywall=1", {
        replace: true,
      });
    });

    // Shell must NOT render while the user is paywalled.
    expect(queryByTestId("notes-page-shell")).not.toBeInTheDocument();
  });

  it("redirects when subscription.status is past_due", async () => {
    useFeatureFlagMock.mockReturnValue(true);
    vi.mocked(useQuery).mockReturnValue({
      data: {
        id: 1,
        facilityNumber: "197600123",
        username: "owner@facility.com",
        email: "owner@facility.com",
        emailVerified: 1,
        subscription: { ...ACTIVE_SUBSCRIPTION, status: "past_due" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useQuery>);

    renderPage();

    await waitFor(() => {
      expect(navigateMock).toHaveBeenCalledWith("/facility-portal?paywall=1", {
        replace: true,
      });
    });
  });

  it("renders the shell when subscription.status is trialing", async () => {
    useFeatureFlagMock.mockReturnValue(true);
    vi.mocked(useQuery).mockReturnValue({
      data: {
        id: 1,
        facilityNumber: "197600123",
        username: "owner@facility.com",
        email: "owner@facility.com",
        emailVerified: 1,
        subscription: { ...ACTIVE_SUBSCRIPTION, status: "trialing" },
      },
      isLoading: false,
    } as unknown as ReturnType<typeof useQuery>);

    const { getByTestId } = renderPage();

    await waitFor(() => {
      expect(getByTestId("notes-page-shell")).toBeInTheDocument();
    });
    expect(navigateMock).not.toHaveBeenCalled();
  });
});
