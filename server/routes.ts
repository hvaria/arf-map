import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "http";
import passport from "passport";
import { z } from "zod";
import { randomInt, createHash, timingSafeEqual } from "crypto";
import { storage } from "./storage";
import { authRateLimiter } from "./middleware/rateLimiter";
import { hashPassword } from "./auth";
import { parseSalary } from "./services/payParser";
import { jobMatchesTags, parseTagsParam } from "./services/jobMatch";
import { sendVerificationEmail, sendPasswordResetEmail } from "./email";
import { jobseekerAuthRouter } from "./routes/jobseekerAuth";
import { adminEtlRouter } from "./routes/adminEtl";
import { interestsRouter } from "./routes/interests"; // NEW: expression-of-interest
import { credentialsRouter } from "./routes/credentials";
import { workExperienceRouter } from "./routes/workExperience";
import { billingRouter } from "./routes/billing";
import { facilityProfileRouter } from "./routes/facilityProfile";
import { requireJobSeekerAuth } from "./middleware/requireJobSeekerAuth";
import {
  getCachedFacilities,
  invalidateFacilitiesCache,
  isDatabaseSeeded,
  typeToGroup,
} from "./services/facilitiesService";
import {
  queryFacilitiesAllAsync,
  queryFacilityPinsAsync,
  getFacilityByNumberAsync,
  searchFacilitiesAutocompleteAsync,
  getFacilitiesMetaAsync,
  type FacilityDbRow,
} from "./storage";
import { pool } from "./db/index";

// ── S-02: Token hashing helpers ───────────────────────────────────────────────
// OTP tokens stored in the DB are SHA-256 hashes; raw tokens are sent via email.
function hashOtp(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
function safeCompareOtp(storedHash: string, rawToken: string): boolean {
  if (storedHash.length !== 64) return false; // legacy plain-text token — reject
  const stored = Buffer.from(storedHash, "hex");
  const provided = Buffer.from(hashOtp(rawToken), "hex");
  if (stored.length !== provided.length) return false;
  return timingSafeEqual(stored, provided);
}

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.isAuthenticated()) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

function generateOTP(): string {
  return randomInt(100000, 999999).toString();
}

/** Defensive JSON.parse for TEXT-stored array columns — never throws. */
function safeParseJsonArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
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

// Reject obvious placeholder/test strings so seed data and rushed entries
// can't surface in the public Open Positions feed.
const PLACEHOLDER_REGEX = /^(test|placeholder|n\/a|na|todo|tbd|sample|asdf|x+|\.+|-+)$/i;
const isPlaceholder = (s: string) => PLACEHOLDER_REGEX.test(s.trim());

const jobPostingInputSchema = z.object({
  title: z.string()
    .min(3, "Title must be at least 3 characters")
    .refine((s) => !isPlaceholder(s), "Title cannot be placeholder text"),
  type: z.string().min(1, "Type is required"),
  salary: z.string()
    .min(1, "Salary is required")
    .refine((s) => !isPlaceholder(s), "Salary cannot be placeholder text"),
  description: z.string()
    .min(20, "Description must be at least 20 characters")
    .refine((s) => !isPlaceholder(s), "Description cannot be placeholder text"),
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
  app.use("/api", credentialsRouter);
  app.use("/api", workExperienceRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api", facilityProfileRouter);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  // ── Facilities (live from CHHS open data, 24 h server-side cache) ─────────

  // ── /api/facilities/geocode-status — diagnostic geocoding progress ───────────
  app.get("/api/facilities/geocode-status", async (_req, res, next) => {
    try {
      const STATUS_SQL = `
        SELECT
          COUNT(*)                                                          AS total,
          COUNT(CASE WHEN lat IS NOT NULL AND lat != 0 THEN 1 END)         AS geocoded,
          COUNT(CASE WHEN (lat IS NULL OR lat = 0)
                      AND geocode_quality != 'geocode_failed' THEN 1 END)  AS pending,
          COUNT(CASE WHEN geocode_quality = 'geocode_failed' THEN 1 END)   AS failed
        FROM facilities
      `;

      const result = await pool.query(STATUS_SQL);
      const row = result.rows[0];
      const total    = parseInt(row.total,    10) || 0;
      const geocoded = parseInt(row.geocoded, 10) || 0;
      const pending  = parseInt(row.pending,  10) || 0;
      const failed   = parseInt(row.failed,   10) || 0;

      const pct = total > 0 ? ((geocoded / total) * 100).toFixed(1) + "%" : "0.0%";
      res.json({ total, geocoded, pending, failed, pctComplete: pct });
    } catch (err) {
      next(err);
    }
  });

  // ── /api/facilities/meta — filter UI metadata ────────────────────────────────
  app.get("/api/facilities/meta", async (_req, res, next) => {
    try {
      if (isDatabaseSeeded()) {
        res.json(await getFacilitiesMetaAsync());
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
        const rows = await searchFacilitiesAutocompleteAsync(q, 10);
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

  // ── /api/facilities/pins — slim payload for the map ──────────────────────────
  // Returns only the fields the map cluster, pin, hover tooltip, and the
  // right-sidebar Jobs panel actually read. Full detail (licensee, address,
  // visit history, citations, etc.) is loaded on demand from
  // /api/facilities/:number/public when a pin is opened.
  //
  // Same query params as /api/facilities (bbox, county, facilityType,
  // facilityGroup, status, isHiring, minCapacity, maxCapacity, search).
  app.get("/api/facilities/pins", async (req, res, next) => {
    try {
      // Same job-postings index used by /api/facilities so isHiring is
      // consistent across the two endpoints.
      const jobs = await storage.getAllJobPostings();
      const jobCountByFacility = new Map<string, number>();
      for (const job of jobs) {
        jobCountByFacility.set(
          job.facilityNumber,
          (jobCountByFacility.get(job.facilityNumber) ?? 0) + 1,
        );
      }

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

      if (isDatabaseSeeded()) {
        let rows = await queryFacilityPinsAsync({
          search,
          county,
          facilityType,
          facilityGroup,
          statuses,
          minCapacity: minCap,
          maxCapacity: maxCap,
          bbox,
        });

        if (hiringOnly) {
          rows = rows.filter((r) => jobCountByFacility.has(r.number));
        }

        const result = rows.map((r) => {
          const jobCount = jobCountByFacility.get(r.number) ?? 0;
          return {
            number: r.number,
            name: r.name,
            lat: r.lat,
            lng: r.lng,
            city: r.city,
            county: r.county,
            capacity: r.capacity ?? 0,
            status: r.status,
            facilityType: r.facility_type,
            facilityGroup: r.facility_group,
            isHiring: jobCount > 0,
            jobCount,
          };
        });

        // Short cache — job-postings counts are derived per-request so the
        // cache must turn over quickly enough that newly posted jobs surface.
        res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
        res.json(result);
      } else {
        // Live-fetch fallback when DB isn't seeded — no coords yet, but we
        // still honor the slim contract.
        let facilities = (await getCachedFacilities()).filter((f) => f.lat !== 0 && f.lng !== 0);
        if (search) {
          const ql = search.toLowerCase();
          facilities = facilities.filter(
            (f) =>
              f.name.toLowerCase().includes(ql) ||
              f.city.toLowerCase().includes(ql) ||
              f.county.toLowerCase().includes(ql) ||
              f.number.includes(ql),
          );
        }
        if (county) facilities = facilities.filter((f) => f.county === county);
        if (facilityType) facilities = facilities.filter((f) => f.facilityType === facilityType);
        if (facilityGroup) facilities = facilities.filter((f) => f.facilityGroup === facilityGroup);
        if (statuses && statuses.length > 0) facilities = facilities.filter((f) => statuses.includes(f.status));
        if (hiringOnly) facilities = facilities.filter((f) => jobCountByFacility.has(f.number));
        if (minCap != null) facilities = facilities.filter((f) => f.capacity >= minCap);
        if (maxCap != null) facilities = facilities.filter((f) => f.capacity <= maxCap);
        if (bbox) {
          facilities = facilities.filter(
            (f) =>
              f.lat >= bbox.minLat && f.lat <= bbox.maxLat &&
              f.lng >= bbox.minLng && f.lng <= bbox.maxLng,
          );
        }

        const result = facilities.map((f) => {
          const jobCount = jobCountByFacility.get(f.number) ?? 0;
          return {
            number: f.number,
            name: f.name,
            lat: f.lat,
            lng: f.lng,
            city: f.city,
            county: f.county,
            capacity: f.capacity,
            status: f.status,
            facilityType: f.facilityType,
            facilityGroup: f.facilityGroup,
            isHiring: jobCount > 0,
            jobCount,
          };
        });
        res.set("Cache-Control", "public, max-age=60, stale-while-revalidate=300");
        res.json(result);
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
        let rows = await queryFacilitiesAllAsync({
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
        // Fallback: in-memory CCL data (no coords yet — geocoding runs in background)
        let facilities = (await getCachedFacilities()).filter((f) => f.lat !== 0 && f.lng !== 0);

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

  // S-03: rate-limited to 5 requests per 15 minutes per IP
  app.post("/api/facility/register", authRateLimiter, async (req, res) => {
    const parsed = registerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const { facilityNumber, username, email, password } = parsed.data;

    // If this facility already has an account
    const existingByNumber = await storage.getFacilityAccountByNumber(facilityNumber);
    if (existingByNumber) {
      // Unverified — update password (user may have changed it) and resend OTP
      if (!existingByNumber.emailVerified) {
        const hashed = await hashPassword(password);
        const otp = generateOTP();
        const expiry = Date.now() + 15 * 60 * 1000;
        await storage.updateFacilityAccount(existingByNumber.id, {
          password: hashed,
          verificationToken: hashOtp(otp), // S-02: store hash, send raw
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
      verificationToken: hashOtp(otp), // S-02: store hash, send raw
      verificationExpiry: expiry,
      createdAt: Date.now(),
    });

    await sendVerificationEmail(email, otp);
    res.status(201).json({ emailSent: true, needsVerification: true });
  });

  // Verify facility OTP → log in
  // S-03: rate-limited to 5 requests per 15 minutes per IP
  app.post("/api/facility/verify-email", authRateLimiter, async (req, res, next) => {
    const { email, otp } = req.body as { email?: string; otp?: string };
    if (!email || !otp) {
      return res.status(400).json({ message: "Email and OTP are required" });
    }

    const account = await storage.getFacilityAccountByEmail(email);
    if (!account) return res.status(404).json({ message: "Account not found" });
    if (account.emailVerified) return res.status(400).json({ message: "Email already verified" });
    // S-02: constant-time hash comparison
    if (!account.verificationToken || !safeCompareOtp(account.verificationToken, otp)) {
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

    // CCLD auto-prefill: run the override-row prefill exactly once on first
    // successful verification so the facility's dashboard lands with the
    // CCLD-derived contact + address fields already populated. Idempotent at
    // the storage layer (no-op if the row's `prefilledFromCcldAt` is set),
    // and best-effort — a missing CCLD row or DB hiccup must NOT block login.
    let ccldPrefill: { fields: string[]; at: number } | null = null;
    try {
      const result = await storage.prefillFacilityOverrideFromCcld(
        account.facilityNumber,
        "system_prefill",
      );
      if (result.prefilled.length > 0 && result.override.prefilledFromCcldAt) {
        ccldPrefill = {
          fields: result.prefilled,
          at: result.override.prefilledFromCcldAt,
        };
      }
    } catch (prefillErr) {
      console.error("[facility/verify-email] CCLD prefill failed", prefillErr);
    }

    // S-04: regenerate session before login to prevent session fixation
    req.session.regenerate((regErr) => {
      if (regErr) return next(regErr);
      req.login(account, (err) => {
        if (err) return next(err);
        res.json({
          ok: true,
          id: account.id,
          facilityNumber: account.facilityNumber,
          username: account.username,
          ccldPrefill,
        });
      });
    });
  });

  // Resend facility OTP
  // S-03: rate-limited to 5 requests per 15 minutes per IP
  app.post("/api/facility/resend-otp", authRateLimiter, async (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email) return res.status(400).json({ message: "Email is required" });

    const account = await storage.getFacilityAccountByEmail(email);
    if (!account) return res.status(404).json({ message: "Account not found" });
    if (account.emailVerified) return res.status(400).json({ message: "Email already verified" });

    const otp = generateOTP();
    const expiry = Date.now() + 15 * 60 * 1000;
    await storage.updateFacilityAccount(account.id, {
      verificationToken: hashOtp(otp), // S-02: store hash, send raw
      verificationExpiry: expiry,
    });
    await sendVerificationEmail(email, otp);
    res.json({ emailSent: true });
  });

  // S-03: rate-limited to 5 requests per 15 minutes per IP
  app.post("/api/facility/login", authRateLimiter, async (req, res, next) => {
    res.set("Cache-Control", "no-store"); // S-06
    passport.authenticate("local", async (err: any, user: Express.User | false, info: any) => {
      if (err) return next(err);
      if (!user) {
        if (info?.message === "EMAIL_NOT_VERIFIED") {
          // Look up the email so the client can show the OTP screen pre-filled.
          // Identifier may be either a username or an email (login accepts both).
          const identifier = (req.body.username ?? "") as string;
          const account = identifier.includes("@")
            ? await storage.getFacilityAccountByEmail(identifier)
            : await storage.getFacilityAccountByUsername(identifier);
          return res.status(403).json({
            message: "Please verify your email before logging in.",
            code: "EMAIL_NOT_VERIFIED",
            email: account?.email ?? "",
          });
        }
        if (info?.message === "ACCOUNT_LOCKED") {
          return res.status(403).json({
            message: "Your account has been temporarily locked due to too many failed login attempts. Please contact support.",
            code: "ACCOUNT_LOCKED",
          });
        }
        return res.status(401).json({ message: info?.message || "Invalid credentials" });
      }
      // S-04: regenerate session before login to prevent session fixation
      req.session.regenerate((regErr) => {
        if (regErr) return next(regErr);
        req.login(user, (loginErr) => {
          if (loginErr) return next(loginErr);
          res.json({ id: user.id, facilityNumber: user.facilityNumber, username: user.username });
        });
      });
    })(req, res, next);
  });

  app.post("/api/facility/logout", (req, res, next) => {
    req.logout((err) => {
      if (err) return next(err);
      // S-09: destroy session and clear cookie (was missing clearCookie)
      req.session.destroy((destroyErr) => {
        if (destroyErr) console.error("[facility/logout] session destroy error:", destroyErr);
        res.clearCookie("connect.sid");
        res.set("Cache-Control", "no-store"); // S-06
        res.json({ ok: true });
      });
    });
  });

  // Initiate facility password reset — always returns { emailSent: true } to prevent enumeration
  // S-03: rate-limited to 5 requests per 15 minutes per IP
  app.post("/api/facility/forgot-password", authRateLimiter, async (req, res, next) => {
    res.set("Cache-Control", "no-store"); // S-06
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
          verificationToken: hashOtp(otp), // S-02: store hash, send raw
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
  // S-03: rate-limited to 5 requests per 15 minutes per IP
  app.post("/api/facility/reset-password", authRateLimiter, async (req, res, next) => {
    res.set("Cache-Control", "no-store"); // S-06
    try {
      const parsed = facilityResetPasswordSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: parsed.error.errors[0].message });
      }

      const { email, token, newPassword } = parsed.data;
      const account = await storage.getFacilityAccountByEmail(email);

      const invalidMsg = "Code is invalid or has already been used. Please request a new one.";
      if (!account) return res.status(400).json({ message: invalidMsg });
      // S-02: constant-time hash comparison
      if (!account.verificationToken || !safeCompareOtp(account.verificationToken, token)) {
        return res.status(400).json({ message: invalidMsg });
      }
      if (!account.verificationExpiry || Date.now() > account.verificationExpiry) {
        return res.status(400).json({ message: invalidMsg });
      }

      const hashed = await hashPassword(newPassword);
      // Clear the failed-login counter on successful OTP-backed reset. The
      // OTP itself proves email control, so the lockout's brute-force
      // protection has already been satisfied via a stronger factor — leaving
      // the counter pinned at the lockout threshold would trap legitimate
      // users who reset *because* they got locked out.
      await storage.updateFacilityAccount(account.id, {
        password: hashed,
        verificationToken: null,
        verificationExpiry: null,
        failedLoginCount: 0,
      });

      await pool.query(
        "DELETE FROM session WHERE sess->'passport'->>'user' = $1",
        [String(account.id)]
      );

      return res.json({ ok: true });
    } catch (err) {
      next(err);
    }
  });

  app.get("/api/facility/me", async (req, res) => {
    res.set("Cache-Control", "no-store"); // S-06: don't cache auth state
    if (!req.isAuthenticated() || !req.user) {
      return res.status(401).json({ message: "Not authenticated" });
    }
    // CCLD prefill summary — surfaces the timestamp + the columns that the
    // signup-time prefill wrote so the dashboard can show a one-time toast
    // ("Pre-filled N fields from your CCLD license record"). The FE may also
    // call POST /api/facility/profile/prefill-from-ccld explicitly; this read
    // is just a convenience hint so first dashboard load has the data ready.
    let ccldPrefill: { fields: string[]; at: number } | null = null;
    try {
      const override = await storage.getFacilityOverride(req.user.facilityNumber);
      if (override?.prefilledFromCcldAt) {
        const parsed = override.prefilledFields
          ? safeParseJsonArray(override.prefilledFields)
          : [];
        ccldPrefill = { fields: parsed, at: override.prefilledFromCcldAt };
      }
    } catch (err) {
      // Non-fatal — log and continue. Auth payload must still resolve.
      console.error("[facility/me] override lookup failed", err);
    }
    // Subscription block (Phase 0): exposes the hot-path cache columns the
    // Operations gate reads from. status + currentPeriodEnd are populated by
    // the Stripe webhook writer (Phase 1); the remaining fields are
    // intentionally stubbed null and will be filled in from
    // facility_subscriptions when Phase 1 lands. Frontend treats null fields
    // as "not yet wired" — see client/src/types/subscription if it exists.
    res.json({
      id: req.user.id,
      facilityNumber: req.user.facilityNumber,
      username: req.user.username,
      role: req.user.role ?? "facility_admin",
      ccldPrefill,
      subscription: {
        status: req.user.subscriptionStatus ?? null,
        currentPeriodEnd: req.user.subscriptionCurrentPeriodEnd ?? null,
        // Phase 1 fields — populated from facility_subscriptions once the
        // Stripe webhook writer is in place.
        cancelAtPeriodEnd: false,
        planId: null,
        latestInvoiceUrl: null,
        lastFour: null,
        cardBrand: null,
      },
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

  app.get("/api/jobs", async (req, res) => {
    // Optional tag filter from the signed-in seeker's profile chips
    // (?tags=Caregiver,DSP). Empty / missing tags returns the full
    // feed, so anonymous + facility callers are unaffected.
    const tags = parseTagsParam(req.query.tags);
    const jobs = await storage.getAllJobPostings();
    const matched = tags.length > 0
      ? jobs.filter((jp) => jobMatchesTags(jp, tags))
      : jobs;
    res.json(
      matched.map((jp) => {
        const { payMin, payMax } = parseSalary(jp.salary);
        return {
          ...jp,
          requirements: JSON.parse(jp.requirements) as string[],
          payMin,
          payMax,
        };
      }),
    );
  });

  app.get("/api/jobs/:id", async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid job id" });
    }
    const jp = await storage.getJobPostingById(id);
    if (!jp) {
      return res.status(404).json({ message: "Job not found" });
    }
    const { payMin, payMax } = parseSalary(jp.salary);
    res.json({
      ...jp,
      requirements: JSON.parse(jp.requirements) as string[],
      payMin,
      payMax,
    });
  });

  // ── Public facility data ─────────────────────────────────────────────────────

  app.get("/api/facilities/:number/public", async (req, res) => {
    const { number } = req.params;
    const [overrides, jobPostings, row] = await Promise.all([
      storage.getFacilityOverride(number),
      storage.getJobPostings(number),
      getFacilityByNumberAsync(number),
    ]);
    const facility = row
      ? {
          number: row.number,
          name: row.name,
          facilityType: row.facility_type,
          facilityGroup: row.facility_group,
          county: row.county,
          address: row.address,
          city: row.city,
          zip: row.zip,
          phone: row.phone,
          licensee: row.licensee,
          administrator: row.administrator,
          status: row.status,
          capacity: row.capacity ?? 0,
          firstLicenseDate: row.first_license_date,
          closedDate: row.closed_date,
          lastInspectionDate: row.last_inspection_date,
          totalVisits: row.total_visits ?? 0,
          inspectionVisits: 0,
          complaintVisits: 0,
          inspectTypeB: 0,
          otherTypeB: 0,
          complaintTypeB: 0,
          totalTypeB: row.total_type_b ?? 0,
          citations: row.citations ? String(row.citations) : "",
          lat: row.lat ?? 0,
          lng: row.lng ?? 0,
          geocodeQuality: row.geocode_quality,
        }
      : null;
    res.json({
      facility,
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
  // S-02: store SHA-256 hash of OTP, send raw OTP via email
  // S-03: rate-limited to 5 requests per 15 minutes per IP
  app.post("/api/jobseeker/register", authRateLimiter, async (req, res) => {
    const parsed = jobSeekerRegisterSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ message: parsed.error.errors[0].message });
    }
    const { email, password } = parsed.data;

    const existingByEmail = await storage.getJobSeekerAccountByEmail(email);
    if (existingByEmail) {
      // If already registered but not verified, update password (user may have changed it) and resend OTP
      if (!existingByEmail.emailVerified) {
        const hashed = await hashPassword(password);
        const otp = generateOTP();
        const expiry = Date.now() + 15 * 60 * 1000; // 15 minutes
        await storage.updateJobSeekerAccount(existingByEmail.id, {
          password: hashed,
          verificationToken: hashOtp(otp), // S-02: store hash, send raw
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
      verificationToken: hashOtp(otp), // S-02: store hash, send raw
      verificationExpiry: expiry,
      createdAt: Date.now(),
    });

    await sendVerificationEmail(email, otp);

    res.status(201).json({ emailSent: true, needsVerification: true, id: account.id });
  });

  // Verify OTP
  // S-02: constant-time hash comparison
  // S-03: rate-limited to 5 requests per 15 minutes per IP
  app.post("/api/jobseeker/verify-email", authRateLimiter, async (req, res) => {
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
    if (!account.verificationToken || !safeCompareOtp(account.verificationToken, otp)) {
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

    // S-04: regenerate session before setting jobSeekerId to prevent session fixation
    req.session.regenerate((regErr) => {
      if (regErr) {
        console.error("Session regeneration failed after OTP verification:", regErr);
        return res.status(500).json({ message: "Session creation failed. Please try logging in." });
      }
      req.session.jobSeekerId = account.id;
      req.session.save((err) => {
        if (err) {
          console.error("Session save failed after OTP verification:", err);
          return res.status(500).json({ message: "Session creation failed. Please try logging in." });
        }
        res.json({ ok: true, id: account.id, email: account.email });
      });
    });
  });

  // Resend OTP
  // S-02: store SHA-256 hash of OTP, send raw OTP via email
  // S-03: rate-limited to 5 requests per 15 minutes per IP
  app.post("/api/jobseeker/resend-otp", authRateLimiter, async (req, res) => {
    const { email } = req.body as { email?: string };
    if (!email) return res.status(400).json({ message: "Email is required" });

    const account = await storage.getJobSeekerAccountByEmail(email);
    if (!account) return res.status(404).json({ message: "Account not found" });
    if (account.emailVerified) return res.status(400).json({ message: "Email already verified" });

    const otp = generateOTP();
    const expiry = Date.now() + 15 * 60 * 1000;
    await storage.updateJobSeekerAccount(account.id, {
      verificationToken: hashOtp(otp), // S-02: store hash, send raw
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
