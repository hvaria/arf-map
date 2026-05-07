/**
 * featureFlags tests.
 *
 * Covers `isFeatureEnabled("notes_dedicated_page", ctx)`:
 *   - default (env empty) → false
 *   - super_admin override → true regardless of allowlist
 *   - CSV match (case-insensitive, whitespace tolerant)
 *   - facility absent from allowlist → false
 *   - empty facilityNumber + empty allowlist → false
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// We mutate `import.meta.env` directly per-test. Vitest exposes it as a
// regular object on the module record at runtime.
const originalEnv = { ...import.meta.env };

beforeEach(() => {
  // Reset to a clean slate so each case has a deterministic env.
  for (const k of Object.keys(import.meta.env)) {
    if (!(k in originalEnv)) {
      delete (import.meta.env as Record<string, unknown>)[k];
    }
  }
  Object.assign(import.meta.env, originalEnv);
  delete (import.meta.env as Record<string, unknown>).VITE_NOTES_DEDICATED_PAGE_FACILITIES;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("isFeatureEnabled('notes_dedicated_page')", () => {
  it("defaults to false when the env var is undefined", async () => {
    const { isFeatureEnabled } = await import("../lib/featureFlags");
    expect(
      isFeatureEnabled("notes_dedicated_page", {
        facilityNumber: "197600123",
        role: "facility_admin",
      }),
    ).toBe(false);
  });

  it("returns false when env var is set but facility is not in the list", async () => {
    (import.meta.env as Record<string, unknown>).VITE_NOTES_DEDICATED_PAGE_FACILITIES =
      "197600111,197600222";
    const { isFeatureEnabled } = await import("../lib/featureFlags");
    expect(
      isFeatureEnabled("notes_dedicated_page", {
        facilityNumber: "197600999",
        role: "facility_admin",
      }),
    ).toBe(false);
  });

  it("matches CSV with whitespace, case-insensitively", async () => {
    (import.meta.env as Record<string, unknown>).VITE_NOTES_DEDICATED_PAGE_FACILITIES =
      "  197600AAA , 197600BBB  ";
    const { isFeatureEnabled } = await import("../lib/featureFlags");
    expect(
      isFeatureEnabled("notes_dedicated_page", {
        facilityNumber: "197600bbb",
        role: "facility_admin",
      }),
    ).toBe(true);
    expect(
      isFeatureEnabled("notes_dedicated_page", {
        facilityNumber: "197600aaa",
        role: "facility_admin",
      }),
    ).toBe(true);
  });

  it("super_admin role bypasses the allowlist", async () => {
    // Env var deliberately empty.
    delete (import.meta.env as Record<string, unknown>).VITE_NOTES_DEDICATED_PAGE_FACILITIES;
    const { isFeatureEnabled } = await import("../lib/featureFlags");
    expect(
      isFeatureEnabled("notes_dedicated_page", {
        facilityNumber: "anything",
        role: "super_admin",
      }),
    ).toBe(true);
  });

  it("returns false when both facilityNumber and allowlist are empty", async () => {
    (import.meta.env as Record<string, unknown>).VITE_NOTES_DEDICATED_PAGE_FACILITIES = "";
    const { isFeatureEnabled } = await import("../lib/featureFlags");
    expect(
      isFeatureEnabled("notes_dedicated_page", {
        facilityNumber: "",
        role: null,
      }),
    ).toBe(false);
  });
});
