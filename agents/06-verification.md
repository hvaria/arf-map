# Agent 6 — Migration Verification

Date: 2026-04-25
Migration log: agents/06-migration-run.log

## Row Count Verification

| Table | SQLite Baseline | Postgres Result | Status |
|-------|----------------|-----------------|--------|
| users | 0 | 0 | SKIP (empty) |
| job_seeker_accounts | 6 | 6 | ✅ PASS |
| job_seeker_profiles | 5 | 5 | ✅ PASS |
| facility_accounts | 0 | 0 | SKIP (empty) |
| facilities | 10,498 | 10,498 | ✅ PASS |
| facility_overrides | 3 | 3 | ✅ PASS |
| applicant_interests | 0 | 0 | SKIP (empty) |
| job_postings | 3 | 3 | ✅ PASS |
| login_attempts | 22 | 22 | ✅ PASS |
| enrichment_runs | 0 | 0 | SKIP (empty) |
| All ops_* tables (19) | 0 each | 0 each | SKIP (empty) |

**Result: 6 PASS | 0 FAIL | 23 SKIP**

## Coordinate Coverage Check

facilities.lat/lng non-null verification performed during migration.
All 10,498 facility rows transferred including geocoded coordinates.

## Boolean Coercion

`emailVerified` column in job_seeker_accounts:
- SQLite INTEGER (0/1) converted to Postgres BOOLEAN (false/true)
- 6 accounts migrated with correct boolean type

## SERIAL Sequences Reset

All 28 SERIAL sequences reset to MAX(id) after migration.
Future inserts will not conflict with migrated rows.

## Overall Status: ✅ ALL CHECKS PASSED

Migration is safe to proceed to production cutover (Agent 7).
