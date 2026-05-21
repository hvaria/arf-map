/**
 * Telemetry shim — fire-and-forget POST to `/api/telemetry/event`.
 *
 * Slice 2 of the Notes module ships the client-side surface only. The
 * server endpoint (`/api/telemetry/event`) does NOT yet exist; the first
 * 404 logs a single `console.debug`, subsequent 404s are silent.
 *
 * Constraints (architect-mandated):
 *   - No batching, no retries, no localStorage, no third-party SDK.
 *   - Always include `credentials: "include"`.
 *   - `keepalive: true` so events survive a same-tick navigation.
 *   - In dev, also `console.debug` the payload so devs can verify shape.
 *   - PII rules are enforced at call sites — this shim never inspects props.
 *
 * Allowed events (typed enum) — see the architect's payload table:
 *   - notes.surface.opened
 *   - notes.note.viewed
 *   - notes.note.acked
 */
import { getCsrfToken } from "./csrfToken";

export type NotesSurface = "drawer" | "page";

export type TelemetryEvent =
  | "notes.surface.opened"
  | "notes.note.viewed"
  | "notes.note.acked";

interface TelemetryPayload {
  event: TelemetryEvent;
  props: Record<string, unknown>;
  timestamp: number;
}

let warned404 = false;

export function track(
  event: TelemetryEvent,
  props: Record<string, unknown>,
): void {
  const payload: TelemetryPayload = {
    event,
    props,
    timestamp: Date.now(),
  };

  if (import.meta.env.DEV) {
    // Dev-only console line so engineers can verify event shape in the
    // browser without standing up the server endpoint.
    // eslint-disable-next-line no-console
    console.debug("[telemetry]", payload);
  }

  // Fire-and-forget. We DO inspect the response so we can log a single
  // helpful debug line on the first 404 (endpoint not yet deployed).
  // CSRF headers are added inline (without retry) so a missing token just
  // gets a quiet 403 — same fail-soft behavior as the 404 path above.
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "X-Requested-With": "XMLHttpRequest",
    };
    const csrf = getCsrfToken();
    if (csrf) headers["X-CSRF-Token"] = csrf;
    fetch("/api/telemetry/event", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify(payload),
      keepalive: true,
    })
      .then((res) => {
        if (!res.ok && res.status === 404 && !warned404) {
          warned404 = true;
          // eslint-disable-next-line no-console
          console.debug(
            "[telemetry] endpoint not deployed yet, dropping events",
          );
        }
      })
      .catch(() => {
        // Network error — silently swallow. Telemetry must never break UX.
      });
  } catch {
    // fetch() itself threw (very rare; defensive). Swallow.
  }
}

/**
 * Test-only reset. Clears module-private state so the "first 404 warns"
 * assertion can be exercised independently across test cases.
 *
 * Not exported from a barrel; tests import it directly.
 */
export function __resetTelemetryForTests(): void {
  warned404 = false;
}
