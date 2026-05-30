import { useCallback, useEffect, useState } from "react";

// The app is hash-routed (wouter useHashLocation), so wouter's useSearch() and
// window.location.search are empty — query params live INSIDE the hash, e.g.
// `#/facility-portal/applicants?applicant=abc123`. This hook reads/writes a
// single such param while preserving the hash path (and any other params).
//
// Writes use replaceState (selection changes shouldn't spam browser history)
// and dispatch a synthetic hashchange so this hook — and wouter — stay in sync.
// Only the query portion changes, so the matched route is unaffected.

function getHashQuery(): URLSearchParams {
  const hash = window.location.hash.replace(/^#/, "");
  const qIdx = hash.indexOf("?");
  return new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : "");
}

function writeHashParam(key: string, value: string | null): void {
  const hash = window.location.hash.replace(/^#/, "");
  const qIdx = hash.indexOf("?");
  const path = qIdx >= 0 ? hash.slice(0, qIdx) : hash;
  const params = new URLSearchParams(qIdx >= 0 ? hash.slice(qIdx + 1) : "");
  if (value == null || value === "") params.delete(key);
  else params.set(key, value);
  const qs = params.toString();
  const next = `#${path}${qs ? `?${qs}` : ""}`;
  if (next !== window.location.hash) {
    window.history.replaceState(window.history.state, "", next);
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  }
}

export function useHashParam(key: string): [string | null, (value: string | null) => void] {
  const [val, setVal] = useState<string | null>(() =>
    typeof window === "undefined" ? null : getHashQuery().get(key),
  );

  useEffect(() => {
    const sync = () => setVal(getHashQuery().get(key));
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [key]);

  const set = useCallback((value: string | null) => writeHashParam(key, value), [key]);
  return [val, set];
}
