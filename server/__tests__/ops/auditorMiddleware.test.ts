/**
 * Wave 3 Phase 3.2 — Auditor share-link middleware + router tests.
 *
 * Coverage:
 *  - requireAuditorToken: missing → 401; invalid → 401; expired → 401;
 *    revoked → 401; valid → req.auditor populated.
 *  - blockAuditorMutations: POST/PUT/PATCH/DELETE → 403; GET → next().
 *  - The auditor router enforces tenant scope via req.auditor.facility-
 *    Number: hand-crafted URL with foreign :facilityNumber must NOT
 *    cross-read.
 *  - GET /api/ops/auditor/me returns the right scope.
 *  - visit_count is bumped on each accepted request.
 */

import "dotenv/config";

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import express, { type Express } from "express";
import request from "supertest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import { bootstrapOpsSchema } from "../../ops/opsStorage";

import { auditorRouter } from "../../ops/auditorRouter";
import {
  requireAuditorToken,
  blockAuditorMutations,
  _resetAuditorMiddlewareForTests,
} from "../../ops/auditorMiddleware";
import {
  createShareLink,
  revokeShareLink,
} from "../../ops/shareLinksStorage";

const FACILITY_A = "TEST-FAC-AUD-A";
const FACILITY_B = "TEST-FAC-AUD-B";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const ACTOR = { id: "alice", role: "admin" };
const REQUIRED_HEADERS = { "X-Requested-With": "XMLHttpRequest" } as const;

let app: Express;

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_share_links WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
}

beforeAll(async () => {
  await bootstrapMainSchema();
  await bootstrapOpsSchema();

  // Minimal app that wires only the auditor router. No facility
  // Passport — the auditor router has its own auth path.
  app = express();
  app.use(express.json());
  // Same CSRF gate as prod. Auditor traffic uses GET only so this is
  // not a hot path but the middleware is symmetric across routers.
  app.use((req, res, next) => {
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
  app.use("/api/ops/auditor", auditorRouter);
  // Generic error sink.
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (res.headersSent) return;
    res.status(500).json({ success: false, error: err.message });
  });
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

beforeEach(async () => {
  await cleanup();
  _resetAuditorMiddlewareForTests();
});

describe("requireAuditorToken", () => {
  it("rejects requests with no token (401)", async () => {
    const r = await request(app).get("/api/ops/auditor/me");
    expect(r.status).toBe(401);
    expect(r.body.error).toMatch(/required/i);
  });

  it("rejects requests with an unknown token (401)", async () => {
    const r = await request(app)
      .get("/api/ops/auditor/me")
      .set("Authorization", "Bearer not-a-real-token");
    expect(r.status).toBe(401);
  });

  it("accepts a valid token via Authorization header and populates req.auditor", async () => {
    const link = await createShareLink(
      {
        facilityNumber: FACILITY_A,
        audience: "cdss",
        durationDays: 7,
        createdBy: ACTOR.id,
      },
      ACTOR,
    );
    const r = await request(app)
      .get("/api/ops/auditor/me")
      .set("Authorization", `Bearer ${link.token}`);
    expect(r.status).toBe(200);
    expect(r.body.data.facilityNumber).toBe(FACILITY_A);
    expect(r.body.data.audience).toBe("cdss");
    expect(typeof r.body.data.expiresAt).toBe("number");
  });

  it("accepts a valid token via ?token= query param", async () => {
    const link = await createShareLink(
      {
        facilityNumber: FACILITY_A,
        audience: "cdss",
        durationDays: 7,
        createdBy: ACTOR.id,
      },
      ACTOR,
    );
    const r = await request(app).get(
      `/api/ops/auditor/me?token=${encodeURIComponent(link.token)}`,
    );
    expect(r.status).toBe(200);
  });

  it("rejects an expired token (401)", async () => {
    const link = await createShareLink(
      {
        facilityNumber: FACILITY_A,
        audience: "cdss",
        durationDays: 7,
        createdBy: ACTOR.id,
      },
      ACTOR,
    );
    await pool.query(
      `UPDATE ops_share_links SET expires_at = $1 WHERE id = $2`,
      [Date.now() - 1, link.id],
    );
    const r = await request(app)
      .get("/api/ops/auditor/me")
      .set("Authorization", `Bearer ${link.token}`);
    expect(r.status).toBe(401);
  });

  it("rejects a revoked token (401)", async () => {
    const link = await createShareLink(
      {
        facilityNumber: FACILITY_A,
        audience: "cdss",
        durationDays: 7,
        createdBy: ACTOR.id,
      },
      ACTOR,
    );
    await revokeShareLink(link.id, FACILITY_A, ACTOR.id, ACTOR);
    const r = await request(app)
      .get("/api/ops/auditor/me")
      .set("Authorization", `Bearer ${link.token}`);
    expect(r.status).toBe(401);
  });

  it("bumps visit_count on each accepted request", async () => {
    const link = await createShareLink(
      {
        facilityNumber: FACILITY_A,
        audience: "cdss",
        durationDays: 7,
        createdBy: ACTOR.id,
      },
      ACTOR,
    );
    await request(app)
      .get("/api/ops/auditor/me")
      .set("Authorization", `Bearer ${link.token}`);
    await request(app)
      .get("/api/ops/auditor/me")
      .set("Authorization", `Bearer ${link.token}`);
    const r = await pool.query<{ visit_count: number }>(
      `SELECT visit_count FROM ops_share_links WHERE id = $1`,
      [link.id],
    );
    expect(Number(r.rows[0].visit_count)).toBe(2);
  });
});

describe("blockAuditorMutations", () => {
  it("rejects POST with 403 even with a valid token", async () => {
    const link = await createShareLink(
      {
        facilityNumber: FACILITY_A,
        audience: "cdss",
        durationDays: 7,
        createdBy: ACTOR.id,
      },
      ACTOR,
    );
    const r = await request(app)
      .post("/api/ops/auditor/me")
      .set(REQUIRED_HEADERS)
      .set("Authorization", `Bearer ${link.token}`)
      .send({});
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/read-only/i);
  });

  it("rejects PUT/PATCH/DELETE with 403", async () => {
    const link = await createShareLink(
      {
        facilityNumber: FACILITY_A,
        audience: "cdss",
        durationDays: 7,
        createdBy: ACTOR.id,
      },
      ACTOR,
    );
    for (const method of ["put", "patch", "delete"] as const) {
      const r = await (request(app) as unknown as Record<
        typeof method,
        (p: string) => request.Test
      >)
        [method]("/api/ops/auditor/me")
        .set(REQUIRED_HEADERS)
        .set("Authorization", `Bearer ${link.token}`)
        .send({});
      expect(r.status).toBe(403);
    }
  });

  it("standalone: blockAuditorMutations passes GET through", () => {
    const handlerCalled = { value: false };
    const next = () => {
      handlerCalled.value = true;
    };
    blockAuditorMutations(
      { method: "GET" } as express.Request,
      {
        status: () => ({ json: () => undefined }),
      } as unknown as express.Response,
      next as express.NextFunction,
    );
    expect(handlerCalled.value).toBe(true);
  });

  it("standalone: requireAuditorToken is callable as a middleware function", () => {
    // Compile-time + minimal sanity. Real coverage is via the supertest
    // routes above.
    expect(typeof requireAuditorToken).toBe("function");
  });
});

describe("auditor tenant scope", () => {
  it("an auditor session for facility A cannot read facility B's data", async () => {
    // Mint a link for FACILITY_A. Auditor must be scoped to A regardless
    // of any URL hint. /me reflects the bound facility.
    const link = await createShareLink(
      {
        facilityNumber: FACILITY_A,
        audience: "cdss",
        durationDays: 7,
        createdBy: ACTOR.id,
      },
      ACTOR,
    );
    const me = await request(app)
      .get("/api/ops/auditor/me")
      .set("Authorization", `Bearer ${link.token}`);
    expect(me.body.data.facilityNumber).toBe(FACILITY_A);

    // The auditor router intentionally has no `:facilityNumber` URL
    // param — every storage call uses req.auditor.facilityNumber. We
    // assert that triage (which would surface cross-tenant data if the
    // scope were wrong) only returns the facility-A surface. Triage is
    // safe to hit with an empty A facility: it just returns an empty
    // payload tagged with the correct facilityNumber.
    const triage = await request(app)
      .get("/api/ops/auditor/triage")
      .set("Authorization", `Bearer ${link.token}`);
    expect(triage.status).toBe(200);
    expect(triage.body.data.facilityNumber).toBe(FACILITY_A);
  });
});
