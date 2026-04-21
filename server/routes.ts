import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import passport from "passport";
import { z } from "zod";
import { randomInt } from "crypto";
import { storage } from "./storage";
import { hashPassword } from "./auth";
import { sendVerificationEmail, sendPasswordResetEmail } from "./email";
import { sqlite } from "./db/index";
import { jobseekerAuthRouter } from "./routes/jobseekerAuth";
import { adminEtlRouter } from "./routes/adminEtl";
import { interestsRouter } from "./routes/interests"; // NEW: expression-of-interest
import { requireJobSeekerAuth } from "./middleware/requireJobSeekerAuth";
import {
  getCachedFacilities,
  invalidateFacilitiesCache,
  isDatabaseSeeded,
  typeToGroup,
} from "./services/facilitiesService";
import {
  queryFacilitiesAll,
  searchFacilitiesAutocomplete,
  getFacilitiesMeta,
  type FacilityDbRow,
} from "./storage";

const facilityOtpStore = new Map<string, { otp: string; expiry: number }>();

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
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
  email: z.string().email("A valid email address is required"),
  password: z.string().min(8, "Password must be at least 8 characters"),
});

const facilityForgotPasswordSchema = z.object({
  email: z.string().email("A valid email address is required"),
});

const facilityResetPasswordSchema = z.object({
  email: z.string().email("A valid email address is required"),
  token: z.string().length(6, "Code must be 6 digits"),
  newPassword: z.string().min(8, "Password must be at least 8 characters"),
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
  // ── Job Seeker Auth (login / logout / me / dashboard) ────────────────────
  // Handled by the clean-architecture router.  Registration, OTP verification,
  // and profile management remain below for now.
  app.use("/api/jobseeker", jobseekerAuthRouter);
  app.use("/api/admin/etl", adminEtlRouter);
  app.use("/api", interestsRouter); // NEW: expression-of-interest

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // ── Facilities (live from CHHS open data, 24 h server-side cache) ─────────

  // ── /api/facilities/meta — filter UI metadata ────────────────────────────────
  app.get("/api/facilities/meta", async (_req, res, next) => {
    try {
      if (isDatabaseSeeded()) {
        res.json(getFacilitiesMeta());
      } else {
        // Compute from in-memory cache
        const facilities = await getCachedFacilities();
        const countByType: Record<string, number> = {};
        const countByGroup: Record<string, number> = {};
        const countByCounty: Record<string, number> = {};
        const countByStatus: Record<string, number> = {};
        for (const f of facilities) {
          countByType[f.facilityType] = (countByType[f.facilityType] ?? 0) + 1;
          countByGroup[f.facilityGroup] = (countByGroup[f.facilityGroup] ?? 0) + 1;
          countByCounty[f.county] = (countByCounty[f.county] ?? 0) + 1;
          countByStatus[f.status] = (countByStatus[f.status] ?? 0) + 1;
        }
        res.json({
          totalCount: facilities.length,
          facilityTypes: Object.keys(countByType).sort(),
          facilityGroups: Object.keys(countByGroup).sort(),
          counties: Object.keys(countByCounty).sort(),
          statuses: Object.keys(countByStatus).sort(),
          countByType,
          countByGroup,
          countByCounty,
          countByStatus,
          lastUpdated: null,
        });
      }
    } catch (err) {
      next(err);
    }
  });

  // ── /api/facilities/search — typeahead autocomplete ───────────────────────────
  app.get("/api/facilities/search", async (req, res, next) => {
    try {
      const q = String(req.query.q ?? "").trim();
      if (!q) return res.json([]);

      if (isDatabaseSeeded()) {
        const rows = searchFacilitiesAutocomplete(q, 10);
        res.json(rows.map((r) => ({
          number: r.number,
          name: r.name,
          city: r.city,
          county: r.county,
          facilityType: r.facility_type,
        })));
      } else {
        const facilities = await getCachedFacilities();
        const ql = q.toLowerCase();
        const matches = facilities
          .filter(
            (f) =>
              f.name.toLowerCase().includes(ql) ||
              f.city.toLowerCase().includes(ql) ||
              f.number.includes(ql)
          )
          .slice(0, 10)
          .map((f) => ({
            number: f.number,
            name: f.name,
            city: f.city,
            county: f.county,
            facilityType: f.facilityType,
          }));
        res.json(matches);
      }
    } catch (err) {
      next(err);
    }
  });

  // ── /api/facilities — full list with optional filtering ───────────────────────
  app.get("/api/facilities", async (req, res, next) => {
    try {
      const jobs = await storage.getAllJobPostings();

      // Index job postings by facility number
      const jobsByFacility = new Map<string, any[]>();
      const hiringNumbers = new Set<string>();
      for (const job of jobs) {
        const arr = jobsByFacility.get(job.facilityNumber) ?? [];
        arr.push(job);
        jobsByFacility.set(job.facilityNumber, arr);
        hiringNumbers.add(job.facilityNumber);
      }

      // Parse filter query params
      const search = String(req.query.search ?? "").trim() || undefined;
      const county = String(req.query.county ?? "").trim() || undefined;
      const facilityType = String(req.query.facilityType ?? "").trim() || undefined;
      const facilityGroup = String(req.query.facilityGroup ?? "").trim() || undefined;
      const statusParam = String(req.query.status ?? "").trim();
      const statuses = statusParam ? statusParam.split(",").map((s) => s.trim()).filter(Boolean) : undefined;
      const hiringOnly = req.query.isHiring === "true";
      const minCap = req.query.minCapacity ? parseInt(String(req.query.minCapacity), 10) : undefined;
      const maxCap = req.query.maxCapacity ? parseInt(String(req.query.maxCapacity), 10) : undefined;
      const bboxParam = String(req.query.bbox ?? "").trim();
      const bbox = bboxParam
        ? (() => {
            const [minLat, minLng, maxLat, maxLng] = bboxParam.split(",").map(Number);
            return { minLat, minLng, maxLat, maxLng };
          })()
        : undefined;

      const mergeJobs = (number: string, facilityData: any) => {
        const fJobs = jobsByFacility.get(number) ?? [];
        return {
          ...facilityData,
          jobPostings: fJobs.map((j: any) => ({
            title: j.title,
            type: j.type,
            salary: j.salary,
            description: j.description,
            requirements: JSON.parse(j.requirements) as string[],
            postedDaysAgo: Math.floor((Date.now() - j.postedAt) / 86_400_000),
          })),
          isHiring: fJobs.length > 0,
        };
      };

      if (isDatabaseSeeded()) {
        let rows = queryFacilitiesAll({
          search,
          county,
          facilityType,
          facilityGroup,
          statuses,
          minCapacity: minCap,
          maxCapacity: maxCap,
          bbox,
        });

        // Apply isHiring filter post-query (requires job_postings data)
        if (hiringOnly) {
          rows = rows.filter((r) => hiringNumbers.has(r.number));
        }

        const result = rows.map((r: FacilityDbRow) =>
          mergeJobs(r.number, {
            number: r.number,
            name: r.name,
            facilityType: r.facility_type,
            facilityGroup: r.facility_group,
            county: r.county,
            address: r.address,
            city: r.city,
            zip: r.zip,
            phone: r.phone,
            licensee: r.licensee,
            administrator: r.administrator,
            status: r.status,
            capacity: r.capacity ?? 0,
            firstLicenseDate: r.first_license_date,
            closedDate: r.closed_date,
            lastInspectionDate: r.last_inspection_date,
            totalVisits: r.total_visits ?? 0,
            inspectionVisits: 0,
            complaintVisits: 0,
            inspectTypeB: 0,
            otherTypeB: 0,
            complaintTypeB: 0,
            totalTypeB: r.total_type_b ?? 0,
            citations: r.citations ? String(r.citations) : "",
            lat: r.lat!,
            lng: r.lng!,
            geocodeQuality: r.geocode_quality,
          })
        );

        res.json(result);
      } else {
        // Fallback: in-memory CHHS data
        let facilities = await getCachedFacilities();

        // Apply filters client-side on the in-memory list
        if (search) {
          const ql = search.toLowerCase();
          facilities = facilities.filter(
            (f) =>
              f.name.toLowerCase().includes(ql) ||
              f.address.toLowerCase().includes(ql) ||
              f.city.toLowerCase().includes(ql) ||
              f.county.toLowerCase().includes(ql) ||
              f.licensee.toLowerCase().includes(ql) ||
              f.administrator.toLowerCase().includes(ql) ||
              f.number.includes(ql) ||
              f.zip.includes(ql)
          );
        }
        if (county) facilities = facilities.filter((f) => f.county === county);
        if (facilityType) facilities = facilities.filter((f) => f.facilityType === facilityType);
        if (facilityGroup) facilities = facilities.filter((f) => f.facilityGroup === facilityGroup);
        if (statuses && statuses.length > 0) facilities = facilities.filter((f) => statuses.includes(f.status));
        if (hiringOnly) facilities = facilities.filter((f) => hiringNumbers.has(f.number));
        if (minCap != null) facilities = facilities.filter((f) => f.capacity >= minCap);
        if (maxCap != null) facilities = facilities.filter((f) => f.capacity <= maxCap);
        if (bbox) {
          facilities = facilities.filter(
            (f) =>
              f.lat >= bbox.minLat && f.lat <= bbox.maxLat &&
              f.lng >= bbox.minLng && f.lng <= bbox.maxLng
          );
        }

        const result = facilities.map((f) => mergeJobs(f.number, f));
        res.json(result);
      }
    } catch (err) {
      next(err);
    }
  });

  /** POST /api/facilities/refresh — force-invalidate the 24 h cache */
  app.post("/api/facilities/refresh", requireAuth, (_req, res) => {
    invalidateFacilitiesCache();
    res.json({ ok: true, message: "Facility cache cleared — next GET will re-fetch from CHHS." });
  });

  // ── Facility Auth ────────────────────────────────────────────────────────────

  app.post("/api/facility/send-otp", async (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email) return res.status(400).json({ message: "Email is required" });

    const otp = generateOTP();
    facilityOtpStore.set(email, { otp, expiry: Date.now() + 15 * 60 * 1000 });
    await sendVerificationEmail(email, otp);
    res.json({ emailSent: true });
  });

  app.post("/api/facility/register", async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const { facilityNumber, username, email, password } = parsed.data;

    // If this facility already has an account
    const existingByNumber = await storage.getFacilityAccountByNumber(facilityNumber);
    if (existingByNumber) {
      // Unverified — resend OTP so they can complete registration
      if (!existingByNumber.emailVerified) {
        const otp = generateOTP();
        const expiry = Date.now() + 15 * 60 * 1000;
        await storage.updateFacilityAccount(existingByNumber.id, {
          verificationToken: otp,
          verificationExpiry: expiry,
        });
        await sendVerificationEmail(existingByNumber.email!, otp);
        return res.status(200).json({ emailSent: true, needsVerification: true });
      }
      return res.status(409).json({ message: "An account for this facility already exists" });
    }

    const existingByUsername = await storage.getFacilityAccountByUsername(username);
    if (existingByUsername) {
      return res.status(409).json({ message: "Username already taken" });
    }

    const hashed = await hashPassword(password);
    const otp = generateOTP();
    const expiry = Date.now() + 15 * 60 * 1000;

    await storage.createFacilityAccount({
      facilityNumber,
      username,
      email,
      password: hashed,
      emailVerified: 0,
      verificationToken: otp,
      verificationExpiry: expiry,
      createdAt: Date.now(),
    });

    await sendVerificationEmail(email, otp);
    res.status(201).json({ emailSent: true, needsVerification: true });
  });

  // Verify facility OTP → log in
  app.post("/api/facility/verify-email", async (req, res, next) => {
    const { email, otp } = req.body as { email?: string; otp?: string };
    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const account = await storage.getFacilityAccountByEmail(email);
    if (!account) return res.status(404).json({ message: "Account not found" });
    if (account.emailVerified) return res.status(400).json({ message: "Email already verified" });
    if (!account.verificationToken || account.verificationToken !== otp) {
      return res.status(400).json({ message: "Invalid verification code" });
    }
    if (!account.verificationExpiry || Date.now() > account.verificationExpiry) {
      return res.status(400).json({ message: "Verification code has expired. Please request a new one." });
    }

    await storage.updateFacilityAccount(account.id, {
      emailVerified: 1,
      verificationToken: null,
      verificationExpiry: null,
    });

    req.login(account, (err) => {
      if (err) return next(err);
      res.json({ ok: true, id: account.id, facilityNumber: account.facilityNumber, username: account.username });
    });
  });

  // Resend facility OTP
  app.post("/api/facility/resend-otp", async (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email) return res.status(400).json({ message: "Email is required" });

    const account = await storage.getFacilityAccountByEmail(email);
    if (!account) return res.status(404).json({ message: "Account not found" });
    if (account.emailVerified) return res.status(400).json({ message: "Email already verified" });

    const otp = generateOTP();
    const expiry = Date.now() + 15 * 60 * 1000;
    await storage.updateFacilityAccount(account.id, {
      verificationToken: otp,
      verificationExpiry: expiry,
    });
    await sendVerificationEmail(email, otp);
    res.json({ emailSent: true });
  });

  app.post("/api/facility/login", async (req, res, next) => {
    passport.authenticate("local", async (err: any, user: Express.User | false, info: any) => {
      if (err) return next(err);
      if (!user) {
        if (info?.message === "EMAIL_NOT_VERIFIED") {
          // Look up the email so the client can show the OTP screen pre-filled
          const account = await storage.getFacilityAccountByUsername(req.body.username ?? "");
          return res.status(403).json({
            message: "Please verify your email before logging in.",
            code: "EMAIL_NOT_VERIFIED",
            email: account?.email ?? "",
          });
        }
        return res.status(401).json({ message: info?.message || "Invalid credentials" });
      }
      req.login(user, (loginErr) => {
        if (loginErr) return next(loginErr);
        res.json({ id: user.id, facilityNumber: user.facilityNumber, username: user.username });
      });
    })(req, res, next);
  });

  app.post("/api/facility/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      res.json({ ok: true });
    });
  });

  // Initiate facility password reset — always returns { emailSent: true } to prevent enumeration
  app.post("/api/facility/forgot-password", async (req, res, next) => {
    try {
      const parsed = facilityForgotPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const account = await storage.getFacilityAccountByEmail(parsed.data.email);
      if (account && account.emailVerified) {
        const otp = generateOTP();
        const expiry = Date.now() + 15 * 60 * 1000;
        await storage.updateFacilityAccount(account.id, {
          verificationToken: otp,
          verificationExpiry: expiry,
        });
        await sendPasswordResetEmail(parsed.data.email, otp);
      }

      return res.json({ emailSent: true });
    } catch (err) {
      next(err);
    }
  });

  // Complete facility password reset — validates OTP, updates password, invalidates sessions
  app.post("/api/facility/reset-password", async (req, res, next) => {
    try {
      const parsed = facilityResetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const { email, token, newPassword } = parsed.data;
      const account = await storage.getFacilityAccountByEmail(email);

      const invalidMsg = "Code is invalid or has already been used. Please request a new one.";
      if (!account) return res.status(400).json({ message: invalidMsg });
      if (!account.verificationToken || account.verificationToken !== token) {
        return res.status(400).json({ message: invalidMsg });
      }
      if (!account.verificationExpiry || Date.now() > account.verificationExpiry) {
        return res.status(400).json({ message: invalidMsg });
      }

      const hashed = await hashPassword(newPassword);
      await storage.updateFacilityAccount(account.id, {
        password: hashed,
        verificationToken: null,
        verificationExpiry: null,
      });

      // Invalidate all active sessions for this facility account.
      sqlite
        .prepare("DELETE FROM sessions WHERE json_extract(sess, '$.passport.user') = ?")
        .run(account.id);

      return res.json({ ok: true });
    } catch (err) {
      next(err);
    }
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
    req.session.save((err) => {
      if (err) {
        console.error("Session save failed after OTP verification:", err);
        return res.status(500).json({ message: "Session creation failed. Please try logging in." });
      }
      res.json({ ok: true, id: account.id, email: account.email });
    });
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
