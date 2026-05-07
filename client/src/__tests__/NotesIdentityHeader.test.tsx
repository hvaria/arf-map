/**
 * NotesIdentityHeader tests.
 *
 * Covers:
 *   - Both variants render with the expected structural shape.
 *   - The gradient background (canonical visual token) is applied verbatim.
 *   - Descriptor flips on `urgentCount > 0`.
 *   - leftSlot / rightSlot render contents correctly.
 *   - "Team notes" heading text is constant across variants.
 */
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

import { NotesIdentityHeader } from "../components/notes/NotesIdentityHeader";

// JSDOM normalizes hex to rgb when reading inline styles via .style, so we
// match against both equivalent forms. The stops + angle stay byte-identical.
const GRADIENT_HEX = "linear-gradient(120deg, #EEF2FF 0%, #FFF0F6 100%)";
const GRADIENT_RGB =
  "linear-gradient(120deg, rgb(238, 242, 255) 0%, rgb(255, 240, 246) 100%)";

function isCanonicalGradient(value: string): boolean {
  return value.includes(GRADIENT_HEX) || value.includes(GRADIENT_RGB);
}

afterEach(() => {
  cleanup();
});

describe("NotesIdentityHeader", () => {
  it("renders the canonical 'Team notes' heading and default descriptor in compact variant", () => {
    render(
      <NotesIdentityHeader
        variant="compact"
        facilityNumber="197600123"
      />,
    );
    const node = screen.getByTestId("notes-identity-header");
    expect(node).toHaveAttribute("data-variant", "compact");
    expect(screen.getByText("Team notes")).toBeInTheDocument();
    expect(
      screen.getByText("Shift handoffs, memos, and follow-ups"),
    ).toBeInTheDocument();
    // Compact variant must NOT include the facility-number suffix.
    expect(screen.queryByText(/Facility #/)).not.toBeInTheDocument();
  });

  it("applies the canonical gradient inline style on both variants", () => {
    const { rerender } = render(
      <NotesIdentityHeader variant="compact" facilityNumber="F1" />,
    );
    let node = screen.getByTestId("notes-identity-header");
    expect(isCanonicalGradient(node.style.background)).toBe(true);

    rerender(<NotesIdentityHeader variant="expanded" facilityNumber="F1" />);
    node = screen.getByTestId("notes-identity-header");
    expect(isCanonicalGradient(node.style.background)).toBe(true);
  });

  it("flips the descriptor when urgentCount > 0", () => {
    render(
      <NotesIdentityHeader
        variant="expanded"
        facilityNumber="F1"
        urgentCount={4}
      />,
    );
    expect(
      screen.getByText("4 urgent · awaiting acknowledgement"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Shift handoffs, memos, and follow-ups"),
    ).not.toBeInTheDocument();
  });

  it("renders facility-number suffix only on expanded variant", () => {
    render(
      <NotesIdentityHeader variant="expanded" facilityNumber="197600999" />,
    );
    expect(screen.getByText(/Facility #197600999/)).toBeInTheDocument();
  });

  it("renders leftSlot and rightSlot when provided", () => {
    render(
      <NotesIdentityHeader
        variant="expanded"
        facilityNumber="F1"
        leftSlot={<button data-testid="ls">left</button>}
        rightSlot={<a data-testid="rs" href="#x">right</a>}
      />,
    );
    expect(screen.getByTestId("ls")).toBeInTheDocument();
    expect(screen.getByTestId("rs")).toBeInTheDocument();
  });
});
