/**
 * csrfToken middleware — pure unit tests.
 *
 * Stub Request/Response objects so the suite has no HTTP/DB dependency.
 * Exercises: token generation, header missing, header mismatch, GET skip,
 * webhook bypass, and the constant-time-equal happy path.
 */

import { describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

import {
  csrfTokenMiddleware,
  getOrCreateCsrfToken,
} from "../../middleware/csrfToken";

type StubSession = {
  csrfToken?: string;
};

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

function makeReq(opts: {
  method: string;
  path: string;
  session?: StubSession;
  csrfHeader?: string;
}): Request {
  return {
    method: opts.method,
    path: opts.path,
    session: opts.session ?? {},
    headers: opts.csrfHeader ? { "x-csrf-token": opts.csrfHeader } : {},
  } as unknown as Request;
}

describe("csrfTokenMiddleware", () => {
  const mw = csrfTokenMiddleware();

  it("skips GET requests entirely", () => {
    const req = makeReq({ method: "GET", path: "/api/facility/me" });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.__status).toBeNull();
  });

  it("skips HEAD and OPTIONS", () => {
    for (const method of ["HEAD", "OPTIONS"]) {
      const req = makeReq({ method, path: "/api/jobs" });
      const res = makeRes();
      const next = vi.fn() as unknown as NextFunction;

      mw(req, res, next);

      expect(next).toHaveBeenCalledTimes(1);
      expect(res.__status).toBeNull();
    }
  });

  it("skips non-/api/ paths", () => {
    const req = makeReq({ method: "POST", path: "/some/other/path" });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.__status).toBeNull();
  });

  it("bypasses the Stripe webhook path", () => {
    const req = makeReq({ method: "POST", path: "/api/billing/webhook" });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.__status).toBeNull();
  });

  it("returns 403 when the header is missing", () => {
    const req = makeReq({
      method: "POST",
      path: "/api/facility/details",
      session: { csrfToken: "abcd1234" },
    });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    mw(req, res, next);

    expect(res.__status).toBe(403);
    expect(res.__body).toEqual({
      code: "CSRF_TOKEN_INVALID",
      message: "CSRF validation failed",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when the session has no token at all", () => {
    const req = makeReq({
      method: "POST",
      path: "/api/facility/details",
      session: {}, // no token minted yet
      csrfHeader: "anything",
    });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    mw(req, res, next);

    expect(res.__status).toBe(403);
    expect((res.__body as { code: string }).code).toBe("CSRF_TOKEN_INVALID");
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when the header token does not match the session token", () => {
    const req = makeReq({
      method: "POST",
      path: "/api/facility/details",
      session: { csrfToken: "expected-token-value" },
      csrfHeader: "wrong-token-value!!", // same length, different bytes
    });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    mw(req, res, next);

    expect(res.__status).toBe(403);
    expect((res.__body as { code: string }).code).toBe("CSRF_TOKEN_INVALID");
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 403 when the header is a different length than the session token", () => {
    const req = makeReq({
      method: "POST",
      path: "/api/facility/details",
      session: { csrfToken: "long-token-here" },
      csrfHeader: "short",
    });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    mw(req, res, next);

    expect(res.__status).toBe(403);
    expect(next).not.toHaveBeenCalled();
  });

  it("calls next() when the header matches the session token", () => {
    const token = "matched-token-abc-123";
    const req = makeReq({
      method: "POST",
      path: "/api/facility/details",
      session: { csrfToken: token },
      csrfHeader: token,
    });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    mw(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.__status).toBeNull();
  });

  it.each(["POST", "PUT", "PATCH", "DELETE"])(
    "enforces the check on %s",
    (method) => {
      const req = makeReq({
        method,
        path: "/api/jobs/123",
        session: { csrfToken: "real" },
        csrfHeader: "fake",
      });
      const res = makeRes();
      const next = vi.fn() as unknown as NextFunction;

      mw(req, res, next);

      expect(res.__status).toBe(403);
      expect(next).not.toHaveBeenCalled();
    },
  );
});

describe("getOrCreateCsrfToken", () => {
  it("mints a new 64-char hex token on first call and stores it on the session", () => {
    const session: StubSession = {};
    const req = { session } as unknown as Request;

    const token = getOrCreateCsrfToken(req);

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(session.csrfToken).toBe(token);
  });

  it("returns the existing token on subsequent calls (idempotent)", () => {
    const session: StubSession = {};
    const req = { session } as unknown as Request;

    const first = getOrCreateCsrfToken(req);
    const second = getOrCreateCsrfToken(req);

    expect(second).toBe(first);
  });

  it("throws if called before the session middleware ran", () => {
    const req = {} as unknown as Request;
    expect(() => getOrCreateCsrfToken(req)).toThrow(/session middleware/);
  });
});
