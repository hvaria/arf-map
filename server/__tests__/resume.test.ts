/**
 * Resume export — mapper unit tests + endpoint integration tests.
 *
 * Part 1 (always runs, no DB): `buildResumeViewModel` / `resumeFileName` —
 * the canonical profile→resume mapper. Covers name assembly, location join,
 * incomplete detection, missing-field nudges, credential label resolution,
 * work-experience date-range formatting, and filename slugging.
 *
 * Part 2 (requires DATABASE_URL): `GET /api/jobseeker/resume.pdf` against the
 * real Postgres test DB — anonymous 401, 422 when the profile has no name,
 * and a 200 that streams a real PDF with a name-derived filename. Harness
 * mirrors workExperience.test.ts (minimal app + production router +
 * test-only fast login).
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import session from "express-session";
import request from "supertest";

import { PassThrough } from "node:stream";
import path from "node:path";

import { buildResumeViewModel, resumeFileName } from "@shared/resume";
import { renderResumePdf } from "../resume/resumeRenderer";
import {
  resolveCredentialLogo,
  CREDENTIAL_LOGO_PATH,
} from "../resume/credentialLogos";
import type {
  JobSeekerProfile,
  JobSeekerCredential,
  JobSeekerWorkExperience,
} from "@shared/schema";

/** Collect a rendered PDF into a single Buffer for magic-byte assertions. */
function renderToBuffer(vm: ReturnType<typeof buildResumeViewModel>): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    const sink = new PassThrough();
    sink.on("data", (c) => chunks.push(Buffer.from(c)));
    sink.on("end", () => resolve(Buffer.concat(chunks)));
    sink.on("error", reject);
    renderResumePdf(sink, vm);
  });
}

// 1×1 transparent PNG — a real, decodable image so the photo-embed path runs.
const TINY_PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

// ─── Part 1: pure mapper unit tests (no DB) ─────────────────────────────────────

function makeProfile(overrides: Partial<JobSeekerProfile> = {}): JobSeekerProfile {
  return {
    id: 1,
    accountId: 1,
    firstName: "Jane",
    lastName: "Smith",
    phone: "(530) 555-0100",
    address: "123 Main St",
    city: "Sacramento",
    state: "CA",
    zipCode: "95814",
    profilePictureUrl: null,
    yearsExperience: 5,
    jobTypes: ["Caregiver", "Med Tech"],
    bio: "Compassionate caregiver.",
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeCredential(overrides: Partial<JobSeekerCredential> = {}): JobSeekerCredential {
  return {
    id: 1,
    accountId: 1,
    kind: "CNA",
    label: null,
    licenseNumber: "C-12345",
    issuingAuthority: "CA DPH",
    issuedAt: "2023-01-15",
    expiresAt: "2026-01-15",
    notes: null,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

function makeWork(overrides: Partial<JobSeekerWorkExperience> = {}): JobSeekerWorkExperience {
  return {
    id: 1,
    accountId: 1,
    title: "Caregiver",
    company: "Sunrise Manor",
    facilityNumber: null,
    location: "Pasadena, CA",
    employmentType: "Full-time",
    startDate: "2022-03",
    endDate: "2024-08",
    description: "Direct resident care.",
    createdAt: Date.now(),
    updatedAt: Date.now(),
    ...overrides,
  };
}

describe("buildResumeViewModel", () => {
  it("assembles a complete view model from full data", () => {
    const vm = buildResumeViewModel({
      profile: makeProfile(),
      email: "jane@example.com",
      credentials: [makeCredential()],
      workExperience: [makeWork()],
    });

    expect(vm.contact.fullName).toBe("Jane Smith");
    expect(vm.contact.email).toBe("jane@example.com");
    expect(vm.contact.location).toBe("Sacramento, CA 95814");
    expect(vm.contact.street).toBe("123 Main St");
    expect(vm.isMinimallyComplete).toBe(true);
    expect(vm.missingFields).toHaveLength(0);
    expect(vm.headline).toContain("Caregiver");
    expect(vm.headline).toContain("5+ years experience");
  });

  it("uses ATS spelled-out labels and standardizes credential dates to 'Mon YYYY'", () => {
    const vm = buildResumeViewModel({
      profile: makeProfile(),
      email: "j@e.com",
      credentials: [makeCredential({ kind: "CNA" })],
      workExperience: [],
    });
    // Acronym spelled out for ATS keyword matching.
    expect(vm.credentials[0].label).toBe("Certified Nursing Assistant (CNA)");
    expect(vm.credentials[0].detail).toContain("CA DPH");
    expect(vm.credentials[0].detail).toContain("License #C-12345");
    // ISO "2023-01-15" / "2026-01-15" → "Mon YYYY".
    expect(vm.credentials[0].detail).toContain("Issued Jan 2023");
    expect(vm.credentials[0].detail).toContain("Expires Jan 2026");
    // No raw ISO dates leak through.
    expect(vm.credentials[0].detail).not.toContain("2026-01-15");
  });

  it("uses the free-text label for OTHER credentials", () => {
    const vm = buildResumeViewModel({
      profile: makeProfile(),
      email: "j@e.com",
      credentials: [makeCredential({ kind: "OTHER", label: "Forklift Cert" })],
      workExperience: [],
    });
    expect(vm.credentials[0].label).toBe("Forklift Cert");
  });

  it("categorizes credentials for badge colouring (license/clearance/training/other)", () => {
    const vm = buildResumeViewModel({
      profile: makeProfile(),
      email: "j@e.com",
      credentials: [
        makeCredential({ id: 1, kind: "CNA" }),
        makeCredential({ id: 2, kind: "TB" }),
        makeCredential({ id: 3, kind: "CPR" }),
        makeCredential({ id: 4, kind: "OTHER", label: "Forklift" }),
      ],
      workExperience: [],
    });
    expect(vm.credentials.map((c) => c.category)).toEqual([
      "license",
      "clearance",
      "training",
      "other",
    ]);
    expect(vm.credentials[0].kind).toBe("CNA");
  });

  it("passes a profile photo data URL through and drops non-image URLs", () => {
    const dataUrl = "data:image/jpeg;base64,/9j/AAAA";
    expect(
      buildResumeViewModel({
        profile: makeProfile({ profilePictureUrl: dataUrl }),
        email: "j@e.com",
        credentials: [],
        workExperience: [],
      }).contact.photoDataUrl,
    ).toBe(dataUrl);
    expect(
      buildResumeViewModel({
        profile: makeProfile({ profilePictureUrl: "https://example.com/p.jpg" }),
        email: "j@e.com",
        credentials: [],
        workExperience: [],
      }).contact.photoDataUrl,
    ).toBeUndefined();
  });

  it("formats YYYY-MM work dates into 'Mon YYYY – Present'", () => {
    const vm = buildResumeViewModel({
      profile: makeProfile(),
      email: "j@e.com",
      credentials: [],
      workExperience: [makeWork({ startDate: "2022-03", endDate: null })],
    });
    expect(vm.workExperience[0].dateRange).toBe("Mar 2022 – Present");
  });

  it("flags incomplete when the name is empty and lists missing fields", () => {
    const vm = buildResumeViewModel({
      profile: makeProfile({
        firstName: null,
        lastName: null,
        phone: null,
        city: null,
        state: null,
        zipCode: null,
        bio: null,
        jobTypes: [],
      }),
      email: "j@e.com",
      credentials: [],
      workExperience: [],
    });
    expect(vm.isMinimallyComplete).toBe(false);
    expect(vm.missingFields).toEqual(
      expect.arrayContaining([
        "Phone number",
        "City / State",
        "Professional summary",
        "Target roles",
        "Work experience",
        "Credentials",
      ]),
    );
  });

  it("treats a null profile as a blank, incomplete resume (no throw)", () => {
    const vm = buildResumeViewModel({
      profile: null,
      email: "j@e.com",
      credentials: [],
      workExperience: [],
    });
    expect(vm.isMinimallyComplete).toBe(false);
    expect(vm.contact.email).toBe("j@e.com");
    expect(vm.contact.fullName).toBe("");
  });
});

describe("renderResumePdf", () => {
  it("renders a valid PDF embedding the profile photo + credential badges", async () => {
    const vm = buildResumeViewModel({
      profile: makeProfile({ profilePictureUrl: TINY_PNG }),
      email: "jane@example.com",
      credentials: [makeCredential({ kind: "CNA" }), makeCredential({ id: 2, kind: "CPR" })],
      workExperience: [makeWork()],
    });
    const pdf = await renderToBuffer(vm);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    expect(pdf.length).toBeGreaterThan(1000);
  });

  it("renders cleanly with no photo and no credentials (best-effort)", async () => {
    const vm = buildResumeViewModel({
      profile: makeProfile({ profilePictureUrl: null }),
      email: "jane@example.com",
      credentials: [],
      workExperience: [],
    });
    const pdf = await renderToBuffer(vm);
    expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});

describe("credential logo resolution", () => {
  it("returns null when no licensed logo asset is present (badge fallback)", () => {
    expect(resolveCredentialLogo("CNA")).toBeNull();
  });

  it("uses an explicitly mapped logo and embeds it in the PDF", async () => {
    // Stand-in for a licensed asset: the app's own brand PNG (we own it).
    const logo = path.join(process.cwd(), "client", "public", "icons", "icon-512.png");
    CREDENTIAL_LOGO_PATH.CPR = logo;
    try {
      expect(resolveCredentialLogo("CPR")).toBe(logo);
      const vm = buildResumeViewModel({
        profile: makeProfile(),
        email: "j@e.com",
        credentials: [makeCredential({ kind: "CPR" })],
        workExperience: [],
      });
      const pdf = await renderToBuffer(vm);
      expect(pdf.subarray(0, 4).toString("latin1")).toBe("%PDF");
    } finally {
      delete CREDENTIAL_LOGO_PATH.CPR;
    }
  });
});

describe("resumeFileName", () => {
  it("slugs the full name", () => {
    const vm = buildResumeViewModel({
      profile: makeProfile({ firstName: "Jane", lastName: "O'Brien" }),
      email: "j@e.com",
      credentials: [],
      workExperience: [],
    });
    expect(resumeFileName(vm)).toBe("jane-o-brien-resume.pdf");
  });

  it("falls back to resume.pdf when there is no name", () => {
    const vm = buildResumeViewModel({
      profile: makeProfile({ firstName: null, lastName: null }),
      email: "j@e.com",
      credentials: [],
      workExperience: [],
    });
    expect(resumeFileName(vm)).toBe("resume.pdf");
  });
});

// ─── Part 2: endpoint integration tests (require DATABASE_URL) ──────────────────

const hasDb = !!process.env.DATABASE_URL;
const SEEKER_NAMED_EMAIL = "test-resume-named@example.com";
const SEEKER_BLANK_EMAIL = "test-resume-blank@example.com";

describe.skipIf(!hasDb)("/api/jobseeker/resume.pdf", () => {
  // Lazy imports so the pure tests above don't pull in the DB pool when
  // DATABASE_URL is absent.
  let pool: typeof import("../db/index").pool;
  let resumeRouter: typeof import("../routes/resume").resumeRouter;
  let bootstrapMainSchema: typeof import("../db/bootstrap").bootstrapMainSchema;

  let namedId: number;
  let blankId: number;

  function buildApp(): Express {
    const app = express();
    app.use(express.json());
    app.use(
      session({
        secret: "resume-test-secret",
        resave: false,
        saveUninitialized: false,
        cookie: { secure: false, httpOnly: true, sameSite: "lax", maxAge: 3600_000 },
      }),
    );
    app.post("/__test/seeker-login", (req: Request, res: Response, next: NextFunction) => {
      const { jobSeekerId } = req.body as { jobSeekerId: number };
      req.session.regenerate((regErr) => {
        if (regErr) return next(regErr);
        req.session.jobSeekerId = jobSeekerId;
        req.session.save((saveErr) => (saveErr ? next(saveErr) : res.json({ ok: true })));
      });
    });
    app.use("/api", resumeRouter);
    return app;
  }

  async function authedAgent(app: Express, jobSeekerId: number): Promise<request.Agent> {
    const agent = request.agent(app);
    const res = await agent
      .post("/__test/seeker-login")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ jobSeekerId });
    expect(res.status, res.text).toBe(200);
    return agent;
  }

  beforeAll(async () => {
    ({ pool } = await import("../db/index"));
    ({ resumeRouter } = await import("../routes/resume"));
    ({ bootstrapMainSchema } = await import("../db/bootstrap"));
    await bootstrapMainSchema();

    const upsert = async (email: string): Promise<number> => {
      const r = await pool.query<{ id: number }>(
        `INSERT INTO job_seeker_accounts (username, email, password, email_verified, created_at)
         VALUES ($1, $1, 'unused-hash', 1, $2)
         ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
         RETURNING id`,
        [email, Date.now()],
      );
      return Number(r.rows[0].id);
    };
    namedId = await upsert(SEEKER_NAMED_EMAIL);
    blankId = await upsert(SEEKER_BLANK_EMAIL);

    // Named seeker has a full profile + a credential + a work entry.
    await pool.query(
      `INSERT INTO job_seeker_profiles (account_id, first_name, last_name, city, state, zip_code, phone, bio, years_experience, job_types, updated_at)
       VALUES ($1,'Maria','Lopez','Fresno','CA','93701','(559) 555-0199','Experienced DSP.',7,$2::jsonb,$3)
       ON CONFLICT (account_id) DO UPDATE SET first_name='Maria', last_name='Lopez'`,
      [namedId, JSON.stringify(["Caregiver"]), Date.now()],
    );
  });

  afterAll(async () => {
    const ids = [namedId, blankId];
    await pool.query(`DELETE FROM job_seeker_profiles WHERE account_id = ANY($1::int[])`, [ids]);
    await pool.query(`DELETE FROM job_seeker_accounts WHERE id = ANY($1::int[])`, [ids]);
    await pool.end();
  });

  beforeEach(async () => {
    // Ensure the blank seeker has no profile row (no name).
    await pool.query(`DELETE FROM job_seeker_profiles WHERE account_id = $1`, [blankId]);
  });

  it("returns 401 when not authenticated", async () => {
    const res = await request(buildApp()).get("/api/jobseeker/resume.pdf");
    expect(res.status).toBe(401);
  });

  it("returns 422 RESUME_INCOMPLETE when the profile has no name", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, blankId);
    const res = await agent.get("/api/jobseeker/resume.pdf");
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("RESUME_INCOMPLETE");
  });

  it("streams a named PDF for a complete profile", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, namedId);
    const res = await agent.get("/api/jobseeker/resume.pdf").buffer(true);
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toContain("application/pdf");
    expect(res.headers["content-disposition"]).toContain("maria-lopez-resume.pdf");
    // PDF magic bytes.
    const body = res.body as Buffer;
    expect(body.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });
});
