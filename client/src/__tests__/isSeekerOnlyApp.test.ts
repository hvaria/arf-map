// isSeekerOnlyApp contract tests.
//
// Today the helper is a thin alias for isInsideCapacitor(). When the
// planned standalone facility-native app ships, the implementation
// will branch on a build-time flag — these tests pin the public
// contract so call sites that already depend on the helper continue
// to behave correctly through that change.
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { isSeekerOnlyApp } from "../lib/installApp";

function deleteCapacitor() {
  try {
    delete (window as Window & { Capacitor?: unknown }).Capacitor;
  } catch {
    /* ignore */
  }
}

beforeEach(() => {
  deleteCapacitor();
});

afterEach(() => {
  deleteCapacitor();
});

describe("isSeekerOnlyApp", () => {
  it("returns false when running in a regular web browser (window.Capacitor undefined)", () => {
    expect(isSeekerOnlyApp()).toBe(false);
  });

  it("returns true when running inside the Capacitor WebView (window.Capacitor present)", () => {
    // @ts-expect-error — Capacitor v7 injects an opaque object at runtime
    window.Capacitor = { getPlatform: () => "android" };
    expect(isSeekerOnlyApp()).toBe(true);
  });
});
