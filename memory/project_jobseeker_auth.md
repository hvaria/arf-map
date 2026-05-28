---
name: Job Seeker Auth Architecture
description: Production auth feature for job seekers — repository pattern, Postgres session store, clean layered architecture
type: project
---

A full job seeker login feature lives on top of the ARF Map app.

**Key files:**
- `server/db/index.ts` — singleton Postgres pool (exports `db` + `pool`)
- `server/db/schema.ts` — re-exports `@shared/schema`
- `server/db/bootstrap.ts` — fresh-DB `CREATE TABLE IF NOT EXISTS` fallback; migrations are the source of truth
- Session store — `connect-pg-simple` against the `session` table (see `server/index.ts`); not a separate session-store module
- `server/repositories/jobSeekerRepository.ts` — interface (swap to swap backend)
- `server/repositories/postgres/pgJobSeekerRepository.ts` — Drizzle/pg implementation
- `server/services/authService.ts` — pure business logic (no HTTP, no DB specifics)
- `server/middleware/requireJobSeekerAuth.ts` — express middleware + session type augmentation
- `server/routes/jobseekerAuth.ts` — login/logout/me/dashboard routes
- `client/src/lib/auth.ts` — fetch-based API client
- `client/src/context/AuthContext.tsx` — React context + `useAuth` hook
- `client/src/pages/jobseeker/LoginPage.tsx` — login UI at `/#/jobseeker/login`
- `client/src/pages/jobseeker/DashboardPage.tsx` — protected dashboard at `/#/jobseeker/dashboard`

**Key architecture rule:** Routes → AuthService → JobSeekerRepository interface → PgJobSeekerRepository. Login page never touches DB directly.

**Why:** Production-ready login with clean separation so the storage backend can be swapped (Snowflake read layer, external IdP) without touching the UI.

**How to apply:** Future work on auth (OAuth, MFA, password reset) goes into `authService.ts` or new service files. New backends implement `JobSeekerRepository`.
