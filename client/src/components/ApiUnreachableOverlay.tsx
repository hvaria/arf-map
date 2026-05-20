// ApiUnreachableOverlay — full-screen takeover that catches the
// "Capacitor build with no backend wired up" misconfiguration that
// otherwise white-screens silently on every protected page (the page
// mounts, fires `/api/...` queries, every fetch fails because the
// WebView's origin has no server, the page renders nothing).
//
// Conditions for rendering (all must be true):
//   • Page is inside the Capacitor WebView (window.Capacitor present)
//   • Page was loaded from the bundled assets, not a live-reload dev
//     server. We detect this by checking that window.location.hostname
//     resolves to "localhost" (capacitor:// or https://localhost are
//     both common — Vite-dev URLs would have a real LAN hostname).
//   • API_BASE resolved to an empty string. That means neither
//     VITE_API_URL nor the Replit-style port placeholder is set, so
//     every relative /api/* fetch lands on the same (server-less)
//     origin.
//
// When the overlay is up, the rest of the app is hidden so the user
// can't tap something that fires another doomed fetch. The CTAs link
// to the two real fix paths: configure live-reload, or build with
// VITE_API_URL pointed at the deployed server.
import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { API_BASE } from "@/lib/queryClient";
import { isInsideCapacitor } from "@/lib/installApp";

function isMisconfiguredCapacitorBuild(): boolean {
  if (!isInsideCapacitor()) return false;
  if (API_BASE) return false; // VITE_API_URL is set — fetches have a real target
  if (typeof window === "undefined") return false;
  // capacitor:// scheme and https://localhost both expose `localhost` as
  // the hostname. A live-reload dev server would expose a LAN IP or a
  // real hostname instead, in which case relative fetches work.
  return window.location.hostname === "localhost";
}

export function ApiUnreachableOverlay() {
  // Resolve on mount so SSR / first paint never flashes the overlay.
  // The detection is deterministic at boot — no event subscription.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    setVisible(isMisconfiguredCapacitorBuild());
  }, []);

  if (!visible) return null;

  const origin = typeof window !== "undefined" ? window.location.origin : "(unknown)";

  return (
    <div
      role="alertdialog"
      aria-labelledby="api-unreachable-title"
      aria-describedby="api-unreachable-body"
      className="fixed inset-0 z-[100] bg-stone-950/95 backdrop-blur-md flex items-center justify-center p-6"
      style={{
        paddingTop: "max(1.5rem, env(safe-area-inset-top))",
        paddingBottom: "max(1.5rem, env(safe-area-inset-bottom))",
      }}
    >
      <div className="max-w-sm w-full bg-white rounded-2xl shadow-2xl overflow-hidden">
        <div className="bg-amber-50 border-b border-amber-200 px-5 py-4 flex items-center gap-3">
          <AlertTriangle
            className="h-5 w-5 text-amber-600 flex-shrink-0"
            aria-hidden="true"
          />
          <h2
            id="api-unreachable-title"
            className="text-sm font-semibold text-amber-900"
          >
            Backend not configured
          </h2>
        </div>
        <div id="api-unreachable-body" className="px-5 py-5 space-y-4 text-sm">
          <p className="text-stone-700 leading-relaxed">
            This native build has no backend to talk to. Every API
            request from this app would fail silently. Pick one of the
            two paths below before reinstalling.
          </p>

          <div className="bg-stone-50 border border-stone-200 rounded-lg px-3 py-2.5 text-xs space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-stone-500">Loaded from</span>
              <code className="text-stone-900 font-mono">{origin}</code>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-stone-500">API_BASE</span>
              <code className="text-stone-900 font-mono">(empty)</code>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <h3 className="text-xs font-semibold text-stone-900 uppercase tracking-wide mb-1">
                Option 1 — live-reload to your laptop
              </h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                In PowerShell on your laptop:
              </p>
              <pre className="mt-1 bg-stone-900 text-stone-100 text-[11px] leading-snug rounded-md px-2.5 py-2 overflow-x-auto">
{`$env:CAP_SERVER_URL = "http://YOUR-LAN-IP:5000"
npm run dev      # terminal 1
npm run mobile:dev:android  # terminal 2`}
              </pre>
            </div>
            <div>
              <h3 className="text-xs font-semibold text-stone-900 uppercase tracking-wide mb-1">
                Option 2 — point at deployed server
              </h3>
              <p className="text-xs text-stone-600 leading-relaxed">
                Bundle a fixed backend URL into the build:
              </p>
              <pre className="mt-1 bg-stone-900 text-stone-100 text-[11px] leading-snug rounded-md px-2.5 py-2 overflow-x-auto">
{`$env:VITE_API_URL = "https://your-fly-app.fly.dev"
npm run mobile:build`}
              </pre>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ApiUnreachableOverlay;
