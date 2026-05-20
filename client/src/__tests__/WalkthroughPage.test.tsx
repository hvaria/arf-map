// WalkthroughPage tests — QA additions for CareFinder Phase 1.
//
// Acceptance criteria:
//   #1 first-visit shows 3 pagination dots + a card
//   #3 after "Get started" the seen flag is "1" and URL is /job-seeker
//   #4 returning with flag set redirects to /jobs; ?force=1 re-shows it
//
// Lives in client/src/__tests__/ so vitest.client.config.ts picks it up.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import WalkthroughPage from "../pages/jobseeker/WalkthroughPage";

// Stub framer-motion's AnimatePresence to a passthrough so we can assert
// on rendered slide content without waiting for keyframe-driven exit.
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// LocationProbe — a sibling component that records the current wouter
// location into a ref the test can read. Cleaner than poking at the
// memoryLocation hook directly (which fails outside a component).
function LocationProbe({ onPath }: { onPath: (p: string) => void }) {
  const [path] = useLocation();
  onPath(path);
  return null;
}

function renderWalkthrough(initialPath = "/") {
  const recorded: string[] = [];
  const { hook } = memoryLocation({ path: initialPath, record: true });
  const utils = render(
    <Router hook={hook}>
      <WalkthroughPage />
      <LocationProbe onPath={(p) => recorded.push(p)} />
    </Router>,
  );
  const lastPath = () => recorded[recorded.length - 1];
  return { ...utils, lastPath };
}

const WALKTHROUGH_SEEN_KEY = "seeker.walkthroughSeen";

describe("WalkthroughPage", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState(null, "", "/");
  });

  it("first-visit renders the first slide and 3 pagination dots", () => {
    renderWalkthrough("/");

    expect(screen.getByText(/find care jobs near you/i)).toBeInTheDocument();

    // The pagination dots are aria-hidden spans with .rounded-full.transition-all.
    // We look ONLY inside the WalkthroughPage's dot row container — selecting
    // the parent that contains the active 'w-6' dot is the most stable hook.
    const activeDot = document.querySelector(".w-6.bg-indigo-600");
    expect(activeDot).toBeTruthy();
    const dotRow = activeDot!.parentElement!;
    expect(dotRow.querySelectorAll(":scope > span").length).toBe(3);
  });

  it("after clicking 'Get started' sets the seen flag to '1' and navigates to /job-seeker", async () => {
    const { lastPath } = renderWalkthrough("/");

    await userEvent.click(screen.getByRole("button", { name: /get started/i }));

    expect(localStorage.getItem(WALKTHROUGH_SEEN_KEY)).toBe("1");
    expect(lastPath()).toBe("/job-seeker");
  });

  it("redirects to /jobs on mount when the seen flag is '1' and no ?force=1 is present", () => {
    localStorage.setItem(WALKTHROUGH_SEEN_KEY, "1");
    const { lastPath } = renderWalkthrough("/");

    expect(lastPath()).toBe("/jobs");
  });

  it("does NOT redirect when ?force=1 is set on the hash even if the seen flag is '1'", () => {
    localStorage.setItem(WALKTHROUGH_SEEN_KEY, "1");
    // Hash-routed app reads window.location.hash; the component's
    // readHashParams() inspects everything after the '?' inside the hash.
    window.history.replaceState(null, "", "/#/jobs/welcome?force=1");

    const { lastPath } = renderWalkthrough("/");

    expect(lastPath()).toBe("/"); // never bounced
    expect(screen.getByText(/find care jobs near you/i)).toBeInTheDocument();
  });
});
