// InstallAppBanner — bottom-sticky nudge for mobile browser visitors
// to install the PWA. Suppressed for desktop, for visitors already
// inside the Capacitor WebView, for users already running the page as
// an installed PWA, and for anyone who dismissed within the last
// 14 days (see DEFAULT_DISMISSAL_DAYS in @/lib/installApp).
//
// Mounted once at the App root in App.tsx so it appears on every
// route automatically. The banner owns its own visibility state and
// dismissal — no parent coordination required.
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Download, Share, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  dismissInstallPrompt,
  getInstallMode,
  subscribeToInstallMode,
  triggerAndroidNativePrompt,
  type InstallMode,
} from "@/lib/installApp";

export function InstallAppBanner() {
  // Track the install-mode reactively. Default to "hidden" so SSR /
  // first paint never flashes the banner before detection runs.
  const [mode, setMode] = useState<InstallMode>("hidden");
  const [iosInstructionsOpen, setIosInstructionsOpen] = useState(false);

  useEffect(() => {
    // Resolve on mount, then re-resolve whenever the install module
    // fires `installmode-changed` (Chrome's beforeinstallprompt can
    // arrive after first paint; an `appinstalled` resets to hidden).
    const sync = () => setMode(getInstallMode());
    sync();
    return subscribeToInstallMode(sync);
  }, []);

  const handleInstall = async () => {
    if (mode === "android-native-prompt") {
      const outcome = await triggerAndroidNativePrompt();
      if (outcome === "accepted") {
        // The `appinstalled` event will re-sync mode → "hidden". No-op
        // here — let the listener drive the UI to avoid double-update.
        return;
      }
      // User dismissed the native dialog — treat as a soft dismissal
      // (don't re-pester immediately) but use a shorter window so a
      // user who tapped Install once is asked again before 14 days.
      dismissInstallPrompt(3);
      setMode("hidden");
      return;
    }
    if (mode === "ios-instructions") {
      setIosInstructionsOpen(true);
      return;
    }
  };

  const handleDismiss = () => {
    dismissInstallPrompt();
    setMode("hidden");
  };

  const visible = mode !== "hidden";

  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ y: 80, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 80, opacity: 0 }}
            transition={{ type: "spring", stiffness: 320, damping: 30 }}
            // Fixed bottom-sticky positioning. `safe-area-inset-bottom`
            // keeps the banner above iOS home indicators / Android nav
            // bars when the device exposes them.
            className="fixed bottom-0 left-0 right-0 z-50 px-3"
            style={{ paddingBottom: "max(0.75rem, env(safe-area-inset-bottom))" }}
            role="region"
            aria-label="Install ARF Map app"
          >
            <div className="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white/95 backdrop-blur-md shadow-xl flex items-center gap-3 pl-3 pr-2 py-2.5">
              {/* PWA manifest icon — same artwork users see on their
                  home screen after install, so the visual carries
                  through the funnel. */}
              <img
                src="/icons/icon-192.png"
                alt=""
                aria-hidden="true"
                className="h-10 w-10 rounded-xl flex-shrink-0"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-stone-900 leading-tight">
                  Install ARF Map
                </div>
                <div className="text-xs text-stone-500 leading-tight mt-0.5">
                  Faster, full-screen, works offline.
                </div>
              </div>
              <Button
                size="sm"
                className="h-8 px-3 text-xs flex-shrink-0"
                onClick={handleInstall}
              >
                <Download className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
                Install
              </Button>
              <button
                type="button"
                onClick={handleDismiss}
                aria-label="Dismiss install prompt for 14 days"
                className="h-8 w-8 flex-shrink-0 inline-flex items-center justify-center rounded-full text-stone-400 hover:text-stone-700 hover:bg-stone-100 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* iOS instructions — Safari has no programmatic install API, so
          the user has to drive Add to Home Screen themselves. The
          dialog mirrors Apple's own pattern of icon + numbered steps. */}
      <Dialog open={iosInstructionsOpen} onOpenChange={setIosInstructionsOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Add ARF Map to your Home Screen</DialogTitle>
            <DialogDescription>
              iOS doesn't let apps install themselves from Safari — two
              quick taps and you're done.
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-4 text-sm pt-2">
            <li className="flex gap-3 items-start">
              <span className="flex-shrink-0 h-6 w-6 rounded-full bg-stone-100 text-stone-700 inline-flex items-center justify-center text-xs font-semibold">
                1
              </span>
              <span className="flex-1">
                Tap the{" "}
                <Share
                  className="h-4 w-4 inline-block align-middle text-indigo-600 mx-0.5"
                  aria-label="Share"
                />{" "}
                Share button at the bottom of Safari.
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="flex-shrink-0 h-6 w-6 rounded-full bg-stone-100 text-stone-700 inline-flex items-center justify-center text-xs font-semibold">
                2
              </span>
              <span className="flex-1">
                Choose{" "}
                <strong className="font-medium">Add to Home Screen</strong> —
                you may need to scroll down the share sheet.
              </span>
            </li>
            <li className="flex gap-3 items-start">
              <span className="flex-shrink-0 h-6 w-6 rounded-full bg-stone-100 text-stone-700 inline-flex items-center justify-center text-xs font-semibold">
                3
              </span>
              <span className="flex-1">
                Tap{" "}
                <strong className="font-medium">Add</strong> — the icon
                appears on your home screen next to your other apps.
              </span>
            </li>
          </ol>
          <div className="flex items-center justify-between pt-3">
            <button
              type="button"
              onClick={() => {
                dismissInstallPrompt();
                setIosInstructionsOpen(false);
                setMode("hidden");
              }}
              className="text-xs text-stone-500 hover:underline"
            >
              Don't show again
            </button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setIosInstructionsOpen(false)}
            >
              <Plus className="h-3.5 w-3.5 mr-1" aria-hidden="true" />
              Got it
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default InstallAppBanner;
