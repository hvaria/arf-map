// FindingMatchesStep tests — QA additions for CareFinder Phase 1.
//
// Acceptance criteria #13: skeleton + spinner render for ~1500ms then
// replace-navigate to /jobseeker/dashboard.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import FindingMatchesStep from "../pages/jobseeker/onboarding/steps/FindingMatchesStep";

// Stub framer-motion (no real animations in tests).
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    motion: new Proxy(
      {},
      {
        get: () => (props: any) => <div {...props}>{props.children}</div>,
      },
    ),
  };
});

function LocationProbe({ onPath }: { onPath: (p: string) => void }) {
  const [path] = useLocation();
  onPath(path);
  return null;
}

function renderStep(initialPath = "/jobs/onboard") {
  const recorded: string[] = [];
  const { hook } = memoryLocation({ path: initialPath, record: true });
  const utils = render(
    <Router hook={hook}>
      <FindingMatchesStep />
      <LocationProbe onPath={(p) => recorded.push(p)} />
    </Router>,
  );
  return { ...utils, lastPath: () => recorded[recorded.length - 1] };
}

describe("FindingMatchesStep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("renders the skeleton + spinner copy on mount", () => {
    renderStep();
    expect(screen.getByText(/finding matches near you/i)).toBeInTheDocument();
    expect(screen.getByText(/we're lining up roles/i)).toBeInTheDocument();
  });

  it("does NOT redirect before 1500ms have elapsed", () => {
    const { lastPath } = renderStep();
    act(() => {
      vi.advanceTimersByTime(1499);
    });
    expect(lastPath()).toBe("/jobs/onboard");
  });

  it("replace-navigates to /jobseeker/dashboard at 1500ms", () => {
    const { lastPath } = renderStep();
    act(() => {
      vi.advanceTimersByTime(1500);
    });
    expect(lastPath()).toBe("/jobseeker/dashboard");
  });
});
