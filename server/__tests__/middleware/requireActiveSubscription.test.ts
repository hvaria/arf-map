/**
 * requireActiveSubscription middleware — pure unit tests.
 *
 * Exercises the gate logic with stubbed Request/Response objects so the
 * suite has no DB or HTTP-server dependency. The integration test for the
 * full /api/ops/* path lives in opsRouter.subscription.test.ts.
 */

import { describe, expect, it, vi } from "vitest";
import type { Request, Response, NextFunction } from "express";

import { requireActiveSubscription } from "../../middleware/requireActiveSubscription";

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

function makeReq(user: unknown): Request {
  return { user } as unknown as Request;
}

describe("requireActiveSubscription", () => {
  it("returns 401 UNAUTHENTICATED when req.user is missing", () => {
    const req = makeReq(undefined);
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireActiveSubscription(req, res, next);

    expect(res.__status).toBe(401);
    expect(res.__body).toEqual({ code: "UNAUTHENTICATED" });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 402 SUBSCRIPTION_REQUIRED with the locked payload when status is null", () => {
    const req = makeReq({ subscriptionStatus: null });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireActiveSubscription(req, res, next);

    expect(res.__status).toBe(402);
    expect(res.__body).toEqual({
      code: "SUBSCRIPTION_REQUIRED",
      upgradeUrl: "/api/billing/checkout",
      message: "Operations requires an active subscription",
    });
    expect(next).not.toHaveBeenCalled();
  });

  it("returns 402 SUBSCRIPTION_REQUIRED when status is undefined (column missing)", () => {
    const req = makeReq({});
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireActiveSubscription(req, res, next);

    expect(res.__status).toBe(402);
    expect((res.__body as { code: string }).code).toBe("SUBSCRIPTION_REQUIRED");
    expect(next).not.toHaveBeenCalled();
  });

  // The five non-allowed Stripe statuses. `paused` is in the canonical Stripe
  // status enum but not in the spec — we still expect a 402 so the gate
  // doesn't silently allow it.
  const REJECTED_STATUSES = [
    "past_due",
    "canceled",
    "unpaid",
    "incomplete",
    "incomplete_expired",
    "paused",
  ] as const;

  for (const status of REJECTED_STATUSES) {
    it(`returns 402 when subscriptionStatus is "${status}"`, () => {
      const req = makeReq({ subscriptionStatus: status });
      const res = makeRes();
      const next = vi.fn() as unknown as NextFunction;

      requireActiveSubscription(req, res, next);

      expect(res.__status).toBe(402);
      expect((res.__body as { code: string }).code).toBe("SUBSCRIPTION_REQUIRED");
      expect(next).not.toHaveBeenCalled();
    });
  }

  it("calls next() when status is active", () => {
    const req = makeReq({ subscriptionStatus: "active" });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireActiveSubscription(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.__status).toBeNull();
    expect(res.__body).toBeNull();
  });

  it("calls next() when status is trialing", () => {
    const req = makeReq({ subscriptionStatus: "trialing" });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireActiveSubscription(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(res.__status).toBeNull();
    expect(res.__body).toBeNull();
  });

  it("treats unknown statuses as non-active (defensive default)", () => {
    const req = makeReq({ subscriptionStatus: "future_stripe_status_we_dont_know_yet" });
    const res = makeRes();
    const next = vi.fn() as unknown as NextFunction;

    requireActiveSubscription(req, res, next);

    expect(res.__status).toBe(402);
    expect(next).not.toHaveBeenCalled();
  });
});
