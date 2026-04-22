import { useState, useRef, useEffect } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Briefcase, User, MapPin, Phone, Mail, Clock,
  DollarSign, X, Edit3, LogOut, CheckCircle2, Building2,
  Camera, ChevronRight, MailCheck, RefreshCw, Eye, EyeOff, KeyRound,
} from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { useToast } from "@/hooks/use-toast";
import type { Facility } from "@shared/schema";
import { useFacilities } from "@/hooks/useFacilities";
import { getPendingAction, clearPendingAction } from "@/lib/pendingAction"; // NEW: expression-of-interest

// All job types relevant to Adult Residential Facilities
const JOB_TYPE_OPTIONS = [
  "Caregiver",
  "Direct Support Professional (DSP)",
  "Program Director",
  "Administrator",
  "House Manager",
  "Night Awake Staff",
  "On-call / PRN Staff",
  "Cook / Chef",
  "Activities Coordinator",
  "Registered Nurse (RN)",
  "Licensed Vocational Nurse (LVN)",
  "Certified Nursing Assistant (CNA)",
  "Medication Technician",
  "Social Worker",
  "Case Manager",
  "Mental Health Worker",
  "Behavior Technician",
  "Life Skills Coach",
  "Vocational Instructor",
  "Driver / Transportation",
  "Maintenance / Facilities",
  "Office Manager",
];

const US_STATES = [
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA","HI","ID","IL","IN","IA",
  "KS","KY","LA","ME","MD","MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC","SD","TN","TX","UT","VT",
  "VA","WA","WV","WI","WY",
];

interface JobSeekerAccount {
  id: number;
  email: string;
}

interface JobSeekerProfile {
  id: number;
  accountId: number;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  profilePictureUrl: string | null;
  yearsExperience: number | null;
  jobTypes: string[];
  bio: string | null;
  updatedAt: number;
}

interface PublicJob {
  id: number;
  facilityNumber: string;
  title: string;
  type: string;
  salary: string;
  description: string;
  requirements: string[];
  postedAt: number;
}

function daysAgo(ts: number) {
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// Resize image to max 300x300 and return base64 data URL
function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const max = 300;
        let { width, height } = img;
        if (width > height) {
          if (width > max) { height = (height * max) / width; width = max; }
        } else {
          if (height > max) { width = (width * max) / height; height = max; }
        }
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = reject;
      img.src = e.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Register Form ────────────────────────────────────────────────────────────

function RegisterForm({ onNeedsVerification }: { onNeedsVerification: (email: string) => void }) {
  const { toast } = useToast();
  const [form, setForm] = useState({ email: "", password: "", confirm: "" });
  const [showPassword, setShowPassword] = useState(false);

  const mutation = useMutation({
    mutationFn: () => {
      if (form.password !== form.confirm) throw new Error("Passwords do not match");
      return apiRequest("POST", "/api/jobseeker/register", { email: form.email, password: form.password });
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
          onKeyDown={(e) => e.key === "Enter" && mutation.mutate()}
        />
      </div>
      <Button
        className="w-full"
        onClick={() => mutation.mutate()}
        disabled={mutation.isPending || !form.email || !form.password || !form.confirm}
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
      navigate("/");
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
        <h2 className="text-xl font-bold">Job Seeker Portal</h2>
        <p className="text-sm text-muted-foreground mt-1">Find positions at residential care facilities</p>
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
      onVerified();
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

// ─── Profile Picture ──────────────────────────────────────────────────────────

function ProfilePicture({
  url,
  onChange,
}: {
  url: string;
  onChange: (dataUrl: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      toast({ title: "Image too large", description: "Please choose an image under 5 MB.", variant: "destructive" });
      return;
    }
    try {
      const dataUrl = await resizeImage(file);
      onChange(dataUrl);
    } catch {
      toast({ title: "Failed to process image", variant: "destructive" });
    }
  };

  return (
    <div className="flex flex-col items-center gap-2">
      <div
        className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center overflow-hidden cursor-pointer border-2 border-dashed border-primary/30 hover:border-primary/60 transition-colors"
        onClick={() => inputRef.current?.click()}
      >
        {url ? (
          <img src={url} alt="Profile" className="w-full h-full object-cover" />
        ) : (
          <div className="flex flex-col items-center gap-1 text-primary/50">
            <Camera className="h-6 w-6" />
            <span className="text-[10px] font-medium">Add photo</span>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="text-xs text-primary hover:underline"
      >
        {url ? "Change photo" : "Upload photo"}
      </button>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}

// ─── Profile Editor ───────────────────────────────────────────────────────────

function ProfileEditor({
  profile,
  onSaved,
}: {
  profile: JobSeekerProfile | null;
  onSaved: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const [form, setForm] = useState({
    profilePictureUrl: profile?.profilePictureUrl ?? "",
    firstName: profile?.firstName ?? "",
    lastName: profile?.lastName ?? "",
    phone: profile?.phone ?? "",
    address: profile?.address ?? "",
    city: profile?.city ?? "",
    state: profile?.state ?? "",
    zipCode: profile?.zipCode ?? "",
    yearsExperience: String(profile?.yearsExperience ?? ""),
    bio: profile?.bio ?? "",
    jobTypes: profile?.jobTypes ?? [],
  });

  useEffect(() => {
    if (profile) {
      setForm({
        profilePictureUrl: profile.profilePictureUrl ?? "",
        firstName: profile.firstName ?? "",
        lastName: profile.lastName ?? "",
        phone: profile.phone ?? "",
        address: profile.address ?? "",
        city: profile.city ?? "",
        state: profile.state ?? "",
        zipCode: profile.zipCode ?? "",
        yearsExperience: String(profile.yearsExperience ?? ""),
        bio: profile.bio ?? "",
        jobTypes: profile.jobTypes ?? [],
      });
    }
  }, [profile]);

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PUT", "/api/jobseeker/profile", {
        profilePictureUrl: form.profilePictureUrl || undefined,
        firstName: form.firstName || undefined,
        lastName: form.lastName || undefined,
        phone: form.phone || undefined,
        address: form.address || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        zipCode: form.zipCode || undefined,
        yearsExperience: form.yearsExperience ? parseInt(form.yearsExperience, 10) : undefined,
        bio: form.bio || undefined,
        jobTypes: form.jobTypes,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobseeker/profile"] });
      toast({ title: "Profile saved!" });
      onSaved();
    },
    onError: (err: any) => {
      // A 401 means the session expired while the dashboard was still showing
      // (stale React Query cache). Force-refresh the /me query so the app
      // redirects the user back to the login form immediately.
      if (err.message?.includes("Authentication required")) {
        qc.invalidateQueries({ queryKey: ["/api/jobseeker/me"] });
      }
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  const toggleJobType = (type: string) => {
    setForm((f) => ({
      ...f,
      jobTypes: f.jobTypes.includes(type)
        ? f.jobTypes.filter((t) => t !== type)
        : [...f.jobTypes, type],
    }));
  };

  return (
    <div className="space-y-6">
      {/* Profile picture */}
      <ProfilePicture
        url={form.profilePictureUrl}
        onChange={(url) => setForm((f) => ({ ...f, profilePictureUrl: url }))}
      />

      {/* Name */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Personal Info</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label>First Name</Label>
            <Input
              placeholder="Jane"
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Last Name</Label>
            <Input
              placeholder="Smith"
              value={form.lastName}
              onChange={(e) => setForm((f) => ({ ...f, lastName: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Contact Number</Label>
            <Input
              type="tel"
              placeholder="(530) 555-0100"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Years of Experience</Label>
            <Input
              type="number"
              min={0}
              max={50}
              placeholder="0"
              value={form.yearsExperience}
              onChange={(e) => setForm((f) => ({ ...f, yearsExperience: e.target.value }))}
            />
          </div>
        </div>
      </div>

      {/* Address */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">Address</h4>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Street Address</Label>
            <Input
              placeholder="123 Main St"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
            />
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="space-y-1.5 col-span-2 sm:col-span-1">
              <Label>City</Label>
              <Input
                placeholder="Sacramento"
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              />
            </div>
            <div className="space-y-1.5">
              <Label>State</Label>
              <select
                className="w-full h-9 rounded-md border border-input bg-background px-3 text-sm"
                value={form.state}
                onChange={(e) => setForm((f) => ({ ...f, state: e.target.value }))}
              >
                <option value="">State</option>
                {US_STATES.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label>Zip Code</Label>
              <Input
                placeholder="95814"
                maxLength={10}
                value={form.zipCode}
                onChange={(e) => setForm((f) => ({ ...f, zipCode: e.target.value }))}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Bio */}
      <div className="space-y-1.5">
        <Label>Bio / About Me</Label>
        <Textarea
          placeholder="Brief introduction about your background and goals…"
          rows={3}
          value={form.bio}
          onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
        />
      </div>

      {/* Job types */}
      <div>
        <h4 className="text-sm font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Positions I'm Looking For
        </h4>
        <p className="text-xs text-muted-foreground mb-3">Select all that apply</p>
        <div className="flex flex-wrap gap-2">
          {JOB_TYPE_OPTIONS.map((type) => {
            const selected = form.jobTypes.includes(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => toggleJobType(type)}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-all ${
                  selected
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background text-muted-foreground border-border hover:border-primary/50 hover:text-foreground"
                }`}
              >
                {selected && <CheckCircle2 className="h-3 w-3" />}
                {type}
              </button>
            );
          })}
        </div>
        {form.jobTypes.length > 0 && (
          <p className="text-xs text-muted-foreground mt-2">{form.jobTypes.length} selected</p>
        )}
      </div>

      <div className="flex gap-2 pt-1">
        <Button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="flex-1">
          {saveMutation.isPending ? "Saving…" : "Save Profile"}
        </Button>
        <Button variant="outline" onClick={onSaved}>Cancel</Button>
      </div>
    </div>
  );
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

function Dashboard({ account }: { account: JobSeekerAccount }) {
  const [editingProfile, setEditingProfile] = useState(false);
  const { toast } = useToast();
  const { logout } = useAuth();
  const qc = useQueryClient();
  const { facilityByNumber } = useFacilities();

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

  const { data: jobs = [] } = useQuery<PublicJob[]>({
    queryKey: ["/api/jobs"],
    staleTime: 60000,
  });

  const logoutMutation = useMutation({
    // auth.logout() calls the API, clears AuthProvider state, and removes
    // both /me and /profile from the React Query cache atomically.
    mutationFn: () => logout(),
    onError: () => toast({ title: "Logout failed", variant: "destructive" }),
  });

  const displayName = profile?.firstName
    ? `${profile.firstName} ${profile.lastName ?? ""}`.trim()
    : null;

  const isProfileComplete = !!(profile?.firstName && profile?.city && profile?.phone &&
    profile?.jobTypes && profile.jobTypes.length > 0);

  return (
    <div className="space-y-5">
      {/* Profile card */}
      <Card>
        <CardContent className="pt-5">
          {editingProfile ? (
            <ProfileEditor profile={profile ?? null} onSaved={() => setEditingProfile(false)} />
          ) : (
            <div>
              <div className="flex items-start gap-4">
                {/* Avatar */}
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center shrink-0 overflow-hidden">
                  {profile?.profilePictureUrl ? (
                    <img src={profile.profilePictureUrl} alt="Profile" className="w-full h-full object-cover" />
                  ) : (
                    <User className="h-8 w-8 text-primary" />
                  )}
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-semibold">{displayName || account.email.split("@")[0]}</h3>
                    {isProfileComplete && (
                      <Badge variant="secondary" className="text-xs gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                        Profile complete
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground flex items-center gap-1">
                    <Mail className="h-3.5 w-3.5" />{account.email}
                  </p>
                  {(profile?.city || profile?.state) && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="h-3.5 w-3.5" />
                      {[profile.city, profile.state].filter(Boolean).join(", ")}
                      {profile.zipCode && ` ${profile.zipCode}`}
                    </p>
                  )}
                </div>

                <Button variant="outline" size="sm" onClick={() => setEditingProfile(true)}>
                  <Edit3 className="h-4 w-4 mr-1.5" />Edit
                </Button>
              </div>

              {profile?.bio && (
                <p className="text-sm text-muted-foreground mt-3 leading-relaxed">{profile.bio}</p>
              )}

              <div className="flex flex-wrap gap-3 mt-3 text-sm">
                {profile?.phone && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Phone className="h-3.5 w-3.5" />{profile.phone}
                  </span>
                )}
                {profile?.yearsExperience != null && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Briefcase className="h-3.5 w-3.5" />{profile.yearsExperience} yr{profile.yearsExperience !== 1 ? "s" : ""} exp
                  </span>
                )}
                {profile?.address && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <MapPin className="h-3.5 w-3.5" />{profile.address}
                  </span>
                )}
              </div>

              {profile?.jobTypes && profile.jobTypes.length > 0 && (
                <div className="mt-3">
                  <p className="text-xs text-muted-foreground mb-1.5">Looking for:</p>
                  <div className="flex flex-wrap gap-1.5">
                    {profile.jobTypes.map((t) => (
                      <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                    ))}
                  </div>
                </div>
              )}

              {!isProfileComplete && (
                <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-300">
                  Complete your profile so facilities can find you.{" "}
                  <button onClick={() => setEditingProfile(true)} className="underline font-medium">
                    Set it up →
                  </button>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Job listings */}
      <div>
        <h3 className="text-base font-semibold mb-3">Open Positions</h3>
        {jobs.length === 0 ? (
          <div className="text-center py-10 text-muted-foreground border rounded-xl">
            <Briefcase className="h-8 w-8 mx-auto mb-2 opacity-30" />
            <p className="text-sm">No open positions right now. Check back later.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {jobs.map((job) => {
              const facility = facilityByNumber.get(job.facilityNumber);
              const isMatch =
                profile?.jobTypes && profile.jobTypes.length > 0
                  ? profile.jobTypes.some(
                      (t) =>
                        job.type.toLowerCase().includes(t.toLowerCase()) ||
                        job.title.toLowerCase().includes(t.toLowerCase()),
                    )
                  : false;
              return (
                <Card key={job.id} className={isMatch ? "border-primary/50 bg-primary/5" : ""}>
                  <CardContent className="pt-4 pb-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h4 className="text-sm font-semibold">{job.title}</h4>
                          {isMatch && (
                            <Badge className="text-[10px] px-1.5 py-0 bg-primary/10 text-primary border-primary/30">
                              Matches your profile
                            </Badge>
                          )}
                        </div>
                        {facility && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1 mt-0.5">
                            <Building2 className="h-3 w-3" />
                            {facility.name} · {facility.city}
                          </p>
                        )}
                      </div>
                      <Badge variant="secondary" className="text-xs shrink-0">{job.type}</Badge>
                    </div>

                    <div className="flex flex-wrap gap-3 mt-2 text-xs">
                      <span className="flex items-center gap-1 text-green-600 dark:text-green-400">
                        <DollarSign className="h-3 w-3" />{job.salary}
                      </span>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Clock className="h-3 w-3" />{daysAgo(job.postedAt)}
                      </span>
                    </div>

                    <p className="text-xs text-muted-foreground mt-2 line-clamp-2">{job.description}</p>

                    {job.requirements.length > 0 && (
                      <div className="flex flex-wrap gap-1 mt-2">
                        {job.requirements.map((r, i) => (
                          <span key={i} className="inline-flex items-center gap-1 text-[10px] bg-muted border rounded-full px-2 py-0.5 text-muted-foreground">
                            <CheckCircle2 className="h-2.5 w-2.5 text-green-500" />{r}
                          </span>
                        ))}
                      </div>
                    )}

                    {facility && (
                      <a href="/#/" className="mt-3 inline-flex items-center gap-1 text-xs text-primary hover:underline">
                        <MapPin className="h-3 w-3" />View facility on map
                      </a>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>

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

  // NEW: expression-of-interest — fire pending action the moment the user is authenticated
  useEffect(() => {
    if (!account) return;
    const action = getPendingAction();
    if (action?.type !== "express_interest") return;
    apiRequest("POST", "/api/jobseeker/interests", {
      facilityNumber: action.facilityId,
      roleInterest: "General Interest",
    })
      .then(() => toast({ title: `Your interest in ${action.facilityName} has been sent!` }))
      .catch(() => {})
      .finally(() => {
        clearPendingAction();
        navigate("/");
      });
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
      {/* Header */}
      <div className="border-b sticky top-0 z-10" style={{ background: "var(--brand-white)", borderBottom: "1px solid var(--brand-border)" }}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <BrandLogo />
          <Separator orientation="vertical" className="h-8" />
          <a href="/#/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Map
            </Button>
          </a>
          <div className="flex-1">
            <h1 className="text-base font-semibold flex items-center gap-2" style={{ color: "var(--brand-text-heading)" }}>
              <Briefcase className="h-4 w-4 text-primary" />
              Job Seeker Portal
            </h1>
          </div>
          {account && (
            <p className="text-xs text-muted-foreground hidden sm:block truncate max-w-[200px]">
              {account.email}
            </p>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : effectiveView === "dashboard" && account ? (
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
