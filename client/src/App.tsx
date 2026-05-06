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
