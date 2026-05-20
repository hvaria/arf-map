// Shared geolocation primitive — used by MapPage (initial "fly to
// user" + on-demand "use my location" CTA) and by the CareFinder
// onboarding LocationStep ("Use my location" pill). Both call sites
// previously hand-rolled the same settle-once + 1.5s hard timeout
// pattern; this module is the single source of truth so the timeout,
// the silent-on-denial behavior, and the cleanup semantics stay in
// sync.

export interface RequestGeolocationOptions {
  /**
   * Hard cap before this helper resolves with null even if the browser's
   * permission prompt or the underlying device GPS is still pending.
   * Default 1500ms — short enough that a stalled permission dialog
   * doesn't leave the UI frozen.
   */
  timeoutMs?: number;
  /**
   * Forwarded verbatim to `navigator.geolocation.getCurrentPosition`.
   * Default `{ timeout: 10000, maximumAge: 60000 }` — matches the
   * pre-extraction call sites in MapPage / ZipCodeInput exactly.
   */
  positionOptions?: PositionOptions;
}

const DEFAULT_TIMEOUT_MS = 1500;
const DEFAULT_POSITION_OPTIONS: PositionOptions = {
  timeout: 10000,
  maximumAge: 60000,
};

/**
 * Request the browser's current geolocation once, with a hard timeout.
 * Returns `null` on any of:
 *   - `navigator.geolocation` unavailable (SSR or non-secure context)
 *   - user denies the permission prompt
 *   - the prompt sits idle past `timeoutMs`
 *   - any other geolocation error (`POSITION_UNAVAILABLE`, etc.)
 *
 * Intentionally silent — the caller owns any UI feedback. Multiple
 * concurrent invocations are safe: each runs its own settle gate.
 */
export function requestGeolocationOnce(
  options: RequestGeolocationOptions = {},
): Promise<GeolocationCoordinates | null> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, positionOptions } = options;
  const posOpts = positionOptions ?? DEFAULT_POSITION_OPTIONS;

  if (typeof navigator === "undefined" || !navigator.geolocation) {
    return Promise.resolve(null);
  }

  return new Promise<GeolocationCoordinates | null>((resolve) => {
    let settled = false;
    const settle = (value: GeolocationCoordinates | null) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(fallback);
      resolve(value);
    };

    const fallback = window.setTimeout(() => settle(null), timeoutMs);

    navigator.geolocation.getCurrentPosition(
      (pos) => settle(pos.coords),
      () => settle(null),
      posOpts,
    );
  });
}
