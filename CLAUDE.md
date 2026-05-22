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
  - `pages/notes/NotesPage` — dedicated split-pane Notes reader at `#/facility-portal/notes`. URL-driven state (`?group&noteId&q&archived`); resizable splitter persists to `localStorage["notes.paneWidth"]` (clamped 280–640px). Shares the embedded feed's existing `Composer`, `ReplyBox`, mutation patterns, and the `/api/ops/notes` REST contract via `client/src/components/notes/`; the embedded `<NotesContent>` feed inside Operations tab is unchanged and now deep-links here. Auth-gated by the same facility session — redirects to `/facility-portal` on 401.
- **Map**: `MapView.tsx` wraps MapLibre GL. Facility pins are clustered; clicking a cluster zooms in; clicking a pin opens `FacilityPanel`.
- **UI components**: Shadcn/ui (`client/src/components/ui/`) — do not edit these directly; regenerate with the shadcn CLI.

### Shared (`shared/`)

- `schema.ts` — All Drizzle table definitions and inferred TypeScript types. Single source of truth for DB schema and Zod validation schemas. `server/db/schema.ts` re-exports from here.
- `etl-types.ts` — `FacilityDbRow` type, `typeToGroup()` mapping, `TYPE_TO_NAME` lookup, `formatPhone()` — used by both server and ETL scripts.

### Tracker Module

Config-driven tracker system under [shared/tracker-schemas/](shared/tracker-schemas/). Adding a tracker is a registry entry — no new routes, no DB migration, no shell changes (assuming an existing render pattern fits).

**Registered trackers** (9, see [shared/tracker-schemas/index.ts](shared/tracker-schemas/index.ts) `TRACKER_REGISTRY`):

| Slug | Pattern | requiresResident | Alerts |
|---|---|---|---|
| `adl` | Grid (goals × residents) | yes | — |
| `vitals` | Detailed-only, custom `vitals-range` renderer | yes | critical out-of-range per VitalType |
| `toileting` | Detailed-only, custom `toileting` renderer (Bristol scale) | yes | — |
| `hygiene` | Grid | yes | — |
| `skin_check` | Detailed-only, conditional-required via `superRefine` | yes | critical on `severity === "severe"` |
| `seizure` | Detailed-only, conditional intervention | yes | critical on duration ≥ 300s OR `seizure_type === "status_epilepticus"` |
| `sleep` | Grid | yes | — |
| `inventory` | Detailed-only | **no** | — |
| `cleaning` | Detailed-only | **no** | — |

**Key files.**
- Definitions: `shared/tracker-schemas/<slug>.ts`. Each exports a `TrackerDefinition`, a Zod payload schema, and an optional `historySummary`/`alerts`.
- Server router: [server/trackers/entries/entriesRouter.ts](server/trackers/entries/entriesRouter.ts) — single + bulk POST, PATCH, soft-delete, CSV export, **PDF export**, list + versions.
- Storage: [server/trackers/trackerStorage.ts](server/trackers/trackerStorage.ts) — Drizzle/Postgres, paginated cursor-based reads, soft-delete + version snapshots.
- Reports: [server/trackers/reports/](server/trackers/reports/) — `pdfRenderer.ts` (pdfkit, US Letter) + `reportQueries.ts` (facility letterhead lookup).
- Client shell: [client/src/components/tracker/](client/src/components/tracker/) — `TrackerShell`, `QuickEntryGrid`, `DetailedEntryForm`, `HistoryTab`, `ExportCsvDialog`, `ExportPdfDialog`. Renders any tracker from its serialized definition; per-tracker `historySummary` callbacks live in the shared registry and are imported locally on the client (functions don't cross the wire).
- Alerts subsystem: [shared/tracker-schemas/alerts.ts](shared/tracker-schemas/alerts.ts) (rule types + helpers), evaluator runs per-entry on insert/update, persists to `tracker_alerts`. v1 supports `payload-matches` style rules only — cross-entry/cron rules (cluster detection, missing-for-N-days) are deferred.

**Adding a new tracker (config-fit case).**
1. Create `shared/tracker-schemas/<slug>.ts` (clone closest existing definition: grid → Hygiene/Sleep, event-style with conditional fields → Skin Check/Seizure, facility-level → Inventory/Cleaning).
2. Register in [shared/tracker-schemas/index.ts](shared/tracker-schemas/index.ts) — both the import + `TRACKER_REGISTRY` entry + named re-exports.
3. Add an integration test in `server/__tests__/trackers/<slug>.test.ts` — must call `bootstrapTrackersSchema()` in `beforeAll` so the new `tracker_definitions` row exists.
4. CSV + PDF exports work for free (registry-driven).
5. Run `npm run check` and `npx vitest run --project server server/__tests__/trackers/`.

**Deprecation history.**
- The `skin_check` goal in the Hygiene tracker is deprecated as of `7a6eb65`. New Hygiene entries with `goal_id: "skin_check"` are rejected; legacy entries remain readable in History via `HYGIENE_GOAL_LABEL["skin_check"] = "Skin check (legacy)"`.

**PDF reports.**
`GET /api/ops/trackers/:slug/entries/export.pdf` mirrors the CSV endpoint exactly — same auth, validation, 92-day cap, `Cache-Control: no-store`, soft-delete exclusion. Response sets `X-Tracker-Export-Count` for the client toast. Renderer buffers all rows up-front because resident-grouped state-audit ordering can't stream.

### Two Auth Systems

**Facility auth** — Passport.js `LocalStrategy` + server-side sessions. Stored in `facility_accounts`. The `requireAuth` middleware in `routes.ts` protects facility-specific endpoints.

**Job seeker auth** — Custom session-based auth using `req.session.jobSeekerId`. Stored in `job_seeker_accounts`. Protected by `requireJobSeekerAuth` middleware (`server/middleware/requireJobSeekerAuth.ts`). The `AuthContext` on the client manages this state.

Both flows use 6-digit OTP email verification (15-minute expiry) and support password reset via the same OTP mechanism.

### Role-based permissions (Phase 3)

Every `/api/ops/*` route is action-gated. The middleware chain on `opsRouter` is:

1. `requireFacilityAuth` — Passport session check (401 if missing).
2. `requireActiveSubscription` — Operations paywall (402 if not active/trialing).
3. `opsRouter.param("facilityNumber")` — IDOR guard so `req.user.facilityNumber === :facilityNumber` (403 otherwise).
4. `requireOpsPermission(resource, action)` — RBAC check (403 with `{ success: false, error: "Forbidden" }`).

**`resolveRole(req)`** in [server/ops/permissions.ts](server/ops/permissions.ts) reads `req.user.role` (the `facility_accounts.role` column hydrated by `passport.deserializeUser`) and maps it to an `OpsRole` via `KNOWN_DB_TO_OPS_ROLE`. Existing DB rows default to `"facility_admin"` → OpsRole `"admin"`, so historical accounts keep full CRUD without a data migration. Unknown DB role strings fall back to `"admin"` AND emit a `console.warn` so operations can spot drift.

**Adding a new role.**
1. Add the string to the `OpsRole` type union in [server/ops/permissions.ts](server/ops/permissions.ts).
2. Add a `KNOWN_DB_TO_OPS_ROLE` entry mapping the DB column value to the new OpsRole.
3. Add an entry to `ROLE_PERMISSIONS` with the action list (mirror `ADMIN_ALL` / `AUDITOR_READ_ONLY` for scope).
4. Document the role in [server/__tests__/permissions/denyPath.test.ts](server/__tests__/permissions/denyPath.test.ts) with allow + deny scenarios.

**Adding a new resource.**
1. Add a key to `OPS_RESOURCES` (the resource-string registry).
2. Append a `Permission` entry to `ADMIN_ALL` listing every action admin can take.
3. Append a `Permission` entry to `AUDITOR_READ_ONLY` (typically `["read"]`).
4. Wire `requireOpsPermission(OPS_RESOURCES.NEW_KEY, "<action>")` into each route in `server/ops/opsRouter.ts`.
5. Auditor share-link traffic uses a separate router with `requireAuditorToken` — auditor permission matrix is irrelevant there.

**Auditor share-link traffic** does NOT flow through `resolveRole`. It uses `requireAuditorToken` on a parallel router and has its own scope/audience enforcement.

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
| `STRIPE_SECRET_KEY` | Stripe API key (`sk_test_...` / `sk_live_...`) — required for `/api/billing/*`; absent ⇒ checkout returns 503 |
| `STRIPE_WEBHOOK_SECRET` | Webhook signing secret (`whsec_...`) from `stripe listen` or the Dashboard endpoint config |
| `STRIPE_PRICE_ID_OPS_PRO_MONTHLY` | Stripe Price ID for the $99/month Operations plan (created in the Dashboard) |
| `STRIPE_CHECKOUT_SUCCESS_URL` | Where Stripe redirects after a successful Checkout, e.g. `.../#/facility-portal?billing=success` |
| `STRIPE_CHECKOUT_CANCEL_URL` | Where Stripe redirects on a cancelled Checkout |
| `STRIPE_PORTAL_RETURN_URL` | Where the Stripe Customer Portal returns the user when they close it |

**Local Stripe webhook testing**: `stripe listen --forward-to localhost:5000/api/billing/webhook` — copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`. The webhook route is mounted with `express.raw()` BEFORE the global JSON parser so Stripe's signature verification sees the unparsed body.

### Deployment

Deployed on Fly.io. `npm run deploy` runs `fly deploy`. Sessions and the SQLite DB persist via a Fly volume. The ETL enrichment child process writes to the same SQLite file using WAL mode for concurrent reads.
