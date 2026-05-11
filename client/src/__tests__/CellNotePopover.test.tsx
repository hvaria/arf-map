/**
 * Bug #1 — Cancel click on the cell-note popover must NOT bubble through to
 * the ADL cell underneath and silently cycle its status.
 *
 * The component-level defense is:
 *   1. `e.stopPropagation()` on the Cancel button's onClick AND onPointerDown.
 *   2. `onAfterClose` callback fires whenever the popover closes (via any
 *      means — Cancel, save, outside-click, ESC) so the parent grid can stamp
 *      a "just closed" timestamp and reject taps that arrive within ~150ms.
 *
 * The grid-side suppression timer is exercised in QuickEntryGrid.test.tsx.
 * Here we verify the popover's contract.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";

vi.mock("../lib/queryClient", () => ({
  apiRequest: vi.fn(async () => ({
    ok: true,
    status: 200,
    json: async () => ({ success: true, data: { id: 99, payload: {} } }),
  })),
}));

// Toast is rendered through a context — silence in tests.
vi.mock("../hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

import { CellNotePopover } from "../components/tracker/CellNotePopover";

function wrap(node: ReactNode) {
  const qc = new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
  return render(<QueryClientProvider client={qc}>{node}</QueryClientProvider>);
}

const DEFAULT_PROPS = {
  slug: "adl",
  entryId: 99,
  note: null,
  existingPayload: { goal_id: "bathing", shift: "AM", status: "C" } as Record<
    string,
    unknown
  >,
  residentName: "Doe, Jane",
  goalLabel: "Bathing",
  statusLabel: "Completed",
  shift: "AM",
};

beforeEach(() => {
  cleanup();
});

describe("Bug #1: CellNotePopover Cancel click does not leak through", () => {
  it("renders the sticky-note trigger button with the correct ARIA label", () => {
    const onSaved = vi.fn();
    const onAfterClose = vi.fn();
    wrap(
      <CellNotePopover
        {...DEFAULT_PROPS}
        onSaved={onSaved}
        onAfterClose={onAfterClose}
      />,
    );
    expect(
      screen.getByRole("button", { name: /Add note for Doe, Jane/i }),
    ).toBeDefined();
  });

  it("stops propagation on the trigger button's click so the cell underneath does not cycle", () => {
    let cellTapsFired = 0;
    const onSaved = vi.fn();
    const onAfterClose = vi.fn();
    wrap(
      // Wrap in a parent that listens for click — mirrors the cell button
      // capturing taps on the visible area beneath the icon.
      <button
        type="button"
        onClick={() => {
          cellTapsFired += 1;
        }}
        data-testid="cell-underneath"
      >
        <CellNotePopover
          {...DEFAULT_PROPS}
          onSaved={onSaved}
          onAfterClose={onAfterClose}
        />
      </button>,
    );

    const trigger = screen.getByRole("button", {
      name: /Add note for Doe, Jane/i,
    });
    fireEvent.click(trigger);
    // The cell underneath must not have received a synthetic click.
    expect(cellTapsFired).toBe(0);
  });

  it("Cancel button has onClick AND onPointerDown handlers that stop propagation (Bug #1 defenses)", async () => {
    // Direct contract check: open the popover, locate the Cancel button,
    // and verify a click event dispatched on it does NOT bubble to a parent
    // listener. This is the bug fix's whole job — stop the bubble.
    const onSaved = vi.fn();
    const onAfterClose = vi.fn();
    const user = userEvent.setup();

    let parentClicked = 0;
    let parentPointerDown = 0;
    render(
      <QueryClientProvider client={new QueryClient()}>
        <div
          data-testid="parent-cell"
          onClick={() => {
            parentClicked += 1;
          }}
          onPointerDown={() => {
            parentPointerDown += 1;
          }}
        >
          <CellNotePopover
            {...DEFAULT_PROPS}
            onSaved={onSaved}
            onAfterClose={onAfterClose}
          />
        </div>
      </QueryClientProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: /Add note for Doe, Jane/i }),
    );
    const cancel = await screen.findByRole("button", { name: /Cancel/ });
    const baselineClicks = parentClicked;
    const baselinePointerDowns = parentPointerDown;
    fireEvent.pointerDown(cancel);
    fireEvent.click(cancel);
    // Radix uses portal — but if propagation happened, React's synthetic
    // event would still travel to the portal-source parent.
    expect(parentClicked - baselineClicks).toBe(0);
    expect(parentPointerDown - baselinePointerDowns).toBe(0);
  });

  it("invokes onAfterClose when the popover is dismissed via outside-click (ESC) — proves the suppression is not Cancel-only", async () => {
    const onSaved = vi.fn();
    const onAfterClose = vi.fn();
    const user = userEvent.setup();

    wrap(
      <CellNotePopover
        {...DEFAULT_PROPS}
        onSaved={onSaved}
        onAfterClose={onAfterClose}
      />,
    );

    await user.click(
      screen.getByRole("button", { name: /Add note for Doe, Jane/i }),
    );
    await screen.findByRole("button", { name: /Cancel/ });
    // ESC closes the popover.
    await user.keyboard("{Escape}");
    expect(onAfterClose).toHaveBeenCalled();
  });

  it("does NOT invoke onAfterClose on initial render (popover starts closed)", () => {
    const onSaved = vi.fn();
    const onAfterClose = vi.fn();
    wrap(
      <CellNotePopover
        {...DEFAULT_PROPS}
        onSaved={onSaved}
        onAfterClose={onAfterClose}
      />,
    );
    // The popover never opened — no close callback should fire.
    expect(onAfterClose).not.toHaveBeenCalled();
  });

  it("Cancel button's onPointerDown also stops propagation (touch path)", async () => {
    let underneathPointerDown = 0;
    const onSaved = vi.fn();
    const onAfterClose = vi.fn();
    const user = userEvent.setup();

    wrap(
      <div
        onPointerDown={() => {
          underneathPointerDown += 1;
        }}
        data-testid="cell-area"
      >
        <CellNotePopover
          {...DEFAULT_PROPS}
          onSaved={onSaved}
          onAfterClose={onAfterClose}
        />
      </div>,
    );

    await user.click(
      screen.getByRole("button", { name: /Add note for Doe, Jane/i }),
    );
    const cancel = await screen.findByRole("button", { name: /Cancel/ });

    // Snapshot the count before Cancel — the trigger click + Radix portal
    // mounting may have fired some pointerdowns; we only care about the
    // INCREMENT during the Cancel interaction.
    const before = underneathPointerDown;
    fireEvent.pointerDown(cancel);
    expect(underneathPointerDown - before).toBe(0);
  });
});
