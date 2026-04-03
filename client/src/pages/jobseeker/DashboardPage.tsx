import { useEffect } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";

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

  // Guard: redirect unauthenticated visitors to the login page.
  useEffect(() => {
    if (isReady && !user) {
      setLocation("/jobseeker/login");
    }
  }, [user, isReady, setLocation]);

  if (!isReady || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-950">
        <div className="flex items-center gap-3 text-slate-400">
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
    setLocation("/jobseeker/login");
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950">
      {/* Top nav */}
      <header className="border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <div className="flex items-center gap-2.5">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-blue-600" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5} className="h-4 w-4 text-white" aria-hidden="true">
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="M9 12l2 2 4-4" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-slate-800 dark:text-slate-200">
              ARF Care Portal
            </span>
          </div>
          <div className="flex items-center gap-4">
            <span className="hidden text-xs text-slate-500 dark:text-slate-400 sm:block">
              {user.email}
            </span>
            <button
              onClick={handleLogout}
              className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 shadow-sm transition-colors hover:bg-slate-50 hover:text-slate-800 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
        {/* Welcome banner */}
        <div className="mb-8 rounded-xl border border-blue-100 bg-blue-50 px-6 py-5 dark:border-blue-900/40 dark:bg-blue-950/20">
          <h1 className="text-lg font-semibold text-blue-900 dark:text-blue-200">
            Welcome back
          </h1>
          <p className="mt-1 text-sm text-blue-700 dark:text-blue-400">
            Signed in as <strong>{user.email}</strong>. Your profile and
            applications are ready to view.
          </p>
        </div>

        {/* Stat cards */}
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: "Applications", value: "—", icon: "📋" },
            { label: "Saved Jobs", value: "—", icon: "🔖" },
            { label: "Profile Views", value: "—", icon: "👀" },
          ].map(({ label, value, icon }) => (
            <div
              key={label}
              className="rounded-xl border border-slate-200 bg-white px-5 py-4 shadow-sm dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {label}
                </span>
                <span className="text-base" aria-hidden="true">{icon}</span>
              </div>
              <p className="mt-2 text-2xl font-semibold text-slate-800 dark:text-slate-100">
                {value}
              </p>
            </div>
          ))}
        </div>

        {/* Quick links */}
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          <a
            href="#/job-seeker"
            className="group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-slate-600 dark:text-slate-300" aria-hidden="true">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-5.5-2.5a2.5 2.5 0 11-5 0 2.5 2.5 0 015 0zM10 12a5.99 5.99 0 00-4.793 2.39A6.483 6.483 0 0010 16.5a6.483 6.483 0 004.793-2.11A5.99 5.99 0 0010 12z" clipRule="evenodd" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 group-hover:text-blue-600 dark:text-slate-200 dark:group-hover:text-blue-400">
                Complete Your Profile
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Add experience, certifications, and job preferences.
              </p>
            </div>
          </a>

          <a
            href="#/"
            className="group flex items-start gap-4 rounded-xl border border-slate-200 bg-white p-5 shadow-sm transition-shadow hover:shadow-md dark:border-slate-800 dark:bg-slate-900"
          >
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 dark:bg-slate-800">
              <svg viewBox="0 0 20 20" fill="currentColor" className="h-5 w-5 text-slate-600 dark:text-slate-300" aria-hidden="true">
                <path fillRule="evenodd" d="M6 6V5a3 3 0 013-3h2a3 3 0 013 3v1h2a2 2 0 012 2v3.57A22.952 22.952 0 0110 13a22.95 22.95 0 01-8-1.43V8a2 2 0 012-2h2zm2-1a1 1 0 011-1h2a1 1 0 011 1v1H8V5zm1 5a1 1 0 011-1h.01a1 1 0 110 2H10a1 1 0 01-1-1z" clipRule="evenodd" />
                <path d="M2 13.692V16a2 2 0 002 2h12a2 2 0 002-2v-2.308A24.974 24.974 0 0110 15c-2.796 0-5.487-.46-8-1.308z" />
              </svg>
            </div>
            <div>
              <p className="text-sm font-semibold text-slate-800 group-hover:text-blue-600 dark:text-slate-200 dark:group-hover:text-blue-400">
                Browse Job Opportunities
              </p>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                Explore open positions at care facilities near you.
              </p>
            </div>
          </a>
        </div>
      </main>
    </div>
  );
}
