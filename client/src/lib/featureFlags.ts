/**
 * Feature flags — minimal, env-var-driven, no third-party SDK.
 *
 * Slice 2 of the Notes module ships behind the `notes_dedicated_page`
 * flag. The flag is OFF by default; it can be turned ON for specific
 * facilities via the CSV env var, and is always ON for users with the
 * `super_admin` role.
 *
 * Flag selection logic (notes_dedicated_page):
 *   0. import.meta.env.MODE === "development"             → true   (dev override)
 *   1. role === "super_admin"                             → true
 *   2. facilityNumber in VITE_NOTES_DEDICATED_PAGE_FACILITIES → true
 *   3. otherwise                                          → false
 *
 * The dev-mode override (rule 0) auto-enables the flag during `npm run dev`
 * so local testing doesn't require setting an env allowlist. It deliberately
 * checks MODE === "development" rather than DEV: Vitest runs with
 * MODE === "test" so the test suite continues to exercise rules 1–3.
 * Production builds run with MODE === "production" and stay gated.
 *
 * Lookup is case-insensitive and tolerant of surrounding whitespace.
 *
 * If we add a second flag later, copy this small switch — don't reach for
 * a 3rd-party SDK until the count justifies it.
 */
import { useSession } from "@/hooks/useSession";

export type FeatureFlag = "notes_dedicated_page";

interface FlagContext {
  facilityNumber?: string | null;
  role?: string | null;
}

function readAllowlist(envValue: string | undefined): string[] {
  if (!envValue) return [];
  return envValue
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

export function isFeatureEnabled(flag: FeatureFlag, ctx: FlagContext): boolean {
  switch (flag) {
    case "notes_dedicated_page": {
      // Dev-mode override — see file header. MODE is "development" only when
      // serving via `npm run dev`; Vitest is "test" and prod builds are
      // "production", so neither falls into this branch.
      if (import.meta.env.MODE === "development") return true;
      if (ctx.role === "super_admin") return true;
      const allowlist = readAllowlist(
        import.meta.env.VITE_NOTES_DEDICATED_PAGE_FACILITIES as
          | string
          | undefined,
      );
      if (allowlist.length === 0) return false;
      const facility = (ctx.facilityNumber ?? "").trim().toLowerCase();
      if (!facility) return false;
      return allowlist.includes(facility);
    }
    default:
      return false;
  }
}

/**
 * React hook variant. Reads the current facility-portal session and
 * evaluates the flag with `(facilityNumber, role)` as context.
 *
 * Returns `false` while the session query is still loading.
 */
export function useFeatureFlag(flag: FeatureFlag): boolean {
  const { data } = useSession();
  return isFeatureEnabled(flag, {
    facilityNumber: data?.facilityNumber ?? null,
    role: data?.role ?? null,
  });
}
