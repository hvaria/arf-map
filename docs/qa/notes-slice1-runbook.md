# Notes Slice 1 — Manual Test Runbook

Manual reproduction steps for the dedicated split-pane Notes page introduced
in Slice 1 of the Notes module redesign. Pair with the automated tests under
`client/src/__tests__/useNotesUrlState.test.tsx`,
`client/src/__tests__/NotesListPane.test.tsx`,
`client/src/__tests__/NoteDetailPane.test.tsx`, and
`client/src/__tests__/NotesPage.test.tsx`.

## Prerequisites

- `npm run dev` running on port 5000.
- Logged in to a facility account that has at least:
  - 1 staff note (category `general` or `shift_handoff`)
  - 1 resident note (category `resident_update` etc.) with a real
    `residentId`
  - 1 archived note in either group
  - 1 note that has at least one reply
- Modern desktop browser (Chrome / Edge / Firefox) with DevTools available.
- Window resizing freedom (≥1280px wide preferred, with ability to shrink).

Whenever a step references a URL it is a hash route — paste it into the
address bar after the existing `http://localhost:5000/` prefix, e.g.
`http://localhost:5000/#/facility-portal/notes`.

---

## 1 — Desktop split layout (≥1024px)

- **Setup**: Resize the window to ≥1280px wide. Visit `#/facility-portal/notes`.
- **Action**: Observe the page chrome.
- **Expected**:
  - Top bar shows "Back to portal", page title "Notes", facility crumb.
  - Toolbar row: search input, "Show archived" toggle, "New note" button.
  - Group tabs row: All · Residents · Staff · Internal Memos · Providers.
  - Below: split pane with the **list on the left**, **detail on the right**,
    detail showing "Select a note to read" empty state with the
    `data-testid="notes-empty-no-selection"` element visible.

## 2 — Drag-resize splitter (desktop only)

- **Setup**: Start at `#/facility-portal/notes` on a ≥1280px window.
- **Action**:
  1. Find the vertical splitter (`data-testid="notes-splitter"` between
     list and detail). Drag it to the right by ~150px.
  2. Refresh the page.
  3. Drag the splitter as far right as possible.
  4. Drag the splitter as far left as possible.
- **Expected**:
  - 1: List-pane width visibly grows; detail pane shrinks. No layout jump.
  - 2: Width remains the value chosen in step 1 (persistence across reload).
  - 3: Width clamps at 640px; further drag has no effect.
  - 4: Width clamps at 280px; further drag has no effect.

## 3 — Selection persistence in URL (validates Blocker 1)

- **Setup**: `#/facility-portal/notes`, no note selected.
- **Action**:
  1. Click any note row in the list.
  2. Look at the URL hash.
  3. Refresh the page (F5).
  4. Press the browser **Back** button.
  5. Press the browser **Forward** button.
- **Expected**:
  - 2: URL gains `?noteId=<id>` (e.g. `#/facility-portal/notes?noteId=42`).
    The note's title and body render in the detail pane.
  - 3: Same note is still selected after reload (URL preserved).
  - 4: Detail pane reverts to "Select a note to read"; URL drops `noteId`.
  - 5: Returns to the previously selected note; URL re-adds `noteId`.

## 4 — Group switch with stale `noteId`

- **Setup**: `#/facility-portal/notes`, click a Residents-group note so URL
  is `?group=residents&noteId=<R>`.
- **Action**: Click the **Staff** tab.
- **Expected**:
  - URL becomes `?group=staff&noteId=<R>` first (synchronous group switch).
  - As the staff list query settles and `<R>` is not in it, `noteId` is
    cleared automatically and the detail pane returns to the empty state.
  - URL ends as `?group=staff` (no noteId).
  - **Negative**: while the staff list is still fetching, the noteId must
    NOT be cleared early — the list pane gates the clear on settled state.

## 5 — Search debounce + URL replace

- **Setup**: `#/facility-portal/notes`. Open DevTools → Network tab and
  enable "Preserve log".
- **Action**:
  1. Click into the search input (`data-testid="notes-search"`) and type
     `f-a-l-l` (one keystroke at a time, all within ~1 second).
  2. After typing settles (>250ms), look at URL and history length.
  3. Press browser Back once.
- **Expected**:
  - 2: URL updates **once** to `?q=fall` (~250ms after the last keystroke);
    list refetches with the search term.
  - 3: Pressing Back does **not** replay each keystroke in turn. You should
    land on the pre-search state (or wherever you were before typing). If
    Back replays each character, the debounce/replaceState wiring is
    broken.
  - The Network tab should show ONE `/api/ops/notes?…&q=fall` request,
    not four.

## 6 — Show archived toggle

- **Setup**: `#/facility-portal/notes`, list visible.
- **Action**:
  1. Click the "Show archived" toggle
     (`data-testid="notes-archived-toggle"`).
  2. Toggle it off again.
- **Expected**:
  - 1: URL gains `archived=1`. Archived rows appear inline (visibly dimmed
     with an "Archived" badge). Network tab shows the list URL include
     `status=open,archived`.
  - 2: URL drops the `archived` param. Archived rows hide again. List URL
    reverts to `status=open`.

## 7 — Hover prefetch

- **Setup**: `#/facility-portal/notes`, no note selected. Open DevTools →
  Network tab and filter for `/api/ops/notes/`.
- **Action**: Hover over a list row and hold the cursor for ~300ms (do
  **not** click).
- **Expected**: A `GET /api/ops/notes/<id>` request fires after ~200ms.
  Move the cursor away before 200ms elapses → no request fires (cancels).

## 8 — Ack across notes (validates Blocker 2)

- **Setup**: `#/facility-portal/notes`. Identify two open notes A and B
  that you have NOT acked. Currently neither's detail pane should show
  "Acked".
- **Action**:
  1. Click note A. Click the "Ack" button.
  2. Without refreshing, click note B in the list.
- **Expected**:
  - 1: Button immediately switches to "Acked" (green text), disabled.
    Network shows `POST /api/ops/notes/<A>/ack`.
  - 2: Detail pane swaps to note B. The Ack button on note B reads "Ack"
    (NOT "Acked"), is enabled, and is the default style. If it shows
    "Acked", optimistic state has leaked across notes — bug.

## 9 — Fast-typing mid-fetch selection retention (validates High 2)

- **Setup**: `#/facility-portal/notes`. Throttle the network in DevTools to
  "Slow 3G" so list queries take ~1–2s.
- **Action**:
  1. Click into the search input. Type a query that will return at least
     one result (e.g. `fall`).
  2. Before the list response returns, click on a row that you can see
     while the query is in-flight (e.g. one already rendered from the
     pre-search results, or one rendered partway through).
- **Expected**: After the search response settles, the row you clicked
  remains selected (highlighted; URL still has `noteId=<your-click>`).
  The selection is NOT cleared by the in-flight refetch resolving with
  stale items. (If the row is genuinely missing from the new search
  results, only THEN should the gate fire and clear selection.)

## 10 — Reply does NOT refetch the list (validates High 1)

- **Setup**: `#/facility-portal/notes?noteId=<N>` where N has at least 0–1
  replies. Open DevTools → Network → filter on `/api/ops/notes`.
  Clear the network log.
- **Action**:
  1. In the detail pane, type a short message into the inline reply box.
  2. Click "Send".
- **Expected**:
  - **One** new `POST /api/ops/notes/<N>/replies` request.
  - **One** new `GET /api/ops/notes/<N>` request (parent detail refetched).
  - **NO** new `GET /api/ops/notes?status=open&limit=50&…` request (the
    list query must NOT be invalidated by the reply).
  - If a list refetch fires, the High 1 fix has regressed.

## 11 — Tablet (768–1023px)

- **Setup**: Resize window to ~900px wide. Visit `#/facility-portal/notes`.
- **Action**: Observe layout.
- **Expected**:
  - Stacked layout: list pane on top, detail pane below.
  - **No splitter** rendered (no `data-testid="notes-splitter"` element).
  - Toolbar and tabs still visible at top.

## 12 — Mobile (<768px)

- **Setup**: Resize window to ~400px wide (or use DevTools device emulation
  for an iPhone 12). Visit `#/facility-portal/notes`.
- **Action**:
  1. Observe initial state.
  2. Tap a list row.
  3. Tap the back chevron in the detail header.
  4. Tap a row again. Press the browser Back button (don't tap the chevron).
- **Expected**:
  - 1: List visible, detail not shown.
  - 2: List replaced by the note detail. A back chevron appears in the
    detail header (left side of the title row).
  - 3: List re-appears; URL drops `noteId`.
  - 4: Browser Back also returns to the list (URL drops `noteId`).

## 13 — OperationsTab regression

- **Setup**: `#/facility-portal` → click "Operations" tab.
- **Action**:
  1. Verify the embedded Notes feed is visible at the bottom of the
     Operations overview.
  2. Post a new top-level note via the embedded composer.
  3. Click an existing note to expand and post a reply.
  4. Click the kebab menu on a note → archive → unarchive.
  5. Click the kebab → delete (confirm the dialog).
  6. Trigger the bell drawer by dispatching `window.dispatchEvent(new
     Event("arf:open-notes"))` from the DevTools console (or wherever the
     bell icon lives in the topbar).
  7. Click the **"View all notes →"** link in the embedded feed.
- **Expected**:
  - 1: Feed renders without errors.
  - 2: New note appears at the top of the embedded feed.
  - 3: Reply posts; reply count increments.
  - 4: Archive toggles correctly; unarchive returns to open.
  - 5: Confirmation dialog → note disappears from the feed.
  - 6: Bell drawer opens (no console errors).
  - 7: Browser navigates to `#/facility-portal/notes`. Header shows
    "Notes" and the dedicated split-pane page renders.

## 14 — Deep link

- **Setup**: Make sure you have a real, non-archived resident note's id.
  Substitute it in for `<id>` below.
- **Action**: Paste this URL into a fresh tab (still logged in):
  ```
  http://localhost:5000/#/facility-portal/notes?group=residents&noteId=<id>&q=walker&archived=1
  ```
- **Expected**:
  - Residents tab is active (highlighted).
  - Search input shows `walker`.
  - "Show archived" toggle is on.
  - The note matching `<id>` is selected and rendered in the detail pane
    (or, if `<id>` is invalid for the residents+archived+`q=walker`
    filter, the noteId is cleared from the URL once the list settles —
    expected per scenario 4).

## 15 — Auth gate

- **Setup**: Log out (or open a fresh incognito window).
- **Action**: Paste `http://localhost:5000/#/facility-portal/notes` into
  the address bar and load it.
- **Expected**: Briefly shows a "Loading…" placeholder, then redirects to
  `#/facility-portal` (the login screen). The URL hash should change to
  `#/facility-portal`.

---

## Sign-off checklist

- [ ] Steps 1–15 all pass.
- [ ] No console errors in any scenario.
- [ ] No unexpected list-query refetches in scenarios 8 and 10.
- [ ] Browser Back / Forward behaves intuitively across scenarios 3, 4, 12.
