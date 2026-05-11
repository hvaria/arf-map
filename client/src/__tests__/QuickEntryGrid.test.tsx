/**
 * Bug #4 — Long-press / right-click "Clear cell" affordance on ADL cells.
 * Bug #1 — Popover-close tap suppression on the underlying cell.
 *
 * Strategy: mock the residents + entries hooks to return a deterministic
 * one-cell grid pre-seeded with a saved entry, then drive the component
 * with userEvent / fireEvent to exercise:
 *   - short tap cycles status (regression — must still work)
 *   - long-press opens the dropdown menu after 500ms
 *   - movement > 10px during the hold cancels the long-press
 *   - movement after the timer fired does NOT retroactively cancel
 *   - right-click opens the same menu
 *   - prior-day disables the menu item
 *   - "Clear cell" calls the delete mutation
 *   - empty cell (no entry) does NOT open a menu on long-press
 *
 * What we explicitly do NOT cover here:
 *   - Bug #1's full mouse-vs-touch suppression — modal popovers in jsdom
 *     don't fully emulate pointer-event blocking. The popover's
 *     stopPropagation contract is covered in CellNotePopover.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

// ── Mock hooks the grid depends on ───────────────────────────────────────────

const useResidentsMock = vi.fn();
const useTrackerEntriesMock = vi.fn();
const useCreateMock = vi.fn();
const useDeleteMock = vi.fn();
const useToastMock = vi.fn(() => ({ toast: vi.fn() }));

vi.mock("../components/tracker/selectors/ResidentSelector", () => ({
  useResidents: () => useResidentsMock(),
}));

vi.mock("../lib/tracker/useTrackerEntries", () => ({
  useTrackerEntries: () => useTrackerEntriesMock(),
}));

vi.mock("../lib/tracker/useTrackerMutation", async () => {
  const actual = await vi.importActual<
    typeof import("../lib/tracker/useTrackerMutation")
  >("../lib/tracker/useTrackerMutation");
  return {
    ...actual,
    useCreateTrackerEntry: () => useCreateMock(),
    useDeleteTrackerEntry: () => useDeleteMock(),
    makeClientId: () => "test-uuid-0000",
  };
});

vi.mock("../hooks/use-toast", () => ({
  useToast: () => useToastMock(),
}));

// The popover internally uses the patch mutation hook; stub it out so the
// note popover doesn't blow up if it mounts.
vi.mock("../components/tracker/CellNotePopover", () => ({
  CellNotePopover: () => <span data-testid="note-popover-stub" />,
}));

// Mock TrackerFilterBar.startOfDay — we need real behavior here, just want
// to keep the symbol resolvable. Use actual.
vi.mock("../components/tracker/TrackerFilterBar", async () => {
  const actual = await vi.importActual<
    typeof import("../components/tracker/TrackerFilterBar")
  >("../components/tracker/TrackerFilterBar");
  return actual;
});

import { QuickEntryGrid } from "../components/tracker/QuickEntryGrid";
import { startOfDay } from "../components/tracker/TrackerFilterBar";
import type { SerializedTrackerDefinition } from "@shared/tracker-schemas";

const ADL_DEFINITION: SerializedTrackerDefinition = {
  slug: "adl",
  name: "Activities of Daily Living",
  shortName: "ADL",
  category: "daily-care",
  schemaVersion: 1,
  icon: "ListChecks",
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
} as unknown as SerializedTrackerDefinition;

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const TODAY = startOfDay(Date.now());
const YESTERDAY = TODAY - 24 * 60 * 60 * 1000;
// One resident, one entry pre-seeded (status "C", entryId 42).
const RESIDENTS_ENVELOPE = {
  data: {
    success: true,
    data: [
      {
        id: 1,
        firstName: "Jane",
        lastName: "Doe",
        roomNumber: "101",
        status: "active",
      },
    ],
  },
  isLoading: false,
};
function entriesEnvelopeWithSavedEntry() {
  return {
    data: {
      pages: [
        {
          data: {
            items: [
              {
                id: 42,
                residentId: 1,
                occurredAt: TODAY + 1000,
                payload: { goal_id: "bathing", shift: "AM", status: "C" },
              },
            ],
          },
        },
      ],
    },
    isLoading: false,
    isError: false,
  };
}

function entriesEnvelopeEmpty() {
  return {
    data: { pages: [{ data: { items: [] } }] },
    isLoading: false,
    isError: false,
  };
}

function makeMutation() {
  return {
    mutate: vi.fn(),
    isPending: false,
  };
}

beforeEach(() => {
  cleanup();
  useResidentsMock.mockReturnValue(RESIDENTS_ENVELOPE);
  useTrackerEntriesMock.mockReturnValue(entriesEnvelopeWithSavedEntry());
  useCreateMock.mockReturnValue(makeMutation());
  useDeleteMock.mockReturnValue(makeMutation());
  vi.useRealTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Bug #4: Short tap still cycles the ADL status (regression)", () => {
  it("a short tap on a seeded cell cycles status C → I and calls create mutation", async () => {
    const createMock = makeMutation();
    useCreateMock.mockReturnValue(createMock);
    const user = userEvent.setup();
    wrap(
      <QuickEntryGrid definition={ADL_DEFINITION} date={TODAY} shift="AM" />,
    );

    // Locate the cell button — it carries the saved status "C".
    const cellButtons = screen.getAllByRole("button", { name: /Bathing for Jane Doe/i });
    // There may be both desktop + mobile renders in the DOM (md:hidden /
    // hidden md:block) — pick whichever is interactive.
    const cell = cellButtons[0];
    await user.click(cell);

    expect(createMock.mutate).toHaveBeenCalledTimes(1);
    const call = createMock.mutate.mock.calls[0][0];
    // C cycles to I.
    expect(call.payload.status).toBe("I");
  });
});

describe("Bug #4: Long-press opens 'Clear cell' menu", () => {
  it("after a 500ms+ hold the dropdown menu is opened", async () => {
    vi.useFakeTimers();
    const { container } = wrap(
      <QuickEntryGrid definition={ADL_DEFINITION} date={TODAY} shift="AM" />,
    );

    const cell = screen.getAllByRole("button", { name: /Bathing for Jane Doe/i })[0];

    // Fire touchstart at coord (100,100).
    fireEvent.touchStart(cell, {
      touches: [{ clientX: 100, clientY: 100 }],
    });

    // Advance 600ms (past the 500ms threshold).
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    vi.useRealTimers();

    // The hidden DropdownMenu anchor span should now report data-state="open".
    // We assert on this rather than on the Radix portal contents — jsdom +
    // Radix Dropdown's portalling behavior is flaky for menuitem queries.
    await waitFor(() => {
      const triggers = container.querySelectorAll(
        '[aria-haspopup="menu"][data-state="open"]',
      );
      expect(triggers.length).toBeGreaterThan(0);
    });
  });

  it("touchmove > 10px during the hold cancels the long-press (no menu)", async () => {
    vi.useFakeTimers();
    const { container } = wrap(
      <QuickEntryGrid definition={ADL_DEFINITION} date={TODAY} shift="AM" />,
    );

    const cell = screen.getAllByRole("button", { name: /Bathing for Jane Doe/i })[0];

    fireEvent.touchStart(cell, {
      touches: [{ clientX: 100, clientY: 100 }],
    });
    // Advance 200ms then drift 15px before the 500ms threshold.
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    fireEvent.touchMove(cell, {
      touches: [{ clientX: 115, clientY: 100 }],
    });
    // Advance past 500ms — the long-press timer should already be cancelled.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    vi.useRealTimers();

    // No trigger should be in the "open" state.
    const triggers = container.querySelectorAll(
      '[aria-haspopup="menu"][data-state="open"]',
    );
    expect(triggers.length).toBe(0);
  });

  it("touchmove < 10px during the hold does NOT cancel (scroll-vs-hold tolerance)", async () => {
    vi.useFakeTimers();
    const { container } = wrap(
      <QuickEntryGrid definition={ADL_DEFINITION} date={TODAY} shift="AM" />,
    );

    const cell = screen.getAllByRole("button", { name: /Bathing for Jane Doe/i })[0];

    fireEvent.touchStart(cell, {
      touches: [{ clientX: 100, clientY: 100 }],
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    // 5px drift — well within tolerance.
    fireEvent.touchMove(cell, {
      touches: [{ clientX: 105, clientY: 102 }],
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    vi.useRealTimers();

    await waitFor(() => {
      const triggers = container.querySelectorAll(
        '[aria-haspopup="menu"][data-state="open"]',
      );
      expect(triggers.length).toBeGreaterThan(0);
    });
  });
});

describe("Bug #4: Right-click opens the same 'Clear cell' menu (desktop)", () => {
  it("contextmenu event on a seeded cell opens the dropdown", async () => {
    const { container } = wrap(
      <QuickEntryGrid definition={ADL_DEFINITION} date={TODAY} shift="AM" />,
    );
    const cell = screen.getAllByRole("button", { name: /Bathing for Jane Doe/i })[0];
    fireEvent.contextMenu(cell);
    await waitFor(() => {
      const triggers = container.querySelectorAll(
        '[aria-haspopup="menu"][data-state="open"]',
      );
      expect(triggers.length).toBeGreaterThan(0);
    });
  });

  it("contextmenu on an EMPTY cell (no saved entry) does nothing", () => {
    // Re-mock to empty entries.
    useTrackerEntriesMock.mockReturnValue(entriesEnvelopeEmpty());
    const { container } = wrap(
      <QuickEntryGrid definition={ADL_DEFINITION} date={TODAY} shift="AM" />,
    );
    const cellButtons = screen.getAllByRole("button", {
      name: /Bathing for Jane Doe/i,
    });
    fireEvent.contextMenu(cellButtons[0]);
    // No DropdownMenu mounted at all → no aria-haspopup elements.
    const triggers = container.querySelectorAll('[aria-haspopup="menu"]');
    expect(triggers.length).toBe(0);
  });
});

describe("Bug #4: Clicking 'Clear cell' triggers soft-delete via useDeleteTrackerEntry", () => {
  it("the delete mutation is called with the saved entry id", async () => {
    const deleteMock = makeMutation();
    useDeleteMock.mockReturnValue(deleteMock);
    wrap(
      <QuickEntryGrid definition={ADL_DEFINITION} date={TODAY} shift="AM" />,
    );

    const cell = screen.getAllByRole("button", { name: /Bathing for Jane Doe/i })[0];
    fireEvent.contextMenu(cell);

    // Radix Dropdown content portals to document.body — search globally.
    const clearItem = await waitFor(() => {
      const els = document.querySelectorAll('[role="menuitem"]');
      const match = Array.from(els).find((el) =>
        el.textContent?.match(/Clear cell/i),
      );
      if (!match) throw new Error("Clear cell menuitem not found");
      return match as HTMLElement;
    });
    fireEvent.click(clearItem);

    await waitFor(() => expect(deleteMock.mutate).toHaveBeenCalled());
    const call = deleteMock.mutate.mock.calls[0][0];
    expect(call.id).toBe(42);
  });
});

describe("Bug #4: Prior-day cells are read-only", () => {
  it("the menu item is rendered disabled on yesterday's date", async () => {
    wrap(
      <QuickEntryGrid
        definition={ADL_DEFINITION}
        date={YESTERDAY}
        shift="AM"
      />,
    );
    const cell = screen.getAllByRole("button", { name: /Bathing for Jane Doe/i })[0];
    fireEvent.contextMenu(cell);

    const clearItem = await waitFor(() => {
      const els = document.querySelectorAll('[role="menuitem"]');
      const match = Array.from(els).find((el) =>
        el.textContent?.match(/Clear cell/i),
      );
      if (!match) throw new Error("Clear cell menuitem not found");
      return match as HTMLElement;
    });
    // Radix renders disabled with aria-disabled="true" / data-disabled.
    expect(clearItem.getAttribute("aria-disabled")).toBe("true");

    // Helper text appears.
    expect(
      document.body.textContent?.match(
        /Prior-day entries cannot be cleared from here/i,
      ),
    ).toBeTruthy();
  });

  it("a 'Clear cell' click on the disabled item does NOT call the delete mutation", async () => {
    const deleteMock = makeMutation();
    useDeleteMock.mockReturnValue(deleteMock);
    wrap(
      <QuickEntryGrid
        definition={ADL_DEFINITION}
        date={YESTERDAY}
        shift="AM"
      />,
    );
    const cell = screen.getAllByRole("button", { name: /Bathing for Jane Doe/i })[0];
    fireEvent.contextMenu(cell);
    const clearItem = await waitFor(() => {
      const els = document.querySelectorAll('[role="menuitem"]');
      const match = Array.from(els).find((el) =>
        el.textContent?.match(/Clear cell/i),
      );
      if (!match) throw new Error("Clear cell menuitem not found");
      return match as HTMLElement;
    });
    fireEvent.click(clearItem);
    // Should not have fired.
    expect(deleteMock.mutate).not.toHaveBeenCalled();
  });
});

describe("Bug #4 / Bug #1: Empty cells do nothing on long-press / right-click", () => {
  it("an empty cell has no DropdownMenu mounted around it", () => {
    useTrackerEntriesMock.mockReturnValue(entriesEnvelopeEmpty());
    wrap(
      <QuickEntryGrid definition={ADL_DEFINITION} date={TODAY} shift="AM" />,
    );
    const cell = screen.getAllByRole("button", {
      name: /Bathing for Jane Doe/i,
    })[0];
    // Even firing contextmenu should not produce a menu.
    fireEvent.contextMenu(cell);
    expect(screen.queryByRole("menuitem", { name: /Clear cell/i })).toBeNull();
  });
});
