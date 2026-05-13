/**
 * OperationsPaywall tests — Phase 1.
 *
 * Covers:
 *   - Status-specific alerts (past_due, canceled, unpaid) — unchanged from
 *     Phase 0 contract.
 *   - CTA is enabled (Phase 0 disabled-state assertion removed) and POSTs
 *     to `/api/billing/checkout` with the CSRF sentinel header.
 *   - On `200 { url }`, the browser redirects to the returned URL via
 *     `window.location.href = url`.
 *   - On `503` (STRIPE_NOT_CONFIGURED), an inline "unavailable" alert is
 *     shown — non-retryable until ops fixes the env.
 *   - On other failures, an inline retry alert is shown.
 *   - While the request is in flight, the button is disabled and shows a
 *     loading state.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import {
  render,
  screen,
  cleanup,
  fireEvent,
  waitFor,
} from "@testing-library/react";

import { OperationsPaywall } from "../components/billing/OperationsPaywall";
import { OPERATIONS_PRO_PRICE_LABEL } from "../lib/subscription";
import type { FacilitySubscription } from "../lib/subscription";

// Mock the toast hook — we don't assert on it directly, but the component
// imports it and we don't want a real Provider in these tests.
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function sub(
  status: FacilitySubscription["status"],
): FacilitySubscription {
  return {
    status,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    planId: null,
    latestInvoiceUrl: null,
    lastFour: null,
    cardBrand: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test helpers
// ─────────────────────────────────────────────────────────────────────────────

interface LocationSpy {
  readonly assigned: string | null;
  restore: () => void;
}

/**
 * Spy on `window.location.href` writes without actually navigating the
 * JSDOM page. jsdom defines `href` with a setter that triggers a
 * navigation; we redefine the property descriptor to capture the value
 * instead. Restoring the original descriptor afterwards lets later tests
 * (or other suites in the same run) see the real location again.
 */
function spyOnLocationHref(): LocationSpy {
  let assigned: string | null = null;
  const proto = Object.getPrototypeOf(window.location) as Location;
  const originalDescriptor =
    Object.getOwnPropertyDescriptor(window.location, "href") ??
    Object.getOwnPropertyDescriptor(proto, "href");

  Object.defineProperty(window.location, "href", {
    configurable: true,
    get: () => assigned ?? "",
    set: (v: string) => {
      assigned = v;
    },
  });

  return {
    get assigned() {
      return assigned;
    },
    restore: () => {
      if (originalDescriptor) {
        Object.defineProperty(window.location, "href", originalDescriptor);
      } else {
        Reflect.deleteProperty(window.location, "href");
      }
    },
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});

afterEach(() => {
  cleanup();
});

// ─────────────────────────────────────────────────────────────────────────────
// Status alerts (kept from Phase 0)
// ─────────────────────────────────────────────────────────────────────────────

describe("OperationsPaywall — status alerts", () => {
  it("renders the benefits list when subscription is null", () => {
    render(<OperationsPaywall subscription={null} />);

    expect(
      screen.getByText("Unlock the operations toolkit"),
    ).toBeInTheDocument();
    expect(screen.getByText("Residents & care plans")).toBeInTheDocument();
    expect(screen.getByText("Tracker suite")).toBeInTheDocument();
    expect(screen.getByText("Notes feed")).toBeInTheDocument();
    // No status alert when there's no subscription record.
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("renders the past_due alert when status is past_due", () => {
    render(<OperationsPaywall subscription={sub("past_due")} />);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(/payment failed/i);
    expect(alert).toHaveTextContent(/update your card/i);
  });

  it("renders the canceled alert when status is canceled", () => {
    render(<OperationsPaywall subscription={sub("canceled")} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/subscription ended/i);
  });

  it("renders the unpaid alert when status is unpaid", () => {
    render(<OperationsPaywall subscription={sub("unpaid")} />);
    expect(screen.getByRole("alert")).toHaveTextContent(/payment overdue/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Pricing — the prominent conversion driver
// ─────────────────────────────────────────────────────────────────────────────

describe("OperationsPaywall — pricing", () => {
  it("displays the $99/month price prominently", () => {
    render(<OperationsPaywall subscription={null} />);
    expect(screen.getByText(OPERATIONS_PRO_PRICE_LABEL)).toBeInTheDocument();
    // Sanity check the label itself — guards against accidental drift if a
    // future edit retypes the string somewhere instead of importing the
    // constant.
    expect(OPERATIONS_PRO_PRICE_LABEL).toMatch(/\$99/);
    expect(OPERATIONS_PRO_PRICE_LABEL).toMatch(/month/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CTA: enabled, POSTs to /api/billing/checkout, handles success / failure
// ─────────────────────────────────────────────────────────────────────────────

describe("OperationsPaywall — Stripe Checkout CTA", () => {
  it("renders an enabled CTA labelled 'Upgrade to Operations Pro'", () => {
    render(<OperationsPaywall subscription={null} />);
    const cta = screen.getByTestId("operations-paywall-cta");
    expect(cta).toBeEnabled();
    expect(cta).toHaveTextContent(/upgrade to operations pro/i);
  });

  it("renders an enabled CTA even when a status alert is showing", () => {
    render(<OperationsPaywall subscription={sub("past_due")} />);
    expect(screen.getByTestId("operations-paywall-cta")).toBeEnabled();
  });

  it("POSTs to /api/billing/checkout when clicked and redirects to the returned URL", async () => {
    const loc = spyOnLocationHref();
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ url: "https://checkout.stripe.com/c/pay/abc123" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OperationsPaywall subscription={null} />);
    fireEvent.click(screen.getByTestId("operations-paywall-cta"));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/billing/checkout");
    expect(init).toMatchObject({
      method: "POST",
      credentials: "include",
    });
    // CSRF sentinel — server middleware rejects state-changing requests
    // that lack it, so the test pins it down.
    expect(init.headers).toMatchObject({
      "X-Requested-With": "XMLHttpRequest",
    });

    await waitFor(() => {
      expect(loc.assigned).toBe("https://checkout.stripe.com/c/pay/abc123");
    });

    loc.restore();
  });

  it("shows the 'temporarily unavailable' alert on 503 STRIPE_NOT_CONFIGURED", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({ code: "STRIPE_NOT_CONFIGURED" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OperationsPaywall subscription={null} />);
    fireEvent.click(screen.getByTestId("operations-paywall-cta"));

    const alert = await screen.findByTestId(
      "operations-paywall-unavailable",
    );
    expect(alert).toHaveTextContent(/temporarily unavailable/i);
    // The CTA should be re-enabled so the user can retry once ops fixes it.
    expect(screen.getByTestId("operations-paywall-cta")).toBeEnabled();
  });

  it("shows a generic retry alert on 500 CHECKOUT_FAILED", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({
        code: "CHECKOUT_FAILED",
        message: "Stripe API timed out.",
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<OperationsPaywall subscription={null} />);
    fireEvent.click(screen.getByTestId("operations-paywall-cta"));

    const alert = await screen.findByTestId("operations-paywall-error");
    expect(alert).toHaveTextContent(/could not start checkout/i);
    expect(screen.getByTestId("operations-paywall-cta")).toBeEnabled();
  });

  it("disables the CTA and shows loading text while the request is in flight", async () => {
    // Resolve manually so we can assert on the in-flight state.
    let resolveFetch: (v: unknown) => void = () => {};
    const fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise((r) => {
          resolveFetch = r;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<OperationsPaywall subscription={null} />);
    fireEvent.click(screen.getByTestId("operations-paywall-cta"));

    // In-flight: disabled + loading copy.
    await waitFor(() => {
      const cta = screen.getByTestId("operations-paywall-cta");
      expect(cta).toBeDisabled();
      expect(cta).toHaveTextContent(/starting checkout/i);
    });

    // Resolve as 503 just so the promise settles cleanly.
    resolveFetch({
      ok: false,
      status: 503,
      json: async () => ({ code: "STRIPE_NOT_CONFIGURED" }),
    });

    // After settling, the CTA is enabled again.
    await waitFor(() => {
      expect(screen.getByTestId("operations-paywall-cta")).toBeEnabled();
    });
  });
});
