import { Switch, Route, Router } from "wouter";
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
import NotFound from "./pages/not-found";
// Portal — Tracker Module routes (live)
import TrackerLandingPage from "./pages/tracker/TrackerLandingPage";
import TrackerHomePage from "./pages/tracker/TrackerHomePage";

// NOTE on the Operations Module routes:
// The individual `/portal/*` pages (PortalDashboard, ResidentsPage, EmarPage,
// IncidentsPage, CrmPage, AdmissionsPage, BillingPage, StaffPage,
// CompliancePage, NotesPortalPage) used to be live as standalone routes.
// They are NOT live anymore — the canonical entry is /facility-portal,
// which renders OperationsTab inline and embeds those modules' *Content
// exports (ResidentsContent, EmarContent, etc.) directly.
// The page files are kept because OperationsTab still imports the
// *Content named exports from them.

function AppRouter() {
  return (
    <Router hook={useHashLocation}>
      <Switch>
        {/* Existing routes — DO NOT MODIFY */}
        <Route path="/" component={MapPage} />
        <Route path="/stats" component={StatsPage} />
        <Route path="/facility-portal" component={FacilityPortal} />
        <Route path="/job-seeker" component={JobSeekerPage} />
        {/* Job seeker auth + dashboard routes */}
        <Route path="/jobseeker/login" component={LoginPage} />
        <Route path="/jobseeker/dashboard" component={DashboardPage} />
        {/* Tracker Module — landing + per-tracker home (with optional tab segment) */}
        <Route path="/portal/tracker" component={TrackerLandingPage} />
        <Route path="/portal/tracker/:slug" component={TrackerHomePage} />
        <Route path="/portal/tracker/:slug/:tab" component={TrackerHomePage} />
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
