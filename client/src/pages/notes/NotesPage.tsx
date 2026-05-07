/**
 * NotesPage — dedicated split-pane Notes view at `/facility-portal/notes`.
 *
 * Slice 1 of the Notes module redesign. Reuses the existing `/api/ops/notes`
 * endpoints; no backend changes. Auth-gated against `useQuery(["/api/facility/me"])`
 * mirroring the FacilityPortal session pattern. If unauthenticated, redirects
 * back to `/facility-portal` so the user lands on the login screen.
 *
 * Slice 2: also gated behind the `notes_dedicated_page` beta feature flag.
 * Non-super-admin users whose facility is not in
 * `VITE_NOTES_DEDICATED_PAGE_FACILITIES` are redirected to `/facility-portal`.
 */
import { useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";
import { NotesPageShell } from "@/components/notes/NotesPageShell";
import { useFeatureFlag } from "@/lib/featureFlags";

interface SessionUser {
  id: number;
  facilityNumber: string;
  username: string;
  email: string;
  emailVerified: number;
  role?: string;
  displayName?: string;
}

export default function NotesPage() {
  const [, navigate] = useLocation();

  const { data: me, isLoading } = useQuery<SessionUser | null>({
    queryKey: ["/api/facility/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: true,
  });

  const dedicatedPageEnabled = useFeatureFlag("notes_dedicated_page");

  // Auth gate — push unauthenticated users back to the portal entry so they
  // can log in. Use an effect (not a render-time navigate) to avoid setState-
  // during-render warnings.
  useEffect(() => {
    if (!isLoading && !me) {
      navigate("/facility-portal", { replace: true });
    }
  }, [isLoading, me, navigate]);

  // Beta-flag gate — runs in parallel to the auth gate. Only redirect once
  // we know the user is authenticated; otherwise the auth gate handles it.
  useEffect(() => {
    if (!isLoading && me && !dedicatedPageEnabled) {
      navigate("/facility-portal", { replace: true });
    }
  }, [isLoading, me, dedicatedPageEnabled, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center text-sm text-muted-foreground">
        Loading…
      </div>
    );
  }

  if (!me) {
    // Brief blank flash while the redirect effect runs.
    return null;
  }

  if (!dedicatedPageEnabled) {
    // Brief blank flash while the flag-redirect effect runs.
    return null;
  }

  return <NotesPageShell facilityNumber={me.facilityNumber} />;
}
