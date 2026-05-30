# Applicant Full Profile Review — PRD & Implementation Plan

**Feature:** "Open Applicant Profile" from the Facility Portal → Applicants tab
**Product:** Neighbourhood Care Finder (arf-map)
**Status:** MVP backend in progress (see `migrations/0010_applicant_profile_review.sql`)
**Author role:** PM + Full-stack Architect + UX

> Grounding facts (verified against the codebase):
> - The Applicants tab is [`client/src/components/ApplicantsTab.tsx`](../../client/src/components/ApplicantsTab.tsx), fed by `GET /api/facility/applicants` (react-query key `["/api/facility/applicants"]`).
> - There is **no** endpoint that returns a job seeker's full profile to a facility today.
> - The status enum was only `pending | viewed | shortlisted` — no `rejected`/`archived`.
> - There is **no** resume/document store, recruiter-notes table, or status-history table for applicants — all net-new.
> - Applicants endpoints live under `/api/facility/*` behind `requireFacilityAuth` (Passport session) — **not** `/api/ops/*`, so no `requireOpsPermission` RBAC and no subscription paywall. Tenant isolation is by `facility_number` scope on the `applicant_interests` row.

---

## 1. Feature Overview

### Problem
A facility operator can see an applicant summary card and change status, but cannot review the candidate — the credentials, license expiries, full work history, education, availability, and bio the seeker already filled in are not reachable from the Applicants tab. There is no UI path and no API that returns a full profile to a facility. Facilities triage blind: they email/call to re-collect data the candidate already typed in, or reject on thin info. Both hurt conversion and trust.

### User value
- **Facility:** make a real shortlist/reject decision in one place, in seconds, without leaving the list.
- **Job seeker:** the profile they invested time in actually gets seen — fewer "send me your resume" round-trips.

### Business value
- **Conversion:** shortlist→hire is the core funnel; a usable review surface lifts it directly.
- **Stickiness / paywall pull:** recruiter productivity (notes, history, export) is the operational value that justifies staying on (and upgrading to) the Operations plan.
- **Defensibility:** "every applicant pre-filled a structured profile, reviewable instantly" beats an inbox of PDFs.
- **Auditability:** centralized review + notes + status history creates a hiring record consistent with the app's Title 22 / licensing posture.

### Primary roles
| Role | Source | In scope |
|---|---|---|
| Facility user (owner/operator) | Passport session, `facility_accounts`, `req.user.facilityNumber` | Primary actor — review, status, notes, export |
| Facility team member | `facility_users` membership table (Phase 3 seam, write-only-future) | Forward-compatible, not built now |
| Job seeker | `job_seeker_accounts` + `job_seeker_profiles` | Subject — owns the data |
| System/Audit | append-only history + `ops_audit_trail` pattern | Records who viewed/changed what |

---

## 2. User Stories

**Facility operator (review)**
- Click an applicant to see their full profile in a panel without leaving the tab.
- See license/cert expiry status at a glance (valid / expiring / expired).
- Shortlist or reject directly from the open profile.
- Read full work history and bio, not just "5 years".

**Facility admin / team collaboration**
- Leave an internal note teammates see but the applicant never does.
- See who changed status and when (no double-contact).
- Copy a deep link to an applicant's profile.
- Export an applicant profile to PDF for an offline hiring file.

**Job seeker (subject)**
- Only the facility I applied to sees my profile — not every facility.
- Blank fields simply don't show (no "null").
- Internal notes are invisible to me.

**Mobile & desktop**
- Desktop: list stays visible beside the profile for fast queue triage.
- Mobile: profile opens full-screen with large tap targets for shortlist/reject.
- Slow network: panel opens instantly with skeletons; the list never blocks.

---

## 3. Functional Requirements

### Open the profile
- **FR-1** Each applicant row/card is clickable to open the full profile; a labelled **"View profile"** button is also present (no icon-only).
- **FR-2** Opening does not navigate away; the list stays mounted (scroll/filters/selection preserved).
- **FR-3** The open profile is deep-linkable via `#/facility-portal?tab=applicants&applicant=<externalId>`.
- **FR-4** Opening a `pending` applicant auto-transitions to `viewed` server-side (idempotent, recorded in history).

### Sections shown (sourced from existing tables)
| Section | Source | Notes |
|---|---|---|
| Summary header | `applicant_interests` + `job_seeker_profiles` | name, photo, city/state, years, applied-to job, status |
| Contact card | `job_seeker_profiles.phone/address/city/state/zip` + `job_seeker_accounts.email` | visible because they applied to you |
| Profile completion | computed | % of key fields present |
| Preferred roles | `job_seeker_profiles.jobTypes` (JSONB) + `applicant_interests.roleInterest` | chips |
| Work experience | `job_seeker_work_experience` | reverse-chronological |
| Education | none today | empty-state v1; table is Phase 2 |
| Certs/licenses | `job_seeker_credentials` | expiry badge logic below |
| Availability | derive from `employmentType`/jobTypes | dedicated field Phase 2 |
| Application answers | `applicant_interests.message` + `roleInterest` | candidate's own words |
| Resume/documents | none today | empty-state "No resume uploaded"; upload+viewer Phase 2 |
| Status history | `applicant_status_history` (new) | append-only timeline |
| Internal notes | `applicant_notes` (new) | recruiter-only, soft-deleted |

### Actions
- **FR-5** Status: Shortlist / Reject / Archive + revert to Pending/Viewed (enum extended — `rejected`/`archived` are new).
- **FR-6** Add / edit / delete internal note (soft-delete, audit-grade).
- **FR-7** Export profile to PDF (mirror tracker PDF pattern: pdfkit, US Letter, `Cache-Control: no-store`). *Phase 2.*
- **FR-8** "Message applicant" = `mailto:` in v1; in-app messaging Phase 2.

### Contact visibility
- **FR-9** Email/phone shown to the facility only because the candidate applied to them — enforced by `facility_number` scope. No global browsing.
- **FR-10** Optional: full contact unlocks on "Viewed" (already auto-set on open). Default = show on open.

### Audit
- **FR-11** Every status change + note mutation writes audit + `applicant_status_history`. Views recorded for the collaboration timeline.

### Certification expiry logic (computed server-side vs server "today")
- null `expiresAt` → **No expiry** (gray)
- ≥60 days out → **Valid** (green)
- 0–60 days → **Expiring soon** (amber)
- past → **Expired** (red)

### Empty / missing
- **FR-12** Null/empty fields omitted, not "null"/"N/A"; empty section = one muted line.
- **FR-13** Account with almost-empty profile still renders cleanly; low completion + "Limited profile" hint.

### Permissions
- **FR-14** Only a facility whose session `facilityNumber` matches the interest's may open profile/notes/history/export. Mismatch → 403/404, no data leak.
- **FR-15** Notes and history are facility-scoped — never on the job seeker API surface.

### Performance
- **FR-16** Detail endpoint p95 < 300 ms (one keyed read + 2–3 indexed joins).
- **FR-17** Drawer interactive < 150 ms perceived (open with skeleton; header hydrated from list cache).
- **FR-18** List endpoint cost unchanged — detail is a separate lazy call.

---

## 4. Detail Container — Comparison & Recommendation

| Pattern | Pros | Cons | Fit |
|---|---|---|---|
| Modal | focus, simple | blocks the list; cramped for dense data; weak mobile | ❌ |
| Split panel (always-on master-detail) | fast triage | eats width; weak tablet/mobile; bigger rebuild | ⚠️ later |
| Dedicated page | shareable, roomy, printable | loses list context/scroll; heavier routing | ⚠️ print target |
| **Right-side Drawer/Sheet (overlay)** | keeps list context; reuses `sheet.tsx`/`drawer.tsx`; full-screen on mobile for free; URL-syncable | slightly narrower than a page | ✅ |

**Recommendation: URL-synced right-side Drawer (Sheet), full-screen on mobile.** Preserves list state (FR-2) for queue triage, reuses a shipped component, degrades to a full-screen mobile experience, and with `?applicant=<externalId>` is deep-linkable (FR-3) — 80% of "dedicated page" shareability without the navigation cost. Keep a dedicated page only as the print/export target reusing the same data hook.

Widths: ~520px desktop, `min(100vw, 640px)` tablet, `100vw` mobile.

### Information architecture (single scroll column, sticky header + sticky action bar)
1. Drawer chrome: close · Prev/Next · Export
2. Summary header (avatar, name, applied-to job, location, years, status select)
3. Profile completion meter
4. Contact card
5. Application answers (message, roleInterest)
6. Certifications & licenses (expiry chips)
7. Work experience timeline
8. Education / Resume (empty-state v1)
9. Activity / status timeline
10. Internal notes panel (composer + list)
11. Sticky action bar: Reject · Add note · Shortlist

Prev/Next steps through the current filtered list without closing.

---

## 5. UI/UX Requirements

- **Desktop (≥1024):** drawer 520px overlay, list dims behind a scrim; `J`/`K` Prev/Next, `S` shortlist, `X` reject, `Esc` close.
- **Tablet (640–1024):** drawer ~80vw / 640px, sticky action bar.
- **Mobile (<640):** full-screen Sheet; sticky bottom action bar; **≥44×44px** targets; collapsible (accordion) sections.
- **Accessibility:** focus trap, `role="dialog"` + `aria-labelledby` (name), `Esc` closes + returns focus to row; text-labelled actions; status conveyed by text + color (color-blind safe); live-region announces status changes.
- **Loading:** skeleton; header hydrated from list-cache so the top is never blank.
- **Empty:** single muted line per empty section. **Missing profile:** header from account email + "hasn't completed their profile", still show application message.
- **Error:** inline retry inside drawer; 403/404 specific copy; list unaffected.
- **Visual hierarchy:** 13–14px body, 12px uppercase muted labels, 16–18px name; tight line-height.
- **Status chips:** Pending=slate, Viewed=blue, Shortlisted=green, Rejected=red, Archived=zinc. **Credential chips:** Valid=green, Expiring=amber, Expired=red, None=gray. Use Shadcn `Badge` variants.
- **Dark mode:** theme CSS variables only (`bg-card`, `text-muted-foreground`, `border`); status colors get tuned `dark:` variants.
- **List rows:** whole row clickable; hover `bg-muted/50`; open row = persistent left accent + tint; keep the inline status dropdown on the row.
- **Quick preview vs detail:** row = preview, drawer = detail (progressive disclosure).
- **Filter compat:** drawer reads the same filtered/sorted set; Prev/Next respects filters; status change = optimistic + undo toast (don't yank the row instantly).
- **Productivity:** keyboard queue nav, Prev/Next, optimistic status + undo, copy-deep-link, completion meter to triage complete profiles first.

---

## 6. Data Model

### Existing (reuse — no change)
```
job_seeker_accounts (id, email, …)
  └─1:1 job_seeker_profiles   (account_id, firstName, lastName, phone, address, city, state, zipCode,
                               profilePictureUrl, yearsExperience, jobTypes JSONB, bio)
  └─1:n job_seeker_credentials(account_id, kind, label, licenseNumber, issuingAuthority, issuedAt, expiresAt, notes)
  └─1:n job_seeker_work_experience(account_id, title, company, location, employmentType, startDate, endDate, description)

applicant_interests(id, externalId nanoid, jobSeekerId→accounts.id, facilityNumber→facilities.number,
                    jobId→job_postings.id, roleInterest, message, status, createdAt, updatedAt)
job_postings(id, externalId, facilityNumber, title, type, …)
```
**Key relationship:** `applicant_interests.jobSeekerId === job_seeker_accounts.id === profiles.account_id === credentials.account_id === work_experience.account_id`. One indexed read on the interest yields `accountId`; everything else joins on it. **The facility's right to see the profile derives entirely from the interest row's `facility_number`.**

```
job_postings 1──n applicant_interests n──1 job_seeker_account
                        │ facility_number
                        ▼
                  facility_accounts (the facility user)
```

### New tables (honor Phase 2 CHECK/composite-FK, Phase 3 audit/append-only, Phase 7 external_id, soft-delete policy)

**`applicant_status_history`** — append-only (`created_at` + `created_by` only, no `updated_*`, no trigger):
`id`, `interest_id`→composite FK `applicant_interests(id, facility_number)`, `facility_number`, `from_status`, `to_status` (CHECK enum), `changed_by` DEFAULT 'system', `created_at`, `note`.

**`applicant_notes`** — soft-delete (`deleted_at`/`deleted_by`), full audit columns + `updated_at` trigger:
`id`, `external_id` UNIQUE nanoid(12), `interest_id`→composite FK, `facility_number`, `body`, `created_at`/`updated_at`, `created_by`/`updated_by`, `deleted_at`/`deleted_by`, partial index `WHERE deleted_at IS NULL`.

**Composite UNIQUE** `applicant_interests(id, facility_number)` so the two child FKs can target it (Phase 2 composite-FK pattern).

**Status enum extension** — CHECK was `('pending','viewed','shortlisted')`; add `'rejected','archived'`. Update `interestStatusSchema` in `shared/schema.ts` + a migration that drops/re-adds the CHECK (additive, no backfill).

**Resume/documents (Phase 2, not built):** `job_seeker_documents(id, externalId, accountId, kind, storageKey, filename, mime, sizeBytes, uploadedAt)` + object storage + signed URLs.

### Frontend DTO
```ts
interface ApplicantFullProfile {
  interest: { externalId; status; roleInterest; message; createdAt; updatedAt; jobExternalId; jobTitle };
  profile: { firstName; lastName; phone; address; city; state; zipCode; profilePictureUrl;
             yearsExperience; jobTypes: string[]; bio } | null;
  credentials: Array<{ kind; label; licenseNumber; issuingAuthority; issuedAt; expiresAt;
                       expiryStatus: 'valid'|'expiring'|'expired'|'none' }>;
  workExperience: Array<{ title; company; location; employmentType; startDate; endDate; description }>;
  completion: { percent: number; missing: string[] };
  notes: Array<{ externalId; body; createdBy; createdAt; updatedAt }>;
  statusHistory: Array<{ fromStatus; toStatus; changedBy; createdAt }>;
}
```

---

## 7. API

All under `/api/facility/*`, `requireFacilityAuth`, scoped by session `facilityNumber`, errors via `respondError`/`AppError`, URLs use `externalId`.

### Existing
`GET /api/facility/applicants` → `ApplicantInterestWithProfile[]` (unchanged).

### New / extended
```
GET   /api/facility/applicants/:externalId                  → ApplicantFullProfile (auto-views pending)
PATCH /api/facility/applicants/:externalId                  { status } → updated interest (+ history)
GET   /api/facility/applicants/:externalId/notes            → { notes: [...] }
POST  /api/facility/applicants/:externalId/notes            { body } → 201 note
PATCH /api/facility/applicants/:externalId/notes/:noteId    { body } → note
DELETE/api/facility/applicants/:externalId/notes/:noteId    → 204 (soft-delete)
GET   /api/facility/applicants/:externalId/export.pdf       → application/pdf (Phase 2)
GET   /api/facility/applicants/:externalId/documents        → { documents: [] } (empty v1)
```

`GET /:externalId` **200** sample:
```json
{
  "interest": { "externalId": "a1B2c3D4e5F6", "status": "viewed", "roleInterest": "Caregiver, Med Tech",
    "message": "I have 5 years in RCFE settings and hold an active CNA.",
    "createdAt": 1748000000000, "updatedAt": 1748400000000, "jobExternalId": "Job9Kx12abc", "jobTitle": "Caregiver (PM shift)" },
  "profile": { "firstName": "Maria", "lastName": "Lopez", "phone": "(408) 555-0101", "city": "San Jose",
    "state": "CA", "zipCode": "95123", "profilePictureUrl": null, "yearsExperience": 5,
    "jobTypes": ["Caregiver","Med Tech"], "bio": "Compassionate caregiver focused on memory care." },
  "credentials": [
    { "kind": "CNA", "label": null, "licenseNumber": "C12345", "issuingAuthority": "CDPH",
      "issuedAt": "2021-02-01", "expiresAt": "2027-01-31", "expiryStatus": "valid" },
    { "kind": "MED_TECH", "label": null, "licenseNumber": null, "issuingAuthority": null,
      "issuedAt": "2023-05-01", "expiresAt": "2026-07-15", "expiryStatus": "expiring" }
  ],
  "workExperience": [
    { "title": "Caregiver", "company": "Sunrise ARF", "location": "San Jose, CA",
      "employmentType": "Full-time", "startDate": "2022-03", "endDate": null, "description": "Memory-care unit." }
  ],
  "completion": { "percent": 78, "missing": ["education","resume"] },
  "notes": [ { "externalId": "note_7Yh2", "body": "Strong DSP, call Tue", "createdBy": "42",
    "createdAt": 1748400000000, "updatedAt": 1748400000000 } ],
  "statusHistory": [ { "fromStatus": "pending", "toStatus": "viewed", "changedBy": "42", "createdAt": 1748400000000 } ]
}
```
**403** `{ "code": "FORBIDDEN", "message": "You don't have access to this applicant." }`
**404** `{ "code": "NOT_FOUND", "message": "Applicant not found." }`

Note body schema `.strict()` (Phase 6), `body` `z.string().min(1).max(5000)`.

---

## 8. Frontend Implementation Plan (React + wouter + TanStack Query)

```
client/src/components/applicants/
  ApplicantsTab.tsx              (existing — add row click + selected state + URL sync)
  ApplicantProfileDrawer.tsx     (Sheet container; focus trap; Prev/Next; keyboard)
    ApplicantProfileHeader.tsx
    ProfileCompletionMeter.tsx
    ContactCard.tsx
    ApplicationAnswers.tsx
    CredentialsList.tsx          (CredentialChip w/ expiryStatus)
    ExperienceTimeline.tsx
    EducationSection.tsx         (empty-state v1)
    DocumentsSection.tsx         (empty-state v1)
    StatusTimeline.tsx
    InternalNotesPanel.tsx       (Composer + list; reuse Notes patterns)
    StickyActionBar.tsx
  ApplicantProfileSkeleton.tsx
```
- **Hook:** `useApplicantProfile(externalId)` → `useQuery(["/api/facility/applicants", externalId], …, { enabled: !!externalId, placeholderData })` seeded from the list-cache row so the header renders instantly.
- **Mutations:** `usePatchStatus`, `useAddNote`, … optimistic on list row + detail; invalidate both keys on settle; undo toast on status.
- **URL sync:** `?applicant=<externalId>` via wouter; drawer `open = !!param`; closing clears the param only.
- **Routing:** no new route for the drawer; one thin `…/applicants/:externalId/print` route for PDF preview (server PDF primary).
- **Permission gating:** server-enforced; FE renders 403/404 state.
- **Reusable UI:** Sheet/Drawer, Badge, Button, Skeleton, Tooltip, DropdownMenu; reuse Notes Composer mutation patterns.
- **Responsive:** Tailwind responsive widths; `100vw` under `sm`; Accordion sections on mobile; sticky bottom bar with safe-area inset.

---

## 9. Backend Implementation Plan

- **Migrations:** edit Drizzle defs → `db:generate` → augment with composite UNIQUE, CHECK drop/re-add, FKs, `set_updated_at_epoch_ms()` trigger, partial index → `db:migrate`. Mirror tables in `server/db/bootstrap.ts` (fallback only).
- **Storage** (`server/storage.ts`): `getApplicantFullProfile(externalId, facilityNumber)` — one keyed interest read scoped by facility, parallel reads for profile/credentials/work-experience/notes/history, compute `expiryStatus` + `completion` server-side, read JSONB `jobTypes` directly. `setApplicantStatus(...)` updates + inserts history + audit, auto-`viewed` on first open. `addApplicantNote/editNote/softDeleteNote` reuse `actorId(actor)`.
- **Permissions:** `requireFacilityAuth` + `WHERE facility_number = req.user.facilityNumber` on every query; foreign/missing externalId → 0 rows → 404 (don't leak existence). No `/api/ops` RBAC.
- **Audit:** status + note mutations → audit row + `applicant_status_history`; views recorded (debounced).
- **File access (Phase 2):** signed URLs; never serve raw storage keys; scope by accountId reachable through the interest.
- **Caching/perf:** indexes on `applicant_interests(external_id)` (exists), `(facility_number, status)`, `applicant_notes(interest_id) WHERE deleted_at IS NULL`, `applicant_status_history(interest_id)`, and `credentials/work_experience(account_id)`. Per Phase 9, measure before adding more. Detail stays a separate lazy call.

---

## 10. Acceptance Criteria

- **AC-1** Clicking a row/"View profile" opens a right drawer with the full profile; the list stays mounted (scroll/filters preserved).
- **AC-2** Refresh re-opens the same applicant's drawer (URL `?applicant=` persists).
- **AC-3** Opening a `pending` applicant sets status `viewed` and adds a history entry.
- **AC-4** Past `expiresAt` → red "Expired"; ≤60d → amber "Expiring soon"; ≥60d → green "Valid"; null → gray "No expiry".
- **AC-5** Empty fields/sections are omitted or show a one-line empty state — never literal "null".
- **AC-6** Shortlist/Reject/Archive updates the row optimistically with undo, writes history, persists server-side.
- **AC-7** Adding an internal note shows it attributed + timestamped; the job seeker API never returns it.
- **AC-8** Facility A requesting a Facility B applicant gets 403/404 with no profile data.
- **AC-9** Export downloads a PDF with `Cache-Control: no-store` (Phase 2).
- **AC-10** Mobile (<640): full-screen, ≥44px actions, sections reachable by scroll/accordion.
- **AC-11** Detail endpoint <300 ms p95 on seeded data; header renders before network resolves.
- **AC-12** `Esc` closes (focus returns to row); `J`/`K` Prev/Next within the filtered set.
- **AC-13** Dark mode renders all sections/chips/action bar with adequate contrast.
- **AC-14** Out-of-enum status → 400 `VALIDATION_ERROR`; unknown body field → 400 (`.strict()`).

---

## 11. Edge Cases

| Case | Handling |
|---|---|
| Incomplete profile (account, no profile row) | header from email; "hasn't completed their profile"; still show application message; low completion |
| Resume removed / never existed | documents empty-state (no store in v1) |
| Same user applied to multiple jobs at one facility | each interest = its own list entry; profile shared but notes/status/history are per-interest; header shows which job |
| Restricted/private fields | only filled fields sent; contact gated by applied-to rule; notes never cross to seeker API |
| Expired certifications | shown with red chip + date; not hidden |
| Unauthorized / foreign externalId | WHERE-scoped → 0 rows → 403/404, no leak |
| Deleted job posting w/ existing applications | `jobId` nullable; `jobTitle` falls back to roleInterest / "Job no longer posted"; interest+profile stay reviewable |
| Seeker edits profile while drawer open | point-in-time read; stale-while-revalidate; refetch on focus |
| Mobile slow network | instant skeleton + header from list cache; parallel section loads; retry card; list never blocks |
| Concurrent status edits by teammates | last-write-wins on status; both writes in append-only history; undo toast |
| Soft-deleted note | excluded (`deleted_at IS NULL`); recoverable in DB |

---

## 12. Rollout Plan

**MVP (Phase 1):** detail endpoint (profile + credentials + work experience + completion); right Drawer with URL sync; status enum extended (`rejected`/`archived`) + sticky action bar + `applicant_status_history`; internal notes CRUD + soft-delete; auto-`viewed`; optimistic status + undo; Prev/Next; deep link; dark mode; mobile full-screen; skeletons.

**Phase 2:** PDF export + print route; resume/document upload + viewer (object storage + signed URLs); education + structured availability + dedicated skills; split-panel option; hover-card quick preview; in-app messaging; activate `facility_users` multi-staff.

**Analytics events:** `applicant_profile_opened` (source, device), `applicant_status_changed` (from→to), `applicant_note_added`, `applicant_exported`, `prev_next_used`, `drawer_time_open_ms`, `credential_expiry_warning_shown`, `incomplete_profile_viewed`.

**Success metrics:** % applicants whose profile is opened (target >70% in 2 weeks); shortlist/reject decision rate per opened profile; time-to-first-decision ↓; pending backlog age ↓; profiles reviewed per session ↑; drop in "request more info" mailto clicks; note adoption.

---

## 13. Engineering Handoff

**Recommended UX pattern:** URL-synced right-side Drawer (Sheet), full-screen on mobile; single scroll column with sticky summary header + sticky action bar; Prev/Next queue nav; progressive disclosure (row=preview, drawer=detail); text-labelled actions; dark-mode-aware status/expiry chips. Dedicated page reserved for print/export.

**Architecture summary:** reads ride existing facility auth (no `/api/ops` RBAC, no paywall); tenancy enforced by `facility_number` in the WHERE clause through the interest row (the interest is the access-control hinge). One detail endpoint fans out by `accountId` (= `jobSeekerId`); expiry + completion computed server-side; JSONB read directly. Two new tables (`applicant_notes` soft-deleted+audited, `applicant_status_history` append-only) + status-enum CHECK migration + composite UNIQUE on `applicant_interests(id, facility_number)`, via drizzle-kit + bootstrap mirror. Errors via `respondError`/`AppError`; URLs via `nanoid(12)`.

**Prioritized build checklist**
1. Migration: status-enum CHECK expansion + composite UNIQUE + `applicant_status_history` + `applicant_notes` (+ bootstrap mirror).
2. Storage: `getApplicantFullProfile`, `setApplicantStatus` (+history), notes CRUD; expiry/completion compute.
3. Routes: `GET /:externalId`, extend `PATCH /:externalId`, notes endpoints — `respondError`, `.strict()` bodies, tenant WHERE.
4. FE shell: `ApplicantProfileDrawer` + URL sync + selected-row state + skeleton/placeholder.
5. FE sections: header, contact, application answers, credentials chips, experience, empty-states.
6. FE actions: sticky bar, optimistic status + undo, notes panel, Prev/Next + keyboard.
7. Polish: dark mode, a11y (focus trap, labels, live region), mobile full-screen, analytics events.
8. Tests: tenant-isolation 403 (A vs B), enum validation, soft-delete note exclusion, expiry-status boundaries, auto-`viewed` idempotency.
9. Phase 2: PDF export, documents/resume, education/availability/skills.

**Risks & mitigations**
| Risk | Mitigation |
|---|---|
| Privacy — first-time exposure of seeker PII/credentials to facilities | hard tenant scope; only applied-to facility sees data; notes never reach seeker API; record views for audit; add a seeker-facing notice |
| Enum migration breaks CHECK | additive only, no backfill; update shared const + drop/re-add CHECK in one migration; test on a Neon branch first |
| Cross-tenant FK leakage | composite FK `(id, facility_number)` on both child tables (DB-enforced) |
| N+1 / list latency | detail is a separate lazy call; index `account_id`; never eager-join into the list |
| Scope creep (docs/messaging) | Phase 2 with empty-states in v1; object storage deferred |
| Stale data while drawer open | stale-while-revalidate + refetch-on-focus; status/notes are their own audited mutations |
| Mobile usability of dense data | full-screen sheet, accordions, 44px targets, sticky bar with safe-area inset |
