/**
 * Facility profile — endpoint + storage integration tests.
 *
 * Covers:
 *   - storage.prefillFacilityOverrideFromCcld: fills NULL columns from CCLD,
 *     does not overwrite admin-edited values, idempotent on second call.
 *   - PUT /api/facility/profile: partial update, strict zod rejects unknown
 *     keys, email + URL + taxIdLast4 validation.
 *   - POST /api/facility/profile/logo: 2 MB+1 rejected (413), non-image
 *     rejected, valid PNG stored under branding/ with sha8 prefix, row updated.
 *   - DELETE /api/facility/profile/logo: row cleared, file unlinked.
 *   - getFacilityLetterhead (reportQueries): override > CCLD > default fallback.
 *   - Tenant isolation: facility A's mutations only touch A's row.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import session from "express-session";
import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import request from "supertest";

import { pool } from "../db/index";
import { bootstrapMainSchema } from "../db/bootstrap";
import { bootstrapOpsSchema } from "../ops/opsStorage";
import { storage } from "../storage";
import { hashPassword, comparePassword } from "../auth";
import { facilityProfileRouter } from "../routes/facilityProfile";
import {
  FACILITY_LOGO_MAX_BYTES,
  defaultReportHeader,
} from "@shared/facility-profile";
import {
  FlyVolumeAdapter,
  setStorageAdapterForTests,
} from "../ops/evidenceStorage";
import { getFacilityReportHeader } from "../trackers/reports/reportQueries";
import type { FacilityAccount } from "@shared/schema";

const FACILITY_A = "TEST-FAC-PROFILE-A";
const FACILITY_B = "TEST-FAC-PROFILE-B";
const USERNAME_A = "test-fac-profile-a-user";
const PASSWORD_A = "test-pw-profile-a-12345!";
const EMAIL_A = "test-fac-profile-a@example.com";
const USERNAME_B = "test-fac-profile-b-user";
const PASSWORD_B = "test-pw-profile-b-12345!";
const EMAIL_B = "test-fac-profile-b@example.com";

// 1×1 transparent PNG — smallest valid bytes file-type can sniff. The route
// itself trusts the form-data declared mime, so the bytes only need to be
// non-empty for the happy path; size-cap tests use bigger buffers.
const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000156a14eaf0000000049454e44ae426082",
  "hex",
);

let testPassportRegistered = false;
let tempRoot: string;
let facilityAccountAId: number;
let facilityAccountBId: number;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: "facility-profile-test-secret",
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: false,
        httpOnly: true,
        sameSite: "lax",
        maxAge: 60 * 60 * 1000,
      },
    }),
  );

  if (!testPassportRegistered) {
    passport.use(
      "facility-profile-test-local",
      new LocalStrategy(async (username, password, done) => {
        try {
          const account = await storage.getFacilityAccountByUsername(username);
          if (!account) return done(null, false);
          const ok = await comparePassword(password, account.password);
          if (!ok) return done(null, false);
          return done(null, account);
        } catch (err) {
          return done(err as Error);
        }
      }),
    );
    passport.serializeUser((user, done) => {
      done(null, (user as FacilityAccount).id);
    });
    passport.deserializeUser(async (id: number, done) => {
      try {
        const account = await storage.getFacilityAccount(id);
        done(null, account ?? false);
      } catch (err) {
        done(err as Error);
      }
    });
    testPassportRegistered = true;
  }

  app.use(passport.initialize());
  app.use(passport.session());

  // Mirror the production CSRF guard so mutating calls require the XHR
  // header — keeps the test contract aligned with production behavior.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const m = req.method.toUpperCase();
    if (
      ["POST", "PUT", "DELETE", "PATCH"].includes(m) &&
      req.path.startsWith("/api/")
    ) {
      const xrw = req.headers["x-requested-with"];
      if (!xrw || (xrw as string).toLowerCase() !== "xmlhttprequest") {
        return res.status(403).json({ message: "CSRF validation failed." });
      }
    }
    next();
  });

  app.post("/api/facility/login", (req, res, next) => {
    passport.authenticate(
      "facility-profile-test-local",
      (err: Error | null, user: FacilityAccount | false) => {
        if (err) return next(err);
        if (!user) return res.status(401).json({ message: "Invalid credentials" });
        req.login(user, (loginErr) => {
          if (loginErr) return next(loginErr);
          return res.json({ id: user.id, facilityNumber: user.facilityNumber });
        });
      },
    )(req, res, next);
  });

  app.use("/api", facilityProfileRouter);
  return app;
}

async function loginAgent(
  app: Express,
  username: string,
  password: string,
): Promise<request.Agent> {
  const agent = request.agent(app);
  const res = await agent
    .post("/api/facility/login")
    .set("X-Requested-With", "XMLHttpRequest")
    .send({ username, password });
  expect(res.status, `login failed: ${res.text}`).toBe(200);
  return agent;
}

async function upsertFacility(number: string, opts: {
  phone?: string;
  address?: string;
  city?: string;
  zip?: string;
  administrator?: string;
  firstLicenseDate?: string;
}): Promise<void> {
  await pool.query(
    `INSERT INTO facilities
       (number, name, facility_type, facility_group, status, address, city, county,
        zip, phone, licensee, administrator, capacity, first_license_date,
        closed_date, last_inspection_date, total_visits, total_type_b, citations,
        lat, lng, geocode_quality, updated_at)
     VALUES ($1, $2, 'ARF', 'ELDERLY', 'LICENSED', $3, $4, 'Test',
             $5, $6, 'Test Licensee', $7, 60, $8,
             '', '', 0, 0, 0,
             34.0, -118.0, 'PRECISE', $9)
     ON CONFLICT (number) DO UPDATE SET
       phone = EXCLUDED.phone,
       address = EXCLUDED.address,
       city = EXCLUDED.city,
       zip = EXCLUDED.zip,
       administrator = EXCLUDED.administrator,
       first_license_date = EXCLUDED.first_license_date,
       updated_at = EXCLUDED.updated_at`,
    [
      number,
      `Test Facility ${number}`,
      opts.address ?? "",
      opts.city ?? "",
      opts.zip ?? "",
      opts.phone ?? "",
      opts.administrator ?? "",
      opts.firstLicenseDate ?? "",
      Date.now(),
    ],
  );
}

beforeAll(async () => {
  await bootstrapMainSchema();
  await bootstrapOpsSchema();

  tempRoot = await mkdtemp(join(tmpdir(), "arf-facility-profile-"));
  setStorageAdapterForTests(new FlyVolumeAdapter(tempRoot));

  // Two facilities + accounts. Facility A's CCLD row has rich data so the
  // prefill test has plenty of fields to populate; B has minimal data and
  // exists only to verify cross-tenant isolation.
  await upsertFacility(FACILITY_A, {
    phone: "(555) 111-2222",
    address: "100 Test St",
    city: "Sacramento",
    zip: "95814",
    administrator: "Jane Admin",
    firstLicenseDate: "1995-06-15",
  });
  await upsertFacility(FACILITY_B, {
    phone: "(555) 999-8888",
    address: "200 Other Way",
    city: "Oakland",
    zip: "94601",
    administrator: "Bob Admin",
    firstLicenseDate: "2010-01-01",
  });

  const hA = await hashPassword(PASSWORD_A);
  const hB = await hashPassword(PASSWORD_B);
  const rA = await pool.query<{ id: number }>(
    `INSERT INTO facility_accounts
       (facility_number, username, password, role, email, email_verified, created_at)
     VALUES ($1, $2, $3, 'facility_admin', $4, 1, $5)
     ON CONFLICT (facility_number) DO UPDATE SET
       username = EXCLUDED.username,
       password = EXCLUDED.password,
       email    = EXCLUDED.email,
       email_verified = 1
     RETURNING id`,
    [FACILITY_A, USERNAME_A, hA, EMAIL_A, Date.now()],
  );
  facilityAccountAId = Number(rA.rows[0].id);

  const rB = await pool.query<{ id: number }>(
    `INSERT INTO facility_accounts
       (facility_number, username, password, role, email, email_verified, created_at)
     VALUES ($1, $2, $3, 'facility_admin', $4, 1, $5)
     ON CONFLICT (facility_number) DO UPDATE SET
       username = EXCLUDED.username,
       password = EXCLUDED.password,
       email    = EXCLUDED.email,
       email_verified = 1
     RETURNING id`,
    [FACILITY_B, USERNAME_B, hB, EMAIL_B, Date.now()],
  );
  facilityAccountBId = Number(rB.rows[0].id);
});

afterAll(async () => {
  setStorageAdapterForTests(null);
  await pool.query(
    `DELETE FROM facility_overrides WHERE facility_number = ANY($1::text[])`,
    [[FACILITY_A, FACILITY_B]],
  );
  await pool.query(
    `DELETE FROM facility_accounts WHERE facility_number = ANY($1::text[])`,
    [[FACILITY_A, FACILITY_B]],
  );
  await pool.query(
    `DELETE FROM facilities WHERE number = ANY($1::text[])`,
    [[FACILITY_A, FACILITY_B]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail WHERE facility_number = ANY($1::text[])`,
    [[FACILITY_A, FACILITY_B]],
  );
  await rm(tempRoot, { recursive: true, force: true });
  await pool.end();
});

beforeEach(async () => {
  // Reset overrides between tests so each starts with a NULL row.
  await pool.query(
    `DELETE FROM facility_overrides WHERE facility_number = ANY($1::text[])`,
    [[FACILITY_A, FACILITY_B]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail WHERE facility_number = ANY($1::text[])`,
    [[FACILITY_A, FACILITY_B]],
  );
});

// ─────────────────────────────────────────────────────────────────────────────
// Storage: prefillFacilityOverrideFromCcld
// ─────────────────────────────────────────────────────────────────────────────

describe("storage.prefillFacilityOverrideFromCcld", () => {
  it("fills NULL columns from CCLD on first call", async () => {
    const { override, prefilled } = await storage.prefillFacilityOverrideFromCcld(
      FACILITY_A,
      "test_actor",
    );
    expect(prefilled).toEqual(
      expect.arrayContaining([
        "phone",
        "mailingAddressLine1",
        "mailingCity",
        "mailingZip",
        "administratorName",
        "yearEstablished",
      ]),
    );
    expect(override.phone).toBe("(555) 111-2222");
    expect(override.mailingAddressLine1).toBe("100 Test St");
    expect(override.mailingCity).toBe("Sacramento");
    expect(override.mailingZip).toBe("95814");
    expect(override.administratorName).toBe("Jane Admin");
    expect(override.yearEstablished).toBe(1995);
    expect(override.prefilledFromCcldAt).toBeTypeOf("number");
  });

  it("does not overwrite admin-edited values", async () => {
    // Admin has already set a phone number; CCLD has a different one.
    await storage.upsertFacilityOverride(FACILITY_A, {
      phone: "(555) AAA-BBBB",
    });
    const { override, prefilled } = await storage.prefillFacilityOverrideFromCcld(
      FACILITY_A,
      "test_actor",
    );
    expect(override.phone).toBe("(555) AAA-BBBB");
    expect(prefilled).not.toContain("phone");
    // But other NULL columns still got filled.
    expect(prefilled).toContain("mailingAddressLine1");
    expect(override.mailingAddressLine1).toBe("100 Test St");
  });

  it("is idempotent — second call writes nothing", async () => {
    await storage.prefillFacilityOverrideFromCcld(FACILITY_A, "test_actor");
    const first = await storage.getFacilityOverride(FACILITY_A);
    const second = await storage.prefillFacilityOverrideFromCcld(
      FACILITY_A,
      "test_actor",
    );
    expect(second.prefilled).toEqual([]);
    expect(second.override.prefilledFromCcldAt).toBe(first?.prefilledFromCcldAt);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/facility/profile
// ─────────────────────────────────────────────────────────────────────────────

describe("PUT /api/facility/profile", () => {
  it("rejects anonymous callers", async () => {
    const app = buildApp();
    const res = await request(app)
      .put("/api/facility/profile")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ phone: "555-1234" });
    expect(res.status).toBe(401);
  });

  it("partial-updates the override row", async () => {
    const app = buildApp();
    const agent = await loginAgent(app, USERNAME_A, PASSWORD_A);
    const res = await agent
      .put("/api/facility/profile")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        dbaName: "ARF of Sacramento",
        languagesSpoken: ["en", "es"],
        careTypesOffered: ["assisted_living"],
        yearEstablished: 2005,
        accreditations: ["CARF", "Joint Commission"],
      });
    expect(res.status, res.text).toBe(200);
    expect(res.body.dbaName).toBe("ARF of Sacramento");
    expect(res.body.yearEstablished).toBe(2005);
    expect(JSON.parse(res.body.languagesSpokenJson)).toEqual(["en", "es"]);
    expect(JSON.parse(res.body.careTypesOfferedJson)).toEqual(["assisted_living"]);
    expect(JSON.parse(res.body.accreditationsJson)).toEqual([
      "CARF",
      "Joint Commission",
    ]);
  });

  it("strict zod rejects unknown fields", async () => {
    const app = buildApp();
    const agent = await loginAgent(app, USERNAME_A, PASSWORD_A);
    const res = await agent
      .put("/api/facility/profile")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ phone: "555-1234", bogusField: "x" });
    expect(res.status).toBe(400);
  });

  it("rejects malformed email and URL", async () => {
    const app = buildApp();
    const agent = await loginAgent(app, USERNAME_A, PASSWORD_A);
    const r1 = await agent
      .put("/api/facility/profile")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ administratorEmail: "not-an-email" });
    expect(r1.status).toBe(400);
    const r2 = await agent
      .put("/api/facility/profile")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ facebookUrl: "not-a-url" });
    expect(r2.status).toBe(400);
  });

  it("enforces taxIdLast4 regex (exactly 4 digits)", async () => {
    const app = buildApp();
    const agent = await loginAgent(app, USERNAME_A, PASSWORD_A);
    const tooShort = await agent
      .put("/api/facility/profile")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ taxIdLast4: "123" });
    expect(tooShort.status).toBe(400);
    const fullEin = await agent
      .put("/api/facility/profile")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ taxIdLast4: "123456789" });
    expect(fullEin.status).toBe(400);
    const ok = await agent
      .put("/api/facility/profile")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ taxIdLast4: "1234" });
    expect(ok.status).toBe(200);
    expect(ok.body.taxIdLast4).toBe("1234");
  });

  it("tenant isolation — facility A cannot update B's row", async () => {
    const app = buildApp();
    const agentA = await loginAgent(app, USERNAME_A, PASSWORD_A);
    await agentA
      .put("/api/facility/profile")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ dbaName: "A's brand" });
    const rowA = await storage.getFacilityOverride(FACILITY_A);
    const rowB = await storage.getFacilityOverride(FACILITY_B);
    expect(rowA?.dbaName).toBe("A's brand");
    expect(rowB).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST/DELETE /api/facility/profile/logo
// ─────────────────────────────────────────────────────────────────────────────

describe("POST /api/facility/profile/logo", () => {
  it("rejects payloads above 2 MB", async () => {
    const app = buildApp();
    const agent = await loginAgent(app, USERNAME_A, PASSWORD_A);
    const oversize = Buffer.alloc(FACILITY_LOGO_MAX_BYTES + 1, 0);
    const res = await agent
      .post("/api/facility/profile/logo")
      .set("X-Requested-With", "XMLHttpRequest")
      .attach("file", oversize, { filename: "big.png", contentType: "image/png" });
    expect(res.status).toBe(413);
  });

  it("rejects non-image mimes", async () => {
    const app = buildApp();
    const agent = await loginAgent(app, USERNAME_A, PASSWORD_A);
    const res = await agent
      .post("/api/facility/profile/logo")
      .set("X-Requested-With", "XMLHttpRequest")
      .attach("file", Buffer.from("hello"), {
        filename: "note.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(400);
  });

  it("stores PNG under branding/ subdir with sha8 prefix and updates the row", async () => {
    const app = buildApp();
    const agent = await loginAgent(app, USERNAME_A, PASSWORD_A);
    const res = await agent
      .post("/api/facility/profile/logo")
      .set("X-Requested-With", "XMLHttpRequest")
      .attach("file", TINY_PNG, {
        filename: "logo.png",
        contentType: "image/png",
      });
    expect(res.status, res.text).toBe(201);
    expect(res.body.logoStorageUri).toMatch(/^local:\/\/\//);
    // Path layout: <facility>/branding/<entityType>/<id>/<sha8>-logo.<ext>
    expect(res.body.logoStorageUri).toContain(`/${FACILITY_A}/branding/`);
    expect(res.body.logoMimeType).toBe("image/png");
    // File actually exists on disk.
    const relative = String(res.body.logoStorageUri).slice("local:///".length);
    const abs = join(tempRoot, relative);
    const fileInfo = await stat(abs);
    expect(fileInfo.size).toBe(TINY_PNG.byteLength);
  });
});

describe("DELETE /api/facility/profile/logo", () => {
  it("clears the row and unlinks the file", async () => {
    const app = buildApp();
    const agent = await loginAgent(app, USERNAME_A, PASSWORD_A);
    // Upload first.
    const up = await agent
      .post("/api/facility/profile/logo")
      .set("X-Requested-With", "XMLHttpRequest")
      .attach("file", TINY_PNG, {
        filename: "logo.png",
        contentType: "image/png",
      });
    expect(up.status).toBe(201);
    const uri = up.body.logoStorageUri as string;
    const relative = uri.slice("local:///".length);
    const abs = join(tempRoot, relative);
    await stat(abs); // sanity: file is there

    const del = await agent
      .delete("/api/facility/profile/logo")
      .set("X-Requested-With", "XMLHttpRequest");
    expect(del.status).toBe(200);
    expect(del.body.logoStorageUri).toBeNull();
    expect(del.body.logoMimeType).toBeNull();

    // File should be gone.
    let stillThere = true;
    try {
      await stat(abs);
    } catch {
      stillThere = false;
    }
    expect(stillThere).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/facility/profile/logo (public)
// ─────────────────────────────────────────────────────────────────────────────

describe("GET /api/facility/profile/logo", () => {
  it("returns 404 when no logo set", async () => {
    const app = buildApp();
    const res = await request(app).get(
      `/api/facility/profile/logo?n=${encodeURIComponent(FACILITY_A)}`,
    );
    expect(res.status).toBe(404);
  });

  it("streams bytes with public cache header when set", async () => {
    const app = buildApp();
    const agent = await loginAgent(app, USERNAME_A, PASSWORD_A);
    await agent
      .post("/api/facility/profile/logo")
      .set("X-Requested-With", "XMLHttpRequest")
      .attach("file", TINY_PNG, {
        filename: "logo.png",
        contentType: "image/png",
      });
    // Anonymous read.
    const res = await request(app)
      .get(`/api/facility/profile/logo?n=${encodeURIComponent(FACILITY_A)}`)
      .responseType("blob");
    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toBe("image/png");
    expect(res.headers["cache-control"]).toMatch(/public/);
    expect(res.headers["cache-control"]).toMatch(/max-age=300/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Letterhead — getFacilityReportHeader
// ─────────────────────────────────────────────────────────────────────────────

describe("getFacilityReportHeader (letterhead)", () => {
  it("uses override values when set", async () => {
    await storage.upsertFacilityOverride(FACILITY_A, {
      dbaName: "Custom DBA",
      mailingAddressLine1: "999 Override Way",
      mailingCity: "Overrideville",
      mailingZip: "00000",
      phone: "(111) 222-3333",
      administratorName: "Override Admin",
      reportHeaderText: "Custom header",
      reportFooterText: "Confidential — internal use only",
    });
    const lh = await getFacilityReportHeader(FACILITY_A);
    expect(lh).not.toBeNull();
    expect(lh!.name).toBe("Custom DBA");
    expect(lh!.address).toBe("999 Override Way");
    expect(lh!.city).toBe("Overrideville");
    expect(lh!.zip).toBe("00000");
    expect(lh!.phone).toBe("(111) 222-3333");
    expect(lh!.administrator).toBe("Override Admin");
    expect(lh!.headerText).toBe("Custom header");
    expect(lh!.footerText).toBe("Confidential — internal use only");
  });

  it("falls back to CCLD when override is null", async () => {
    // No override row at all.
    const lh = await getFacilityReportHeader(FACILITY_A);
    expect(lh).not.toBeNull();
    expect(lh!.name).toBe(`Test Facility ${FACILITY_A}`);
    expect(lh!.address).toBe("100 Test St");
    expect(lh!.city).toBe("Sacramento");
    expect(lh!.phone).toBe("(555) 111-2222");
    expect(lh!.administrator).toBe("Jane Admin");
    // headerText falls back to defaultReportHeader.
    expect(lh!.headerText).toBe(
      defaultReportHeader(`Test Facility ${FACILITY_A}`, FACILITY_A, "Sacramento"),
    );
    expect(lh!.footerText).toBeNull();
  });
});
