// InstallAppBanner tests — verifies the suppression rules (Capacitor,
// PWA, desktop, dismissed) and the two render modes (iOS instructions
// dialog vs Android native prompt). Lives in client/src/__tests__/ to
// match the vitest.client.config.ts include pattern.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { InstallAppBanner } from "../components/InstallAppBanner";
import {
  __setCachedPromptEventForTests,
  clearInstallPromptDismissal,
  dismissInstallPrompt,
} from "../lib/installApp";

// User-agent strings for the three environments we test.
const UA_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const UA_ANDROID_CHROME =
  "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36";
const UA_DESKTOP =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

function setUserAgent(ua: string) {
  Object.defineProperty(navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

function setMatchMedia(standalone: boolean) {
  Object.defineProperty(window, "matchMedia", {
    value: (query: string) => ({
      matches: query.includes("standalone") ? standalone : false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }),
    configurable: true,
    writable: true,
  });
}

function deleteCapacitor() {
  // `delete window.Capacitor` — guarded for environments that already
  // have the property defined non-configurable.
  try {
    delete (window as Window & { Capacitor?: unknown }).Capacitor;
  } catch {
    /* ignore */
  }
}

beforeEach(() => {
  // Reset all environment surfaces to a "mobile browser, fresh visit"
  // baseline so each test only has to override what it cares about.
  setUserAgent(UA_IPHONE);
  setMatchMedia(false);
  deleteCapacitor();
  clearInstallPromptDismissal();
  __setCachedPromptEventForTests(null);
});

afterEach(() => {
  // Clear any pending dismissal between tests so they don't bleed.
  clearInstallPromptDismissal();
  __setCachedPromptEventForTests(null);
});

describe("InstallAppBanner — suppression rules", () => {
  it("does NOT render when running inside the Capacitor WebView", () => {
    // @ts-expect-error — Capacitor injects an opaque object at runtime
    window.Capacitor = { getPlatform: () => "android" };
    render(<InstallAppBanner />);
    expect(screen.queryByLabelText(/install arf map app/i)).not.toBeInTheDocument();
  });

  it("does NOT render when the page is already an installed PWA", () => {
    setMatchMedia(true);
    render(<InstallAppBanner />);
    expect(screen.queryByLabelText(/install arf map app/i)).not.toBeInTheDocument();
  });

  it("does NOT render on desktop browsers", () => {
    setUserAgent(UA_DESKTOP);
    render(<InstallAppBanner />);
    expect(screen.queryByLabelText(/install arf map app/i)).not.toBeInTheDocument();
  });

  it("does NOT render while a recent dismissal is still in its hide-window", () => {
    setUserAgent(UA_IPHONE);
    dismissInstallPrompt(14);
    render(<InstallAppBanner />);
    expect(screen.queryByLabelText(/install arf map app/i)).not.toBeInTheDocument();
  });
});

describe("InstallAppBanner — iOS mode", () => {
  it("renders the banner on iOS Safari", () => {
    setUserAgent(UA_IPHONE);
    render(<InstallAppBanner />);
    expect(screen.getByLabelText(/install arf map app/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /^install$/i }),
    ).toBeInTheDocument();
  });

  it("opens the Add-to-Home-Screen instructions dialog when 'Install' is tapped", async () => {
    setUserAgent(UA_IPHONE);
    render(<InstallAppBanner />);
    await userEvent.click(screen.getByRole("button", { name: /^install$/i }));
    expect(
      screen.getByText(/add arf map to your home screen/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/share button/i)).toBeInTheDocument();
    expect(screen.getByText(/add to home screen/i)).toBeInTheDocument();
  });

  it("'Don't show again' inside the iOS dialog persists dismissal and hides the banner", async () => {
    setUserAgent(UA_IPHONE);
    render(<InstallAppBanner />);
    await userEvent.click(screen.getByRole("button", { name: /^install$/i }));
    await userEvent.click(screen.getByRole("button", { name: /don't show again/i }));
    // framer-motion's AnimatePresence keeps the node during the exit
    // animation — wait for the eventual unmount rather than asserting
    // synchronously.
    await waitFor(() => {
      expect(
        screen.queryByLabelText(/install arf map app/i),
      ).not.toBeInTheDocument();
    });
    // Persisted dismissal survives a fresh mount.
    expect(
      localStorage.getItem("app.installPromptDismissedUntil"),
    ).not.toBeNull();
  });
});

describe("InstallAppBanner — Android Chrome mode", () => {
  it("does NOT render until Chrome fires beforeinstallprompt", () => {
    setUserAgent(UA_ANDROID_CHROME);
    render(<InstallAppBanner />);
    // The event hasn't fired — banner stays hidden so the Install
    // button isn't dead on tap.
    expect(screen.queryByLabelText(/install arf map app/i)).not.toBeInTheDocument();
  });

  it("renders the banner once Chrome's beforeinstallprompt event arrives", () => {
    setUserAgent(UA_ANDROID_CHROME);
    render(<InstallAppBanner />);
    act(() => {
      // Simulate Chrome's event arriving after first paint.
      __setCachedPromptEventForTests({
        platforms: ["web"],
        userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
        prompt: () => Promise.resolve(),
      } as unknown as Event & {
        platforms: string[];
        userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
        prompt(): Promise<void>;
      });
    });
    expect(screen.getByLabelText(/install arf map app/i)).toBeInTheDocument();
  });

  it("calls the cached prompt's prompt() when the user taps Install", async () => {
    setUserAgent(UA_ANDROID_CHROME);
    const promptFn = vi.fn(() => Promise.resolve());
    render(<InstallAppBanner />);
    act(() => {
      __setCachedPromptEventForTests({
        platforms: ["web"],
        userChoice: Promise.resolve({ outcome: "accepted", platform: "web" }),
        prompt: promptFn,
      } as unknown as Event & {
        platforms: string[];
        userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
        prompt(): Promise<void>;
      });
    });
    await userEvent.click(screen.getByRole("button", { name: /^install$/i }));
    expect(promptFn).toHaveBeenCalledTimes(1);
  });
});

describe("InstallAppBanner — dismissal", () => {
  it("hides the banner and writes the dismissal-until key when X is tapped", async () => {
    setUserAgent(UA_IPHONE);
    render(<InstallAppBanner />);
    expect(screen.getByLabelText(/install arf map app/i)).toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: /dismiss install prompt for 14 days/i }),
    );
    // AnimatePresence keeps the node during the exit animation.
    await waitFor(() => {
      expect(
        screen.queryByLabelText(/install arf map app/i),
      ).not.toBeInTheDocument();
    });
    const until = localStorage.getItem("app.installPromptDismissedUntil");
    expect(until).not.toBeNull();
    expect(Date.parse(until!) > Date.now()).toBe(true);
  });
});
