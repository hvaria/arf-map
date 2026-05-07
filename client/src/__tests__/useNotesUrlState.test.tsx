/**
 * Unit tests for the `useNotesUrlState` hook used by the dedicated Notes page.
 *
 * Covers:
 *   - parseHashState defaults / coercion of invalid params
 *   - setNoteId / patch round-trip via window.history
 *   - live-hash accumulation for two synchronous patch() calls (the High-3 fix)
 *   - setSearch uses replaceState (debounced search must not pollute history)
 *   - hashchange event is dispatched after every write
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useNotesUrlState } from "../hooks/useNotesUrlState";

// We re-implement parseHashState locally for direct verification of the URL
// → state path. The hook itself uses the same algorithm.
function parseHash(hash: string) {
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) {
    return { group: "all", noteId: null, q: "", archived: 0 };
  }
  const params = new URLSearchParams(hash.slice(qIdx + 1));
  const VALID = ["all", "residents", "staff", "memos", "providers"];
  const rawGroup = params.get("group");
  const group = VALID.includes(rawGroup ?? "") ? rawGroup : "all";
  const rawNoteId = params.get("noteId");
  let noteId: number | null = null;
  if (rawNoteId !== null) {
    const n = Number(rawNoteId);
    if (Number.isFinite(n) && Number.isInteger(n) && n > 0) noteId = n;
  }
  const rawQ = params.get("q") ?? "";
  const archived = params.get("archived") === "1" ? 1 : 0;
  return { group, noteId, q: rawQ.slice(0, 200), archived };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — manage window.location.hash + history between tests so each test
// starts from a clean slate.
// ─────────────────────────────────────────────────────────────────────────────

function setHash(next: string) {
  // Use replaceState directly to avoid emitting hashchange events between tests
  // (we only want events emitted by the hook under test).
  const url = `${window.location.pathname}${window.location.search}${next}`;
  window.history.replaceState(null, "", url);
}

beforeEach(() => {
  setHash("#/facility-portal/notes");
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// A — parseHashState behavior (verified through the hook's initial state).
// ─────────────────────────────────────────────────────────────────────────────

describe("useNotesUrlState — initial parsing", () => {
  it("parses defaults when no hash query is present", () => {
    setHash("#/facility-portal/notes");
    const { result } = renderHook(() => useNotesUrlState());
    expect(result.current.group).toBe("all");
    expect(result.current.noteId).toBeNull();
    expect(result.current.q).toBe("");
    expect(result.current.archived).toBe(0);
  });

  it("parses group=residents&noteId=12&q=fall&archived=1 correctly", () => {
    setHash("#/facility-portal/notes?group=residents&noteId=12&q=fall&archived=1");
    const { result } = renderHook(() => useNotesUrlState());
    expect(result.current.group).toBe("residents");
    expect(result.current.noteId).toBe(12);
    expect(result.current.q).toBe("fall");
    expect(result.current.archived).toBe(1);
  });

  it("coerces invalid group=foo to 'all'", () => {
    setHash("#/facility-portal/notes?group=foo");
    const { result } = renderHook(() => useNotesUrlState());
    expect(result.current.group).toBe("all");
  });

  it("coerces invalid noteId=abc to null", () => {
    setHash("#/facility-portal/notes?noteId=abc");
    const { result } = renderHook(() => useNotesUrlState());
    expect(result.current.noteId).toBeNull();
  });

  it("coerces noteId=0 (non-positive) to null", () => {
    setHash("#/facility-portal/notes?noteId=0");
    const { result } = renderHook(() => useNotesUrlState());
    expect(result.current.noteId).toBeNull();
  });

  it("coerces archived=2 to 0 (only '1' is recognized)", () => {
    setHash("#/facility-portal/notes?archived=2");
    const { result } = renderHook(() => useNotesUrlState());
    expect(result.current.archived).toBe(0);
  });

  it("clamps q at 200 characters", () => {
    const long = "a".repeat(250);
    setHash(`#/facility-portal/notes?q=${long}`);
    const { result } = renderHook(() => useNotesUrlState());
    expect(result.current.q.length).toBe(200);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B — setters write through window.history correctly and subsequently parse
// back to the expected state.
// ─────────────────────────────────────────────────────────────────────────────

describe("useNotesUrlState — setters", () => {
  it("setNoteId(5) writes ?noteId=5 into the hash via pushState; parseHashState reads back noteId: 5", () => {
    setHash("#/facility-portal/notes");
    const { result } = renderHook(() => useNotesUrlState());

    const pushSpy = vi.spyOn(window.history, "pushState");

    act(() => {
      result.current.setNoteId(5);
    });

    // History was pushed (not replaced).
    expect(pushSpy).toHaveBeenCalledTimes(1);

    // The new hash carries the param.
    expect(window.location.hash).toContain("noteId=5");

    // Round-trip via parseHash matches.
    const parsed = parseHash(window.location.hash);
    expect(parsed.noteId).toBe(5);

    // Hook state also reflects the change after re-render.
    expect(result.current.noteId).toBe(5);
  });

  it("setNoteId(null) removes the param entirely", () => {
    setHash("#/facility-portal/notes?noteId=5");
    const { result } = renderHook(() => useNotesUrlState());
    expect(result.current.noteId).toBe(5);

    act(() => {
      result.current.setNoteId(null);
    });

    expect(window.location.hash).not.toContain("noteId");
    expect(result.current.noteId).toBeNull();
  });

  it("setGroup uses pushState (group switches belong in history)", () => {
    setHash("#/facility-portal/notes");
    const { result } = renderHook(() => useNotesUrlState());

    const pushSpy = vi.spyOn(window.history, "pushState");
    const replaceSpy = vi.spyOn(window.history, "replaceState");

    act(() => {
      result.current.setGroup("staff");
    });

    expect(pushSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toContain("group=staff");
  });

  it("setSearch uses replaceState (NOT pushState) — debounced search must not pollute history", () => {
    setHash("#/facility-portal/notes");
    const { result } = renderHook(() => useNotesUrlState());

    const pushSpy = vi.spyOn(window.history, "pushState");
    const replaceSpy = vi.spyOn(window.history, "replaceState");

    act(() => {
      result.current.setSearch("foo");
    });

    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(pushSpy).not.toHaveBeenCalled();
    expect(window.location.hash).toContain("q=foo");
  });

  it("setArchived(1) writes archived=1 and setArchived(0) drops the param", () => {
    setHash("#/facility-portal/notes");
    const { result } = renderHook(() => useNotesUrlState());

    act(() => {
      result.current.setArchived(1);
    });
    expect(window.location.hash).toContain("archived=1");

    act(() => {
      result.current.setArchived(0);
    });
    expect(window.location.hash).not.toContain("archived");
  });

  it("dispatches a hashchange event after every write so external subscribers see the change", () => {
    setHash("#/facility-portal/notes");
    const handler = vi.fn();
    window.addEventListener("hashchange", handler);

    const { result } = renderHook(() => useNotesUrlState());

    act(() => {
      result.current.setGroup("residents");
    });

    expect(handler).toHaveBeenCalledTimes(1);

    window.removeEventListener("hashchange", handler);
  });

  it("no-op writes do NOT dispatch a hashchange event (guards against infinite loops)", () => {
    setHash("#/facility-portal/notes?group=staff");
    const { result } = renderHook(() => useNotesUrlState());

    const handler = vi.fn();
    window.addEventListener("hashchange", handler);

    act(() => {
      // Setting the group to its current value should be a no-op.
      result.current.setGroup("staff");
    });

    expect(handler).not.toHaveBeenCalled();

    window.removeEventListener("hashchange", handler);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// C — patch() accumulation semantics. This is the High-3 fix.
//
// `patch()` reads the live window.location.hash on every call. Because
// pushState/replaceState update the hash synchronously, two patches in the
// same tick accumulate rather than clobber each other.
// ─────────────────────────────────────────────────────────────────────────────

describe("useNotesUrlState — patch() accumulation", () => {
  it("patch({ group: 'staff', noteId: null }) writes both changes in one go", () => {
    setHash("#/facility-portal/notes?group=residents&noteId=7");
    const { result } = renderHook(() => useNotesUrlState());
    expect(result.current.group).toBe("residents");
    expect(result.current.noteId).toBe(7);

    act(() => {
      result.current.patch({ group: "staff", noteId: null });
    });

    expect(window.location.hash).toContain("group=staff");
    expect(window.location.hash).not.toContain("noteId");
    expect(result.current.group).toBe("staff");
    expect(result.current.noteId).toBeNull();
  });

  it("two patch calls separated by a re-render accumulate correctly", () => {
    setHash("#/facility-portal/notes?group=residents&noteId=7&q=walker");
    const { result } = renderHook(() => useNotesUrlState());

    // First patch in its own act() so the hook re-renders before the second
    // call captures a fresh state snapshot. This is the realistic flow when
    // two patches are triggered by distinct user events.
    act(() => {
      result.current.patch({ group: "staff" });
    });

    act(() => {
      result.current.patch({ noteId: null });
    });

    const parsed = parseHash(window.location.hash);
    expect(parsed.group).toBe("staff");
    expect(parsed.noteId).toBeNull();
    expect(parsed.q).toBe("walker");
  });

  it("two patch calls in the SAME tick accumulate (live-hash read)", () => {
    setHash("#/facility-portal/notes?group=residents&noteId=7&q=walker");
    const { result } = renderHook(() => useNotesUrlState());

    act(() => {
      // Both patches run synchronously. Because patch() reads the live URL
      // hash (which pushState updates synchronously), the second call sees
      // the first call's write and merges on top of it instead of clobbering.
      result.current.patch({ group: "staff" });
      result.current.patch({ noteId: null });
    });

    const parsed = parseHash(window.location.hash);
    expect(parsed.group).toBe("staff");
    expect(parsed.noteId).toBeNull();
    expect(parsed.q).toBe("walker");
  });

  it("patch preserves unrelated params", () => {
    setHash("#/facility-portal/notes?group=residents&q=fall&archived=1");
    const { result } = renderHook(() => useNotesUrlState());

    act(() => {
      result.current.patch({ noteId: 42 });
    });

    expect(result.current.group).toBe("residents");
    expect(result.current.noteId).toBe(42);
    expect(result.current.q).toBe("fall");
    expect(result.current.archived).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// D — Hash structure invariants: the canonical path is preserved when params
// change, and writes round-trip cleanly.
// ─────────────────────────────────────────────────────────────────────────────

describe("useNotesUrlState — hash path preservation", () => {
  it("preserves the #/facility-portal/notes path when writing params", () => {
    setHash("#/facility-portal/notes");
    const { result } = renderHook(() => useNotesUrlState());

    act(() => {
      result.current.setGroup("memos");
    });

    expect(window.location.hash.startsWith("#/facility-portal/notes")).toBe(true);
  });
});
