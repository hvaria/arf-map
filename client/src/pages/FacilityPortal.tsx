import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { ArrowLeft, Building2, Briefcase, Plus, Pencil, Trash2, LogOut, X, CheckCircle2, Edit3, AlertCircle, MailCheck, RefreshCw } from "lucide-react";
import { BrandLogo } from "@/components/BrandLogo";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import type { Facility } from "@shared/schema";
import { useFacilities } from "@/hooks/useFacilities";

// ── Zod schemas ───────────────────────────────────────────────────────────────

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const registerSchema = z.object({
  facilityNumber: z.string().min(1, "Facility is required"),
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const detailsSchema = z.object({
  phone: z.string().optional(),
  description: z.string().optional(),
  website: z.string().optional(),
  email: z.string().optional(),
});

const jobSchema = z.object({
  title: z.string().min(1, "Title is required"),
  type: z.string().min(1, "Type is required"),
  salary: z.string().min(1, "Salary is required"),
  description: z.string().min(1, "Description is required"),
  requirementsText: z.string(),
});

type LoginForm = z.infer<typeof loginSchema>;
type DetailsForm = z.infer<typeof detailsSchema>;
type JobForm = z.infer<typeof jobSchema>;

interface FacilitySearchResult {
  number: string;
  name: string;
  city: string;
}

interface SessionUser {
  id: number;
  facilityNumber: string;
  username: string;
}

interface DbJobPosting {
  id: number;
  facilityNumber: string;
  title: string;
  type: string;
  salary: string;
  description: string;
  requirements: string[];
  postedAt: number;
}

interface FacilityOverride {
  phone?: string | null;
  description?: string | null;
  website?: string | null;
  email?: string | null;
}

// ── Auth forms ────────────────────────────────────────────────────────────────

function LoginForm({ onSuccess, onNeedsVerification }: { onSuccess: () => void; onNeedsVerification: (email: string) => void }) {
  const { toast } = useToast();
  const form = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const mutation = useMutation({
    mutationFn: async (data: LoginForm) => {
      const res = await fetch("/api/facility/login", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const body = await res.json();
      if (!res.ok) {
        const err = new Error(body.message || "Login failed") as any;
        err.code = body.code;
        err.email = body.email;
        throw err;
      }
      return body;
    },
    onSuccess: () => {
      onSuccess();
      toast({ title: "Logged in successfully" });
    },
    onError: (err: any) => {
      if (err.code === "EMAIL_NOT_VERIFIED") {
        onNeedsVerification(err.email ?? "");
        return;
      }
      toast({ title: "Login failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl><Input placeholder="your-username" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="password"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Password</FormLabel>
              <FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? "Logging in..." : "Log In"}
        </Button>
      </form>
    </Form>
  );
}

function RegisterForm({ onNeedsVerification }: { onNeedsVerification: (email: string) => void }) {
  const { toast } = useToast();

  // Facility search state
  const [searchTerm, setSearchTerm] = useState("");
  const [searchResults, setSearchResults] = useState<FacilitySearchResult[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<FacilitySearchResult | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  // Form fields
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // Debounced facility search
  useEffect(() => {
    if (!searchTerm.trim() || selectedFacility) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/facilities/search?q=${encodeURIComponent(searchTerm)}`);
        const data = await res.json();
        setSearchResults(data);
        setShowDropdown(true);
      } catch {
        // silently ignore search errors
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [searchTerm, selectedFacility]);

  const registerMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/facility/register", {
        facilityNumber: selectedFacility!.number,
        username,
        email,
        password,
      }),
    onSuccess: () => onNeedsVerification(email),
    onError: (err: Error) => {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    },
  });

  const canSubmit = !!selectedFacility && username.length >= 3 && email.includes("@") && password.length >= 8;

  return (
    <div className="space-y-4">
      {/* Facility search */}
      <div className="space-y-2">
        <Label>Facility</Label>
        {selectedFacility ? (
          <div className="flex items-center gap-2 p-2.5 border rounded-md bg-muted/30">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{selectedFacility.name}</p>
              <p className="text-xs text-muted-foreground">
                {selectedFacility.city} · License #{selectedFacility.number}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                setSelectedFacility(null);
                setSearchTerm("");
                setSearchResults([]);
              }}
            >
              Change
            </Button>
          </div>
        ) : (
          <div className="relative">
            <Input
              placeholder="Search by facility name or city…"
              value={searchTerm}
              onChange={(e) => {
                setSearchTerm(e.target.value);
                setShowDropdown(true);
              }}
              onBlur={() => setTimeout(() => setShowDropdown(false), 150)}
            />
            {showDropdown && searchResults.length > 0 && (
              <div className="absolute z-10 w-full mt-1 bg-background border rounded-md shadow-md max-h-52 overflow-y-auto">
                {searchResults.map((r) => (
                  <button
                    key={r.number}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-muted text-sm border-b last:border-b-0"
                    onMouseDown={() => {
                      setSelectedFacility(r);
                      setSearchTerm("");
                      setSearchResults([]);
                      setShowDropdown(false);
                    }}
                  >
                    <span className="font-medium">{r.name}</span>
                    <span className="text-muted-foreground"> — {r.city} (License #{r.number})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Username */}
      <div className="space-y-2">
        <Label>Username</Label>
        <Input
          placeholder="Choose a username"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
      </div>

      {/* Email */}
      <div className="space-y-2">
        <Label>Email address</Label>
        <Input
          type="email"
          placeholder="contact@yourfacility.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <p className="text-xs text-muted-foreground">A verification code will be sent to this address.</p>
      </div>

      {/* Password */}
      <div className="space-y-2">
        <Label>Password</Label>
        <Input
          type="password"
          placeholder="At least 8 characters"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
      </div>

      <Button
        className="w-full"
        onClick={() => registerMutation.mutate()}
        disabled={registerMutation.isPending || !canSubmit}
      >
        {registerMutation.isPending ? "Creating account…" : "Create Account"}
      </Button>
    </div>
  );
}

// ── OTP verification screen ───────────────────────────────────────────────────

function VerifyEmailScreen({
  email,
  onVerified,
  onBack,
}: {
  email: string;
  onVerified: () => void;
  onBack: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [otp, setOtp] = useState("");

  const verifyMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/facility/verify-email", { email, otp });
      return res.json() as Promise<{ ok: boolean; id: number; facilityNumber: string; username: string }>;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/facility/me"] });
      toast({ title: "Email verified! Welcome to the Facility Portal." });
      onVerified();
    },
    onError: (err: Error) => {
      toast({ title: "Verification failed", description: err.message, variant: "destructive" });
    },
  });

  const resendMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/facility/resend-otp", { email }),
    onSuccess: () => toast({ title: "Code resent!", description: "Check your inbox (or server logs in dev)." }),
    onError: (err: Error) => toast({ title: "Failed to resend", description: err.message, variant: "destructive" }),
  });

  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-primary/10 mb-3">
          <MailCheck className="h-6 w-6 text-primary" />
        </div>
        <h3 className="text-base font-semibold">Check your email</h3>
        <p className="text-sm text-muted-foreground mt-1">
          We sent a 6-digit code to{" "}
          <span className="font-medium text-foreground">{email}</span>
        </p>
      </div>

      <div className="space-y-3">
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
            autoFocus
          />
        </div>

        <Button
          className="w-full"
          onClick={() => verifyMutation.mutate()}
          disabled={verifyMutation.isPending || otp.length !== 6}
        >
          {verifyMutation.isPending ? "Verifying…" : "Verify Email"}
        </Button>

        <div className="flex items-center justify-between text-sm">
          <button
            onClick={onBack}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            ← Back
          </button>
          <button
            onClick={() => resendMutation.mutate()}
            disabled={resendMutation.isPending}
            className="text-primary hover:underline inline-flex items-center gap-1 disabled:opacity-50"
          >
            <RefreshCw className="h-3 w-3" />
            {resendMutation.isPending ? "Sending…" : "Resend code"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Details editor ────────────────────────────────────────────────────────────

function DetailsEditor({ facilityNumber, overrides, onSaved }: { facilityNumber: string; overrides: FacilityOverride | null; onSaved?: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const form = useForm<DetailsForm>({
    resolver: zodResolver(detailsSchema),
    defaultValues: {
      phone: overrides?.phone ?? "",
      description: overrides?.description ?? "",
      website: overrides?.website ?? "",
      email: overrides?.email ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: (data: DetailsForm) => apiRequest("PUT", "/api/facility/details", data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/facility/details"] });
      qc.invalidateQueries({ queryKey: [`/api/facilities/${facilityNumber}/public`] });
      toast({ title: "Details saved" });
      onSaved?.();
    },
    onError: (err: Error) => {
      toast({ title: "Save failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <FormField
          control={form.control}
          name="phone"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Phone Number</FormLabel>
              <FormControl><Input placeholder="(555) 555-5555" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Contact Email</FormLabel>
              <FormControl><Input type="email" placeholder="contact@facility.com" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="website"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Website</FormLabel>
              <FormControl><Input placeholder="https://www.yourfacility.com" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Facility Description</FormLabel>
              <FormControl>
                <Textarea
                  placeholder="Describe your facility, services offered, and what makes it special..."
                  className="resize-none min-h-[120px]"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" disabled={mutation.isPending}>
          {mutation.isPending ? "Saving..." : "Save Details"}
        </Button>
      </form>
    </Form>
  );
}

// ── Job posting form dialog ───────────────────────────────────────────────────

function JobFormDialog({
  existingJob,
  facilityNumber,
  onClose,
}: {
  existingJob?: DbJobPosting;
  facilityNumber: string;
  onClose: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();

  const form = useForm<JobForm>({
    resolver: zodResolver(jobSchema),
    defaultValues: {
      title: existingJob?.title ?? "",
      type: existingJob?.type ?? "",
      salary: existingJob?.salary ?? "",
      description: existingJob?.description ?? "",
      requirementsText: existingJob?.requirements.join("\n") ?? "",
    },
  });

  const mutation = useMutation({
    mutationFn: (data: JobForm) => {
      const requirements = data.requirementsText
        .split("\n")
        .map((r) => r.trim())
        .filter(Boolean);
      const body = { title: data.title, type: data.type, salary: data.salary, description: data.description, requirements };
      if (existingJob) {
        return apiRequest("PUT", `/api/facility/jobs/${existingJob.id}`, body);
      }
      return apiRequest("POST", "/api/facility/jobs", body);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/facility/jobs"] });
      qc.invalidateQueries({ queryKey: [`/api/facilities/${facilityNumber}/public`] });
      toast({ title: existingJob ? "Job posting updated" : "Job posting created" });
      onClose();
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <FormField
          control={form.control}
          name="title"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Job Title</FormLabel>
              <FormControl><Input placeholder="Caregiver, Administrator..." {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="grid grid-cols-2 gap-3">
          <FormField
            control={form.control}
            name="type"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Employment Type</FormLabel>
                <Select onValueChange={field.onChange} defaultValue={field.value}>
                  <FormControl>
                    <SelectTrigger>
                      <SelectValue placeholder="Select type" />
                    </SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    <SelectItem value="Full-time">Full-time</SelectItem>
                    <SelectItem value="Part-time">Part-time</SelectItem>
                    <SelectItem value="PRN/Per Diem">PRN/Per Diem</SelectItem>
                    <SelectItem value="Contract">Contract</SelectItem>
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )}
          />
          <FormField
            control={form.control}
            name="salary"
            render={({ field }) => (
              <FormItem>
                <FormLabel>Salary / Rate</FormLabel>
                <FormControl><Input placeholder="$18-22/hr" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
        </div>
        <FormField
          control={form.control}
          name="description"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Description</FormLabel>
              <FormControl>
                <Textarea placeholder="Describe the role and responsibilities..." className="resize-none min-h-[80px]" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="requirementsText"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Requirements <span className="text-muted-foreground font-normal">(one per line)</span></FormLabel>
              <FormControl>
                <Textarea placeholder={"CPR Certified\n2+ years experience\nValid CA driver's license"} className="resize-none min-h-[80px]" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? "Saving..." : existingJob ? "Update Posting" : "Create Posting"}
          </Button>
        </div>
      </form>
    </Form>
  );
}

// ── Job posting card ──────────────────────────────────────────────────────────

function JobCard({ job, facilityNumber }: { job: DbJobPosting; facilityNumber: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const deleteMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", `/api/facility/jobs/${job.id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/facility/jobs"] });
      qc.invalidateQueries({ queryKey: [`/api/facilities/${facilityNumber}/public`] });
      toast({ title: "Job posting deleted" });
    },
    onError: (err: Error) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  const daysAgo = Math.floor((Date.now() - job.postedAt) / 86400000);
  const postedLabel = daysAgo === 0 ? "Today" : daysAgo === 1 ? "1 day ago" : `${daysAgo} days ago`;

  return (
    <div className="rounded-lg border p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <h4 className="font-medium text-sm">{job.title}</h4>
          <div className="flex flex-wrap gap-1.5 mt-1">
            <Badge variant="secondary" className="text-xs">{job.type}</Badge>
            <Badge variant="outline" className="text-xs">{job.salary}</Badge>
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <Dialog open={editOpen} onOpenChange={setEditOpen}>
            <DialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader>
                <DialogTitle>Edit Job Posting</DialogTitle>
              </DialogHeader>
              <JobFormDialog existingJob={job} facilityNumber={facilityNumber} onClose={() => setEditOpen(false)} />
            </DialogContent>
          </Dialog>
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 text-destructive hover:text-destructive"
            disabled={deleteMutation.isPending}
            onClick={() => deleteMutation.mutate()}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>
      <p className="text-xs text-muted-foreground mt-2 leading-relaxed line-clamp-2">{job.description}</p>
      {job.requirements.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-2">
          {job.requirements.map((r, i) => (
            <span key={i} className="text-[10px] bg-muted rounded-full px-2 py-0.5 text-muted-foreground">{r}</span>
          ))}
        </div>
      )}
      <p className="text-[11px] text-muted-foreground mt-2">Posted {postedLabel}</p>
    </div>
  );
}

// ── Jobs manager ──────────────────────────────────────────────────────────────

function JobsManager({ facilityNumber }: { facilityNumber: string }) {
  const [addOpen, setAddOpen] = useState(false);

  const { data: jobs = [], isLoading } = useQuery<DbJobPosting[]>({
    queryKey: ["/api/facility/jobs"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {jobs.length === 0 ? "No job postings yet." : `${jobs.length} active posting${jobs.length !== 1 ? "s" : ""}`}
        </p>
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <Plus className="h-4 w-4 mr-1.5" />
              Add Posting
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>New Job Posting</DialogTitle>
            </DialogHeader>
            <JobFormDialog facilityNumber={facilityNumber} onClose={() => setAddOpen(false)} />
          </DialogContent>
        </Dialog>
      </div>

      {isLoading ? (
        <div className="text-sm text-muted-foreground">Loading...</div>
      ) : jobs.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-center">
          <Briefcase className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">
            Add your first job posting to appear in the hiring filter on the map.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {jobs.map((job) => (
            <JobCard key={job.id} job={job} facilityNumber={facilityNumber} />
          ))}
        </div>
      )}
    </div>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

function Dashboard({ user, onLogout }: { user: SessionUser; onLogout: () => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { facilityByNumber } = useFacilities();
  const [editingDetails, setEditingDetails] = useState(false);

  const facility = facilityByNumber.get(user.facilityNumber) ?? null;

  const { data: publicData } = useQuery<{ overrides: FacilityOverride | null }>({
    queryKey: [`/api/facilities/${user.facilityNumber}/public`],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const logoutMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/facility/logout"),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/facility/me"] });
      onLogout();
      toast({ title: "Logged out" });
    },
  });

  const isListingComplete = !!(
    publicData?.overrides?.phone &&
    publicData?.overrides?.email &&
    publicData?.overrides?.description
  );

  return (
    <div className="space-y-6">
      {/* Profile card */}
      <Card>
        <CardContent className="pt-5 pb-4">
          <div className="flex items-start gap-4">
            <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Building2 className="h-6 w-6 text-primary" />
            </div>
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-semibold leading-tight">
                {facility?.name ?? `Facility #${user.facilityNumber}`}
              </h2>
              <p className="text-sm text-muted-foreground mt-0.5">License #{user.facilityNumber}</p>
              {facility && (
                <p className="text-xs text-muted-foreground mt-0.5">
                  {facility.address}, {facility.city}
                </p>
              )}
              <div className="mt-2">
                {isListingComplete ? (
                  <Badge variant="secondary" className="text-xs gap-1">
                    <CheckCircle2 className="h-3 w-3 text-green-500" />
                    Listing complete
                  </Badge>
                ) : (
                  <Badge variant="secondary" className="text-xs gap-1 text-amber-600 bg-amber-50 dark:bg-amber-950/40 dark:text-amber-400">
                    <AlertCircle className="h-3 w-3" />
                    Listing incomplete
                  </Badge>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="details">
        <TabsList className="w-full">
          <TabsTrigger value="details" className="flex-1">
            <Building2 className="h-4 w-4 mr-1.5" />
            My Details
          </TabsTrigger>
          <TabsTrigger value="jobs" className="flex-1">
            <Briefcase className="h-4 w-4 mr-1.5" />
            Job Postings
          </TabsTrigger>
        </TabsList>

        <TabsContent value="details" className="mt-6">
          {editingDetails ? (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                Update your contact information and facility description. These details will appear on your listing in the map.
              </p>
              <DetailsEditor
                facilityNumber={user.facilityNumber}
                overrides={publicData?.overrides ?? null}
                onSaved={() => setEditingDetails(false)}
              />
              <Button
                variant="ghost"
                size="sm"
                className="mt-3"
                onClick={() => setEditingDetails(false)}
              >
                Cancel
              </Button>
            </>
          ) : (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  Your public listing details on the map.
                </p>
                <Button variant="outline" size="sm" onClick={() => setEditingDetails(true)}>
                  <Edit3 className="h-3.5 w-3.5 mr-1.5" />
                  Edit
                </Button>
              </div>
              <div className="rounded-lg border divide-y text-sm">
                <div className="flex items-start gap-3 px-4 py-3">
                  <span className="text-muted-foreground w-24 shrink-0">Phone</span>
                  <span className={publicData?.overrides?.phone ? "font-medium" : "text-muted-foreground italic"}>
                    {publicData?.overrides?.phone || "Not set"}
                  </span>
                </div>
                <div className="flex items-start gap-3 px-4 py-3">
                  <span className="text-muted-foreground w-24 shrink-0">Email</span>
                  <span className={publicData?.overrides?.email ? "font-medium" : "text-muted-foreground italic"}>
                    {publicData?.overrides?.email || "Not set"}
                  </span>
                </div>
                <div className="flex items-start gap-3 px-4 py-3">
                  <span className="text-muted-foreground w-24 shrink-0">Website</span>
                  <span className={publicData?.overrides?.website ? "font-medium" : "text-muted-foreground italic"}>
                    {publicData?.overrides?.website || "Not set"}
                  </span>
                </div>
                <div className="flex items-start gap-3 px-4 py-3">
                  <span className="text-muted-foreground w-24 shrink-0">Description</span>
                  <span className={publicData?.overrides?.description ? "" : "text-muted-foreground italic"}>
                    {publicData?.overrides?.description || "Not set"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </TabsContent>

        <TabsContent value="jobs" className="mt-6">
          <p className="text-sm text-muted-foreground mb-4">
            Manage your job openings. Active postings will show your facility in the "Hiring" filter on the map.
          </p>
          <JobsManager facilityNumber={user.facilityNumber} />
        </TabsContent>
      </Tabs>

      <Separator />

      <div className="flex justify-center pb-2">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground"
          onClick={() => logoutMutation.mutate()}
          disabled={logoutMutation.isPending}
        >
          <LogOut className="h-4 w-4 mr-1.5" />
          {logoutMutation.isPending ? "Logging out…" : "Log Out"}
        </Button>
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FacilityPortal() {
  const qc = useQueryClient();
  const [pendingVerification, setPendingVerification] = useState<string | null>(null);

  const { data: me, isLoading } = useQuery<SessionUser | null>({
    queryKey: ["/api/facility/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const handleAuthSuccess = () => {
    setPendingVerification(null);
    qc.invalidateQueries({ queryKey: ["/api/facility/me"] });
  };

  const handleLogout = () => {
    qc.setQueryData(["/api/facility/me"], null);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b px-4 py-3 flex items-center gap-3" style={{ background: "var(--brand-white)", borderBottom: "1px solid var(--brand-border)" }}>
        <BrandLogo />
        <Separator orientation="vertical" className="h-8" />
        <Link href="/">
          <Button variant="ghost" size="sm" className="-ml-2">
            <ArrowLeft className="h-4 w-4 mr-1.5" />
            Back to Map
          </Button>
        </Link>
        <Separator orientation="vertical" className="h-5" />
        <span className="text-sm font-medium text-muted-foreground">Facility Portal</span>
      </header>

      <main className="max-w-xl mx-auto px-4 py-8">
        {isLoading ? (
          <div className="text-center text-muted-foreground py-12">Loading...</div>
        ) : me ? (
          <Dashboard user={me} onLogout={handleLogout} />
        ) : (
          <div className="space-y-6">
            <div className="text-center">
              <Building2 className="h-10 w-10 mx-auto text-muted-foreground mb-3" />
              <h1 className="text-2xl font-semibold">Facility Portal</h1>
              <p className="text-muted-foreground mt-1 text-sm">
                Manage your facility's listing and post job openings on the ARF map.
              </p>
            </div>

            <Card>
              <CardContent className="pt-6">
                {pendingVerification ? (
                  <VerifyEmailScreen
                    email={pendingVerification}
                    onVerified={handleAuthSuccess}
                    onBack={() => setPendingVerification(null)}
                  />
                ) : (
                  <Tabs defaultValue="login">
                    <TabsList className="w-full mb-6">
                      <TabsTrigger value="login" className="flex-1">Log In</TabsTrigger>
                      <TabsTrigger value="register" className="flex-1">Register</TabsTrigger>
                    </TabsList>
                    <TabsContent value="login">
                      <LoginForm
                        onSuccess={handleAuthSuccess}
                        onNeedsVerification={(email) => setPendingVerification(email)}
                      />
                    </TabsContent>
                    <TabsContent value="register">
                      <div className="mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800">
                        <p className="text-xs text-blue-700 dark:text-blue-300">
                          One account per facility. You'll need your facility's CA CCLD license number to register.
                        </p>
                      </div>
                      <RegisterForm onNeedsVerification={(email) => setPendingVerification(email)} />
                    </TabsContent>
                  </Tabs>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
