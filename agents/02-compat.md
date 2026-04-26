# Agent 2 — PostgreSQL Compatibility Research

Date: 2026-04-25
Prepared from audit: agents/01-audit.md

---

## 1. Drizzle ORM Dialect Changes

### Import Path Changes

**SQLite (current)**
```typescript
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { drizzle } from "drizzle-orm/better-sqlite3";
```

**PostgreSQL (new)**
```typescript
import { pgTable, text, integer, bigint, doublePrecision, boolean, serial } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/node-postgres";
```

### Table Function Changes

| SQLite | PostgreSQL |
|--------|-----------|
| `sqliteTable("name", {...})` | `pgTable("name", {...})` |

### Column Type Mappings

#### 1. Auto-increment Primary Keys

**SQLite:**
```typescript
integer().primaryKey({ autoIncrement: true })
```

**PostgreSQL (recommended):**
```typescript
serial().primaryKey()
```

Affected columns: `users.id`, `jobSeekerAccounts.id`, `jobSeekerProfiles.id`, `facilityAccounts.id`, `facilityOverrides.id`, `jobPostingsTable.id`, `applicantInterests.id`

#### 2. Boolean Fields (stored as INTEGER 0/1 in SQLite)

**SQLite:**
```typescript
integer().default(0)  // 0 = false, 1 = true
```

**PostgreSQL:**
```typescript
boolean().default(false)
```

Affected columns in shared/schema.ts:
- `jobSeekerAccounts.emailVerified`
- `facilityAccounts.emailVerified`

Plus 70+ boolean columns in opsSchema.ts (see Section 9).

**Data migration note:** Convert INTEGER 0 → false, INTEGER 1 → true when transferring rows.

#### 3. Unix Millisecond Timestamps (CRITICAL — OVERFLOW HAZARD)

**HAZARD:** SQLite `integer()` is 64-bit. PostgreSQL `integer()` is 32-bit (max 2,147,483,647). Current Unix ms epoch is ~1,700,000,000,000 — **immediate overflow** if stored in Postgres `integer`.

**SQLite:**
```typescript
integer().notNull()  // Unix timestamp in milliseconds
```

**PostgreSQL:**
```typescript
bigint({ mode: "number" }).notNull()  // 64-bit, handles ms timestamps
```

#### 4. Floating-Point Columns

**SQLite:**
```typescript
real()  // 64-bit IEEE 754
```

**PostgreSQL:**
```typescript
doublePrecision()  // same semantics, no coercion needed during transfer
```

Affected columns: `facilitiesTable.lat`, `facilitiesTable.lng`, `opsMedPasses.preVitalsTemp`, billing REAL columns.

#### 5. Text Columns with JSON Semantics

**SQLite:**
```typescript
text().$type<string[]>()
```

**PostgreSQL — keep as text (recommended for migration simplicity):**
```typescript
text().$type<string[]>()
```

Affected columns: `jobSeekerProfiles.jobTypes`, `jobPostingsTable.requirements`, `opsMedications.scheduledTimes`, `opsResidentAssessments.rawJson`

#### 6. Text Primary Keys (no change)

```typescript
text().primaryKey()  // identical in both dialects
```

### Drizzle Query Method Changes

| SQLite (sync) | PostgreSQL (async) |
|--------------|-------------------|
| `.get()` | `(await query)[0]` or `.limit(1)` then `[0]` |
| `.all()` | `await query` |
| `.run()` | `await query` |

**Important:** All Postgres queries via Drizzle are async and return arrays. `.get()` does not exist.

---

## 2. Raw SQL Compatibility

### a) Auto-increment Primary Key Syntax

```sql
-- SQLite
INTEGER PRIMARY KEY AUTOINCREMENT

-- PostgreSQL
SERIAL PRIMARY KEY
```

### b) ON CONFLICT Syntax — Identical

PostgreSQL 9.5+ supports identical `ON CONFLICT(col) DO UPDATE SET col=excluded.col` syntax. No changes needed.

### c) Parameter Placeholders

```sql
-- SQLite (node-sqlite3 style)
INSERT INTO sessions VALUES (?, ?, ?)

-- PostgreSQL (node-postgres style)
INSERT INTO sessions VALUES ($1, $2, $3)
```

All `?` placeholders must become `$1`, `$2`, `$3`, etc.

### d) Table Introspection (replaces sqlite.pragma)

**SQLite:**
```typescript
const cols = sqlite.pragma(`table_info(${table})`) as Array<{ name: string }>;
```

**PostgreSQL:**
```typescript
const result = await pool.query(
  "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND table_schema = 'public'",
  [tableName]
);
const cols = result.rows.map(r => r.column_name as string);
```

### e) Multi-statement Execution

**SQLite:**
```typescript
sqlite.exec(`CREATE TABLE IF NOT EXISTS a (...); CREATE TABLE IF NOT EXISTS b (...);`);
```

**PostgreSQL — split and run individually:**
```typescript
const statements = sql.split(/;\s*\n/).filter(s => s.trim().length > 0);
for (const stmt of statements) {
  await pool.query(stmt);
}
```

### f) Transactions

**SQLite:**
```typescript
sqlite.transaction(() => {
  // sync operations
})();
```

**PostgreSQL:**
```typescript
const client = await pool.connect();
try {
  await client.query("BEGIN");
  // async operations using client.query(...)
  await client.query("COMMIT");
} catch (err) {
  await client.query("ROLLBACK");
  throw err;
} finally {
  client.release();
}
```

Or via Drizzle:
```typescript
await db.transaction(async (tx) => {
  await tx.insert(facilities).values(row);
});
```

### g) LOWER() LIKE — Identical

`LOWER(col) LIKE $1` works identically in PostgreSQL. No change needed.

### h) WAL Mode Pragmas — Remove

```typescript
// Remove these entirely:
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("foreign_keys = ON");
// PostgreSQL handles WAL, durability, and FK enforcement natively.
```

---

## 3. Integer Timestamp (Bigint) Hazard — Complete Column List

Every column that currently stores Unix milliseconds as SQLite INTEGER must become `BIGINT` in PostgreSQL.

### Drizzle Tables (shared/schema.ts → shared/schema.pg.ts)

| Table | Column | Change |
|-------|--------|--------|
| jobSeekerAccounts | verificationExpiry | integer() → bigint({ mode: "number" }) |
| jobSeekerAccounts | createdAt | integer() → bigint({ mode: "number" }) |
| jobSeekerAccounts | lastLoginAt | integer() → bigint({ mode: "number" }) |
| jobSeekerAccounts | updatedAt | integer() → bigint({ mode: "number" }) |
| jobSeekerProfiles | updatedAt | integer() → bigint({ mode: "number" }) |
| facilityAccounts | verificationExpiry | integer() → bigint({ mode: "number" }) |
| facilityAccounts | createdAt | integer() → bigint({ mode: "number" }) |
| facilityOverrides | updatedAt | integer() → bigint({ mode: "number" }) |
| jobPostingsTable | postedAt | integer() → bigint({ mode: "number" }) |
| facilitiesTable | updatedAt | integer() → bigint({ mode: "number" }) |
| facilitiesTable | enrichedAt | integer() → bigint({ mode: "number" }) |
| applicantInterests | createdAt | integer() → bigint({ mode: "number" }) |
| applicantInterests | updatedAt | integer() → bigint({ mode: "number" }) |

### Bootstrap Tables (storage.ts raw SQL)

| Table | Column | Change |
|-------|--------|--------|
| sessions | expired_at | INTEGER NOT NULL → BIGINT NOT NULL |
| login_attempts | attempted_at | INTEGER NOT NULL → BIGINT NOT NULL |
| enrichment_runs | started_at | INTEGER NOT NULL → BIGINT NOT NULL |
| enrichment_runs | finished_at | INTEGER → BIGINT |

### Ops Tables (server/ops/opsSchema.ts raw SQL — all timestamp columns)

| Table | Timestamp Columns |
|-------|-------------------|
| opsResidents | dob, admissionDate, dischargeDate, createdAt, updatedAt |
| opsResidentAssessments | assessedAt, nextDueDate, createdAt |
| opsCarePlans | effectiveDate, reviewDate, signatureDate, createdAt, updatedAt |
| opsDailyTasks | completedAt, taskDate, createdAt |
| opsMedications | startDate, endDate, discontinuedAt, createdAt, updatedAt |
| opsMedPasses | scheduledDatetime, administeredDatetime, prnEffectivenessNotedAt, createdAt |
| opsControlledSubCounts | countDate, createdAt |
| opsMedDestruction | destructionDate, createdAt |
| opsIncidents | incidentDate, supervisorNotifiedAt, familyNotifiedAt, physicianNotifiedAt, lic624SubmittedAt, followUpDate, createdAt, updatedAt |
| opsLeads | prospectDob, desiredMoveInDate, lastContactDate, nextFollowUpDate, createdAt, updatedAt |
| opsTours | scheduledAt, completedAt, createdAt |
| opsAdmissions | lic601Date, lic602aDate, lic603Date, lic604aDate, lic605aDate, lic610dDate, admissionAgreementSignedAt, moveInDate, createdAt, updatedAt |
| opsBillingCharges | billingPeriodStart, billingPeriodEnd, prorateFrom, prorateTo, createdAt |
| opsInvoices | billingPeriodStart, billingPeriodEnd, dueDate, sentAt, paidAt, createdAt, updatedAt |
| opsPayments | paymentDate, createdAt |
| opsStaff | hireDate, terminationDate, licenseExpiry, createdAt, updatedAt |
| opsShifts | shiftDate, createdAt |
| opsFacilitySettings | updatedAt |
| opsComplianceCalendar | dueDate, completedDate, createdAt |

**Total: 70+ timestamp columns across 30 tables must be BIGINT.**

---

## 4. Session Store Replacement

### Current

- File: `server/session/sqliteSessionStore.ts`
- Class: `SqliteSessionStore` (custom, synchronous)
- Table: `sessions` (sid TEXT PK, sess TEXT, expired_at INTEGER)

### Replacement: connect-pg-simple

**Package:** `connect-pg-simple`

**Constructor:**
```typescript
import session from "express-session";
import ConnectPgSimple from "connect-pg-simple";

const PgSession = ConnectPgSimple(session);

new PgSession({
  pool: pgPool,              // pg.Pool instance
  tableName: "session",      // connect-pg-simple default
  createTableIfMissing: true,
})
```

**Table created by connect-pg-simple:**
```sql
CREATE TABLE "session" (
  "sid" varchar NOT NULL COLLATE "default",
  "sess" json NOT NULL,
  "expire" timestamp(6) NOT NULL,
  CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);
CREATE INDEX "IDX_session_expire" ON "session" ("expire");
```

**Key differences from current SQLite store:**
- Table name: `sessions` → `session` (connect-pg-simple default)
- Expiry column: `expired_at INTEGER` (Unix ms) → `expire TIMESTAMP`
- Data type: `sess TEXT` → `sess JSON`

**Session migration strategy:** Drop existing sessions and let users re-login (sessions are volatile/ephemeral — no user data loss). This is the safest approach.

---

## 5. Drizzle Kit Config Changes

**Current `drizzle.config.ts`:**
```typescript
export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "sqlite",
  dbCredentials: { url: "./data.db" },
});
```

**New `drizzle.config.ts` (dual-mode):**
```typescript
import { defineConfig } from "drizzle-kit";

const isPg = !!process.env.DATABASE_URL;

export default defineConfig(
  isPg
    ? {
        out: "./migrations",
        schema: "./shared/schema.pg.ts",
        dialect: "postgresql",
        dbCredentials: { url: process.env.DATABASE_URL! },
      }
    : {
        out: "./migrations",
        schema: "./shared/schema.ts",
        dialect: "sqlite",
        dbCredentials: { url: process.env.DATA_DIR ? `${process.env.DATA_DIR}/data.db` : "./data.db" },
      }
);
```

---

## 6. Connection Pooling

**Package:** `pg` (node-postgres)

```typescript
import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
  ssl: process.env.NODE_ENV === "production"
    ? { rejectUnauthorized: false }  // Fly Postgres uses self-signed certs internally
    : false,
});
```

**Fly.io internal connection string format:**
```
postgres://username:password@ncu-db.flycast:5432/ncu
```

**SSL notes:**
- Internal Fly connections (`.flycast`): `rejectUnauthorized: false` (self-signed cert)
- External connections: add `?sslmode=require` to connection string

**Pool sizing for 512 MB / 1 CPU:**
- `max: 10` is safe and recommended
- Monitor with `SELECT count(*) FROM pg_stat_activity;`

**Drizzle integration:**
```typescript
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

const pool = new Pool({ connectionString: process.env.DATABASE_URL, ... });
export const db = drizzle(pool);
```

---

## 7. Fly.io Postgres Provisioning Commands

```bash
# 1. Create Postgres cluster (cheapest tier)
fly postgres create \
  --name ncu-db \
  --region lax \
  --initial-cluster-size 1 \
  --vm-size shared-cpu-1x \
  --volume-size 1

# 2. Attach to app — automatically sets DATABASE_URL secret
fly postgres attach ncu-db --app ncu

# 3. Verify secret was set
fly secrets list --app ncu
# Should show: DATABASE_URL = postgres://...

# 4. Verify cluster health
fly postgres connect --app ncu-db
# psql prompt — type \l to list databases, \q to exit

# 5. Show connection details
fly postgres show --app ncu-db
```

`fly postgres attach` sets `DATABASE_URL` automatically as a Fly secret on `ncu`.

---

## 8. New Packages Required

Add to `package.json` dependencies:
```json
{
  "pg": "^8.12.0",
  "connect-pg-simple": "^9.0.0"
}
```

Add to `devDependencies`:
```json
{
  "@types/pg": "^8.11.0",
  "@types/connect-pg-simple": "^7.0.0"
}
```

**Do NOT remove:**
- `better-sqlite3` — keep until production cutover verified
- `@types/better-sqlite3` — keep

---

## 9. Ops Schema Raw SQL Changes

Every table in `server/ops/opsSchema.ts` `OPS_SCHEMA_SQL` string needs:

| Pattern | SQLite | PostgreSQL |
|---------|--------|-----------|
| PK | `INTEGER PRIMARY KEY AUTOINCREMENT` | `SERIAL PRIMARY KEY` |
| Boolean | `INTEGER DEFAULT 0` | `BOOLEAN DEFAULT FALSE` |
| Timestamp | `INTEGER NOT NULL` / `INTEGER` | `BIGINT NOT NULL` / `BIGINT` |
| Float | `REAL NOT NULL` / `REAL` | `DOUBLE PRECISION NOT NULL` / `DOUBLE PRECISION` |

Example conversion:
```sql
-- SQLite
CREATE TABLE IF NOT EXISTS ops_residents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  dob INTEGER,
  refused INTEGER DEFAULT 0,
  amount REAL NOT NULL,
  created_at INTEGER NOT NULL
);

-- PostgreSQL
CREATE TABLE IF NOT EXISTS ops_residents (
  id SERIAL PRIMARY KEY,
  dob BIGINT,
  refused BOOLEAN DEFAULT FALSE,
  amount DOUBLE PRECISION NOT NULL,
  created_at BIGINT NOT NULL
);
```

Multi-statement execution in PostgreSQL:
```typescript
// Replace: sqlite.exec(OPS_SCHEMA_SQL)
// With:
const stmts = OPS_SCHEMA_SQL.split(/;\s*\n/).filter(s => s.trim().length > 0);
for (const stmt of stmts) {
  await pool.query(stmt);
}
```

---

## 10. ENV.md Content

```markdown
# Environment Variables

## Database

| Variable | Required | Purpose |
|----------|----------|---------|
| `DATABASE_URL` | Yes (prod) | PostgreSQL connection string. Set automatically by `fly postgres attach`. Format: `postgres://user:pass@host:5432/db` |
| `DATA_DIR` | No | SQLite fallback: directory containing `data.db`. Used when `DATABASE_URL` is not set. Production Fly volume: `/data` |

## Security

| Variable | Required | Purpose |
|----------|----------|---------|
| `SESSION_SECRET` | Yes (prod) | Express session signing key. Generate: `openssl rand -hex 32` |

## Server

| Variable | Required | Purpose |
|----------|----------|---------|
| `NODE_ENV` | No | `development` or `production`. Controls Vite vs static file serving. |
| `PORT` | No | HTTP listen port. Default: `5000`. Fly.io uses `8080`. |

## Email

| Variable | Required | Purpose |
|----------|----------|---------|
| `RESEND_API_KEY` | No | Transactional email for OTP and password reset (Resend.com). |

## ETL / Background Jobs

| Variable | Required | Purpose |
|----------|----------|---------|
| `ETL_HOUR_UTC` | No | Hour (0–23 UTC) for nightly facility enrichment. Default: `2`. |
| `SKIP_PREWARM` | No | Set to any value to skip facility cache pre-warm on startup. |
```
