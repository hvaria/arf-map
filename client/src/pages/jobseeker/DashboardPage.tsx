import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { User as UserIcon } from "lucide-react";
import { useAuth } from "@/context/AuthContext";
import { getQueryFn } from "@/lib/queryClient";
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
  // Auto-opens once for a brand-new seeker whose /profile returns null so
  // the first thing they see is the form to fill out.
  const [editingProfile, setEditingProfile] = useState(false);
  const didAutoOpen = useRef(false);

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

  // First-time seekers (no profile row yet) get the editor expanded on
  // first visit so the very first action is "fill out my profile".
  useEffect(() => {
    if (!didAutoOpen.current && profile === null) {
      didAutoOpen.current = true;
      setEditingProfile(true);
    }
  }, [profile]);

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

  // Derived bits — first-name greeting + avatar.
  // Prefer the profile's firstName (BA copy: "Hi {firstName}"); fall back
  // to the email's local part for brand-new seekers who haven't filled
  // in their name yet, so the greeting still feels personal.
  const firstName = profile?.firstName?.trim() || null;
  const displayName = firstName ?? user.email.split("@")[0];
  const avatarUrl = profile?.profilePictureUrl ?? null;

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
            <p className="text-sm text-muted-foreground truncate">Welcome back</p>
          </div>
        </div>

        {/* Stat tiles — operator KPI tile pattern (rounded-lg p-3 + soft
            indigo neutral; status tones reserved for actual status values). */}
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
