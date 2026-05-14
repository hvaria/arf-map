import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { User as UserIcon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getQueryFn } from "@/lib/queryClient";
import { MyInterestsTab, type SeekerInterest } from "@/components/MyInterestsTab"; // NEW: expression-of-interest
import { AppHeader } from "@/components/layout/AppHeader";
import { CredentialBadge, useCredentials } from "@/components/CredentialBadge";

interface JobSeekerProfileLite {
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
  phone: string | null;
  city: string | null;
  jobTypes: string[] | null;
}

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
  const { user, isReady } = useAuth();
  const [, setLocation] = useLocation();

  // NEW: expression-of-interest — live Applications count
  const { data: interests = [] } = useQuery<SeekerInterest[]>({
    queryKey: ["/api/jobseeker/interests"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!user,
    staleTime: 30000,
  });

  // Profile fetch — same query key as JobSeekerPage, so the cache is
  // shared. Used for avatar + display-name + the "profile complete"
  // signal on the quick-link card.
  const { data: profile } = useQuery<JobSeekerProfileLite | null>({
    queryKey: ["/api/jobseeker/profile"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!user,
    staleTime: 60000,
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

  // Sign-out flows through the AppHeader's account chip → useAppHeaderAuth,
  // which calls AuthContext.logout(). The old inline button is retired.

  // Derived bits — display name + avatar + "is the profile filled in".
  // displayName falls back to the email's local-part (same convention as
  // JobSeekerPage's read-only profile card) so a brand-new seeker who
  // hasn't set firstName/lastName still gets a personal greeting.
  const fullName = profile
    ? [profile.firstName, profile.lastName].filter(Boolean).join(" ") || null
    : null;
  const displayName = fullName ?? user.email.split("@")[0];
  const avatarUrl = profile?.profilePictureUrl ?? null;
  // Match the JobSeekerPage "profile complete" criteria so the quick-link
  // card on the dashboard agrees with the badge on the profile page.
  const isProfileComplete = !!(
    profile?.firstName &&
    profile.city &&
    profile.phone &&
    profile.jobTypes &&
    profile.jobTypes.length > 0
  );

  return (
    <div className="min-h-screen bg-white">
      {/* Unified AppHeader — no back button (this surface IS the seeker
          home), account chip on the right surfaces identity + sign-out. */}
      <AppHeader />

      {/* Main content */}
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 space-y-4">
        {/* Welcome row — avatar on the left, name + email beneath.
            Replaces the old plain "Welcome back" heading so a returning
            seeker recognises themself at a glance. */}
        <div className="flex items-center gap-3">
          <div className="w-12 h-12 rounded-full bg-stone-200 flex items-center justify-center shrink-0 overflow-hidden">
            {avatarUrl ? (
              <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
            ) : (
              <UserIcon className="h-6 w-6 text-stone-500" aria-hidden="true" />
            )}
          </div>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold truncate" style={{ color: "#1E1B4B" }}>
              Hi {displayName}
            </h1>
            <p className="text-sm text-muted-foreground truncate">{user.email}</p>
          </div>
        </div>

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
            {/* Avatar-as-icon — shows the seeker's actual photo when
                uploaded so the card stops reading as an anonymous
                "complete your profile" stub for users who already did. */}
            <div className="h-9 w-9 flex-shrink-0 rounded-full overflow-hidden bg-stone-200 flex items-center justify-center">
              {avatarUrl ? (
                <img src={avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                <UserIcon className="h-5 w-5 text-stone-500" aria-hidden="true" />
              )}
            </div>
            <div>
              <p className="text-sm font-semibold" style={{ color: "#1E1B4B" }}>
                {isProfileComplete ? "My profile" : "Complete your profile"}
              </p>
              <p className="mt-0.5 text-xs" style={{ color: "#6B7280" }}>
                {isProfileComplete
                  ? "Update your phone, experience, or credentials."
                  : "Add experience, credentials, and job preferences."}
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
