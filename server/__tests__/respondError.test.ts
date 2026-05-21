/**
 * respondError + AppError — pure unit tests.
 *
 * No HTTP server, no DB; we stub Response with the same minimal shape used
 * in requireActiveSubscription.test.ts so the spec runs fast in the
 * `server` vitest project.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Response } from "express";
import { z } from "zod";

import { respondError, AppError } from "../lib/respondError";

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

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

beforeEach(() => {
  // Silence the [respondError] console.error noise during the suite; we
  // restore the spy after each test.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
  } else {
    process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  }
});

describe("respondError", () => {
  describe("ZodError handling", () => {
    it("maps a ZodError to 400 VALIDATION_ERROR with the first issue's message", () => {
      const schema = z.object({
        email: z.string().email("Email is invalid"),
        age: z.number().min(18, "Must be 18 or older"),
      });
      const parsed = schema.safeParse({ email: "nope", age: 12 });
      expect(parsed.success).toBe(false);
      if (parsed.success) return;

      const res = makeRes();
      respondError(res, parsed.error);

      expect(res.__status).toBe(400);
      const body = res.__body as {
        code: string;
        message: string;
        details: { issues: unknown[] };
      };
      expect(body.code).toBe("VALIDATION_ERROR");
      // The first issue is the email failure. Zod orders issues by field
      // declaration order, so this is stable.
      expect(body.message).toBe("Email is invalid");
      expect(Array.isArray(body.details.issues)).toBe(true);
      expect(body.details.issues).toHaveLength(2);
    });

    it("honours an explicit status override even for ZodError", () => {
      const parsed = z.string().safeParse(42);
      if (parsed.success) throw new Error("expected parse to fail");
      const res = makeRes();
      respondError(res, parsed.error, 422);
      expect(res.__status).toBe(422);
      expect((res.__body as { code: string }).code).toBe("VALIDATION_ERROR");
    });
  });

  describe("AppError handling", () => {
    it("uses the AppError's code, message, and statusCode", () => {
      const res = makeRes();
      respondError(res, new AppError("NOT_FOUND", "Resident not found", 404));

      expect(res.__status).toBe(404);
      const body = res.__body as { code: string; message: string };
      expect(body.code).toBe("NOT_FOUND");
      expect(body.message).toBe("Resident not found");
    });

    it("attaches AppError.details to the envelope when provided", () => {
      const res = makeRes();
      respondError(
        res,
        new AppError("BAD_THING", "Bad", 422, { field: "name" }),
      );
      const body = res.__body as { details?: { field: string; stack?: string } };
      // In test env NODE_ENV is "test", which the helper treats as
      // non-production — so a stack is spread on top of the details object.
      expect(body.details?.field).toBe("name");
    });

    it("falls back to status 500 when AppError is constructed without one", () => {
      const res = makeRes();
      respondError(res, new AppError("WEIRD", "weird"));
      expect(res.__status).toBe(500);
      expect((res.__body as { code: string }).code).toBe("WEIRD");
    });
  });

  describe("generic Error fall-through", () => {
    it("returns 500 INTERNAL_ERROR with a safe generic message", () => {
      const res = makeRes();
      respondError(res, new Error("kaboom: secret token leaked in message"));

      expect(res.__status).toBe(500);
      const body = res.__body as { code: string; message: string };
      expect(body.code).toBe("INTERNAL_ERROR");
      // We must NOT echo the raw error.message into the user-facing field.
      expect(body.message).not.toContain("kaboom");
      expect(body.message).toBe("Something went wrong. Please try again.");
    });

    it("returns 500 INTERNAL_ERROR for non-Error throws (string/number/object)", () => {
      const res1 = makeRes();
      respondError(res1, "string thrown");
      expect(res1.__status).toBe(500);
      expect((res1.__body as { code: string }).code).toBe("INTERNAL_ERROR");

      const res2 = makeRes();
      respondError(res2, { random: "object" });
      expect(res2.__status).toBe(500);
      expect((res2.__body as { code: string }).code).toBe("INTERNAL_ERROR");
    });
  });

  describe("stack leak: production vs development", () => {
    it("in development (NODE_ENV !== 'production'), includes stack in details", () => {
      process.env.NODE_ENV = "development";
      const res = makeRes();
      respondError(res, new Error("dev failure"));

      const body = res.__body as { details?: { stack?: string; message?: string } };
      expect(body.details).toBeDefined();
      expect(body.details?.stack).toContain("Error: dev failure");
      // The internal message stays inside `details` (debug-only), not the
      // top-level `message` field.
      expect(body.details?.message).toBe("dev failure");
    });

    it("in production, NEVER includes stack or internal message in the envelope", () => {
      process.env.NODE_ENV = "production";
      const res = makeRes();
      respondError(res, new Error("prod failure — secrets here"));

      const body = res.__body as {
        code: string;
        message: string;
        details?: unknown;
      };
      expect(body.code).toBe("INTERNAL_ERROR");
      expect(body.message).toBe("Something went wrong. Please try again.");
      expect(body.details).toBeUndefined();

      // Serialise to JSON the way Express would; the raw error.message must
      // not appear anywhere in the wire payload.
      const wire = JSON.stringify(body);
      expect(wire).not.toContain("prod failure");
      expect(wire).not.toContain("secrets");
    });

    it("in production, AppError still surfaces .code and .message (those are intentional)", () => {
      process.env.NODE_ENV = "production";
      const res = makeRes();
      respondError(res, new AppError("NOT_FOUND", "Resident not found", 404));

      const body = res.__body as {
        code: string;
        message: string;
        details?: { stack?: string };
      };
      expect(body.code).toBe("NOT_FOUND");
      expect(body.message).toBe("Resident not found");
      // But the stack — which would leak file paths — must be stripped.
      expect(body.details?.stack).toBeUndefined();
    });
  });

  describe("logging side effect", () => {
    it("always logs the original error via console.error", () => {
      const spy = vi.spyOn(console, "error");
      const err = new Error("logme");
      const res = makeRes();
      respondError(res, err);

      expect(spy).toHaveBeenCalled();
      // The original error object is passed through to console.error so a
      // future Sentry hook can attach to the same call site.
      const calls = spy.mock.calls;
      const last = calls[calls.length - 1];
      expect(last).toContain(err);
    });
  });
});
