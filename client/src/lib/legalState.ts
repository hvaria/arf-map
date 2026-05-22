/**
 * client/src/lib/legalState.ts
 *
 * Module-level store + subscribe surface for the legal acceptance gate.
 *
 * Mirrors the Phase 1 CSRF pattern: a tiny module-scoped store that both
 * the seeker `AuthContext` and the facility `useSession` hook can write
 * into, and that the global `<LegalAcceptanceModal>` (mounted in App.tsx)
 * can subscribe to.
 *
 * Why module-level (not React context)?
 *  - The store is written from two different React subtrees (`AuthProvider`
 *    for the seeker, the facility `useSession` consumer in App.tsx).
 *  - Reads happen inside `apiRequest()`, which is not a React hook and has
 *    no access to context.
 *  - One source of truth avoids drifting between two contexts.
 *
 * The set of pendingAcceptances reflects the CURRENT session — when the
 * user logs out, the writer clears it; when /me returns no pending docs,
 * the writer clears it.
 */
import type { LegalDocSlug } from "@/lib/legal";
import { isLegalDocSlug } from "@/lib/legal";

type Listener = (state: LegalState) => void;

export interface LegalState {
  /** Which audience's session contributed the pending list, for logging only. */
  audience: "seeker" | "facility" | null;
  /** Docs the current session has NOT yet accepted at the current version. */
  pending: LegalDocSlug[];
  /** Bumped whenever apiRequest sees a 409 LEGAL_REACCEPT_REQUIRED. */
  forcedOpenNonce: number;
}

let state: LegalState = {
  audience: null,
  pending: [],
  forcedOpenNonce: 0,
};

const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((l) => {
    try {
      l(state);
    } catch {
      /* ignore listener errors */
    }
  });
}

/** Returns the current snapshot. Synchronous; safe for non-React callers. */
export function getLegalState(): LegalState {
  return state;
}

/** Subscribe to changes — returns an unsubscribe fn. */
export function subscribeLegalState(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Write the pending list from a `/me` response. Coerces & filters invalid
 * slugs so a future BE addition (e.g. "cookies") doesn't crash the gate;
 * unknown slugs are simply dropped here and the BE can ship a UI for them
 * later.
 */
export function setPendingAcceptances(
  audience: "seeker" | "facility",
  raw: unknown,
): void {
  const arr = Array.isArray(raw) ? raw.filter(isLegalDocSlug) : [];
  // If neither audience has anything pending, clear entirely. Otherwise
  // record this audience's list as the truth.
  if (arr.length === 0 && state.audience === audience) {
    state = { audience: null, pending: [], forcedOpenNonce: state.forcedOpenNonce };
    emit();
    return;
  }
  if (arr.length === 0) {
    // Different audience may still have a pending list — do nothing.
    return;
  }
  state = { audience, pending: arr, forcedOpenNonce: state.forcedOpenNonce };
  emit();
}

/** Clear on logout. */
export function clearPendingAcceptances(audience: "seeker" | "facility"): void {
  if (state.audience !== audience) return; // Different audience owns it — keep
  state = { audience: null, pending: [], forcedOpenNonce: state.forcedOpenNonce };
  emit();
}

/**
 * Called from `apiRequest` when a mutation hits 409 LEGAL_REACCEPT_REQUIRED.
 * Bumps a nonce so the modal re-opens even if the pending list shape didn't
 * change (e.g. terms version bumped while the user was idle).
 */
export function forceLegalModalOpen(audience: "seeker" | "facility" | null = null): void {
  state = {
    audience: audience ?? state.audience,
    pending: state.pending,
    forcedOpenNonce: state.forcedOpenNonce + 1,
  };
  emit();
}
