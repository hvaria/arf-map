# Performance tuning runbook

**Phase 9 — performance polish.** How to find slow queries, verify
that a proposed index will actually help, and avoid the common mistake
of adding indexes that hurt more than they help. Reference companion
to the autocomplete trigram-index change shipped in Phase 9.

The codebase ships with ~160 indexes already. Resist the urge to add
more without measurement — every extra index slows writes on the
parent table, occupies disk, and adds time to `VACUUM`.

---

## Rule of thumb

**Don't add an index until a real query is measurably slow against a
realistic dataset, and EXPLAIN ANALYZE shows the planner choosing a
sequential scan over a candidate index path.**

The exception is the situation that drove Phase 9: an index already
existed but couldn't be used because a sibling branch in a `WHERE ... OR
...` clause was non-indexable. That's not "adding an index for a future
slow query"; it's unblocking an index that was already paid for.

---

## Step 1 — Find slow queries

### Option A — Neon Slow Queries dashboard (preferred)

Neon (this project's Postgres provider) exposes `pg_stat_statements`
out of the box and surfaces it in the console:

1. Open the project in the Neon console.
2. **Monitoring → Slow queries.** Sort by `Total exec time` (the
   highest-impact queries are not always the slowest single calls —
   they're slow × frequently called).
3. Note the query text + `mean exec time` + `calls`.

### Option B — pg_stat_statements directly

If you're on Fly Postgres or a self-managed instance:

```sql
-- One-time setup (requires superuser).
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;

-- Add to postgresql.conf and restart:
--   shared_preload_libraries = 'pg_stat_statements'
--   pg_stat_statements.max = 10000
--   pg_stat_statements.track = top

-- Top 20 by total exec time
SELECT
  queryid,
  substring(query, 1, 80) AS short_query,
  calls,
  round(mean_exec_time::numeric, 2) AS mean_ms,
  round(total_exec_time::numeric, 0) AS total_ms,
  round(stddev_exec_time::numeric, 2) AS stddev_ms,
  rows / NULLIF(calls, 0) AS avg_rows
FROM pg_stat_statements
ORDER BY total_exec_time DESC
LIMIT 20;

-- Reset between tuning sessions so you're measuring a clean window:
SELECT pg_stat_statements_reset();
```

### What "slow" means in this app

| Pattern                          | Threshold |
|----------------------------------|-----------|
| Typeahead / autocomplete         | p95 > 100ms |
| Map facility list (bulk)         | p95 > 800ms |
| Single-resident detail page      | p95 > 300ms |
| Calendar / dashboard aggregates  | p95 > 500ms |
| Audit-trail / report generation  | p95 > 2s  |

These are based on the user-perceived latency budget for each surface,
not arbitrary Postgres benchmarks. If a query hits the threshold
*consistently*, fix it. If it hits once in a blue moon, write it down
and revisit when there's a pattern.

---

## Step 2 — EXPLAIN ANALYZE the candidate

Run the suspect query through `EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)`
with realistic parameters. Don't trust `EXPLAIN` without `ANALYZE` —
that returns the planner's *guess*, not what the query actually did.

```sql
-- Walkthrough: the Phase 9 autocomplete query before vs after.

-- BEFORE Phase 9 (without idx_facilities_number_trgm, idx_facilities_city_trgm):
EXPLAIN (ANALYZE, BUFFERS)
SELECT * FROM facilities
WHERE LOWER(name) LIKE '%sunrise%'
   OR number LIKE '%sunrise%'
   OR LOWER(city) LIKE '%sunrise%'
LIMIT 10;
-- Typical plan: Seq Scan on facilities (cost=0.00..2500.00 rows=10)
-- Even though idx_facilities_name_trgm exists, the planner can't
-- bitmap-OR a mix of indexed and non-indexed branches.

-- AFTER Phase 9 (with the two companion trigram indexes):
-- Same query as above produces:
-- BitmapOr
--   ├─ Bitmap Index Scan on idx_facilities_name_trgm
--   ├─ Bitmap Index Scan on idx_facilities_number_trgm
--   └─ Bitmap Index Scan on idx_facilities_city_trgm
-- Bitmap Heap Scan on facilities
-- LIMIT 10
```

### What to look for

- `Seq Scan` on a large table = candidate for indexing IF a useful
  index could be added (the index has to match the WHERE pattern —
  b-tree for equality / prefix LIKE / range, GIN trigram for substring
  LIKE, GIN/GiST for arrays/JSON containment).
- `Index Scan` or `Bitmap Index Scan` = good; the planner is using the
  index.
- High `Buffers: shared read=NNNN` = lots of disk reads. After the
  first hot query the cache warms and this drops.
- `Rows Removed by Filter: NNN` after an Index Scan = the index isn't
  selective enough; the planner reads many rows then throws most away.
  Often means you want a narrower index (compound, or partial).
- `Rows: NNNN` very different from `actual rows=N` in the plan = the
  planner stats are stale. Run `ANALYZE <table>` and re-test.

### Compare a candidate index against the real one

```sql
-- "Will this proposed index actually be used?" Quick test:
CREATE INDEX CONCURRENTLY idx_candidate
  ON some_table USING gin (lower(col) gin_trgm_ops);
ANALYZE some_table;
EXPLAIN ANALYZE <your-query>;
-- If the plan now picks idx_candidate, keep it.
-- If not, drop it:
DROP INDEX CONCURRENTLY idx_candidate;
```

`CONCURRENTLY` adds and drops without taking a table lock, so this is
safe to run on production at a quiet hour. Always test the drop too —
half-built indexes from a cancelled `CREATE INDEX CONCURRENTLY` need
manual cleanup (`DROP INDEX` again).

---

## Step 3 — Don't add the index if any of these apply

- The slow query runs < 100 times / day AND mean exec time < 200 ms.
  That's < 20 s/day of total CPU. Don't optimize.
- The target table sees > 100 writes / minute and the candidate index
  would touch a high-cardinality column. Write amplification will
  cost more than the read savings.
- The column has < 20 distinct values across millions of rows
  (e.g. `status` with 5 enum values on a 10M-row table). The planner
  will pick seqscan over a non-selective index anyway. Use a partial
  index `WHERE status = 'active'` if that subset is what you actually
  query.
- The "slow" query isn't measured against production-shaped data.
  Dev databases with 100 rows always seqscan because index overhead
  isn't worth it on small datasets.

---

## Step 4 — Apply the change

Always via a migration, not via the bootstrap or `db:push`:

1. Generate a migration: `npm run db:generate` after editing the
   Drizzle schema (if the change is schema-level), or hand-write
   `migrations/NNNN_<description>.sql` for an index-only change like
   Phase 9.
2. **Use `CREATE INDEX CONCURRENTLY`** for production tables. Without
   it, the index build takes an `ACCESS EXCLUSIVE` lock that blocks
   reads + writes for the duration of the build. Migrations apply
   inside a transaction by default — wrap concurrent index DDL in a
   plain `.sql` statement (no transaction) or split it into its own
   file.

   ```sql
   -- migrations/NNNN_add_xyz_index.sql — non-transactional index build
   CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_xyz
     ON some_table (col);
   ```

   Note: `CONCURRENTLY` cannot run inside a transaction block. Drizzle
   wraps each migration file in a transaction by default; for
   concurrent index DDL, mark the migration with `-- breakpoints:
   false` or split into its own file.

3. Update `server/db/bootstrap.ts` to mirror the index inside the
   relevant `CREATE TABLE ... CREATE INDEX IF NOT EXISTS` block so
   fresh dev databases get it at boot. Keep the mirror plain `IF NOT
   EXISTS` (not CONCURRENTLY) — bootstrap runs on empty/dev DBs where
   blocking doesn't matter.
4. Document the index purpose + the query it serves in CLAUDE.md
   if it's part of an invariant the architecture relies on.

---

## Step 5 — Verify

After the migration runs in prod:

```sql
-- Confirm the index exists and is valid (not dropped half-built).
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public' AND tablename = 'facilities'
  AND indexname LIKE 'idx_facilities_%';

-- Confirm pg_stat_statements shows the query getting faster.
SELECT calls, mean_exec_time, total_exec_time
FROM pg_stat_statements
WHERE query LIKE '%searchFacilitiesAutocomplete%' -- or whatever
ORDER BY total_exec_time DESC
LIMIT 5;

-- Re-run EXPLAIN ANALYZE and confirm the plan switched to use the
-- new index.
```

If the planner still picks seqscan with the new index present:

- Check `pg_stat_user_indexes` for `idx_scan` — if zero, the index has
  literally never been used.
- Re-run `ANALYZE <table>` to refresh planner stats.
- Check the query parameters — maybe a previously-hot value combination
  isn't representative.
- Consider whether the planner's cost estimate for seqscan is
  artificially low on a small dataset. Production data may flip the
  decision automatically.

---

## What's NOT covered

- **Query rewrites / denormalisation.** Sometimes the right fix is a
  materialized view or a write-time aggregate, not an index. Out of
  scope here — those changes are big enough to warrant their own
  phase.
- **Connection pool tuning.** `pg.Pool` defaults are fine for current
  traffic. Revisit when concurrent connections approach the Neon /
  Fly Postgres connection limit (typically 100 for paid Neon plans,
  20-30 default on Fly).
- **N+1 query patterns.** A handler that runs `getResident()` then
  `getMedicationsForResident()` then `getAllergiesForResident()` etc.
  is 3 round-trips that could be 1 join. Look in the slow-query log
  for queries with `calls = M × N` where M is your request count and
  N is some per-request multiplier; that's the smell.
- **APM / per-route latency budgeting.** Sentry Performance + the
  uptime monitor cover liveness. Per-route p95/p99 budgets are out
  of scope until the customer base is large enough to need per-route
  SLOs.
