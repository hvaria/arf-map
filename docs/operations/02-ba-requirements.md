# Phase 2 — BA Requirements (BRD) for Operations Audit-Readiness

> **Status:** DRAFT — awaiting Phase 2 gate review.
> **Scope (confirmed Phase 1 gate):** Wide. Operations must serve both as
> the *evidence + obligation tracking* layer AND the *fix-the-gap nudge
> engine* (expiring-cert tracking, drill scheduler, incident-lifecycle
> closer, posting-verification, one-click pre-audit pull).
> **Open-question policy:** Hybrid. Low-blast-radius regulation
> questions are listed as labeled assumptions and proceed. High-blast-
> radius items (§1) are **BLOCKING** — design may proceed but no shipped
> behavior may hardcode their values until validated.
> **Methodology:** §2 is a fact-based survey of the existing portal
> (read from `server/ops/opsSchema.ts` and the matching React content
> components on 2026-05-13). Everything else is requirement work
> grounded in §2 + Phase 1 narrative.
> **What this doc is not:** No UI mockups, no API contracts, no
> components. Those live in Phase 3 and Phase 4 respectively.

---

## 1. BLOCKING items (high-blast-radius regulation questions)

The product **may be designed** assuming these values are facility-
configurable, but **may not ship** with any hardcoded numeric / temporal
behavior until each is reconciled with Title 22 Division 6 Chapter 8
and current CDSS Provider Information Notices (PINs). All values below
are *placeholders* drawn from common practice.

| ID | Question | Why blocking | Where it lands in the product |
|----|---|---|---|
| **B1** | CCLD verbal notification windows by event type (fall, injury, hospitalization, death, abuse, elopement, missing person). Common-practice placeholder: 24 hours for non-emergent, immediate for serious bodily injury/death/abuse `[V]` | Incident SLA timers are the heart of the lifecycle closer. Wrong number → either nuisance overdue badges, or worse, false reassurance | `facility_reg_settings` table (per-event row); incident SLA engine reads it |
| **B2** | LIC 624 written submission window and acceptable submission method (fax, mail, electronic). Placeholder: 7 days `[V]` | Same as B1 for the written report SLA | `facility_reg_settings` |
| **B3** | SOC 341 (Suspected Dependent Adult / Elder Abuse Report) timing & responsible parties | Already a column in `ops_incidents`. Behavior must be correct | `facility_reg_settings` |
| **B4** | Hot water max temperature at resident-accessible fixtures. Placeholder: 110°F `[V]` | Drives temperature-log alerting; flagged ≥ threshold is a citation | `facility_reg_settings`; temperature log thresholds |
| **B5** | TB clearance rules: initial deadline (7-day placeholder), annual vs. risk-based renewal | Drives staff cert expiry surface; controls "stop scheduling shifts" gate | `staff_credential_types` reference + `facility_reg_settings` |
| **B6** | Live Scan / fingerprint clearance: submission before resident contact, exemption process, renewal expectations | Same as B5 | `staff_credential_types` + `facility_reg_settings` |
| **B7** | CPR / First Aid required positions and renewal cycle (2-year placeholder for cards `[V]`) | Same as B5 | `staff_credential_types` + role policy |
| **B8** | Postural support vs. restraint definitional line; MD order refresh interval | Drives the postural-support evidence checkbox and any restraint review surface | `facility_reg_settings`; resident care plan validation |
| **B9** | Fire drill required cadence & shift-coverage requirement. Placeholder: one drill per shift per quarter `[V]` | Drives the drill scheduler's "are we behind" calculus | `facility_reg_settings`; drill cadence rule |
| **B10** | Disaster drill required cadence and required scenario coverage | Same as B9 | `facility_reg_settings` |
| **B11** | Records retention periods per document class (placeholder 3 years post-discharge across the §7 inventory of Phase 1 `[V]`) | Drives auto-archival / purge gates | `record_retention_policy` reference |
| **B12** | Posting requirements: definitive current list + applicable language thresholds | Drives the posting verification walkthrough | `posting_catalog` reference (seeded per regulation update) |
| **B13** | Resident trust account rules: dual signature, statement cadence, max held balance, escheatment | Drives trust-account behavior; if wrong, becomes a citation amplifier | `facility_reg_settings` + trust ledger constraints |
| **B14** | Annual physician's report cadence and conditions requiring more frequent updates | Drives chart completeness sweep | `facility_reg_settings` |

**Architectural consequence:** every B-item resolves to *configuration*,
not hardcoded constants. We need two new tables:
`facility_reg_settings` (per-facility scalar regulation values, with
provenance and version timestamp) and `record_retention_policy`
(per-document-class retention). This decision belongs in Phase 4 but is
locked here because Phase 3 workflows depend on it.

---

## 2. Baseline survey — what exists today (fact, audited on the branch)

Pulled from `server/ops/opsSchema.ts` and the corresponding
`client/src/components/operations/*Content.tsx` modules.

### 2.1 Data model (existing `ops_*` tables)

| Domain | Tables | Notes |
|---|---|---|
| Residents | `ops_residents`, `ops_resident_assessments`, `ops_care_plans`, `ops_daily_tasks` | Assessments have a `next_due_date` and a `lic_form_number` — reusable for recurring chart obligations |
| eMAR | `ops_medications`, `ops_med_passes` (8 rights + PRN reason + pre-vitals), `ops_controlled_sub_counts` (two-staff witness already enforced via columns), `ops_med_destruction` (two-staff witness) | Strong baseline; missing audit trail (who-changed-what) and refusal/missed-dose summary surface |
| Incidents | `ops_incidents` | Already includes: supervisor/family/physician notified + timestamps, LIC 624 required+submitted+submittedAt, SOC 341 required+submitted, hospitalizationRequired, hospitalName, followUpDate, followUpCompleted, rootCause, correctiveAction |
| Admissions | `ops_admissions` | Per-form checkpoints for LIC 601, 602a, 603, 604a, 605a, 610d; admission agreement signed + signed-by + signed-at; physicianReportReceived, tbTestResultsReceived |
| CRM | `ops_leads`, `ops_tours` | Out of scope for audit-readiness directly |
| Billing | `ops_billing_charges`, `ops_invoices`, `ops_payments` | Out of scope except resident trust gap (none today) |
| Staff | `ops_staff` (single `license_expiry` only), `ops_shifts` | **MAJOR GAP:** one expiry slot. No separate TB / fingerprint / CPR / First Aid / dementia / pre-service / in-service tracking |
| Compliance | `ops_compliance_calendar` (`item_type`, `due_date`, `status`, `reminder_days_before`) | Generic obligation list. No recurrence, no evidence attachment, no sub-tasks, no sign-off, no provenance |
| Facility config | `ops_facility_settings` (key/value) | Already exists — natural home for B1–B14 once validated |
| Trackers | `tracker_*` tables (per Phase 1 §0); 9 registered: ADL, Vitals, Toileting, Hygiene, Skin Check, Seizure, Sleep, Inventory, Cleaning | These ARE evidence sources for many audit asks. Need to be wired into the audit-pull surface |
| Notes | `notes` (existing); deep-linkable via `#/facility-portal/notes` | Operational journal; can serve as a "what happened that day" supplement to incident reports |

### 2.2 UI surface (existing sub-views in `OperationsTab.tsx`)

Sub-views: Dashboard, Residents, eMAR, Tasks, Incidents, Trackers,
Compliance, CRM, Billing, Staff, Calendar.

Dashboard already includes (per file header docstring):
KPI tiles, Alerts & Exceptions panel (urgency-ranked, cross-module),
Personal Work Queue, Today's schedule strip with shift rollups,
Role-lens switcher, Sticky quick-action bar, Keyboard shortcuts
(`g+m`, `g+i`, `g+n`, `g+r`, `g+c`, `c`, `?`).

### 2.3 What the existing portal does *not* have

- Evidence attachment anywhere (files / photos / signed PDFs).
- Multi-credential staff tracking (only single `license_expiry`).
- Fire / disaster drill structured records (date, shift, evacuation time, participants, scenario, debrief).
- Temperature logs (fridge, freezer, hot water, dish machine).
- Cleaning / housekeeping log distinct from the Cleaning tracker `[?]` — Cleaning tracker may overlap; clarify in Phase 3.
- Posting verification (a walkthrough that catalogs required postings and their last-verified state).
- Resident trust accounts (per-resident ledger).
- Vendor / contractor file with COI + license tracking.
- Complaints intake / investigation / resolution log.
- Immutable audit trail (who changed what, when, with which role) — critical for inspections.
- Inspection log (when CCLD/Ombudsman/AHJ visited, what they reviewed, citations issued, corrective actions, due dates).
- Pre-audit "one-click pull" surface that bundles N months of evidence.
- Configurable regulation values per B1–B14.
- Document recurrence rule engine (annual, quarterly, monthly, every N months).
- Sign-off / two-witness columns generalized beyond eMAR.
- Notification scheduler (today the Compliance item has a static `reminder_days_before` field; nothing actually fires reminders).

---

## 3. User roles & permissions

The portal currently uses two auth systems (facility vs. job seeker;
see CLAUDE.md). Within the facility session, the OperationsTab dashboard
exposes a "role-lens switcher" (informational). For audit-readiness, we
need *actual* role-based access controls.

### 3.1 Roles (proposed)

| Role | Job stories owned | Notes |
|---|---|---|
| **Administrator** (default for facility owner) | Everything | Single-admin facilities are common; this role must work standalone |
| **Director of Nursing (DON)** | Clinical evidence (charts, MAR, trackers, incidents) | May or may not exist at small facilities |
| **Med Tech / Caregiver (Direct Care)** | Med pass, daily tasks, tracker entry, incident *reporting* (not closing) | Read-only on personnel and compliance config |
| **Schedule Lead** | Staffing, shifts, time-off | Subset of admin |
| **Office Manager / Bookkeeper** | Billing, vendor file, resident trust | Subset of admin |
| **Auditor (read-only, time-bounded)** | Read all evidence within a stated window | New role. Time-bounded sharable view for state visits / internal audits / corporate. Watermarked exports |
| **Owner / Multi-facility Operator** | Cross-facility roll-up | Future; out of scope for v1 |

### 3.2 Permission shape (proposed)

- Role × Resource × Action (CRUD + sign + close + export).
- Role × Reg-Settings = read-only except Administrator.
- Auditor role gets a *facility-scoped*, *time-bounded* session token
  with no mutation rights, no PII redaction (state inspectors see
  everything anyway), and every viewed record gets logged into the
  audit trail.

### 3.3 Required vs. nice-to-have

| Item | Class |
|---|---|
| Role enforcement at API layer for new audit-readiness surfaces | Required |
| Auditor (read-only, time-bounded) role | Required for "state called and I had 10 minutes" pain point |
| Custom permission overrides per user | Nice-to-have |
| Inheritance / role hierarchy | Nice-to-have |
| Approval workflows requiring two roles (e.g., narcotic destruction) | Required where regulation mandates two-staff witness `[V]` |

---

## 4. Domain entities for audit-readiness (new + extended)

These entities are needed beyond §2 to support the BRD. Field lists
are illustrative; Phase 4 owns the schema.

### 4.1 `facility_reg_settings`
Per-facility scalar regulation values keyed by reg-key (e.g.,
`hot_water_max_f`, `incident_verbal_notification_window_serious_hours`,
`fire_drill_per_shift_per_quarter`). Each row carries `value`,
`unit`, `effective_at`, `source_note`, `set_by`, `set_at`.

### 4.2 `record_retention_policy`
Document-class retention rules (e.g.,
`document_class = incident_report`, `retention_years = 3`).

### 4.3 `obligation` (replaces / supersedes `ops_compliance_calendar`)
Generic recurring or one-time obligation with:
- `obligation_type` (fire_drill, disaster_drill, fire_extinguisher_service, license_renewal, posting_verification, chart_review, training_in_service, etc. — extensible per `facility_reg_settings`)
- `target` (facility | resident | staff | vendor | room)
- `target_id`
- `due_at`
- `recurrence_rule` (RRULE or simplified: annual / quarterly / monthly / every N days)
- `severity` (citation_risk: high | medium | low) — informs notification urgency
- `assigned_to`
- `status` (`pending` | `in_progress` | `submitted` | `under_review` | `approved` | `rejected` | `expired` | `closed`)
- `evidence_required` (boolean)
- `evidence_links[]` (file IDs, tracker entry IDs, drill_log IDs, etc.)
- `sign_offs[]` (role, user_id, signed_at)
- `notes`
- `created_at`, `updated_at`

The current `ops_compliance_calendar` is a degenerate case of this and
should be migrated.

### 4.4 `staff_credential`
Per-employee credential row:
- `staff_id`, `credential_type` (`tb_clearance`, `fingerprint_clearance`,
  `cpr`, `first_aid`, `dementia_training`, `pre_service_hours`,
  `food_handler`, `rcfe_administrator_certificate`, `ce_hours_period`,
  etc.)
- `issued_at`, `expires_at` (nullable for non-expiring), `verified_at`,
  `evidence_link`, `status` (`active` | `expired` | `pending` | `na`),
  `note`

### 4.5 `drill_log`
- `facility_number`, `drill_kind` (fire | disaster | active_shooter | other)
- `scenario`, `scheduled_at`, `executed_at`, `shift`
- `leader`, `participants[]` (staff_ids), `residents_involved[]` (optional)
- `evacuation_seconds` (nullable)
- `debrief_notes`, `corrective_actions[]`
- `evidence_links[]`, `created_by`

### 4.6 `posting_catalog` + `posting_verification`
- `posting_catalog` (per regulation): `posting_key`, `title_en`,
  `title_es`, `applicability_rule`, `current_revision`, `template_url`
- `posting_verification`: `facility_number`, `posting_key`,
  `last_verified_at`, `verified_by`, `evidence_link` (photo of posted
  notice), `status` (`current` | `stale` | `missing`)

### 4.7 `temperature_log`
- `facility_number`, `fixture_key` (`fridge_kitchen_1`, `hot_water_room_3`, etc.),
  `reading_value`, `unit`, `reading_at`, `recorded_by`, `note`
- Constraint engine flags reading > `facility_reg_settings.hot_water_max_f` or
  `< facility_reg_settings.fridge_min_f`.

### 4.8 `complaint`
- `facility_number`, `received_at`, `complainant_type` (resident | family | staff | ombudsman | anonymous),
  `nature`, `assigned_to`, `investigation_notes`, `resolution`,
  `resolution_at`, `status`, `evidence_links[]`.

### 4.9 `vendor`
- `facility_number`, `vendor_name`, `vendor_type` (pharmacy, food, pest, medical_supply, maintenance, etc.),
  `coi_expires_at`, `license_expires_at`, `contact`, `evidence_links[]`, `status`.

### 4.10 `inspection`
- `facility_number`, `inspector_org` (CDSS_CCLD | LTC_Ombudsman | Fire_Marshal | Health_Dept | other),
  `visit_at`, `purpose` (annual | complaint | follow_up | other),
  `inspector_name`, `findings[]`, `citations[]`, `corrective_actions[]`,
  `due_dates[]`, `closed_at`.

### 4.11 `resident_trust_account`
- `resident_id`, `balance`, plus `resident_trust_ledger` rows
  (`amount`, `direction` debit/credit, `transacted_at`,
  `transacted_by`, `witnessed_by`, `evidence_link`, `note`).

### 4.12 `audit_trail` (immutable)
Append-only event log: `actor_id`, `actor_role`, `action`,
`entity_type`, `entity_id`, `before_json`, `after_json`, `occurred_at`,
`ip_hash` if applicable. Used to evidence "who changed the MAR entry"
during inspection.

### 4.13 `evidence_attachment`
- `kind` (file | photo | external_link | tracker_entry_ref |
  mar_entry_ref | drill_log_ref), `mime`, `byte_size`, `uri`,
  `uploaded_by`, `uploaded_at`, `sha256`, `signed_by[]`,
  `entity_links[]` (polymorphic links to obligations, incidents, etc.).

---

## 5. Workflows (job stories with acceptance criteria)

Job-story form: *When [trigger], I want to [action], so I can [outcome].*
Each workflow is sized to be a Phase 4 milestone candidate.

### W1 — Daily "what needs my attention today"

**As an Administrator, when I open Operations after morning coffee, I want a single screen that triages every overdue or due-today obligation across the facility ranked by citation risk, so I can plan my day in under 5 minutes.**

Acceptance criteria:
- Lists from at least these sources: open incidents past SLA timer, obligations due today or overdue, staff credentials expiring inside the configured warning window, postings flagged stale, temperature-log readings outside threshold in last 24 h, MAR entries with unresolved missed/refused/held doses, complaints not yet resolved, drill schedules behind cadence.
- Each row shows: subject (resident / staff / facility), action, age of overdue, citation-risk class, owner, "open" link.
- Sortable by risk, age, type.
- The page must be loadable on a phone (admin walks the building).
- Same dataset is the basis for daily summary email (W14 below).

### W2 — Pre-audit one-click pull

**As an Administrator, when CCLD calls and tells me to expect a visit, I want one button that compiles a printable / shareable bundle of every record the inspector typically asks for over the last 6/12 months, so I do not stay up at 2 AM with a binder.**

Acceptance criteria:
- User picks window (6 mo / 12 mo / custom) and audience (CDSS / Ombudsman / Fire / Health / Internal).
- Output is a single bundle with table of contents containing:
  - Roster + admission dates + physician-report status per resident
  - MAR for last N days for each active resident, with missed/refused/held annotations
  - Incident reports filed (with LIC 624 + SOC 341 status and notification timestamps)
  - Fire drill logs by shift
  - Disaster drill log
  - Temperature logs (12 mo by fixture)
  - Postings verification snapshot
  - Staff credential matrix (TB, fingerprint, CPR, First Aid, dementia, food handler, admin cert, in-service)
  - Complaints log
  - Vendor COI matrix
  - Tracker exports (CSV / PDF already exist) referenced in the bundle
  - Resident trust reconciliation
  - Audit-trail extract for the period
- The user can also issue a *time-bounded auditor share link* instead of a download.
- Bundle generation is auditable (writes to `audit_trail`).
- Bundle excludes soft-deleted records and reports exclusion counts.

### W3 — Staff credential matrix & expiry nudge

**As an Administrator, when any staff credential is approaching expiry, I want it surfaced in the daily triage and to be blocked from scheduling that staff for a shift if the credential is required and expired, so I never schedule an uncleared employee.**

Acceptance criteria:
- New `staff_credential` rows for TB, fingerprint, CPR, First Aid, dementia, food handler, RCFE administrator cert (where applicable to role).
- Daily triage surfaces credentials within configured warning window (default 60 days, per facility).
- When an Administrator opens the Schedule, the shift dialog blocks selecting a staff member whose required-credential is expired (Required), or warns if expiring inside warning window (Warning).
- Bulk import of credentials from spreadsheet at facility onboarding.
- Renewal date capture also writes to `obligation` with appropriate recurrence rule.
- Evidence attachment per credential row.

### W4 — Incident lifecycle closer

**As an Administrator, when an incident is reported, I want the system to track every notification, written report, and follow-up action against the (validated) SLA, and refuse to close the incident until every required step is complete with timestamp evidence, so we never miss a CCLD window.**

Acceptance criteria:
- Required steps per incident type are driven by `facility_reg_settings` (B1–B3).
- Each step has its own SLA timer (e.g., "verbal CCLD notification within 24 h of fall with injury" — placeholder).
- Open-incident view shows checklist: supervisor notified, family notified, physician notified, verbal CCLD notification, LIC 624 filed, SOC 341 filed (if applicable), corrective action documented, follow-up complete, root cause documented.
- "Close incident" gated by full checklist + reason.
- Reopened incidents preserve history.
- Existing `ops_incidents` columns (`supervisor_notified_at`, `lic_624_submitted_at`, etc.) feed the timers — no rip-and-replace.

### W5 — Fire / disaster drill scheduler & log

**As an Administrator, when a quarter starts, I want the system to know how many drills I owe per shift, schedule placeholders on the calendar, accept a drill log when executed, and flag any quarter ending without the required coverage, so I always pass the drill audit.**

Acceptance criteria:
- New `drill_log` table populated per drill (kind, scenario, shift, executed_at, leader, participants, evacuation_seconds, debrief notes, evidence link).
- Drill cadence rule comes from B9 / B10 in `facility_reg_settings`.
- Quarter dashboard shows X of Y drills completed by shift; deficits surfaced into W1 triage.
- Drill log supports photo / sign-in sheet attachment.

### W6 — Posting verification walkthrough

**As an Administrator, when I do my monthly walk, I want a guided checklist of every required posting with a photo capture per posting and a "current/stale/missing" state, so I can prove postings during inspection.**

Acceptance criteria:
- `posting_catalog` seeded with the validated B12 list.
- `posting_verification` updated per walkthrough; latest record per posting_key drives state.
- "Stale" if last verification older than configured cadence (B12); "missing" if any required posting has no recent verification.
- Photo / file attachment per verification.

### W7 — Temperature log

**As an Administrator, when staff records daily temperatures (fridge, freezer, hot water), I want out-of-range readings auto-flagged with a citation-risk badge and an automatic corrective-action task, so cold-chain failures become a closed loop, not a binder note.**

Acceptance criteria:
- `temperature_log` rows entered manually (later: IoT integration — out of scope).
- Threshold rules per fixture key from `facility_reg_settings` (B4 covers hot water; cold chain may need additional B-items if found in real regs).
- Out-of-range reading auto-creates an `obligation` of type `temperature_followup` with assignee and SLA.
- Closing the follow-up writes the corrective action.

### W8 — Resident chart completeness sweep

**As an Administrator, when I run a chart sweep, I want every active resident's chart scored against a configurable checklist (current LIC 602, current LIC 603 appraisal, signed LIC 604, signed personal rights, advance directive present, photo on file, allergies recorded, diet order current, code status documented, hospice/waiver if applicable), so I find gaps before the inspector does.**

Acceptance criteria:
- New `chart_requirement_set` config defining the checklist; per resident a `chart_requirement_status` row reflects current state.
- Existing `ops_admissions` LIC checkboxes are the initial source of truth at admission; per-resident annual cycle re-opens checkpoints (B14 governs cadence).
- Dashboard shows X of Y residents with complete charts; deficits surface to W1 triage.
- "Refresh chart" generates obligations for each missing item.

### W9 — Vendor / contractor COI tracker

**As an Administrator, when a vendor delivers, I want their COI and license on file with an expiry date and a renewal nudge, so we never have an active vendor with lapsed insurance.**

Acceptance criteria:
- New `vendor` table; COI + license expiries surface in W1 triage as obligations.
- Evidence attachment per vendor.
- Bulk import accepted at onboarding.

### W10 — Complaint intake & close-loop

**As an Administrator, when a complaint arrives (resident, family, staff, ombudsman), I want a single intake form, an investigation log, a resolution note, evidence attachments, and a closure step, so we can produce a clean complaint log on demand.**

Acceptance criteria:
- New `complaint` table.
- Complaint types include anonymous; PII handling per role.
- Closure requires resolution narrative + (optional) corrective-action obligation.
- Complaint log exportable in the W2 pre-audit pull.

### W11 — Controlled-substance reconciliation review

**As an Administrator, when I open the controlled-substance review, I want every unresolved discrepancy listed with its medication, count history, witness names, and a closure action, so narcotic anomalies are never left open.**

Acceptance criteria:
- Existing `ops_controlled_sub_counts.discrepancy` and `resolved` columns drive the surface.
- Unresolved discrepancies > N days old escalate into W1 triage.
- Closing a discrepancy writes a note + actor + timestamp; immutable in `audit_trail`.
- Destruction is already a separate table — link to discrepancy if applicable.

### W12 — Resident trust accounts

**As an Administrator, when I hold resident funds, I want a per-resident ledger with dual-signature transactions (placeholder, per B13), monthly statements, and a reconciliation surface, so trust accounts pass audit.**

Acceptance criteria:
- New `resident_trust_account` + `resident_trust_ledger` tables.
- Dual-signature gate on any debit (configurable per B13).
- Monthly statement generation.
- Reconciliation surface flags balance mismatches.

### W13 — Inspection log

**As an Administrator, when an inspector visits, I want a record of the visit, what was reviewed, what was cited, and what we're doing to remediate, so when the next inspector arrives I can show a closed-loop history.**

Acceptance criteria:
- New `inspection` table.
- Citations link to remediation `obligation` rows with due dates.
- Inspection history visible in the W2 pre-audit pull.
- Auditor share-link writes its session to `inspection` if generated for a state visit.

### W14 — Daily summary email & escalation

**As an Administrator, when I'm away from the portal, I want a daily summary email of the W1 triage, and a more urgent ping for incidents at risk of missing their SLA, so I never lose visibility.**

Acceptance criteria:
- Daily summary email (Resend, existing pipeline) at configurable time.
- Per-event escalation triggers: an incident whose SLA timer crosses a configurable warning threshold pings the Administrator regardless of daily-summary cadence.
- Email opt-out per role.

### W15 — Audit trail viewer

**As an Administrator, when an inspector asks "who changed this MAR entry," I want to show the change log in seconds, so we don't lose credibility over undocumented edits.**

Acceptance criteria:
- New `audit_trail` table (immutable).
- Per-entity history view (modal or inline expand) showing actor, action, before/after.
- Auditor share-link includes audit trail.
- Tamper-evident: stored hash-chained or write-only with DB role privilege locked.

---

## 6. Status state machines

| Entity | States | Allowed transitions | Required role |
|---|---|---|---|
| `obligation` | pending → in_progress → submitted → under_review → approved · rejected · expired · closed | pending → any active; rejected → pending; closed is terminal | Admin closes; assignee progresses |
| `incident` | open → under_review → closed; reopened path | open → under_review; under_review → closed (requires W4 checklist complete); closed → reopened (rare, audit-trail recorded) | Admin closes |
| `complaint` | received → investigating → resolved → closed | resolved requires resolution note; closed is terminal | Admin closes |
| `staff_credential` | pending → active → expiring → expired · na | active → expiring (auto, by date); expiring → active (renewal accepted); expired is terminal until renewal | Admin |
| `drill_log` | scheduled → executed → reviewed → closed | reviewed requires debrief notes; closed is terminal | Admin / DON |
| `temperature_log` | recorded → out_of_range → resolved (if applicable) | out_of_range only if reading violates threshold | System on insert |
| `posting_verification` | current → stale → missing | time-driven transitions per B12 | System |
| `vendor` | active → expiring → expired → archived | by COI/license dates | Admin |
| `inspection` | scheduled → executed → cited → remediating → closed | closed requires all linked corrective `obligation` rows closed | Admin |

---

## 7. Notification & reminder rules (initial cut)

| Trigger | Channel | Audience | Recipe |
|---|---|---|---|
| Obligation due in `severity_warning_days` (B-driven; default 30 for license, 14 for chart, 60 for credential) | In-app + email | Assignee + Admin | Re-fires at halfway and 24 h |
| Obligation overdue | In-app + email + escalation badge | Assignee + Admin + (Owner if multi-fac) | Daily until resolved |
| Incident open + SLA timer > 50% | In-app | Admin | One-time |
| Incident open + SLA timer > 90% | In-app + email | Admin | Re-fires hourly inside last 10% |
| Staff credential expiring inside warning window | In-app + email | Admin | Daily until resolved or expired |
| Staff credential expired with shifts scheduled | In-app + email + scheduling block | Admin + Schedule Lead | Immediate |
| Temperature reading out-of-range | In-app | Admin | Creates follow-up `obligation` |
| Posting verification stale | In-app | Admin | Weekly digest until refreshed |
| Drill quarter at 75% elapsed with deficit | In-app | Admin | One-time |
| Drill quarter at 95% elapsed with deficit | In-app + email | Admin | Daily until resolved |
| Complaint open > N days (per B `[V]`) | In-app | Admin | Daily |
| Vendor COI expired | In-app + email | Admin + Bookkeeper | Daily |
| Daily triage summary (W1) | Email | Admin | 0700 local default; configurable |

---

## 8. Cross-module traceability matrix

For each Phase 1 §6 compliance area and §7 document, where the
evidence lives in the data model (existing or new), which workflow
covers it, and what the gap is.

### 8.1 Compliance areas

| Phase 1 § | Area | Existing source(s) | New entity needed | Workflow |
|---|---|---|---|---|
| 6.1 | Licensing | `ops_facility_settings`-ish (none today) | `obligation` (license renewal); `evidence_attachment` | W2 |
| 6.2 | Admin credential | `ops_staff.license_*` | `staff_credential` per cert type | W3 |
| 6.3 | Direct-care staff training | `ops_staff` | `staff_credential` (`pre_service_hours`, `in_service_hours`, `dementia_training`, etc.) | W3 |
| 6.4 | TB clearance | none | `staff_credential` (`tb_clearance`) | W3, B5 |
| 6.5 | Fingerprint clearance | none | `staff_credential` (`fingerprint_clearance`) | W3, B6 |
| 6.6 | CPR / First Aid | none | `staff_credential` (`cpr`, `first_aid`) | W3, B7 |
| 6.7 | Resident records | `ops_admissions` LIC checkboxes; `ops_resident_assessments` | `chart_requirement_status` | W8 |
| 6.8 | Medication administration | `ops_med_passes` (full) | `audit_trail` integration | W11, W15 |
| 6.9 | Controlled substances | `ops_controlled_sub_counts`, `ops_med_destruction` | none | W11 |
| 6.10 | Incident reporting | `ops_incidents` (full) | SLA engine driven by B1–B3 | W4 |
| 6.11 | Resident rights | partial (admission LIC checkboxes) | `posting_catalog`/`posting_verification`; rights acknowledgment evidence | W6 |
| 6.12 | Posting requirements | none | `posting_catalog`, `posting_verification` | W6, B12 |
| 6.13 | Food safety | none structured | `temperature_log`, `vendor` (food vendor) | W7, W9 |
| 6.14 | Water safety | none | `temperature_log` (hot water fixture) | W7, B4 |
| 6.15 | Fire safety | none | `drill_log`, `obligation` (extinguisher service) | W5, B9 |
| 6.16 | Emergency / disaster prep | none | `drill_log` (disaster), `obligation` (plan review) | W5, B10 |
| 6.17 | Environment / infection control | partial (Cleaning tracker) | extend Cleaning tracker reports | trackers |
| 6.18 | Resident trust | none | `resident_trust_account`, `resident_trust_ledger` | W12, B13 |
| 6.19 | Vendors / contractors | none | `vendor` | W9 |
| 6.20 | Complaints | none | `complaint` | W10 |
| 6.21 | Hospice & home health waivers | `ops_residents.level_of_care` only | extend resident → `waiver` rows; `obligation` for waiver review | future / W8 extension |
| 6.22 | Postural support / restraint | `ops_care_plans` partial | `obligation` (MD order refresh per B8) | future / W8 extension |
| 6.23 | Death reporting | `ops_incidents` (death is incident type) | extend incident type catalog | W4 |
| 6.24 | Hospitalization tracking | `ops_incidents.hospitalization_*` | extend `incident` post-discharge return checklist | W4 / W8 |
| 6.25 | Diet & nutrition | `ops_residents.primary_dx` + assessments; no diet-orders table | future `diet_order` | future |

### 8.2 Document inventory (Phase 1 §7)

Every row in Phase 1 §7 maps to either an existing `ops_*` table
(LIC 601, 602, 603, 604 → `ops_admissions`; MAR → `ops_med_passes`;
controlled-substance log → `ops_controlled_sub_counts`; LIC 624 →
`ops_incidents`; etc.), or to a new entity defined in §4. Phase 4
finalizes the migration plan.

---

## 9. Gap analysis (required → existing → action)

| # | Required capability | Existing | Gap | Action |
|---|---|---|---|---|
| G1 | Per-facility regulation settings (B1–B14) | `ops_facility_settings` key/value | Schema is there but unused for reg values | Define keys; seed defaults with `[V]` flag |
| G2 | Multi-credential staff tracking | Single `license_expiry` | Major | New `staff_credential` table |
| G3 | Generic obligation engine with recurrence + evidence | `ops_compliance_calendar` (degenerate) | Major | New `obligation` table; migrate compliance items |
| G4 | Fire / disaster drill structured records | none | Total | New `drill_log` table |
| G5 | Posting verification | none | Total | New `posting_catalog` + `posting_verification` |
| G6 | Temperature logs | none | Total | New `temperature_log` |
| G7 | Complaints | none | Total | New `complaint` |
| G8 | Vendor / COI | none | Total | New `vendor` |
| G9 | Resident trust accounts | none | Total | New `resident_trust_account` + ledger |
| G10 | Inspection log | none | Total | New `inspection` |
| G11 | Immutable audit trail | none | Total | New `audit_trail` |
| G12 | Evidence attachment (files / photos / refs) | none | Total | New `evidence_attachment` + object storage |
| G13 | Incident SLA engine | columns present; engine absent | Logic | Engine implemented; reads from B1–B3 |
| G14 | Daily triage screen (W1) | partial via existing Dashboard | Aggregation | New aggregation API + screen |
| G15 | Pre-audit one-click pull (W2) | none | Total | New bundle generator |
| G16 | Auditor read-only time-bounded role | none | Total | New role + share-link + viewer surface |
| G17 | Notification scheduler (W14 + table in §7) | none beyond `reminder_days_before` field | Total | New scheduler service (likely reuses ETL scheduler infra) |
| G18 | Chart completeness scoring (W8) | partial via `ops_admissions` | Aggregation | New `chart_requirement_*` |
| G19 | Permission model | implicit (facility session = full) | Logic | Role × resource × action matrix |
| G20 | Record retention policy | none | Total | `record_retention_policy` |

---

## 10. Required vs. nice-to-have

| Workflow / capability | Class | Reason |
|---|---|---|
| W1 daily triage | Required | Single biggest UX lever for §9 Phase 1 pain points |
| W2 pre-audit pull | Required | Wide scope's defining capability |
| W3 staff credentials | Required | "Renewal whack-a-mole" is the #1 pain point in §9 |
| W4 incident lifecycle | Required | CCLD notification windows are citation-defining |
| W5 drill scheduler & log | Required | Drill deficits are common citations |
| W6 posting verification | Required | Postings are the first thing an inspector eyeballs |
| W7 temperature log | Required | Cold-chain & hot water are routine citation items |
| W8 chart completeness | Required | Inspectors pull random charts every visit |
| W9 vendor COI | Required (low effort) | One-table win |
| W10 complaints | Required | "We don't get complaints" is a red flag for auditors |
| W11 controlled-sub review | Required | Existing data exists; surface missing |
| W12 resident trust | Required only if facility holds funds; **optional per facility** | Many small facilities opt out — make the module togglable |
| W13 inspection log | Required | Closed-loop history is a credibility multiplier |
| W14 daily summary email | Required | Admin lives in email |
| W15 audit trail viewer | Required | Inspectors ask "who changed this" |
| Auditor share-link / role | Required | Solves the "state called and I have 10 minutes" pain point |
| Evidence attachment (files / photos) | Required | Without it, every other workflow is hollow |
| Reg config UI (`facility_reg_settings` admin surface) | Required | Without it, B-items can't be unblocked per facility |
| Multi-facility roll-up | Nice-to-have | Out of scope for v1 |
| Custom user permissions | Nice-to-have | Roles are sufficient for v1 |
| IoT temperature integration | Nice-to-have | Manual entry first |
| Bilingual postings UI | Nice-to-have | Catalog stores both EN/ES; UI surface later |
| E-signature pads on forms | Nice-to-have | Signed-by name string + audit trail is sufficient v1 |
| Resident-facing app | Nice-to-have | Out of scope |
| AI summarization of complaints | Nice-to-have | Solid intake first |

---

## 11. Open questions (low-blast-radius — proceeding as assumptions)

Low-blast-radius means the choice does not embed a regulation value
into product behavior. All are subject to Phase 5 admin validation.

| # | Assumption | Risk if wrong |
|---|---|---|
| A1 | Operations Pro paywall continues to gate the new audit-readiness features | Could expose freemium constraints; trivially toggleable |
| A2 | The facility uses the existing `facility_number` as the tenant scope across all new tables | Already the convention in `ops_*` |
| A3 | "Auditor" is a per-facility role (not cross-facility) | If wrong, only the share-link scope changes |
| A4 | Evidence files store in object storage (Fly volume / S3-compatible) | If wrong (e.g., must be in-region for HIPAA `[V]`), only the storage backend changes |
| A5 | The existing Notes feature absorbs ad-hoc operational journaling | If wrong, we surface a separate "shift narrative" workflow |
| A6 | The existing Cleaning tracker is sufficient for housekeeping evidence | If wrong, we add a `cleaning_log` distinct from the tracker |
| A7 | Tracker reports (CSV / PDF) are the canonical evidence for tracker-domain audit asks | Already true per CLAUDE.md |
| A8 | English-only forms are acceptable for v1; bilingual is Nice-to-have | If wrong (per B12 thresholds), W6 acceptance criteria expand |
| A9 | Email is acceptable for notifications; SMS is not v1 | If wrong, scheduler gains a channel |
| A10 | Resident PII redaction is not required for in-product viewing by Administrator | Standard for facility owner viewing their own residents |

---

## 12. Acceptance criteria summary (what "Phase 2 accepted" means)

Phase 2 is accepted when:
1. §1 BLOCKING items are acknowledged and the BLOCKING-vs-non-BLOCKING split is approved.
2. §2 baseline is accepted as accurate (no missing tables / surfaces).
3. §3 role list is approved (Admin, DON, Med Tech/Caregiver, Schedule Lead, Office Manager, Auditor).
4. §4 new entities are conceptually approved (Phase 4 finalizes columns / migrations).
5. §5 workflows W1–W15 are approved with no missing critical workflow.
6. §6 state machines are approved.
7. §7 notification rules are approved (or marked for tuning during Phase 3).
8. §9 gap analysis is accepted as complete.
9. §10 required-vs-nice classification is approved.
10. Any §11 assumption flipped from acceptable → blocking is marked and pushed back to §1.

---

## 13. Handoff to Phase 3 (Product / UX)

Phase 3 owners must:
- Take §5 workflows and produce IA + flow + screen-state designs that fit inside the existing OperationsTab shell (Dashboard + sub-views + sidebar nav + sticky quick-action bar described in §2.2).
- Decide whether new workflows become new sub-views (e.g., "Audit Pull", "Drills", "Postings"), or extend existing ones (e.g., Compliance becomes the unified Obligations surface).
- Honor the existing visual language: `bg-indigo-50/100`, `#1E1B4B` headings, FormField pattern, `gradient` primary button, capitalized status badges. Do not introduce a new design system.
- Produce conceptual annotated wireframes (text mockups acceptable per "wireframes-as-text" choice in Phase 0).
- Provide a screen-list aligned to W1–W15 with all five states designed: loading, empty, normal, overdue/at-risk, blocked, resolved.
