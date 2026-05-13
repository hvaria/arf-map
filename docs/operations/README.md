# Operations Tab — SDLC Workspace

This directory holds the structured artifacts produced while designing and
extending the Operations tab of the facility portal. Work proceeds in
**phase gates** — each phase must be reviewed and accepted before the next
phase begins.

## Engagement scope (confirmed 2026-05-13)

- **Focus:** Audit-readiness across the existing Operations sub-sections
  (Compliance, Staff, Incidents, Tasks, eMAR, Trackers, Notes, Residents,
  Admissions, CRM, Billing).
- **Admin source:** Simulated California RCFE administrator (synthesized
  from public CDSS / Title 22 Chap 8 domain knowledge). Every regulation
  claim must be marked for real-admin / CCLD validation. Nothing is
  assumed legally binding.
- **Branch:** `feature/operations-tab-discovery`

## Phase index

| Phase | Document | Owner role | Status |
|------|----------|-----------|--------|
| 1 | [01-admin-discovery.md](./01-admin-discovery.md) | Expert Admin (simulated) | ACCEPTED (2026-05-13, hybrid open-Q + wide scope + no §1–10 corrections) |
| 2 | [02-ba-requirements.md](./02-ba-requirements.md) | Business Analyst | DRAFT — awaiting gate review |
| 2b | [02b-prioritization.md](./02b-prioritization.md) | Eng Lead + Admin (simulated) | DRAFT — bundled with Phase 2 gate review |
| 3 | [03-product-ia-and-flows.md](./03-product-ia-and-flows.md) | Product / UX | ACCEPTED (2026-05-13) — incl. binding Implementation Contract §2.5 |
| 4 | [04-engineering-plan.md](./04-engineering-plan.md) | Senior FE + BE | ACCEPTED (2026-05-13) |
| 5 | [05-admin-validation.md](./05-admin-validation.md) | Expert Admin (simulated) | DRAFT — verdict **GO** subject to §7 checklist |

## Guardrails

1. Do not invent legal or regulatory rules. Anything regulation-dependent
   is marked `[NEEDS VALIDATION]` and lives in the Open Questions list of
   the relevant phase document.
2. Do not redesign the portal. Stay inside the Operations tab; respect
   existing IA, theme, and shared components.
3. Do not skip phase gates. UI mockups and code do not begin until
   Phase 3 is accepted; Phase 3 does not begin until Phase 2 is accepted.
4. Non-technical end users. Every flow must be obvious at a glance and
   completable without training.

## What already exists in Operations (baseline, do not duplicate)

Surveyed on branch creation; informs every phase below.

- **OperationsTab shell:** `client/src/components/OperationsTab.tsx`,
  gated by Operations Pro subscription
  (`client/src/lib/subscription.ts → isOperationsActive`).
- **Sub-sections present:**
  Residents, Admissions, Tasks, Incidents, eMAR, Compliance, Staff,
  Billing, CRM, Resident Profile, Notes (split-pane reader at
  `#/facility-portal/notes`), and the Trackers module (9 trackers:
  ADL, Vitals, Toileting, Hygiene, Skin Check, Seizure, Sleep,
  Inventory, Cleaning — see `shared/tracker-schemas/`).
- **Tracker reports:** CSV + PDF export endpoints
  (`/api/ops/trackers/:slug/entries/export.{csv,pdf}`), 92-day cap, soft-delete excluded.
- **Alerts subsystem:** `tracker_alerts` table populated by per-entry rule
  evaluation (`shared/tracker-schemas/alerts.ts`).
- **Notes:** REST contract under `/api/ops/notes` with notification badge
  on the Operations tab trigger.
