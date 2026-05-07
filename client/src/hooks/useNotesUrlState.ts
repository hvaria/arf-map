/**
 * useNotesUrlState — hash-aware URL state for the dedicated Notes page.
 *
 * The app uses wouter's `useHashLocation`, so the canonical URL shape is
 *   #/facility-portal/notes?group=residents&noteId=12&q=fall&archived=1
 *
 * We parse the substring after the first `?` of `window.location.hash`,
 * mirroring the precedent in `OpsCalendar.tsx` (readFilterFromUrl /
 * writeFilterToUrl, lines 1068-1090). Reads subscribe to `hashchange` via
 * `useSyncExternalStore` so multiple consumers stay in lock-step.
 *
 * Writes go directly through `window.history.{push,replace}State` plus a
 * manual `hashchange` event — the same technique used by OpsCalendar. We do
 * NOT use wouter's `navigate()` here because its hash-location implementation
 * splits on `?` and assigns the query string to `location.search` rather
 * than keeping it inside the hash, which would silently drop our params.
 *
 * Defaults are omitted from the URL so the canonical "All / open" shape stays
 * minimal. `setNoteId(null)` removes the param entirely.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { GroupKey, ArchivedFlag } from "@/components/notes/shared";

export interface NotesUrlState {
  group: GroupKey;
  noteId: number | null;
  q: string;
  archived: ArchivedFlag;
}

export interface NotesUrlStateApi extends NotesUrlState {
  setGroup: (g: GroupKey) => void;
  setNoteId: (id: number | null) => void;
  setSearch: (q: string) => void;
  setArchived: (a: ArchivedFlag) => void;
  patch: (p: Partial<NotesUrlState>) => void;
}

const VALID_GROUPS: GroupKey[] = [
  "all",
  "residents",
  "staff",
  "memos",
  "providers",
];

const Q_MAX_LEN = 200;

function getHash(): string {
  if (typeof window === "undefined") return "";
  return window.location.hash;
}

function parseHashState(hash: string): NotesUrlState {
  const qIdx = hash.indexOf("?");
  if (qIdx === -1) {
    return { group: "all", noteId: null, q: "", archived: 0 };
  }
  const params = new URLSearchParams(hash.slice(qIdx + 1));

  const rawGroup = params.get("group");
  const group: GroupKey = VALID_GROUPS.includes(rawGroup as GroupKey)
    ? (rawGroup as GroupKey)
    : "all";

  const rawNoteId = params.get("noteId");
  let noteId: number | null = null;
  if (rawNoteId !== null) {
    const n = Number(rawNoteId);
    if (Number.isFinite(n) && Number.isInteger(n) && n > 0) noteId = n;
  }

  const rawQ = params.get("q") ?? "";
  const q = rawQ.slice(0, Q_MAX_LEN);

  const rawArchived = params.get("archived");
  const archived: ArchivedFlag = rawArchived === "1" ? 1 : 0;

  return { group, noteId, q, archived };
}

// ── External store: tracks `window.location.hash` so React re-renders on
//    hashchange (back/forward, programmatic navigation, manual edits).
function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("hashchange", callback);
  return () => window.removeEventListener("hashchange", callback);
}

function getSnapshot(): string {
  return getHash();
}

function getServerSnapshot(): string {
  return "";
}

// Build a query string from a state snapshot, omitting defaults.
function buildQueryString(state: NotesUrlState): string {
  const params = new URLSearchParams();
  if (state.group !== "all") params.set("group", state.group);
  if (state.noteId !== null) params.set("noteId", String(state.noteId));
  if (state.q) params.set("q", state.q);
  if (state.archived === 1) params.set("archived", "1");
  return params.toString();
}

// Write the next state to the URL via window.history (matches the
// OpsCalendar pattern). We then dispatch a synthetic `hashchange` event so
// wouter's hash-location hook AND our `useSyncExternalStore` subscription
// both see the change immediately.
function writeHashState(next: NotesUrlState, opts?: { replace?: boolean }) {
  if (typeof window === "undefined") return;
  const currentHash = window.location.hash;
  const qIdx = currentHash.indexOf("?");
  // Path portion of the hash, including the leading "#". If the hash is
  // empty (shouldn't happen on this page but be defensive), fall back to
  // the canonical Notes path.
  const hashPath =
    (qIdx === -1 ? currentHash : currentHash.slice(0, qIdx)) ||
    "#/facility-portal/notes";
  const qs = buildQueryString(next);
  const nextHash = qs ? `${hashPath}?${qs}` : hashPath;
  if (nextHash === currentHash) return;
  const oldURL = window.location.href;
  const nextUrl = `${window.location.pathname}${window.location.search}${nextHash}`;
  if (opts?.replace) {
    window.history.replaceState(null, "", nextUrl);
  } else {
    window.history.pushState(null, "", nextUrl);
  }
  const newURL = window.location.href;
  // Dispatch a synthetic hashchange so wouter's hash-location hook AND our
  // own `useSyncExternalStore` subscription both pick up the change.
  const event =
    typeof HashChangeEvent !== "undefined"
      ? new HashChangeEvent("hashchange", { oldURL, newURL })
      : new Event("hashchange");
  window.dispatchEvent(event);
}

export function useNotesUrlState(): NotesUrlStateApi {
  const hash = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const state = parseHashState(hash);

  const patch = useCallback(
    (p: Partial<NotesUrlState>, opts?: { replace?: boolean }) => {
      // Read live hash so consecutive synchronous patches accumulate.
      // (pushState/replaceState update window.location.hash synchronously,
      //  so the second call sees the first call's write — even though our
      //  React `state` snapshot is one render behind.)
      const current = parseHashState(getHash());
      const next: NotesUrlState = {
        group: p.group ?? current.group,
        noteId: p.noteId !== undefined ? p.noteId : current.noteId,
        q: p.q !== undefined ? p.q : current.q,
        archived: p.archived !== undefined ? p.archived : current.archived,
      };
      writeHashState(next, opts);
    },
    [],
  );

  const setGroup = useCallback(
    (g: GroupKey) => {
      // Switching groups may drop noteId later (handled by the list pane
      // when the query settles). Don't replace — group changes belong in
      // history.
      patch({ group: g });
    },
    [patch],
  );

  const setNoteId = useCallback(
    (id: number | null) => {
      // Selection should be a real history entry so Back works.
      patch({ noteId: id });
    },
    [patch],
  );

  const setSearch = useCallback(
    (q: string) => {
      // Debounced search uses replace so we don't pollute history with every
      // keystroke. Caller is responsible for the debounce timer.
      patch({ q }, { replace: true });
    },
    [patch],
  );

  const setArchived = useCallback(
    (a: ArchivedFlag) => {
      patch({ archived: a });
    },
    [patch],
  );

  return {
    ...state,
    setGroup,
    setNoteId,
    setSearch,
    setArchived,
    patch,
  };
}
