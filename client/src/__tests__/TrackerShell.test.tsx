/**
 * Bug #6 — "New entry" button visibility per tab.
 *
 * The shell passes `onNewEntry` to TrackerHeader only when the tracker
 * supports a Detailed mode AND the active tab is NOT already "detailed".
 * That collapses the redundancy: on the Detailed tab the form itself is
 * the entry surface — the button would just be a no-op back-link.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { TrackerShell } from "../components/tracker/TrackerShell";
import type {
  SerializedTrackerDefinition,
  TrackerMode,
} from "@shared/tracker-schemas";

// The shell renders QuickEntryGrid / DetailedEntryForm / HistoryTab inside.
// We only care about the header in this test — stub the tab bodies so the
// test doesn't have to wire up residents / entries queries.
vi.mock("../components/tracker/QuickEntryGrid", () => ({
  QuickEntryGrid: () => <div data-testid="quick-grid" />,
}));
vi.mock("../components/tracker/DetailedEntryForm", () => ({
  DetailedEntryForm: () => <div data-testid="detailed-form" />,
}));
vi.mock("../components/tracker/HistoryTab", () => ({
  HistoryTab: () => <div data-testid="history" />,
}));
vi.mock("../components/tracker/TrackerFilterBar", async () => {
  const actual = await vi.importActual<
    typeof import("../components/tracker/TrackerFilterBar")
  >("../components/tracker/TrackerFilterBar");
  return {
    ...actual,
    TrackerFilterBar: () => <div data-testid="filter-bar" />,
  };
});

const DEFINITION: SerializedTrackerDefinition = {
  slug: "adl",
  name: "Activities of Daily Living",
  shortName: "ADL",
  category: "daily-care",
  schemaVersion: 1,
  icon: "ListChecks",
  description: "Quick smoke",
  modes: ["quick", "detailed", "history"],
  defaultMode: "quick",
  requiresResident: true,
  supportsBulk: true,
  shiftAware: true,
  quickGrid: {
    rowSource: "goals-inline",
    rows: [{ id: "bathing", label: "Bathing" }],
    columnSource: "residents",
    cellCycle: ["C", "I", "NA"],
    cellLabels: { C: "Completed", I: "Incomplete", NA: "Not Applicable" },
    cellColors: { C: "success", I: "warn", NA: "muted" },
  },
  detailedFields: [],
  // History summary is a function on the live definition but never used here.
} as unknown as SerializedTrackerDefinition;

function makeQc() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderShell(tab: TrackerMode, def = DEFINITION) {
  return render(
    <QueryClientProvider client={makeQc()}>
      <TrackerShell
        definition={def}
        tab={tab}
        onTabChange={vi.fn()}
        filters={{ date: 0, shift: "AM", residentId: undefined }}
        onFiltersChange={vi.fn()}
        onBack={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  cleanup();
});

describe("Bug #6: 'New entry' button visibility per tab", () => {
  it("shows 'New entry' on the Quick tab (tracker supports detailed mode)", () => {
    renderShell("quick");
    expect(
      screen.queryByRole("button", { name: /add new .* entry/i }),
    ).not.toBeNull();
  });

  it("shows 'New entry' on the History tab", () => {
    renderShell("history");
    expect(
      screen.queryByRole("button", { name: /add new .* entry/i }),
    ).not.toBeNull();
  });

  it("HIDES 'New entry' on the Detailed tab (the bug fix)", () => {
    renderShell("detailed");
    expect(
      screen.queryByRole("button", { name: /add new .* entry/i }),
    ).toBeNull();
  });

  it("never shows 'New entry' for trackers that don't support a Detailed mode", () => {
    const quickOnly = {
      ...DEFINITION,
      modes: ["quick", "history"] as TrackerMode[],
      defaultMode: "quick" as TrackerMode,
    } as unknown as SerializedTrackerDefinition;
    renderShell("quick", quickOnly);
    expect(
      screen.queryByRole("button", { name: /add new .* entry/i }),
    ).toBeNull();
  });
});
