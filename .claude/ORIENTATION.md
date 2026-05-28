# Facility Operations Module — Orientation

## Stack
- **Runtime**: Node.js ESM + TypeScript, compiled via tsx
- **Framework**: Express 5.x
- **Database**: Postgres (Neon in prod / `pg` driver) + Drizzle ORM. Migrations via drizzle-kit; bootstrap SQL in `server/db/bootstrap.ts` + `server/ops/*Schema.ts` as fresh-DB fallback.
- **Frontend**: React 18 + Vite + Wouter (hash routing) + TanStack Query + Shadcn/ui + Tailwind CSS
- **Auth**: Passport.js LocalStrategy (facility) + custom session (job seeker via req.session.jobSeekerId). Session store: `connect-pg-simple` against the `session` table.
- **Email**: Resend API
- **Deploy**: Fly.io (fly.toml)

## Existing Tables (NEVER MODIFY)
| Table | Purpose |
|-------|---------|
| users | Legacy user table |
| facility_accounts | Facility owner login (linked to CCLD facility_number) |
| facility_overrides | Editable facility details (phone, description, website, email) |
| job_postings | Job listings posted by facilities |
| job_seeker_accounts | Job seeker login accounts |
| job_seeker_profiles | Job seeker extended profiles |
| facilities | Full CCLD licensed-care facility data (100k+ rows) |
| applicant_interests | Job seeker → facility interest expressions |

## Existing API Routes
- `GET/POST /api/facilities/*` — facility search, filter, autocomplete, meta
- `POST /api/auth/*` — facility register/login/logout/verify/forgot/reset
- `GET /api/facility/me` — authenticated facility account info
- `POST /api/facility/details` — update facility override details
- `GET/POST/DELETE /api/jobs/*` — job posting CRUD
- `GET /api/job-seeker/*` — job seeker auth + profile
- `GET/POST /api/interests/*` — applicant interest expressions
- `GET /api/admin/etl/*` — ETL triggers (admin only)

## Existing Frontend Routes (hash-based)
- `/#/` — MapPage (main map + search)
- `/#/stats` — StatsPage
- `/#/facility-portal` — FacilityPortal (dashboard for facility owners)
- `/#/job-seeker` — JobSeekerPage (public landing)
- `/#/jobseeker/login` — LoginPage
- `/#/jobseeker/dashboard` — DashboardPage

## Auth Middleware
- `requireAuth` — checks `req.isAuthenticated()` (Passport, facility accounts)
- `requireJobSeekerAuth` — checks `req.session.jobSeekerId`

## Schema Pattern
New schema changes go through drizzle-kit migrations: edit the Drizzle table
in `shared/schema.ts` (or the relevant `server/**/(...)Schema.ts`), run
`npm run db:generate`, then `npm run db:migrate`. The bootstrap SQL in
`server/db/bootstrap.ts` and `server/ops/*Schema.ts` is a `CREATE TABLE IF NOT
EXISTS` fresh-DB safety net only — do NOT add new tables there.
See CLAUDE.md "Working with Migrations" for the full workflow.

## New Module Namespace
- **API**: `/api/ops/*` (mounted in server/index.ts, never modifying server/routes.ts)
- **Frontend**: `/#/facility-portal` is the only canonical operations route. New operations UI lands inside `OperationsTab` as a new sub-view, or as a `*Content` component under `client/src/components/operations/`. The `/portal/*` route namespace was retired; only a `/portal/*` → `/facility-portal` redirect remains for legacy bookmarks. Do not reintroduce `/portal/*` routes.
- **Auth**: Reuses `requireFacilityAuth` — facility-portal and the ops API both require facility auth

## New Table Naming Convention
All new tables prefixed with ops_ to avoid collisions:
- ops_residents, ops_assessments, ops_care_plans, ops_daily_tasks
- ops_medications, ops_med_passes, ops_controlled_sub_counts, ops_med_destruction
- ops_incidents
- ops_leads, ops_tours, ops_admissions
- ops_billing_charges, ops_invoices, ops_payments
- ops_staff, ops_shifts, ops_facility_settings, ops_compliance_calendar

## Key Decisions
1. facility_number (TEXT) is the foreign key linking all ops tables to a facility. Composite FKs on (id, facility_number) enforce tenant integrity at the DB layer — see CLAUDE.md "Schema invariants (Phase 2)".
2. All timestamps stored as BIGINT (Unix ms) — consistent across the schema.
3. Schema changes go through drizzle-kit migrations (`npm run db:generate` / `npm run db:migrate`), not raw bootstrap edits.
4. portal auth reuses facility Passport session (requireAuth middleware)
