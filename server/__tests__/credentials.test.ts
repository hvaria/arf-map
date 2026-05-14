/**
 * /api/jobseeker/credentials — endpoint integration tests.
 *
 * Verifies (against the real Postgres test DB):
 *   - GET requires job seeker auth (anonymous → 401)
 *   - happy-path POST → GET → PUT → DELETE round-trip
 *   - cross-seeker isolation (seeker B cannot see, update, or delete A's rows)
 *   - credentialInputSchema validation: OTHER without label → 400, with label → 201,
 *     invalid date → 400
 *   - partial-unique index `uniq_credentials_account_kind_license`:
 *       * duplicate (kind, license_number) for the same seeker → 409
 *       * NULL license_number rows for the same kind are allowed (both 201)
 *   - listing order is `created_at DESC`
 *   - non-integer :id path param → 400
 *
 * The harness mirrors the billing tests: it builds a minimal Express app with
 * the production CSRF + session middleware, mounts the production
 * `credentialsRouter`, and exposes a test-only `POST /__test/seeker-login` that
 * stamps `req.session.jobSeekerId` directly so we don't have to drive the
 * (email-verified) login form.
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
import { credentialsRouter } from "../routes/credentials";

const SEEKER_A_EMAIL = "test-cred-seeker-a@example.com";
const SEEKER_B_EMAIL = "test-cred-seeker-b@example.com";
const SEEKER_A_USERNAME = "test-cred-seeker-a";
const SEEKER_B_USERNAME = "test-cred-seeker-b";

let seekerAId: number;
let seekerBId: number;

function buildApp(): Express {
  const app = express();
  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));
  app.use(
    session({
      secret: "credentials-test-secret",
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

  // Same CSRF guard as production. The credentials router is mutating, so
  // POST/PUT/DELETE without `X-Requested-With: XMLHttpRequest` is rejected
  // here at 403 — before the auth gate ever sees the request.
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

  // Test-only fast login. Job seeker auth is plain session-based
  // (`req.session.jobSeekerId`), so we can establish it directly without
  // going through the real /api/jobseeker/login route (which would force us
  // to bypass the email-verified + rate-limit gates with extra fixtures).
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

  app.use("/api", credentialsRouter);
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
  // Two distinct seeker accounts for the cross-seeker isolation tests.
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
    `DELETE FROM job_seeker_credentials WHERE account_id = ANY($1::int[])`,
    [[seekerAId, seekerBId]],
  );
  await pool.query(`DELETE FROM job_seeker_accounts WHERE id = ANY($1::int[])`, [
    [seekerAId, seekerBId],
  ]);
  await pool.end();
});

beforeEach(async () => {
  // Clean slate between tests so ordering / duplicate / count assertions are
  // independent.
  await pool.query(
    `DELETE FROM job_seeker_credentials WHERE account_id = ANY($1::int[])`,
    [[seekerAId, seekerBId]],
  );
});

describe("/api/jobseeker/credentials", () => {
  it("GET returns 401 when not authenticated", async () => {
    const app = buildApp();
    const res = await request(app).get("/api/jobseeker/credentials");
    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/Authentication required/i);
  });

  it("authed happy-path: POST then GET shows it; PUT updates; DELETE removes", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);

    // POST
    const created = await agent
      .post("/api/jobseeker/credentials")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        kind: "CNA",
        licenseNumber: "CNA-001",
        issuingAuthority: "CDPH",
        issuedAt: "2024-01-01",
        expiresAt: "2026-01-01",
      });
    expect(created.status, created.text).toBe(201);
    expect(created.body.id).toBeTypeOf("number");
    expect(created.body.accountId).toBe(seekerAId);
    expect(created.body.kind).toBe("CNA");
    expect(created.body.licenseNumber).toBe("CNA-001");
    const id = created.body.id as number;

    // GET — list contains it
    const list = await agent.get("/api/jobseeker/credentials");
    expect(list.status).toBe(200);
    expect(Array.isArray(list.body)).toBe(true);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(id);

    // PUT — update notes + expiry
    const updated = await agent
      .put(`/api/jobseeker/credentials/${id}`)
      .set("X-Requested-With", "XMLHttpRequest")
      .send({
        kind: "CNA",
        licenseNumber: "CNA-001",
        issuingAuthority: "CDPH",
        issuedAt: "2024-01-01",
        expiresAt: "2027-06-30",
        notes: "Renewed.",
      });
    expect(updated.status, updated.text).toBe(200);
    expect(updated.body.expiresAt).toBe("2027-06-30");
    expect(updated.body.notes).toBe("Renewed.");

    // DELETE
    const del = await agent
      .delete(`/api/jobseeker/credentials/${id}`)
      .set("X-Requested-With", "XMLHttpRequest");
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true });

    // GET — now empty
    const after = await agent.get("/api/jobseeker/credentials");
    expect(after.status).toBe(200);
    expect(after.body).toHaveLength(0);
  });

  it("cross-seeker isolation: B cannot see, update, or delete A's credential", async () => {
    const app = buildApp();
    const agentA = await authedAgent(app, seekerAId);
    const agentB = await authedAgent(app, seekerBId);

    const createA = await agentA
      .post("/api/jobseeker/credentials")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ kind: "RN", licenseNumber: "RN-A-001" });
    expect(createA.status).toBe(201);
    const idA = createA.body.id as number;

    // B's GET must NOT include A's row.
    const listB = await agentB.get("/api/jobseeker/credentials");
    expect(listB.status).toBe(200);
    expect(listB.body).toHaveLength(0);

    // B's PUT against A's id → 404.
    const putB = await agentB
      .put(`/api/jobseeker/credentials/${idA}`)
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ kind: "RN", licenseNumber: "RN-A-001", notes: "hijack" });
    expect(putB.status).toBe(404);

    // B's DELETE against A's id → 404.
    const delB = await agentB
      .delete(`/api/jobseeker/credentials/${idA}`)
      .set("X-Requested-With", "XMLHttpRequest");
    expect(delB.status).toBe(404);

    // A's row is still intact.
    const listA = await agentA.get("/api/jobseeker/credentials");
    expect(listA.status).toBe(200);
    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].id).toBe(idA);
    expect(listA.body[0].notes).toBeNull();
  });

  it("OTHER without label → 400", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const res = await agent
      .post("/api/jobseeker/credentials")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ kind: "OTHER" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/label is required when kind = "OTHER"/i);
  });

  it("OTHER with label → 201", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const res = await agent
      .post("/api/jobseeker/credentials")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ kind: "OTHER", label: "Phlebotomy cert" });
    expect(res.status, res.text).toBe(201);
    expect(res.body.kind).toBe("OTHER");
    expect(res.body.label).toBe("Phlebotomy cert");
  });

  it("duplicate (kind=CNA, same licenseNumber) → 409", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const first = await agent
      .post("/api/jobseeker/credentials")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ kind: "CNA", licenseNumber: "DUP-001" });
    expect(first.status).toBe(201);

    const dup = await agent
      .post("/api/jobseeker/credentials")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ kind: "CNA", licenseNumber: "DUP-001" });
    expect(dup.status).toBe(409);
    expect(dup.body.message).toBe("You already have this credential on file.");
  });

  it("NULL licenseNumber + same kind twice → both 201 (partial index excludes NULLs)", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    // Two CPR renewals with no license_number — should both succeed because
    // the partial-unique index is `WHERE license_number IS NOT NULL`.
    const first = await agent
      .post("/api/jobseeker/credentials")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ kind: "CPR", issuedAt: "2024-03-01" });
    expect(first.status, first.text).toBe(201);
    const second = await agent
      .post("/api/jobseeker/credentials")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ kind: "CPR", issuedAt: "2026-03-01" });
    expect(second.status, second.text).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
  });

  it("three sequential POSTs → GET ordered created_at DESC", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);

    const post = async (licenseNumber: string) => {
      const r = await agent
        .post("/api/jobseeker/credentials")
        .set("X-Requested-With", "XMLHttpRequest")
        .send({ kind: "CNA", licenseNumber });
      expect(r.status, r.text).toBe(201);
      return r.body.id as number;
    };

    // The route stamps createdAt via Date.now() at insert time. Forks run on
    // sub-ms boundaries, so insert a tiny delay between rows to guarantee
    // distinct created_at values — otherwise the order assertion is racy.
    const id1 = await post("ORD-1");
    await new Promise((r) => setTimeout(r, 5));
    const id2 = await post("ORD-2");
    await new Promise((r) => setTimeout(r, 5));
    const id3 = await post("ORD-3");

    const list = await agent.get("/api/jobseeker/credentials");
    expect(list.status).toBe(200);
    expect(list.body.map((r: { id: number }) => r.id)).toEqual([id3, id2, id1]);
  });

  it("invalid date format → 400", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const res = await agent
      .post("/api/jobseeker/credentials")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ kind: "TB", issuedAt: "07/04/2024" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/ISO date YYYY-MM-DD/i);
  });

  it("non-integer :id on PUT → 400", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const res = await agent
      .put("/api/jobseeker/credentials/not-a-number")
      .set("X-Requested-With", "XMLHttpRequest")
      .send({ kind: "CNA" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid id/i);
  });

  it("non-integer :id on DELETE → 400", async () => {
    const app = buildApp();
    const agent = await authedAgent(app, seekerAId);
    const res = await agent
      .delete("/api/jobseeker/credentials/not-a-number")
      .set("X-Requested-With", "XMLHttpRequest");
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid id/i);
  });
});
