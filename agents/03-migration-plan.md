# Agent 3 — SQLite → PostgreSQL Migration Plan

Date: 2026-04-25
Prepared from: agents/01-audit.md, agents/02-compat.md

---

## 1. Row Count Baseline

Script outline for `scripts/get-baseline.ts`:

```
1. Connect to SQLite (DATA_DIR/data.db or ./data.db)
2. For each table (attempt SELECT COUNT(*) — skip silently if missing):
   users, job_seeker_accounts, job_seeker_profiles,
   facility_accounts, facility_overrides, job_postings,
   facilities, applicant_interests,
   sessions, login_attempts, enrichment_runs,
   ops_residents, ops_resident_assessments, ops_care_plans, ops_daily_tasks,
   ops_medications, ops_med_passes, ops_controlled_sub_counts, ops_med_destruction,
   ops_incidents, ops_leads, ops_tours, ops_admissions,
   ops_billing_charges, ops_invoices, ops_payments,
   ops_staff, ops_shifts, ops_facility_settings, ops_compliance_calendar
3. Output JSON: { timestamp, tables: { tableName: count }, totalRows }
4. Write to baseline-sqlite.json
```

---

## 2. Data Type Coercions During Row Transfer

### 2a. Boolean Columns (INTEGER 0/1 → boolean)

Coercion: `sqliteValue === 1 ? true : false`

| Table | Boolean Columns |
|-------|----------------|
| job_seeker_accounts | emailVerified |
| facility_accounts | emailVerified |
| login_attempts | success |
| ops_resident_assessments | bathing, dressing, grooming, toileting, continence, eating, mobility, transfers, mealPrep, housekeeping, laundry, transportation, finances, communication, selfAdministerMeds |
| ops_daily_tasks | refused |
| ops_medications | isPrn, isControlled, isPsychotropic, isHazardous, requiresVitalsBefore, autoRefillRequest |
| ops_med_passes | rightResident, rightMedication, rightDose, rightRoute, rightTime, rightReason, rightDocumentation, rightToRefuse |
| ops_controlled_sub_counts | discrepancy, resolved |
| ops_incidents | injuryInvolved, hospitalizationRequired, supervisorNotified, familyNotified, physicianNotified, lic624Required, lic624Submitted, soc341Required, soc341Submitted, followUpCompleted |
| ops_admissions | lic601Completed, lic602aCompleted, lic603Completed, lic604aCompleted, lic605aCompleted, lic610dCompleted, admissionAgreementSigned, physicianReportReceived, tbTestResultsReceived, moveInCompleted, welcomeCompleted |
| ops_billing_charges | isRecurring, prorated |
| ops_shifts | isOvertime |

**Total: 70 boolean columns across 13 tables.**

### 2b. Timestamp Columns (INTEGER ms → BIGINT)

No data coercion needed — numeric value transfers as-is. JavaScript `number` safely holds Unix ms (up to 2^53-1). The target column type in PostgreSQL **must be BIGINT**, not INTEGER.

All 73 timestamp columns listed in agents/02-compat.md Section 3.

### 2c. JSON Text Columns

No coercion needed — string value transfers as-is. Validate JSON during transfer and log warnings.

Columns: `jobSeekerProfiles.jobTypes`, `jobPostings.requirements`, `opsResidentAssessments.rawJson`, `opsMedications.scheduledTimes`

### 2d. REAL → DOUBLE PRECISION

No coercion needed. Identical IEEE 754 semantics.

**IMPORTANT for `facilities.lat` and `facilities.lng`:** Preserve nulls. Preserve zeros (invalid geocodes should remain zero, not be converted to null).

---

## 3. Migration Script Design (`scripts/migrate-to-pg.ts`)

### CLI

```bash
npx tsx scripts/migrate-to-pg.ts [--dry-run] [--table=name] [--batch-size=500]
```

### Phase 1 — Pre-flight Checks

```
1. SQLite DB exists and is readable → exit 1 if not
2. PostgreSQL pool.connect() succeeds → exit 1 if not
3. All target tables exist in Postgres (information_schema.tables) → exit 1 if any missing
4. Capture SQLite row counts for all 29 tables
5. Log baseline counts
```

### Phase 2 — Transfer (in FK dependency order, Section 4)

```
For each table:
  1. Read all rows: SELECT * FROM table_name
  2. If --dry-run: log "[DRY RUN] table: would insert N rows" → skip
  3. Split rows into batches of --batch-size (default 500)
  4. Per batch:
     a. Apply boolean coercions (0/1 → false/true)
     b. Validate JSON columns (log warnings, do not fail)
     c. INSERT INTO table (...) VALUES ($1, $2, ...) ON CONFLICT DO NOTHING
     d. Log progress
  5. Log "✓ table: N rows migrated"
```

**Idempotency:** `ON CONFLICT DO NOTHING` on primary key ensures safe re-runs.

**Preserving SERIAL IDs:** Insert with explicit ID values using `OVERRIDING SYSTEM VALUE` for SERIAL columns to preserve SQLite integer IDs. This allows FK relationships to be satisfied.

```sql
INSERT INTO users (id, username, password)
OVERRIDING SYSTEM VALUE
VALUES ($1, $2, $3)
ON CONFLICT (id) DO NOTHING
```

After migration, reset sequences:
```sql
SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));
```

### Phase 3 — Verification

```
For each table:
  1. SELECT COUNT(*) in both SQLite and Postgres
  2. Compare: match = PASS, mismatch = FAIL

Special checks:
  facilities: verify % non-null lat/lng matches between SQLite and Postgres
  Boolean columns: sample 20 rows, verify values are true/false not 0/1

Exit code 0 if all PASS, exit code 1 if any FAIL.
```

### Phase 4 — Report

```
Print: "N tables PASSED | M tables FAILED"
If --dry-run: "DRY RUN: No data written to PostgreSQL"
```

---

## 4. Table Migration Order (FK Dependencies)

| # | Table | Depends On |
|---|-------|-----------|
| 1 | users | — |
| 2 | job_seeker_accounts | — |
| 3 | job_seeker_profiles | job_seeker_accounts |
| 4 | facilities | — |
| 5 | facility_accounts | — |
| 6 | facility_overrides | — |
| 7 | applicant_interests | job_seeker_accounts, facilities |
| 8 | job_postings | — |
| 9 | login_attempts | — |
| 10 | enrichment_runs | — |
| 11 | ops_residents | — |
| 12 | ops_resident_assessments | ops_residents |
| 13 | ops_care_plans | ops_residents |
| 14 | ops_daily_tasks | ops_residents, ops_care_plans |
| 15 | ops_medications | — |
| 16 | ops_med_passes | ops_medications, ops_residents |
| 17 | ops_controlled_sub_counts | ops_medications |
| 18 | ops_med_destruction | ops_medications |
| 19 | ops_incidents | ops_residents (nullable) |
| 20 | ops_leads | — |
| 21 | ops_tours | ops_leads |
| 22 | ops_admissions | ops_leads, ops_residents (nullable) |
| 23 | ops_billing_charges | ops_residents |
| 24 | ops_invoices | ops_residents |
| 25 | ops_payments | ops_invoices |
| 26 | ops_staff | — |
| 27 | ops_shifts | ops_staff |
| 28 | ops_facility_settings | — |
| 29 | ops_compliance_calendar | — |

**Sessions: NOT migrated (see Section 5).**

---

## 5. Sessions Table Handling

### Recommendation: Option C — Drop Sessions, Force Re-Login

**Rationale:**
- Sessions are volatile/ephemeral — not user data
- Schema mismatch: SQLite `sessions` (expired_at INTEGER) vs. connect-pg-simple `session` (expire TIMESTAMPTZ) — high conversion complexity
- Standard practice: session store migrations always drop sessions
- Users experience one re-login at most; 7-day cookie life makes this infrequent

**Implementation:**
- Migration script skips `sessions` table entirely
- App starts with connect-pg-simple's `createTableIfMissing: true` — creates fresh `session` table in Postgres
- Users get login form on next request; new session created in Postgres

---

## 6. Rollback Plan

### Stage 1 — Before migration script runs
**Risk:** None. App still on SQLite.
**Rollback:** Nothing to do.

### Stage 2 — After migration script, before app restart
**Risk:** Low. Postgres has data, app ignores it.
**Rollback:** Nothing to do (or drop Postgres DB and re-run).

### Stage 3 — After setting DATABASE_URL (app live on Postgres)
**Risk:** High. Any writes in this window go to Postgres only.
**Rollback:**
```bash
fly secrets unset DATABASE_URL --app ncu
# App restarts automatically in SQLite mode
# Writes made during Stage 3 are lost (SQLite volume unaffected)
```

### Stage 4 — After removing SQLite code/volume (future)
**Risk:** Critical. No automatic fallback.
**Rollback:** Restore from volume snapshot + revert to prior git commit.
**Note:** Do not reach this stage until Postgres is stable for 2+ weeks.

---

## 7. Sequence Resets (Post-Migration)

After migrating rows with explicit IDs (OVERRIDING SYSTEM VALUE), reset all SERIAL sequences so future inserts don't collide:

```sql
SELECT setval('users_id_seq', COALESCE((SELECT MAX(id) FROM users), 1));
SELECT setval('job_seeker_accounts_id_seq', COALESCE((SELECT MAX(id) FROM job_seeker_accounts), 1));
SELECT setval('job_seeker_profiles_id_seq', COALESCE((SELECT MAX(id) FROM job_seeker_profiles), 1));
SELECT setval('facility_accounts_id_seq', COALESCE((SELECT MAX(id) FROM facility_accounts), 1));
SELECT setval('facility_overrides_id_seq', COALESCE((SELECT MAX(id) FROM facility_overrides), 1));
SELECT setval('job_postings_id_seq', COALESCE((SELECT MAX(id) FROM job_postings), 1));
SELECT setval('applicant_interests_id_seq', COALESCE((SELECT MAX(id) FROM applicant_interests), 1));
SELECT setval('login_attempts_id_seq', COALESCE((SELECT MAX(id) FROM login_attempts), 1));
SELECT setval('enrichment_runs_id_seq', COALESCE((SELECT MAX(id) FROM enrichment_runs), 1));
-- Plus all ops_* tables with SERIAL PKs
```
