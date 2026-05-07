/**
 * buildDedicatedPageUrl tests.
 *
 * The drawer "Open full view →" link uses this builder to deep-link into
 * the dedicated /facility-portal/notes page, preserving the active filter
 * state (group + search + archived). Defaults are omitted from the
 * query string so the canonical "All / open" shape stays minimal.
 */
import { describe, it, expect } from "vitest";

import { buildDedicatedPageUrl } from "../components/operations/NotesNotificationButton";

describe("buildDedicatedPageUrl", () => {
  it("omits all params when state is the default (all / open / no search)", () => {
    expect(
      buildDedicatedPageUrl({ group: "all", q: "", archived: false }),
    ).toBe("#/facility-portal/notes");
  });

  it("encodes only the group when only the group is non-default", () => {
    expect(
      buildDedicatedPageUrl({ group: "residents", q: "", archived: false }),
    ).toBe("#/facility-portal/notes?group=residents");
  });

  it("encodes only the search query when only q is set", () => {
    expect(
      buildDedicatedPageUrl({ group: "all", q: "fall", archived: false }),
    ).toBe("#/facility-portal/notes?q=fall");
  });

  it("encodes only archived=1 when only archived is set", () => {
    expect(
      buildDedicatedPageUrl({ group: "all", q: "", archived: true }),
    ).toBe("#/facility-portal/notes?archived=1");
  });

  it("combines all three params when all are set", () => {
    const out = buildDedicatedPageUrl({
      group: "memos",
      q: "policy",
      archived: true,
    });
    // Param order is fixed by URLSearchParams insertion order: group, q, archived.
    expect(out).toBe(
      "#/facility-portal/notes?group=memos&q=policy&archived=1",
    );
  });

  it("URL-encodes special characters in the search query", () => {
    const out = buildDedicatedPageUrl({
      group: "all",
      q: "fall & risk",
      archived: false,
    });
    expect(out).toBe("#/facility-portal/notes?q=fall+%26+risk");
  });
});
