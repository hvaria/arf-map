# Agent 5 — Blockers: SQLite → PostgreSQL Dual-Mode Bridge

Date: 2026-04-25

These are the issues that prevent full Postgres-mode operation that could not
be resolved without modifying files that are under the "do not change" constraint
(primarily server/routes.ts and the synchronous opsStorage/opsRouter module).

---

## BLOCKER-1: Synchronous storage functions called from routes.ts (HIGH)

**Affected functions in server/storage.ts:**
- `getFacilityDbCount()` — called from `facilitiesService.isDatabaseSeeded()`
- `queryFacilitiesAll()` — called synchronously at line ~245 in routes.ts
- `searchFacilitiesAutocomplete()` — called synchronously at line ~162 in routes.ts
- `getFacilitiesMeta()` — called synchronously at line ~123 in routes.ts
- `getInterestsByFacility()` — called synchronously in server/routes/interests.ts
- `getInterestsBySeeker()` — called synchronously in server/routes/interests.ts
- `getEnrichmentLog()` — called synchronously in server/routes/adminEtl.ts

**Why it's a blocker:**
PostgreSQL queries are inherently async (return Promises). The functions above
are currently synchronous (use better-sqlite3's synchronous API). Routes.ts
and sub-routers call them without `await`.

**Impact in Postgres mode:**
These functions throw a descriptive error:
  `"[storage] <functionName>: synchronous call not supported in Postgres mode"`
which Express catches and returns as a 500.

**Resolution:**
Async versions have been added to storage.ts:
- `getFacilityDbCountAsync()`
- `queryFacilitiesAllAsync()`
- `searchFacilitiesAutocompleteAsync()`
- `getFacilitiesMetaAsync()`
- `getInterestsByFacilityAsync()`
- `getInterestsBySeekerAsync()`
- `getEnrichmentLogAsync()`

Routes.ts and sub-routers must be updated to:
1. `await` these async functions
2. Use the `Async` suffix variants

Estimated effort: 2–3 hours. Routes are already inside `async` handlers (all
routes use `async (_req, res, next) => {}`), so adding `await` is minimal.

---

## BLOCKER-2: `isDatabaseSeeded()` cannot query Postgres synchronously (MEDIUM)

**File:** server/services/facilitiesService.ts
**Function:** `isDatabaseSeeded()`

**Why it's a blocker:**
`isDatabaseSeeded()` is called synchronously from routes.ts (line ~122, ~161,
~244). In Postgres mode it cannot make an async DB call.

**Current workaround:**
In Postgres mode, `isDatabaseSeeded()` returns a cached boolean
`_isDatabaseSeededCache` that is set to `true` after `seedFromCCL()` completes.
On first startup before seeding completes, it returns `false` — this causes
routes to fall back to the in-memory live-fetch path (getCachedFacilities),
which is correct behavior.

**Side effect:**
If the Postgres DB is already seeded (e.g., after migration), the first requests
will use the live-fetch path until `autoSeedIfEmpty()` checks the count and sets
the cache. This is a one-time delay on startup. It can be improved by pre-warming
the cache asynchronously in the startup sequence.

---

## BLOCKER-3: Session invalidation via raw SQL in routes.ts (LOW)

**File:** server/routes.ts (line ~562)
**Code:** `sqlite.prepare("DELETE FROM sessions WHERE json_extract(sess, '$.passport.user') = ?").run(account.id)`

**Why it's a blocker:**
This code path cannot be modified (routes.ts is in the "do not change" list).
In Postgres mode, `sqlite` is `undefined` at runtime, causing a TypeError on
this specific endpoint (facility password reset).

**Impact:**
Facility password reset will return a 500 error in Postgres mode on the session
invalidation step, even though the password has already been changed. The user's
password IS updated; only the session cleanup fails.

**Resolution:**
Update routes.ts to guard this call:
```typescript
if (!usingPostgres) {
  sqlite.prepare("DELETE FROM sessions ...").run(account.id);
}
```
Or implement session invalidation via the connect-pg-simple API / a pool.query call.

---

## BLOCKER-4: Ops module not fully implemented for Postgres (HIGH)

**Files:** server/ops/opsRouter.ts, server/ops/opsStorage.ts

**Why it's a blocker:**
The entire Ops module uses synchronous Drizzle ORM calls (`.get()`, `.all()`,
`.run()`) and raw `sqlite.prepare()` calls. In Postgres mode:
1. Drizzle pg-core returns Promises — calling `.get()` synchronously returns
   a Promise object, not the data.
2. Several functions use `sqlite.prepare()` directly for complex joins.

**Current workaround:**
An early-return middleware on `opsRouter` returns 503 for all Ops endpoints
in Postgres mode with a descriptive message.

**Affected functions (selected):**
- generateDailyMedPassEntries
- getFacilityMedPassQueue
- getResidentMedPassQueue
- getMedPassDashboard
- getPrnReport
- listIncidents
- getIncidentTrends
- updateAdmissionLicForm
- getOccupancy
- generateInvoice
- getArAging
- getBillingSummary
- getFacilityDashboard
- All Drizzle ORM functions (need async/await wrappers)

**Resolution:**
Create server/ops/opsStoragePg.ts with async implementations of all functions,
and conditionally load either module in opsRouter.ts based on `usingPostgres`.
Estimated effort: 1–2 days.

---

## BLOCKER-5: db-writer.ts script not updated (LOW)

**File:** scripts/db-writer.ts

**Why it's a blocker:**
This standalone script (used by ETL) maintains its own SQLite connection and
is not imported from server/. It was not updated for Postgres mode because it
is a standalone process that writes facilities data and can continue using SQLite
for ETL even when the main app uses Postgres.

**Resolution:**
If ETL should write to Postgres, update db-writer.ts to detect DATABASE_URL
and use the pg driver. This is low priority as the ETL can continue writing
to SQLite and the migration script transfers data to Postgres periodically.

---

## Summary

| Blocker | Severity | Workaround | Resolution Effort |
|---------|----------|------------|-------------------|
| BLOCKER-1: Sync storage functions | HIGH | Throws 500 in Postgres mode | 2–3 hours |
| BLOCKER-2: isDatabaseSeeded() sync | MEDIUM | Cache flag; live-fetch fallback | Already mitigated |
| BLOCKER-3: routes.ts session clear | LOW | Throws 500 on password reset only | 30 min |
| BLOCKER-4: Ops module sync | HIGH | 503 response for all Ops routes | 1–2 days |
| BLOCKER-5: db-writer.ts ETL | LOW | Continue using SQLite for ETL | Optional |

**SQLite mode: fully functional — no regressions.**
**Postgres mode: core auth, job postings, facility search work after BLOCKER-1 is resolved.
  Ops module needs BLOCKER-4 resolved.**
