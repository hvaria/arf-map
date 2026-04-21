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
    } catch (err) {
      setState((s) => ({ ...s, isLoading: false }));
      throw err as ApiError;
    }
  }, []);

  const logout = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true }));
    try {
      await logoutJobSeeker();
    } finally {
      setState({ user: undefined, isLoading: false });
      queryClient.setQueryData(["/api/jobseeker/me"], null);
      queryClient.removeQueries({ queryKey: ["/api/jobseeker/profile"] });
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
