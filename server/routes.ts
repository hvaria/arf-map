import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import passport from "passport";
import { z } from "zod";
import { storage } from "./storage";
import { hashPassword, comparePassword } from "./auth";

declare module "express-session" {
  interface SessionData {
    jobSeekerId?: number;
  }
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

function requireJobSeekerAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.jobSeekerId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

const registerSchema = z.object({
  facilityNumber: z.string().min(1, "Facility number is required"),
  username: z.string().min(3, "Username must be at least 3 characters").max(50),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const detailsSchema = z.object({
  phone: z.string().optional(),
  description: z.string().optional(),
  website: z.string().optional(),
  email: z.string().optional(),
});

const jobPostingInputSchema = z.object({
  title: z.string().min(1, "Title is required"),
  type: z.string().min(1, "Type is required"),
  salary: z.string().min(1, "Salary is required"),
  description: z.string().min(1, "Description is required"),
  requirements: z.array(z.string()),
});

export async function registerRoutes(server: Server, app: Express) {
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // ── Auth ────────────────────────────────────────────────────────────────────

  app.post("/api/facility/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const { facilityNumber, username, password } = parsed.data;

    const existingByNumber = await storage.getFacilityAccountByNumber(facilityNumber);
    if (existingByNumber) {
      return res.status(409).json({ message: "An account for this facility already exists" });
    }

    const existingByUsername = await storage.getFacilityAccountByUsername(username);
    if (existingByUsername) {
      return res.status(409).json({ message: "Username is already taken" });
    }

    const hashed = await hashPassword(password);
    const account = await storage.createFacilityAccount({
      facilityNumber,
      username,
      password: hashed,
      createdAt: Date.now(),
    });

    req.login(account, (err) => {
      if (err) return res.status(500).json({ message: "Login after register failed" });
      res.status(201).json({
        id: account.id,
        facilityNumber: account.facilityNumber,
        username: account.username,
      });
    });
  });

  app.post("/api/facility/login", (req, res, next) => {
    passport.authenticate("local", (err: any, user: Express.User | false, info: any) => {
      if (err) return next(err);
      if (!user) return res.status(401).json({ message: info?.message || "Invalid credentials" });
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        res.json({
          id: user.id,
          facilityNumber: user.facilityNumber,
          username: user.username,
        });
      });
    })(req, res, next);
  });

  app.post("/api/facility/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.json({ ok: true });
    });
  });

  app.get("/api/facility/me", (req, res) => {
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    res.json({
      id: req.user.id,
      facilityNumber: req.user.facilityNumber,
      username: req.user.username,
    });
  });

  // ── Facility details ─────────────────────────────────────────────────────────

  app.put("/api/facility/details", requireAuth, async (req, res) => {
    const parsed = detailsSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const facilityNumber = req.user!.facilityNumber;
    const override = await storage.upsertFacilityOverride(facilityNumber, parsed.data);
    res.json(override);
  });

  // ── Public job listings (job seeker portal) ──────────────────────────────────

  app.get("/api/jobs", async (_req, res) => {
    const jobs = await storage.getAllJobPostings();
    res.json(
      jobs.map((jp) => ({
        ...jp,
        requirements: JSON.parse(jp.requirements) as string[],
      })),
    );
  });

  // ── Public facility data ─────────────────────────────────────────────────────

  app.get("/api/facilities/:number/public", async (req, res) => {
    const { number } = req.params;
    const [overrides, jobPostings] = await Promise.all([
      storage.getFacilityOverride(number),
      storage.getJobPostings(number),
    ]);
    res.json({
      overrides: overrides ?? null,
      jobPostings: jobPostings.map((jp) => ({
        ...jp,
        requirements: JSON.parse(jp.requirements) as string[],
      })),
    });
  });

  // ── Job postings ─────────────────────────────────────────────────────────────

  app.get("/api/facility/jobs", requireAuth, async (req, res) => {
    const jobs = await storage.getJobPostings(req.user!.facilityNumber);
    res.json(
      jobs.map((jp) => ({
        ...jp,
        requirements: JSON.parse(jp.requirements) as string[],
      })),
    );
  });

  app.post("/api/facility/jobs", requireAuth, async (req, res) => {
    const parsed = jobPostingInputSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const { title, type, salary, description, requirements } = parsed.data;
    const job = await storage.createJobPosting(req.user!.facilityNumber, {
      title,
      type,
      salary,
      description,
      requirements: JSON.stringify(requirements),
    });
    res.status(201).json({ ...job, requirements: JSON.parse(job.requirements) as string[] });
  });

  app.put("/api/facility/jobs/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid job id" });

    const parsed = jobPostingInputSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }

    const data: Record<string, string> = {};
    if (parsed.data.title) data.title = parsed.data.title;
    if (parsed.data.type) data.type = parsed.data.type;
    if (parsed.data.salary) data.salary = parsed.data.salary;
    if (parsed.data.description) data.description = parsed.data.description;
    if (parsed.data.requirements) data.requirements = JSON.stringify(parsed.data.requirements);

    const job = await storage.updateJobPosting(id, req.user!.facilityNumber, data);
    if (!job) return res.status(404).json({ message: "Job posting not found" });
    res.json({ ...job, requirements: JSON.parse(job.requirements) as string[] });
  });

  app.delete("/api/facility/jobs/:id", requireAuth, async (req, res) => {
    const id = parseInt(req.params.id as string, 10);
    if (isNaN(id)) return res.status(400).json({ message: "Invalid job id" });

    const deleted = await storage.deleteJobPosting(id, req.user!.facilityNumber);
    if (!deleted) return res.status(404).json({ message: "Job posting not found" });
    res.json({ ok: true });
  });

  // ── Job Seeker Auth ──────────────────────────────────────────────────────────

  const jobSeekerRegisterSchema = z.object({
    username: z.string().min(3, "Username must be at least 3 characters").max(50),
    email: z.string().email("Invalid email address"),
    password: z.string().min(8, "Password must be at least 8 characters"),
  });

  const jobSeekerProfileSchema = z.object({
    name: z.string().optional(),
    phone: z.string().optional(),
    city: z.string().optional(),
    yearsExperience: z.number().int().min(0).max(50).optional(),
    jobTypes: z.array(z.string()).optional(),
    bio: z.string().optional(),
  });

  app.post("/api/jobseeker/register", async (req, res) => {
    const parsed = jobSeekerRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const { username, email, password } = parsed.data;

    const existingByUsername = await storage.getJobSeekerAccountByUsername(username);
    if (existingByUsername) {
      return res.status(409).json({ message: "Username is already taken" });
    }
    const existingByEmail = await storage.getJobSeekerAccountByEmail(email);
    if (existingByEmail) {
      return res.status(409).json({ message: "Email is already registered" });
    }

    const hashed = await hashPassword(password);
    const account = await storage.createJobSeekerAccount({
      username,
      email,
      password: hashed,
      createdAt: Date.now(),
    });

    req.session.jobSeekerId = account.id;
    res.status(201).json({ id: account.id, username: account.username, email: account.email });
  });

  app.post("/api/jobseeker/login", async (req, res) => {
    const { username, password } = req.body as { username?: string; password?: string };
    if (!username || !password) {
      return res.status(400).json({ message: "Username and password are required" });
    }
    const account = await storage.getJobSeekerAccountByUsername(username);
    if (!account) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const valid = await comparePassword(password, account.password);
    if (!valid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    req.session.jobSeekerId = account.id;
    res.json({ id: account.id, username: account.username, email: account.email });
  });

  app.post("/api/jobseeker/logout", (req, res) => {
    req.session.jobSeekerId = undefined;
    res.json({ ok: true });
  });

  app.get("/api/jobseeker/me", async (req, res) => {
    if (!req.session.jobSeekerId) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    const account = await storage.getJobSeekerAccount(req.session.jobSeekerId);
    if (!account) {
      req.session.jobSeekerId = undefined;
      return res.status(401).json({ message: "Not authenticated" });
    }
    res.json({ id: account.id, username: account.username, email: account.email });
  });

  app.get("/api/jobseeker/profile", requireJobSeekerAuth, async (req, res) => {
    const profile = await storage.getJobSeekerProfile(req.session.jobSeekerId!);
    res.json(profile ?? null);
  });

  app.put("/api/jobseeker/profile", requireJobSeekerAuth, async (req, res) => {
    const parsed = jobSeekerProfileSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const { jobTypes, ...rest } = parsed.data;
    const data: any = { ...rest };
    if (jobTypes !== undefined) data.jobTypes = JSON.stringify(jobTypes);

    const profile = await storage.upsertJobSeekerProfile(req.session.jobSeekerId!, data);
    res.json({
      ...profile,
      jobTypes: profile.jobTypes ? JSON.parse(profile.jobTypes) : [],
    });
  });
}
