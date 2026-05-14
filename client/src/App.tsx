import { useEffect } from "react";
import { Switch, Route, Router, useLocation } from "wouter";
import { useHashLocation } from "wouter/use-hash-location";
import { QueryClientProvider } from "@tanstack/react-query";
import { queryClient } from "./lib/queryClient";
import { Toaster } from "@/components/ui/toaster";
import { AuthProvider } from "@/context/AuthContext";
import MapPage from "./pages/MapPage";
import FacilityPortal from "./pages/FacilityPortal";
import JobSeekerPage from "./pages/JobSeekerPage";
import StatsPage from "./pages/StatsPage";
import LoginPage from "./pages/jobseeker/LoginPage";
import DashboardPage from "./pages/jobseeker/DashboardPage";
import JobDetailPage from "./pages/jobs/JobDetailPage";
import NotesPage from "./pages/notes/NotesPage";
import MarketingLanding from "./pages/MarketingLanding";
import NotFound from "./pages/not-found";

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

// LandingRoute — root `/` is the public marketing page (ncaref.com front door).
// The marketing page itself reads session state and swaps its primary CTA
// between "Enter the app" (anonymous) and "Go to your portal" (authed), so
// we render it for everyone and stop auto-redirecting authed users away.
function LandingRoute() {
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
        <Route path="/facility-portal" component={FacilityPortal} />
        {/* Dedicated split-pane Notes page (Slice 1 of the Notes redesign).
            Mounted above the catch-all and below the portal entry. */}
        <Route path="/facility-portal/notes" component={NotesPage} />
        <Route path="/job-seeker" component={JobSeekerPage} />
        {/* Public job detail page — anonymous-readable; Express Interest
            CTA reuses the existing pendingAction flow for unauth seekers. */}
        <Route path="/jobs/:id" component={JobDetailPage} />
        {/* Job seeker auth + dashboard routes */}
        <Route path="/jobseeker/login" component={LoginPage} />
        <Route path="/jobseeker/dashboard" component={DashboardPage} />
        {/* Legacy /portal/* deep-links → /facility-portal so saved bookmarks
            and shared links keep working. */}
        <Route path="/portal" component={RedirectToFacilityPortal} />
        <Route path="/portal/:rest*" component={RedirectToFacilityPortal} />
        <Route component={NotFound} />
      </Switch>
    </Router>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppRouter />
        <Toaster />
      </AuthProvider>
    </QueryClientProvider>
  );
}

export default App;
