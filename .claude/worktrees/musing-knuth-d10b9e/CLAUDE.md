# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## MCP Tools: code-review-graph

**IMPORTANT: This project has a knowledge graph. ALWAYS use the
code-review-graph MCP tools BEFORE using Grep/Glob/Read to explore
the codebase.** The graph is faster, cheaper (fewer tokens), and gives
you structural context (callers, dependents, test coverage) that file
scanning cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes` or `query_graph` instead of Grep
- **Understanding impact**: `get_impact_radius` instead of manually tracing imports
- **Code review**: `detect_changes` + `get_review_context` instead of reading entire files
- **Finding relationships**: `query_graph` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview` + `list_communities`

Fall back to Grep/Glob/Read **only** when the graph doesn't cover what you need.

### Key Tools

| Tool | Use when |
|------|----------|
| `detect_changes` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context` | Need source snippets for review — token-efficient |
| `get_impact_radius` | Understanding blast radius of a change |
| `get_affected_flows` | Finding which execution paths are impacted |
| `query_graph` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes` | Finding functions/classes by name or keyword |
| `get_architecture_overview` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes` for code review.
3. Use `get_affected_flows` to understand impact.
4. Use `query_graph` pattern="tests_for" to check coverage.

---

## Commands

```bash
# Development
npm run dev           # Start dev server (Express + Vite HMR) on port 5000

# Build & production
npm run build         # Bundle client + server → dist/
npm start             # Run production build

# Type checking
npm run check         # tsc — no emit, just type errors

# Database
npm run db:push       # Push Drizzle schema changes to SQLite
npm run db:seed       # Seed facility overrides / accounts

# Facilities data ETL
npm run data:extract  # Extract raw CCLD data from CHHS open data API
npm run data:seed     # Seed the local facilities SQLite table

# Tests
npm test                              # All tests
npm run test:server                   # Server-only tests (Vitest project: server)
npm run test:client                   # Client-only tests
npx vitest run path/to/file.test.ts   # Single test file

# Mobile (Capacitor)
npm run mobile:build    # Build and sync to Capacitor
npm run mobile:android  # Open Android Studio
npm run mobile:ios      # Open Xcode

# Deploy (Fly.io)
npm run deploy
```

## Architecture

This is a **full-stack TypeScript monorepo** — one `package.json`, shared types in `shared/`, Express backend in `server/`, React frontend in `client/`, and Capacitor mobile wrappers in `ios/` and `android/`.

### Data flow: Facilities

The core data is California CCLD licensed-care facilities. There are two modes:

1. **SQLite-first (preferred)**: Run `npm run data:seed` to populate the `facilities` table from the CHHS open-data API. Routes query SQLite directly via `server/storage.ts` (`queryFacilitiesAll`, `searchFacilitiesAutocomplete`). `server/services/facilitiesService.ts:isDatabaseSeeded()` is the gate.

2. **Live-fetch fallback**: If the DB is empty, `facilitiesService.ts:getCachedFacilities()` fetches all facilities from two CHHS API endpoints (GeoJSON + CCL CSV), merges them, and caches in memory for 24 hours. Production runs a nightly enrichment job (`server/etlScheduler.ts`) at 2 AM UTC via `dist/enrich.cjs` as a child process.

### Server (`server/`)

- `index.ts` — Express + `express-session` + Passport.js setup; SQLite session store (`SqliteSessionStore`); trust proxy enabled for Fly.io TLS termination; pre-warms facility cache on startup.
- `routes.ts` — Main route file for facility auth, job postings, and job seeker auth/profile. Mounts three sub-routers: `jobseekerAuthRouter`, `adminEtlRouter`, `interestsRouter`.
- `storage.ts` — All SQLite read/write operations via Drizzle ORM. Schema bootstrapped with `CREATE TABLE IF NOT EXISTS` on startup (no migration runner needed).
- `services/facilitiesService.ts` — Dual-mode facility data (SQLite or CHHS live fetch), 24 h in-memory cache.
- `repositories/` — Clean-architecture pattern: `jobSeekerRepository.ts` (interface) + `sqlite/sqliteJobSeekerRepository.ts` (implementation). Only the job seeker auth flow has been migrated to this pattern; facility auth remains in `routes.ts`.
- `email.ts` — Transactional email via Resend (`RESEND_API_KEY`). Used for OTP verification and password reset.
- `auth.ts` — `bcrypt`-based `hashPassword` / `comparePassword` helpers.

### Client (`client/src/`)

- **Router**: `wouter` with hash-based routing (`useHashLocation`). All routes use `/#/path` form — important for Capacitor compatibility and static hosting.
- **State**: TanStack Query for server state. `AuthContext` (`context/AuthContext.tsx`) manages job seeker session; facility auth state is fetched via `useQuery(["/api/facility/me"])`.
- **Main pages**:
  - `MapPage` — primary view: MapLibre GL map + floating search/filter bar + right sidebar jobs panel + mobile bottom sheet.
  - `FacilityPortal` — facility owner dashboard (profile, job postings, applicants tab).
  - `JobSeekerPage` — public-facing job seeker landing with registration.
  - `jobseeker/DashboardPage` — authenticated job seeker dashboard (my interests, profile).
- **Map**: `MapView.tsx` wraps MapLibre GL. Facility pins are clustered; clicking a cluster zooms in; clicking a pin opens `FacilityPanel`.
- **UI components**: Shadcn/ui (`client/src/components/ui/`) — do not edit these directly; regenerate with the shadcn CLI.

### Shared (`shared/`)

- `schema.ts` — All Drizzle table definitions and inferred TypeScript types. Single source of truth for DB schema and Zod validation schemas. `server/db/schema.ts` re-exports from here.
- `etl-types.ts` — `FacilityDbRow` type, `typeToGroup()` mapping, `TYPE_TO_NAME` lookup, `formatPhone()` — used by both server and ETL scripts.

### Two Auth Systems

**Facility auth** — Passport.js `LocalStrategy` + server-side sessions. Stored in `facility_accounts`. The `requireAuth` middleware in `routes.ts` protects facility-specific endpoints.

**Job seeker auth** — Custom session-based auth using `req.session.jobSeekerId`. Stored in `job_seeker_accounts`. Protected by `requireJobSeekerAuth` middleware (`server/middleware/requireJobSeekerAuth.ts`). The `AuthContext` on the client manages this state.

Both flows use 6-digit OTP email verification (15-minute expiry) and support password reset via the same OTP mechanism.

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `SESSION_SECRET` | Express session signing key |
| `RESEND_API_KEY` | Transactional email (OTP, password reset) |
| `PORT` | Server port (default: 5000) |
| `NODE_ENV` | `development` enables Vite middleware; `production` serves static files and starts ETL scheduler |
| `ETL_HOUR_UTC` | Override nightly enrichment hour (default: 2) |
| `SKIP_PREWARM` | Set to skip facility cache pre-warm on startup |
| `DATABASE_URL` | SQLite file path (used by Drizzle Kit) |

### Deployment

Deployed on Fly.io. `npm run deploy` runs `fly deploy`. Sessions and the SQLite DB persist via a Fly volume. The ETL enrichment child process writes to the same SQLite file using WAL mode for concurrent reads.
