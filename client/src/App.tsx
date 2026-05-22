import { useEffect, useState } from "react";
import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/context/AuthContext";
import { InstallAppBanner } from "@/components/InstallAppBanner";
import { ApiUnreachableOverlay } from "@/components/ApiUnreachableOverlay";
import { BrandSplash } from "@/components/BrandSplash";
import { useAuth } from "@/context/AuthContext";
import { useSession } from "@/hooks/useSession";
import { isInsideCapacitor, isSeekerOnlyApp } from "@/lib/installApp";
import { isWalkthroughSeen } from "@/lib/seekerLocalStorage";
import MapPage from "./pages/MapPage";
import FacilityPortal from "./pages/FacilityPortal";
import JobSeekerPage from "./pages/JobSeekerPage";
import StatsPage from "./pages/StatsPage";
import DashboardPage from "./pages/jobseeker/DashboardPage";
import WalkthroughPage from "./pages/jobseeker/WalkthroughPage";
import OnboardingWizard from "./pages/jobseeker/onboarding/OnboardingWizard";
import JobDetailPage from "./pages/jobs/JobDetailPage";
import NotesPage from "./pages/notes/NotesPage";
import MarketingLanding from "./pages/MarketingLanding";
import AuditorPage from "./pages/AuditorPage";
import LegalDocPage from "./pages/legal/LegalDocPage";
import NotFound from "./pages/not-found";
import { LegalAcceptanceModal } from "@/components/legal/LegalAcceptanceModal";

// /facility-portal is the only canonical operations route. All `/portal/*`
// URLs (including the legacy tracker module deep-links) redirect here.
// OperationsTab inside FacilityPortal handles all module navigation
// (residents, eMAR, incidents, CRM, billing, staff, compliance, trackers)
// via in-app sub-view state — there are no longer per-module URLs.
function RedirectToFacilityPortal() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/facility-portal", { replace: true });
  }, [navigate]);
  return null;
}

// Defense-in-depth for the seeker-only native app: any route that
// belongs to the operator surface (facility portal, legacy /portal
// redirects, auditor token landing) gets bounced to the seeker home.
// Web users keep the original components — this guard is computed
// once at module load because Capacitor never flips at runtime.
function SeekerAppBounce() {
  const [, navigate] = useLocation();
  useEffect(() => {
    navigate("/jobseeker/dashboard", { replace: true });
  }, [navigate]);
  return null;
}
const SEEKER_ONLY = isSeekerOnlyApp();
const FacilityPortalRoute = SEEKER_ONLY ? SeekerAppBounce : FacilityPortal;
const NotesPageRoute = SEEKER_ONLY ? SeekerAppBounce : NotesPage;
const AuditorPageRoute = SEEKER_ONLY ? SeekerAppBounce : AuditorPage;
const LegacyPortalRedirect = SEEKER_ONLY
  ? SeekerAppBounce
  : RedirectToFacilityPortal;

// LandingRoute — root `/` behaves differently for web vs native:
//
//   • WEB (ncaref.com): renders MarketingLanding for everyone. The
//     marketing page reads session state and swaps its primary CTA
//     between "Enter the app" (anonymous) and "Go to your portal"
//     (authed), so it doubles as a re-entry point for returning users.
//
//   • CAPACITOR (installed native app): the marketing copy is wasted —
//     these users already chose to install the product. Once session
//     queries resolve we redirect into the right surface so the first
//     thing they see is auth or onboarding, not a marketing page.
//
//     Redirect order:
//       facility session  → /facility-portal
//       seeker session    → /jobseeker/dashboard
//       no session, fresh device (walkthrough never seen) → /jobs/welcome
//       no session, returning device → /job-seeker (auth surface)
function LandingRoute() {
  const [, navigate] = useLocation();
  const { user: jobSeeker, isReady: jobSeekerReady } = useAuth();
  const { data: facility, isLoading: facilityLoading } = useSession();
  const inCapacitor = isInsideCapacitor();
  const sessionsReady = jobSeekerReady && !facilityLoading;

  useEffect(() => {
    if (!inCapacitor || !sessionsReady) return;
    if (facility) {
      navigate("/facility-portal", { replace: true });
      return;
    }
    if (jobSeeker) {
      navigate("/jobseeker/dashboard", { replace: true });
      return;
    }
    navigate(isWalkthroughSeen() ? "/job-seeker" : "/jobs/welcome", {
      replace: true,
    });
  }, [inCapacitor, sessionsReady, facility, jobSeeker, navigate]);

  if (inCapacitor) {
    // Until sessions resolve we render nothing — a blank canvas is less
    // jarring than flashing the marketing landing for 200ms before the
    // redirect fires. The native splash screen is still being torn down
    // at this point anyway.
    return null;
  }
  return <MarketingLanding />;
}

function AppRouter() {
  return (
    <Router hook={useHashLocation}>
      <Switch>
        {/* Root is now the public marketing landing (ncaref.com). */}
        <Route path="/" component={LandingRoute} />
        {/* Map moved off `/` so the marketing landing can claim the front
            door. Unauthenticated visitors who reach the map see the existing
            role-picker dialog auto-open with the map dimmed behind it.
            `/jobs` is a friendlier alias — same component, both URLs work
            so existing links to `/map` never break. */}
        <Route path="/map" component={MapPage} />
        <Route path="/jobs" component={MapPage} />
        <Route path="/stats" component={StatsPage} />
        {/* Dedicated split-pane Notes page (Slice 1 of the Notes redesign).
            Mounted FIRST in the portal subtree so wouter's <Switch> picks it
            before any of the generic /facility-portal/... routes below. */}
        <Route path="/facility-portal/notes" component={NotesPageRoute} />
        {/* URL-driven facility-portal sub-routes (Bug 3).
            Ordered specific → generic so wouter's <Switch> picks the most
            precise match first. Every match renders the same FacilityPortal
            component, which reads its tab + sub-view + selected resident
            from `useFacilityPortalRoute()` so a hard refresh restores the
            exact view the operator was on. */}
        <Route
          path="/facility-portal/operations/residents/:residentId/:residentTab"
          component={FacilityPortalRoute}
        />
        <Route
          path="/facility-portal/operations/residents/:residentId"
          component={FacilityPortalRoute}
        />
        <Route
          path="/facility-portal/operations/tracker/:slug"
          component={FacilityPortalRoute}
        />
        <Route
          path="/facility-portal/operations/tracker"
          component={FacilityPortalRoute}
        />
        <Route
          path="/facility-portal/operations/:subView"
          component={FacilityPortalRoute}
        />
        <Route path="/facility-portal/operations" component={FacilityPortalRoute} />
        <Route path="/facility-portal/:tab" component={FacilityPortalRoute} />
        <Route path="/facility-portal" component={FacilityPortalRoute} />
        <Route path="/job-seeker" component={JobSeekerPage} />
        {/* CareFinder onboarding (Phase 1) — both routes MUST be mounted
            BEFORE the generic `/jobs/:id` below; wouter's <Switch> matches
            top-down and `/jobs/welcome` / `/jobs/onboard` would otherwise
            be swallowed by the `:id` param route. */}
        <Route path="/jobs/welcome" component={WalkthroughPage} />
        <Route path="/jobs/onboard" component={OnboardingWizard} />
        {/* Public job detail page — anonymous-readable; Express Interest
            CTA reuses the existing pendingAction flow for unauth seekers. */}
        <Route path="/jobs/:id" component={JobDetailPage} />
        {/* Job seeker auth + dashboard routes. The canonical auth
            surface is /job-seeker (login + register + verify-email
            tabs). The separate /jobseeker/login page was retired
            because it duplicated the same flow with off-brand chrome. */}
        <Route path="/jobseeker/dashboard" component={DashboardPage} />
        {/* Wave 3 Phase 3.2 — Read-only auditor shell. Token-validated via
            /api/ops/auditor/me; expired/revoked tokens render a friendly
            placeholder. Hash-routed so the URL is `/#/auditor/{token}`. */}
        <Route path="/auditor/:token" component={AuditorPageRoute} />
        {/* Phase 4 — public legal documents. Anonymous-readable so a user
            in the registration clickwrap can open them in a new tab
            before checking the boxes. */}
        <Route path="/legal/:slug" component={LegalDocPage} />
        {/* Legacy /portal/* deep-links → /facility-portal so saved bookmarks
            and shared links keep working. */}
        <Route path="/portal" component={LegacyPortalRedirect} />
        <Route path="/portal/:rest*" component={LegacyPortalRedirect} />
        <Route component={NotFound} />
      </Switch>
      {/* Phase 4 — global legal-acceptance gate. Mounted once at the
          app root so it sits above every page and reacts to changes
          in either the seeker /me or facility /me. The component reads
          the module-level legalState store and renders nothing when
          there is nothing pending. */}
      <LegalAcceptanceModal />
    </Router>
  );
}

// Boot-time brand splash. The native Capacitor splash hands off to
// the WebView after ~1.5s; this component picks up from there with
// the brand-mark reveal so the user never sees a blank canvas while
// React hydrates and the initial session queries resolve.
//
// Hide policy:
//   • Minimum reveal time (BOOT_MIN_MS) so the animation always
//     completes — no half-played reveal on fast networks.
//   • Hide as soon as the seeker + facility sessions both resolve
//     (success or 401) AFTER the minimum elapses.
//   • Hard ceiling (BOOT_MAX_MS) so a stuck query can't trap the
//     user on the splash forever.
const BOOT_MIN_MS = 1400;
const BOOT_MAX_MS = 2500;

function AppBootSplash() {
  const [minElapsed, setMinElapsed] = useState(false);
  const [hardHide, setHardHide] = useState(false);
  const { isReady: seekerReady } = useAuth();
  const { isLoading: facilityLoading } = useSession();

  useEffect(() => {
    const minT = window.setTimeout(() => setMinElapsed(true), BOOT_MIN_MS);
    const maxT = window.setTimeout(() => setHardHide(true), BOOT_MAX_MS);
    return () => {
      window.clearTimeout(minT);
      window.clearTimeout(maxT);
    };
  }, []);

  const sessionsReady = seekerReady && !facilityLoading;
  const visible = !hardHide && !(minElapsed && sessionsReady);

  return <BrandSplash visible={visible} />;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppRouter />
        <Toaster />
        {/* Brand-mark splash. Renders on every fresh app mount and
            fades out once minimum reveal has elapsed AND auth
            sessions have resolved (or a hard 2.5s ceiling hits). */}
        <AppBootSplash />
        {/* Mobile-browser "install the PWA" nudge. Suppresses itself
            inside Capacitor, on desktop, when already-PWA, and for
            14 days after dismissal — see @/lib/installApp. */}
        <InstallAppBanner />
        {/* Native-build misconfiguration safety net. Only renders when
            running inside the Capacitor WebView from bundled assets
            with no VITE_API_URL — otherwise the app would silently
            white-screen on every protected page. */}
        <ApiUnreachableOverlay />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
