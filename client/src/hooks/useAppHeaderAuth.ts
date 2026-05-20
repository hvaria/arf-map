/**
 * useAppHeaderAuth — unified view of the current user for the AppHeader.
 *
 * The app has two parallel auth systems (facility + job seeker). Every
 * page that needs to render a "who am I" affordance has to reconcile
 * them in its own way; this hook centralises that so the new AppHeader
 * has one shape to read from.
 *
 * Precedence: facility wins if both sessions are present (operator dash
 * is the higher-trust surface and the only one with role-specific UI).
 */
import { useCallback, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "@/hooks/useSession";
import { useAuth } from "@/context/AuthContext";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { isSeekerOnlyApp } from "@/lib/installApp";

interface SeekerHeaderProfile {
  firstName: string | null;
  lastName: string | null;
  profilePictureUrl: string | null;
}

export type AppHeaderRole = "facility" | "jobseeker" | "anon";

export interface AppHeaderAuth {
  role: AppHeaderRole;
  displayName: string | null;
  email: string | null;
  /** Up to 2 chars derived from displayName / email. */
  initials: string | null;
  /**
   * For job seekers, the profilePictureUrl from /api/jobseeker/profile
   * (data URL or remote URL). Null for facility / anon, and null for
   * seekers who haven't uploaded a photo — caller renders initials.
   */
  avatarUrl: string | null;
  homePath: "/facility-portal" | "/jobseeker/dashboard" | "/map" | "/job-seeker";
  roleLabel: "Operator" | "Seeker" | null;
  signOut: () => Promise<void>;
}

function computeInitials(source: string | null): string | null {
  if (!source) return null;
  const trimmed = source.trim();
  if (!trimmed) return null;
  // Use the local part of an email if we were handed an email-shaped string.
  const base = trimmed.includes("@") ? trimmed.split("@")[0] : trimmed;
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return null;
  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export function useAppHeaderAuth(): AppHeaderAuth {
  const qc = useQueryClient();
  const { data: facilityRaw } = useSession();
  const { user: seeker, logout: seekerLogout } = useAuth();

  // In the seeker-only native app a facility session is logically
  // impossible — there's no UI path to facility login. Treat any
  // stray cookie as nonexistent so the header never flips to operator
  // chrome inside the seeker app even if an old session lingers.
  const facility = isSeekerOnlyApp() ? null : facilityRaw;

  // Seeker profile (avatar + name). Shares the queryKey used by every
  // other place that reads the profile (JobSeekerPage, DashboardPage,
  // ExpressInterestButton's ProfilePreview), so no duplicate fetch and
  // any save invalidates everywhere at once.
  const { data: seekerProfile } = useQuery<SeekerHeaderProfile | null>({
    queryKey: ["/api/jobseeker/profile"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    enabled: !!seeker,
    staleTime: 60000,
  });

  // Stable callbacks — declared at top-level so hook order never changes
  // across renders even as facility / seeker presence flips.
  const facilitySignOut = useCallback(async () => {
    try {
      await apiRequest("POST", "/api/facility/logout");
    } finally {
      // Clear both the canonical session cache key and the legacy
      // ["facility-session"] key (kept for compat with older call sites).
      qc.setQueryData(["/api/facility/me"], null);
      qc.invalidateQueries({ queryKey: ["/api/facility/me"] });
      qc.invalidateQueries({ queryKey: ["facility-session"] });
    }
  }, [qc]);

  const seekerSignOut = useCallback(async () => {
    await seekerLogout();
  }, [seekerLogout]);

  const anonSignOut = useCallback(async () => {
    /* no-op for anonymous users */
  }, []);

  return useMemo<AppHeaderAuth>(() => {
    // Facility takes precedence.
    if (facility) {
      const displayName =
        facility.username || `Facility #${facility.facilityNumber}`;
      return {
        role: "facility",
        displayName,
        email: null,
        initials: computeInitials(displayName),
        avatarUrl: null,
        homePath: "/facility-portal",
        roleLabel: "Operator",
        signOut: facilitySignOut,
      };
    }

    if (seeker) {
      const email = seeker.email ?? null;
      // Prefer firstName + lastName from the profile when set; fall
      // back to the email's local part (matches the convention used by
      // JobSeekerPage's read-only card and DashboardPage's greeting).
      const fullName = seekerProfile
        ? [seekerProfile.firstName, seekerProfile.lastName].filter(Boolean).join(" ") || null
        : null;
      const displayName = fullName ?? (email ? email.split("@")[0] : null);
      return {
        role: "jobseeker",
        displayName,
        email,
        initials: computeInitials(displayName ?? email),
        avatarUrl: seekerProfile?.profilePictureUrl ?? null,
        homePath: "/jobseeker/dashboard",
        roleLabel: "Seeker",
        signOut: seekerSignOut,
      };
    }

    return {
      role: "anon",
      displayName: null,
      email: null,
      initials: null,
      avatarUrl: null,
      // Seeker-only app: brand-logo "home" for anon goes to the seeker
      // auth surface, not the map (which in the seeker app would just
      // redirect them back here anyway — see MapPage's gate).
      homePath: isSeekerOnlyApp() ? "/job-seeker" : "/map",
      roleLabel: null,
      signOut: anonSignOut,
    };
  }, [facility, seeker, seekerProfile, facilitySignOut, seekerSignOut, anonSignOut]);
}
