# Phase 2 Addendum — Team Prioritization Session

> **Status:** DRAFT — awaiting Phase 2 gate review.
> **Date:** 2026-05-13
> **Brief from owner:** "Ask admin and team to prioritize ones that
> are easy."
> **Interpretation:** rank the §5 workflows W1–W15 by an
> *engineering-easy × admin-relief* combined metric, and define a
> wave sequence that puts the easy-and-impactful items first. Hard
> items remain in scope; they ship later, with a clear roadmap.

---

## 1. Admin's pain order (simulated CA RCFE admin, in own words)

Asked: "Of W1–W15 in §5 of the BRD, what would hurt you most if you
*didn't* have it tomorrow?"

| Rank | Workflow | Admin paraphrase |
|---|---|---|
| 1 | W3 Staff credentials | "TB/fingerprint/CPR renewals are the #1 thing I lose sleep over." |
| 2 | W2 Pre-audit pull | "The 48-hour binder hunt before inspection — give me one button." |
| 3 | Auditor share-link | "When the state calls and gives me 10 minutes, I need to hand them a viewer." |
| 4 | W4 Incident closer | "Missing a CCLD notification window costs the license." |
| 5 | W5 Drill scheduler | "I have to remember in my head whether NOC got their drill this quarter." |
| 6 | W1 Daily triage | "I want one screen that tells me what's on fire today." |
| 7 | W8 Chart completeness | "I do not want to find out a physician's report is stale during the visit." |
| 8 | W7 Temperature log | "Hot water and fridge logs are tiny, but they cite me on them." |
| 9 | W6 Postings | "Half the citations I've seen at peers are posting nitpicks." |
| 10 | W10 Complaints | "When the ombudsman comes I need a clean log." |
| 11 | W11 Controlled-sub review | "The pharmacy already helps. I want it visible, not buried." |
| 12 | W9 Vendor COI | "Easy to forget, easy to track." |
| 13 | W13 Inspection log | "I'd love it, but I survive without it." |
| 14 | W14 Daily summary email | "I already check the portal — but my husband, who is co-admin, doesn't." |
| 15 | W15 Audit trail viewer | "I never thought to ask for this until someone disputed a MAR entry." |
| — | W12 Resident trust | "We don't hold funds. Skip for me. Other facilities will need it." |

## 2. Effort × schema-leverage × citation-risk score

Each row scored 1 (low) to 3 (high). **Easy-win composite =
(citation_risk + schema_leverage − effort + 4)**: higher is easier
and more impactful.

| ID | Workflow | Effort | Schema leverage | Citation risk | Easy-win composite |
|---|---|---|---|---|---|
| W11 | Controlled-sub review surface | 1 | 3 | 2 | **8** |
| W9 | Vendor COI tracker | 1 | 1 | 2 | **6** |
| W10 | Complaints log | 1 | 1 | 2 | **6** |
| W7 | Temperature log | 1 | 1 | 3 | **7** |
| W5 | Drill log (record only, cadence later) | 1 | 1 | 3 | **7** |
| W13 | Inspection log | 1 | 1 | 2 | **6** |
| W4 | Incident lifecycle closer | 2 | 3 | 3 | **8** |
| W3 | Staff credentials | 2 | 1 | 3 | **6** |
| W8 | Chart completeness sweep | 2 | 2 | 3 | **7** |
| W15 | Audit trail viewer | 2 | 1 | 2 | **5** |
| W1 | Daily triage screen | 2 | 2 | 3 | **7** |
| W14 | Daily summary email | 1 | 2 | 1 | **6** |
| W2 | Pre-audit one-click pull | 3 | 2 | 3 | **6** |
| Aud | Auditor read-only share-link | 3 | 1 | 3 | **5** |
| W6 | Posting verification (incl. catalog) | 2 | 1 | 2 | **5** |
| W12 | Resident trust (togglable) | 3 | 1 | 2 | **4** |

Cross-cutting foundational items (no W#, but everything sits on top):

| ID | Capability | Effort | Schema leverage | Citation risk | Notes |
|---|---|---|---|---|---|
| F1 | `facility_reg_settings` seeded with B1–B14 (placeholder values, override UI) | 1 | 3 (table exists) | n/a (unblocks everything) | Required before W4/W7 ship behaviorally |
| F2 | Minimal `evidence_attachment` (single polymorphic table + Fly-volume storage adapter) | 2 | 0 | n/a (multiplier on every workflow) | Required to make Wave 1 *audit-grade* not just *data-entered* |
| F3 | Minimal `audit_trail` middleware (mutations on new tables write events) | 2 | 0 | n/a | Required for inspector credibility; retrofit to old tables later |
| F4 | Role model + Auditor role (without share-link yet) | 2 | 0 | n/a | Foundation for Wave 3 share-link |

---

## 3. Each team member's read

### Simulated Admin
"I want W3 first, but I understand if it takes longer. As long as
something is moving every two weeks I'll feel like the system is
helping. Don't ship a tracker without the ability to upload a
picture — auditors love photos."

### Business Analyst
"W11 is genuinely zero-table work — the data exists. Ship it as the
opening move so users see the existing eMAR investment pay off.
Bundle W7 + W5 + W9 + W10 + W13 as Wave 1 — five single-table CRUDs
with one shared foundation (F1 + F2 + F3). That's a 4–6 week
deliverable that hits five citation-prone areas at once."

### Senior Frontend Engineer
"Wave 1 workflows reuse the existing patterns (`ComplianceContent`
list + `AddXDialog` modal + status badge + group-by-month layout).
I can ship 3 of those per week once the foundational storage adapter
lands. The audit trail viewer is a single hover/expand component
once F3 emits the events. Posting verification is harder than it
looks because of the photo-capture-on-mobile UX. Auditor share-link
viewer is a separate read-only shell — non-trivial."

### Senior Backend Engineer
"F1 is half a day — `facility_reg_settings` is already a table; I
just need a typed accessor and a seed migration with placeholder
values clearly labeled `[V]`. F2 is the biggest sneak cost — once we
commit to file storage we need backup/restore, mime sniffing, AV
scan stance, retention enforcement. Cap v0 at PDFs + JPEG/PNG +
5MB. F3 should be a route-level interceptor on the new ops mutation
endpoints — not a retrofit to every existing route in v0."

### Engineering Lead
"Easy-win composites are a useful sort key, but blast radius rules
sequence. W4 has the highest composite (8) but depends on F1
(reg-settings for SLA windows) and benefits from F2/F3. W11 also
scores 8 and depends on nothing. Recommend: ship F1+F2+F3+F4 as
Wave 0 (foundation), then bundle the single-table Wave 1, then
attack W4+W3+W8 in Wave 2 once the foundation is proven, then the
cross-aggregation Wave 3 (W1, W2, W14, Auditor share-link), and the
configuration-heavy Wave 4 (W6, W12) when B12/B13 are validated."

---

## 4. Recommended wave sequence

> Each wave is independently shippable and delivers visible
> audit-readiness value. Waves do not overlap with code changes to
> the same tables, so they can also parallelize partially if FE/BE
> capacity allows.

### Wave 0 — Foundation (≈ 2 weeks)

- **F1** `facility_reg_settings` seeded with B1–B14 keys + placeholder values clearly labeled `[V]` in the UI ("Default per common practice — replace with your validated value before relying on alerts"). Admin-only override surface.
- **F2** `evidence_attachment` (polymorphic file table; Fly-volume storage; PDF + JPEG + PNG; 5 MB cap; SHA256 + uploader + uploaded-at).
- **F3** `audit_trail` write middleware on new ops mutation endpoints (not retrofitted to existing tables in v0; that's tech debt with a ticket).
- **F4** Role model + scaffolding for Auditor role (read-only flag; no share-link yet).

Outcome: nothing user-visible *yet*, but Wave 1 starts producing audit-grade artifacts the moment it lands.

### Wave 1 — Easy wins (≈ 4–6 weeks)

Single-table CRUD modules built on the Wave 0 foundation. Each has
attach-evidence, audit-trail, list + filter + group-by-month, status
badge in the existing visual language.

| Order | Workflow | Why this slot |
|---|---|---|
| 1 | **W11 Controlled-sub review surface** | Zero new tables. Surfaces existing `ops_controlled_sub_counts.discrepancy`. Single-day deliverable. Demonstrates that the existing eMAR investment was not in vain. |
| 2 | **W7 Temperature log** | One new table. Threshold from F1 (B4). High citation-risk relief for cold-chain + hot water. Mobile-first (cook enters from the kitchen tablet). |
| 3 | **W5 Drill log (record only, cadence later)** | One new table. Cadence calculation deferred to Wave 4 once B9/B10 validated. Just logging drills today is a citation-risk win. |
| 4 | **W9 Vendor COI tracker** | One new table. Expiry badge surfaces in W1 triage later. Easy mental win. |
| 5 | **W10 Complaints log** | One new table. Five-field intake + investigation + resolution + close. |
| 6 | **W13 Inspection log** | One new table. Citations + corrective-action linkage to obligations (linkage formalized in Wave 2). |

Outcome: 6 visible new sub-views (or extensions to existing Compliance), 6 citation-prone areas covered, foundation proven.

### Wave 2 — Lifecycle + credentials (≈ 4–6 weeks)

| Order | Workflow | Why this slot |
|---|---|---|
| 1 | **W3 Staff credentials** | Highest admin-pain item (#1). New `staff_credential` table replacing the single `license_expiry` slot. Schedule-block logic added to existing `AddShiftDialog`. |
| 2 | **W4 Incident lifecycle closer** | Highest composite score; existing `ops_incidents` already has the columns. SLA timers driven by F1 (B1–B3). Close-incident gate enforces checklist. |
| 3 | **W8 Chart completeness sweep** | Aggregates over existing `ops_admissions` LIC checkboxes. New `chart_requirement_status` derived view. Per-resident annual cycle obligation generator (uses the obligation engine — see footnote). |
| 4 | **W15 Audit trail viewer** | Wave 0 F3 wrote the events; this is the read surface. Per-entity hover/expand. |

Footnote on obligation engine: Wave 2 introduces the generic
`obligation` table (BRD §4.3) and migrates `ops_compliance_calendar`
into it. Without this, W8's "regenerate missing chart items"
behavior has nowhere to land. Coordinate with W3's credential
renewals (they also emit obligations).

### Wave 3 — Aggregation + sharing (≈ 4–6 weeks)

| Order | Workflow | Why this slot |
|---|---|---|
| 1 | **W14 Daily summary email** | Reuses Resend pipeline. Pulls from W1 query; can ship a v0 daily email *before* the W1 screen ships, if useful. |
| 2 | **W1 Daily triage screen** | Aggregates over Waves 1 + 2 entities. Extends existing Dashboard "Alerts & Exceptions" panel; doesn't replace it. |
| 3 | **Auditor share-link** | Time-bounded read-only token + dedicated read-only shell. Watermarked exports. Writes to inspection log. |
| 4 | **W2 Pre-audit one-click pull** | Bundle generator stitching every prior wave's data. Auditor share-link is the alternative delivery method. |

Outcome: Operations becomes a self-presenting audit binder.

### Wave 4 — Configuration-heavy / facility-specific (sequencing TBD by B-validation)

| Workflow | Block on |
|---|---|
| W6 Posting verification | B12 validated (definitive posting list + language thresholds) |
| W12 Resident trust | B13 validated; per-facility toggle in F1 settings |
| Retrofit F3 audit trail to legacy `ops_*` tables | Quiet effort, ticketed |
| Drill cadence calculator (W5 second pass) | B9/B10 validated |
| Incident SLA windows fully tuned | B1/B2/B3 validated |

---

## 5. What "easy wins first" means in practice

Wave 1 is the user's "easy wins" payload. It satisfies the brief
literally: six single-table CRUD modules, none of which require
regulation validation to ship behaviorally (Temperature log uses
the B4 placeholder threshold but flags the placeholder in UI).

Critically, **Wave 1 is only audit-grade because of Wave 0** —
without `evidence_attachment` and `audit_trail`, the Wave 1 modules
become glorified spreadsheets. The team strongly recommends not
shipping Wave 1 sans Wave 0; if speed is paramount, Wave 0 can be
compressed to ~1 week by capping F2 to "external link only, file
upload in Wave 0.5".

## 6. Risks called out in session

1. **Scope creep into the cracks between waves.** Each wave's
   acceptance criteria must be locked before its first ticket opens.
2. **Premature B-value lock-in.** Even with `facility_reg_settings`,
   we will discover values during real-admin validation that change
   defaults. Plan for a "default replacement" migration in Wave 4.
3. **Schedule-block logic in W3.** Hard-blocking a shift assignment
   for an expired credential is the right policy; will need an admin
   "override with note" escape hatch (logged to audit trail) because
   real-world emergencies happen.
4. **F2 file storage on Fly volume.** Single-volume backup story;
   confirm backup/restore policy before any resident PII attaches.
5. **Auditor share-link.** PII exposure in a read-only viewer must be
   reviewed by `security-reviewer` agent before it ships.

---

## 7. What Phase 2 gate sign-off now means

Accepting Phase 2 + this prioritization addendum locks:
- Wave 0 (F1–F4) as the next implementation work.
- Wave 1 ordering as the next user-visible deliverables.
- Wave 2/3/4 as committed roadmap (subject to B-validation progress).

If accepted, Phase 3 opens scoped to **Wave 0 + Wave 1 only** for
IA/wireframes, with a roadmap-stub for Waves 2–4. This keeps Phase 3
shippable in the same cycle as Wave 0.
