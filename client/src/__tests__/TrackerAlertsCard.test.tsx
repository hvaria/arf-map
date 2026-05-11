/**
 * Bug #2 — "View all" → slug-filtered alerts list on TrackerAlertsCard.
 *
 * Acceptance criteria covered here (component-level):
 *   • When `slug` is set, the card title reads "Active alerts — {trackerName}".
 *   • A filter chip with the tracker name + X button renders above the list.
 *   • Clicking the chip's X calls `onClearFilter`.
 *   • The `slug` prop is forwarded to the underlying `useTrackerAlerts`
 *     filter — proof that the server fetch is actually scoped.
 *   • When filtered and the server returns zero items, the existing
 *     "All clear" empty state renders.
 *   • When `slug` is unset, the title reverts to the default "Tracker alerts"
 *     and no chip renders.
 *
 * Out of scope here (covered manually in the OperationsTab wire-up):
 *   • scrollIntoView and sub-view unwind — those live in OperationsTab.
 *   • cross-navigation persistence — exercised manually.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { createRef } from "react";

// ── Hook mocks ──────────────────────────────────────────────────────────────
// The card pulls 4 hooks: useTrackerAlerts, useTrackerDefinitions,
// useResidents, and the two mutation hooks. We mock just what's needed.

const useTrackerAlertsSpy = vi.fn();
vi.mock("../lib/tracker/useTrackerAlerts", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/tracker/useTrackerAlerts")
  >("../lib/tracker/useTrackerAlerts");
  return {
    ...actual,
    useTrackerAlerts: (...args: unknown[]) => useTrackerAlertsSpy(...args),
  };
});

vi.mock("../lib/tracker/useTrackerDefinitions", () => ({
  useTrackerDefinitions: () => ({
    data: {
      data: [
        { slug: "vitals", name: "Vitals", shortName: "Vitals" },
        { slug: "adl", name: "Activities of Daily Living", shortName: "ADL" },
      ],
    },
  }),
}));

vi.mock("../hooks/useResidents", () => ({
  useResidents: () => ({ residents: [] }),
}));

vi.mock("../lib/tracker/useTrackerAlertMutation", () => ({
  useAcknowledgeAlert: () => ({ mutate: vi.fn(), isPending: false }),
  useResolveAlert: () => ({ mutate: vi.fn(), isPending: false }),
}));

import { TrackerAlertsCard } from "../components/tracker/TrackerAlertsCard";

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

beforeEach(() => {
  cleanup();
  useTrackerAlertsSpy.mockReset();
});

describe("Bug #2: TrackerAlertsCard slug filtering", () => {
  it("shows the default 'Tracker alerts' title when no slug is passed", () => {
    useTrackerAlertsSpy.mockReturnValue({
      data: { success: true, data: { items: [] } },
      isLoading: false,
      isError: false,
    });
    wrap(<TrackerAlertsCard facilityNumber="000000001" />);
    expect(screen.getByText(/^Tracker alerts$/)).toBeDefined();
    // No chip when unfiltered.
    expect(screen.queryByText(/Filtered/i)).toBeNull();
  });

  it("shows the filtered title 'Active alerts — Vitals' when slug=vitals", () => {
    useTrackerAlertsSpy.mockReturnValue({
      data: { success: true, data: { items: [] } },
      isLoading: false,
      isError: false,
    });
    wrap(
      <TrackerAlertsCard
        facilityNumber="000000001"
        slug="vitals"
        onClearFilter={vi.fn()}
      />,
    );
    expect(screen.getByText(/Active alerts — Vitals/i)).toBeDefined();
  });

  it("renders a filter chip with the tracker display name when filtered", () => {
    useTrackerAlertsSpy.mockReturnValue({
      data: { success: true, data: { items: [] } },
      isLoading: false,
      isError: false,
    });
    wrap(
      <TrackerAlertsCard
        facilityNumber="000000001"
        slug="vitals"
        onClearFilter={vi.fn()}
      />,
    );
    // "Filtered" label
    expect(screen.getByText("Filtered")).toBeDefined();
    // Chip text appears (title plus chip). Verify the chip's X button exists.
    expect(
      screen.getByRole("button", { name: /Clear Vitals filter/i }),
    ).toBeDefined();
  });

  it("falls back to the raw slug when the tracker definition can't be looked up", () => {
    useTrackerAlertsSpy.mockReturnValue({
      data: { success: true, data: { items: [] } },
      isLoading: false,
      isError: false,
    });
    wrap(
      <TrackerAlertsCard
        facilityNumber="000000001"
        slug="unknown-slug"
        onClearFilter={vi.fn()}
      />,
    );
    expect(screen.getByText(/Active alerts — unknown-slug/i)).toBeDefined();
  });

  it("calls onClearFilter when the chip's X button is clicked", async () => {
    useTrackerAlertsSpy.mockReturnValue({
      data: { success: true, data: { items: [] } },
      isLoading: false,
      isError: false,
    });
    const onClear = vi.fn();
    wrap(
      <TrackerAlertsCard
        facilityNumber="000000001"
        slug="vitals"
        onClearFilter={onClear}
      />,
    );
    const x = screen.getByRole("button", { name: /Clear Vitals filter/i });
    await userEvent.click(x);
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("forwards the slug to useTrackerAlerts so the API request is scoped", () => {
    useTrackerAlertsSpy.mockReturnValue({
      data: { success: true, data: { items: [] } },
      isLoading: false,
      isError: false,
    });
    wrap(
      <TrackerAlertsCard
        facilityNumber="000000001"
        slug="vitals"
        onClearFilter={vi.fn()}
      />,
    );

    // The hook receives (filters, options). The slug must show up in filters.
    const lastCall =
      useTrackerAlertsSpy.mock.calls[useTrackerAlertsSpy.mock.calls.length - 1];
    expect(lastCall).toBeDefined();
    const [filters] = lastCall as [Record<string, unknown>];
    expect(filters.slug).toBe("vitals");
  });

  it("renders the 'All clear' empty state when filtered and the server returns zero items", () => {
    useTrackerAlertsSpy.mockReturnValue({
      data: { success: true, data: { items: [] } },
      isLoading: false,
      isError: false,
    });
    wrap(
      <TrackerAlertsCard
        facilityNumber="000000001"
        slug="vitals"
        onClearFilter={vi.fn()}
      />,
    );
    expect(screen.getByText(/All clear/i)).toBeDefined();
    expect(
      screen.getByText(/No active tracker alerts/i),
    ).toBeDefined();
  });

  it("does not render a chip when onClearFilter is omitted (defensive guard)", () => {
    useTrackerAlertsSpy.mockReturnValue({
      data: { success: true, data: { items: [] } },
      isLoading: false,
      isError: false,
    });
    wrap(<TrackerAlertsCard facilityNumber="000000001" slug="vitals" />);
    // No chip — the X needs a handler to be meaningful.
    expect(screen.queryByText("Filtered")).toBeNull();
  });

  it("forwards a ref to the root <section> so OperationsTab can scrollIntoView", () => {
    useTrackerAlertsSpy.mockReturnValue({
      data: { success: true, data: { items: [] } },
      isLoading: false,
      isError: false,
    });
    const ref = createRef<HTMLDivElement>();
    wrap(
      <TrackerAlertsCard
        ref={ref}
        facilityNumber="000000001"
      />,
    );
    expect(ref.current).not.toBeNull();
    // The ref must resolve to a real HTMLElement so OperationsTab can call
    // scrollIntoView on it. jsdom doesn't implement scrollIntoView itself —
    // assert the element shape instead.
    expect(ref.current).toBeInstanceOf(HTMLElement);
    expect(ref.current?.tagName).toBe("SECTION");
  });
});
