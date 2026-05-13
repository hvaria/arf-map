# Phase 5 — Admin Validation (Pre-Build Gate)

> **Status:** DRAFT — final gate before any Epic A ticket opens.
> **Purpose:** Validate that the Wave 0 + Wave 1 design matches how a
> real CA RCFE administrator actually runs a facility and prepares
> for inspections. The simulated admin walks through every Wave 1
> surface; concerns are captured; sign-off conditions are listed so
> a *real* admin can review later and the team has a single, dated
> exit checklist.
> **Output of this phase:** either (a) "go — open Epic A tickets" or
> (b) a list of specific, sourced corrections that flow back into
> Phase 2/3/4 before tickets open.
> **Caveat:** the admin in this doc is still simulated (per Phase 0
> decision). Anything marked `[NEEDS REAL ADMIN]` must be confirmed
> with a licensed administrator before the corresponding behavior
> ships. None of the §11 BRD BLOCKING items are unblocked by this
> phase — they remain configuration in `ops_facility_settings`.

---

## 1. Methodology

The simulated admin walks each Wave 1 screen as if it were a Tuesday
morning. For each, three questions:

1. **Operational fit** — does this match the real workflow?
2. **Usability under stress** — can I use this at 2 AM during a fall
   call-out, on my phone, with one thumb?
3. **Inspection readiness** — when an inspector pulls a chair beside
   me and says "show me," does this surface help or hurt?

A four-state verdict per screen:

| Mark | Meaning |
|---|---|
| ✅ | Validated as designed |
| 🟡 | Validated with notes — non-blocking suggestions |
| 🔴 | Blocking — must change before build |
| ❔ | Needs real admin |

---

## 2. Walkthroughs

### 2.1 Wave 0 — F1 Reg Settings page

> *Admin:* "I'd never look at this page on a Tuesday morning. But
> when CCLD issues a new PIN, this is where I'd update the value.
> The `[V]` chip telling me which numbers haven't been validated is
> exactly the right level of caution — I want to know what I'm
> trusting blindly."

**Verdict:** 🟡

**Notes:**
- "Source note" field is good, but most admins won't have a tidy
  citation. Accept anything — even "told to me by licensing analyst
  Jane on 2026-05-10" is gold during inspection.
- Group the settings the way an admin thinks: not by table schema,
  but by *what an inspector would ask about*. Phase 3 already does
  this (Environment / Incident SLAs / Drills / Staff credentials /
  Retention / Postings). Keep.
- The validation flag should default OFF (`[V]` visible) and only
  flip when both `value` is changed AND `source_note` is non-empty.
  Confirmed Phase 3 §6.6 already says this. Keep.
- Add a "Last reviewed by / on" timestamp at the top of the page so
  the admin remembers when they last looked. Non-blocking; add to
  Wave 0 ticket A11.

**Pre-build action:** none. Proceed.

---

### 2.2 Wave 0 — `<AttachEvidence>` component

> *Admin:* "Photos. Photos everywhere. Inspectors love photos of the
> evacuation map on the wall, the fridge thermometer, the posted
> license. Make it stupid-easy to take a photo."

**Verdict:** ✅

**Notes:**
- Phase 3 §2.1 already prescribes mobile-first photo capture via the
  OS-native picker. Keep.
- Phase 4 §8 caps file size at 5 MB with PDF + JPEG + PNG. ✅ for
  v0. One concern from the admin: "What about a Word doc that
  someone emails me?" Document the workaround: drag-and-drop the
  Word doc into Preview / print-to-PDF first. Non-blocking.

**Pre-build action:** none.

---

### 2.3 Wave 0 — `<AuditTrailButton>` component

> *Admin:* "I never thought to want this until someone disputed a
> MAR entry. Now I want it on every single record."

**Verdict:** ✅

**Notes:**
- The slide-in panel pattern (Phase 3 §2.2) keeps the audit trail
  unobtrusive on read-heavy screens. ✅
- One ask: when an inspector is sitting next to me and the panel
  shows a long history, I want to be able to expand a single event
  to see the full before/after JSON. Phase 3 already implies this;
  call it out explicitly as a Wave 1 acceptance criterion. **See
  §6.A.4 below.**

**Pre-build action:** §6.A.4.

---

### 2.4 Wave 1 — W11 Controlled-Sub Reconciliation

> *Admin:* "Pharmacy already helps me. But when I'm doing my
> month-end review, I want to see every unresolved count without
> hunting. The aging chip (>7d amber, >30d red) is perfect — I never
> realized how often I let one slip past 30 days."

**Verdict:** ✅

**Notes:**
- Phase 3 §4.1 wireframe is faithful to how this would actually be
  used. ✅
- Phase 4 §7.9 endpoint shape is correct.
- One ask: surface the **destruction log** (`ops_med_destruction`)
  on this same screen — admins often resolve a discrepancy by
  documenting destruction. Phase 4 already references it in §2.9 but
  doesn't surface it in the UI. **See §6.B.1.**

**Pre-build action:** §6.B.1.

---

### 2.5 Wave 1 — W7 Temperature Logs

> *Admin:* "I have a clipboard in the kitchen right now. If your
> mobile dialog is faster than the clipboard, I'll use it. If it's
> slower or has a login wall, I won't."

**Verdict:** 🟡

**Notes:**
- Mobile-first record dialog (Phase 3 §4.2) is sized right —
  fixture dropdown, reading field, time-already-filled, optional
  photo. The "Save anyway & create follow-up" confirmation flow is
  exactly the right behavior when a reading is out of range. ✅
- **Concern:** the cook may be in a hurry and dismiss the
  confirmation. Currently the design protects against this because
  the obligation row is still created with status=open. ✅
- **Concern:** the cook usually doesn't have a portal login —
  they're a kitchen staffer, not an admin. Wave 0 has no multi-user
  facility accounts. **See §6.A.1** for a workaround using "recorded
  by (free-text)" until Wave 3 introduces real staff users.
- **Useful addition:** a "Quick Record" home-screen shortcut on
  mobile that opens straight to the record dialog with last-used
  fixture pre-selected. Non-blocking; add as a Wave 1.5 ticket.
- **Inspector test:** open the Logs tab → see green check on every
  fixture today + last 30-day rollup. Inspector smiles. ✅

**Pre-build action:** §6.A.1.

---

### 2.6 Wave 1 — W5 Drill Log

> *Admin:* "The placeholder line that says cadence enforcement
> comes later is honest. I'd still rather have the calculator now,
> but I'll take the log."

**Verdict:** ✅

**Notes:**
- Wireframe (Phase 3 §4.3) covers everything an inspector asks
  about: kind, shift, executed_at, leader, participants,
  evacuation seconds, debrief notes. ✅
- The evacuation_seconds field should accept `mm:ss` input — Phase 3
  shows `[ 1:58 ] mm:ss`; Phase 4 stores as INTEGER seconds. Confirm
  the FE→BE conversion is explicit. **See §6.A.2.**
- **Useful addition:** auto-tag the drill as "this quarter's <shift>
  fire drill" so the future cadence calc has zero extra work to do.
  This is just a derived view, not a schema change. Non-blocking;
  add to Wave 4 acceptance criteria.

**Pre-build action:** §6.A.2.

---

### 2.7 Wave 1 — W9 Vendors

> *Admin:* "One row each for pharmacy, food, pest, linen, medical
> supply, maintenance, fire safety company, possibly an HVAC tech.
> Eight vendors. I'd put this in tonight if you shipped it."

**Verdict:** ✅

**Notes:**
- Phase 3 §4.4 wireframe is correct. Two-column add-dialog is the
  right size. ✅
- COI evidence attachment is the win — admins want to be able to
  hand the inspector a folder, and the auditor share-link (Wave 3)
  will need this evidence to be present.
- **Useful addition:** when a vendor's COI is within 60 days of
  expiry, generate a templated email to the vendor: "Reminder: COI
  expires YYYY-MM-DD, please send us the renewal." Non-blocking;
  Wave 3 (Resend) at earliest.

**Pre-build action:** none.

---

### 2.8 Wave 1 — W10 Complaints

> *Admin:* "I'm not going to log every kvetch from a family member.
> But when the ombudsman calls me, that's a complaint, and I need
> to be able to find it 18 months later when CCLD asks."

**Verdict:** 🟡

**Notes:**
- Intake → investigation notes → resolution → close lifecycle (Phase
  3 §4.5) is correct. ✅
- **Concern:** anonymous complaints. The current schema allows
  `complainant_type = 'anonymous'` and lets the form skip
  complainant fields. ✅ Phase 3 §9 already notes the layout must
  not break on blank fields. Confirm. **See §6.A.3.**
- **Concern:** ombudsman complaints in particular often arrive with
  a reference number from the ombudsman office. Capture it. **See
  §6.B.2.**
- **Useful addition:** auto-prompt the admin to add a corrective
  action when resolving a complaint (link to a future Wave 2
  obligation, but Wave 1 just stores the text). Non-blocking; add
  to W10 Wave 1 acceptance.

**Pre-build action:** §6.A.3, §6.B.2.

---

### 2.9 Wave 1 — W13 Inspections

> *Admin:* "I want every inspector visit on one screen. Including
> the ombudsman, the fire marshal, even the corporate auditor from
> the owner's other facility. When the next CCLD comes, I want to
> show them a closed-loop on every prior citation."

**Verdict:** ✅

**Notes:**
- Phase 3 §4.6 wireframe covers it. ✅
- Phase 4 §2.8 separates `ops_inspections` from
  `ops_inspection_citations` — correct, because one visit can have
  N citations and each has its own due date and closure.
- **Concern (small):** "Inspector name" is plural in real life — the
  CCLD analyst sometimes brings a colleague. Make it a text field
  not a relation. Phase 4 already does this. ✅

**Pre-build action:** none.

---

### 2.10 Audit Readiness sub-view (Wave 1 placeholder Overview tab)

> *Admin:* "Welcome message is fine for Wave 1. Don't make me read
> it twice. Make sure the placeholder doesn't accidentally hide the
> Drills / Logs / Vendors / Complaints / Inspections tabs — those
> are why I'm here."

**Verdict:** ✅

**Notes:**
- Phase 3 §4.7 placeholder is fine. Confirm the tab strip is always
  visible and the Overview text isn't a modal — the admin should be
  one click from any sub-tab. ✅
- When Wave 3 W1 lands, the Overview becomes the daily triage and
  the welcome message goes away. Plan accordingly.

**Pre-build action:** none.

---

## 3. Cross-cutting concerns

### 3.1 Non-technical user lens

> *Admin:* "I'll use this if it works the first time. I won't use it
> if I have to think about it. Half my staff don't read English well
> — and they're not me, but they enter temperature readings."

| Concern | Mitigated by | Verdict |
|---|---|---|
| Hidden in a deep nav | One new sidebar item; tabs in the hub | ✅ |
| Form errors confusing | `<FormField>` already handles inline error text | ✅ |
| Mobile dialog too small | Phase 3 §4.2 mobile-first | ✅ |
| Bilingual UI | Wave 4 scope; documented `[NEEDS REAL ADMIN]` for threshold-language requirement | ❔ |
| Login friction | Existing facility session; no new auth | ✅ |
| Photo upload fail on slow Wi-Fi | 5 MB cap + retry messaging needed | 🟡 — add retry copy to `<AttachEvidence>` (§6.A.5) |

### 3.2 Audit readiness coverage check

The simulated admin scored each Phase 1 §10 inspector ask against
the Wave 0/1 surfaces:

| Inspector ask (Phase 1 §10) | Covered by Wave 0/1? | Where | Verdict |
|---|---|---|---|
| Sample MAR | Existing eMAR (not Wave 1 scope) | OperationsTab → eMAR | ✅ (pre-existing) |
| Sample incident | Existing Incidents (Wave 2 adds closer) | OperationsTab → Incidents | ✅ (pre-existing); 🟡 (Wave 2 needed for SLA evidence) |
| Sample chart | Existing Residents + Admissions (Wave 2 W8 adds sweep) | Residents | ✅ (basic); 🟡 (Wave 2 for completeness) |
| Staff training matrix | **Not covered in Wave 0/1** | Wave 2 W3 | 🟡 — Wave 2 priority |
| Fire drill record | Wave 1 W5 ✅ | Audit Readiness → Drills | ✅ |
| Disaster drill record | Wave 1 W5 ✅ | Audit Readiness → Drills | ✅ |
| Temp logs (fridge / hot water) | Wave 1 W7 ✅ | Audit Readiness → Logs | ✅ |
| Postings | Wave 4 W6 | n/a | ❔ — admin can use Vendors → Evidence as a workaround until Wave 4 |
| Resident trust | Wave 4 W12 | n/a | ❔ — facility-togglable; user said skip for v0 |
| Complaints | Wave 1 W10 ✅ | Audit Readiness → Complaints | ✅ |
| Hospice/waiver | Existing Residents | Residents | ✅ (pre-existing); future enhancement noted in BRD §8.1 |
| Bed-hold | Existing Incidents (hospitalization fields) | Incidents | ✅ (pre-existing) |
| Death record | Existing Incidents (incident_type=death) | Incidents | ✅ (pre-existing) |

**Result:** Wave 1 delivers direct evidence for **6 of 13** inspector
asks; pre-existing portal covers **4 more**; Wave 2 covers **2 more**
(staff training, chart completeness); Wave 4 covers postings and
trust. No inspector ask is unaddressed across the roadmap.

### 3.3 What auditors *can't* find in the portal yet (post-Wave 1)

The admin called out the following gaps that even Waves 2–4 don't
fully close, useful for honest disclosure to the user:

- **Hospice waiver documentation** is a single field on the resident
  today, not a full waiver / order / plan packet. Noted in BRD §8.1
  as future / W8 extension.
- **Diet orders** are not a structured entity. Inspectors increasingly
  ask for the chain of evidence (MD signs → kitchen prints → meal
  served). Documented as future in BRD §8.1 (#25).
- **Bilingual postings + complaint forms** depend on B12 validation
  and are Wave 4. Document for honesty.
- **Resident-facing app** (signed personal rights acknowledgment via
  e-sig pad) is Nice-to-have, Wave 5+.

None of these are blockers for Wave 0/1 — they are tracked in the
roadmap and acknowledged.

---

## 4. Implementation Contract check

The admin doesn't read code, but the Eng Lead spot-checked Phase 4
against Phase 3 §2.5 Implementation Contract. Summary:

| Contract rule | Phase 4 honors it? | Cite |
|---|---|---|
| No new design system | ✅ — all FE files extend existing patterns | §10 |
| No new request envelope | ✅ — every route returns `{ success, data }` | §7 |
| No new auth flow | ✅ — `requireFacilityAuth` + `requireActiveSubscription` reused | §7 preface |
| Reuse `<AttachEvidence>` / `<FormField>` / `<AddXDialog>` / `portal-tabs` | ✅ | §10 |
| No new file-storage pattern | ✅ — one adapter, all forms call it | §4.2, §8 |
| No new date helpers | ✅ — `toLocalEpochMs`, `todayLocal` reused | (implicit; called out for code review) |
| Snake_case `ops_*` tables, `bigint` epoch ts, `text` enums, `integer DEFAULT 0` for booleans, `BIGSERIAL` PKs, `CREATE TABLE IF NOT EXISTS` bootstrap | ✅ | §2 |
| Routes mount on `opsRouter` at `/api/ops/*` | ✅ | §7 preface |

**No contract violations identified.** Approve for build.

---

## 5. Sign-off conditions (the exit checklist)

Phase 5 is signed off and Epic A tickets may open when ALL of the
following are TRUE. Use this as a literal checklist.

### 5.1 Conditions met during this session (✅)

- [x] Phase 1 admin discovery accepted.
- [x] Phase 2 BRD + prioritization addendum accepted.
- [x] Phase 3 IA + flows + binding Implementation Contract §2.5
      accepted.
- [x] Phase 4 engineering plan accepted (incl. additive-only
      migration approach, reuse of `ops_facility_settings` for F1,
      Auditor scaffold without DDL change, inline temp-log
      follow-up state).
- [x] No Wave 0/1 design embeds a regulation value as a hardcoded
      constant — all 14 BLOCKING items resolve to entries in
      `ops_facility_settings`.
- [x] Phase 4 §10 frontend implementation map cites the existing
      pattern reused for every new file.

### 5.2 Conditions to satisfy before Epic A opens

- [ ] **§6 corrections** (next section) are integrated into Phase 3
      and Phase 4 docs OR explicitly accepted as Wave 1 acceptance
      criteria additions rather than doc rewrites.
- [ ] **Risk R1** (Fly volume snapshot policy, Phase 4 §14): either
      confirmed by infra check (devops-agent) or accepted as a Wave 0
      ticket A0 that gates A4 deployment.
- [ ] **Branch is published** so other contributors can review (the
      branch `feature/operations-tab-discovery` currently lives
      locally only). Not blocking implementation, but useful before
      tickets open.

### 5.3 Conditions to satisfy before Wave 1 *ships* to a paying customer

- [ ] At least the FIRST `[V]` reg setting that drives behavior —
      `HOT_WATER_MAX_F`, `FRIDGE_MIN_F`, `FRIDGE_MAX_F`,
      `FREEZER_MAX_F` — is replaced with a validated value for at
      least one facility (your own facility during dogfood).
- [ ] A real admin (not the simulated one) walks Wave 1 end-to-end
      and signs off, OR you accept the simulated-admin sign-off as
      sufficient for v0 internal beta.
- [ ] R1 (volume snapshot) confirmed before any production evidence
      uploads.
- [ ] `code-reviewer` runs against the final Wave 1 diff and reports
      no contract violations.
- [ ] `security-reviewer` runs against Wave 0 F2 (file upload) and
      Wave 0 F3 (audit-trail) before they ship to production.

---

## 6. Corrections to fold into prior phase docs

Six small adjustments surfaced during the walkthrough. Each is small
enough to be a ticket acceptance-criterion rather than a doc rewrite.

### 6.A — Wave 0 / cross-cutting

| ID | Correction | Lands as |
|---|---|---|
| A.1 | "Recorded by (free-text)" field on `<TemperatureLogsContent>` record dialog accepts free-text staff name until Wave 3 introduces multi-user; defaults to current session user but is editable | W7 ticket B3 acceptance |
| A.2 | Drill `evacuation_seconds` UI accepts `mm:ss` string; FE converts to integer seconds before POST; BE validates with `z.number().int().nonnegative().optional()` | W5 ticket B5 acceptance |
| A.3 | `<ComplaintsContent>` and `<ComplaintDetail>` render `complainant_name` / `complainant_relation` as em-dash (`—`) when blank for anonymous; no layout breakage | W10 ticket B9 acceptance |
| A.4 | `<AuditTrailButton>` panel: each event row expands to show full before/after JSON in a `<pre>` with copy-to-clipboard | A10 acceptance |
| A.5 | `<AttachEvidence>` shows retry button + plain-language error ("Upload failed — please try again") on network/storage error; not a generic toast | A9 acceptance |

### 6.B — Wave 1 small additions

| ID | Correction | Lands as |
|---|---|---|
| B.1 | W11 surface includes a "Recent destructions" accordion below the resolved list, reading from `ops_med_destruction` (no new endpoint; storage fn already exists) | W11 ticket B1 acceptance |
| B.2 | W10 complaint form has an optional "External reference (ombudsman, regulator, internal #)" text field; persisted in `intake_notes` or as a small new column `external_ref TEXT` — recommend new column to keep `intake_notes` clean | W10 ticket B8 acceptance (add column to DDL §2.7) |

### 6.C — Decisions deferred (acknowledged, not pre-build blocking)

| ID | Item | Defer to |
|---|---|---|
| C.1 | Bilingual UI threshold validation | Wave 4 W6 (depends on B12) |
| C.2 | Diet order structured entity | Future / W8 extension (BRD §8.1 #25) |
| C.3 | Hospice waiver packet structured entity | Future / W8 extension |
| C.4 | Multi-user-per-facility staff accounts (so cooks can log temps under their own session) | Wave 3 — sits alongside Auditor share-link |
| C.5 | Vendor COI renewal email template | Wave 3 (reuses Resend pipeline) |
| C.6 | Quick-record home-screen shortcut for kitchen tablet | Wave 1.5 — optional polish ticket |
| C.7 | Auto-tag drill as "this quarter's <shift>" for future cadence calc | Wave 4 acceptance addition (derived view; no schema change) |

---

## 7. Pre-implementation checklist (literal go signal)

Run through this list in order. Stop and re-route on the first `[ ]`.

1. [ ] Phase 1–4 accepted (§5.1) — **DONE per session log.**
2. [ ] §6.A and §6.B corrections folded into Wave 0/1 ticket
       acceptance criteria.
3. [ ] R1 Fly volume snapshot decision: either confirm policy now or
       open ticket A0 "Confirm volume snapshot cadence + restore
       procedure" before A4 deploys to prod.
4. [ ] Branch `feature/operations-tab-discovery` pushed to remote
       (optional; nice for review).
5. [ ] Open Epic A (Wave 0 foundation) tickets per Phase 4 §11
       table. Order: A1–A13.
6. [ ] After Epic A merge, open Epic B (Wave 1) tickets in the order
       specified in Phase 4 §11.
7. [ ] Each ticket cites the existing pattern it extends per
       Implementation Contract §2.5.
8. [ ] `code-reviewer` runs on each PR. Reject contract violations.
9. [ ] `security-reviewer` runs on F2 + F3 + the first Wave 1 ticket
       to ship.
10. [ ] `qa-tester` validates §12 test plan completeness per ticket.
11. [ ] On internal dogfood: at least the four behavioral reg
        settings (B4 group) are replaced with validated values.
12. [ ] Real-admin sign-off before Wave 1 leaves internal beta.

---

## 8. What this phase does and does not unblock

**Unblocks:**
- Opening Epic A (Wave 0 foundation) and Epic B (Wave 1) tickets.
- Beginning implementation work in the existing
  `feature/operations-tab-discovery` branch.

**Does NOT unblock:**
- Replacing any `[V]` reg-setting value with a "validated" flag
  without source-note evidence. The validated flag flips only when
  both `value` is set AND `source_note` is non-empty.
- Shipping Wave 1 evidence uploads to production before R1 (volume
  snapshot) is confirmed.
- Opening Wave 2/3/4 tickets — those remain roadmap until Wave 1
  ships and the real admin re-validates.

---

## 9. Summary of validated design

The simulated admin's bottom line:

> *"You've built a real audit binder. Six tabs under Audit Readiness,
> the gear for the settings I rarely touch, the eMAR controlled-sub
> surface where I already work, evidence attachments on every form,
> and a history button I can show to an inspector. Ship Wave 0 + Wave
> 1, get me using it for a month, then we'll come back and prioritize
> Wave 2 properly with real data on what hurts most."*

Phase 5 verdict: **GO** — proceed to Epic A ticket opening, subject
to the §7 checklist.
