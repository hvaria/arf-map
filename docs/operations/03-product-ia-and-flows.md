# Phase 3 — Product / UX: IA and Flows

> **Status:** DRAFT — awaiting Phase 3 gate review.
> **Scope (per Phase 2 gate):** Wave 0 (F1–F4 foundation) + Wave 1
> (W11, W7, W5, W9, W10, W13). Roadmap stubs for Waves 2–4 in §10.
> **Constraint:** Stay inside the existing OperationsTab shell. No new
> design system. Reuse `bg-indigo-50/100`, `#1E1B4B` headings, the
> `FormField` + `AddXDialog` pattern, capitalized status badges, the
> `portal-tabs` shell, `portal-num` tabular numerics, and the existing
> tone palette (emerald = ok, amber = warn, red = danger, slate = info).
> **Constraint:** Wireframes-as-text per Phase 0 choice. ASCII mockups
> below; no Figma needed.
> **Audience:** Senior FE + Senior BE for Phase 4. Eng Lead for sequencing.

---

## 1. IA decision: where Wave 0 + Wave 1 land

### 1.1 Existing OperationsTab sidebar (do not reorder)

```
Dashboard
Residents
eMAR
Tasks
Incidents
Trackers
Compliance
CRM
Billing
Staff
Calendar
```

### 1.2 New sidebar item

Add **one** new sub-view between Compliance and CRM:

```
…
Compliance
+ Audit Readiness          ← NEW (Wave 0 + Wave 1)
CRM
…
```

Rationale:
- Adding 5+ new top-level items (one per Wave 1 workflow) bloats a
  sidebar that already has 11 entries.
- "Audit Readiness" is semantically distinct from Compliance, which
  stays the daily-obligation list (and evolves into the obligation
  engine in Wave 2). Audit Readiness is the *binder + the prep
  surface*.
- One new item is the smallest IA change that delivers Wave 1.

### 1.3 Inside Audit Readiness — tabbed hub

The new sub-view uses the existing `portal-tabs` shell:

```
┌─── Audit Readiness ────────────────────────────────────────────────┐
│ [Overview] [Drills] [Logs] [Vendors] [Complaints] [Inspections] ⚙ │
└────────────────────────────────────────────────────────────────────┘
```

- **Overview** — Wave 3 W1 daily triage; renders an "empty hub"
  placeholder during Wave 1 with a roadmap teaser.
- **Drills** — W5 fire / disaster drill log.
- **Logs** — W7 temperature log (extensible: cleaning, maintenance
  appear here in Wave 4 if scoped in).
- **Vendors** — W9 vendor COI tracker.
- **Complaints** — W10 complaint intake / investigation / closure.
- **Inspections** — W13 inspection log.
- **⚙ (gear, Admin role only)** — F1 Reg Settings, Auditor user
  management (Wave 3 → ungated then), Evidence storage status.

### 1.4 W11 lands in eMAR, not Audit Readiness

W11 (Controlled-Substance Reconciliation Surface) reuses existing
`ops_controlled_sub_counts` data. It belongs *inside* eMAR as a new
tab beside the day-grid view:

```
┌─── eMAR ─────────────────────────────────────────────┐
│ [Today] [Day picker] [Controlled Subs]  ← NEW tab    │
└──────────────────────────────────────────────────────┘
```

This keeps med-related work in one place and exploits the fact that
no new tables are needed.

### 1.5 Wave 0 foundational placements

| Foundation | Where it appears in IA |
|---|---|
| F1 `facility_reg_settings` | Audit Readiness → ⚙ → "Reg Settings". Admin-only |
| F2 `evidence_attachment` | No top-level surface. Lives as the `<AttachEvidence>` component used inside every form (Wave 1 dialogs) |
| F3 `audit_trail` | No top-level surface in Wave 1. Lives as the `<AuditTrailButton>` icon on every Wave 1 detail view (opens a side panel). Top-level viewer is Wave 2 W15 |
| F4 Auditor role | Schema + role-check middleware only in Wave 0. Share-link / dedicated viewer is Wave 3 |

---

## 2. Visual language (reused, not invented)

All Wave 1 screens use existing patterns. The table below is the
canonical reference — Phase 4 implementation must not deviate.

| Element | Pattern (existing) | Source |
|---|---|---|
| Page heading | `<h1 className="text-xl font-semibold" style={{ color: '#1E1B4B' }}>` | `ComplianceContent.tsx:281` |
| Primary action | `<Button variant="gradient">` | `ComplianceContent.tsx:282` |
| Section subheading | `<h2 className="text-sm font-medium text-muted-foreground">` | `ComplianceContent.tsx:323` |
| Form field | `<FormField label … required error hint>` | `components/operations/FormField.tsx` |
| Submit-on-Enter | `onKeyDown={onSubmitKey(submit)}` + hint chip | `ComplianceContent.tsx:198` |
| Status badge (capitalize) | `bg-{tone}-100 text-{tone}-700 border-{tone}-200 px-1.5 py-0.5 text-xs rounded capitalize` | shared |
| Tone palette | emerald = ok, blue = pending, amber = warn/late, red = danger/overdue, slate = info/refused, yellow = held | `EmarContent.tsx:55-62` |
| Tile (KPI/summary) | `rounded-lg p-3 text-center` + `bg-{tone}-50 border-{tone}-200` | `ComplianceContent.tsx:289-302` |
| Empty state | dashed border + lucide icon + muted text | `ComplianceContent.tsx:315-318` |
| Loading state | `Skeleton` row repeats × N | `ComplianceContent.tsx:311-313` |
| Group-by-month list | `Object.entries(grouped).map…` with month subheading | `ComplianceContent.tsx:321` |
| Tabs | `portal-tabs` wrapper + `<Tabs>` shadcn | `StaffContent.tsx:386-391` |
| Tabular numerics | `portal-num` class | (CSS) |
| Border-left tier on card | `border-l-{tone}-500` | `EmarContent.tsx:56-62` |
| Card hover | `transition-colors hover:bg-stone-50/50` | `OperationsTab.tsx:351` |
| Focus ring | `focus-visible:ring-2 focus-visible:ring-primary` | shared |
| Existing thresholds (will move into F1) | `APPROACHING_MED_MINUTES = 60`, `APPROACHING_COMPLIANCE_DAYS = 30`, `APPROACHING_LICENSE_DAYS = 30` | `OperationsTab.tsx:211-213` |

**New component patterns introduced in Wave 0** (reused across Wave 1):

### 2.1 `<AttachEvidence>` (F2)

Used inside every Wave 1 dialog. Mobile-first because the cook /
caregiver enters from a tablet or phone.

```
┌─ Evidence ─────────────────────────────────────────────┐
│ [+ Add photo or file]   2 attached                     │
│                                                         │
│ [thumb] kitchen_fridge_05-13.jpg    1.2 MB  [×]        │
│ [icon ] CCLD_acknowledgment.pdf      88 KB  [×]        │
│                                                         │
│ PDF, JPG, PNG · 5 MB max each                          │
└────────────────────────────────────────────────────────┘
```

- Drag-and-drop on desktop, system file picker on mobile.
- Inline thumbnail for images; lucide file icon for PDFs.
- Single-line metadata (filename + size).
- Remove only allowed before the parent form is saved; after save,
  removal writes to `audit_trail` (Wave 0 F3).

### 2.2 `<AuditTrailButton>` (F3)

A 24×24 icon button on every Wave 1 detail/edit view. Click opens a
side panel listing change events (actor, action, when, before/after
preview). Read-only in Wave 1.

```
┌─ Edit Vendor — ABC Pharmacy ──────────[ ⊙ History ]───┐
│                                                         │
│ Name  ABC Pharmacy                                     │
│ COI expires  2026-08-30                                │
│ License #   12345                                      │
│ Status  active                                         │
│                                                         │
└────────────────────────────────────────────────────────┘
       └─→ panel slides in from right ──┐
            ┌────────────────────────┐
            │ History — ABC Pharmacy │
            ├────────────────────────┤
            │ 2026-05-12 14:22       │
            │ Himanshu T · Updated   │
            │   COI expires:         │
            │     2026-07-15  →      │
            │     2026-08-30         │
            ├────────────────────────┤
            │ 2026-03-01 09:10       │
            │ Himanshu T · Created   │
            └────────────────────────┘
```

### 2.3 `<RegSettingsField>` (F1)

Used inside the Reg Settings page (Wave 0). One row per reg key.

```
Hot water max temperature           [110 ] °F      ⓘ
  └ Default per common practice. Replace with your validated value.
    Source: ─                                    [Set source…]
```

- Placeholder values show a small `[V]` badge.
- Tooltip explains what behavior the value drives.
- Optional `source` text field for the admin to note where they got
  the validated value (e.g., "Title 22 §87303(g) per CCLD analyst
  on 2026-05-10").

### 2.4 `<StatusBadge>`

Direct extension of the tone palette in `EmarContent.tsx:55-62`.
New labels added for Wave 1:

| Label | Tone | Used by |
|---|---|---|
| Out of range | red | W7 temperature log readings |
| In range | emerald | W7 |
| Resolved | emerald | W7, W11 |
| Unresolved | red | W11 |
| Scheduled | blue | W5 |
| Executed | emerald | W5 |
| Behind cadence | red | W5 (Wave 4 calc; placeholder Wave 1) |
| Expired | red | W9 |
| Expiring | amber | W9 |
| Active | emerald | W9 |
| Open | red | W10, W13 |
| Investigating | amber | W10 |
| Resolved | emerald | W10 |
| Cited | red | W13 |
| Remediating | amber | W13 |
| Closed | slate | W10, W13 |

---

## 2.5 Implementation Contract (binding on Phase 4 and all subsequent code)

> **Directive (2026-05-13):** "Any implementation must be consistent
> with the existing frontend and existing ecosystem."

Phase 4 and the implementation that follows must respect this
contract. Code review and QA reject any deviation.

### 2.5.1 What "consistent" means here

A Phase 4 ticket is acceptable when:

1. **Every new UI element cites the existing pattern it extends.**
   Reference `file.tsx:line`. If no pattern exists, the doc must say
   "no existing pattern — proposing new primitive" with a one-paragraph
   justification.
2. **No new design system or alternate convention.** The Wave 1 tone
   palette, status-badge shape, tile shape, modal shape, form-field
   pattern, page-heading style, and table layout reuse exactly what
   `ComplianceContent.tsx`, `StaffContent.tsx`, `IncidentsContent.tsx`,
   and `EmarContent.tsx` already use.
3. **No new shell wrappers around shadcn primitives.** Tabs go through
   the existing `portal-tabs` wrapper. Dialogs follow the existing
   `<AddXDialog>` skeleton (header → `space-y-3` body → `flex gap-2
   justify-end` footer → kbd-Enter hint chip).
4. **No new request envelope or query-key shape.** Endpoints return
   `{ success, data }`; query keys are URL-shaped strings
   (`[\`/api/ops/.../resource\`]`) usable by `getQueryFn`.
5. **No new auth flow.** Reuse `requireAuth` (facility) /
   `requireJobSeekerAuth` (seeker) middlewares; do not introduce a
   parallel session model. Auditor-role checks add to `requireAuth`,
   not beside it.
6. **No new file-storage pattern.** F2 `evidence_attachment` writes
   through one storage adapter; Wave 1 forms call the same `<AttachEvidence>`
   component — never a hand-rolled upload widget.
7. **No new date / timezone helper.** Reuse `toLocalEpochMs`,
   `todayLocal`, the existing `isoDate`/`addDays`/`fmt12` helpers
   already inside the operations components.
8. **No new toast or error pattern.** Reuse `useToast()` with
   `variant: "destructive"` for errors, success toasts on mutation
   success — matches every `*Content.tsx` already in the repo.
9. **Drizzle table conventions.** New tables follow the existing
   `ops_*` snake_case, `bigint` epoch timestamps via the `ts()` helper
   in `server/ops/opsSchema.ts`, `text` for enums, `integer DEFAULT 0`
   for booleans, `BIGSERIAL` primary keys, `facility_number TEXT NOT
   NULL` for tenancy. Bootstrap with `CREATE TABLE IF NOT EXISTS`.
10. **No new router shape.** Wave 1 endpoints mount under the existing
    `/api/ops/*` namespace through the `opsRouter` shell, not a new
    Express app or sub-app.

### 2.5.2 Component reuse map (mandatory)

| New UI element | Existing pattern it extends | Cite |
|---|---|---|
| Status badge | `STATUS_CFG` tone palette | `EmarContent.tsx:55-62` |
| Summary tile (Open / Expiring / Out-of-range counters) | "Summary bar" grid pattern | `ComplianceContent.tsx:289-302` |
| Group-by-month list | `groupByMonth` helper + month subheading + per-row card | `ComplianceContent.tsx:207-215, 320-380` |
| Form field | `<FormField>` + `onSubmitKey` | `client/src/components/operations/FormField.tsx` |
| `+ Add` modal | `<AddComplianceDialog>` skeleton | `ComplianceContent.tsx:55-204` |
| Tabbed sub-view | `portal-tabs` wrapper + shadcn `<Tabs>` | `StaffContent.tsx:386-391` |
| Inline back-to-overview | `<button onClick={onBack}>` with `ArrowLeft` | `ComplianceContent.tsx:270-278` |
| Loading skeleton | `Array.from({ length: N }).map(...<Skeleton …/>)` | `ComplianceContent.tsx:311-313` |
| Empty state | dashed border + lucide icon + muted text | `ComplianceContent.tsx:315-318` |
| Error banner | `bg-destructive/10 border-destructive/30 p-4 text-sm text-destructive` | `ComplianceContent.tsx:305-307` |
| KPI/dashboard tile (Wave 3) | `<KpiCard>` | `OperationsTab.tsx:339-396` |
| Mutation pattern | `useMutation` + invalidate `[\`/api/ops/...\`]` + toast | every `*Content.tsx` |

### 2.5.3 Things that would break the contract

- A new file-upload widget anywhere outside `<AttachEvidence>`.
- A new color used for "active" / "warn" / "danger" that is not
  emerald / amber / red.
- A dialog whose footer does not have `[Cancel]` on the left of the
  primary action.
- A status string that isn't lowercase + rendered with `capitalize`.
- An endpoint returning anything other than `{ success, data }` (or
  `{ success: false, error }`).
- A new top-level sidebar item not approved in §1.
- Hand-rolled date formatting instead of `toLocalEpochMs` /
  `todayLocal` / `fmt12`.
- A migration tool other than the existing
  `CREATE TABLE IF NOT EXISTS` bootstrap inside `bootstrapOpsSchema()`.

### 2.5.4 How Phase 4 enforces this

- Every Phase 4 ticket lists, in its description, the **existing
  pattern reused** with file:line citations.
- `code-reviewer` agent runs against the diff and rejects any
  deviation; deviation requires an explicit one-paragraph "no existing
  pattern" justification approved by the user.
- If a deviation is approved, it is captured back into this doc as a
  new "added pattern" row, with citation pointing at the new file.
- The user has feedback memory `feedback_align_with_existing_ecosystem.md`
  (re-confirmed 2026-05-13) carrying this directive forward in
  perpetuity across sessions.

---

## 3. Screen specifications — Wave 0

### 3.1 Reg Settings (F1)

**Entry:** Audit Readiness → ⚙ → Reg Settings. Admin role only.

**Goals:**
- Make the 14 BLOCKING `[V]` placeholders visible and editable.
- Show what behavior each value drives.
- Capture a provenance note ("set by / on / source") for inspector
  credibility.

**Layout (desktop):**

```
┌─────────────────────────────────────────────────────────────────────┐
│ Reg Settings                                            [Save All] │
│                                                                     │
│ Some values below are defaults per common practice and are marked  │
│ [V]. Replace them with your validated values from Title 22 / CCLD. │
│                                                                     │
│ ─── Environment ────────────────────────────────────────────────── │
│   Hot water max temperature  [110] °F  [V]  ⓘ                     │
│     Source note  [_______________________________]                  │
│                                                                     │
│   Refrigerator max temperature  [40] °F  [V]  ⓘ                   │
│   Refrigerator min temperature  [32] °F  [V]  ⓘ                   │
│   Freezer max temperature       [ 0] °F  [V]  ⓘ                   │
│                                                                     │
│ ─── Incident SLAs ──────────────────────────────────────────────── │
│   CCLD verbal notification — serious bodily injury / death          │
│     within  [ 2] hours  [V]  ⓘ                                     │
│   CCLD verbal notification — non-emergent                           │
│     within  [24] hours  [V]  ⓘ                                     │
│   LIC 624 written submission — within [ 7] days  [V]  ⓘ           │
│   SOC 341 abuse report — within     [ 2] hours [V]  ⓘ              │
│                                                                     │
│ ─── Drills ─────────────────────────────────────────────────────── │
│   Fire drills per shift per quarter   [ 1] drill  [V]  ⓘ          │
│   Disaster drill cadence              [Every 6 months ▼]  [V]  ⓘ  │
│                                                                     │
│ ─── Staff credentials ──────────────────────────────────────────── │
│   TB clearance — initial within        [ 7] days  [V]  ⓘ          │
│   TB renewal cadence                   [Annual ▼]  [V]  ⓘ         │
│   Fingerprint clearance required before resident contact [✓] [V]   │
│   CPR / First Aid renewal              [Every 24 months ▼]  [V]   │
│                                                                     │
│ ─── Retention ──────────────────────────────────────────────────── │
│   Default record retention             [ 3] years  [V]  ⓘ         │
│                                                                     │
│ ─── Postings (Wave 4) ──────────────────────────────────────────── │
│   Bilingual posting threshold language  [English only ▼]  [V]  ⓘ  │
└─────────────────────────────────────────────────────────────────────┘
```

**States:**
- **Loading:** skeleton rows for each section.
- **Empty:** never empty — defaults always present.
- **Normal:** as above; `[V]` badge stays until the admin clears the
  source-note field meaning "I replaced this with a validated value."
- **Blocked:** non-Admin role sees `Read-only — contact your administrator`.
- **Resolved:** every `[V]` cleared = banner reads "All values validated for this facility · last reviewed YYYY-MM-DD".

**Copy guidelines:**
- Section headings sentence case ("Incident SLAs" — proper noun OK).
- Help tooltip text under 140 characters.
- `[V]` badge tooltip: "Default value, not validated for your facility. Replace with the value from Title 22 or your licensing analyst."

---

## 4. Screen specifications — Wave 1

### 4.1 W11 — Controlled-Substance Reconciliation (eMAR tab)

**Entry:** Operations → eMAR → tab "Controlled Subs"

**Goal:** Surface every unresolved `ops_controlled_sub_counts.discrepancy = 1 AND resolved = 0` row, with the count history, witnesses, and a closure action.

**Layout:**

```
┌─ eMAR ──────────────────────────────────────────────────────────────┐
│ [Today]  [Day picker]  [Controlled Subs]                            │
├─────────────────────────────────────────────────────────────────────┤
│ Controlled Substances                                               │
│                                                                     │
│  ┌─── Open discrepancies ───────────────┐ ┌─── Resolved (30d) ────┐│
│  │  3                                    │ │  12                   ││
│  │  unresolved counts                    │ │  resolved this month  ││
│  └───────────────────────────────────────┘ └───────────────────────┘│
│                                                                     │
│ Unresolved (3)                                                      │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Lorazepam 1 mg  ·  Resident: Jane K.                            │ │
│ │ NOC count 2026-05-12  ·  counted: Maria S.  witness: Anil P.    │ │
│ │ Opening 18  · Administered 2  · Closing 14   · Expected 16      │ │
│ │ Discrepancy: −2     ✗ Unresolved                  [Resolve →]   │ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ Oxycodone 5 mg  ·  Resident: Tom L.   …                         │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ Resolved (last 30 days)  [▼]                                        │
└─────────────────────────────────────────────────────────────────────┘
```

**Resolve dialog:**

```
┌─ Resolve Discrepancy — Lorazepam ───────────────────────────────┐
│ Closing note (required)                                          │
│ [_____________________________________________________________ ] │
│                                                                  │
│ Witnessed by   [Anil P. ▼]                                      │
│ Evidence       [+ Add photo or file]                            │
│                                                                  │
│              [Cancel]   [Save & resolve]    Enter to save       │
└──────────────────────────────────────────────────────────────────┘
```

**States:**
- **Loading:** 3 skeleton rows.
- **Empty:** "No controlled-substance discrepancies. Counts are reconciled." emerald-tinted card.
- **Normal:** unresolved list grouped by drug.
- **Overdue:** any row whose discrepancy is > 7 days old shows an amber "Aging" chip; > 30 days = red "Overdue review" chip.
- **Resolved:** row collapses into the "Resolved" accordion below.

**Copy:**
- "Counts are reconciled." (empty)
- "Resolve discrepancy" (button)
- "Closing note (required)" — disambiguate from MAR notes.

---

### 4.2 W7 — Temperature Logs

**Entry:** Operations → Audit Readiness → tab "Logs"

**Goal:** Daily temperature entries per fixture (fridge, freezer, hot water at resident faucet, dish machine). Out-of-range readings auto-flag and create a follow-up obligation.

**Layout:**

```
┌─ Audit Readiness ───────────────────────────────────────────────────┐
│ [Overview] [Drills] [Logs ●] [Vendors] [Complaints] [Inspections]  │
├─────────────────────────────────────────────────────────────────────┤
│ Temperature Logs                                  [+ Record reading]│
│                                                                     │
│   ┌─── Today (5/13) ──┐ ┌─── Out of range ─┐ ┌─── Last reading ──┐ │
│   │ 7 / 8             │ │ 1                │ │ Hot water — Rm 3  │ │
│   │ fixtures logged   │ │ unresolved       │ │ 30 min ago        │ │
│   └───────────────────┘ └──────────────────┘ └───────────────────┘ │
│                                                                     │
│ Fixtures                                                            │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Fridge — Kitchen 1                              In range   ✓   │ │
│ │ Last: 38 °F · 06:45  ·  Yesterday: 37, 38, 39  ·  7-day OK    │ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ Hot water — Resident bathroom 3      Out of range  ✗  ⚠       │ │
│ │ Last: 118 °F · 13:02  ·  Threshold: ≤ 110 °F                  │ │
│ │ Follow-up obligation created · due 2026-05-14                  │ │
│ │                                       [View readings] [Resolve]│ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ Freezer — Kitchen                               In range   ✓   │ │
│ │ Last: −5 °F · 06:50                                            │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ + Add fixture …                                                     │
└─────────────────────────────────────────────────────────────────────┘
```

**"Record reading" dialog (mobile-optimized — cook taps from kitchen):**

```
┌─ Record reading ────────────────────────┐
│ Fixture   [Fridge — Kitchen 1 ▼]       │
│ Reading   [ 38 ] °F                    │
│ When      [Today 06:45]                │
│ Recorded  [Maria S. ▼]   (auto)        │
│ Note      [____________________________]│
│ Evidence  [+ Add photo (optional)]      │
│                                         │
│             [Cancel]   [Save]   Enter ↵ │
└─────────────────────────────────────────┘
```

If the reading violates the fixture's threshold (from F1 reg settings), the save shows:

```
┌─ Out of range ────────────────────────────────────────────┐
│ This reading (118 °F) exceeds the threshold (110 °F).      │
│                                                            │
│ A follow-up obligation will be created and assigned to     │
│ you, with a due date of tomorrow.                          │
│                                                            │
│            [Cancel]   [Save anyway & create follow-up]    │
└────────────────────────────────────────────────────────────┘
```

**States:**
- **Loading:** 3 fixture-row skeletons.
- **Empty (no fixtures):** "Add the first fixture you log daily — typically Fridge, Freezer, and Hot Water." [+ Add fixture]
- **Normal:** all-green list.
- **Overdue/at-risk:** any fixture with no reading today by 14:00 surfaces a `Missing today` amber chip; an out-of-range reading shows red.
- **Blocked:** non-Admin can record readings but cannot add/remove fixtures.
- **Resolved:** the "1 unresolved" tile flips back to "0".

---

### 4.3 W5 — Drill Log

**Entry:** Operations → Audit Readiness → tab "Drills"

**Goal:** Record fire / disaster / other drills with shift, scenario, evacuation time, participants, debrief. (Cadence calc is Wave 4; Wave 1 ships *logging* only.)

**Layout:**

```
┌─ Audit Readiness ───────────────────────────────────────────────────┐
│ [Overview] [Drills ●] [Logs] [Vendors] [Complaints] [Inspections]  │
├─────────────────────────────────────────────────────────────────────┤
│ Drills                                              [+ Log drill]   │
│                                                                     │
│   ┌── This quarter ──┐  ┌── Last 12 mo ───┐  ┌── Last drill ─────┐│
│   │ 4 drills         │  │ 14 drills        │  │ Fire · AM         ││
│   │ Fire 3 · Dis. 1  │  │ Avg evac 2:14    │  │ 4 days ago        ││
│   └──────────────────┘  └──────────────────┘  └───────────────────┘│
│                                                                     │
│ Recent (12 months)                                                  │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Fire drill · AM shift           2026-05-09  10:14 AM           │ │
│ │ Leader: Maria S. · 6 staff · 8 residents · Evac 1:58          │ │
│ │ Scenario: Kitchen fire                          Executed       │ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ Disaster drill · table-top       2026-04-22  PM shift          │ │
│ │ Leader: Himanshu T. · Scenario: 72-hr power outage             │ │
│ │ Debrief notes:  …                                Executed       │ │
│ └─────────────────────────────────────────────────────────────────┘ │
│                                                                     │
│ ⓘ Quarter cadence enforcement arrives in a later release; today    │
│   you can log drills freely.                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**"Log drill" dialog:**

```
┌─ Log drill ─────────────────────────────────────────────┐
│ Drill kind     [Fire ▼]   Other options: Disaster,      │
│                            Active threat, Other          │
│ Shift          [AM ▼]                                   │
│ Scenario       [Kitchen fire____________________]       │
│ Executed at    [2026-05-13]  [10:14]                    │
│ Leader         [Maria S. ▼]                             │
│ Participants   [+ Add staff]    6 added                 │
│ Residents      [+ Add residents (optional)]             │
│ Evacuation     [ 1:58 ] mm:ss   (optional)              │
│ Debrief        [_______________________________________]│
│ Corrective     [+ Add corrective action]                │
│ Evidence       [+ Add sign-in sheet photo / file]       │
│                                                          │
│              [Cancel]   [Save drill]     Enter ↵        │
└──────────────────────────────────────────────────────────┘
```

**States:**
- **Loading / Empty / Normal:** as patterns.
- **Empty:** "No drills logged yet. Most facilities log fire drills monthly. [+ Log your first drill]"
- **Wave 4 hook:** the "Quarter cadence enforcement arrives in a later release" sentence is permanent until Wave 4 ships; then it's replaced with a `Quarter status: 3 of 4 required, on track` chip.

---

### 4.4 W9 — Vendor COI Tracker

**Entry:** Operations → Audit Readiness → tab "Vendors"

**Goal:** One row per vendor with COI expiry, license expiry, vendor type, and a renewal nudge surface.

**Layout:**

```
┌─ Audit Readiness ───────────────────────────────────────────────────┐
│ [Overview] [Drills] [Logs] [Vendors ●] [Complaints] [Inspections]  │
├─────────────────────────────────────────────────────────────────────┤
│ Vendors                                              [+ Add vendor] │
│                                                                     │
│   ┌── Active ──┐  ┌── Expiring (60d) ──┐  ┌── Expired ─────┐       │
│   │ 12         │  │ 2                  │  │ 1              │       │
│   └────────────┘  └────────────────────┘  └────────────────┘       │
│                                                                     │
│  Filter: [All ▼]  [Expiring within ▼]                              │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ ABC Pharmacy            pharmacy   COI: 2026-08-30  ✓ Active   │ │
│ │ Pest-Pro Services       pest       COI: 2026-06-04  ⚠ Expiring │ │
│ │ Linen Co                linen      COI: 2025-12-15  ✗ Expired  │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

**"Add vendor" dialog (compact two-column):**

```
┌─ Add vendor ───────────────────────────────────────────┐
│ Name             [_____________________________]        │
│ Type             [pharmacy ▼]   options: food, pest,    │
│                                 medical, maintenance,…  │
│ Contact name     [_____________________________]        │
│ Contact phone    [_____________________________]        │
│ COI expires      [YYYY-MM-DD]                          │
│ License expires  [YYYY-MM-DD]  (optional)              │
│ Notes            [_____________________________]        │
│ Evidence         [+ Add COI PDF]                       │
│                                                         │
│            [Cancel]   [Save]     Enter ↵               │
└─────────────────────────────────────────────────────────┘
```

**States:**
- **Empty:** "No vendors yet. Start with your pharmacy and food vendor."
- **Expiring:** amber chip + days remaining. Threshold from F1 reg settings (default 60 days).
- **Expired:** red chip; row surfaces to W1 triage in Wave 3.

---

### 4.5 W10 — Complaints

**Entry:** Operations → Audit Readiness → tab "Complaints"

**Goal:** Intake → investigation → resolution → closure. Complaint log exportable in Wave 3 W2 pre-audit pull.

**Layout:**

```
┌─ Audit Readiness ───────────────────────────────────────────────────┐
│ [Overview] [Drills] [Logs] [Vendors] [Complaints ●] [Inspections]  │
├─────────────────────────────────────────────────────────────────────┤
│ Complaints                                           [+ Log complaint]│
│                                                                     │
│  ┌── Open ──┐  ┌── Investigating ──┐  ┌── Resolved (90d) ──┐       │
│  │ 1        │  │ 2                  │  │ 7                  │       │
│  └──────────┘  └────────────────────┘  └────────────────────┘       │
│                                                                     │
│ Open & investigating                                                │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ Family · daughter of resident B.        Received 2026-05-10    │ │
│ │ Nature: meal quality                    Status: Investigating  │ │
│ │ Assigned: Himanshu T.                                          │ │
│ │                                                  [Open →]      │ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ Anonymous · ombudsman referral          Received 2026-05-12    │ │
│ │ Nature: staffing levels                 Status: Open           │ │
│ │                                                  [Open →]      │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

**Detail view (drill-down — slides over or new screen):**

```
┌─ Complaint #142 ────────────────────────────[ ⊙ History ]─────────┐
│ Received  2026-05-10                                               │
│ From      Family · daughter of resident B.                         │
│ Nature    Meal quality                                             │
│ Assigned  Himanshu T.                                              │
│ Status    Investigating                                            │
│                                                                     │
│ ─── Intake notes ──────────────────────────────────────────────── │
│ "Caller says her mother has skipped lunch 4 times this week …"     │
│                                                                     │
│ ─── Investigation log ─────────────────────────────────────────── │
│ 2026-05-11 · Interviewed cook                                      │
│ 2026-05-12 · Reviewed dietary order                                │
│ [+ Add investigation note]                                         │
│                                                                     │
│ ─── Resolution ────────────────────────────────────────────────── │
│ Not yet resolved.    [Add resolution & close →]                    │
│                                                                     │
│ Evidence:  [+ Add file]    1 attached                              │
└────────────────────────────────────────────────────────────────────┘
```

**States:**
- **Empty:** "No complaints logged. Inspectors expect *some* complaint history — even minor ones. Log walk-up concerns here too."
- **Open:** red "Open" badge.
- **Investigating:** amber.
- **Resolved:** emerald.
- **Closed:** slate (post-resolution archival).
- **Anonymous handling:** complainant fields can stay blank; intake notes still required.

---

### 4.6 W13 — Inspection Log

**Entry:** Operations → Audit Readiness → tab "Inspections"

**Goal:** Record every inspector visit (CDSS CCLD, Ombudsman, Fire Marshal, Health Dept, internal/corporate). Citations link to corrective-action obligations (linkage formalized in Wave 2; Wave 1 captures the text and due date).

**Layout:**

```
┌─ Audit Readiness ───────────────────────────────────────────────────┐
│ [Overview] [Drills] [Logs] [Vendors] [Complaints] [Inspections ●]  │
├─────────────────────────────────────────────────────────────────────┤
│ Inspections                                       [+ Log inspection]│
│                                                                     │
│  ┌── This year ──┐  ┌── Open citations ──┐  ┌── Next due ──────┐  │
│  │ 3 visits      │  │ 1                  │  │ Annual: 2026-12  │  │
│  └───────────────┘  └────────────────────┘  └──────────────────┘  │
│                                                                     │
│ History                                                             │
│ ┌─────────────────────────────────────────────────────────────────┐ │
│ │ CDSS CCLD · annual                       2026-02-14            │ │
│ │ Inspector: A. Garcia · Findings: 0      Status: Closed         │ │
│ │                                                  [Open →]      │ │
│ ├─────────────────────────────────────────────────────────────────┤ │
│ │ Ombudsman · complaint follow-up          2026-05-04            │ │
│ │ Cited: posting #2 missing                Status: Remediating   │ │
│ │                                                  [Open →]      │ │
│ └─────────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────────┘
```

**"Log inspection" dialog:**

```
┌─ Log inspection ───────────────────────────────────────┐
│ Inspector org   [CDSS CCLD ▼]                          │
│ Purpose         [Annual ▼]   complaint, follow-up, …   │
│ Visit date      [2026-05-13]                           │
│ Inspector name  [_____________________________]         │
│                                                          │
│ Findings        [+ Add finding]                         │
│ Citations       [+ Add citation]    each: title + due  │
│ Evidence        [+ Add inspection report]              │
│                                                          │
│              [Cancel]   [Save]                          │
└──────────────────────────────────────────────────────────┘
```

**States:**
- **Empty:** "No inspections logged. Log past visits to build a closed-loop history."
- **Cited:** red badge; citation count chip on the row.
- **Remediating:** amber; counts open vs. closed citations.
- **Closed:** slate.

---

### 4.7 Audit Readiness — Overview tab (Wave 1 placeholder)

```
┌─ Audit Readiness ───────────────────────────────────────────────────┐
│ [Overview ●] [Drills] [Logs] [Vendors] [Complaints] [Inspections]  │
├─────────────────────────────────────────────────────────────────────┤
│ Welcome to Audit Readiness                                          │
│                                                                     │
│ Use this hub to keep your inspection binder healthy day to day.    │
│ Today you can:                                                      │
│                                                                     │
│   • Record drills (Fire, Disaster)                                  │
│   • Log temperature readings                                        │
│   • Track vendor COIs                                               │
│   • Intake and close complaints                                     │
│   • Record inspection visits                                        │
│                                                                     │
│ Coming next: staff credential matrix, incident lifecycle closer,    │
│ daily triage screen, and one-click pre-audit bundle.                │
│                                                                     │
│ [Open Reg Settings ⚙]                                              │
└─────────────────────────────────────────────────────────────────────┘
```

This is Wave 1's placeholder. Wave 3 W1 replaces it with the live
daily triage.

---

## 5. State design summary (every Wave 1 screen)

| Screen | Loading | Empty | Normal | Overdue / at-risk | Blocked | Resolved |
|---|---|---|---|---|---|---|
| Reg Settings | 4 section skeletons | n/a (defaults) | inline edit per row | n/a | non-Admin read-only banner | banner "All values validated · last reviewed YYYY-MM-DD" |
| W11 Controlled Subs | 3 row skeletons | "Counts are reconciled." | unresolved list grouped by drug | Aging (>7d, amber) / Overdue review (>30d, red) | non-Admin sees the list but `Resolve` button is hidden | row collapses into "Resolved (30d)" accordion |
| W7 Temperature Logs | 3 fixture row skeletons | "Add the first fixture you log daily…" | green-checked fixtures | "Missing today" (amber after 14:00) / "Out of range" (red) | non-Admin can record but not add/remove fixtures | "Out of range" tile flips 1 → 0 |
| W5 Drills | 3 row skeletons | "No drills logged yet. Most facilities log fire drills monthly." | history list | n/a in Wave 1 (Wave 4 adds "Behind cadence") | n/a (any logged-in role can log) | n/a |
| W9 Vendors | 3 row skeletons | "No vendors yet. Start with your pharmacy and food vendor." | filterable list | Expiring (amber chip + days) / Expired (red) | non-Admin read-only | renewal accepted = chip flips emerald |
| W10 Complaints | 3 row skeletons | "No complaints logged. Log walk-up concerns here too." | open & investigating | Open (red) / Investigating (amber) | anonymous intake supported | Resolved (emerald) → Closed (slate) |
| W13 Inspections | 3 row skeletons | "No inspections logged. Log past visits to build history." | history list | Cited (red) / Remediating (amber) | n/a | Closed (slate) |

---

## 6. UX copy guidelines

### 6.1 Voice & tone
- **Direct, calm, operator-grade.** No marketing voice. No emoji.
- **Future-friendly to fix-the-gap nudges.** Phrasing like "next action" beats "you forgot."
- **Action labels are imperatives.** "Log drill", "Resolve discrepancy", "Add vendor".
- **No regulation citations in product copy.** Even when behavior comes from a reg, the UI says what is *true for this facility*, not the rule. Reg details live in tooltips and the Reg Settings page.

### 6.2 Status verbs (consistent across Wave 1+)

| Verb | When | Where |
|---|---|---|
| Log | record an event after the fact | Drills, Inspections |
| Record | enter a measurement | Temperature, MAR |
| Open | start working on an item | Complaints, Inspections |
| Resolve | close a single anomaly | Temperature out-of-range, Controlled-sub discrepancy |
| Close | final-state an entity | Complaints, Inspections, Incidents |
| Renew | re-up an expiry | Credentials (Wave 2), Vendor COI |

### 6.3 Empty-state pattern

> "[What's missing]. [What the user can do]. [+ Single primary action]."

Examples:
- "No drills logged yet. Most facilities log fire drills monthly. [+ Log your first drill]"
- "No complaints logged. Log walk-up concerns here too. [+ Log complaint]"
- "Counts are reconciled." (no action — celebratory empty)

### 6.4 Error messaging

- Inline below the offending field, red text, single sentence.
- Server-side validation message wins over client-side if both fire.
- Never say "An error occurred." Say what failed and what to try.

### 6.5 Confirmation copy

- Destructive actions (delete vendor, void inspection): "This will be kept in history. Continue?"
- "Out of range" save confirmation (W7): see §4.2 box.
- Resolve / Close: never require a confirmation modal — the action itself is reversible (audit trail captures it).

### 6.6 `[V]` placeholder treatment

Every Wave 0 reg-setting value that hasn't been validated shows a
small amber `[V]` chip with this tooltip:

> "Default value, not validated for your facility. Replace with the validated value from Title 22 or your licensing analyst."

Removing the `[V]` requires the admin to enter a non-empty `Source
note`. This converts the regulatory unknown into a documented
decision.

---

## 7. Accessibility (must-haves)

- All form fields reuse `FormField` which already wires `aria-invalid`
  and `aria-describedby` against the error text.
- All status badges include the textual label (no color-only state).
- Tabular numerics use `portal-num` for monospace alignment.
- Every modal honors Enter-to-save (per existing pattern at
  `ComplianceContent.tsx:198`) and Esc-to-close.
- `<AttachEvidence>` mobile picker: triggers OS-native file chooser,
  preserves focus on the trigger button after close.
- `<AuditTrailButton>` is a real `<button>`, focusable, with
  `aria-label="View history for this item"`.

---

## 8. Roadmap stubs (Waves 2–4 IA)

These are *placeholders* so Phase 4 knows what shape Wave 1 must
support without overbuilding.

### 8.1 Wave 2

| Workflow | IA placement | Notes |
|---|---|---|
| W3 Staff credentials | **Staff** sub-view → new "Credentials" tab beside Directory / Schedule | `staff_credential` table; warns + blocks shift assignment for expired required cert |
| W4 Incident lifecycle closer | **Incidents** sub-view → extend existing detail view with SLA timer + checklist gate | Driven by F1 reg settings |
| W8 Chart completeness | **Residents** sub-view → new "Chart Completeness" surface or banner per resident chart | Aggregates `ops_admissions` LIC checkboxes |
| W15 Audit-trail viewer | Top-level "History" link on key entities; full audit explorer under Audit Readiness ⚙ → "Audit Trail" | Wave 2 backfills events into legacy tables |
| Obligation engine migration | Compliance sub-view evolves from list → obligation engine; `ops_compliance_calendar` rows migrate transparently | Backward-compatible API contract |

### 8.2 Wave 3

| Workflow | IA placement | Notes |
|---|---|---|
| W14 Daily summary email | No new screen; settings under Audit Readiness ⚙ → "Notifications" | Reuses Resend |
| W1 Daily triage | Audit Readiness → Overview tab (replaces Wave 1 placeholder) | Aggregator across all Wave 1+2 entities |
| Auditor share-link | Audit Readiness ⚙ → "Share with inspector"; dedicated read-only shell at `/#/auditor/{token}` | Watermarked, time-bounded |
| W2 Pre-audit pull | Audit Readiness → "Pre-audit pull" button on Overview tab | Bundle generator |

### 8.3 Wave 4

| Workflow | IA placement | Block on |
|---|---|---|
| W6 Posting verification | Audit Readiness → new "Postings" tab between Logs and Vendors | B12 validated |
| W12 Resident trust | New top-level **Billing** → "Trust accounts" tab; feature-flag per facility in F1 | B13 validated |
| Drill cadence calc | Wave 1 W5 surface replaces "coming later" sentence with quarter status chip | B9/B10 validated |

---

## 9. Risks called out in design review

1. **Audit Readiness vs. Compliance overlap.** Users may not know which sub-view owns what. Mitigation: the Compliance sub-view becomes the obligation engine in Wave 2; Audit Readiness becomes the binder + tools. Both names stay distinct.
2. **`<AttachEvidence>` mobile photo capture quality.** Photos taken in dim resident rooms may be unreadable. Out of scope for v0; add server-side compression / preview at Wave 2.
3. **Anonymous complaint handling.** Without PII, complainant fields stay blank — design must not break the layout when complainant is "—".
4. **Inspector view of `[V]` chips.** Auditors viewing the share-link should *see* `[V]` chips on reg settings — it demonstrates good-faith awareness of unvalidated defaults. Confirmed: keep visible in auditor view.
5. **Out-of-range save flow.** Cooks may dismiss the confirmation and lose context. Mitigation: the confirmation explicitly states a follow-up obligation will be created, so the work survives even if the cook clicks away.

---

## 10. Handoff to Phase 4 (engineering plan)

Phase 4 owners must produce, scoped to Wave 0 + Wave 1:

1. **Schema migrations** for `facility_reg_settings` (seed data), `evidence_attachment`, `audit_trail`, `staff_role` + Auditor flag, and Wave 1 tables (`temperature_log`, `drill_log`, `vendor`, `complaint`, `inspection`).
2. **API contracts** for `/api/ops/reg-settings`, `/api/ops/evidence`, `/api/ops/audit-trail` (read-only), and each Wave 1 entity (`/api/ops/temp-logs`, `/api/ops/drills`, `/api/ops/vendors`, `/api/ops/complaints`, `/api/ops/inspections`, plus the eMAR W11 surface as `/api/ops/controlled-sub/discrepancies`).
3. **Permission matrix** wired into the API layer.
4. **Audit-trail middleware** for the new mutation endpoints.
5. **Object storage adapter** for `evidence_attachment` (Fly volume v0; backup/restore story documented).
6. **AntiVirus / mime stance** for uploads (clamav-as-a-service consideration; or strict mime allow-list + size cap as v0).
7. **Out-of-range obligation auto-creation** hook for `temperature_log` inserts.
8. **Test plan** per workflow, including: role-based access; out-of-range threshold tuning; audit-trail emission; evidence attach/delete lifecycle.
9. **Deployment / migration plan** noting that `ops_compliance_calendar` is *not* touched in Wave 1 (Wave 2 migration plan separate).
