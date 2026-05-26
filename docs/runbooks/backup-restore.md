# Backup & restore runbook

**Phase 8 — operational baseline.** Documents how to recover the production
Postgres database from a point-in-time backup. Run the drill once a quarter
even if nothing is broken — a backup that has never been restored is not
a backup.

The procedure below covers two failure modes:

1. **Soft data corruption** — bad migration, wrong UPDATE/DELETE, a script
   that wrote to the wrong tenant. App is up, DB is reachable, but rows
   are wrong. Goal: restore to N minutes before the bad write.
2. **Hard outage** — DB is unreachable, region down, account locked.
   Goal: stand up a working DB pointing the app at it, even if some data
   is sacrificed.

> The app uses Postgres exclusively. There is **no SQLite fallback in
> production** anymore — older docs that mention `npm run db:push`
> against SQLite are obsolete. Restore = Postgres operations only.

---

## Pre-flight (do this NOW, not during an incident)

These steps need to be done once and verified periodically. They're
useless during an incident.

1. **Confirm point-in-time recovery (PITR) is enabled.**
   - **Neon:** `Console → Project → Settings → History retention`. Free
     tier = 24 hours; paid = up to 30 days. Anything less than 7 days is
     not enough lead time for a slow-discovered corruption (e.g. a bad
     migration that runs nightly and is noticed Monday morning).
   - **Fly Postgres:** automated daily snapshots are on by default;
     verify with `flyctl pg list-snapshots -a <pg-app>`.
2. **Confirm `DATABASE_URL` is stored as a Fly secret, not committed.**
   Check `flyctl secrets list -a ncu` — `DATABASE_URL` should be in the
   list. If it's in a file, fix that now.
3. **Have the Neon / Fly Postgres credentials in a password manager,**
   not in your terminal history.
4. **Save the connection string to a known-empty staging DB** for use
   as a smoke target — see step 4 of the drill below.

---

## Quarterly drill (the procedure)

The drill confirms (a) the backups are real, (b) you remember how to do
this, and (c) the app boots against a restored DB. Pick a 1-hour window
when no users are active and run end-to-end.

### Step 1 — Pick a recovery point

Decide what you're restoring **to**. Two cases:

- **Drill or known-good recovery:** pick a timestamp ~30 minutes ago.
  Far enough back that nobody has done anything you care about in that
  window, recent enough that the data is representative.
- **Real incident:** pick the latest timestamp **before** the bad event.
  Err on the side of going a few minutes earlier — losing 5 minutes of
  writes is much cheaper than restoring AGAIN because the bad write was
  caught inside your restore window.

Write the timestamp down. Use ISO-8601 UTC: `2026-05-26T18:42:00Z`. Do
not use words like "yesterday at 6" — past-you and future-you will
disagree on which timezone that is.

### Step 2 — Restore to a side branch

**Neon (preferred — branching is the killer feature here):**

```bash
# Via Neon CLI (`npm i -g neonctl` if not installed)
neonctl branches create \
  --project-id <project-id> \
  --name "restore-$(date -u +%Y%m%d-%H%M)" \
  --parent main \
  --parent-timestamp "2026-05-26T18:42:00Z"
```

This creates a new branch with a separate connection string. Copy the
connection string — you'll need it in step 4.

**Fly Postgres:**

```bash
# Restore the most recent snapshot into a NEW cluster (not the existing one).
flyctl pg create \
  --name ncu-pg-restore-$(date -u +%Y%m%d-%H%M) \
  --org <org> \
  --snapshot-id <snapshot-id>
```

Snapshots are coarse (daily); for finer-grained PITR you'd need to ship
WAL externally, which we don't currently do. Move to Neon if PITR
granularity matters.

### Step 3 — Smoke the restored DB directly

Before pointing the app at the restored DB, query it manually to
confirm the data matches your expectation.

```bash
psql "<restored-connection-string>"
```

Run:

```sql
-- Total row counts on critical tables — should match your mental model
-- of what existed at the restore timestamp.
SELECT 'facility_accounts' AS table, COUNT(*) FROM facility_accounts
UNION ALL SELECT 'job_postings', COUNT(*) FROM job_postings
UNION ALL SELECT 'ops_residents', COUNT(*) FROM ops_residents
UNION ALL SELECT 'ops_invoices', COUNT(*) FROM ops_invoices;

-- Spot-check the migration journal — confirms schema state matches
-- what the app expects. Highest idx should match migrations/meta/_journal.json.
SELECT * FROM __drizzle_migrations ORDER BY id DESC LIMIT 5;

-- Sanity check: a known row from before the restore point should exist.
-- Pick one you remember (a test facility account, your own login).
SELECT id, facility_number, username, created_at
FROM facility_accounts
WHERE username = 'your-known-good-account';
```

If any of these are wrong, **stop here**. Don't swap the prod URL.

### Step 4 — Point the app at the restored DB (drill mode)

Spin up a local copy of the app pointed at the restored DB to verify
the schema is compatible and the boot path works.

```bash
# In a SEPARATE shell — do NOT export DATABASE_URL globally
DATABASE_URL="<restored-connection-string>" \
NODE_ENV=development \
SKIP_PREWARM=true \
npm run dev
```

Hit:

- `http://localhost:5000/api/health` — should 200.
- `http://localhost:5000/api/health/deep` — should 200 with `checks.db=ok`.
- Log in as a known account. Browse the facility portal. Spot-check
  Operations → Residents to confirm clinical data restored.

If the boot fails with a schema error, the migration journal in the
restored DB is older than what `shared/schema.ts` expects. Decide:
either restore further forward, or run `npm run db:migrate` against
the restored branch to catch it up.

### Step 5 — Cut over (real incident only)

**Skip this step in a drill.** Do not point production at a restored
DB unless this is a real recovery.

```bash
# Take the app to maintenance mode FIRST so writes stop.
flyctl scale count 0 -a ncu

# Swap the secret.
flyctl secrets set DATABASE_URL="<restored-connection-string>" -a ncu

# Bring the app back.
flyctl scale count 1 -a ncu

# Watch the post-deploy logs.
flyctl logs -a ncu
```

The smoke test in `deploy.yml` will run against the post-cutover app
automatically if you trigger a deploy; otherwise hit `/api/health/deep`
manually.

### Step 6 — Drain the original DB (real incident only, after 24 h)

Once you're confident the restored DB is the new source of truth and
the original is no longer needed:

- Neon: delete the old branch via `neonctl branches delete`.
- Fly Postgres: `flyctl pg destroy <old-pg-app>` after confirming
  `flyctl logs -a <old-pg-app>` shows zero traffic for 24 hours.

Do NOT delete during the incident — leave it as a fallback in case the
restored DB has its own problem.

### Step 7 — Post-drill checklist

Tick these off after every drill, including dry runs:

- [ ] Drill completed end-to-end (no shortcuts).
- [ ] App booted against the restored DB and `/api/health/deep` returned 200.
- [ ] Spot-checked at least one row known to exist at the restore timestamp.
- [ ] Wrote down the wall-clock time it took. Goal: under 30 min. If it
      took longer, the runbook is missing a step — update it.
- [ ] Deleted the restore branch / Fly app to avoid surprise bills.
- [ ] Updated this runbook with anything that was unclear or wrong.

---

## What's NOT covered (gaps to close in future phases)

- **Object storage backups.** `ops_evidence_attachments`, signed-URL
  uploads, and any other binary content on Fly volumes are NOT in this
  procedure. They're currently best-effort. Phase 9 or 10 should
  decide between (a) shipping uploads to S3 with versioning + lifecycle,
  or (b) periodic volume snapshots via `flyctl volumes snapshots create`.
- **Cross-region failover.** A region-wide Neon outage is recovered by
  branching from a region-local backup, not by hot standby. If hot standby
  becomes a requirement, that's a separate phase.
- **Encryption-at-rest key rotation.** Out of scope here — handled by the
  DB provider's KMS integration.
- **Tabletop exercise vs real chaos.** This runbook is a tabletop drill.
  A real chaos test would intentionally break the DB connection during
  business hours and time the user-visible impact. Defer until the app
  has enough users that breaking it for 10 minutes matters.
