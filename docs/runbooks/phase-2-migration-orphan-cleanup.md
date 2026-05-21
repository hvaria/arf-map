# Phase 2 R1 — Orphan cleanup runbook

The Phase 2 R1 structural-lockdown migration (`migrations/0001_phase_2_structural_lockdown.sql`) adds foreign keys, composite tenant-integrity unique keys, and CHECK constraints to the ops_*, notes_*, tracker_*, and `facilities` tables. If the migration fails on production data, it is almost always one of three classes of issue. This runbook is the playbook for each.

## Pre-flight (run BEFORE `npm run db:migrate`)

1. **Snapshot the database.** Whatever your normal backup workflow is — `pg_dump`, Neon point-in-time, Supabase backup — take one. The migration is mostly additive but the `UPDATE facilities SET <col> = NULL WHERE <col> = ''` data migration in §4 is destructive in the sense that empty-string values are lost (recoverable from CCLD source on next ETL run, but a snapshot is faster).
2. **Run the diagnostic SELECTs.** The migration file inlines a `DIAGNOSTIC:` comment above every FK addition and every CHECK constraint. Each diagnostic is a single `SELECT count(*)` or `SELECT DISTINCT <col>, count(*)` query. Run them in psql against the prod DB to see exactly what would be deleted / what values exist:

   ```sql
   -- example: orphan med_passes whose medication is gone
   SELECT count(*) FROM ops_med_passes mp
    WHERE NOT EXISTS (SELECT 1 FROM ops_medications m WHERE m.id = mp.medication_id);

   -- example: distinct status values vs. the CHECK allowlist
   SELECT DISTINCT status, count(*) FROM ops_incidents GROUP BY status;
   ```

3. **If a diagnostic returns 0, you are safe** — apply the migration.

## Issue 1 — orphan child rows blocking an FK

**Symptom**: `ALTER TABLE ops_X ADD CONSTRAINT fk_ops_X_parent FOREIGN KEY ... REFERENCES ops_Y` fails with:

```
ERROR: insert or update on table "ops_X" violates foreign key constraint "fk_ops_X_parent"
DETAIL: Key (parent_id, facility_number)=(123, '997000000') is not present in table "ops_Y".
```

**Cause**: a child row's `parent_id` does not match any existing parent row. The migration tries to `DELETE FROM child WHERE NOT EXISTS (parent match)` before adding the FK, but that DELETE only removes orphans whose parent literally doesn't exist anywhere — it does NOT remove rows where the parent exists in a DIFFERENT facility (i.e., a cross-tenant violation).

**Fix**:

```sql
-- find the bad rows
SELECT child.id, child.facility_number, child.parent_id,
       parent.facility_number AS parent_facility
  FROM ops_X child
  LEFT JOIN ops_Y parent ON parent.id = child.parent_id
 WHERE parent.id IS NULL                                 -- truly orphan
    OR parent.facility_number <> child.facility_number;  -- cross-tenant

-- decide per row: was this a bug (delete it) or a real cross-tenant move?
-- For a real cross-tenant move (rare — e.g. resident transferred to a new
-- facility account) you must repoint the child to a new row in the right
-- facility. For a bug (much more common) just delete the child.
DELETE FROM ops_X WHERE id IN (<list>);

-- re-run the migration
npm run db:migrate
```

## Issue 2 — existing data violates a new CHECK constraint

**Symptom**: `ALTER TABLE ops_X ADD CONSTRAINT chk_ops_X_status CHECK (status IN ('a','b','c'))` fails with:

```
ERROR: check constraint "chk_ops_X_status" is violated by some row
```

**Cause**: a row has a value outside the allowed set — usually a typo from before Zod validation existed, or a value that was renamed in code without a backfill (e.g., `'closed_won'` got renamed to `'won'` but old rows still say `closed_won`).

**Fix**:

```sql
-- find the bad values
SELECT DISTINCT status, count(*) FROM ops_X GROUP BY status;

-- backfill to the canonical value
UPDATE ops_X SET status = 'won' WHERE status = 'closed_won';

-- re-run the migration
npm run db:migrate
```

If you can't decide what the canonical value should be — **comment out the CHECK constraint statement** in the migration SQL and leave a `-- TODO(phase-2-r2): re-add after backfilling X` comment. The migration will then proceed; a follow-up phase can add the CHECK once the data is clean.

## Issue 3 — `UPDATE facilities SET <col> = NULL WHERE <col> = ''` is slow

**Symptom**: the §4 data migration takes a long time and the migration appears stuck.

**Cause**: the `facilities` table has ~80k rows and each `UPDATE` is full-table-scan + row-by-row rewrite. On a small Postgres instance this can take minutes.

**Fix**: this is expected. Let it run. If you must interrupt:

```sql
-- check progress
SELECT pid, state, query_start, now() - query_start AS elapsed, query
  FROM pg_stat_activity
 WHERE query LIKE 'UPDATE facilities%'
   AND state != 'idle';
```

If you really have to abort, run the UPDATEs by hand outside the migration transaction, then `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('0001_phase_2_structural_lockdown', now())` once the ALTER COLUMN statements have also been applied.

## Issue 4 — `pg_trgm` extension not allowed by hosted provider

**Symptom**: `CREATE EXTENSION IF NOT EXISTS pg_trgm` fails with permission denied.

**Cause**: the database user doesn't have `CREATE` privilege on the database. On Neon, Supabase, and Fly Postgres `pg_trgm` is in the default allowlist — this only fails on locked-down hosted setups.

**Fix**: ask your DBA to run `CREATE EXTENSION pg_trgm;` as a superuser, then re-run the migration. The `IF NOT EXISTS` makes the migration's CREATE a no-op once the extension is present.

## Rollback

To reverse this migration in production:

```sql
-- §6 — drop trigram index + extension (extension only if nothing else uses it)
DROP INDEX IF EXISTS idx_facilities_name_trgm;
-- DROP EXTENSION pg_trgm;   -- only if no other index uses gin_trgm_ops

-- §4 — restore empty-string defaults on facilities (lossy: NULL → '')
ALTER TABLE facilities ALTER COLUMN address              SET DEFAULT '';
ALTER TABLE facilities ALTER COLUMN address              SET NOT NULL;
ALTER TABLE facilities ALTER COLUMN city                 SET DEFAULT '';
ALTER TABLE facilities ALTER COLUMN city                 SET NOT NULL;
-- ... repeat for county, zip, phone, licensee, administrator,
-- first_license_date, closed_date, last_inspection_date, geocode_quality
UPDATE facilities SET address = ''              WHERE address              IS NULL;
UPDATE facilities SET city    = ''              WHERE city                 IS NULL;
-- ... etc

-- §3 — drop CHECK constraints (idempotent)
ALTER TABLE ops_residents               DROP CONSTRAINT IF EXISTS chk_ops_residents_status;
ALTER TABLE ops_medications             DROP CONSTRAINT IF EXISTS chk_ops_medications_status;
-- ... repeat for every chk_ added in §3

-- §2 — drop FKs (idempotent)
ALTER TABLE ops_resident_assessments    DROP CONSTRAINT IF EXISTS fk_ops_resident_assessments_resident;
ALTER TABLE ops_care_plans              DROP CONSTRAINT IF EXISTS fk_ops_care_plans_resident;
-- ... repeat for every fk_ added in §2

-- §1 — drop composite UNIQUEs (only after the FKs that reference them are gone)
ALTER TABLE ops_residents               DROP CONSTRAINT IF EXISTS uniq_ops_residents_id_facility;
-- ... repeat for every uniq_ added in §1

-- finally, remove the migration row so drizzle-kit reruns 0001 next time
DELETE FROM drizzle.__drizzle_migrations WHERE hash = '0001_phase_2_structural_lockdown';
```

The reverse is rarely worth it — most failures are recoverable by fixing the offending data (Issue 1 / Issue 2) and retrying the forward migration. Only roll back if the migration has been live for less than a few hours and a critical app path is broken by one of the new constraints (e.g., a write that was silently corrupt before is now correctly rejected, but the calling code throws 500 instead of handling the error). In that case, fix the calling code in a hotfix PR rather than reverting the schema.
