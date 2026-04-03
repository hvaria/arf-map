---
name: Job Seeker Auth Architecture
description: Production auth feature added for job seekers — repository pattern, SQLite session store, clean layered architecture
type: project
---

A full job seeker login feature was built on top of the existing ARF Map app.

**New files created:**
- `server/db/index.ts` — singleton SQLite connection (db + sqlite exported); replaces per-file DB setup
- `server/db/schema.ts` — re-exports @shared/schema
- `server/db/seed.ts` — seeds demo@arfcare.dev / Demo1234!; run with `npm run db:seed`
- `server/session/sqliteSessionStore.ts` — production SQLite session store replacing MemoryStore
- `server/repositories/jobSeekerRepository.ts` — interface (swap to swap DB)
- `server/repositories/sqlite/sqliteJobSeekerRepository.ts` — Drizzle-based SQLite impl
- `server/services/authService.ts` — pure business logic (no HTTP, no DB specifics)
- `server/middleware/requireJobSeekerAuth.ts` — express middleware + session type augmentation
- `server/routes/jobseekerAuth.ts` — clean login/logout/me/dashboard routes
- `client/src/lib/auth.ts` — fetch-based API client
- `client/src/context/AuthContext.tsx` — React context + useAuth hook
- `client/src/pages/jobseeker/LoginPage.tsx` — polished login UI at /#/jobseeker/login
- `client/src/pages/jobseeker/DashboardPage.tsx` — protected dashboard at /#/jobseeker/dashboard

**Modified files:**
- `shared/schema.ts` — added lastLoginAt, failedLoginCount, updatedAt to jobSeekerAccounts
- `server/storage.ts` — imports sqlite+db from server/db/index, adds column migrations for new fields + sessions/login_attempts tables
- `server/routes.ts` — mounts jobseekerAuthRouter at /api/jobseeker, removed inline login/logout/me handlers
- `server/index.ts` — SqliteSessionStore replacing MemoryStore, imports sqlite from db/index
- `client/src/App.tsx` — added AuthProvider, /jobseeker/login and /jobseeker/dashboard routes
- `package.json` — added `db:seed` script

**Key architecture rule:** Routes → AuthService → JobSeekerRepository interface → SqliteJobSeekerRepository. Login page never touches DB directly.

**Why:** User requested production-ready login with clean separation so SQLite can later be swapped for PostgreSQL/Snowflake without touching the UI.

**How to apply:** Future work on auth (OAuth, MFA, password reset) goes into authService.ts or new service files. New DB adapters implement JobSeekerRepository interface.
