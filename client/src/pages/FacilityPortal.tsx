import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Link } from "wouter";
import { ArrowLeft, Building2, Briefcase, Plus, Pencil, Trash2, LogOut, X } from "lucide-react";
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
import facilitiesData from "@/data/facilities.json";
import type { Facility } from "@shared/schema";

const facilities = facilitiesData as Facility[];

// ── Zod schemas ───────────────────────────────────────────────────────────────

const loginSchema = z.object({
  username: z.string().min(1, "Username is required"),
  password: z.string().min(1, "Password is required"),
});

const registerSchema = z.object({
  facilityNumber: z.string().min(1, "Facility license number is required"),
  username: z.string().min(3, "Username must be at least 3 characters"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
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
type RegisterForm = z.infer<typeof registerSchema>;
type DetailsForm = z.infer<typeof detailsSchema>;
type JobForm = z.infer<typeof jobSchema>;

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

function LoginForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const form = useForm<LoginForm>({ resolver: zodResolver(loginSchema) });

  const mutation = useMutation({
    mutationFn: (data: LoginForm) => apiRequest("POST", "/api/facility/login", data),
    onSuccess: () => {
      onSuccess();
      toast({ title: "Logged in successfully" });
    },
    onError: (err: Error) => {
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

function RegisterForm({ onSuccess }: { onSuccess: () => void }) {
  const { toast } = useToast();
  const form = useForm<RegisterForm>({ resolver: zodResolver(registerSchema) });

  const mutation = useMutation({
    mutationFn: (data: RegisterForm) =>
      apiRequest("POST", "/api/facility/register", {
        facilityNumber: data.facilityNumber,
        username: data.username,
        password: data.password,
      }),
    onSuccess: () => {
      onSuccess();
      toast({ title: "Account created successfully" });
    },
    onError: (err: Error) => {
      toast({ title: "Registration failed", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((d) => mutation.mutate(d))} className="space-y-4">
        <FormField
          control={form.control}
          name="facilityNumber"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Facility License Number</FormLabel>
              <FormControl>
                <Input placeholder="e.g. 198012345" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="username"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Username</FormLabel>
              <FormControl><Input placeholder="choose-a-username" {...field} /></FormControl>
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
              <FormControl><Input type="password" placeholder="Min. 8 characters" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="confirmPassword"
          render={({ field }) => (
            <FormItem>
              <FormLabel>Confirm Password</FormLabel>
              <FormControl><Input type="password" placeholder="••••••••" {...field} /></FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-full" disabled={mutation.isPending}>
          {mutation.isPending ? "Creating account..." : "Create Account"}
        </Button>
      </form>
    </Form>
  );
}

// ── Details editor ────────────────────────────────────────────────────────────

function DetailsEditor({ facilityNumber, overrides }: { facilityNumber: string; overrides: FacilityOverride | null }) {
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

  const facility = facilities.find((f) => f.number === user.facilityNumber);

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

  return (
    <div className="space-y-6">
      {/* Facility header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-xl font-semibold">{facility?.name ?? `Facility #${user.facilityNumber}`}</h2>
          <p className="text-sm text-muted-foreground mt-0.5">License #{user.facilityNumber}</p>
          {facility && (
            <p className="text-sm text-muted-foreground">{facility.address}, {facility.city}</p>
          )}
        </div>
        <Button variant="outline" size="sm" onClick={() => logoutMutation.mutate()} disabled={logoutMutation.isPending}>
          <LogOut className="h-4 w-4 mr-1.5" />
          Log Out
        </Button>
      </div>

      <Separator />

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
          <p className="text-sm text-muted-foreground mb-4">
            Update your contact information and facility description. These details will appear on your listing in the map.
          </p>
          <DetailsEditor
            facilityNumber={user.facilityNumber}
            overrides={publicData?.overrides ?? null}
          />
        </TabsContent>

        <TabsContent value="jobs" className="mt-6">
          <p className="text-sm text-muted-foreground mb-4">
            Manage your job openings. Active postings will show your facility in the "Hiring" filter on the map.
          </p>
          <JobsManager facilityNumber={user.facilityNumber} />
        </TabsContent>
      </Tabs>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function FacilityPortal() {
  const qc = useQueryClient();

  const { data: me, isLoading } = useQuery<SessionUser | null>({
    queryKey: ["/api/facility/me"],
    queryFn: getQueryFn({ on401: "returnNull" }),
  });

  const handleAuthSuccess = () => {
    qc.invalidateQueries({ queryKey: ["/api/facility/me"] });
  };

  const handleLogout = () => {
    qc.setQueryData(["/api/facility/me"], null);
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b px-4 py-3 flex items-center gap-3">
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
                <Tabs defaultValue="login">
                  <TabsList className="w-full mb-6">
                    <TabsTrigger value="login" className="flex-1">Log In</TabsTrigger>
                    <TabsTrigger value="register" className="flex-1">Register</TabsTrigger>
                  </TabsList>
                  <TabsContent value="login">
                    <LoginForm onSuccess={handleAuthSuccess} />
                  </TabsContent>
                  <TabsContent value="register">
                    <div className="mb-4 p-3 rounded-lg bg-blue-50 dark:bg-blue-950/50 border border-blue-200 dark:border-blue-800">
                      <p className="text-xs text-blue-700 dark:text-blue-300">
                        One account per facility. You'll need your facility's CA CCLD license number to register.
                      </p>
                    </div>
                    <RegisterForm onSuccess={handleAuthSuccess} />
                  </TabsContent>
                </Tabs>
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  );
}
