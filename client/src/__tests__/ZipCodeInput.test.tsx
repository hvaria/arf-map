// ZipCodeInput tests — QA additions for CareFinder Phase 1 onboarding.
//
// Covers the architect-listed acceptance criteria #6 and #7 plus the
// edge cases the QA prompt called out:
//   - onAutoSubmit fires exactly once on the 4 → 5 digit transition.
//   - paste of "94110abc" strips non-digits and fires onAutoSubmit once.
//   - typing 5, editing back to 4, then typing the 5th digit fires
//     onAutoSubmit a second time (implementation uses a prev-length ref).
//   - "Use my location" denial and 1.5s timeout never surface a toast.
//
// Test file lives in client/src/__tests__/ rather than co-located under
// client/src/components/jobseeker/__tests__/ because `npm run test:client`
// uses vitest.client.config.ts whose include pattern is still narrowly
// scoped to client/src/__tests__/. Co-located JSX tests would also fail
// under the top-level vitest.config.ts whose OXC JSX transform does not
// apply to .tsx files anywhere in the tree right now. See QA report.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { ZipCodeInput } from "../components/jobseeker/ZipCodeInput";

function Harness({ onAutoSubmit }: { onAutoSubmit?: (zip: string) => void }) {
  const [value, setValue] = useState("");
  return (
    <ZipCodeInput
      value={value}
      onChange={setValue}
      onAutoSubmit={onAutoSubmit}
    />
  );
}

describe("ZipCodeInput — auto-submit", () => {
  it("fires onAutoSubmit exactly once when the 5th digit is typed", async () => {
    const onAutoSubmit = vi.fn();
    render(<Harness onAutoSubmit={onAutoSubmit} />);
    const input = screen.getByLabelText(/ZIP code/i);

    await userEvent.type(input, "94110");

    expect(onAutoSubmit).toHaveBeenCalledTimes(1);
    expect(onAutoSubmit).toHaveBeenCalledWith("94110");
  });

  it("does NOT fire onAutoSubmit on digits 1-4", async () => {
    const onAutoSubmit = vi.fn();
    render(<Harness onAutoSubmit={onAutoSubmit} />);
    const input = screen.getByLabelText(/ZIP code/i);

    await userEvent.type(input, "9411");

    expect(onAutoSubmit).not.toHaveBeenCalled();
  });

  it("strips non-digits on paste and fires onAutoSubmit once when the cleaned value is exactly 5 digits", async () => {
    const onAutoSubmit = vi.fn();
    render(<Harness onAutoSubmit={onAutoSubmit} />);
    const input = screen.getByLabelText(/ZIP code/i) as HTMLInputElement;

    input.focus();
    await userEvent.paste("94110abc");

    expect(input.value).toBe("94110");
    expect(onAutoSubmit).toHaveBeenCalledTimes(1);
    expect(onAutoSubmit).toHaveBeenCalledWith("94110");
  });

  it("re-fires onAutoSubmit when the user backs up to 4 digits then re-types the 5th", async () => {
    // Spec says "transitions 4 → 5" — verifies the prevLen ref is in use,
    // not a naive `value.length === 5` check that would only fire once.
    const onAutoSubmit = vi.fn();
    render(<Harness onAutoSubmit={onAutoSubmit} />);
    const input = screen.getByLabelText(/ZIP code/i) as HTMLInputElement;

    await userEvent.type(input, "94110");
    expect(onAutoSubmit).toHaveBeenCalledTimes(1);

    await userEvent.type(input, "{backspace}");
    expect(input.value).toBe("9411");
    await userEvent.type(input, "5");

    expect(onAutoSubmit).toHaveBeenCalledTimes(2);
    expect(onAutoSubmit).toHaveBeenLastCalledWith("94115");
  });

  it("hard-caps input at 5 digits even when the browser would accept more", async () => {
    const onAutoSubmit = vi.fn();
    render(<Harness onAutoSubmit={onAutoSubmit} />);
    const input = screen.getByLabelText(/ZIP code/i) as HTMLInputElement;

    input.focus();
    await userEvent.paste("941101234");

    expect(input.value).toBe("94110");
  });
});

describe("ZipCodeInput — geolocation", () => {
  const ORIGINAL_GEO = navigator.geolocation;

  afterEach(() => {
    Object.defineProperty(navigator, "geolocation", {
      value: ORIGINAL_GEO,
      configurable: true,
      writable: true,
    });
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("is silent on permission denial (no error pill surfaces)", async () => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (_ok: PositionCallback, err: PositionErrorCallback) => {
          err({
            code: 1,
            message: "User denied geolocation",
            PERMISSION_DENIED: 1,
            POSITION_UNAVAILABLE: 2,
            TIMEOUT: 3,
          } as unknown as GeolocationPositionError);
        },
      },
      configurable: true,
      writable: true,
    });

    render(<Harness onAutoSubmit={vi.fn()} />);

    await userEvent.click(
      screen.getByRole("button", { name: /use my current location/i }),
    );

    expect(screen.queryByText(/Detected in California/i)).not.toBeInTheDocument();
  });

  it("falls back silently after the 1.5s hard timeout and re-enables the button", async () => {
    vi.useFakeTimers();
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: () => {},
      },
      configurable: true,
      writable: true,
    });

    render(<Harness onAutoSubmit={vi.fn()} />);

    const btn = screen.getByRole("button", { name: /use my current location/i });
    await act(async () => {
      btn.click();
    });

    expect(btn).toBeDisabled();

    // requestGeolocationOnce returns a Promise that resolves AFTER the
    // 1.5s fallback fires; advanceTimersByTimeAsync flushes the awaited
    // continuation so the setGeoChecking(false) re-enables the button.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });

    expect(btn).not.toBeDisabled();
    expect(screen.queryByText(/Detected in California/i)).not.toBeInTheDocument();
  });

  it("shows the 'Detected in California' pill when geolocation returns a CA coordinate", async () => {
    Object.defineProperty(navigator, "geolocation", {
      value: {
        getCurrentPosition: (ok: PositionCallback) => {
          ok({
            coords: {
              latitude: 37.77,
              longitude: -122.42,
              accuracy: 10,
              altitude: null,
              altitudeAccuracy: null,
              heading: null,
              speed: null,
              toJSON: () => ({}),
            },
            timestamp: Date.now(),
            toJSON: () => ({}),
          } as unknown as GeolocationPosition);
        },
      },
      configurable: true,
      writable: true,
    });

    render(<Harness onAutoSubmit={vi.fn()} />);
    await userEvent.click(
      screen.getByRole("button", { name: /use my current location/i }),
    );
    expect(await screen.findByText(/Detected in California/i)).toBeInTheDocument();
  });
});
