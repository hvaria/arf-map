// AuthContext.logout — onboarding cleanup test.
//
// Acceptance criteria #16: logout() must clear
// `seeker.onboardingDismissed` and `seeker.onboardingDraft` from
// localStorage so a different account on the same device gets a fresh
// onboarding pass.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider, useAuth } from "../context/AuthContext";

// Mock the auth module so we don't hit any network.
vi.mock("../lib/auth", () => ({
  getCurrentJobSeeker: vi.fn().mockResolvedValue({ id: 1, email: "user@test.com" }),
  loginJobSeeker: vi.fn(),
  logoutJobSeeker: vi.fn().mockResolvedValue(undefined),
}));

function LogoutButton() {
  const { logout } = useAuth();
  return (
    <button type="button" onClick={() => logout()}>
      sign out
    </button>
  );
}

function renderWithProviders() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <LogoutButton />
      </AuthProvider>
    </QueryClientProvider>,
  );
}

describe("AuthContext.logout — onboarding key cleanup", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("clears seeker.onboardingDismissed and seeker.onboardingDraft from localStorage", async () => {
    localStorage.setItem("seeker.onboardingDismissed", "1");
    localStorage.setItem(
      "seeker.onboardingDraft",
      JSON.stringify({ zipCode: "94110", credentials: ["CNA"] }),
    );

    renderWithProviders();

    await userEvent.click(await screen.findByRole("button", { name: /sign out/i }));

    await waitFor(() => {
      expect(localStorage.getItem("seeker.onboardingDismissed")).toBeNull();
      expect(localStorage.getItem("seeker.onboardingDraft")).toBeNull();
    });
  });

  it("does not throw if neither key was set in the first place", async () => {
    renderWithProviders();
    await userEvent.click(await screen.findByRole("button", { name: /sign out/i }));
    await waitFor(() => {
      // No assertions on the keys — they were never present. The success
      // condition is simply that the click completed without an error.
      expect(localStorage.getItem("seeker.onboardingDismissed")).toBeNull();
    });
  });
});
