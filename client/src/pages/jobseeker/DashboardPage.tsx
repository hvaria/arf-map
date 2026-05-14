import { useEffect } from "react";
import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { getQueryFn } from "@/lib/queryClient";
import { MyInterestsTab, type SeekerInterest } from "@/components/MyInterestsTab"; // NEW: expression-of-interest
import { BrandLogo } from "@/components/BrandLogo";
import { CredentialBadge, useCredentials } from "@/components/CredentialBadge";

/**
 * DashboardPage — protected route for authenticated job seekers.
 *
 * This is a functional skeleton.  Extend it by:
 *   - Fetching GET /api/jobseeker/profile for the candidate's full profile
 *   - Fetching GET /api/jobs for recommended job listings
 *   - Adding a Snowflake-backed analytics widget for application insights
 *   - Integrating a notification panel for interview invitations
 */
export default function DashboardPage() {
  const { user, isReady, logout } = useAuth();
  const [, setLocation] = useLocation();

  // NEW: expression-of-interest — live Applications count
  const { data: interests = [] } = useQuery<SeekerInterest[]>({
    queryKey: ["/api/jobseeker/interests"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!user,
    staleTime: 30000,
  });

  // Credentials chip strip — same shared cache the ProfileEditor
  // section writes to, so additions show up here without a refetch.
  const { data: credentials } = useCredentials({ enabled: !!user });
  const credentialList = credentials ?? [];

  // Guard: redirect unauthenticated visitors to the login page.
  useEffect(() => {
    if (isReady && !user) {
      setLocation("/jobseeker/login");
    }
  }, [user, isReady, setLocation]);

  if (!isReady || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white">
        <div className="flex items-center gap-3" style={{ color: "#6B7280" }}>
          <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="text-sm">Loading…</span>
        </div>
      </div>
    );
  }

  const handleLogout = async () => {
    await logout();
    // Send the (now-anonymous) user back to the map. The role-picker dialog
    // there auto-opens for unauthenticated visitors, so sign-in is one click
    // away if they want to come back.
    setLocation("/map");
  };

  return (
    <div className="min-h-screen bg-white">
      {/* Top nav — neutral white shell matching Operations tab. The
          previous indigo→pink gradient header has been dropped to unify
          the visual language across seeker and operator surfaces. */}
      <header className="border-b bg-white" style={{ borderColor: "var(--portal-border-subtle)" }}>
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          {/* Brand mark — clickable, returns the user to the map (in-app home). */}
          <Link
            href="/map"
            className="flex items-center hover:opacity-90 transition-opacity"
            aria-label="Back to map"
          >
            <BrandLogo size={44} />
          </Link>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-muted-foreground sm:block">
              {user.email}
            </span>
            <button
              onClick={handleLogout}
              className="rounded-md px-3 py-1.5 text-xs font-medium border border-stone-200 bg-white text-stone-700 hover:bg-stone-50 transition-colors"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-4">
        {/* Welcome heading — canonical operator page-title shape. */}
        <h1 className="text-xl font-semibold" style={{ color: "#1E1B4B" }}>
          Welcome back
        </h1>
        <p className="text-sm text-muted-foreground -mt-2">
          Signed in as <strong className="font-medium" style={{ color: "#1E1B4B" }}>{user.email}</strong>. Your profile and applications are ready to view.
        </p>

        {/* Stat tiles — operator KPI tile pattern (rounded-lg p-3 + soft
            indigo neutral; status tones reserved for actual status values). */}
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Applications", value: String(interests.length), icon: "📋" },
            { label: "Saved Jobs", value: "—", icon: "🔖" },
            { label: "Profile Views", value: "—", icon: "👀" },
          ].map(({ label, value, icon }) => (
            <div
              key={label}
              className="rounded-lg p-3 text-center"
              style={{ background: "#F0F4FF", border: "1px solid #E0E7FF" }}
            >
              <p className="portal-eyebrow flex items-center justify-center gap-1">
                <span aria-hidden="true">{icon}</span>
                {label}
              </p>
              <p className="mt-1 text-xl font-bold portal-num" style={{ color: "#1E1B4B" }}>
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* Credentials — chip strip of saved credentials/clearances.
            Sourced from the same React Query cache the ProfileEditor
            CredentialsSection writes to; empty state nudges the user
            to the profile page rather than embedding the editor here. */}
        <div className="pt-4">
          <h2 className="text-sm font-semibold mb-2" style={{ color: "#1E1B4B" }}>
            Credentials
          </h2>
          {credentialList.length > 0 ? (
            <div className="flex flex-wrap gap-1.5">
              {credentialList.map((c) => (
                <CredentialBadge key={c.id} credential={c} />
              ))}
            </div>
          ) : (
            <a
              href="#/job-seeker"
              className="inline-flex items-center text-xs font-medium text-indigo-700 hover:underline"
            >
              Add credentials to your profile →
            </a>
          )}
        </div>

        {/* My Applications list */}
        <div className="pt-4">
          <h2 className="text-sm font-semibold mb-3" style={{ color: "#1E1B4B" }}>
            My Applications
          </h2>
          <MyInterestsTab />
        </div>

        {/* Quick links */}
        <div className="pt-4 grid gap-4 sm:grid-cols-2">
          <a
            href="#/job-seeker"
            className="group flex items-start gap-4 rounded-xl p-5 transition-shadow hover:shadow-md"
            style={{ background: "#F0F4FF", border: "1px solid #E0E7FF" }}
          >
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: "#EEF2FF" }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" style={{ color: "#818CF8" }} aria-hidden="true">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-5.5-2.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM10 12a5.99 5.99 0 00-4.793 2.39A6.483 6.483 0 0010 16.5a6.483 6.483 0 004.793-2.11A5.99 5.99 0 0010 12z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#1E1B4B" }}>
                Complete Your Profile
              </p>
              <p className="mt-0.5 text-xs" style={{ color: "#6B7280" }}>
                Add experience, certifications, and job preferences.
              </p>
            </div>
          </a>

          <a
            href="#/map"
            className="group flex items-start gap-4 rounded-xl p-5 transition-shadow hover:shadow-md"
            style={{ background: "#F0F4FF", border: "1px solid #E0E7FF" }}
          >
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg" style={{ background: "#EEF2FF" }}>
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5" style={{ color: "#818CF8" }} aria-hidden="true">
                <path fillRule="evenodd" d="M6 6V5a3 3 0 013-3h2a3 3 0 013 3v1h2a2 2 0 012 2v3.57A22.952 22.952 0 0110 13a22.95 22.95 0 01-8-1.43V8a2 2 0 012-2h2zm2-1a1 1 0 011-1h2a1 1 0 011 1v1H8V5zm1 5a1 1 0 011-1h.01a1 1 0 110 2H10a1 1 0 01-1-1z" clipRule="evenodd" />
                <path d="M2 13.692V16a2 2 0 002 2h12a2 2 0 002-2v-2.308A24.974 24.974 0 0110 15c-2.796 0-5.487-.46-8-1.308z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#1E1B4B" }}>
                Browse Job Opportunities
              </p>
              <p className="mt-0.5 text-xs" style={{ color: "#6B7280" }}>
                Explore open positions at care facilities near you.
              </p>
            </div>
          </a>
        </div>
      </main>
    </div>
  );
}
