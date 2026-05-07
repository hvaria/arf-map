/**
 * telemetry shim tests.
 *
 * Covers:
 *   - track() POSTs to /api/telemetry/event with the documented body shape.
 *   - In dev (default test env) the payload is also console.debug'd.
 *   - First 404 logs a single "endpoint not deployed" debug line.
 *   - Subsequent 404s do not log additional warnings (warned404 latch).
 *   - Network rejection from fetch() is swallowed (does not throw).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

import { track, __resetTelemetryForTests } from "../lib/telemetry";

const originalFetch = globalThis.fetch;

beforeEach(() => {
  __resetTelemetryForTests();
  vi.restoreAllMocks();
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("track()", () => {
  it("POSTs to /api/telemetry/event with the expected body shape", async () => {
    const fetchSpy = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify({ ok: true }), { status: 200 }),
      ),
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    track("notes.surface.opened", { surface: "drawer", facilityNumber: "F1" });

    // The shim is fire-and-forget; allow the microtask queue to run.
    await Promise.resolve();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/telemetry/event");
    expect(init.method).toBe("POST");
    expect(init.credentials).toBe("include");
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe(
      "application/json",
    );
    expect(init.keepalive).toBe(true);

    const body = JSON.parse(init.body as string);
    expect(body.event).toBe("notes.surface.opened");
    expect(body.props).toEqual({ surface: "drawer", facilityNumber: "F1" });
    expect(typeof body.timestamp).toBe("number");
  });

  it("logs the payload via console.debug in dev", () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("{}", { status: 200 })),
    ) as unknown as typeof fetch;

    track("notes.note.viewed", { surface: "page", noteId: 7 });

    // First call should be the dev payload log.
    expect(debugSpy).toHaveBeenCalled();
    const firstCall = debugSpy.mock.calls[0];
    expect(firstCall[0]).toBe("[telemetry]");
    const payload = firstCall[1] as { event: string; props: { noteId: number } };
    expect(payload.event).toBe("notes.note.viewed");
    expect(payload.props.noteId).toBe(7);
  });

  it("logs a single 'endpoint not deployed' debug line on the first 404, and stays silent thereafter", async () => {
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
    globalThis.fetch = vi.fn(() =>
      Promise.resolve(new Response("not found", { status: 404 })),
    ) as unknown as typeof fetch;

    track("notes.note.acked", { surface: "page", noteId: 1 });
    // Wait for the .then handler to run.
    await new Promise((r) => setTimeout(r, 0));

    track("notes.note.acked", { surface: "page", noteId: 2 });
    await new Promise((r) => setTimeout(r, 0));

    track("notes.note.acked", { surface: "page", noteId: 3 });
    await new Promise((r) => setTimeout(r, 0));

    // The "endpoint not deployed yet" line is the only one we care about.
    const notDeployedCalls = debugSpy.mock.calls.filter(
      (args) =>
        typeof args[0] === "string" &&
        (args[0] as string).includes("endpoint not deployed"),
    );
    expect(notDeployedCalls).toHaveLength(1);
  });

  it("swallows network rejections without throwing", () => {
    globalThis.fetch = vi.fn(() =>
      Promise.reject(new Error("offline")),
    ) as unknown as typeof fetch;

    expect(() =>
      track("notes.surface.opened", { surface: "drawer", facilityNumber: "F1" }),
    ).not.toThrow();
  });
});
