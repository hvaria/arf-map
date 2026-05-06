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
// Portal — Facility Operations Module
import PortalDashboard from "./pages/portal/PortalDashboard";
import ResidentsPage from "./pages/portal/ResidentsPage";
import ResidentProfilePage from "./pages/portal/ResidentProfilePage";
import EmarPage from "./pages/portal/EmarPage";
import IncidentsPage from "./pages/portal/IncidentsPage";
import CrmPage from "./pages/portal/CrmPage";
import AdmissionsPage from "./pages/portal/AdmissionsPage";
import BillingPage from "./pages/portal/BillingPage";
import StaffPage from "./pages/portal/StaffPage";
import CompliancePage from "./pages/portal/CompliancePage";
import NotesPortalPage from "./pages/portal/NotesPortalPage";
// Portal — Tracker Module routes
import TrackerLandingPage from "./pages/tracker/TrackerLandingPage";
import TrackerHomePage from "./pages/tracker/TrackerHomePage";

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
        {/* Portal — Facility Operations Module routes */}
        <Route path="/portal" component={PortalDashboard} />
        <Route path="/portal/residents" component={ResidentsPage} />
        <Route path="/portal/residents/:id" component={ResidentProfilePage} />
        <Route path="/portal/emar" component={EmarPage} />
        <Route path="/portal/incidents" component={IncidentsPage} />
        <Route path="/portal/crm" component={CrmPage} />
        <Route path="/portal/admissions/:id" component={AdmissionsPage} />
        <Route path="/portal/billing" component={BillingPage} />
        <Route path="/portal/staff" component={StaffPage} />
        <Route path="/portal/compliance" component={CompliancePage} />
        <Route path="/portal/notes" component={NotesPortalPage} />
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
