// Single source of truth for the seeker-side localStorage keys used by
// the CareFinder onboarding (Phase 1). Centralizes the key literals,
// the try/catch-on-private-browsing wrappers, and the typed draft
// serialization so individual call sites don't drift.
//
// Scope semantics:
//   - `walkthroughSeen` is DEVICE-scoped. A returning user on the same
//     device shouldn't sit through the 3-card intro again — even after
//     logging out and logging into a different seeker account. Cleared
//     only when the user explicitly re-enters via the "First time?" link
//     in JobSeekerPage (which clears the key before navigating).
//   - `onboardingDismissed` and `onboardingDraft` are ACCOUNT-scoped.
//     Both are cleared by AuthContext.logout() so the next account
//     starts fresh.
//
// Storage keys are also referenced directly in tests for assertion
// purposes — keep the literal strings stable.
import type { CredentialKind } from "@shared/schema";

export const SEEKER_LS_KEYS = {
  walkthroughSeen: "seeker.walkthroughSeen",
  onboardingDismissed: "seeker.onboardingDismissed",
  onboardingDraft: "seeker.onboardingDraft",
} as const;

export type SeekerLsKey = (typeof SEEKER_LS_KEYS)[keyof typeof SEEKER_LS_KEYS];

export interface OnboardingDraft {
  zipCode?: string;
  credentials?: CredentialKind[];
  yearsExperience?: number | null;
  bio?: string;
}

// ── Low-level wrappers ────────────────────────────────────────────────────

function safeGet(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* localStorage unavailable (private browsing / quota) — ignore. */
  }
}

function safeRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

// ── Walkthrough seen (device-scoped) ──────────────────────────────────────

export function isWalkthroughSeen(): boolean {
  return safeGet(SEEKER_LS_KEYS.walkthroughSeen) === "1";
}

export function markWalkthroughSeen(): void {
  safeSet(SEEKER_LS_KEYS.walkthroughSeen, "1");
}

export function clearWalkthroughSeen(): void {
  safeRemove(SEEKER_LS_KEYS.walkthroughSeen);
}

// ── Onboarding dismissed (account-scoped) ─────────────────────────────────

export function isOnboardingDismissed(): boolean {
  return safeGet(SEEKER_LS_KEYS.onboardingDismissed) === "1";
}

export function markOnboardingDismissed(): void {
  safeSet(SEEKER_LS_KEYS.onboardingDismissed, "1");
}

// ── Onboarding draft (account-scoped) ─────────────────────────────────────

export function loadOnboardingDraft(): OnboardingDraft {
  const raw = safeGet(SEEKER_LS_KEYS.onboardingDraft);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null ? parsed : {};
  } catch {
    return {};
  }
}

export function saveOnboardingDraft(draft: OnboardingDraft): void {
  safeSet(SEEKER_LS_KEYS.onboardingDraft, JSON.stringify(draft));
}

export function clearOnboardingDraft(): void {
  safeRemove(SEEKER_LS_KEYS.onboardingDraft);
}

// ── Session-scoped cleanup ────────────────────────────────────────────────

/**
 * Clear every per-account seeker key. Called from AuthContext.logout()
 * so the next account on the same device starts with a fresh wizard.
 * Intentionally does NOT clear `walkthroughSeen` — that key is
 * device-scoped (see the comment at the top of this file).
 */
export function clearSeekerSessionLocalStorage(): void {
  safeRemove(SEEKER_LS_KEYS.onboardingDismissed);
  safeRemove(SEEKER_LS_KEYS.onboardingDraft);
}
