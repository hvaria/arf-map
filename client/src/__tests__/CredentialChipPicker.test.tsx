// CredentialChipPicker tests — QA additions for CareFinder Phase 1.
//
// Acceptance criteria #8:
//   - 14 chips (OTHER excluded).
//   - Multi-select toggles add/remove from the value array.
//   - Selection count is visible.
//
// Lives in client/src/__tests__/ because vitest.client.config.ts only
// indexes that directory (see QA report — co-located client tests are
// silently ignored by `npm run test:client`).
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { CredentialKind } from "@shared/schema";
import { CredentialChipPicker } from "../components/jobseeker/CredentialChipPicker";

function Harness({
  onChangeSpy,
  initial = [],
}: {
  onChangeSpy?: (next: CredentialKind[]) => void;
  initial?: CredentialKind[];
}) {
  const [value, setValue] = useState<CredentialKind[]>(initial);
  return (
    <CredentialChipPicker
      value={value}
      onChange={(next) => {
        setValue(next);
        onChangeSpy?.(next);
      }}
    />
  );
}

describe("CredentialChipPicker", () => {
  it("renders exactly 14 chips and OTHER is not one of them", () => {
    render(<Harness />);
    const group = screen.getByRole("group", { name: /credentials/i });
    const buttons = group.querySelectorAll("button");
    expect(buttons.length).toBe(14);
    expect(screen.queryByRole("button", { name: /^other$/i })).not.toBeInTheDocument();
  });

  it("toggles a chip from unselected to selected on first click and writes the kind into onChange", async () => {
    const onChange = vi.fn();
    render(<Harness onChangeSpy={onChange} />);

    const cna = screen.getByRole("button", { name: /^cna$/i });
    expect(cna).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(cna);

    expect(cna).toHaveAttribute("aria-pressed", "true");
    expect(onChange).toHaveBeenCalledWith(["CNA"]);
  });

  it("removes a chip from the selection when clicked again (deselect)", async () => {
    const onChange = vi.fn();
    render(<Harness onChangeSpy={onChange} initial={["CNA"]} />);

    const cna = screen.getByRole("button", { name: /^cna$/i });
    expect(cna).toHaveAttribute("aria-pressed", "true");

    await userEvent.click(cna);

    expect(onChange).toHaveBeenLastCalledWith([]);
    expect(cna).toHaveAttribute("aria-pressed", "false");
  });

  it("supports multi-select — clicking multiple chips collects all of them", async () => {
    const onChange = vi.fn();
    render(<Harness onChangeSpy={onChange} />);

    await userEvent.click(screen.getByRole("button", { name: /^cna$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^lvn$/i }));
    await userEvent.click(screen.getByRole("button", { name: /tb clearance/i }));

    expect(onChange).toHaveBeenLastCalledWith(["CNA", "LVN", "TB"]);
  });

  it("shows the count of selected items", async () => {
    render(<Harness />);
    expect(screen.getByText(/0 selected/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^cna$/i }));
    expect(screen.getByText(/1 selected/i)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^lvn$/i }));
    expect(screen.getByText(/2 selected/i)).toBeInTheDocument();
  });

  it("does not render any chip whose kind is OTHER (defensive)", () => {
    render(<Harness />);
    const group = screen.getByRole("group", { name: /credentials/i });
    const allLabels = Array.from(group.querySelectorAll("button")).map(
      (b) => b.getAttribute("aria-label"),
    );
    expect(allLabels).not.toContain("Other");
  });
});
