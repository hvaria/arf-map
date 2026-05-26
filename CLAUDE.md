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
npm run db:generate   # Generate a new migration from schema diff (run after editing schema files)
npm run db:migrate    # Apply pending migrations to the database (run in CI/deploy and locally on pull)
npm run db:push       # DEPRECATED — prefer db:migrate; kept for emergency dev use only
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

## Working with Migrations

Schema changes in this project follow a two-track system:

### The canonical workflow (migrations)

All new schema changes must go through `drizzle-kit` migrations:

1. **Edit the Drizzle table definition** in `shared/schema.ts`, `server/ops/opsSchema.ts`, `server/ops/notesSchema.ts`, or `server/trackers/trackerSchema.ts`.
2. **Generate a migration**: `npm run db:generate` — this diffs the current Drizzle schema against the last migration snapshot and writes a new `.sql` file to `migrations/`.
3. **Apply the migration**: `npm run db:migrate` — this runs all pending `.sql` files in order against the target database.

### When to run each command

| Command | When |
|---------|------|
| `npm run db:generate` | After editing any Drizzle schema file — creates the migration |
| `npm run db:migrate` | In CI/deploy pipelines AND locally after pulling changes that include new migrations |

### Bootstrap files — fallback only, do not edit for new schema

The bootstrap SQL files (`server/db/bootstrap.ts`, `server/ops/opsSchema.ts` `OPS_PG_SCHEMA_SQL`, `server/ops/notesSchema.ts` `NOTES_PG_SCHEMA_SQL`, `server/trackers/trackerSchema.ts` `TRACKERS_PG_SCHEMA_SQL`) remain as-is. They run `CREATE TABLE IF NOT EXISTS` at server startup as a safety net for fresh dev databases that have never had `db:migrate` run. They are **not** the source of truth for schema going forward.

- **Do NOT add new tables or columns to the bootstrap SQL.** New schema goes through the migration workflow above.
- The bootstrap functions (`bootstrapMainSchema`, `bootstrapOpsSchema`, etc.) are not deleted — they remain as idempotent fallbacks.
- `db:push` is deprecated in favor of `db:migrate`. It bypasses the migration history and should only be used in true emergencies on a dev-only database.

### Migration file location

All migration SQL files live in `migrations/`. The `drizzle-kit` journal (`migrations/meta/_journal.json`) tracks which migrations have been applied. Never hand-edit files in `migrations/` — always use `npm run db:generate`.

---

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

### Schema invariants (Phase 2)

The Phase 2 R1 structural lockdown (`migrations/0001_phase_2_structural_lockdown.sql`) added enforced invariants that every new schema change MUST preserve. Breaking any of these requires an explicit migration and a heads-up to backend-engineer.

**Foreign keys + composite tenant integrity.** Every child→parent reference in the ops_*, notes_*, and tracker_* schemas is a real FK now — not a soft FK by naming convention. The standard pattern is:

- **`ON DELETE RESTRICT`** for clinical / financial parents (resident, medication, invoice, care_plan, staff, lead, trust account, share_link, fixture, catalog, inspection, complaint). Never cascade-delete medical or money data.
- **`ON DELETE CASCADE`** only for explicit child collections (note_tags, note_mentions, note_attachments, note_acknowledgments, note_versions, complaint investigation notes, inspection citations, tracker_entry_versions).
- **Composite FK against `(id, facility_number)`** when both parent and child carry `facility_number`. The FK target is a separate `UNIQUE (id, facility_number)` constraint on the parent — DB-level enforcement that a child in facility A cannot point at a parent in facility B. When adding a NEW parent that children will reference, add the composite UNIQUE on the parent in the same migration. The 14 parent tables with this UNIQUE today: `ops_residents`, `ops_medications`, `ops_med_passes`, `ops_care_plans`, `ops_leads`, `ops_invoices`, `ops_staff`, `ops_temperature_fixtures`, `ops_inspections`, `ops_complaints`, `ops_obligations`, `ops_share_links`, `ops_posting_catalog`, `ops_resident_trust_accounts`.

**CHECK constraints on enum-like TEXT columns.** Every `TEXT NOT NULL DEFAULT '<value>'` column whose canonical value list lives in a `shared/<x>.ts` const array or `z.enum([...])` carries a matching `CHECK (col IN ('a','b','c'))`. When adding a new enum value, update the shared TS const AND add a migration that drops + re-adds the CHECK with the expanded set. When renaming a value, backfill old rows first (the CHECK refuses to apply otherwise — see the runbook).

**Soft-delete is preserved (not changed in Phase 2).** Tables that already use `deleted_at BIGINT` (notes, tracker_entries, staff_credentials, obligations, evidence_attachments, reports) keep doing so. New parent tables that may need soft-delete should follow the same `deleted_at BIGINT` + partial index pattern, not a `status='deleted'` enum, so the FK + CHECK lockdowns don't have to be widened for a transient state.

**NULL replaces empty-string sentinels on `facilities`.** The columns `address`, `city`, `county`, `zip`, `phone`, `licensee`, `administrator`, `first_license_date`, `closed_date`, `last_inspection_date`, `geocode_quality` are nullable. The empty string is no longer a valid value — write NULL when the field is unknown. App code uses `?? ''` on read so the runtime impact is nil. Do not reintroduce empty-string defaults on these columns.

**`pg_trgm` index on `facilities.name`.** A GIN trigram index (`idx_facilities_name_trgm`) exists on `LOWER(name)`. The current `searchFacilitiesAutocompleteAsync` query still uses `LIKE '%q%'` — a later phase will switch it to `LOWER(name) % $1` (similarity) or `ILIKE '%' || $1 || '%'` (substring) so the index is consulted. Don't drop the extension or the index.

**Orphan rows + migration failures.** See [docs/runbooks/phase-2-migration-orphan-cleanup.md](docs/runbooks/phase-2-migration-orphan-cleanup.md) for what to do when an FK or CHECK addition fails on existing prod data.

**JSONB instead of TEXT-as-JSON (Phase 2 R2).** `migrations/0002_phase_2_jsonb_and_idempotency.sql` flipped a batch of columns from `TEXT` (holding a stringified JSON payload) to `JSONB`:

- `facility_overrides.{hours_of_operation_json, languages_spoken_json, care_types_offered_json, accreditations_json, prefilled_fields}`
- `job_seeker_profiles.job_types`
- `job_postings.requirements` (NOT NULL, default `'[]'::jsonb`)
- `ops_drill_logs.{participants_json, residents_involved_json, corrective_actions_json}`
- `ops_inspections.findings_json`
- `ops_preaudit_pulls.{sections_json, totals_json}`
- `ops_reports.parameters_json`
- `ops_notification_log.triage_snapshot`
- `ops_resident_assessments.raw_json`
- `ops_note_audit_log.payload_diff`

Storage now reads/writes JS values directly — do NOT JSON.stringify on insert and do NOT JSON.parse on read. Drizzle's `jsonb()` column type handles both. Helpers that previously stringified (`jsonArrayToText`, `serializeAndCap`, `serializeParams`) are rewritten to return JS values; the byte-cap path now substitutes a sentinel object (`{_truncated:true, _originalSizeBytes, _maxBytes, _preview}`) instead of a mid-string `"...(truncated)"` marker that would have broken JSONB validity.

The wire format these endpoints emit is unchanged: a wire-compat shim ([server/lib/jsonbWireCompat.ts](server/lib/jsonbWireCompat.ts)) re-stringifies the affected fields on outbound so FE consumers that `JSON.parse(field)` keep working. A follow-up round can flip the FE to expect parsed objects and drop the shim.

**`ops_audit_trail.{before_json, after_json}` are intentionally NOT converted** — the `serializeAndCap` in auditStorage can emit a truncation marker; conversion would need helper rework and risks legacy-row cast failure. Out of scope for this round.

**Stripe webhook idempotency (Phase 2 R2).** Stripe webhook events are deduplicated via `stripe_processed_events(event_id PRIMARY KEY)`. The handler does `INSERT ... ON CONFLICT (event_id) DO NOTHING ... RETURNING event_id` immediately after signature verification and short-circuits with `{ received: true, alreadyProcessed: true }` when RETURNING yields no rows. This makes the webhook safe under Stripe replays: the subscription upsert never re-runs on a duplicate event, eliminating write amplification and removing the failure mode where a downstream side effect could drift between the first and second processing of the same event.

### Schema invariants — Phase 3 audit columns + membership table

Phase 3 lands two changes to the ops/auth schema (`migrations/0005_phase_3_membership_and_audit_columns.sql`):

**`facility_users` membership table (schema seam only).** A new join table connecting `facility_accounts` (one-login-per-facility today) with the preserved-through-Phase-2 `users` table. Auth flow is **not** switched yet — `facility_users` exists so a later phase can introduce multi-staff facilities without a schema rewrite. No rows backfilled. Role enum is enforced via DB `CHECK` against `('facility_admin','admin','auditor','don','med_tech','schedule_lead','office_manager')`; canonical list lives in `shared/schema.ts:facilityUserRoleSchema`. Soft-delete via `deleted_at`; partial UNIQUE `(facility_account_id, user_id) WHERE deleted_at IS NULL` allows reopen after archive. Do NOT migrate the auth layer to read from `facility_users` until a follow-up phase signs off — the table is currently write-only-future.

**Standardized audit columns across `ops_*` tables.** Every mutable `ops_*` table now carries the four columns `created_at`, `updated_at` (BIGINT epoch-ms), `created_by`, `updated_by` (TEXT, default `'system'`). A generic Postgres trigger function `set_updated_at_epoch_ms()` fires `BEFORE UPDATE` on each mutable table and overwrites `updated_at` — storage code **does not need to** (and should not) compute it on UPDATEs. INSERTs still set `created_at` + `updated_at` explicitly. `created_by` / `updated_by` are populated from the existing `actor: AuditActor` parameter (`actor.id`) at INSERT and UPDATE sites respectively; absent actor → `'system'` fallback via the `actorId()` helper in `opsStorage.ts`.

**Append-only tables get `created_by` only.** These tables get `created_at` + `created_by` standardized but **no** `updated_at` / `updated_by` and **no** trigger — the application contract is insert-only (corrections via a new row):

- `ops_audit_trail` — immutable audit log; `created_by` backfilled from `actor_id`.
- `ops_notification_log` — insert-only send-attempt log.
- `ops_resident_trust_ledger` — insert-only financial ledger; corrections via reversal entries.
- `ops_preaudit_pulls` — insert-only audit-pull log; `created_at` backfilled from `generated_at`.
- `ops_med_destruction` — insert-only destruction log.
- `ops_controlled_sub_counts` — insert-only at the contract layer; the single legacy `resolveControlledSubDiscrepancy` UPDATE site stays but does NOT touch `updated_*` (those columns are absent here).
- `ops_resident_trust_statements` — insert-only monthly snapshots; `created_at` backfilled from `generated_at`.
- `ops_complaint_investigation_notes` — append-only by application contract; `created_at` / `created_by` backfilled from `noted_at` / `noted_by`.

**Drizzle TS defs deliberately omit `.notNull()` on `created_by`.** The DB enforces `NOT NULL DEFAULT 'system'` — the Drizzle column is declared with `.default("system")` (no `.notNull()`) so legacy explicit SELECT projections that don't fetch `created_by` keep type-checking, and the DB default fills the column on insert sites that omit it. Where the original schema already had `created_by TEXT NOT NULL` (e.g. `ops_care_plans`, `ops_drill_logs`, `ops_obligations`, `ops_share_links`, `ops_posting_catalog`, `ops_resident_trust_accounts`, `ops_inspections`, `ops_complaints`, `ops_staff_credentials`), that declaration is preserved verbatim.

**Writing storage code that touches these columns.** Follow the existing pattern in `opsStorage.ts`:

- **INSERT**: pass `createdAt: now, updatedAt: now, createdBy: by, updatedBy: by` where `const by = actorId(actor)`. Where the table is append-only, set `createdBy: by` only.
- **UPDATE**: pass `updatedAt: now, updatedBy: actorId(actor)`. Do **not** touch `createdBy`. The DB trigger will overwrite `updatedAt` if you forget it, but writing it explicitly keeps the storage code self-documenting.
- **Never add a new function parameter to thread an actor** — every mutable `opsStorage.ts` function that audits already takes an `actor: AuditActor` (sometimes optional `?`). Reuse it.

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

### Schema invariants (Phase 2)

- **Money** is stored as `BIGINT cents` in `ops_invoices.{subtotal,tax,total,amount_paid,balance_due}`, `ops_billing_charges.amount`, `ops_payments.amount`, and `ops_resident_trust_*`. The wire/UI format is **dollars** (number). Conversion happens at the route boundary via `dollarsToCents`/`centsToDollars` from [server/lib/money.ts](server/lib/money.ts). Never store dollars as floats; never expose cents on the wire. `ops_billing_charges.quantity` stays `DOUBLE PRECISION` because it represents fractional units (e.g. 1.5 hours), not money.

### Phase 6 — validation hardening

Three input-side invariants are now enforced at the route boundary on `server/ops/opsRouter.ts`. New routes that accept facility-scoped POST/PUT bodies MUST follow these rules — they exist to prevent silent tenancy / data-quality regressions, not for style.

**Body schemas never name `facilityNumber`.** The facility a request belongs to is sourced from the Passport session via the `getFacilityNumber(req)` helper at the top of `opsRouter.ts`. The URL `:facilityNumber` path-param IDOR guard at `opsRouter.param("facilityNumber")` enforces the *URL* leg; this rule closes the *body* leg. A handler that ignored this rule and passed `parsed.data.facilityNumber` straight to storage would silently route writes into another tenant. Schemas with the field removed in this phase: `medPassSchema`, `controlledSubCountSchema`, `medDestructionSchema`, `admissionSchema`, `chargeSchema`, `generateInvoiceSchema`, `paymentSchema`. The corresponding POST handlers now read `const facilityNumber = getFacilityNumber(req)` and spread it into the storage payload AFTER `...parsed.data` so the session value always wins.

**Money and quantity fields are bounded.** Unconstrained `z.number()` lets `NaN`, `±Infinity`, negatives, and float drift into BIGINT cents columns. The standard shapes:

- **Dollars on the wire** (`amount` on `chargeSchema`, `paymentSchema`): `z.number().finite().min(0).max(1_000_000)` — `.finite()` rejects NaN AND ±Infinity in one shot; `$1M` is a sane single-charge upper bound for an ARF. Storage flips to cents per the Phase 2 money invariant.
- **Cents on the wire** (`amountCents` on `trustLedgerCreateSchema`): `z.number().int().positive().max(100_000_000)` — `$1M` in cents, integer-only.
- **Quantities** (`quantity` on `chargeSchema`, `medDestructionSchema`): `.finite().min(0).max(10_000)` (or `.int()` where the unit is countable like tablets).
- **Vitals ranges** (`preVitalsPulse`, `preVitalsTemp`, `preVitalsSpo2` on `medPassSchema`): clinically-plausible per-vital bounds (`pulse 0–400`, `temp 0–120`, `spo2 0–100`).

**Every request-body `z.object({...})` carries `.strict()`.** This makes unknown fields a `400` instead of a silent drop — without it, a client typo or an attacker probe gets the request-shape-mismatch failure mode that broke tour scheduling in an earlier round. Three exclusions:
- Query-string / response-shape schemas don't get `.strict()`.
- Schemas in `@shared/schema.ts` (`credentialInputSchema`, `workExperienceInputSchema`) are intentionally left non-strict — they cross the FE boundary and a future additive field should not require a coordinated FE+BE deploy.
- `interestsRouter.submitSchema` and `routes.ts:registerSchema` legitimately accept `facilityNumber` from body because the caller has no facility session yet (jobseeker selecting a facility / first-time facility registration).

**Tests.** Regression coverage lives in [server/__tests__/ops/phase6ValidationHardening.test.ts](server/__tests__/ops/phase6ValidationHardening.test.ts) — body-supplied facility number, money/quantity bounds, and unknown-field rejection are each asserted on one representative endpoint per pattern.

### Two Auth Systems

**Facility auth** — Passport.js `LocalStrategy` + server-side sessions. Stored in `facility_accounts`. The `requireAuth` middleware in `routes.ts` protects facility-specific endpoints.

**Job seeker auth** — Custom session-based auth using `req.session.jobSeekerId`. Stored in `job_seeker_accounts`. Protected by `requireJobSeekerAuth` middleware (`server/middleware/requireJobSeekerAuth.ts`). The `AuthContext` on the client manages this state.

Both flows use 6-digit OTP email verification (15-minute expiry) and support password reset via the same OTP mechanism.

### Error envelope

The canonical HTTP error shape returned to the client is:

```ts
{ code: string, message: string, details?: unknown }
```

- `code` — stable, SCREAMING_SNAKE_CASE identifier the FE can branch on (e.g. `VALIDATION_ERROR`, `SUBSCRIPTION_REQUIRED`, `CREDENTIAL_DUPLICATE`, `INTERNAL_ERROR`).
- `message` — human-readable, safe to surface in UI.
- `details` — optional structured data. For `VALIDATION_ERROR` this is `{ issues: ZodIssue[] }`. Stack traces are attached here in non-production only and never in `NODE_ENV=production`.

**Helper.** [`server/lib/respondError.ts`](server/lib/respondError.ts) exports:

- `respondError(res, err, status?)` — turns a `ZodError`, an `AppError` (or any `{ code, statusCode }` object), or an unknown error into the canonical envelope. Always logs the original via `console.error` so a future Sentry hook attaches at one place.
- `AppError` — `new AppError(code, message, statusCode?, details?)` for handlers that throw deliberately.

**Status of migration.** Phase 0 ships the helper plus one reference route — [`server/routes/credentials.ts`](server/routes/credentials.ts). The legacy shapes elsewhere remain in place until a later mechanical migration phase:

- `{ message }` — `server/routes.ts`, `server/routes/jobseekerAuth.ts`, `server/routes/workExperience.ts`, …
- `{ success: false, error }` — `server/ops/opsRouter.ts`, `server/ops/auditorMiddleware.ts`
- The 402 `SUBSCRIPTION_REQUIRED` envelope from `server/middleware/requireActiveSubscription.ts` is already aligned with the target shape (it has `code` + `message` + an extra `upgradeUrl`) and is intentionally left as-is.

**New routes must use `respondError`.** Do not invent new error shapes; if you need a new failure mode, add an `AppError` with a new `code`.

**Auth hardening (S-02 / S-03).** OTPs for both portals are never persisted in plain text — `server/routes.ts` hashes raw tokens with `hashOtp()` (SHA-256) before writing to `verification_token`, and `safeCompareOtp()` performs a constant-time comparison on verify. Every auth surface across both portals — register, verify-email, resend-otp, login, forgot-password, reset-password — is protected by `authRateLimiter` (`server/middleware/rateLimiter.ts`), capped at 5 attempts per 15 minutes per IP. The legacy `POST /api/facility/send-otp` endpoint and its in-memory `facilityOtpStore` Map were removed (the production OTP flow uses the DB column on the account row).

**Split session cookies (Phase 1 hardening).** The two portals use distinct session cookies so a logout in one does not invalidate the other in the same browser:

| Portal | Cookie name | Mounted on |
|---|---|---|
| Facility owner | `arf_facility_sid` | every request path **except** `/api/jobseeker/*` |
| Job seeker | `arf_seeker_sid` | requests under `/api/jobseeker/*` |

Both cookies share the same Postgres `session` table — only the cookie identity differs. The prefix-based dispatcher and the `FACILITY_SESSION_COOKIE` / `SEEKER_SESSION_COOKIE` constants live in [server/index.ts](server/index.ts). Logout handlers must `clearCookie` the correct name; using the legacy `connect.sid` is a no-op.

**Per-session CSRF token (Phase 1 hardening).** In addition to the `X-Requested-With: XMLHttpRequest` preflight, every state-changing `/api/*` request must carry a per-session CSRF token:

- The token is a 32-byte hex string lazily minted on first read of `/api/facility/me` or `/api/jobseeker/me` and stored on `req.session.csrfToken`. Both `/me` endpoints return the token even on their 401 (unauthenticated) responses so pre-auth POSTs (register, login, verify-email, etc.) can carry a valid token; `requireJobSeekerAuth` likewise mints + returns a token on its 401 response.
- The FE reads the token from the body of `/me` (the AuthContext rehydration call) and replays it as the `X-CSRF-Token` request header on every POST/PUT/PATCH/DELETE under `/api/`.
- Missing or mismatching tokens get a `403 { code: "CSRF_TOKEN_INVALID" }`.
- `/api/billing/webhook` is bypassed (Stripe cannot send our session cookie); the route is also mounted before the session middleware with `express.raw()`.
- Middleware: [server/middleware/csrfToken.ts](server/middleware/csrfToken.ts) — `csrfTokenMiddleware()` enforces the check; `getOrCreateCsrfToken(req)` is the helper the `/me` handlers and the jobseeker auth middleware use to mint/return the token.

**`SessionUser` type pattern (Phase 1 hardening).** `Express.User` is declared as the narrowed [`SessionUser`](server/types/session-user.ts) type — `Omit<FacilityAccount, "password" | "verificationToken" | "verificationExpiry">`. The `passport.deserializeUser` hook calls `toSessionUser(account)` before assigning to `req.user`, so handlers cannot accidentally serialise the password hash or OTP columns into a JSON response. If a handler genuinely needs the full row (e.g. a password-change flow), re-fetch it via `storage.getFacilityAccount(req.user.id)` — never read `req.user.password`, that field is no longer in the type.

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

### URL-exposed identifiers (Phase 7)

Two tables now carry a non-null UNIQUE `external_id TEXT` column populated with `nanoid(12)` so URLs never expose the sequential `BIGSERIAL` PK (closes enumeration / business-volume leak):

| Table | Routes that flip to `:externalId` |
|---|---|
| `job_postings` | `GET /api/jobs/:externalId`, `PUT/DELETE /api/facility/jobs/:externalId` (the `POST /api/facility/jobs` response also exposes `externalId`, not `id`) |
| `applicant_interests` | `DELETE /api/jobseeker/interests/:externalId`, `PATCH /api/facility/applicants/:externalId` |

**Rules.** Generate the value via `nanoid(12)` inside `server/storage.ts` on every insert (see `generateExternalId()` helper). Internal foreign-key relationships keep referencing the integer PK — only URLs and response shapes flip. Wire payloads for these two tables strip the integer `id` server-side; the FE constructs all subsequent URLs from `externalId`. The `POST /api/jobseeker/interests` body now takes `jobExternalId` (string) instead of `jobId` (integer); the server resolves it to the internal PK before insert.

**Deferred external_id rollout (intentionally NOT converted this round).** These tables are URL-addressed but stay on integer IDs because (a) they're behind facility auth + RBAC + composite-FK tenant isolation, so enumeration risk is much lower, and (b) the URL surface is large (50+ paths for residents alone). Plan a focused phase per table:

- `ops_residents` — every resident-scoped operations URL (`/api/ops/residents/:id`, `/api/ops/residents/:id/medications`, `…/billing`, `…/care-plans`, `…/incidents`, etc.).
- `ops_incidents`, `ops_medications`, `ops_med_passes`, `ops_invoices`, `ops_billing_charges`, `ops_complaints`, `ops_inspections`, `ops_drill_logs`, `ops_obligations`, `ops_staff`, `ops_staff_credentials`, `ops_resident_trust_accounts`, `ops_resident_trust_ledger`, `ops_resident_trust_statements`, `ops_temperature_fixtures`, `ops_temperature_logs`, `ops_evidence_attachments`, `ops_reports`, `ops_posting_catalog`, `ops_posting_verifications`, `ops_vendors`, `tracker_entries` — same calculus.
- `ops_share_links.token` — already a random opaque string. Do **NOT** add `external_id`; the token IS the external surface.

**Migration / backfill.** `migrations/0008_phase_7_external_ids.sql` (+ idx 8 journal entry) + bootstrap mirror in `server/db/bootstrap.ts` adds the column, backfills legacy rows with a Postgres-side hash (`substr(md5(random()||id||clock_timestamp()),1,12)`), promotes the column to NOT NULL, then creates the UNIQUE index. New rows always use real `nanoid(12)` from app code.

### Soft-delete policy (Phase 7)

Three deletion patterns coexist in the codebase. The rule codifies which to use where so review cycles don't have to relitigate it per PR.

**Rule.**

- **Clinical / financial / audit-grade data — NEVER hard-delete.** Use `deleted_at BIGINT` + `deleted_by TEXT` (or an existing status-flip like `status='discharged'` if the table already uses one). Provides forensic recoverability + audit-trail integrity required for licensing, AB-1629 / Title 22 retention, and CCPA/HIPAA-adjacent obligations. Tables in this class: every `ops_*` table (incl. notes, trackers, evidence, obligations, reports, residents, medications, incidents, billing, staff, complaints, inspections), `tracker_*`, `legal_acceptances`, `account_data_requests`, `ops_audit_trail` (append-only).
- **Marketing / contact / public-facing operational data — hard-delete is OK.** Tables in this class: `job_postings`, `applicant_interests`, `job_seeker_work_experience`, `job_seeker_credentials`, and `facility_overrides` content fields (logo path, social URLs, etc.). Hard-delete here keeps the dataset tidy and matches user expectations (when a job seeker removes a credential, they expect it gone, not soft-archived).
- **Transient / cleanup data — hard-delete is fine.** Expired session rows (`DELETE FROM session WHERE …`), unverified OTPs, in-process redirector handoff keys, expired share-link tokens. Listed here so a reviewer doesn't flag them.
- **When in doubt** — prefer `deleted_at`. It's reversible. Hard-delete only when the row genuinely has no audit value.

**Patterns currently in use for "soft-delete" tables.**

| Pattern | Tables |
|---|---|
| `deleted_at BIGINT` (+ partial index) | `ops_notes`, `tracker_entries`, `ops_staff_credentials`, `ops_obligations`, `ops_evidence_attachments`, `ops_reports` |
| `status='deleted'` enum flip | `ops_drill_logs` (see `server/ops/opsStorage.ts` notes) |
| `status='discharged'` clinical state | `ops_residents` (lifecycle state, not really "delete") |
| `status='discontinued'` clinical state | `ops_medications` |
| `status='archived'` operational state | `ops_vendors`, `ops_posting_catalog` |

**Hard-delete-OK tables today.**

- `job_postings` — `db.delete(jobPostingsTable)` in `server/storage.ts:deleteJobPostingByExternalId`. Marketing data; deletion intent is "take the listing down."
- `applicant_interests` — `db.delete(applicantInterests)` in `server/storage.ts:deleteApplicantInterestByExternalId`. Contact-intent data; seeker "withdraws" = row should be gone.
- `job_seeker_credentials` — `db.delete(jobSeekerCredentials)` in `server/storage.ts`. User-managed profile data.
- `job_seeker_work_experience` — same.
- Session rows — DDL `DELETE FROM session WHERE …` in `server/routes.ts` (logout) and `server/routes/jobseekerAuth.ts` (logout). Transient by definition.

**Audit findings (Phase 7).**

- **`server/ops/opsStorage.ts:deleteCharge` (line ~1257)** hard-deletes from `ops_billing_charges`, a financial table. Per the rule, this should soft-delete (likely via a new `deleted_at` column or by flagging as void/reversed). Flagged for a focused follow-up phase — not refactored here per the Phase 7 scope ("audit + codify the rule, don't batch-fix outliers"). The accounting impact is small because `ops_invoices` row totals are computed from charges and the FE can re-issue corrections, but the audit trail is incomplete. **Recommended fix:** add `deleted_at BIGINT` + `deleted_by TEXT` to `ops_billing_charges`, change `deleteCharge` to UPDATE-stamp those columns, and add a filter in `listCharges` to hide soft-deleted rows by default.

No other productive hard-deletes were found in `server/storage.ts`, `server/ops/opsStorage.ts`, `server/ops/notesStorage.ts`, `server/trackers/trackerStorage.ts`, or any `server/repositories/postgres/*.ts` file.

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
| `LOGTAIL_SOURCE_TOKEN` | Optional. Better Stack (Logtail) source token for centralized log shipping from Fly.io. Used by the `ncu-log-shipper` companion Fly app (and optionally by `ncu` for direct logging). See `docs/runbooks/logging.md`. |
| `SENTRY_DSN` | Optional. Sentry DSN for error tracking. App boots normally if missing. |
| `FLY_IMAGE_REF` | Set by Fly.io at deploy time; used as Sentry `release` tag when present |

**Local Stripe webhook testing**: `stripe listen --forward-to localhost:5000/api/billing/webhook` — copy the printed `whsec_...` into `STRIPE_WEBHOOK_SECRET`. The webhook route is mounted with `express.raw()` BEFORE the global JSON parser so Stripe's signature verification sees the unparsed body.

### Phase 5 — multi-machine safety

The codebase no longer relies on `min_machines_running = 1` for correctness. Every per-tick or per-window background job is gated by a Postgres advisory lock so a multi-machine Fly deploy can't double-fire.

- **`server/ops/dailySummaryScheduler.ts`** wraps each tick in `withDailySummaryLock` (key `0x6461696c7973756d` — ASCII `dailysum`). Only the machine that wins `pg_try_advisory_lock` runs the work; the others log `tick skipped — another machine is processing` and no-op.
- **`server/ops/obligationExpireScheduler.ts`** uses the same pattern with key `0x6f626c69676578_70` (`obligexp`). Distinct key, so the two schedulers never block each other.
- **`server/ops/auditorMiddleware.ts`** dropped the in-process `lastAuditViewAt` Map (which over-emitted N× across N machines). Audit-view debounce now packs `(minuteBucket, shareLinkId)` into a single bigint key and calls `pg_try_advisory_xact_lock` inside a short BEGIN/COMMIT — `_xact_lock` releases automatically at txn end so we never leak. `_resetAuditorMiddlewareForTests` survives as a no-op for back-compat with existing test suites.
- **`server/index.ts`** session store: `connect-pg-simple` now runs `pruneSessionInterval: 3600` so the `session` table doesn't grow unbounded. Idempotent sweep — running from every machine is safe.
- **`billing_bypass_redemptions`** (`migrations/0007_phase_5_bypass_redemptions.sql`, mirrored in `bootstrap.ts`, Drizzle defs in `shared/schema.ts`) gives the bypass-code redeem flow a durable audit row + single-use-per-account enforcement via a partial UNIQUE index on `(account_id) WHERE revoked_at IS NULL`. The route translates Postgres 23505 (unique_violation) into a clean **409 `BYPASS_ALREADY_REDEEMED`**. Only the first 8 chars of the submitted code are persisted (`code_prefix`); the full code never enters the DB. IP + user-agent are captured for the operator dashboard.

When adding a new in-process scheduler / debounce: pick a distinct 8-byte ASCII mnemonic for the lock key, expose it via `_phase5Internals` for the advisory-lock test suite (`server/__tests__/schedulers/advisoryLock.test.ts`), and document the key + mnemonic in this section.

### Phase 8 — operational baseline

Five pieces land in this phase. None of them change runtime behavior; all five make the next outage easier to recover from.

**Health probes split into liveness + readiness.** Two endpoints in [server/routes.ts](server/routes.ts):

- **`GET /api/health`** — liveness. Returns `{ status: "ok" }` unconditionally, no DB hit. This is what Fly's blue/green deploy + the `deploy.yml` smoke test poll. Liveness must not depend on DB reachability — a transient pool hiccup during the green-flip window would otherwise cascade into a deploy rollback.
- **`GET /api/health/deep`** — readiness. Does a `SELECT 1` round-trip against Postgres with a hard 2 s `Promise.race` timeout. Returns `200 { status: "ok", checks: { db: "ok" } }` on success, `503 { status: "degraded", checks: { db: "fail" }, error }` on DB unreachable/slow. **This is the URL the external uptime monitor polls** — `/api/health` alone goes green even with a dead DB pool.

Don't poll `/api/health/deep` faster than once per minute from any single source. Each call takes a pool connection.

**External uptime monitor.** [docs/runbooks/uptime-monitor.md](docs/runbooks/uptime-monitor.md) — Better Stack walkthrough for both probes, 2-region check origin, alert thresholds (page on `/api/health` non-200 ≥ 60 s, `/api/health/deep` 503 ≥ 2 min). Same vendor as the log shipper (`LOGTAIL_SOURCE_TOKEN`) so one dashboard. **Setup is not automated** — when the monitor is provisioned, link its public status page from this section.

**Backup / restore runbook.** [docs/runbooks/backup-restore.md](docs/runbooks/backup-restore.md) — quarterly drill procedure for Neon branch-from-timestamp restore (preferred — PITR granularity) with a Fly Postgres snapshot-clone fallback. Includes pre-flight checks, side-branch smoke test (`/api/health/deep` + spot-check rows + verify migration journal), cut-over (real incident only), and a 7-point post-drill checklist. Goal: end-to-end recovery in under 30 minutes. **A backup that has never been restored is not a backup** — run the drill once a quarter.

**Dependabot config.** [.github/dependabot.yml](.github/dependabot.yml). Weekly cadence (Mondays 06:00 PT). npm + GitHub Actions ecosystems. Group rollups for `@radix-ui/*`, `@capacitor/*`, tailwind, dev-tooling, testing libs, and all major-version bumps so we don't get 30 PRs at once. Security updates fire independently of the weekly cadence — within hours of a CVE publication. Explicitly ignored major bumps: `drizzle-orm`, `react`, `react-dom`, `@types/react*` — these need a planned migration, not a Dependabot drive-by.

**CI security workflow.** [.github/workflows/security.yml](.github/workflows/security.yml). Three triggers: PR against main, push to main, weekly cron (Monday 13:00 UTC). Two jobs:

- `audit` — `npm audit --audit-level=high --omit=optional` (BLOCKING) + a non-blocking `--audit-level=moderate` for visibility.
- `typecheck` — `npm ci` + `npm run check` (`tsc`). This is the same gate the dev loop uses locally, run in CI on every PR.

**No vitest in CI yet** — the test suite needs a live Postgres harness and adding a CI service container is its own phase. Tests still run locally via `npm run test:server`.

**What's deliberately NOT in Phase 8.** TOTP / 2FA for admin accounts (planned as a focused follow-up phase — new DB schema, setup wizard, login challenge, recovery codes is significantly larger than the rest of Phase 8 combined). Object-storage backups (`ops_evidence_attachments` uploads) — out of scope until file-attachment volume justifies S3 + lifecycle. Synthetic transaction monitoring — out of scope until traffic volume makes log-in-and-click flows worth instrumenting separately from the health probes.

### Deployment

Deployed on Fly.io. `npm run deploy` runs `fly deploy`. Sessions and the SQLite DB persist via a Fly volume. The ETL enrichment child process writes to the same SQLite file using WAL mode for concurrent reads.

### Secrets (Fly.io)

Production secrets are managed via `fly secrets`. To configure error tracking in prod:

```bash
fly secrets set SENTRY_DSN=<your-dsn-here>
```

Other secrets follow the same pattern: `fly secrets set NAME=value`. Setting a secret triggers a deploy; use `fly secrets set --stage` to batch multiple updates before deploying.
