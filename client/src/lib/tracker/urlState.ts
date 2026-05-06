/**
 * URL querystring helpers under wouter hash-routing.
 *
 * Routes look like `/#/portal/tracker/adl/quick?date=…&shift=AM`. Wouter's
 * `useLocation()` returns the path part of the hash (e.g.
 * `/portal/tracker/adl/quick?date=…`). The querystring lives inside that
 * string, NOT on `window.location.search` (which is empty for hash routes).
 *
 * Splitting/joining is done as plain string manipulation — we do not call
 * `window.history.pushState` directly so that wouter remains the source of
 * truth for navigation.
 */
import { useCallback, useMemo } from "react";
import { useLocation } from "wouter";

/** Splits a wouter location into `{ path, queryString }`. */
export function splitLocation(location: string): {
  path: string;
  queryString: string;
} {
  const idx = location.indexOf("?");
  if (idx === -1) return { path: location, queryString: "" };
  return {
    path: location.slice(0, idx),
    queryString: location.slice(idx + 1),
  };
}

/** Parse a querystring (no leading `?`) into a `URLSearchParams`. */
export function parseQuery(queryString: string): URLSearchParams {
  return new URLSearchParams(queryString);
}

/**
 * Compose a wouter-style `path?query` location. Drops the `?` when the
 * query is empty so the location stays clean.
 */
export function withQuery(path: string, params: URLSearchParams): string {
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

/**
 * React hook giving callers `(params, setParams)` over the current hash
 * querystring. `setParams` accepts an updater that receives a fresh
 * `URLSearchParams` and may mutate it in place; we serialize and navigate.
 */
export function useQueryParams(): [
  URLSearchParams,
  (updater: (next: URLSearchParams) => void) => void,
] {
  const [location, setLocation] = useLocation();
  const { path, queryString } = useMemo(
    () => splitLocation(location),
    [location],
  );
  const params = useMemo(() => parseQuery(queryString), [queryString]);

  const setParams = useCallback(
    (updater: (next: URLSearchParams) => void) => {
      const next = new URLSearchParams(queryString);
      updater(next);
      setLocation(withQuery(path, next));
    },
    [path, queryString, setLocation],
  );

  return [params, setParams];
}
