/**
 * Frontend tests for the job seeker registration → verification → profile flow.
 *
 * API calls are mocked so these tests run without a server.
 * The key behaviors under test:
 *   1. After OTP verification succeeds, the user lands on the dashboard (not auth form).
 *   2. When no profile exists, the profile editor opens automatically.
 *   3. ProfileEditor renders without crashing when passed a null profile.
 *   4. Profile save calls the correct endpoint.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import JobSeekerPage from "../pages/JobSeekerPage";

// ── Mock modules ──────────────────────────────────────────────────────────────

// Mock the facilities data import (large JSON, not needed for these tests)
vi.mock("../data/facilities.json", () => ({ default: [] }));

// Mock apiRequest so we never hit the network
vi.mock("../lib/queryClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/queryClient")>();
  return {
    ...original,
    apiRequest: vi.fn(),
    // Override getQueryFn to control what /api/jobseeker/me returns
    getQueryFn: vi.fn(({ on401 }: { on401: string }) =>
      async ({ queryKey }: { queryKey: readonly unknown[] }) => {
        const url = queryKey.join("/");
        if (url === "/api/jobseeker/me") return null; // not logged in by default
        if (url === "/api/jobseeker/profile") return null; // no profile by default
        if (url === "/api/jobs") return [];
        return null;
      },
    ),
  };
});

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

function renderPage(queryClient = makeQueryClient()) {
  return render(
    <QueryClientProvider client={queryClient}>
      <JobSeekerPage />
    </QueryClientProvider>,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("JobSeekerPage — auth flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows the login/register form when unauthenticated", async () => {
    renderPage();
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: /sign in/i })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: /create account/i })).toBeInTheDocument();
    });
  });

  it("transitions to the OTP screen after registration", async () => {
    const { apiRequest, getQueryFn } = await import("../lib/queryClient");
    vi.mocked(apiRequest).mockResolvedValueOnce(
      new Response(JSON.stringify({ emailSent: true, needsVerification: true, id: 1 }), { status: 201 }),
    );

    renderPage();

    // Switch to Create Account tab
    await waitFor(() => screen.getByRole("tab", { name: /create account/i }));
    await userEvent.click(screen.getByRole("tab", { name: /create account/i }));

    // Fill out registration form
    const emailInputs = screen.getAllByPlaceholderText(/you@email.com/i);
    await userEvent.type(emailInputs[emailInputs.length - 1], "test@example.com");
    await userEvent.type(screen.getByPlaceholderText(/at least 8 characters/i), "Password1!");
    await userEvent.type(screen.getByPlaceholderText(/repeat password/i), "Password1!");

    await userEvent.click(screen.getByRole("button", { name: /create account/i }));

    await waitFor(() => {
      expect(screen.getByText(/check your email/i)).toBeInTheDocument();
    });
  });

  it("after verify-email success, shows dashboard — NOT the login/register form", async () => {
    const { apiRequest, getQueryFn } = await import("../lib/queryClient");

    // Simulate: user is on the verify screen (state managed by the page)
    // We mock the verify-email response to return account data
    vi.mocked(apiRequest).mockResolvedValue(
      new Response(JSON.stringify({ ok: true, id: 42, email: "test@example.com" }), { status: 200 }),
    );

    // Override getQueryFn: /me returns null at first (pre-verification)
    // After setQueryData from onSuccess, the cache will have the account
    vi.mocked(getQueryFn).mockImplementation(({ on401 }: { on401: string }) =>
      async ({ queryKey }: { queryKey: readonly unknown[] }) => {
        const url = queryKey.join("/");
        if (url === "/api/jobseeker/profile") return null;
        if (url === "/api/jobs") return [];
        return null;
      },
    );

    const qc = makeQueryClient();
    renderPage(qc);

    // Navigate to verify screen via registration
    vi.mocked(apiRequest).mockResolvedValueOnce(
      new Response(JSON.stringify({ emailSent: true, needsVerification: true, id: 1 }), { status: 201 }),
    );

    await waitFor(() => screen.getByRole("tab", { name: /create account/i }));
    await userEvent.click(screen.getByRole("tab", { name: /create account/i }));
    const emailInputs = screen.getAllByPlaceholderText(/you@email.com/i);
    await userEvent.type(emailInputs[emailInputs.length - 1], "test@example.com");
    await userEvent.type(screen.getByPlaceholderText(/at least 8 characters/i), "Password1!");
    await userEvent.type(screen.getByPlaceholderText(/repeat password/i), "Password1!");
    await userEvent.click(screen.getByRole("button", { name: /create account/i }));
    await waitFor(() => screen.getByText(/check your email/i));

    // Mock the verify-email call to return account info
    vi.mocked(apiRequest).mockResolvedValueOnce({
      json: async () => ({ ok: true, id: 42, email: "test@example.com" }),
    } as unknown as Response);

    // Enter OTP and submit
    const otpInput = screen.getByPlaceholderText("123456");
    await userEvent.type(otpInput, "123456");
    await userEvent.click(screen.getByRole("button", { name: /verify email/i }));

    // After success: should NOT show the login/register tabs
    await waitFor(() => {
      expect(screen.queryByRole("tab", { name: /sign in/i })).not.toBeInTheDocument();
      expect(screen.queryByRole("tab", { name: /create account/i })).not.toBeInTheDocument();
    });
  });
});

describe("Dashboard — profile behaviour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-opens the profile editor when no profile exists", async () => {
    const { getQueryFn } = await import("../lib/queryClient");

    // User is authenticated; profile is null (first-time user)
    vi.mocked(getQueryFn).mockImplementation(({ on401 }: { on401: string }) =>
      async ({ queryKey }: { queryKey: readonly unknown[] }) => {
        const url = queryKey.join("/");
        if (url === "/api/jobseeker/me") return { id: 1, email: "user@test.com" };
        if (url === "/api/jobseeker/profile") return null; // no profile
        if (url === "/api/jobs") return [];
        return null;
      },
    );

    renderPage();

    // Profile editor should auto-open — look for a characteristic field
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Jane/i)).toBeInTheDocument(); // First Name field
    });

    // Should NOT be on the auth screen
    expect(screen.queryByRole("tab", { name: /sign in/i })).not.toBeInTheDocument();
  });

  it("profile editor renders without crashing when profile is null", async () => {
    const { getQueryFn } = await import("../lib/queryClient");

    vi.mocked(getQueryFn).mockImplementation(() =>
      async ({ queryKey }: { queryKey: readonly unknown[] }) => {
        const url = queryKey.join("/");
        if (url === "/api/jobseeker/me") return { id: 1, email: "user@test.com" };
        if (url === "/api/jobseeker/profile") return null;
        if (url === "/api/jobs") return [];
        return null;
      },
    );

    expect(() => renderPage()).not.toThrow();

    await waitFor(() => {
      // "Save Profile" button is present in the editor
      expect(screen.getByRole("button", { name: /save profile/i })).toBeInTheDocument();
    });
  });

  it("profile editor renders existing profile data without crashing", async () => {
    const { getQueryFn } = await import("../lib/queryClient");

    vi.mocked(getQueryFn).mockImplementation(() =>
      async ({ queryKey }: { queryKey: readonly unknown[] }) => {
        const url = queryKey.join("/");
        if (url === "/api/jobseeker/me") return { id: 1, email: "user@test.com" };
        if (url === "/api/jobseeker/profile") return {
          id: 10,
          accountId: 1,
          firstName: "Jane",
          lastName: "Smith",
          phone: "5305550100",
          city: "Sacramento",
          state: "CA",
          zipCode: "95814",
          address: null,
          profilePictureUrl: null,
          yearsExperience: 3,
          jobTypes: ["Caregiver"],
          bio: null,
          updatedAt: Date.now(),
        };
        if (url === "/api/jobs") return [];
        return null;
      },
    );

    renderPage();

    // With an existing profile, the dashboard view (not editor) should show
    await waitFor(() => {
      expect(screen.getByText("Jane Smith")).toBeInTheDocument();
    });

    // The profile editor should NOT be auto-opened
    expect(screen.queryByRole("button", { name: /save profile/i })).not.toBeInTheDocument();
  });

  it("profile save calls PUT /api/jobseeker/profile with correct data", async () => {
    const { getQueryFn, apiRequest } = await import("../lib/queryClient");

    vi.mocked(getQueryFn).mockImplementation(() =>
      async ({ queryKey }: { queryKey: readonly unknown[] }) => {
        const url = queryKey.join("/");
        if (url === "/api/jobseeker/me") return { id: 1, email: "user@test.com" };
        if (url === "/api/jobseeker/profile") return null;
        if (url === "/api/jobs") return [];
        return null;
      },
    );

    vi.mocked(apiRequest).mockResolvedValue(
      new Response(
        JSON.stringify({ id: 10, accountId: 1, firstName: "Jane", lastName: "", city: "", state: "", zipCode: "", phone: "", profilePictureUrl: null, yearsExperience: null, jobTypes: [], bio: null, updatedAt: Date.now() }),
        { status: 200 },
      ),
    );

    renderPage();

    await waitFor(() => screen.getByPlaceholderText(/Jane/i));

    // Type a first name and save
    const firstNameInput = screen.getByPlaceholderText(/Jane/i);
    await userEvent.clear(firstNameInput);
    await userEvent.type(firstNameInput, "Alice");

    await userEvent.click(screen.getByRole("button", { name: /save profile/i }));

    await waitFor(() => {
      expect(apiRequest).toHaveBeenCalledWith(
        "PUT",
        "/api/jobseeker/profile",
        expect.objectContaining({ firstName: "Alice" }),
      );
    });
  });
});
