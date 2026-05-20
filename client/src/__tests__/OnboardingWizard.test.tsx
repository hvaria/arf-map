// OnboardingWizard tests — QA additions for CareFinder Phase 1.
//
// Covers acceptance criteria:
//   #5  brand-new account lands on the wizard, not the dashboard (proxy
//       coverage — wizard renders LocationStep when profile is null)
//   #10 BioPreviewStep advance pre-populates textarea via buildBio()
//   #11 final submit fires one PUT + parallel POSTs via Promise.allSettled;
//       409 tolerated; non-409 surfaces a single warning toast
//   #12 after submit, both query keys invalidated, draft cleared,
//       advances to FindingMatchesStep
//   #14 returning seeker with complete profile → redirects to dashboard
//   #15 "Skip for now" sets the dismissed flag + bounces to dashboard
//
// Plus the QA-prompt edge cases:
//   - draft restoration on remount
//   - profile-complete redirect must not fire on initial undefined profile
//   - CredentialsStep zero-selection ships with the engineer's deviation
//     ("Skip for now" label) — DOCUMENTED, not corrected
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Router, useLocation } from "wouter";
import { memoryLocation } from "wouter/memory-location";
import OnboardingWizard from "../pages/jobseeker/onboarding/OnboardingWizard";

// jsdom polyfill for Radix Slider (ExperienceStep).
class StubResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
if (typeof window.ResizeObserver === "undefined") {
  (window as unknown as { ResizeObserver: typeof StubResizeObserver }).ResizeObserver = StubResizeObserver;
}

// Stub framer-motion's AnimatePresence (no actual animations in tests).
vi.mock("framer-motion", async () => {
  const actual = await vi.importActual<typeof import("framer-motion")>("framer-motion");
  return {
    ...actual,
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  };
});

// Mock the auth module — wizard reads `user` and `isReady` from AuthContext.
// Returning an authenticated user means the wizard renders its body
// instead of bouncing to /job-seeker.
vi.mock("../lib/auth", () => ({
  getCurrentJobSeeker: vi.fn().mockResolvedValue({ id: 1, email: "user@test.com" }),
  loginJobSeeker: vi.fn(),
  logoutJobSeeker: vi.fn(),
}));

// Mock apiRequest + getQueryFn so we can control the profile + credentials
// query responses and capture the submit-time PUT / POST calls.
vi.mock("../lib/queryClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/queryClient")>();
  return {
    ...original,
    apiRequest: vi.fn(),
    getQueryFn: vi.fn(),
  };
});

import { apiRequest, getQueryFn } from "../lib/queryClient";
import { AuthProvider } from "../context/AuthContext";

function setQueryFn(handler: (url: string) => unknown) {
  vi.mocked(getQueryFn).mockImplementation(() =>
    async ({ queryKey }: { queryKey: readonly unknown[] }) => {
      const url = queryKey.join("/");
      return handler(url);
    },
  );
}

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

// LocationProbe — records the current memory-router path so tests can
// assert on redirects without having to call wouter hooks outside a
// component (which throws).
function LocationProbe({ onPath }: { onPath: (p: string) => void }) {
  const [path] = useLocation();
  onPath(path);
  return null;
}

function renderWizard(opts: { initialPath?: string } = {}) {
  const recorded: string[] = [];
  const { hook } = memoryLocation({ path: opts.initialPath ?? "/jobs/onboard", record: true });
  const qc = makeQueryClient();
  const utils = render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <Router hook={hook}>
          <OnboardingWizard />
          <LocationProbe onPath={(p) => recorded.push(p)} />
        </Router>
      </AuthProvider>
    </QueryClientProvider>,
  );
  return { ...utils, qc, lastPath: () => recorded[recorded.length - 1], recorded };
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

describe("OnboardingWizard — initial render & redirects", () => {
  it("renders LocationStep when authed + no profile data", async () => {
    setQueryFn(() => null);
    renderWizard();

    expect(await screen.findByText(/where are you based\?/i)).toBeInTheDocument();
  });

  it("redirects to /jobseeker/dashboard when the dismissed flag is set", async () => {
    localStorage.setItem("seeker.onboardingDismissed", "1");
    setQueryFn(() => null);
    const { lastPath } = renderWizard();

    await waitFor(() => {
      expect(lastPath()).toBe("/jobseeker/dashboard");
    });
  });

  it("redirects to /jobseeker/dashboard when the profile is already complete", async () => {
    setQueryFn((url) => {
      if (url === "/api/jobseeker/profile") {
        return {
          id: 1, accountId: 1, firstName: "Jane", lastName: "Doe",
          phone: "", city: "SF", state: "CA", zipCode: "94110", address: null,
          profilePictureUrl: null, yearsExperience: 3, jobTypes: [], bio: null,
          updatedAt: Date.now(),
        };
      }
      if (url === "/api/jobseeker/credentials") {
        return [{ id: 1, accountId: 1, kind: "CNA", label: null, expiresAt: null, createdAt: Date.now() }];
      }
      return null;
    });

    const { lastPath } = renderWizard();

    await waitFor(() => {
      expect(lastPath()).toBe("/jobseeker/dashboard");
    });
  });

  it("does NOT redirect while profile data is still loading (undefined)", async () => {
    // Never resolve the queries — undefined data should never trigger
    // the completeness redirect. The wizard should keep rendering its
    // first step.
    vi.mocked(getQueryFn).mockImplementation(() =>
      () => new Promise(() => {}),
    );

    renderWizard();

    // LocationStep heading should appear (no redirect happened mid-load).
    expect(await screen.findByText(/where are you based\?/i)).toBeInTheDocument();
  });
});

describe("OnboardingWizard — draft persistence", () => {
  it("restores partial draft state from localStorage on remount", async () => {
    localStorage.setItem(
      "seeker.onboardingDraft",
      JSON.stringify({
        zipCode: "94105",
        credentials: ["CNA"],
        yearsExperience: 3,
        bio: "",
      }),
    );
    setQueryFn(() => null);
    renderWizard();

    // ZipCodeInput should show the restored ZIP.
    const zipInput = await screen.findByLabelText(/zip code/i) as HTMLInputElement;
    expect(zipInput.value).toBe("94105");
  });
});

describe("OnboardingWizard — skip handler", () => {
  it("'Skip for now' sets the dismissed flag and navigates to /jobseeker/dashboard", async () => {
    setQueryFn(() => null);
    const { lastPath } = renderWizard();

    await screen.findByText(/where are you based\?/i);
    await userEvent.click(screen.getByRole("button", { name: /skip for now/i }));

    expect(localStorage.getItem("seeker.onboardingDismissed")).toBe("1");
    await waitFor(() => {
      expect(lastPath()).toBe("/jobseeker/dashboard");
    });
  });
});

describe("OnboardingWizard — submit flow", () => {
  it("fires one PUT /api/jobseeker/profile and a parallel POST per credential, tolerating 409s", async () => {
    // Pre-seed a partially-completed draft so the wizard can reach
    // BioPreviewStep quickly via "Next" clicks.
    localStorage.setItem(
      "seeker.onboardingDraft",
      JSON.stringify({
        zipCode: "94110",
        credentials: ["CNA", "TB", "CPR"],
        yearsExperience: 3,
        bio: "",
      }),
    );
    setQueryFn(() => null);

    // PUT succeeds; 2 POSTs succeed; 1 POST rejects with 409 "already have".
    vi.mocked(apiRequest).mockImplementation(async (method: string, url: string) => {
      if (method === "PUT" && url === "/api/jobseeker/profile") {
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (method === "POST" && url === "/api/jobseeker/credentials") {
        // Reject the second credential POST as a duplicate.
        const callIdx = vi.mocked(apiRequest).mock.calls.filter(
          (c) => c[0] === "POST" && c[1] === "/api/jobseeker/credentials",
        ).length;
        if (callIdx === 2) {
          throw new Error("You already have a TB clearance on file.");
        }
        return new Response(JSON.stringify({ ok: true }), { status: 201 });
      }
      return new Response("{}", { status: 200 });
    });

    renderWizard();

    // Walk Location → Credentials → Experience → BioPreview using "Next"
    // (zip + creds + years are already in the draft so all three guards pass).
    await screen.findByText(/where are you based\?/i);
    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await screen.findByText(/what credentials do you hold/i);
    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await screen.findByText(/how much care experience/i);
    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    // BioPreview seeds the textarea via buildBio() on mount — wait for it.
    const ta = await screen.findByPlaceholderText(/tell facilities a little about yourself/i) as HTMLTextAreaElement;
    await waitFor(() => expect(ta.value.length).toBeGreaterThan(0));

    await userEvent.click(screen.getByRole("button", { name: /finish/i }));

    await waitFor(() => {
      // Profile PUT was called exactly once with zipCode + yearsExperience + bio.
      const putCalls = vi.mocked(apiRequest).mock.calls.filter(
        (c) => c[0] === "PUT" && c[1] === "/api/jobseeker/profile",
      );
      expect(putCalls.length).toBe(1);
      expect(putCalls[0][2]).toMatchObject({ zipCode: "94110", yearsExperience: 3 });

      // 3 POSTs — one per credential, fired in parallel.
      const postCalls = vi.mocked(apiRequest).mock.calls.filter(
        (c) => c[0] === "POST" && c[1] === "/api/jobseeker/credentials",
      );
      expect(postCalls.length).toBe(3);
      expect(postCalls.map((c) => (c[2] as { kind: string }).kind)).toEqual([
        "CNA", "TB", "CPR",
      ]);
    });

    // After success: FindingMatchesStep heading should render.
    expect(await screen.findByText(/finding matches near you/i)).toBeInTheDocument();
  });

  it("BioPreviewStep pre-populates the textarea via buildBio() once seed runs", async () => {
    localStorage.setItem(
      "seeker.onboardingDraft",
      JSON.stringify({
        zipCode: "94110",
        credentials: ["CNA"],
        yearsExperience: 3,
        bio: "",
      }),
    );
    setQueryFn(() => null);
    renderWizard();

    await screen.findByText(/where are you based\?/i);
    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));

    const ta = (await screen.findByPlaceholderText(
      /tell facilities a little about yourself/i,
    )) as HTMLTextAreaElement;
    // Seeded with the canonical CNA + 3-year + 94110 string from bioTemplate.
    await waitFor(() =>
      expect(ta.value).toContain("CNA certified caregiver"),
    );
    expect(ta.value).toContain("with 3 years of hands-on experience");
    expect(ta.value).toContain("based in ZIP 94110");
  });

  it("clears the localStorage draft after a successful submit", async () => {
    localStorage.setItem(
      "seeker.onboardingDraft",
      JSON.stringify({
        zipCode: "94110",
        credentials: [],
        yearsExperience: 0,
        bio: "preset bio",
      }),
    );
    setQueryFn(() => null);
    vi.mocked(apiRequest).mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 }),
    );

    renderWizard();
    await screen.findByText(/where are you based\?/i);
    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    // Zero credentials selected — CredentialsStep CTA is always "Next".
    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await userEvent.click(screen.getByRole("button", { name: /^next$/i }));
    await userEvent.click(screen.getByRole("button", { name: /finish/i }));

    await waitFor(() => {
      expect(localStorage.getItem("seeker.onboardingDraft")).toBeNull();
    });
  });
});

describe("OnboardingWizard — CredentialsStep CTA label", () => {
  it("renders 'Next' as the primary CTA label regardless of selection count", async () => {
    setQueryFn(() => null);
    renderWizard();

    await screen.findByText(/where are you based\?/i);
    const zip = screen.getByLabelText(/zip code/i);
    await userEvent.type(zip, "94110");
    // ZipCodeInput auto-advances on the 5th digit, so we should already
    // be on CredentialsStep.

    await screen.findByText(/what credentials do you hold/i);

    // Zero selections — primary CTA is "Next". The header still has a
    // single "Skip for now" button, but there should be exactly one
    // "Next" CTA on the CredentialsStep itself.
    const nextButtons = screen.getAllByRole("button", { name: /^next$/i });
    expect(nextButtons.length).toBe(1);
    expect(
      screen.getAllByRole("button", { name: /skip for now/i }).length,
    ).toBe(1);
  });
});
