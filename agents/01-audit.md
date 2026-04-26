# Agent 1 — Full Codebase Audit: SQLite → PostgreSQL Migration

## A. Drizzle Schema Patterns

### File: `shared/schema.ts`

**Table 1: `users`** (Lines 6–10)
- `id`: `integer().primaryKey({ autoIncrement: true })`
- `username`: `text().notNull().unique()`
- `password`: `text().notNull()`

**Table 2: `jobSeekerAccounts`** (Lines 12–25)
- `id`: `integer().primaryKey({ autoIncrement: true })`
- `username`: `text().notNull().unique()`
- `email`: `text().notNull().unique()`
- `password`: `text().notNull()`
- `emailVerified`: `integer().default(0)` — **stores boolean**
- `verificationToken`: `text()` (nullable)
- `verificationExpiry`: `integer()` — **Unix timestamp ms**
- `createdAt`: `integer().notNull()` — **Unix timestamp ms**
- `lastLoginAt`: `integer()` (nullable) — **Unix timestamp ms**
- `failedLoginCount`: `integer().default(0)`
- `updatedAt`: `integer()` (nullable) — **Unix timestamp ms**

**Table 3: `jobSeekerProfiles`** (Lines 27–45)
- `id`: `integer().primaryKey({ autoIncrement: true })`
- `accountId`: `integer().notNull().unique()`
- `name`: `text()` (nullable, legacy)
- `firstName`: `text()` (nullable)
- `lastName`: `text()` (nullable)
- `phone`: `text()` (nullable)
- `address`: `text()` (nullable)
- `city`: `text()` (nullable)
- `state`: `text()` (nullable)
- `zipCode`: `text()` (nullable)
- `profilePictureUrl`: `text()` (nullable)
- `yearsExperience`: `integer()` (nullable)
- `jobTypes`: `text().$type<string[]>()` (nullable) — **JSON array stored as text**
- `bio`: `text()` (nullable)
- `updatedAt`: `integer().notNull()` — **Unix timestamp ms**

**Table 4: `facilityAccounts`** (Lines 47–59)
- `id`: `integer().primaryKey({ autoIncrement: true })`
- `facilityNumber`: `text().notNull().unique()`
- `username`: `text().notNull().unique()`
- `password`: `text().notNull()`
- `email`: `text()` (nullable)
- `emailVerified`: `integer().notNull().default(0)` — **stores boolean**
- `verificationToken`: `text()` (nullable)
- `verificationExpiry`: `integer()` (nullable) — **Unix timestamp ms**
- `createdAt`: `integer().notNull()` — **Unix timestamp ms**
- `failedLoginCount`: `integer().notNull().default(0)`

**Table 5: `facilityOverrides`** (Lines 61–69)
- `id`: `integer().primaryKey({ autoIncrement: true })`
- `facilityNumber`: `text().notNull().unique()`
- `phone`: `text()` (nullable)
- `description`: `text()` (nullable)
- `website`: `text()` (nullable)
- `email`: `text()` (nullable)
- `updatedAt`: `integer().notNull()` — **Unix timestamp ms**

**Table 6: `jobPostingsTable`** (Lines 71–80)
- `id`: `integer().primaryKey({ autoIncrement: true })`
- `facilityNumber`: `text().notNull()`
- `title`: `text().notNull()`
- `type`: `text().notNull()`
- `salary`: `text().notNull()`
- `description`: `text().notNull()`
- `requirements`: `text().notNull().$type<string[]>()` — **JSON array stored as text**
- `postedAt`: `integer().notNull()` — **Unix timestamp ms**

**Table 7: `facilitiesTable`** (Lines 83–107)
- `number`: `text().primaryKey()` — **text primary key**
- `name`: `text().notNull()`
- `facilityType`: `text().notNull().default('')`
- `facilityGroup`: `text().notNull().default('')`
- `status`: `text().notNull()`
- `address`: `text().notNull().default('')`
- `city`: `text().notNull().default('')`
- `county`: `text().notNull().default('')`
- `zip`: `text().notNull().default('')`
- `phone`: `text().notNull().default('')`
- `licensee`: `text().notNull().default('')`
- `administrator`: `text().notNull().default('')`
- `capacity`: `integer().default(0)`
- `firstLicenseDate`: `text().default('')`
- `closedDate`: `text().default('')`
- `lastInspectionDate`: `text().default('')`
- `totalVisits`: `integer().default(0)`
- `totalTypeB`: `integer().default(0)`
- `citations`: `integer().default(0)`
- `lat`: `real()` (nullable) — **REAL / doublePrecision**
- `lng`: `real()` (nullable) — **REAL / doublePrecision**
- `geocodeQuality`: `text().default('')`
- `updatedAt`: `integer().notNull()` — **Unix timestamp ms**
- `enrichedAt`: `integer()` (nullable) — **Unix timestamp ms** (added via addColumnIfMissing)

**Table 8: `applicantInterests`** (Lines 110–119)
- `id`: `integer().primaryKey({ autoIncrement: true })`
- `jobSeekerId`: `integer().notNull()`
- `facilityNumber`: `text().notNull()`
- `roleInterest`: `text()` (nullable)
- `message`: `text()` (nullable)
- `status`: `text().notNull().default('pending')`
- `createdAt`: `integer().notNull()` — **Unix timestamp ms**
- `updatedAt`: `integer().notNull()` — **Unix timestamp ms**
- UNIQUE constraint on `(jobSeekerId, facilityNumber)`

---

### File: `server/ops/opsSchema.ts` (raw SQL OPS_SCHEMA_SQL string)

All tables defined as raw `CREATE TABLE IF NOT EXISTS` SQL (not Drizzle schema).

**Table: `opsResidents`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `facilityNumber`: TEXT NOT NULL
- `firstName`, `lastName`: TEXT NOT NULL
- `dob`, `admissionDate`, `dischargeDate`: INTEGER — **Unix timestamp ms**
- `gender`, `ssnLast4`, `roomNumber`, `bedNumber`, `primaryDx`, `secondaryDx`, `levelOfCare`: TEXT nullable
- `emergencyContact*`: TEXT nullable
- `fundingSource`, `regionalCenterId`: TEXT nullable
- `status`: TEXT NOT NULL DEFAULT 'active'
- `createdAt`, `updatedAt`: INTEGER NOT NULL — **Unix timestamp ms**

**Table: `opsResidentAssessments`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `residentId`, `facilityNumber`: references
- `assessedAt`: INTEGER NOT NULL — **Unix timestamp ms**
- `bathing`, `dressing`, `grooming`, `toileting`, `continence`, `eating`, `mobility`, `transfers`, `mealPrep`, `housekeeping`, `laundry`, `transportation`, `finances`, `communication`, `selfAdministerMeds`: INTEGER DEFAULT 0 — **stores boolean**
- `cognitionScore`: INTEGER nullable
- `vision`, `hearing`, `speech`, `ambulation`, `fallRiskLevel`, `behaviorNotes`: TEXT nullable
- `nextDueDate`: INTEGER nullable — **Unix timestamp ms**
- `licFormNumber`: TEXT nullable
- `rawJson`: TEXT nullable — **JSON object**
- `createdAt`: INTEGER NOT NULL — **Unix timestamp ms**

**Table: `opsCarePlans`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `effectiveDate`, `reviewDate`: INTEGER NOT NULL — **Unix timestamp ms**
- `signatureDate`: INTEGER nullable — **Unix timestamp ms**
- `status`: TEXT NOT NULL DEFAULT 'draft'
- `createdAt`, `updatedAt`: INTEGER NOT NULL — **Unix timestamp ms**

**Table: `opsDailyTasks`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `completedAt`, `taskDate`: INTEGER — **Unix timestamp ms**
- `refused`: INTEGER DEFAULT 0 — **stores boolean**

**Table: `opsMedications`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `startDate`, `endDate`, `discontinuedAt`: INTEGER nullable — **Unix timestamp ms**
- `scheduledTimes`: TEXT nullable — **JSON array**
- `isPrn`, `isControlled`, `isPsychotropic`, `isHazardous`, `requiresVitalsBefore`, `autoRefillRequest`: INTEGER DEFAULT 0 — **stores boolean**
- `createdAt`, `updatedAt`: INTEGER NOT NULL — **Unix timestamp ms**

**Table: `opsMedPasses`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `scheduledDatetime`: INTEGER NOT NULL — **Unix timestamp ms**
- `administeredDatetime`, `prnEffectivenessNotedAt`: INTEGER nullable — **Unix timestamp ms**
- `rightResident`, `rightMedication`, `rightDose`, `rightRoute`, `rightTime`, `rightReason`, `rightDocumentation`, `rightToRefuse`: INTEGER DEFAULT 0 — **stores boolean**
- `preVitalsTemp`: REAL nullable — **REAL / doublePrecision**
- `preVitalsPulse`, `preVitalsSpo2`: INTEGER nullable
- `createdAt`: INTEGER NOT NULL — **Unix timestamp ms**

**Table: `opsControlledSubCounts`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `countDate`: INTEGER NOT NULL — **Unix timestamp ms**
- `discrepancy`, `resolved`: INTEGER DEFAULT 0 — **stores boolean**
- `createdAt`: INTEGER NOT NULL — **Unix timestamp ms**

**Table: `opsMedDestruction`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `destructionDate`: INTEGER NOT NULL — **Unix timestamp ms**
- `createdAt`: INTEGER NOT NULL — **Unix timestamp ms**

**Table: `opsIncidents`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `incidentDate`: INTEGER NOT NULL — **Unix timestamp ms**
- `supervisorNotifiedAt`, `familyNotifiedAt`, `physicianNotifiedAt`, `lic624SubmittedAt`, `followUpDate`: INTEGER nullable — **Unix timestamp ms**
- `injuryInvolved`, `hospitalizationRequired`, `supervisorNotified`, `familyNotified`, `physicianNotified`, `lic624Required`, `lic624Submitted`, `soc341Required`, `soc341Submitted`, `followUpCompleted`: INTEGER DEFAULT 0 — **stores boolean**
- `createdAt`, `updatedAt`: INTEGER NOT NULL — **Unix timestamp ms**

**Table: `opsLeads`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `prospectDob`, `desiredMoveInDate`, `lastContactDate`, `nextFollowUpDate`: INTEGER nullable — **Unix timestamp ms**
- `createdAt`, `updatedAt`: INTEGER NOT NULL — **Unix timestamp ms**

**Table: `opsTours`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `scheduledAt`: INTEGER NOT NULL — **Unix timestamp ms**
- `completedAt`: INTEGER nullable — **Unix timestamp ms**
- `createdAt`: INTEGER NOT NULL — **Unix timestamp ms**

**Table: `opsAdmissions`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `lic601Date`, `lic602aDate`, `lic603Date`, `lic604aDate`, `lic605aDate`, `lic610dDate`, `admissionAgreementSignedAt`, `moveInDate`: INTEGER nullable — **Unix timestamp ms**
- `lic601Completed`, `lic602aCompleted`, `lic603Completed`, `lic604aCompleted`, `lic605aCompleted`, `lic610dCompleted`, `admissionAgreementSigned`, `physicianReportReceived`, `tbTestResultsReceived`, `moveInCompleted`, `welcomeCompleted`: INTEGER DEFAULT 0 — **stores boolean**
- `createdAt`, `updatedAt`: INTEGER NOT NULL — **Unix timestamp ms**

**Table: `opsBillingCharges`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `amount`: REAL NOT NULL — **REAL / doublePrecision**
- `quantity`: REAL NOT NULL DEFAULT 1 — **REAL / doublePrecision**
- `billingPeriodStart`, `billingPeriodEnd`, `prorateFrom`, `prorateTo`: INTEGER nullable — **Unix timestamp ms**
- `isRecurring`, `prorated`: INTEGER DEFAULT 0 — **stores boolean**
- `createdAt`: INTEGER NOT NULL — **Unix timestamp ms**

**Table: `opsInvoices`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `invoiceNumber`: TEXT NOT NULL UNIQUE
- `billingPeriodStart`, `billingPeriodEnd`: INTEGER NOT NULL — **Unix timestamp ms**
- `subtotal`, `tax`, `total`, `amountPaid`, `balanceDue`: REAL NOT NULL DEFAULT 0 — **REAL / doublePrecision**
- `dueDate`, `sentAt`, `paidAt`: INTEGER nullable — **Unix timestamp ms**
- `createdAt`, `updatedAt`: INTEGER NOT NULL — **Unix timestamp ms**

**Table: `opsPayments`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `amount`: REAL NOT NULL — **REAL / doublePrecision**
- `paymentDate`: INTEGER NOT NULL — **Unix timestamp ms**
- `createdAt`: INTEGER NOT NULL — **Unix timestamp ms**

**Table: `opsStaff`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `hireDate`, `terminationDate`, `licenseExpiry`: INTEGER nullable — **Unix timestamp ms**
- `createdAt`, `updatedAt`: INTEGER NOT NULL — **Unix timestamp ms**

**Table: `opsShifts`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `shiftDate`: INTEGER NOT NULL — **Unix timestamp ms**
- `isOvertime`: INTEGER DEFAULT 0 — **stores boolean**
- `createdAt`: INTEGER NOT NULL — **Unix timestamp ms**

**Table: `opsFacilitySettings`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `updatedAt`: INTEGER NOT NULL — **Unix timestamp ms**
- UNIQUE(`facilityNumber`, `settingKey`)

**Table: `opsComplianceCalendar`**
- `id`: INTEGER PRIMARY KEY AUTOINCREMENT
- `dueDate`: INTEGER NOT NULL — **Unix timestamp ms**
- `completedDate`: INTEGER nullable — **Unix timestamp ms**
- `createdAt`: INTEGER NOT NULL — **Unix timestamp ms**

---

## B. Raw SQL Patterns

### File: `server/storage.ts`

#### Bootstrap SQL (sqlite.exec — multi-statement, Lines 31–211)

```sql
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS facility_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  facility_number TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS facility_overrides (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  facility_number TEXT NOT NULL UNIQUE,
  phone TEXT, description TEXT, website TEXT, email TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS job_postings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  facility_number TEXT NOT NULL,
  title TEXT NOT NULL, type TEXT NOT NULL, salary TEXT NOT NULL,
  description TEXT NOT NULL, requirements TEXT NOT NULL,
  posted_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS job_seeker_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  email_verified INTEGER NOT NULL DEFAULT 0,
  verification_token TEXT,
  verification_expiry INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS job_seeker_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL UNIQUE,
  name TEXT, phone TEXT, city TEXT,
  years_experience INTEGER, job_types TEXT, bio TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expired_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_expired_at ON sessions (expired_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL, ip TEXT,
  success INTEGER NOT NULL DEFAULT 0,
  failure_reason TEXT,
  attempted_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts (email);

CREATE TABLE IF NOT EXISTS applicant_interests (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  job_seeker_id   INTEGER NOT NULL,
  facility_number TEXT NOT NULL,
  role_interest   TEXT, message TEXT,
  status          TEXT NOT NULL DEFAULT 'pending',
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE(job_seeker_id, facility_number)
);
CREATE INDEX IF NOT EXISTS idx_ai_facility ON applicant_interests(facility_number);
CREATE INDEX IF NOT EXISTS idx_ai_seeker   ON applicant_interests(job_seeker_id);
CREATE INDEX IF NOT EXISTS idx_ai_status   ON applicant_interests(status);

CREATE TABLE IF NOT EXISTS facilities (
  number TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  facility_type TEXT NOT NULL DEFAULT '',
  facility_group TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  county TEXT NOT NULL DEFAULT '',
  zip TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  licensee TEXT NOT NULL DEFAULT '',
  administrator TEXT NOT NULL DEFAULT '',
  capacity INTEGER DEFAULT 0,
  first_license_date TEXT DEFAULT '',
  closed_date TEXT DEFAULT '',
  last_inspection_date TEXT DEFAULT '',
  total_visits INTEGER DEFAULT 0,
  total_type_b INTEGER DEFAULT 0,
  citations INTEGER DEFAULT 0,
  lat REAL, lng REAL,
  geocode_quality TEXT DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_facilities_county ON facilities(county);
CREATE INDEX IF NOT EXISTS idx_facilities_type ON facilities(facility_type);
CREATE INDEX IF NOT EXISTS idx_facilities_group ON facilities(facility_group);
CREATE INDEX IF NOT EXISTS idx_facilities_status ON facilities(status);
CREATE INDEX IF NOT EXISTS idx_facilities_latln ON facilities(lat, lng);

CREATE TABLE IF NOT EXISTS enrichment_runs (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at       INTEGER NOT NULL,
  finished_at      INTEGER,
  trigger          TEXT NOT NULL DEFAULT 'scheduled',
  total_processed  INTEGER NOT NULL DEFAULT 0,
  total_enriched   INTEGER NOT NULL DEFAULT 0,
  total_no_data    INTEGER NOT NULL DEFAULT 0,
  total_failed     INTEGER NOT NULL DEFAULT 0
);
```

#### `addColumnIfMissing` function
Uses `sqlite.pragma("table_info(" + table + ")")` to get column list, then conditionally runs:
```sql
ALTER TABLE job_seeker_accounts ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0
ALTER TABLE job_seeker_accounts ADD COLUMN verification_token TEXT
ALTER TABLE job_seeker_accounts ADD COLUMN verification_expiry INTEGER
ALTER TABLE job_seeker_accounts ADD COLUMN last_login_at INTEGER
ALTER TABLE job_seeker_accounts ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0
ALTER TABLE job_seeker_profiles ADD COLUMN first_name TEXT
ALTER TABLE job_seeker_profiles ADD COLUMN last_name TEXT
ALTER TABLE job_seeker_profiles ADD COLUMN address TEXT
ALTER TABLE job_seeker_profiles ADD COLUMN state TEXT
ALTER TABLE job_seeker_profiles ADD COLUMN zip_code TEXT
ALTER TABLE job_seeker_profiles ADD COLUMN profile_picture_url TEXT
ALTER TABLE facilities ADD COLUMN enriched_at INTEGER
ALTER TABLE facility_accounts ADD COLUMN email TEXT
ALTER TABLE facility_accounts ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0
ALTER TABLE facility_accounts ADD COLUMN verification_token TEXT
ALTER TABLE facility_accounts ADD COLUMN verification_expiry INTEGER
ALTER TABLE facility_accounts ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0
```

#### Prepared Statements in `server/storage.ts`

**getInterestsByFacility** — `sqlite.prepare(...).all(facilityNumber)`
```sql
SELECT
  ai.id, ai.job_seeker_id as jobSeekerId, ai.facility_number as facilityNumber,
  ai.role_interest as roleInterest, ai.message, ai.status,
  ai.created_at as createdAt, ai.updated_at as updatedAt,
  a.email,
  p.first_name as firstName, p.last_name as lastName,
  p.city, p.state, p.years_experience as yearsExperience,
  p.job_types as jobTypes, p.bio
FROM applicant_interests ai
JOIN job_seeker_accounts a ON a.id = ai.job_seeker_id
LEFT JOIN job_seeker_profiles p ON p.account_id = ai.job_seeker_id
WHERE ai.facility_number = ?
ORDER BY ai.created_at DESC
```

**getInterestsBySeeker** — `sqlite.prepare(...).all(jobSeekerId)`
```sql
SELECT
  ai.id, ai.facility_number as facilityNumber,
  f.name as facilityName,
  ai.role_interest as roleInterest, ai.message, ai.status,
  ai.created_at as createdAt
FROM applicant_interests ai
LEFT JOIN facilities f ON f.number = ai.facility_number
WHERE ai.job_seeker_id = ?
ORDER BY ai.created_at DESC
```

**getFacilityDbCount** — `sqlite.prepare(...).get()`
```sql
SELECT COUNT(*) as n FROM facilities
```

**queryFacilitiesAll** — `sqlite.prepare(...).all(params)`
```sql
SELECT * FROM facilities {WHERE_CLAUSE}
AND lat IS NOT NULL AND lng IS NOT NULL AND lat != 0 AND lng != 0
ORDER BY name
```
(WHERE clause dynamically built by `buildFacilityWhere`)

**searchFacilitiesAutocomplete** — `sqlite.prepare(...).all(term, term, term, limit)`
```sql
SELECT * FROM facilities
WHERE LOWER(name) LIKE ? OR number LIKE ? OR LOWER(city) LIKE ?
LIMIT ?
```

**Metadata queries** — `sqlite.prepare(...).all()`:
```sql
SELECT facility_type as k, COUNT(*) as n FROM facilities GROUP BY facility_type ORDER BY facility_type
SELECT facility_group as k, COUNT(*) as n FROM facilities GROUP BY facility_group ORDER BY facility_group
SELECT county as k, COUNT(*) as n FROM facilities GROUP BY county ORDER BY county
SELECT status as k, COUNT(*) as n FROM facilities GROUP BY status ORDER BY status
SELECT MAX(updated_at) as t FROM facilities
```

**Coverage counts** — `sqlite.prepare(...).get()`:
```sql
SELECT COUNT(*) as n FROM facilities
SELECT COUNT(*) as n FROM facilities WHERE enriched_at IS NOT NULL
SELECT COUNT(*) as n FROM facilities WHERE last_inspection_date != ''
SELECT COUNT(*) as n FROM facilities WHERE administrator != ''
SELECT COUNT(*) as n FROM facilities WHERE licensee != ''
SELECT COUNT(*) as n FROM facilities WHERE total_type_b > 0
SELECT COUNT(*) as n FROM facilities WHERE citations > 0
```

**bulkUpsertFacilities** — inside `sqlite.transaction(fn)`, uses `sqlite.prepare(...).run(params)`:
```sql
INSERT INTO facilities (
  number, name, facility_type, facility_group, status,
  address, city, county, zip, phone,
  licensee, administrator, capacity,
  first_license_date, closed_date, last_inspection_date,
  total_visits, total_type_b, citations,
  lat, lng, geocode_quality, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(number) DO UPDATE SET
  name=excluded.name, facility_type=excluded.facility_type,
  facility_group=excluded.facility_group, status=excluded.status,
  address=excluded.address, city=excluded.city, county=excluded.county,
  zip=excluded.zip, phone=excluded.phone, licensee=excluded.licensee,
  administrator=excluded.administrator, capacity=excluded.capacity,
  first_license_date=excluded.first_license_date, closed_date=excluded.closed_date,
  last_inspection_date=CASE WHEN last_inspection_date != '' THEN last_inspection_date ELSE excluded.last_inspection_date END,
  total_visits=excluded.total_visits, total_type_b=excluded.total_type_b,
  citations=excluded.citations,
  lat=CASE WHEN excluded.lat IS NOT NULL THEN excluded.lat ELSE facilities.lat END,
  lng=CASE WHEN excluded.lng IS NOT NULL THEN excluded.lng ELSE facilities.lng END,
  geocode_quality=CASE WHEN excluded.geocode_quality != '' AND excluded.geocode_quality IS NOT NULL
                       THEN excluded.geocode_quality ELSE facilities.geocode_quality END,
  updated_at=excluded.updated_at
```

**updateFacilityCoords** — `sqlite.prepare(...).run(lat, lng, quality, number)`:
```sql
UPDATE facilities SET lat=?, lng=?, geocode_quality=? WHERE number=?
```

**logEnrichmentRun** — `sqlite.prepare(...).run(params)`:
```sql
INSERT INTO enrichment_runs
  (started_at, finished_at, trigger, total_processed, total_enriched, total_no_data, total_failed)
VALUES (?, ?, ?, ?, ?, ?, ?)
```

**Recent enrichment runs** — `sqlite.prepare(...).all()`:
```sql
SELECT * FROM enrichment_runs ORDER BY started_at DESC LIMIT 20
```

#### `sqlite.transaction(fn)` usage
- `bulkUpsertFacilities`: wraps batch INSERT/UPSERT in a transaction

#### `sqlite.pragma(...)` usage
- `sqlite.pragma("table_info(" + table + ")")` — in `addColumnIfMissing` to check existing columns

---

### File: `server/session/sqliteSessionStore.ts`

Session store raw SQL:
```sql
INSERT INTO sessions (sid, sess, expired_at) VALUES (?, ?, ?)
ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expired_at = excluded.expired_at
```
```sql
SELECT sess, expired_at FROM sessions WHERE sid = ?
```
```sql
DELETE FROM sessions WHERE sid = ?
```
```sql
UPDATE sessions SET expired_at = ? WHERE sid = ?
```
```sql
SELECT COUNT(*) as count FROM sessions WHERE expired_at > ?
```
```sql
DELETE FROM sessions
```
```sql
DELETE FROM sessions WHERE expired_at <= ?
```

### File: `scripts/db-writer.ts`

Uses same bootstrap pattern: `sqlite.pragma`, `sqlite.exec`, `sqlite.prepare`, `sqlite.transaction`.
Duplicate of `bulkUpsertFacilities` and `logEnrichmentRun` functions (standalone, no server/ imports).

---

## C. Session Store

- **File**: `server/session/sqliteSessionStore.ts`
- **Class**: `SqliteSessionStore` (custom implementation, extends `express-session` Store)
- **Package**: Custom — uses `better-sqlite3` directly
- **Constructor arg**: `db: BetterSqlite3.Database`
- **Session table**: `sessions` (`sid TEXT PRIMARY KEY`, `sess TEXT NOT NULL`, `expired_at INTEGER NOT NULL`)
- **Configured in**: `server/index.ts` Lines ~52–66
  - Secret: `process.env.SESSION_SECRET || "arf-map-facility-portal-secret"`
  - Cookie: `secure` in production, `httpOnly`, `sameSite: "lax"`, `maxAge`: 7 days

---

## D. DB Connection

**File**: `server/db/index.ts`

```typescript
const DB_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, "data.db")
  : "data.db";

export const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite);
```

- **Driver**: `better-sqlite3`
- **File path**: `data.db` in project root, or `${DATA_DIR}/data.db` if `DATA_DIR` env var set
- **WAL mode**: enabled
- **Sync**: NORMAL
- **Foreign keys**: enforced
- **Exports**: `sqlite` (raw better-sqlite3 instance) + `db` (Drizzle ORM instance)

---

## E. Package Dependencies

From `package.json`:

| Package | Version | Role |
|---------|---------|------|
| `better-sqlite3` | ^11.7.0 | SQLite driver |
| `drizzle-orm` | ^0.39.3 | ORM |
| `drizzle-zod` | ^0.7.0 | Zod integration |
| `drizzle-kit` | ^0.31.8 | Schema/migration tooling |
| `@types/better-sqlite3` | ^7.6.12 | Type definitions |
| `express-session` | ^1.18.1 | Session middleware |

No existing Postgres packages.

---

## F. Environment & Secrets

| Var | Purpose | Where consumed |
|-----|---------|----------------|
| `DATA_DIR` | Directory for `data.db` SQLite file | `server/db/index.ts`, `scripts/db-writer.ts` |
| `SESSION_SECRET` | Express session signing key | `server/index.ts` |
| `NODE_ENV` | `development` / `production` | `server/index.ts` (Vite vs static) |
| `PORT` | Express listen port (default 5000) | `server/index.ts` |
| `RESEND_API_KEY` | Transactional email | `server/email.ts` |
| `ETL_HOUR_UTC` | Override nightly enrichment hour | `server/etlScheduler.ts` |
| `SKIP_PREWARM` | Skip facility cache pre-warm | `server/index.ts` |

**`fly.toml` env section:**
```toml
[env]
  DATA_DIR = '/data'
  NODE_ENV = 'production'
  PORT = '8080'
```

No `DATABASE_URL` currently set — this is the new env var the migration will introduce.

---

## G. Scripts

**`scripts/db-writer.ts`**
- Standalone SQLite connection (not imported from `server/`)
- Uses `DATA_DIR` env var + `data.db`
- Sets WAL, NORMAL, foreign keys pragmas
- Creates `facilities` and `enrichment_runs` tables
- Exports: `bulkUpsertFacilities(rows)`, `logEnrichmentRun(data)`
- Uses `sqlite.transaction(fn)` for batch upserts
- Uses `sqlite.pragma("table_info(...)")` for `addColumnIfMissing`

**`scripts/seed-facilities-db.ts`**
- Reads `data/ccld_all_facilities.json`
- Maps rows and calls `bulkUpsertFacilities()` in chunks of 1000
- Idempotent (upsert logic)

**`scripts/enrich-facilities.ts`**
- CLI: `--limit`, `--county`, `--rps`, `--force`, `--trigger`
- Reads candidate facilities from DB (missing enrichment fields)
- Calls `fetchFacilityEnrichment()`, applies targeted UPDATE
- Uses `db-writer.ts` functions

---

## H. Drizzle Config

**File**: `drizzle.config.ts`

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data.db",
  },
});
```

---

## Summary: All Tables Requiring Migration

| Table | Source | Integer Booleans | Integer Timestamps | Real Cols | JSON Text |
|-------|--------|-----------------|-------------------|-----------|-----------|
| `users` | shared/schema.ts | — | — | — | — |
| `job_seeker_accounts` | shared/schema.ts | `emailVerified` | `verificationExpiry`, `createdAt`, `lastLoginAt`, `updatedAt` | — | — |
| `job_seeker_profiles` | shared/schema.ts | — | `updatedAt` | — | `jobTypes` |
| `facility_accounts` | shared/schema.ts | `emailVerified` | `verificationExpiry`, `createdAt` | — | — |
| `facility_overrides` | shared/schema.ts | — | `updatedAt` | — | — |
| `job_postings` | shared/schema.ts | — | `postedAt` | — | `requirements` |
| `facilities` | shared/schema.ts | — | `updatedAt`, `enrichedAt` | `lat`, `lng` | — |
| `applicant_interests` | shared/schema.ts | — | `createdAt`, `updatedAt` | — | — |
| `sessions` | storage.ts bootstrap | — | `expired_at` | — | `sess` (session JSON stored as text) |
| `login_attempts` | storage.ts bootstrap | `success` | `attempted_at` | — | — |
| `enrichment_runs` | storage.ts bootstrap | — | `started_at`, `finished_at` | — | — |
| `opsResidents` | ops/opsSchema.ts | — | `dob`, `admissionDate`, `dischargeDate`, `createdAt`, `updatedAt` | — | — |
| `opsResidentAssessments` | ops/opsSchema.ts | 14 boolean cols | `assessedAt`, `nextDueDate`, `createdAt` | — | `rawJson` |
| `opsCarePlans` | ops/opsSchema.ts | — | `effectiveDate`, `reviewDate`, `signatureDate`, `createdAt`, `updatedAt` | — | — |
| `opsDailyTasks` | ops/opsSchema.ts | `refused` | `completedAt`, `taskDate`, `createdAt` | — | — |
| `opsMedications` | ops/opsSchema.ts | 6 boolean cols | `startDate`, `endDate`, `discontinuedAt`, `createdAt`, `updatedAt` | — | `scheduledTimes` |
| `opsMedPasses` | ops/opsSchema.ts | 8 boolean cols | `scheduledDatetime`, `administeredDatetime`, `prnEffectivenessNotedAt`, `createdAt` | `preVitalsTemp` | — |
| `opsControlledSubCounts` | ops/opsSchema.ts | `discrepancy`, `resolved` | `countDate`, `createdAt` | — | — |
| `opsMedDestruction` | ops/opsSchema.ts | — | `destructionDate`, `createdAt` | — | — |
| `opsIncidents` | ops/opsSchema.ts | 10 boolean cols | `incidentDate`, 5 notification timestamps, `followUpDate`, `createdAt`, `updatedAt` | — | — |
| `opsLeads` | ops/opsSchema.ts | — | `prospectDob`, `desiredMoveInDate`, `lastContactDate`, `nextFollowUpDate`, `createdAt`, `updatedAt` | — | — |
| `opsTours` | ops/opsSchema.ts | — | `scheduledAt`, `completedAt`, `createdAt` | — | — |
| `opsAdmissions` | ops/opsSchema.ts | 11 boolean cols | 8 date columns, `createdAt`, `updatedAt` | — | — |
| `opsBillingCharges` | ops/opsSchema.ts | `isRecurring`, `prorated` | `billingPeriodStart`, `billingPeriodEnd`, `prorateFrom`, `prorateTo`, `createdAt` | `amount`, `quantity` | — |
| `opsInvoices` | ops/opsSchema.ts | — | `billingPeriodStart`, `billingPeriodEnd`, `dueDate`, `sentAt`, `paidAt`, `createdAt`, `updatedAt` | `subtotal`, `tax`, `total`, `amountPaid`, `balanceDue` | — |
| `opsPayments` | ops/opsSchema.ts | — | `paymentDate`, `createdAt` | `amount` | — |
| `opsStaff` | ops/opsSchema.ts | — | `hireDate`, `terminationDate`, `licenseExpiry`, `createdAt`, `updatedAt` | — | — |
| `opsShifts` | ops/opsSchema.ts | `isOvertime` | `shiftDate`, `createdAt` | — | — |
| `opsFacilitySettings` | ops/opsSchema.ts | — | `updatedAt` | — | — |
| `opsComplianceCalendar` | ops/opsSchema.ts | — | `dueDate`, `completedDate`, `createdAt` | — | — |

**Total tables**: 30
**Tables in shared/schema.ts (Drizzle)**: 8
**Tables in ops/opsSchema.ts (raw SQL)**: 16
**Tables in storage.ts bootstrap (raw SQL, no Drizzle schema)**: 6 (`sessions`, `login_attempts`, `enrichment_runs`, and already covered above)
