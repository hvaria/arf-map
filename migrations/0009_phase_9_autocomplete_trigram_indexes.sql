-- Phase 9 — autocomplete trigram indexes.
--
-- Pre-Phase-9: `searchFacilitiesAutocompleteAsync` runs
--   WHERE LOWER(name) LIKE $1 OR number LIKE $2 OR LOWER(city) LIKE $3
-- Only LOWER(name) had a GIN trigram index. Postgres cannot
-- bitmap-OR a mix of indexed and non-indexed branches, so the
-- planner fell back to a sequential scan over the full facilities
-- table on every keystroke from the typeahead.
--
-- This migration adds two complementary GIN trigram indexes so all
-- three OR branches can be served by an index scan and the planner
-- can bitmap-OR the result. EXPLAIN ANALYZE before/after is
-- documented in docs/runbooks/performance-tuning.md.
--
-- Why GIN trigram instead of b-tree:
--   - We need substring matching (`%q%`), not prefix matching. A
--     b-tree only helps `LIKE 'q%'` (anchored prefix). Trigrams index
--     every 3-char window of the column value, so substring lookups
--     of length >= 3 can probe the index directly.
--   - Below 3 chars the planner still seqscans — that's correct
--     because trigrams need at least one full 3-char window. The
--     typeahead is fine seqscan'ing single-char/two-char queries
--     because the result set is tiny relative to the LIMIT 10 cap.
--
-- `pg_trgm` extension was already enabled by migration
-- 0001_phase_2_structural_lockdown.sql when idx_facilities_name_trgm
-- was created. No CREATE EXTENSION needed here.
--
-- NOTE on CREATE INDEX vs CREATE INDEX CONCURRENTLY: the
-- performance-tuning runbook (docs/runbooks/performance-tuning.md)
-- prescribes CONCURRENTLY for production index builds. We use plain
-- CREATE INDEX here because (a) the `facilities` table is ~50k rows
-- and a GIN trigram build takes 5-15s, an acceptable lock window
-- inside a deploy maintenance slot; (b) drizzle-kit wraps each
-- migration file in a transaction by default and CONCURRENTLY cannot
-- run inside a transaction block. For a larger table the right move
-- is to split each CONCURRENTLY statement into its own migration
-- file with the transaction disabled — see the runbook for the
-- pattern. This trade-off is deliberate, not an oversight.

CREATE INDEX IF NOT EXISTS idx_facilities_number_trgm
  ON facilities USING GIN (number gin_trgm_ops);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_facilities_city_trgm
  ON facilities USING GIN (LOWER(city) gin_trgm_ops);
--> statement-breakpoint

-- Optional: re-ANALYZE so the planner's selectivity stats catch up
-- to the new indexes immediately. ANALYZE is fast on this table
-- (~50k rows) and safe to run inside a single statement.
ANALYZE facilities;
