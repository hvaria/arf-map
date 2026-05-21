import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import {
  getCurrentJobSeeker,
  loginJobSeeker,
  logoutJobSeeker,
  type JobSeekerProfile,
  type LoginCredentials,
  type ApiError,
} from "@/lib/auth";
import { queryClient } from "@/lib/queryClient";
import { clearSeekerSessionLocalStorage } from "@/lib/seekerLocalStorage";
import {
  refreshCsrfTokenFromMe,
  setCsrfToken,
  setCsrfTokenFromMeBody,
} from "@/lib/csrfToken";

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthState {
  /** null = not loaded yet, undefined = not logged in, object = authenticated */
  user: JobSeekerProfile | null | undefined;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login(credentials: LoginCredentials): Promise<void>;
  logout(): Promise<void>;
  /** Directly set the authenticated user — used after OTP verification. */
  setUser(profile: JobSeekerProfile | undefined): void;
  /** True once the initial session check has completed. */
  isReady: boolean;
}

// ── Context ───────────────────────────────────────────────────────────────────

const AuthContext = createContext<AuthContextValue | null>(null);

// ── Provider ──────────────────────────────────────────────────────────────────

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null, // null = still checking
    isLoading: false,
  });

  // Phase 1 CSRF — global cache subscriber. Any place in the app that hits
  // /api/facility/me or /api/jobseeker/me (useSession, useQuery in
  // FacilityPortal, NotesPage's auth gate, etc.) drops its response into the
  // shared TanStack Query cache. Subscribing here means we capture csrfToken
  // exactly once per fetch regardless of which consumer made the call. The
  // alternative — auditing every call site — leaves landmines for future
  // pages that read /me directly.
  useEffect(() => {
    const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
      if (event.type !== "updated") return;
      const key = event.query.queryKey;
      if (!Array.isArray(key) || key.length === 0) return;
      const first = key[0];
      if (
        first !== "/api/facility/me" &&
        first !== "/api/jobseeker/me"
      ) {
        return;
      }
      // The data may be null (401-returnNull), an object (200 body), or
      // a stale value during refetch. setCsrfTokenFromMeBody tolerates all.
      setCsrfTokenFromMeBody(event.query.state.data);
    });
    return () => unsubscribe();
  }, []);

  // On mount, rehydrate the session from the server cookie.
  // Also sync to React Query cache so any useQuery(["/api/jobseeker/me"])
  // observers (e.g. MapPage) see the result without making a second request.
  useEffect(() => {
    getCurrentJobSeeker()
      .then((profile) => {
        console.log("[AuthProvider] /me result:", profile);
        setState({ user: profile ?? undefined, isLoading: false });
        queryClient.setQueryData(["/api/jobseeker/me"], profile ?? null);
      })
      .catch((err) => {
        console.error("[AuthProvider] /me error:", err);
        setState({ user: undefined, isLoading: false });
        queryClient.setQueryData(["/api/jobseeker/me"], null);
      });
  }, []);

  // CS-06: re-validate session when the tab becomes visible again so a
  // background session invalidation (logout on another tab, password reset,
  // server-side session purge) is reflected promptly without a page reload.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        getCurrentJobSeeker()
          .then((profile) => {
            setState({ user: profile ?? undefined, isLoading: false });
            queryClient.setQueryData(["/api/jobseeker/me"], profile ?? null);
          })
          .catch(() => {
            setState({ user: undefined, isLoading: false });
            queryClient.setQueryData(["/api/jobseeker/me"], null);
          });
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const setUser = useCallback((profile: JobSeekerProfile | undefined) => {
    setState({ user: profile, isLoading: false });
    queryClient.setQueryData(["/api/jobseeker/me"], profile ?? null);
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    setState((s) => ({ ...s, isLoading: true }));
    try {
      const profile = await loginJobSeeker(credentials);
      setState({ user: profile, isLoading: false });
      queryClient.setQueryData(["/api/jobseeker/me"], profile);
      // Remove any stale profile cache so Dashboard always fetches fresh data
      // for the newly authenticated user. Mirrors what logout() does in reverse.
      queryClient.removeQueries({ queryKey: ["/api/jobseeker/profile"] });
      // Phase 1 CSRF — req.session.regenerate() on the BE login handler
      // mints a fresh session, which means any token we had from a prior
      // /me hit is invalid against the new session. The login response
      // itself does NOT carry csrfToken today, so we pull a fresh one
      // explicitly. apiRequest's 403-retry path would also recover this
      // lazily, but proactive refresh avoids the cost on the next mutation.
      void refreshCsrfTokenFromMe("jobseeker");
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false }));
      throw err as ApiError;
    }
  }, []);

  const logout = useCallback(async () => {
    // CareFinder onboarding (Phase 1) — clear the per-account local
    // wizard state BEFORE we mutate session state so a stale draft from
    // one account never bleeds into another seeker's flow on the same
    // device. The walkthrough-seen flag is intentionally NOT cleared
    // (device-scoped — see client/src/lib/seekerLocalStorage.ts).
    clearSeekerSessionLocalStorage();
    setState((s) => ({ ...s, isLoading: true }));
    try {
      await logoutJobSeeker();
    } finally {
      setState({ user: undefined, isLoading: false });
      queryClient.setQueryData(["/api/jobseeker/me"], null);
      queryClient.removeQueries({ queryKey: ["/api/jobseeker/profile"] });
      // Phase 1 CSRF — server destroyed the session, so the cached token
      // is dead. Clear it and pull a fresh one from /me (this will return
      // 401 + no token today, but works once the BE 401 path mints one).
      setCsrfToken(null);
      void refreshCsrfTokenFromMe("jobseeker");
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        isReady: state.user !== null,
        login,
        logout,
        setUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
}
