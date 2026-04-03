import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import passport from "passport";
import { z } from "zod";
import { randomInt } from "crypto";
import { storage } from "./storage";
import { hashPassword, comparePassword } from "./auth";
import { sendVerificationEmail } from "./email";

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

function generateOTP(): string {
  return randomInt(100000, 999999).toString();
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

const jobSeekerRegisterSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const jobSeekerProfileSchema = z.object({
  firstName: z.string().optional(),
  lastName: z.string().optional(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zipCode: z.string().optional(),
  profilePictureUrl: z.string().optional(),
  yearsExperience: z.number().int().min(0).max(50).optional(),
  jobTypes: z.array(z.string()).optional(),
  bio: z.string().optional(),
});

export async function registerRoutes(server: Server, app: Express) {
  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // ── Facility Auth ────────────────────────────────────────────────────────────

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

  // ── Public job listings ──────────────────────────────────────────────────────

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

  // Register: email + password, sends OTP verification email
  app.post("/api/jobseeker/register", async (req, res) => {
    const parsed = jobSeekerRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const { email, password } = parsed.data;

    const existingByEmail = await storage.getJobSeekerAccountByEmail(email);
    if (existingByEmail) {
      // If already registered but not verified, resend OTP
      if (!existingByEmail.emailVerified) {
        const otp = generateOTP();
        const expiry = Date.now() + 15 * 60 * 1000; // 15 minutes
        await storage.updateJobSeekerAccount(existingByEmail.id, {
          verificationToken: otp,
          verificationExpiry: expiry,
        });
        await sendVerificationEmail(email, otp);
        return res.status(200).json({ emailSent: true, needsVerification: true });
      }
      return res.status(409).json({ message: "Email is already registered" });
    }

    const hashed = await hashPassword(password);
    const otp = generateOTP();
    const expiry = Date.now() + 15 * 60 * 1000;

    const account = await storage.createJobSeekerAccount({
      username: email, // use email as username
      email,
      password: hashed,
      emailVerified: 0,
      verificationToken: otp,
      verificationExpiry: expiry,
      createdAt: Date.now(),
    });

    await sendVerificationEmail(email, otp);

    res.status(201).json({ emailSent: true, needsVerification: true, id: account.id });
  });

  // Verify OTP
  app.post("/api/jobseeker/verify-email", async (req, res) => {
    const { email, otp } = req.body as { email?: string; otp?: string };
    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const account = await storage.getJobSeekerAccountByEmail(email);
    if (!account) {
      return res.status(404).json({ message: "Account not found" });
    }
    if (account.emailVerified) {
      return res.status(400).json({ message: "Email already verified" });
    }
    if (!account.verificationToken || account.verificationToken !== otp) {
      return res.status(400).json({ message: "Invalid verification code" });
    }
    if (!account.verificationExpiry || Date.now() > account.verificationExpiry) {
      return res.status(400).json({ message: "Verification code has expired. Please request a new one." });
    }

    await storage.updateJobSeekerAccount(account.id, {
      emailVerified: 1,
      verificationToken: null,
      verificationExpiry: null,
    });

    req.session.jobSeekerId = account.id;
    res.json({ ok: true, id: account.id, email: account.email });
  });

  // Resend OTP
  app.post("/api/jobseeker/resend-otp", async (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email) return res.status(400).json({ message: "Email is required" });

    const account = await storage.getJobSeekerAccountByEmail(email);
    if (!account) return res.status(404).json({ message: "Account not found" });
    if (account.emailVerified) return res.status(400).json({ message: "Email already verified" });

    const otp = generateOTP();
    const expiry = Date.now() + 15 * 60 * 1000;
    await storage.updateJobSeekerAccount(account.id, {
      verificationToken: otp,
      verificationExpiry: expiry,
    });
    await sendVerificationEmail(email, otp);

    res.json({ emailSent: true });
  });

  // Login: by email + password
  app.post("/api/jobseeker/login", async (req, res) => {
    const { email, password } = req.body as { email?: string; password?: string };
    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }
    const account = await storage.getJobSeekerAccountByEmail(email);
    if (!account) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    const valid = await comparePassword(password, account.password);
    if (!valid) {
      return res.status(401).json({ message: "Invalid credentials" });
    }
    if (!account.emailVerified) {
      return res.status(403).json({ message: "Please verify your email before signing in.", needsVerification: true });
    }
    req.session.jobSeekerId = account.id;
    res.json({ id: account.id, email: account.email });
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
    res.json({ id: account.id, email: account.email });
  });

  app.get("/api/jobseeker/profile", requireJobSeekerAuth, async (req, res) => {
    const profile = await storage.getJobSeekerProfile(req.session.jobSeekerId!);
    if (!profile) return res.json(null);
    res.json({
      ...profile,
      jobTypes: profile.jobTypes ? JSON.parse(profile.jobTypes) : [],
    });
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
