import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import {
  ArrowLeft, Briefcase, User, MapPin, Phone, Mail, Clock,
  DollarSign, Plus, X, Edit3, LogOut, CheckCircle2, Building2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import facilitiesData from "@/data/facilities.json";
import type { Facility } from "@shared/schema";

const allFacilities = facilitiesData as Facility[];
const facilityByNumber = new Map(allFacilities.map((f) => [f.number, f]));

interface JobSeekerAccount {
  id: number;
  username: string;
  email: string;
}

interface JobSeekerProfile {
  id: number;
  accountId: number;
  name: string | null;
  phone: string | null;
  city: string | null;
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

const JOB_TYPE_OPTIONS = [
  "Caregiver", "Direct Support Professional", "Program Manager",
  "House Manager", "Overnight Staff", "Part-Time Staff",
  "Administrator", "Case Manager", "Other",
];

function daysAgo(ts: number) {
  const days = Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
  if (days === 0) return "Today";
  if (days === 1) return "1 day ago";
  return `${days} days ago`;
}

// ─── Auth Forms ──────────────────────────────────────────────────────────────

function AuthSection({ onSuccess }: { onSuccess: () => void }) {
  const [tab, setTab] = useState<"login" | "register">("login");
  const { toast } = useToast();
  const qc = useQueryClient();

  const [loginForm, setLoginForm] = useState({ username: "", password: "" });
  const [regForm, setRegForm] = useState({ username: "", email: "", password: "", confirm: "" });

  const loginMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/jobseeker/login", { username: loginForm.username, password: loginForm.password }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/jobseeker/me"] }); onSuccess(); },
    onError: (err: any) => toast({ title: "Login failed", description: err.message, variant: "destructive" }),
  });

  const registerMutation = useMutation({
    mutationFn: () => {
      if (regForm.password !== regForm.confirm) throw new Error("Passwords do not match");
      return apiRequest("POST", "/api/jobseeker/register", { username: regForm.username, email: regForm.email, password: regForm.password });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["/api/jobseeker/me"] }); onSuccess(); },
    onError: (err: any) => toast({ title: "Registration failed", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="max-w-sm mx-auto mt-8">
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

        <TabsContent value="login" className="space-y-4">
          <div className="space-y-2">
            <Label>Username</Label>
            <Input
              placeholder="your_username"
              value={loginForm.username}
              onChange={(e) => setLoginForm((f) => ({ ...f, username: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Password</Label>
            <Input
              type="password"
              placeholder="••••••••"
              value={loginForm.password}
              onChange={(e) => setLoginForm((f) => ({ ...f, password: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && loginMutation.mutate()}
            />
          </div>
          <Button
            className="w-full"
            onClick={() => loginMutation.mutate()}
            disabled={loginMutation.isPending || !loginForm.username || !loginForm.password}
          >
            {loginMutation.isPending ? "Signing in…" : "Sign In"}
          </Button>
        </TabsContent>

        <TabsContent value="register" className="space-y-4">
          <div className="space-y-2">
            <Label>Username</Label>
            <Input
              placeholder="your_username"
              value={regForm.username}
              onChange={(e) => setRegForm((f) => ({ ...f, username: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input
              type="email"
              placeholder="you@email.com"
              value={regForm.email}
              onChange={(e) => setRegForm((f) => ({ ...f, email: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Password</Label>
            <Input
              type="password"
              placeholder="At least 8 characters"
              value={regForm.password}
              onChange={(e) => setRegForm((f) => ({ ...f, password: e.target.value }))}
            />
          </div>
          <div className="space-y-2">
            <Label>Confirm Password</Label>
            <Input
              type="password"
              placeholder="Repeat password"
              value={regForm.confirm}
              onChange={(e) => setRegForm((f) => ({ ...f, confirm: e.target.value }))}
              onKeyDown={(e) => e.key === "Enter" && registerMutation.mutate()}
            />
          </div>
          <Button
            className="w-full"
            onClick={() => registerMutation.mutate()}
            disabled={registerMutation.isPending || !regForm.username || !regForm.email || !regForm.password}
          >
            {registerMutation.isPending ? "Creating account…" : "Create Account"}
          </Button>
        </TabsContent>
      </Tabs>
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
    name: profile?.name ?? "",
    phone: profile?.phone ?? "",
    city: profile?.city ?? "",
    yearsExperience: String(profile?.yearsExperience ?? ""),
    bio: profile?.bio ?? "",
    jobTypes: profile?.jobTypes ?? [],
  });

  const [newJobType, setNewJobType] = useState("");

  const saveMutation = useMutation({
    mutationFn: () =>
      apiRequest("PUT", "/api/jobseeker/profile", {
        name: form.name || undefined,
        phone: form.phone || undefined,
        city: form.city || undefined,
        yearsExperience: form.yearsExperience ? parseInt(form.yearsExperience, 10) : undefined,
        bio: form.bio || undefined,
        jobTypes: form.jobTypes,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobseeker/profile"] });
      toast({ title: "Profile saved!" });
      onSaved();
    },
    onError: (err: any) => toast({ title: "Save failed", description: err.message, variant: "destructive" }),
  });

  const addJobType = (type: string) => {
    if (type && !form.jobTypes.includes(type)) {
      setForm((f) => ({ ...f, jobTypes: [...f.jobTypes, type] }));
    }
    setNewJobType("");
  };

  const removeJobType = (type: string) => {
    setForm((f) => ({ ...f, jobTypes: f.jobTypes.filter((t) => t !== type) }));
  };

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label>Full Name</Label>
          <Input
            placeholder="Jane Smith"
            value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>City</Label>
          <Input
            placeholder="Sacramento, CA"
            value={form.city}
            onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label>Phone</Label>
          <Input
            placeholder="(530) 555-0100"
            value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
        </div>
        <div className="space-y-2">
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

      <div className="space-y-2">
        <Label>Bio / About Me</Label>
        <Textarea
          placeholder="Brief introduction about your background and goals…"
          rows={3}
          value={form.bio}
          onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
        />
      </div>

      <div className="space-y-2">
        <Label>Job Types I'm Looking For</Label>
        <div className="flex flex-wrap gap-1.5 mb-2">
          {form.jobTypes.map((t) => (
            <Badge key={t} variant="secondary" className="gap-1 pr-1">
              {t}
              <button onClick={() => removeJobType(t)} className="hover:text-destructive ml-0.5">
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
        <div className="flex gap-2">
          <select
            className="flex-1 h-9 rounded-md border border-input bg-background px-3 text-sm"
            value={newJobType}
            onChange={(e) => setNewJobType(e.target.value)}
          >
            <option value="">Select a job type…</option>
            {JOB_TYPE_OPTIONS.filter((o) => !form.jobTypes.includes(o)).map((o) => (
              <option key={o} value={o}>{o}</option>
            ))}
          </select>
          <Button variant="outline" size="sm" onClick={() => addJobType(newJobType)} disabled={!newJobType}>
            <Plus className="h-4 w-4" />
          </Button>
        </div>
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
  const qc = useQueryClient();

  const { data: profile } = useQuery<JobSeekerProfile | null>({
    queryKey: ["/api/jobseeker/profile"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const { data: jobs = [] } = useQuery<PublicJob[]>({
    queryKey: ["/api/jobs"],
    staleTime: 60000,
  });

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/jobseeker/logout", {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/jobseeker/me"] });
      qc.invalidateQueries({ queryKey: ["/api/jobseeker/profile"] });
    },
    onError: () => toast({ title: "Logout failed", variant: "destructive" }),
  });

  const isProfileComplete = profile?.name && profile?.city;

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
                <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                  <User className="h-7 w-7 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-lg font-semibold">{profile?.name || account.username}</h3>
                    {isProfileComplete && (
                      <Badge variant="secondary" className="text-xs gap-1">
                        <CheckCircle2 className="h-3 w-3 text-green-500" />
                        Profile complete
                      </Badge>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground">{account.email}</p>
                  {profile?.city && (
                    <p className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                      <MapPin className="h-3.5 w-3.5" />{profile.city}
                    </p>
                  )}
                </div>
                <Button variant="outline" size="sm" onClick={() => setEditingProfile(true)}>
                  <Edit3 className="h-4 w-4 mr-1.5" />
                  Edit
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
                    <Briefcase className="h-3.5 w-3.5" />{profile.yearsExperience} yr{profile.yearsExperience !== 1 ? "s" : ""} experience
                  </span>
                )}
              </div>

              {profile?.jobTypes && profile.jobTypes.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mt-3">
                  {profile.jobTypes.map((t) => (
                    <Badge key={t} variant="outline" className="text-xs">{t}</Badge>
                  ))}
                </div>
              )}

              {!isProfileComplete && (
                <div className="mt-3 p-3 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-sm text-amber-700 dark:text-amber-300">
                  Complete your profile so facilities can find you.{" "}
                  <button onClick={() => setEditingProfile(true)} className="underline font-medium">Set it up →</button>
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
                  ? profile.jobTypes.some((t) => job.type.toLowerCase().includes(t.toLowerCase()) || job.title.toLowerCase().includes(t.toLowerCase()))
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

export default function JobSeekerPage() {
  const { data: account, isLoading } = useQuery<JobSeekerAccount | null>({
    queryKey: ["/api/jobseeker/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    staleTime: 60000,
  });

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center gap-3">
          <a href="/#/">
            <Button variant="ghost" size="sm">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Map
            </Button>
          </a>
          <div className="flex-1">
            <h1 className="text-base font-semibold flex items-center gap-2">
              <Briefcase className="h-4 w-4 text-primary" />
              Job Seeker Portal
            </h1>
          </div>
          {account && (
            <p className="text-xs text-muted-foreground hidden sm:block">
              Signed in as <span className="font-medium">{account.username}</span>
            </p>
          )}
        </div>
      </div>

      <div className="max-w-2xl mx-auto px-4 py-6">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2].map((i) => <div key={i} className="h-32 rounded-xl bg-muted animate-pulse" />)}
          </div>
        ) : account ? (
          <Dashboard account={account} />
        ) : (
          <AuthSection onSuccess={() => {}} />
        )}
      </div>
    </div>
  );
}
