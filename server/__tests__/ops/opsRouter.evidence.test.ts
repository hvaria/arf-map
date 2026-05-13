/**
 * F2 Evidence routes — end-to-end integration tests through the real
 * opsRouter.
 *
 * Coverage:
 *  - Happy path: upload (multipart) + download round-trip; headers correct.
 *  - 5 MB + 1 byte → 413 (multer's fileSize limit fires first).
 *  - Non-allow-list mime declared on multipart → 400.
 *  - Mime declared OK, but sniffed mime is different → 400 (storage layer).
 *  - Download headers: Content-Type, Content-Disposition, Cache-Control.
 *  - IDOR: facility A logged in cannot list facility B's evidence via the
 *    `:facilityNumber` URL form (the existing opsRouter.param guard).
 *  - DELETE soft-deletes; subsequent GET /download is 404.
 *
 * Uses the same in-memory test app as the trackers/subscription suite —
 * `buildTestApp()` from server/__tests__/trackers/setupTestApp.ts.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Express } from "express";

import {
  buildTestApp,
  cleanFacilityAccounts,
  seedFacility,
  type TestFacility,
} from "../trackers/setupTestApp";
import { pool } from "../../db/index";
import { bootstrapOpsSchema } from "../../ops/opsStorage";
import {
  EVIDENCE_MAX_BYTES,
  FlyVolumeAdapter,
  setStorageAdapterForTests,
} from "../../ops/evidenceStorage";

const FACILITY_A = "TEST-FAC-EVR-A";
const FACILITY_B = "TEST-FAC-EVR-B";
const USER_A = "test-evr-a-user";
const USER_B = "test-evr-b-user";
const PW_A = "test-pw-evr-a-12345!";
const PW_B = "test-pw-evr-b-12345!";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const REQUIRED_HEADERS = { "X-Requested-With": "XMLHttpRequest" } as const;

const TINY_PNG = Buffer.from(
  "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c63000100000005000156a14eaf0000000049454e44ae426082",
  "hex",
);
const TINY_PDF = Buffer.from(
  "%PDF-1.4\n1 0 obj<</Type/Catalog>>endobj\ntrailer<<>>\n%%EOF",
  "ascii",
);

let app: Express;
let tempRoot: string;
let facilityA: TestFacility;
let facilityB: TestFacility;

async function loginAgent(
  app_: Express,
  username: string,
  password: string,
): Promise<request.Agent> {
  const agent = request.agent(app_);
  const res = await agent
    .post("/api/facility/login")
    .set(REQUIRED_HEADERS)
    .send({ username, password });
  expect(res.status, `login failed: ${res.text}`).toBe(200);
  return agent;
}

beforeAll(async () => {
  app = buildTestApp();
  await bootstrapOpsSchema();
  tempRoot = await mkdtemp(join(tmpdir(), "arf-evroute-"));
  setStorageAdapterForTests(new FlyVolumeAdapter(tempRoot));
  facilityA = await seedFacility({
    facilityNumber: FACILITY_A,
    username: USER_A,
    password: PW_A,
    email: "test-evr-a@example.com",
  });
  facilityB = await seedFacility({
    facilityNumber: FACILITY_B,
    username: USER_B,
    password: PW_B,
    email: "test-evr-b@example.com",
  });
});

afterAll(async () => {
  setStorageAdapterForTests(null);
  await pool.query(
    `DELETE FROM ops_evidence_attachments WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await cleanFacilityAccounts(ALL_FN);
  await rm(tempRoot, { recursive: true, force: true });
  await pool.end();
});

beforeEach(async () => {
  await pool.query(
    `DELETE FROM ops_evidence_attachments WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
});

describe("POST /api/ops/evidence — happy path", () => {
  it("uploads a PNG, returns 201 + sha256, allows download round-trip", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const post = await agent
      .post("/api/ops/evidence")
      .set(REQUIRED_HEADERS)
      .field("entityType", "ops_drill_log")
      .field("entityId", "42")
      .field("kind", "photo")
      .attach("file", TINY_PNG, { filename: "snap.png", contentType: "image/png" });
    expect(post.status, post.text).toBe(201);
    expect(post.body.success).toBe(true);
    expect(post.body.data.mime).toBe("image/png");
    expect(post.body.data.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(post.body.data.facilityNumber).toBe(FACILITY_A);

    const id: number = post.body.data.id;
    const download = await agent
      .get(`/api/ops/evidence/${id}/download`)
      .set(REQUIRED_HEADERS)
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toBe("image/png");
    expect(download.headers["cache-control"]).toBe("private, no-store");
    expect(download.headers["content-disposition"]).toMatch(
      /attachment; filename=".+\.png"/,
    );
    expect(Buffer.isBuffer(download.body)).toBe(true);
    expect((download.body as Buffer).equals(TINY_PNG)).toBe(true);
  });
});

describe("POST /api/ops/evidence — validation", () => {
  it("rejects upload with 5 MB + 1 byte payload (multer fileSize)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const oversize = Buffer.alloc(EVIDENCE_MAX_BYTES + 1, 0x41);
    const res = await agent
      .post("/api/ops/evidence")
      .set(REQUIRED_HEADERS)
      .field("entityType", "ops_vendor")
      .field("entityId", "1")
      .field("kind", "file")
      .attach("file", oversize, {
        filename: "huge.pdf",
        contentType: "application/pdf",
      });
    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
  });

  it("rejects non-allow-listed declared mime (text/plain)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/evidence")
      .set(REQUIRED_HEADERS)
      .field("entityType", "ops_vendor")
      .field("entityId", "1")
      .field("kind", "file")
      .attach("file", Buffer.from("hello"), {
        filename: "hello.txt",
        contentType: "text/plain",
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/text\/plain/);
  });

  it("rejects declared/sniffed mime mismatch (declared image/png, actual PDF)", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/evidence")
      .set(REQUIRED_HEADERS)
      .field("entityType", "ops_vendor")
      .field("entityId", "1")
      .field("kind", "file")
      .attach("file", TINY_PDF, {
        filename: "trick.png",
        contentType: "image/png", // declared incorrectly
      });
    // file-type sniffs the PDF magic → MIME_MISMATCH → 400.
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/match|mime/i);
  });

  it("rejects missing file field on file/photo kinds", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .post("/api/ops/evidence")
      .set(REQUIRED_HEADERS)
      .field("entityType", "ops_vendor")
      .field("entityId", "1")
      .field("kind", "file");
    expect(res.status).toBe(400);
  });
});

describe("IDOR — :facilityNumber must match the session", () => {
  it("facility A logged in cannot list facility B's evidence via URL", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const res = await agent
      .get(
        `/api/ops/facilities/${FACILITY_B}/evidence?entityType=ops_vendor&entityId=1`,
      )
      .set(REQUIRED_HEADERS);
    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
  });

  it("a cross-tenant evidence download returns 404 (existence not leaked)", async () => {
    // Upload as B.
    const agentB = await loginAgent(app, facilityB.username, facilityB.password);
    const postB = await agentB
      .post("/api/ops/evidence")
      .set(REQUIRED_HEADERS)
      .field("entityType", "ops_vendor")
      .field("entityId", "1")
      .field("kind", "file")
      .attach("file", TINY_PDF, {
        filename: "b.pdf",
        contentType: "application/pdf",
      });
    expect(postB.status).toBe(201);
    const bId: number = postB.body.data.id;

    // A tries to download B's evidence by raw id → 404.
    const agentA = await loginAgent(app, facilityA.username, facilityA.password);
    const r = await agentA
      .get(`/api/ops/evidence/${bId}/download`)
      .set(REQUIRED_HEADERS);
    expect(r.status).toBe(404);
  });
});

describe("DELETE /api/ops/evidence/:id — soft delete", () => {
  it("soft-deletes the row; subsequent download is 404; list omits it", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const post = await agent
      .post("/api/ops/evidence")
      .set(REQUIRED_HEADERS)
      .field("entityType", "ops_complaint")
      .field("entityId", "5")
      .field("kind", "file")
      .attach("file", TINY_PDF, {
        filename: "doc.pdf",
        contentType: "application/pdf",
      });
    const id: number = post.body.data.id;

    const del = await agent
      .delete(`/api/ops/evidence/${id}`)
      .set(REQUIRED_HEADERS);
    expect(del.status).toBe(200);
    expect(del.body.data.deletedAt).toBeGreaterThan(0);

    const after = await agent
      .get(`/api/ops/evidence/${id}/download`)
      .set(REQUIRED_HEADERS);
    expect(after.status).toBe(404);

    const list = await agent
      .get(
        `/api/ops/facilities/${FACILITY_A}/evidence?entityType=ops_complaint&entityId=5`,
      )
      .set(REQUIRED_HEADERS);
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(0);
  });
});

describe("GET /api/ops/facilities/:fn/audit-trail", () => {
  it("returns audit rows including the attach + detach pair", async () => {
    const agent = await loginAgent(app, facilityA.username, facilityA.password);
    const post = await agent
      .post("/api/ops/evidence")
      .set(REQUIRED_HEADERS)
      .field("entityType", "ops_vendor")
      .field("entityId", "9")
      .field("kind", "file")
      .attach("file", TINY_PDF, {
        filename: "v.pdf",
        contentType: "application/pdf",
      });
    const id: number = post.body.data.id;
    await agent.delete(`/api/ops/evidence/${id}`).set(REQUIRED_HEADERS);

    const trail = await agent
      .get(
        `/api/ops/facilities/${FACILITY_A}/audit-trail?entityType=ops_vendor&entityId=9`,
      )
      .set(REQUIRED_HEADERS);
    expect(trail.status).toBe(200);
    const actions = (trail.body.data as Array<{ action: string }>).map(
      (r) => r.action,
    );
    expect(actions).toContain("attach_evidence");
    expect(actions).toContain("detach_evidence");
  });
});
