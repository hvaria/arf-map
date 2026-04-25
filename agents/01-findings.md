# Agent 1 — Codebase Archaeologist Findings

## 1. Facilities Table — Location Fields

**Source:** `shared/schema.ts` (lines 83–107) and `shared/etl-types.ts` (lines 19–43)

| Field | Type | Nullable | Default | Purpose |
|-------|------|----------|---------|---------|
| `address` | TEXT | NO | `""` | Street address from CHHS CCL resource |
| `city` | TEXT | NO | `""` | City name — stored in **ALL CAPS** |
| `county` | TEXT | NO | `""` | County name from CCL resource |
| `zip` | TEXT | NO | `""` | ZIP code |
| `lat` | REAL | YES | NULL | Latitude (nullable until geocoded) |
| `lng` | REAL | YES | NULL | Longitude (nullable until geocoded) |
| `geocode_quality` | TEXT | NO | `""` | Audit string: `""`, `"nominatim"`, `"api"`, `"geocode_failed"` |

**City casing:**
- `server/services/facilitiesService.ts:133` — `city: (row.facility_city ?? "").trim().toUpperCase()`
- `scripts/etl-helpers.ts:199` — `city: (geo?.[fm.fromGeo.city] ?? "").trim().toUpperCase()`
- Both ingestion paths normalize to ALL CAPS before DB write.

---

## 2. Geocoding Subsystem

**Primary geocoder:** `server/services/facilitiesService.ts` lines 216–289

### Constants (lines 33–35)
```
NOMINATIM_BASE = "https://nominatim.openstreetmap.org/search"
CCL_RESOURCE   = "9f5d1d00-6b24-4f44-a158-9cbe4b43f117"
GEOCODE_DELAY  = 1100  // ms between requests
```

### `nominatimLookup(q)` (lines 222–238)
- Internal helper. Returns `{ lat: number; lng: number } | null`.
- Fetches Nominatim with `format=json&limit=1&countrycodes=us`.
- Returns `null` on error or empty result.

### `geocodeMissingCoords()` (lines 245–289)
- Background loop. Queries facilities where `lat IS NULL AND geocode_quality != 'geocode_failed'`.
- Processes in batches of 50 (line 255).
- Two-stage lookup per facility:
  1. `${fac.name} ${fac.address} ${fac.city} CA ${fac.zip}` (line 266)
  2. `${fac.address} ${fac.city} CA ${fac.zip}` (line 272) — fallback if stage 1 returns null
- On success: calls `updateFacilityCoords(number, lat, lng, "nominatim")` (line 278)
- On failure: calls `updateFacilityCoords(number, null, null, "geocode_failed")` (line 285)
- Stops looping when batch size < 50 (all remaining facilities are geocoded or failed)

### `updateFacilityCoords(number, lat, lng, quality)` — `server/storage.ts` lines 788–797
```sql
UPDATE facilities SET lat=?, lng=?, geocode_quality=? WHERE number=?
```

---

## 3. geocode_quality Values

| Value | When Written | Meaning |
|-------|--------------|---------|
| `""` | Initial CCL load | Not yet geocoded |
| `"nominatim"` | Nominatim success | Geocoded via OpenStreetMap |
| `"geocode_failed"` | Both Nominatim attempts null | Permanent skip — not re-queried |
| `"api"` | GEO API had coordinates | From upstream CHHS GEO resource |

**Critical gap:** `"geocode_failed"` rows are permanently locked out of re-geocoding. The query on line 254 excludes them forever:
```typescript
WHERE lat IS NULL AND geocode_quality != 'geocode_failed'
```

---

## 4. ETL Pipeline & Seeding Sequence

```
Server startup
└─ autoSeedIfEmpty()  [facilitiesService.ts:50]
   └─ isDatabaseSeeded() → getFacilityDbCount() > 0  [line 78-84]
      └─ If empty, setImmediate(() => seedFromCCL())  [line 52]

seedFromCCL()  [lines 160-214]
├─ fetchAllPages(CCL_RESOURCE)           — paginates CHHS API (page_size=5000)
├─ mapCCLToFacility(row)                 — normalizes each row
│   └─ city.toUpperCase()               — ALL CAPS here [line 133]
│   └─ lat=0, lng=0 initially           [lines 152-153]
├─ fills in-memory cache immediately    [line 171]
├─ bulkUpsertFacilities(rows)            — writes to SQLite [lines 175-203]
└─ geocodeMissingCoords().catch(...)    — NOT awaited [line 211]

Background geocoding loop  [async, non-blocking]
└─ nominatimLookup() × N facilities
   └─ updateFacilityCoords() per result
```

### `isDatabaseSeeded()` (lines 78–84)
```typescript
export function isDatabaseSeeded(): boolean {
  try { return getFacilityDbCount() > 0; }
  catch { return false; }
}
```
- Checks `SELECT COUNT(*) FROM facilities > 0`
- Returns false on any DB error (safe fallback)

### `autoSeedIfEmpty()` (lines 50–53)
```typescript
export async function autoSeedIfEmpty(): Promise<void> {
  if (isDatabaseSeeded() || _seeding) return;
  setImmediate(() => seedFromCCL().catch(...));
}
```
- Called once on server startup
- `_seeding` flag (line 162) prevents duplicate runs
- Uses `setImmediate` — does not block startup

---

## 5. geocodeMissingCoords() Callers

**Only one caller:** `facilitiesService.ts:211` inside `seedFromCCL()`
```typescript
geocodeMissingCoords().catch((err) =>
  console.error("[facilitiesService] geocoder error:", err)
);
```
- Not awaited — fire-and-forget
- No manual re-geocode endpoint exists

---

## 6. How Routes Serve Facility Data

### Three paths:

**Path 1: DB seeded (normal production)**
- `GET /api/facilities` → `queryFacilitiesAll()` (`storage.ts:671`)
- `GET /api/facilities/search` → `searchFacilitiesAutocomplete()` (`storage.ts:679`)
- `GET /api/facilities/meta` → `getFacilitiesMeta()` (`storage.ts:702`)
- Returns `FacilityDbRow[]` from SQLite with job postings joined

**Path 2: DB empty, seeding in progress**
- Routes use in-memory cache via `getCachedFacilities()` (`facilitiesService.ts:59`)
- lat/lng === 0 rows are filtered out client-side (line 296)

**Path 3: DB empty, no seed**
- `getCachedFacilities()` triggers fresh CHHS fetch (line 64)
- Cached 24 hours (CACHE_TTL_MS line 39)

### FacilityDbRow → Facility mapping in routes.ts (lines 261–290):
```typescript
{
  number: r.number,
  city: r.city,              // ALL CAPS passes through here
  county: r.county,
  lat: r.lat!,
  lng: r.lng!,
  geocodeQuality: r.geocode_quality,
  // ...
}
```

---

## 7. Key Files & Line Numbers

| File | Key Functions | Lines |
|------|--------------|-------|
| `shared/schema.ts` | `facilitiesTable`, Facility zod schema | 83–186 |
| `shared/etl-types.ts` | `FacilityDbRow`, `TYPE_TO_NAME` | 18–105 |
| `server/db/index.ts` | SQLite connection, WAL mode | 1–33 |
| `server/storage.ts` | `bulkUpsertFacilities`, `getFacilityDbCount`, `updateFacilityCoords` | 149–870 |
| `server/services/facilitiesService.ts` | `isDatabaseSeeded`, `autoSeedIfEmpty`, `seedFromCCL`, `geocodeMissingCoords`, `mapCCLToFacility` | 45–289 |
| `server/routes.ts` | `/api/facilities*` endpoints | 119–340 |
| `server/routes/adminEtl.ts` | `POST /api/admin/etl/enrich` | 29–47 |
| `server/etlScheduler.ts` | `startEtlScheduler`, nightly enrichment at 2 AM UTC | 95–112 |
| `scripts/etl-helpers.ts` | `fetchFacilityEnrichment`, `mergeFacilityRow` | 29–399 |
| `scripts/enrich-facilities.ts` | Background enrichment, rate limiter | 152–234 |
