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

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthState {
  /** null = not loaded yet, undefined = not logged in, object = authenticated */
  user: JobSeekerProfile | null | undefined;
  isLoading: boolean;
}

interface AuthContextValue extends AuthState {
  login(credentials: LoginCredentials): Promise<void>;
  logout(): Promise<void>;
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
  useEffect(() => {
    getCurrentJobSeeker()
      .then((profile) => {
        setState({ user: profile ?? undefined, isLoading: false });
      })
      .catch(() => {
        setState({ user: undefined, isLoading: false });
      });
  }, []);

  const login = useCallback(async (credentials: LoginCredentials) => {
    setState((s) => ({ ...s, isLoading: true }));
    try {
      const profile = await loginJobSeeker(credentials);
      setState({ user: profile, isLoading: false });
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
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        isReady: state.user !== null,
        login,
        logout,
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
