# Onboarding

**Phase 10 — cleanup + docs.** Tutorial-style getting-started for a new
developer (or future-you, six months from now) joining the arf-map
codebase. Distinct from [CLAUDE.md](../CLAUDE.md), which is an
architecture reference manual — this doc is "run these commands in
this order and you'll have a working dev loop."

If anything in this guide doesn't match reality, the guide is wrong.
Fix it in the same PR that drifted the dev experience.

---

## Prerequisites

| Tool | Minimum | Why |
|---|---|---|
| Node.js | 20.x LTS | Matches the CI workflow (`actions/setup-node@v4` with `node-version: "20"`). |
| npm | bundled with Node 20 | The repo uses `npm`, not pnpm/yarn. |
| Git | any recent | Repo is git-tracked + uses `git lfs` for a few large JSON files. |
| Git LFS | recent | `migrations/meta/_journal.json`, `package.json`, `package-lock.json` are LFS-tracked — `git lfs install` once. |
| Postgres | 14+ | App is Postgres-only. Use Neon (recommended) or local docker. |
| Optional: `psql` | any | Useful for the backup-restore drill + perf-tuning runbook. |
| Optional: `flyctl` | latest | For production deploy + log inspection. Not needed for local dev. |
| Optional: `stripe` CLI | latest | For local webhook testing (`stripe listen --forward-to localhost:5000/api/billing/webhook`). |

**Editor / IDE:** any TypeScript-aware editor. The repo includes
`.vscode/` settings (if you use VS Code) and a Claude Code extension
configuration. Tabs are 2-space.

---

## First-time setup

### 1. Clone and install

```bash
git clone <repo-url>
cd arf-map
git lfs install                # one-time per machine
git lfs pull                   # fetch the LFS-tracked files
npm ci                         # exact install from package-lock.json
```

If `git lfs pull` is skipped, you'll see git-lfs pointer files
(short text headers) instead of real content for `package.json` etc.
The build will fail with confusing errors. Always run `lfs pull`.

### 2. Provision Postgres

Pick one:

**Option A — Neon (recommended).** Free tier is plenty for local dev.
- Sign in at <https://console.neon.tech>.
- Create a project. The default `main` branch is fine.
- Copy the connection string from the project dashboard.

**Option B — Local Docker.**
```bash
docker run -d --name arf-map-pg \
  -e POSTGRES_PASSWORD=devpass \
  -e POSTGRES_DB=arfmap \
  -p 5432:5432 \
  postgres:16
```
Connection string: `postgres://postgres:devpass@localhost:5432/arfmap`.

The schema bootstrap auto-runs `CREATE EXTENSION IF NOT EXISTS
pg_trgm` on first boot — your DB role needs CREATE permission for
extensions. Neon's default role has this; if you're on a locked-down
host you may need a one-time superuser intervention.

### 3. Create `.env`

```bash
cp .env.example .env
```

Edit `.env` and set at minimum:

```env
# Required: Postgres connection string from step 2.
DATABASE_URL=postgres://...

# Required: random 64-char hex string for session signing.
# Generate with: openssl rand -hex 32
SESSION_SECRET=<paste here>

# Optional: gives the app a working email path (OTP, password reset).
# Without it, the auth flows print OTPs to the server log instead.
RESEND_API_KEY=re_...

# Optional: Stripe Checkout + Billing Portal + webhook.
# Without these, /api/billing/* returns 503.
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...     # from `stripe listen`
STRIPE_PRICE_ID_OPS_PRO_MONTHLY=price_...

# Optional: skips the slow facility cache pre-warm on `npm run dev`.
SKIP_PREWARM=true
```

The full list of env vars lives in [CLAUDE.md → Environment Variables](../CLAUDE.md#environment-variables).

### 4. Apply migrations

```bash
npm run db:migrate
```

This applies all migrations in `migrations/meta/_journal.json` in order,
creating the schema from scratch. On a fresh DB you should see one line
per migration with no errors.

If you ever pull a branch that added new schema, re-run `db:migrate`
before starting the dev server. The bootstrap layer is a safety net,
not a migration runner.

### 5. Seed CCLD facility data (optional, recommended)

```bash
npm run data:extract              # downloads the latest CCLD CSV / GeoJSON
npm run data:seed                 # populates the `facilities` table (~50k rows)
```

Without seeding, the app falls back to live-fetching CCLD data on
first map render (24-hour in-memory cache). The seeded path is much
faster for dev.

### 6. Start the dev server

```bash
npm run dev
```

The Express server + Vite middleware are both served on
`http://localhost:5000`. Vite HMR is automatic for any change under
`client/src/`. Server changes restart via `tsx` watch — usually within
a few hundred ms.

---

## Daily dev loop

### Routes that matter

| URL | What it is |
|---|---|
| `http://localhost:5000` | The map (anon-public). |
| `http://localhost:5000/#/facility-portal` | Facility-owner sign-in / dashboard. |
| `http://localhost:5000/#/jobseeker` | Job-seeker sign-up / sign-in. |
| `http://localhost:5000/api/health` | Liveness probe (always 200). |
| `http://localhost:5000/api/health/deep` | Readiness probe — does a `SELECT 1` and returns 503 if DB is unreachable. |

### The four most common commands

```bash
npm run dev           # dev server with HMR
npm run check         # tsc — catches type errors without running
npm test              # all tests
npm run test:server   # server-only (skip client tests)
```

### Quick test patterns

- Re-run one file: `npx vitest run server/__tests__/health.test.ts`
- Watch mode: `npm run test:watch`
- Tests that need a DB will skip automatically if `DATABASE_URL` is unset or the DB is unreachable. CI runs against a real Postgres, so locally-skipped tests don't reduce coverage.

### Creating a facility-owner test account

The auth UX sends OTPs via Resend in production. Without
`RESEND_API_KEY` the server logs the OTP to stdout instead — search
the dev server output for `verification token:` after submitting the
registration form. Paste the OTP into the form to verify.

### Working on a feature

1. Read [CLAUDE.md](../CLAUDE.md) for the relevant invariants. Phase
   sections like "Schema invariants (Phase 2)" or "URL-exposed
   identifiers (Phase 7)" are not historical commentary — they are
   load-bearing constraints. Breaking them silently is what the phase
   tags exist to catch.
2. Use the code-review-graph MCP tools (`detect_changes`,
   `query_graph`, `get_impact_radius`) instead of grepping by hand
   when possible. See the top of CLAUDE.md for the catalog.
3. Write a regression test for any new behavior. Skip-on-no-DB pattern
   from `server/__tests__/health.test.ts` is the standard for DB-using
   tests.
4. Run `npm run check` before committing. The CI security workflow
   runs both `npm audit` and `tsc` on every PR; failing either blocks
   the merge.

---

## Common questions

### "Where does the data come from?"

CCLD facility data comes from the California open-data portal (CHHS).
The ETL script (`scripts/extract-ccld-data.ts`) fetches it on demand.
Production runs a nightly enrichment job at 2 AM UTC (see CLAUDE.md
→ Data flow: Facilities).

All other data (job postings, applicants, residents, medications,
etc.) is created by users of the app.

### "Why two auth systems?"

Facility owners and job seekers are independent personas with no
overlapping permission model. Splitting them lets each evolve at its
own pace:

- Facility owners: Passport.js + LocalStrategy, role-gated via
  `requireOpsPermission` (Phase 3 RBAC).
- Job seekers: custom session-based auth via `req.session.jobSeekerId`.

Both use 6-digit OTP email verification + the same per-session CSRF
token pattern (Phase 1 hardening). See CLAUDE.md → Two Auth Systems.

### "What's the relationship between Drizzle schema files and
bootstrap.ts?"

`shared/schema.ts` + the three Drizzle ops/notes/trackers schema
files are the **source of truth**. Migrations (`npm run db:generate`
→ `migrations/*.sql`) flow from changes to those files.

`server/db/bootstrap.ts` mirrors the schema as raw SQL `CREATE TABLE
IF NOT EXISTS` blocks. It runs at server boot as a fallback for fresh
dev DBs that never had `db:migrate` run. **Do not add new tables or
columns there** — use the migration workflow.

### "What's the test database story?"

Tests share the dev `DATABASE_URL`. Each test file owns its own
facility-number prefix (`TEST-PHASE6-A`, `TEST-AUTOCMP-001`, etc.) and
cleans up its own rows in `afterAll`. No test drops the schema; no
test runs migrations. Just `bootstrapMainSchema()` to make sure
the tables exist.

If you need an isolated DB for parallel test runs, point each shell
at a separate Neon branch — the branching feature in Neon is built
exactly for this.

### "What's deferred / known-incomplete?"

A few things are intentionally not yet built. The current snapshot:

- **TOTP / 2FA for admin accounts** — planned as a focused follow-up phase, not implemented.
- **External IDs (nanoid) for `ops_*` tables** — only `job_postings`
  and `applicant_interests` carry external_ids today. Resident-scoped
  URLs (50+ paths) still expose the integer PK. Phase 7 documented
  the deferred list.
- **`ops_billing_charges` soft-delete** — currently hard-deletes,
  violating the Phase 7 soft-delete policy. Flagged for a focused
  follow-up phase.
- **vitest in CI** — local tests work, but the GitHub Actions
  workflow currently only runs `npm audit` and `tsc`. Adding a CI
  Postgres service container is its own future task.
- **Composite indexes on `ops_*` tables** — Phase 9 deliberately
  punted on this. The performance-tuning runbook (`docs/runbooks/
  performance-tuning.md`) documents how to identify + add them when
  there's a measured slow-query baseline.

See CLAUDE.md per-phase sections for the full "what's deferred" list.

---

## When stuck

1. **Type error you don't understand?** `npm run check` shows the full chain.
2. **A migration won't apply?** See [docs/runbooks/phase-2-migration-orphan-cleanup.md](runbooks/phase-2-migration-orphan-cleanup.md) for the recovery procedure.
3. **DB is in a weird state?** See [docs/runbooks/backup-restore.md](runbooks/backup-restore.md). On Neon, branching is a 1-command undo.
4. **A query is slow?** See [docs/runbooks/performance-tuning.md](runbooks/performance-tuning.md). Don't add indexes without EXPLAIN ANALYZE.
5. **CSRF / session weirdness?** Both portals use distinct session cookies (`arf_facility_sid`, `arf_seeker_sid`) and a per-session `X-CSRF-Token` header. Most browsers' devtools network tab will show whether the header is being sent. See CLAUDE.md → "Per-session CSRF token."
6. **Production outage?** See [docs/runbooks/uptime-monitor.md](runbooks/uptime-monitor.md) for the first-5-minutes triage.
7. **Genuinely stuck?** Read the relevant CLAUDE.md phase section. If that doesn't have the answer, the answer probably isn't documented yet — that's worth flagging and adding to CLAUDE.md.

---

## What to read next

- **[CLAUDE.md](../CLAUDE.md)** — architecture reference (~500 lines, dense but comprehensive). Skim the section list, then deep-read the phases that touch the surface you're working on.
- **[docs/architecture/erd.md](architecture/erd.md)** — entity-relationship diagrams by domain (Auth / Facilities + Marketing / Operations / Notes / Trackers).
- **[docs/runbooks/](runbooks/)** — operational playbooks (logging, backup-restore, uptime monitor, performance tuning, migration orphan cleanup).
- **[shared/schema.ts](../shared/schema.ts)** — start here for the core auth + facilities tables.
- **[server/ops/opsSchema.ts](../server/ops/opsSchema.ts)** — the bulk of the operations data model.
