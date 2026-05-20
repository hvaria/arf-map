// ExperienceStep tests — QA additions for CareFinder Phase 1.
//
// Acceptance criteria #9: the slider snaps to one of 4 buckets,
// [0, 1, 3, 5]. We verify by reading the value the step writes through
// onChange at each slider position.
import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import ExperienceStep from "../pages/jobseeker/onboarding/steps/ExperienceStep";

// jsdom does not implement ResizeObserver; Radix Slider needs it.
beforeAll(() => {
  if (typeof window.ResizeObserver === "undefined") {
    class StubResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
    (window as unknown as { ResizeObserver: typeof StubResizeObserver }).ResizeObserver = StubResizeObserver;
  }
  // Radix Slider also calls getBoundingClientRect; jsdom returns zeros
  // which is fine for our keyboard-driven tests.
});

function Harness({ onChangeSpy }: { onChangeSpy: (n: number | null) => void }) {
  const [years, setYears] = useState<number | null>(null);
  return (
    <ExperienceStep
      value={{ yearsExperience: years }}
      onChange={({ yearsExperience: y }) => {
        setYears(y);
        onChangeSpy(y);
      }}
      onNext={() => {}}
      onBack={() => {}}
    />
  );
}

describe("ExperienceStep — bucketed slider", () => {
  it("renders the 'Just starting' label at the default index 0", () => {
    const onChange = vi.fn();
    render(<Harness onChangeSpy={onChange} />);

    // Two copies render: the big centered label + the bottom tick row.
    expect(screen.getAllByText(/just starting/i).length).toBeGreaterThanOrEqual(1);
  });

  it("snaps to [0, 1, 3, 5] when navigating right via the keyboard", async () => {
    const onChange = vi.fn();
    render(<Harness onChangeSpy={onChange} />);

    // Radix Slider exposes its thumb with role="slider".
    const slider = screen.getByRole("slider");
    slider.focus();

    // Right-arrow increments by `step` (1) until max (3). Each step maps
    // through BUCKET_VALUES[i] in the implementation.
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(1);

    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(3);

    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(5);

    // Going past max stays at the last bucket.
    await userEvent.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(5);
  });

  it("returns to the lower buckets when navigating left from the maximum", async () => {
    const onChange = vi.fn();
    render(<Harness onChangeSpy={onChange} />);

    const slider = screen.getByRole("slider");
    slider.focus();

    // Walk all the way up first.
    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith(5);

    // Then back down.
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith(3);
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith(1);
    await userEvent.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it("never produces a value outside the [0, 1, 3, 5] bucket set", async () => {
    const onChange = vi.fn();
    render(<Harness onChangeSpy={onChange} />);
    const slider = screen.getByRole("slider");
    slider.focus();

    await userEvent.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}{ArrowLeft}{ArrowLeft}{ArrowLeft}");

    const seen = new Set<number | null>();
    onChange.mock.calls.forEach((c) => seen.add(c[0] as number));
    seen.forEach((v) => {
      expect([0, 1, 3, 5]).toContain(v);
    });
  });
});
