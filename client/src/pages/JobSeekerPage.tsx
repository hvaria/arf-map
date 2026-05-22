import { useState, useEffect, useRef } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  Briefcase, Building2, ChevronRight, LogOut,
  CheckCircle2, MailCheck, RefreshCw, Eye, EyeOff, KeyRound,
} from "lucide-react";
import { AppHeader } from "@/components/layout/AppHeader";
import { useToast } from "@/hooks/use-toast";
import { getPendingAction, clearPendingAction } from "@/lib/pendingAction"; // NEW: expression-of-interest
import { clearWalkthroughSeen } from "@/lib/seekerLocalStorage";
import {
  SeekerProfileEditor,
  type JobSeekerProfile,
} from "@/components/seeker/SeekerProfileEditor";
import { SeekerProfileCard } from "@/components/seeker/SeekerProfileCard";
import {
  Clickwrap,
  EMPTY_ACCEPTANCE,
  isFullyAccepted,
  type ClickwrapAcceptance,
} from "@/components/legal/Clickwrap";

interface JobSeekerAccount {
  id: number;
  email: string;
}

// ─── Register Form ────────────────────────────────────────────────────────────

function RegisterForm({ onNeedsVerification }: { onNeedsVerification: (email: string) => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ email: "", password: "", confirm: "" });
  const [showPassword, setShowPassword] = useState(false);
  // Phase 4 — clickwrap state. BE rejects register without all three booleans true.
  const [acceptance, setAcceptance] = useState<ClickwrapAcceptance>(EMPTY_ACCEPTANCE);

  const mutation = useMutation({
    mutationFn: () => {
      if (form.password !== form.confirm) throw new Error("Passwords do not match");
      return apiRequest("POST", "/api/jobseeker/register", {
        email: form.email,
        password: form.password,
        acceptedTerms: acceptance.acceptedTerms,
        acceptedPrivacy: acceptance.acceptedPrivacy,
        acceptedAup: acceptance.acceptedAup,
      });
    },
    onSuccess: () => onNeedsVerification(form.email),
    onError: (err: any) => toast({ title: "Registration failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Email address</Label>
        <Input
          type="email"
          placeholder="you@email.com"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
      </div>
      <div className="space-y-2">
        <Label>Password</Label>
        <div className="relative">
          <Input
            type={showPassword ? "text" : "password"}
            placeholder="At least 8 characters"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <div className="space-y-2">
        <Label>Confirm Password</Label>
        <Input
          type="password"
          placeholder="Repeat password"
          value={form.confirm}
          onChange={(e) => setForm((f) => ({ ...f, confirm: e.target.value }))}
          onKeyDown={(e) => e.key === "Enter" && isFullyAccepted(acceptance) && mutation.mutate()}
        />
      </div>
      <Clickwrap onChange={setAcceptance} disabled={mutation.isPending} />
      <Button
        className="w-full"
        onClick={() => mutation.mutate()}
        disabled={
          mutation.isPending ||
          !form.email ||
          !form.password ||
          !form.confirm ||
          !isFullyAccepted(acceptance)
        }
      >
        {mutation.isPending ? "Creating account…" : "Create Account"}
        {!mutation.isPending && <ChevronRight className="h-4 w-4 ml-1" />}
      </Button>
    </div>
  );
}

// ─── Login Form ───────────────────────────────────────────────────────────────

function LoginForm({
  onNeedsVerification,
  onForgotPassword,
}: {
  onNeedsVerification: (email: string) => void;
  onForgotPassword: () => void;
}) {
  const { toast } = useToast();
  const { login } = useAuth();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({ email: "", password: "" });
  const [showPassword, setShowPassword] = useState(false);

  const mutation = useMutation({
    // auth.login() calls the API, sets AuthProvider state, and syncs the
    // React Query cache — all in one place.
    mutationFn: () => login({ email: form.email, password: form.password }),
    onSuccess: () => {
      navigate("/map");
    },
    onError: (err: any) => {
      if (err.code === "EMAIL_NOT_VERIFIED") {
        onNeedsVerification(form.email);
      } else {
        toast({ title: "Sign in failed", description: err.message, variant: "destructive" });
      }
    },
  });

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>Email address</Label>
        <Input
          type="email"
          placeholder="you@email.com"
          value={form.email}
          onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label>Password</Label>
          <button
            type="button"
            onClick={onForgotPassword}
            className="text-xs text-primary hover:underline"
          >
            Forgot password?
          </button>
        </div>
        <div className="relative">
          <Input
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            value={form.password}
            onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))}
            onKeyDown={(e) => e.key === "Enter" && mutation.mutate()}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      </div>
      <Button
        className="w-full"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || !form.email || !form.password}
      >
        {mutation.isPending ? "Signing in…" : "Sign In"}
      </Button>
    </div>
  );
}

// ─── Auth Section (login / register tabs) ────────────────────────────────────

function AuthSection({
  onNeedsVerification,
  onForgotPassword,
  successMessage,
}: {
  onNeedsVerification: (email: string) => void;
  onForgotPassword: () => void;
  successMessage?: string;
}) {
  const [tab, setTab] = useState<"login" | "register">("login");
  // NEW: expression-of-interest — read once on mount for context banner
  const pendingAction = getPendingAction();

  return (
    <div className="max-w-sm mx-auto mt-8">
      {/* NEW: expression-of-interest — context banner when arriving from Express Interest click */}
      {pendingAction?.type === "express_interest" && (
        <div className="mb-5 rounded-xl border border-blue-200 bg-blue-50 dark:border-blue-800/50 dark:bg-blue-950/30 px-4 py-3.5">
          <div className="flex items-start gap-3">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-blue-100 dark:bg-blue-900/50">
              <Building2 className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <p className="text-sm font-semibold text-blue-900 dark:text-blue-200">One step away!</p>
              <p className="mt-0.5 text-xs text-blue-700 dark:text-blue-400">
                Create a free profile to express interest in{" "}
                <span className="font-medium">{pendingAction.facilityName}</span>.
              </p>
            </div>
          </div>
        </div>
      )}

      {successMessage && (
        <div className="mb-5 rounded-xl border border-green-200 bg-green-50 dark:border-green-800/50 dark:bg-green-950/30 px-4 py-3.5">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400 shrink-0" />
            <p className="text-sm text-green-800 dark:text-green-200">{successMessage}</p>
          </div>
        </div>
      )}

      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-3">
          <Briefcase className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-xl font-bold">Caregiver &amp; Staff Sign In</h2>
        <p className="text-sm text-muted-foreground mt-1">Find work at ARFs, RCFEs and group homes near you</p>
      </div>

      {/* CareFinder onboarding (Phase 1) — re-entry into the walkthrough
          for returning users. Wouter's hash router can't match a route
          with a query string, so we can't bypass the "already seen" flag
          via `?force=1`; instead we clear the flag inline and navigate
          to the bare route, which lets WalkthroughPage's mount guard
          fall through and render. */}
      <div className="text-center mb-4">
        <button
          type="button"
          className="text-xs font-medium text-primary hover:underline bg-transparent border-0 p-0 cursor-pointer"
          onClick={() => {
            clearWalkthroughSeen();
            window.location.hash = "#/jobs/welcome";
          }}
        >
          First time? See how it works →
        </button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList className="w-full mb-5">
          <TabsTrigger value="login" className="flex-1">Sign In</TabsTrigger>
          <TabsTrigger value="register" className="flex-1">Create Account</TabsTrigger>
        </TabsList>
        <TabsContent value="login">
          <LoginForm onNeedsVerification={onNeedsVerification} onForgotPassword={onForgotPassword} />
        </TabsContent>
        <TabsContent value="register">
          <RegisterForm onNeedsVerification={onNeedsVerification} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ─── Forgot Password Form ─────────────────────────────────────────────────────

function ForgotPasswordForm({
  onCodeSent,
  onBack,
}: {
  onCodeSent: (email: string) => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");

  const mutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/jobseeker/forgot-password", { email }),
    onSuccess: () => onCodeSent(email),
    onError: (err: any) => setError(err.message),
  });

  return (
    <div className="max-w-sm mx-auto mt-8">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-3">
          <KeyRound className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-xl font-bold">Forgot password?</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Enter your email and we'll send a reset code.
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Email address</Label>
          <Input
            type="email"
            placeholder="you@email.com"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && email && mutation.mutate()}
          />
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        <Button
          className="w-full"
          onClick={() => mutation.mutate()}
          disabled={mutation.isPending || !email}
        >
          {mutation.isPending ? "Sending code…" : "Send reset code"}
        </Button>
        <button
          type="button"
          onClick={onBack}
          className="w-full text-sm text-muted-foreground hover:text-foreground text-center"
        >
          ← Back to sign in
        </button>
      </div>
    </div>
  );
}

// ─── Reset Password Form ──────────────────────────────────────────────────────

function ResetPasswordForm({
  email,
  onReset,
  onBack,
}: {
  email: string;
  onReset: () => void;
  onBack: () => void;
}) {
  const [form, setForm] = useState({ token: "", newPassword: "", confirm: "" });
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  // UI-02: clear auth state after reset so any stale session is evicted immediately
  const { setUser } = useAuth();

  const passwordMismatch = form.confirm.length > 0 && form.newPassword !== form.confirm;
  const passwordTooShort = form.newPassword.length > 0 && form.newPassword.length < 8;

  const mutation = useMutation({
    mutationFn: () => {
      if (form.newPassword !== form.confirm) throw new Error("Passwords do not match.");
      return apiRequest("POST", "/api/jobseeker/reset-password", {
        email,
        token: form.token,
        newPassword: form.newPassword,
      });
    },
    onSuccess: () => {
      // UI-02: clear any stale auth state — server invalidated all sessions
      // for this account, so the frontend must reflect that promptly.
      setUser(undefined);
      onReset();
    },
    onError: (err: any) => setError(err.message),
  });

  const canSubmit =
    form.token.length === 6 &&
    form.newPassword.length >= 8 &&
    form.newPassword === form.confirm &&
    !mutation.isPending;

  return (
    <div className="max-w-sm mx-auto mt-8">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-3">
          <MailCheck className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-xl font-bold">Set new password</h2>
        <p className="text-sm text-muted-foreground mt-1">
          We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Reset code</Label>
          <Input
            type="text"
            inputMode="numeric"
            placeholder="123456"
            maxLength={6}
            className="text-center text-2xl font-bold tracking-widest"
            value={form.token}
            onChange={(e) => { setForm((f) => ({ ...f, token: e.target.value.replace(/\D/g, "").slice(0, 6) })); setError(""); }}
          />
        </div>

        <div className="space-y-2">
          <Label>New password</Label>
          <div className="relative">
            <Input
              type={showPassword ? "text" : "password"}
              placeholder="At least 8 characters"
              value={form.newPassword}
              onChange={(e) => { setForm((f) => ({ ...f, newPassword: e.target.value })); setError(""); }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          {passwordTooShort && (
            <p className="text-xs text-destructive">Password must be at least 8 characters.</p>
          )}
        </div>

        <div className="space-y-2">
          <Label>Confirm new password</Label>
          <Input
            type="password"
            placeholder="Repeat new password"
            value={form.confirm}
            onChange={(e) => { setForm((f) => ({ ...f, confirm: e.target.value })); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && canSubmit && mutation.mutate()}
          />
          {passwordMismatch && (
            <p className="text-xs text-destructive">Passwords do not match.</p>
          )}
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <Button className="w-full" onClick={() => mutation.mutate()} disabled={!canSubmit}>
          {mutation.isPending ? "Updating password…" : "Set new password"}
        </Button>

        <button
          type="button"
          onClick={onBack}
          className="w-full text-sm text-muted-foreground hover:text-foreground text-center"
        >
          ← Request a new code
        </button>
      </div>
    </div>
  );
}

// ─── OTP Verification Screen ──────────────────────────────────────────────────

function VerifyEmailScreen({ email, onVerified }: { email: string; onVerified: () => void }) {
  const { toast } = useToast();
  const { setUser } = useAuth();
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const [otp, setOtp] = useState("");

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/jobseeker/verify-email", { email, otp });
      return res.json() as Promise<{ ok: boolean; id: number; email: string }>;
    },
    onSuccess: (data) => {
      // setUser syncs both AuthProvider state and React Query cache atomically.
      setUser({ id: data.id, email: data.email });
      // Also update via React Query so JobSeekerPage's useQuery sees the new account.
      qc.setQueryData<JobSeekerAccount>(["/api/jobseeker/me"], {
        id: data.id,
        email: data.email,
      });
      // CareFinder onboarding (Phase 1) — brand-new accounts go straight
      // into the wizard at /jobs/onboard. The pendingAction branch
      // (express_interest) takes precedence and is handled by the
      // page-level effect below, which fires `clearPendingAction()` and
      // navigates to /map; that effect lives outside this mutation, so
      // we only need to redirect when there is NO pending action. Using
      // a length-0 read of the storage to avoid pulling in an import
      // cycle for a one-line check.
      onVerified();
      try {
        const pending = sessionStorage.getItem("pending_action");
        if (!pending) {
          navigate("/jobs/onboard", { replace: true });
        }
      } catch {
        // sessionStorage unavailable — fall back to the wizard route so
        // a fresh account never lands on the auth surface.
        navigate("/jobs/onboard", { replace: true });
      }
    },
    onError: (err: any) => toast({ title: "Verification failed", description: err.message, variant: "destructive" }),
  });

  const resendMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/jobseeker/resend-otp", { email }),
    onSuccess: () => toast({ title: "Code resent!", description: "Check your inbox (or server logs in dev)." }),
    onError: (err: any) => toast({ title: "Failed to resend", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="max-w-sm mx-auto mt-8">
      <div className="text-center mb-6">
        <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-primary/10 mb-3">
          <MailCheck className="h-7 w-7 text-primary" />
        </div>
        <h2 className="text-xl font-bold">Check your email</h2>
        <p className="text-sm text-muted-foreground mt-1">
          We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>
        </p>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <Label>Verification code</Label>
          <Input
            type="text"
            inputMode="numeric"
            placeholder="123456"
            maxLength={6}
            className="text-center text-2xl font-bold tracking-widest"
            value={otp}
            onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))}
            onKeyDown={(e) => e.key === "Enter" && otp.length === 6 && verifyMutation.mutate()}
          />
        </div>
        <Button
          className="w-full"
          onClick={() => verifyMutation.mutate()}
          disabled={verifyMutation.isPending || otp.length !== 6}
        >
          {verifyMutation.isPending ? "Verifying…" : "Verify Email"}
        </Button>
        <div className="text-center">
          <button
            onClick={() => resendMutation.mutate()}
            disabled={resendMutation.isPending}
            className="text-sm text-primary hover:underline inline-flex items-center gap-1"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            {resendMutation.isPending ? "Sending…" : "Resend code"}
          </button>
        </div>
        <p className="text-xs text-center text-muted-foreground">
          Code expires in 15 minutes. In development, check the server console.
        </p>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ account }: { account: JobSeekerAccount }) {
  const [editingProfile, setEditingProfile] = useState(false);
  const { toast } = useToast();
  const { logout } = useAuth();

  const { data: profile } = useQuery<JobSeekerProfile | null>({
    queryKey: ["/api/jobseeker/profile"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  // Auto-open the profile editor for first-time users who have no saved profile.
  // Once opened (or once a profile exists), never auto-open again this session.
  const didAutoOpen = useRef(false);
  useEffect(() => {
    if (!didAutoOpen.current && profile === null) {
      didAutoOpen.current = true;
      setEditingProfile(true);
    }
  }, [profile]);

  const logoutMutation = useMutation({
    // auth.logout() calls the API, clears AuthProvider state, and removes
    // both /me and /profile from the React Query cache atomically.
    mutationFn: () => logout(),
    onError: () => toast({ title: "Logout failed", variant: "destructive" }),
  });

  return (
    <div className="space-y-5">
      {/* Profile card — shared between this surface and the dashboard so
          edits to the editor/card visual language land in one place. */}
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
          email={account.email}
          onEdit={() => setEditingProfile(true)}
        />
      )}

      {/* "My Applications" lives on /#/jobseeker/dashboard only —
          /#/job-seeker is the profile surface, not the activity feed. */}

      <Separator />
      <Button
        variant="outline"
        className="w-full text-destructive hover:bg-destructive/10"
        onClick={() => logoutMutation.mutate()}
        disabled={logoutMutation.isPending}
      >
        <LogOut className="h-4 w-4 mr-2" />
        {logoutMutation.isPending ? "Signing out…" : "Sign Out"}
      </Button>
    </div>
  );
}

// ─── Page root ────────────────────────────────────────────────────────────────

type PageState =
  | { view: "auth"; successMessage?: string }
  | { view: "verify"; email: string }
  | { view: "forgot-password" }
  | { view: "reset-password"; email: string }
  | { view: "dashboard" };

export default function JobSeekerPage() {
  const [pageState, setPageState] = useState<PageState>({ view: "auth" });
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const { data: account, isLoading } = useQuery<JobSeekerAccount | null>({
    queryKey: ["/api/jobseeker/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 60000,
  });

  // Once authenticated, this surface is no longer the canonical seeker home —
  // the dashboard at /#/jobseeker/dashboard is. We only stay on /#/job-seeker
  // long enough to finish the pending-action handoff (express_interest);
  // every other authed visit is redirected forward.
  //
  // CareFinder onboarding (Phase 1) — VerifyEmailScreen owns the post-OTP
  // navigation for brand-new accounts (it pushes to /jobs/onboard). This
  // effect must therefore NOT clobber an explicit forward navigation by
  // overwriting it with /jobseeker/dashboard. The hash-path guard below
  // is the single source of truth: if we're no longer on /job-seeker the
  // effect is a no-op.
  useEffect(() => {
    if (!account) return;
    const action = getPendingAction();
    if (action?.type === "express_interest") {
      apiRequest("POST", "/api/jobseeker/interests", {
        facilityNumber: action.facilityId,
        roleInterest: "General Interest",
      })
        .then(() => toast({ title: `Your interest in ${action.facilityName} has been sent!` }))
        .catch(() => {})
        .finally(() => {
          clearPendingAction();
          navigate("/map");
        });
      return;
    }
    // Mutation-driven navigations (e.g. VerifyEmailScreen → /jobs/onboard)
    // already moved the URL forward; don't override.
    if (typeof window !== "undefined") {
      const hashPath = window.location.hash.replace(/^#/, "").split("?")[0];
      if (hashPath && hashPath !== "/job-seeker") return;
    }
    // No pending action and still on /job-seeker — the dashboard is the
    // canonical home.
    navigate("/jobseeker/dashboard");
  }, [account?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // When account loads, show dashboard
  const effectiveView = account
    ? "dashboard"
    : pageState.view === "verify"
    ? "verify"
    : pageState.view === "forgot-password"
    ? "forgot-password"
    : pageState.view === "reset-password"
    ? "reset-password"
    : "auth";

  return (
    <div className="min-h-screen bg-background">
      {/* Auth surface — the inline form below IS the sign-in. No back
          affordance (the seeker app has nothing to go back to from
          here), no hamburger menu (nothing useful to put in it when
          you're trying to authenticate). `logoOnly` suppresses the
          right-side cluster; dropping `backTo` removes the chevron. */}
      <AppHeader
        logoOnly
        onSignInOverride={() => {
          // Already on the auth surface — no navigation needed. Make sure
          // we're in the default "auth" view in case the user is in the
          // middle of forgot-password / verify and clicked the chip.
          setPageState({ view: "auth" });
        }}
      />

      <div className="mx-auto max-w-2xl p-3 sm:p-6 sm:py-8">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : effectiveView === "dashboard" && account ? (
          // Authenticated visitors usually never see this — the useEffect
          // above redirects them to /#/jobseeker/dashboard. The Dashboard
          // render below is the brief flash before navigation completes
          // (and the fallback when the pendingAction flow is mid-flight).
          <Dashboard account={account} />
        ) : effectiveView === "verify" && pageState.view === "verify" ? (
          <VerifyEmailScreen
            email={pageState.email}
            onVerified={() => {
              // No page-state change needed: qc.setQueryData in the verify
              // mutation already populates the /me cache, which drives
              // effectiveView → "dashboard" in the same render cycle.
            }}
          />
        ) : effectiveView === "forgot-password" ? (
          <ForgotPasswordForm
            onCodeSent={(email) => setPageState({ view: "reset-password", email })}
            onBack={() => setPageState({ view: "auth" })}
          />
        ) : effectiveView === "reset-password" && pageState.view === "reset-password" ? (
          <ResetPasswordForm
            email={pageState.email}
            onReset={() =>
              setPageState({
                view: "auth",
                successMessage: "Password updated! You can now sign in with your new password.",
              })
            }
            onBack={() => setPageState({ view: "forgot-password" })}
          />
        ) : (
          <AuthSection
            onNeedsVerification={(email) => setPageState({ view: "verify", email })}
            onForgotPassword={() => setPageState({ view: "forgot-password" })}
            successMessage={pageState.view === "auth" ? pageState.successMessage : undefined}
          />
        )}
      </div>
    </div>
  );
}
