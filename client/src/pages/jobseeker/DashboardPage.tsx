import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/context/AuthContext";
import { getQueryFn } from "@/lib/queryClient";
import { isOnboardingDismissed } from "@/lib/seekerLocalStorage";
import { BrandLoader } from "@/components/BrandLoader";
import { MyInterestsTab, type SeekerInterest } from "@/components/MyInterestsTab"; // NEW: expression-of-interest
import { AppHeader } from "@/components/layout/AppHeader";
import { CredentialBadge, useCredentials } from "@/components/CredentialBadge";
import { Card, CardContent } from "@/components/ui/card";
import { SeekerProfileCard } from "@/components/seeker/SeekerProfileCard";
import {
  SeekerProfileEditor,
  type JobSeekerProfile,
} from "@/components/seeker/SeekerProfileEditor";

/**
 * DashboardPage — canonical home for authenticated job seekers.
 *
 * Surfaces, in order: welcome row, stat tiles, profile card + inline
 * editor, credentials chip strip, applications list, and a single
 * right-aligned "Find jobs" link. The previous 2-up quick-link grid was
 * dropped because (a) "complete your profile" is now redundant (the
 * profile lives on this page) and (b) the second card's only purpose
 * was to deep-link back to the map, which the single link does for less
 * weight.
 */
export default function DashboardPage() {
  const { user, isReady } = useAuth();
  const [, setLocation] = useLocation();

  // Profile-editor visibility — opens inline below the read-only card.
  // The wizard at /jobs/onboard handles the "brand-new seeker" path, so
  // we no longer auto-open the inline editor here (the dashboard is
  // post-onboarding; the wizard is pre-onboarding).
  const [editingProfile, setEditingProfile] = useState(false);

  // NEW: expression-of-interest — live Applications count
  const { data: interests = [] } = useQuery<SeekerInterest[]>({
    queryKey: ["/api/jobseeker/interests"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!user,
    staleTime: 30000,
  });

  // Profile fetch — same query key as JobSeekerPage, so the cache is
  // shared. Used for avatar + display-name + the "profile complete"
  // signal and as the source of truth for the profile card / editor.
  const { data: profile } = useQuery<JobSeekerProfile | null>({
    queryKey: ["/api/jobseeker/profile"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!user,
    staleTime: 60000,
  });

  // CareFinder onboarding (Phase 1) — brand-new seekers (no profile
  // row yet) get pushed into the dedicated wizard at /jobs/onboard
  // instead of seeing the dashboard with an empty profile card.
  // `seeker.onboardingDismissed` opts the seeker out (they can always
  // edit the profile inline from this page); the flag is cleared by
  // AuthContext.logout() so a different account on the same device
  // gets a fresh shot.
  useEffect(() => {
    if (profile !== null) return; // still loading OR already has data
    if (isOnboardingDismissed()) return;
    setLocation("/jobs/onboard", { replace: true });
  }, [profile, setLocation]);

  // Credentials chip strip — same shared cache the ProfileEditor
  // section writes to, so additions show up here without a refetch.
  const { data: credentials } = useCredentials({ enabled: !!user });
  const credentialList = credentials ?? [];

  // Guard: redirect unauthenticated visitors to the auth surface
  // (login + register + verify-email tabs).
  useEffect(() => {
    if (isReady && !user) {
      setLocation("/job-seeker");
    }
  }, [user, isReady, setLocation]);

  if (!isReady || !user) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#FFF8F1]">
        <BrandLoader size="md" label="Loading…" />
      </div>
    );
  }

  // Sign-out flows through the AppHeader's account chip → useAppHeaderAuth,
  // which calls AuthContext.logout(). The old inline button is retired.

  return (
    <div className="min-h-screen bg-white">
      {/* Unified AppHeader — same `variant="glass"` configuration as
          MapPage so the seeker-app's two main surfaces (map + dashboard)
          share the exact same header chrome. No back button (this
          surface IS the seeker home); account chip on the right
          surfaces identity + sign-out. */}
      <AppHeader variant="glass" />

      {/* Main content. Mobile uses `p-3` matching MapPage's overlay
          padding so both surfaces sit the same distance below the
          AppHeader. Desktop falls through to sm:p-6 sm:py-8. */}
      <main className="mx-auto max-w-5xl p-3 sm:p-6 sm:py-8 space-y-4">
        {/* Stat tiles — operator KPI tile pattern (rounded-lg p-3 + soft
            indigo neutral; status tones reserved for actual status values).
            The previous welcome row (avatar + "Hi {firstName}") was
            removed: SeekerProfileCard below already shows a 64px avatar,
            the full name, email, and city, so the welcome row was a
            visual duplicate ~200px above its real source of truth. */}
        <div className="grid gap-3 sm:grid-cols-3">
          {[
            { label: "Jobs applied to", value: String(interests.length), icon: "📋" },
            { label: "Saved for later", value: "—", icon: "🔖" },
            { label: "Times facilities viewed you", value: "—", icon: "👀" },
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

        {/* Profile — read-only card by default with an inline Edit button
            that swaps to the editor on the same page. Mirrors the visual
            language used by /#/job-seeker so both surfaces share one
            component and one query cache. */}
        <div className="pt-4">
          {editingProfile ? (
            <Card>
              <CardContent className="pt-5">
                <SeekerProfileEditor
                  profile={profile ?? null}
                  onSaved={() => setEditingProfile(false)}
                />
              </CardContent>
            </Card>
          ) : (
            <SeekerProfileCard
              profile={profile ?? null}
              email={user.email}
              onEdit={() => setEditingProfile(true)}
            />
          )}
        </div>

        {/* Credentials — chip strip of saved credentials/clearances.
            Sourced from the same React Query cache the ProfileEditor
            CredentialsSection writes to; empty state nudges the user
            to open the inline editor rather than navigate elsewhere. */}
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
            <button
              type="button"
              onClick={() => setEditingProfile(true)}
              className="inline-flex items-center text-xs font-medium text-indigo-700 hover:underline bg-transparent border-0 p-0 cursor-pointer"
            >
              Add credentials to your profile →
            </button>
          )}
        </div>

        {/* My Applications list */}
        <div className="pt-4">
          <h2 className="text-sm font-semibold mb-3" style={{ color: "#1E1B4B" }}>
            My Applications
          </h2>
          <MyInterestsTab />
        </div>

        {/* Find-jobs link — replaces the old 2-up quick-link card grid.
            The first card ("Complete your profile") is redundant now
            that the profile is on this page; the second was a heavy
            duplicate of the map button. A single right-aligned text
            link keeps the affordance without the visual weight. */}
        <div className="pt-4 flex justify-end">
          <a
            href="#/jobs"
            className="text-sm font-medium hover:underline"
            style={{ color: "#4F46E5" }}
          >
            Find jobs →
          </a>
        </div>
      </main>
    </div>
  );
}
