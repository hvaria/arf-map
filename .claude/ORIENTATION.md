# Facility Operations Module — Orientation

## Stack
- **Runtime**: Node.js ESM + TypeScript, compiled via tsx
- **Framework**: Express 5.x
- **Database**: SQLite (better-sqlite3) + Drizzle ORM
- **Frontend**: React 18 + Vite + Wouter (hash routing) + TanStack Query + Shadcn/ui + Tailwind CSS
- **Auth**: Passport.js LocalStrategy (facility) + custom session (job seeker via req.session.jobSeekerId)
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
All new tables are bootstrapped via idempotent `sqlite.exec()` calls in `server/storage.ts`.
Drizzle table definitions live in `shared/schema.ts`.

## New Module Namespace
- **API**: `/api/ops/*` (mounted in server/index.ts, never modifying server/routes.ts)
- **Frontend**: `/#/portal/*` (new routes added to App.tsx Switch)
- **Auth**: Reuses `requireAuth` — all portal routes require facility auth

## New Table Naming Convention
All new tables prefixed with ops_ to avoid collisions:
- ops_residents, ops_assessments, ops_care_plans, ops_daily_tasks
- ops_medications, ops_med_passes, ops_controlled_sub_counts, ops_med_destruction
- ops_incidents
- ops_leads, ops_tours, ops_admissions
- ops_billing_charges, ops_invoices, ops_payments
- ops_staff, ops_shifts, ops_facility_settings, ops_compliance_calendar

## Key Decisions
1. facility_number (TEXT) is the foreign key linking all ops tables to a facility
2. All timestamps stored as INTEGER (Unix ms) — consistent with existing tables
3. No new ORM/migration frameworks — follow existing CREATE TABLE IF NOT EXISTS pattern
4. portal auth reuses facility Passport session (requireAuth middleware)
