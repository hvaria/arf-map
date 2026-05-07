# Notes module — Slice 2 manual runbook

Slice 2 unifies the two Notes surfaces (bell drawer + dedicated page),
gates the dedicated page behind a beta feature flag, and adds lightweight
client-side telemetry. Backend untouched.

## 0. Prerequisites

- A working dev server: `npm run dev` (port 5000).
- Two facility-portal accounts:
  1. A regular `facility_admin` (or any non-`super_admin`) account.
  2. A `super_admin` account (one already exists in seed data).
- The ability to set `VITE_NOTES_DEDICATED_PAGE_FACILITIES` in the project
  root `.env` and **restart** the dev server so Vite picks up the change.
- Browser DevTools open (Network + Console tabs).
- A known facility number with at least 2 open notes (one urgent), so the
  bell badge has something to render and the descriptor flips correctly.

> Slice 1 runbook lives at `docs/qa/notes-slice1-runbook.md`. Do **not**
> modify it — the steps there must still pass after Slice 2 ships.

## 1. Header parity (drawer ↔ page)

The two surfaces must render visually identical chrome.

1. Log in as the regular facility account.
2. From `#/facility-portal`, click the bell (`MessageSquare`) icon in the
   header → drawer opens.
3. Inspect the drawer header element with DevTools. Verify:
   - Background is `linear-gradient(120deg, #EEF2FF 0%, #FFF0F6 100%)`.
   - Border-bottom color is `#E0E7FF`.
   - Icon color (the `MessageSquare`) is `#818CF8`.
   - Heading reads exactly **"Team notes"** in `#1E1B4B`.
   - Sub-line is **"Shift handoffs, memos, and follow-ups"** when no
     urgent notes exist; otherwise **"{n} urgent · awaiting acknowledgement"**.
4. With the `VITE_NOTES_DEDICATED_PAGE_FACILITIES` env var set so the
   dedicated page is reachable (see §3), navigate to
   `#/facility-portal/notes` and inspect the page identity header at the
   top. Verify the same four tokens and the same heading text. The
   page variant additionally appends `· Facility #{facilityNumber}` as
   muted `text-xs`.

PASS criteria: gradient/border/icon/heading byte-identical between
surfaces; descriptor text identical; only the facility-number suffix
differs.

## 2. Beta flag — OFF by default

1. Ensure `.env` does **not** define `VITE_NOTES_DEDICATED_PAGE_FACILITIES`
   (or sets it to empty). Restart `npm run dev`.
2. Log in as the regular facility account.
3. Manually navigate to `#/facility-portal/notes`.
4. Expected: the page briefly shows nothing, then redirects to
   `#/facility-portal`.
5. Open the bell drawer. Expected: **no** "Open full view →" link in the
   identity header rightSlot.

## 3. Beta flag — ON via env allowlist

1. In `.env`, set:
   ```
   VITE_NOTES_DEDICATED_PAGE_FACILITIES=197600123
   ```
   (substitute your test facility number). Restart the dev server.
2. Log in as a user whose `facilityNumber` matches.
3. Navigate to `#/facility-portal/notes`. Expected: page renders.
4. Open the bell drawer from the portal header. Expected: the "Open full
   view →" anchor appears in the identity header's rightSlot.
5. Now set the env var to a CSV that does **not** contain your facility
   (e.g. `999999999`), restart, and re-attempt step 3 — expect a redirect
   back to `#/facility-portal`.

## 4. Beta flag — super_admin override

1. Clear `VITE_NOTES_DEDICATED_PAGE_FACILITIES` from `.env` and restart.
2. Log in as the `super_admin` account.
3. Navigate to `#/facility-portal/notes`. Expected: page renders even
   without an allowlist entry.
4. Open the bell drawer — the "Open full view →" link must be present.

## 5. Drawer → Page deep-link

1. Make sure the flag is ON (either via §3 or §4).
2. Open the bell drawer from `#/facility-portal`.
3. Type `fall` into the drawer's search box. Wait for the 250 ms debounce
   to fire.
4. Click the **Residents** group chip.
5. Toggle **Show archived** ON.
6. Click **"Open full view →"** in the drawer's identity header.
7. Expected URL after navigation:
   `#/facility-portal/notes?group=residents&q=fall&archived=1`
8. The dedicated page should mount with that filter state already
   applied (Residents tab active, search input pre-filled, archived
   chip on).
9. Repeat with no filters set → URL should be `#/facility-portal/notes`
   (no query string).

## 6. Page → Drawer round-trip

1. From the dedicated `#/facility-portal/notes` page, click the
   **"Quick triage drawer"** ghost button in the identity header
   rightSlot.
2. Expected:
   - Route changes to `#/facility-portal`.
   - The bell drawer pops open immediately (synthetic
     `arf:open-notes` event).
   - The drawer's filter state is **reset** to the defaults
     (group=all, no search, archived off). Filter context is
     intentionally **not** preserved in this direction — the
     drawer is for quick triage, the page is for deep work.
3. Press the browser back button — you should return to the dedicated
   page (filter state restored from URL).

## 7. Telemetry payload inspection

1. Open DevTools → Network tab. Filter on `/api/telemetry/event`.
2. Open the bell drawer. Verify a POST is sent with body shape:
   ```
   {
     "event": "notes.surface.opened",
     "props": { "surface": "drawer", "facilityNumber": "..." },
     "timestamp": <number>
   }
   ```
3. Click a note's "Reply" toggle to expand it. Verify a POST with
   `event: "notes.note.viewed"`, `props.surface: "drawer"`, and the
   note id.
4. Click the same note's **Ack** button. Verify a POST with
   `event: "notes.note.acked"` and the same note id.
5. Repeat 2–4 from the dedicated page (`#/facility-portal/notes`).
   The `surface` prop should be `"page"` for all three.
6. **PII check**: inspect the JSON body of each request. The body must
   **never** contain: `body` text, `title`, `authorDisplayName`,
   raw search query string, tag values, reply text, or resident name.
   Allowed: numeric ids, group enum, facility number, surface enum,
   timestamp.

## 8. Telemetry resilience — 404 swallowed silently

The endpoint `/api/telemetry/event` does **not** exist server-side yet.
Slice 2 ships only the client.

1. Open DevTools → Console.
2. Reload the portal.
3. Open the bell drawer once. Expected: a single
   `[telemetry] endpoint not deployed yet, dropping events` debug line.
4. Open the drawer again, click around, fire more events. Expected:
   no further "endpoint not deployed" lines. The dev-only
   `[telemetry] {…}` shape logs may continue to appear (those are
   the per-event payload echoes, intentional in dev).
5. Network tab should show 404s for each POST, but **no** uncaught
   errors anywhere.

## 9. Slice 1 non-regression smoke test

Re-run a representative sample of Slice 1 runbook steps:

- Compose a note from inside the bell drawer; verify it appears in the
  feed without a page reload.
- From `#/facility-portal/notes`, click a note → detail pane shows the
  full thread; reply → reply appears immediately.
- Click "Acknowledge" on a note in the dedicated page → button flips
  to "Acked" optimistically; switching to a different note must NOT
  carry the acked state (Slice 1 Blocker 2 fix).
- Stale-selection clear: select a note, then change the group filter
  such that the selection is no longer in the list → detail pane
  clears once the list query settles (Slice 1 High 2 fix).

If any of these regress, stop — do not ship Slice 2 until parity is
restored.

## Definition of done

- All ten sections above pass on the regular account and (for §4) the
  super_admin account.
- All client tests green (`npm run test:client`).
- `npm run check` clean.
- No new console errors in dev or production builds.
