/**
 * Phase 3 — resolveRole + requireOpsPermission deny-path coverage.
 *
 * Pure unit tests against the middleware with stubbed Request/Response
 * objects. No DB or HTTP server — keeps the suite under a second and
 * locks in the four scenarios that matter for the role wiring:
 *   1. Allowed:       role "facility_admin" can read AND write
 *                     temperature logs.
 *   2. Read-only:     role "auditor" can read but NOT write — POST/PUT
 *                     return 403 { success: false, error: "Forbidden" }.
 *   3. Unknown role:  role "some_garbage" warns and falls back to admin
 *                     (so a stray DB string never accidentally locks
 *                     out an active facility).
 *   4. Null role:     role null defaults to "facility_admin" and
 *                     behaves as admin.
 *
 * Temperature logs was chosen because it has both read and write
 * surfaces in opsRouter and the simplest action vocabulary
 * (read / create / resolve).
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import type { Request, Response, NextFunction } from "express";

import {
  OPS_RESOURCES,
  requireOpsPermission,
  resolveRole,
} from "../../ops/permissions";

// ── Test stubs ──────────────────────────────────────────────────────────────

type StubRes = Response & {
  __status: number | null;
  __body: unknown;
};

function makeRes(): StubRes {
  const res = {
    __status: null as number | null,
    __body: null as unknown,
    status(code: number) {
      this.__status = code;
      return this;
    },
    json(body: unknown) {
      this.__body = body;
      return this;
    },
  };
  return res as unknown as StubRes;
}

/**
 * Build a stub Request with `req.user.role` set to the supplied value.
 * The middleware path only looks at `req.user.role`; everything else
 * (session, params, query, body) is untouched here.
 */
function makeReq(role: string | null | undefined): Request {
  return { user: role === undefined ? undefined : { role } } as unknown as Request;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ────────────────────────────────────────────────────────────────────────────
// Scenario 1 — facility_admin role: full CRUD on temperature logs
// ────────────────────────────────────────────────────────────────────────────

describe("resolveRole — facility_admin DB role maps to OpsRole admin", () => {
  it("read action passes for facility_admin", () => {
    const req = makeReq("facility_admin");
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireOpsPermission(OPS_RESOURCES.TEMPERATURE_LOG, "read")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.__status).toBeNull();
    expect(resolveRole(req)).toBe("admin");
  });

  it("create action passes for facility_admin", () => {
    const req = makeReq("facility_admin");
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireOpsPermission(OPS_RESOURCES.TEMPERATURE_LOG, "create")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.__status).toBeNull();
  });

  it("resolve action passes for facility_admin", () => {
    const req = makeReq("facility_admin");
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireOpsPermission(OPS_RESOURCES.TEMPERATURE_LOG, "resolve")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.__status).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Scenario 2 — auditor role: read-only on temperature logs
// ────────────────────────────────────────────────────────────────────────────

describe("resolveRole — auditor DB role is read-only", () => {
  it("read action passes for auditor", () => {
    const req = makeReq("auditor");
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireOpsPermission(OPS_RESOURCES.TEMPERATURE_LOG, "read")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.__status).toBeNull();
    expect(resolveRole(req)).toBe("auditor");
  });

  it("create action denied for auditor → 403 Forbidden envelope", () => {
    const req = makeReq("auditor");
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireOpsPermission(OPS_RESOURCES.TEMPERATURE_LOG, "create")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.__status).toBe(403);
    expect(res.__body).toEqual({ success: false, error: "Forbidden" });
  });

  it("resolve action denied for auditor → 403 Forbidden envelope", () => {
    const req = makeReq("auditor");
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireOpsPermission(OPS_RESOURCES.TEMPERATURE_LOG, "resolve")(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.__status).toBe(403);
    expect(res.__body).toEqual({ success: false, error: "Forbidden" });
  });

  it("update action denied for auditor on TEMPERATURE_FIXTURE → 403", () => {
    // Cross-resource sanity check: a write action on a different resource
    // also denies. Guards against a bug where the matrix lookup ignored
    // the resource and only checked the action.
    const req = makeReq("auditor");
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireOpsPermission(OPS_RESOURCES.TEMPERATURE_FIXTURE, "update")(
      req,
      res,
      next,
    );

    expect(next).not.toHaveBeenCalled();
    expect(res.__status).toBe(403);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Scenario 3 — unknown DB role string: warn + fall back to admin
// ────────────────────────────────────────────────────────────────────────────

describe("resolveRole — unknown DB role falls back to admin (warn surfaces drift)", () => {
  it("unknown role logs a console.warn and resolves to admin", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const req = makeReq("some_garbage");

    const role = resolveRole(req);

    expect(role).toBe("admin");
    expect(warn).toHaveBeenCalledTimes(1);
    const firstArg = warn.mock.calls[0][0] as string;
    expect(firstArg).toContain("some_garbage");
    expect(firstArg).toContain("defaulting to admin");
  });

  it("unknown role grants the admin matrix (write actions pass)", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const req = makeReq("some_garbage");
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireOpsPermission(OPS_RESOURCES.TEMPERATURE_LOG, "create")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.__status).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Scenario 4 — null / missing role: defaults to facility_admin (admin)
// ────────────────────────────────────────────────────────────────────────────

describe("resolveRole — null/undefined/empty role defaults to facility_admin", () => {
  it("null role resolves to admin without a warn", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const req = makeReq(null);

    const role = resolveRole(req);

    expect(role).toBe("admin");
    // facility_admin is in the known map — no drift warning expected.
    expect(warn).not.toHaveBeenCalled();
  });

  it("undefined req.user resolves to admin", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const req = makeReq(undefined);

    expect(resolveRole(req)).toBe("admin");
  });

  it("empty-string role resolves to admin (treated as missing)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const req = makeReq("");

    const role = resolveRole(req);

    expect(role).toBe("admin");
    expect(warn).not.toHaveBeenCalled();
  });

  it("null role grants admin matrix (write actions pass)", () => {
    const req = makeReq(null);
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireOpsPermission(OPS_RESOURCES.TEMPERATURE_LOG, "create")(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.__status).toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Bonus — case + whitespace robustness on the DB role string
// ────────────────────────────────────────────────────────────────────────────

describe("resolveRole — DB string normalization", () => {
  it("trims and lowercases the DB role before lookup", () => {
    const req = makeReq("  AUDITOR  ");
    expect(resolveRole(req)).toBe("auditor");
  });
});
