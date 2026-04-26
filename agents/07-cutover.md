# Agent 7 — Production Cutover

Date: 2026-04-25 / 2026-04-26T03:17 UTC
App: ncu (Fly.io, region: lax)

## Status: ✅ COMPLETE — Production is running on PostgreSQL

---

## Pre-Cutover Checklist

- [x] DATABASE_URL Fly secret set on ncu app
- [x] npm run build passes with zero TypeScript errors
- [x] Agent 6 data verification: all 6 non-empty tables match (10,498 facilities)
- [x] Agent 6 spot-check: row counts verified
- [x] Dual-mode works: app starts on SQLite without DATABASE_URL
- [x] BLOCKER-1 resolved: routes use *Async variants with await
- [x] BLOCKER-3 resolved: session invalidation has Postgres path
- [x] BLOCKER-4 mitigated: ops routes return 503 in Postgres mode (ops tables all empty)

---

## Deploy

Command: `fly deploy --app ncu`
Image: `registry.fly.io/ncu:deployment-01KQ3WHMY6R2W7V8T6BJD9FM1R`
Strategy: rolling (zero-downtime)
Machine: `148e03e4a3e158` → healthy

---

## Startup Log Confirmation

```
2026-04-26T03:17:32Z app[148e03e4a3e158] lax [info] [db] using PostgreSQL
```

✅ App is running in PostgreSQL mode.

---

## Smoke Tests

| Test | Result |
|------|--------|
| GET /api/health | ✅ `{"status":"ok"}` |
| GET /api/facilities/meta | ✅ `totalCount: 10498`, 7 facilityTypes, counties list |
| GET /api/facilities/search?q=care | ✅ Returns matching facilities with number/name/city |
| GET /api/facilities?county=LOS%20ANGELES | ✅ Returns LA facilities with lat/lng coordinates |

All four smoke tests PASS.

---

## Remaining Items (Future Work)

- **BLOCKER-4 (Ops module)**: All ops_* routes return 503 in Postgres mode. All ops tables exist in Postgres (created via create-pg-ops-tables.ts) and are empty. Resolving requires implementing `server/ops/opsStoragePg.ts` with async pool.query implementations. Estimated effort: 6–8 hours.

- **ETL enrichment (db-writer.ts)**: The nightly enrichment job still writes to SQLite. For Postgres mode, `scripts/db-writer.ts` and `scripts/enrich-facilities.ts` need to be updated to use pool.query instead of better-sqlite3. Until this is resolved, Postgres facilities data will not receive nightly geocoding enrichment.

- **SQLite volume**: The `arf_data` volume at `/data` remains mounted as a rollback safety net. Can be detached after 2+ weeks of stable Postgres operation.

---

## Rollback Procedure (if needed)

```bash
fly secrets unset DATABASE_URL --app ncu
# App restarts automatically in SQLite mode
# SQLite volume (/data/data.db) is unaffected
```
