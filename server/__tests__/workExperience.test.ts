/**
 * /api/jobseeker/work-experience — endpoint integration tests.
 *
 * Verifies (against the real Postgres test DB):
 *   - GET requires job seeker auth (anonymous → 401)
 *     NOTE: CSRF middleware sits in front of mutating routes, so an anonymous
 *     POST/PUT/DELETE would land on 403 (CSRF), not 401. The 401 assertion
 *     therefore uses GET — same trick as credentials.test.ts.
 *   - happy-path POST → GET → PUT → DELETE round-trip
 *   - cross-seeker isolation (B cannot see / update / delete A's row)
 *   - workExperienceInputSchema validation: missing title / company / startDate
 *     → 400; invalid date formats → 400; endDate < startDate → 400 with the
 *     specific "End date must be after start date" message; length boundaries
 *     (title >120, description >2000); rejected employmentType enum value.
 *   - Optional-fields path: only title + company + startDate → 201, optional
 *     columns persist as nulls.
 *   - Ordering invariants (independent of insertion order):
 *     * end_date IS NULL (current role) sorts first.
 *     * Among ended roles, more-recent end_date comes first.
 *   - Path-param validation: non-integer :id on PUT/DELETE → 400 "Invalid id".
 *
 * The harness mirrors credentials.test.ts: a minimal Express app with the
 * production CSRF + session middleware, the production `workExperienceRouter`,
 * and a test-only `POST /__test/seeker-login` that stamps
 * `req.session.jobSeekerId` directly so we bypass the email-verified +
 * rate-limit gates on the real login route.
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

import { pool } from "../db/index";
import { bootstrapMainSchema } from "../db/bootstrap";
import { workExperienceRouter } from "../routes/workExperience";

const SEEKER_A_EMAIL = "test-wx-seeker-a@example.com";
const SEEKER_B_EMAIL = "test-wx-seeker-b@example.com";
const SEEKER_A_USERNAME = "test-wx-seeker-a";
const SEEKER_B_USERNAME = "test-wx-seeker-b";

let seekerAId: number;
let seekerBId: number;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: "work-experience-test-secret",
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

  // Same CSRF guard as production. Mutating routes without
  // `X-Requested-With: XMLHttpRequest` are rejected at 403 BEFORE the auth
  // gate runs. That is why the anonymous-401 assertion below uses GET.
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

  // Test-only fast login — stamps `req.session.jobSeekerId` directly.
  app.post("/__test/seeker-login", (req: Request, res: Response, next) => {
    const { jobSeekerId } = req.body as { jobSeekerId: number };
    req.session.regenerate((regErr) => {
      if (regErr) return next(regErr);
      req.session.jobSeekerId = jobSeekerId;
      req.session.save((saveErr) => {
        if (saveErr) return next(saveErr);
        res.json({ ok: true, jobSeekerId });
      });
    });
  });

  app.use("/api", workExperienceRouter);
  return app;
}

async function authedAgent(app: Express, jobSeekerId: number): Promise<request.Agent> {
  const agent = request.agent(app);
  const res = await agent
    .post("/__test/seeker-login")
    .set("X-Requested-With", "XMLHttpRequest")
    .send({ jobSeekerId });
  expect(res.status, `test login failed: ${res.text}`).toBe(200);
  return agent;
}

beforeAll(async () => {
  await bootstrapMainSchema();
  const upsert = async (username: string, email: string): Promise<number> => {
    const r = await pool.query<{ id: number }>(
      `INSERT INTO job_seeker_accounts (username, email, password, email_verified, created_at)
       VALUES ($1, $2, 'unused-hash', 1, $3)
       ON CONFLICT (email) DO UPDATE SET username = EXCLUDED.username
       RETURNING id`,
      [username, email, Date.now()],
    );
    return Number(r.rows[0].id);
  };
  seekerAId = await upsert(SEEKER_A_USERNAME, SEEKER_A_EMAIL);
  seekerBId = await upsert(SEEKER_B_USERNAME, SEEKER_B_EMAIL);
});

afterAll(async () => {
  await pool.query(
    `DELETE FROM job_seeker_work_experience WHERE account_id = ANY($1::int[])`,
    [[seekerAId, seekerBId]],
  );
  await pool.query(`DELETE FROM job_seeker_accounts WHERE id = ANY($1::int[])`, [
    [seekerAId, seekerBId],
  ]);
  await pool.end();
});

beforeEach(async () => {
  // Clean slate between tests so count / ordering / isolation assertions are
  // independent of prior runs.
  await pool.query(
    `DELETE FROM job_seeker_work_experience WHERE account_id = ANY($1::int[])`,
    [[seekerAId, seekerBId]],
  );
});

describe("/api/jobseeker/work-experience", () => {
  it("GET returns 401 when not authenticated", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/jobseeker/work-experience");
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Authentication required/i);
  });

  it("authed happy-path: POST then GET shows it; PUT updates description; DELETE removes", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);

    // POST with full body.
    const created = await agent
      .post("/api/jobseeker/work-experience")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        title: "Caregiver",
        company: "Sunrise Manor",
        facilityNumber: "197600001",
        location: "Pasadena, CA",
        employmentType: "Full-time",
        startDate: "2022-03",
        endDate: "2024-08",
        description: "Direct resident care.",
      });
    expect(created.status, created.text).toBe(201);
    expect(created.body.id).toBeTypeOf("number");
    expect(created.body.accountId).toBe(seekerAId);
    expect(created.body.title).toBe("Caregiver");
    expect(created.body.company).toBe("Sunrise Manor");
    expect(created.body.facilityNumber).toBe("197600001");
    expect(created.body.location).toBe("Pasadena, CA");
    expect(created.body.employmentType).toBe("Full-time");
    expect(created.body.startDate).toBe("2022-03");
    expect(created.body.endDate).toBe("2024-08");
    expect(created.body.description).toBe("Direct resident care.");
    const id = created.body.id as number;

    // GET — list contains it.
    const list = await agent.get("/api/jobseeker/work-experience");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(id);

    // PUT — update description (full payload, schema requires all required fields).
    const updated = await agent
      .put(`/api/jobseeker/work-experience/${id}`)
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        title: "Caregiver",
        company: "Sunrise Manor",
        facilityNumber: "197600001",
        location: "Pasadena, CA",
        employmentType: "Full-time",
        startDate: "2022-03",
        endDate: "2024-08",
        description: "Updated: lead caregiver for memory-care wing.",
      });
    expect(updated.status, updated.text).toBe(200);
    expect(updated.body.id).toBe(id);
    expect(updated.body.description).toBe(
      "Updated: lead caregiver for memory-care wing.",
    );

    // DELETE.
    const del = await agent
      .delete(`/api/jobseeker/work-experience/${id}`)
      .set("X-Requested-With", "XMLHttpRequest");
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });

    // GET — now empty.
    const after = await agent.get("/api/jobseeker/work-experience");
    expect(after.status).toBe(200);
    expect(after.body).toHaveLength(0);
  });

  it("cross-seeker isolation: B cannot see, update, or delete A's row", async () => {
    const app = buildApp();
    const agentA = await authedAgent(app, seekerAId);
    const agentB = await authedAgent(app, seekerBId);

    const createA = await agentA
      .post("/api/jobseeker/work-experience")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        title: "Med Tech",
        company: "Oak Grove ARF",
        startDate: "2023-01",
      });
    expect(createA.status, createA.text).toBe(201);
    const idA = createA.body.id as number;

    // B's GET must NOT include A's row.
    const listB = await agentB.get("/api/jobseeker/work-experience");
    expect(listB.status).toBe(200);
    expect(listB.body).toHaveLength(0);

    // B's PUT against A's id → 404 (scoped by account_id in the WHERE).
    const putB = await agentB
      .put(`/api/jobseeker/work-experience/${idA}`)
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        title: "Hijacked",
        company: "Hijack Inc",
        startDate: "2023-01",
      });
    expect(putB.status).toBe(404);

    // B's DELETE against A's id → 404.
    const delB = await agentB
      .delete(`/api/jobseeker/work-experience/${idA}`)
      .set("X-Requested-With", "XMLHttpRequest");
    expect(delB.status).toBe(404);

    // A's row is still intact and untouched.
    const listA = await agentA.get("/api/jobseeker/work-experience");
    expect(listA.status).toBe(200);
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].id).toBe(idA);
    expect(listA.body[0].title).toBe("Med Tech");
    expect(listA.body[0].company).toBe("Oak Grove ARF");
  });

  it("missing title → 400", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const res = await agent
      .post("/api/jobseeker/work-experience")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ company: "Sunrise Manor", startDate: "2022-03" });
    expect(res.status).toBe(400);
  });

  it("missing company → 400", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const res = await agent
      .post("/api/jobseeker/work-experience")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ title: "Caregiver", startDate: "2022-03" });
    expect(res.status).toBe(400);
  });

  it("missing startDate → 400", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const res = await agent
      .post("/api/jobseeker/work-experience")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ title: "Caregiver", company: "Sunrise Manor" });
    expect(res.status).toBe(400);
  });

  it("startDate with wrong separator '2024/01' → 400", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const res = await agent
      .post("/api/jobseeker/work-experience")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        title: "Caregiver",
        company: "Sunrise Manor",
        startDate: "2024/01",
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/YYYY-MM/i);
  });

  it("startDate with invalid month '2024-13' → 400", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const res = await agent
      .post("/api/jobseeker/work-experience")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        title: "Caregiver",
        company: "Sunrise Manor",
        startDate: "2024-13",
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/YYYY-MM/i);
  });

  it("endDate < startDate → 400 with specific message", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const res = await agent
      .post("/api/jobseeker/work-experience")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        title: "Caregiver",
        company: "Sunrise Manor",
        startDate: "2024-06",
        endDate: "2024-01",
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toBe("End date must be after start date");
  });

  it("title length > 120 → 400", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const tooLong = "a".repeat(121);
    const res = await agent
      .post("/api/jobseeker/work-experience")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        title: tooLong,
        company: "Sunrise Manor",
        startDate: "2022-03",
      });
    expect(res.status).toBe(400);
  });

  it("description length > 2000 → 400", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const tooLong = "x".repeat(2001);
    const res = await agent
      .post("/api/jobseeker/work-experience")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        title: "Caregiver",
        company: "Sunrise Manor",
        startDate: "2022-03",
        description: tooLong,
      });
    expect(res.status).toBe(400);
  });

  it("only required minimum fields → 201; optional fields return null", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const res = await agent
      .post("/api/jobseeker/work-experience")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        title: "Caregiver",
        company: "Sunrise Manor",
        startDate: "2022-03",
      });
    expect(res.status, res.text).toBe(201);
    expect(res.body.title).toBe("Caregiver");
    expect(res.body.company).toBe("Sunrise Manor");
    expect(res.body.startDate).toBe("2022-03");
    // Every optional column should round-trip as null when omitted.
    expect(res.body.facilityNumber).toBeNull();
    expect(res.body.location).toBeNull();
    expect(res.body.employmentType).toBeNull();
    expect(res.body.endDate).toBeNull();
    expect(res.body.description).toBeNull();
  });

  it("current role (endDate omitted) sorts first regardless of insertion order", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);

    // Insert the ENDED role FIRST. If the route were sorting by created_at,
    // this row would appear on top — the test would fail.
    const ended = await agent
      .post("/api/jobseeker/work-experience")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        title: "Med Tech",
        company: "Oak Grove ARF",
        startDate: "2020-01",
        endDate: "2022-01",
      });
    expect(ended.status, ended.text).toBe(201);
    const endedId = ended.body.id as number;

    // Insert the CURRENT role SECOND, with an OLDER startDate. The "end_date
    // IS NULL DESC" rule must still bubble it to the top.
    const current = await agent
      .post("/api/jobseeker/work-experience")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        title: "Caregiver",
        company: "Sunrise Manor",
        startDate: "2019-01",
        // endDate omitted → "Present"
      });
    expect(current.status, current.text).toBe(201);
    const currentId = current.body.id as number;

    const list = await agent.get("/api/jobseeker/work-experience");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(list.body[0].id).toBe(currentId);
    expect(list.body[0].endDate).toBeNull();
    expect(list.body[1].id).toBe(endedId);
  });

  it("among ended roles, more-recent end_date sorts first regardless of insertion order", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);

    // Insert the NEWER stint first (end_date 2022-01), then the OLDER stint
    // (end_date 2019-01). If the route ignored end_date and sorted by
    // created_at ASC or start_date alone, the older one would land on top.
    const newer = await agent
      .post("/api/jobseeker/work-experience")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        title: "Med Tech",
        company: "Oak Grove ARF",
        startDate: "2020-01",
        endDate: "2022-01",
      });
    expect(newer.status, newer.text).toBe(201);
    const newerId = newer.body.id as number;

    const older = await agent
      .post("/api/jobseeker/work-experience")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        title: "Aide",
        company: "Old Place",
        startDate: "2018-01",
        endDate: "2019-01",
      });
    expect(older.status, older.text).toBe(201);
    const olderId = older.body.id as number;

    const list = await agent.get("/api/jobseeker/work-experience");
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(2);
    expect(list.body[0].id).toBe(newerId);
    expect(list.body[0].endDate).toBe("2022-01");
    expect(list.body[1].id).toBe(olderId);
    expect(list.body[1].endDate).toBe("2019-01");
  });

  it("non-integer :id on PUT → 400 'Invalid id'", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const res = await agent
      .put("/api/jobseeker/work-experience/not-a-number")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        title: "Caregiver",
        company: "Sunrise Manor",
        startDate: "2022-03",
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid id/i);
  });

  it("non-integer :id on DELETE → 400 'Invalid id'", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const res = await agent
      .delete("/api/jobseeker/work-experience/not-a-number")
      .set("X-Requested-With", "XMLHttpRequest");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid id/i);
  });

  it("rejects employmentType not in the enum ('Intern') → 400", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const res = await agent
      .post("/api/jobseeker/work-experience")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        title: "Caregiver",
        company: "Sunrise Manor",
        startDate: "2022-03",
        employmentType: "Intern",
      });
    expect(res.status).toBe(400);
  });
});
