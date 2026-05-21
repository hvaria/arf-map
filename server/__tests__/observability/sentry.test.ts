/**
 * Sentry wiring — unit tests with a mocked SDK.
 *
 * Goal: prove that
 *   1. initSentry() is a no-op (and logs the disabled line) when SENTRY_DSN
 *      is unset, so dev/test/local boot without any DSN configured.
 *   2. initSentry() forwards DSN + env-derived options to Sentry.init().
 *   3. tracesSampleRate flips between dev (1.0) and prod (0.1).
 *   4. captureExceptionFromRequest attaches request context and forwards the
 *      error to Sentry.captureException — but only when enabled.
 *
 * The Sentry SDK itself is mocked via `vi.mock` so the test does not require
 * a real DSN, network access, or any background flush.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Request } from "express";

// Hoisted mock factory — keep the spies on `module-scope` so each test can
// assert against them. `vi.hoisted` runs before any imports below.
const sentryMocks = vi.hoisted(() => {
  return {
    init: vi.fn(),
    captureException: vi.fn(),
    expressIntegration: vi.fn(() => ({ name: "Express" })),
    withScope: vi.fn((cb: (scope: unknown) => void) => {
      cb({
        setTag: vi.fn(),
        setContext: vi.fn(),
      });
    }),
  };
});

vi.mock("@sentry/node", () => ({
  init: sentryMocks.init,
  captureException: sentryMocks.captureException,
  expressIntegration: sentryMocks.expressIntegration,
  withScope: sentryMocks.withScope,
}));

// Import AFTER the mock so the module under test picks up the mock.
import {
  initSentry,
  captureExceptionFromRequest,
  isSentryEnabled,
  __resetSentryForTests,
} from "../../observability/sentry";

function makeReq(overrides: Partial<Request> = {}): Request {
  return {
    method: "GET",
    path: "/api/things/42",
    originalUrl: "/api/things/42?x=1",
    url: "/api/things/42?x=1",
    query: { x: "1" },
    headers: { "user-agent": "vitest" },
    ...overrides,
  } as unknown as Request;
}

describe("server/observability/sentry", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;
  let errSpy: ReturnType<typeof vi.spyOn>;
  const originalDsn = process.env.SENTRY_DSN;
  const originalEnv = process.env.NODE_ENV;
  const originalRelease = process.env.FLY_IMAGE_REF;

  beforeEach(() => {
    sentryMocks.init.mockClear();
    sentryMocks.captureException.mockClear();
    sentryMocks.expressIntegration.mockClear();
    sentryMocks.withScope.mockClear();
    __resetSentryForTests();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    errSpy.mockRestore();
    if (originalDsn === undefined) delete process.env.SENTRY_DSN;
    else process.env.SENTRY_DSN = originalDsn;
    if (originalEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalEnv;
    if (originalRelease === undefined) delete process.env.FLY_IMAGE_REF;
    else process.env.FLY_IMAGE_REF = originalRelease;
  });

  describe("initSentry", () => {
    it("is a no-op and logs the disabled line when SENTRY_DSN is unset", () => {
      delete process.env.SENTRY_DSN;

      initSentry();

      expect(sentryMocks.init).not.toHaveBeenCalled();
      expect(isSentryEnabled()).toBe(false);
      expect(logSpy).toHaveBeenCalledWith("[sentry] disabled (no DSN)");
    });

    it("initialises with DSN, env, and tracesSampleRate=1.0 in development", () => {
      process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
      process.env.NODE_ENV = "development";
      delete process.env.FLY_IMAGE_REF;

      initSentry();

      expect(sentryMocks.init).toHaveBeenCalledTimes(1);
      const opts = sentryMocks.init.mock.calls[0]![0];
      expect(opts.dsn).toBe("https://public@example.ingest.sentry.io/1");
      expect(opts.environment).toBe("development");
      expect(opts.tracesSampleRate).toBe(1.0);
      expect(opts.integrations).toBeDefined();
      expect(sentryMocks.expressIntegration).toHaveBeenCalled();
      expect(isSentryEnabled()).toBe(true);
    });

    it("uses tracesSampleRate=0.1 and FLY_IMAGE_REF as release in production", () => {
      process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
      process.env.NODE_ENV = "production";
      process.env.FLY_IMAGE_REF = "registry.fly.io/arf-map:deployment-abc";

      initSentry();

      const opts = sentryMocks.init.mock.calls[0]![0];
      expect(opts.tracesSampleRate).toBe(0.1);
      expect(opts.environment).toBe("production");
      expect(opts.release).toBe("registry.fly.io/arf-map:deployment-abc");
    });

    it("is idempotent — a second init() call does not re-invoke Sentry.init", () => {
      process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1";

      initSentry();
      initSentry();
      initSentry();

      expect(sentryMocks.init).toHaveBeenCalledTimes(1);
    });
  });

  describe("captureExceptionFromRequest", () => {
    it("is a silent no-op when Sentry is disabled", () => {
      delete process.env.SENTRY_DSN;
      initSentry(); // disabled path

      const err = new Error("boom");
      const req = makeReq();

      captureExceptionFromRequest(err, req);

      expect(sentryMocks.withScope).not.toHaveBeenCalled();
      expect(sentryMocks.captureException).not.toHaveBeenCalled();
    });

    it("forwards the error to Sentry with request context when enabled", () => {
      process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
      initSentry();

      const err = new Error("kaboom");
      const req = makeReq();

      captureExceptionFromRequest(err, req);

      expect(sentryMocks.withScope).toHaveBeenCalledTimes(1);
      expect(sentryMocks.captureException).toHaveBeenCalledTimes(1);
      expect(sentryMocks.captureException).toHaveBeenCalledWith(err);
    });

    it("swallows Sentry SDK errors so the error path still completes", () => {
      process.env.SENTRY_DSN = "https://public@example.ingest.sentry.io/1";
      initSentry();

      sentryMocks.withScope.mockImplementationOnce(() => {
        throw new Error("sentry SDK exploded");
      });

      const err = new Error("upstream");
      const req = makeReq();

      // Must NOT throw.
      expect(() => captureExceptionFromRequest(err, req)).not.toThrow();
      expect(errSpy).toHaveBeenCalled();
    });
  });
});
