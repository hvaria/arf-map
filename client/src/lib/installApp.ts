// Install-app prompt logic — detects whether we should nudge the
// visitor to install the PWA, captures Chrome's `beforeinstallprompt`
// event so we can trigger the native install dialog on demand, and
// owns the dismissal-persistence window so we don't nag.
//
// Scope today: PWA only. The native iOS App Store and Google Play
// listings don't exist yet, so the "install" path on every supported
// browser routes to "Add to Home Screen" semantics. When the stores
// publish, swap `getInstallMode()` to return "appstore" / "playstore"
// on the appropriate platforms and the banner UI picks it up
// without code changes.

// ── Types ────────────────────────────────────────────────────────────────

/**
 * Where the "Install" button should send the user. The banner reads
 * this once on mount and re-reads when an `installmode-changed` event
 * fires (Android Chrome's beforeinstallprompt can arrive after first
 * paint). "hidden" suppresses the banner entirely.
 */
export type InstallMode =
  | "android-native-prompt" // Chrome / Edge on Android — we have the event cached
  | "ios-instructions"      // Safari on iOS — no programmatic install, show share-sheet steps
  | "hidden";               // desktop, in-Capacitor, already-PWA, dismissed, or unsupported

// Chrome's beforeinstallprompt event — not in lib.dom yet.
interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

// ── Module-level singleton: beforeinstallprompt cache ────────────────────
// Registered at module load so we never miss the event — Chrome only
// fires it once per session and may fire before any component mounts.

let cachedPromptEvent: BeforeInstallPromptEvent | null = null;

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    // Prevent Chrome from showing its mini-infobar so we own the UX.
    e.preventDefault();
    cachedPromptEvent = e as BeforeInstallPromptEvent;
    window.dispatchEvent(new Event("installmode-changed"));
  });
  window.addEventListener("appinstalled", () => {
    cachedPromptEvent = null;
    window.dispatchEvent(new Event("installmode-changed"));
  });
}

// ── Dismissal persistence ────────────────────────────────────────────────
// We never want to nag — once a user dismisses, give them weeks of quiet
// before re-prompting. Key chosen to namespace under `app.` (vs the
// `seeker.` namespace owned by CareFinder onboarding).

const DISMISSAL_KEY = "app.installPromptDismissedUntil";
export const DEFAULT_DISMISSAL_DAYS = 14;

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
    /* private browsing / quota — ignore */
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

export function isInstallPromptDismissed(): boolean {
  const until = safeGet(DISMISSAL_KEY);
  if (!until) return false;
  const ts = Date.parse(until);
  if (Number.isNaN(ts)) return false;
  return ts > Date.now();
}

export function dismissInstallPrompt(days: number = DEFAULT_DISMISSAL_DAYS): void {
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  safeSet(DISMISSAL_KEY, until.toISOString());
}

export function clearInstallPromptDismissal(): void {
  safeRemove(DISMISSAL_KEY);
}

// ── Environment detection ────────────────────────────────────────────────

/**
 * True when the page is running inside the Capacitor WebView. Capacitor
 * v7 injects `window.Capacitor` so we can detect from JS without
 * importing the SDK (keeps the web bundle clean).
 */
export function isInsideCapacitor(): boolean {
  return typeof window !== "undefined" && "Capacitor" in window;
}

/**
 * True when the current build is the **seeker-only native app** — i.e.
 * a Capacitor build that must never expose facility-operator surfaces
 * (role picker on the map, brand-logo home that lands on /map, the
 * `Facility portal` tile, sign-out destinations that route via /map,
 * etc.). The web build is multi-role (one site, both audiences); the
 * native app is single-purpose.
 *
 * Today this is identical to `isInsideCapacitor()` because the only
 * native build that exists is the seeker app. When the planned
 * standalone facility-operator app ships, that build will set a
 * build-time flag (e.g. `VITE_APP_PROFILE=facility-native`) and this
 * helper will start returning false for it — every call site that
 * checks `isSeekerOnlyApp()` then automatically behaves correctly
 * without further changes.
 */
export function isSeekerOnlyApp(): boolean {
  return isInsideCapacitor();
}

/**
 * True when the page is being rendered as an installed PWA — either
 * the standard display-mode media query (Android Chrome, desktop) or
 * the iOS-Safari-specific `navigator.standalone`.
 */
export function isAlreadyPwa(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)")?.matches) return true;
  // iOS Safari sets this when launched from a home-screen icon.
  const navStandalone = (window.navigator as { standalone?: boolean }).standalone;
  return navStandalone === true;
}

/**
 * Coarse iOS detection from the user-agent — used to decide whether to
 * show the manual "Share → Add to Home Screen" instructions when the
 * `beforeinstallprompt` event will never fire.
 *
 * Includes iPadOS 13+ which masquerades as Mac Safari but exposes touch.
 */
export function isIosBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent || "";
  if (/iPad|iPhone|iPod/.test(ua)) return true;
  // iPadOS reports as Mac — disambiguate via touch points.
  const isMacLike = /Macintosh/.test(ua);
  const touchPoints = (navigator as Navigator).maxTouchPoints ?? 0;
  return isMacLike && touchPoints > 1;
}

/**
 * Coarse Android detection from the user-agent. Combined with the
 * cached beforeinstallprompt event to gate the native-prompt mode.
 */
export function isAndroidBrowser(): boolean {
  if (typeof navigator === "undefined") return false;
  return /Android/.test(navigator.userAgent || "");
}

// ── Mode resolution ──────────────────────────────────────────────────────

/**
 * Single source of truth for the banner's render decision. Order of
 * suppressions matters — environments that should NEVER see the banner
 * (Capacitor, already-PWA, desktop) short-circuit first, before
 * dismissal is even checked.
 */
export function getInstallMode(): InstallMode {
  if (typeof window === "undefined") return "hidden";
  if (isInsideCapacitor()) return "hidden";
  if (isAlreadyPwa()) return "hidden";
  if (!isIosBrowser() && !isAndroidBrowser()) return "hidden"; // desktop / unknown
  if (isInstallPromptDismissed()) return "hidden";

  if (isAndroidBrowser() && cachedPromptEvent) return "android-native-prompt";
  if (isIosBrowser()) return "ios-instructions";

  // Android browser without the event (Firefox, Samsung Internet on
  // older versions, or Chrome that hasn't decided yet). Hide for v1 —
  // we can layer manual instructions later if telemetry shows demand.
  return "hidden";
}

/**
 * Subscribe to install-mode changes. The banner listens for this so
 * it can appear the moment Chrome fires `beforeinstallprompt`, even
 * if the event arrives after the component mounted.
 */
export function subscribeToInstallMode(listener: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("installmode-changed", listener);
  return () => window.removeEventListener("installmode-changed", listener);
}

/**
 * Fire Chrome's native install dialog. No-op (resolves to "unavailable")
 * if the event isn't cached. Returns the user's choice for telemetry.
 */
export async function triggerAndroidNativePrompt(): Promise<
  "accepted" | "dismissed" | "unavailable"
> {
  const event = cachedPromptEvent;
  if (!event) return "unavailable";
  await event.prompt();
  const choice = await event.userChoice;
  cachedPromptEvent = null;
  window.dispatchEvent(new Event("installmode-changed"));
  return choice.outcome;
}

// ── Test seam ────────────────────────────────────────────────────────────
// Internal helpers so component tests can simulate the
// beforeinstallprompt event without touching the live cache.

/** @internal — for tests only */
export function __setCachedPromptEventForTests(
  event: BeforeInstallPromptEvent | null,
): void {
  cachedPromptEvent = event;
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event("installmode-changed"));
  }
}
