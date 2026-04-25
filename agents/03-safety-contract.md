# Agent 3 — Safety Contract

## 1. Read-Path Audit

Every code path that reads `lat`, `lng`, or `geocode_quality` from the database or in-memory cache.

### 1A. Server-side read paths

| File | Function / location | What it reads | Behaviour when lat IS NULL | Behaviour when lat = 0 | Behaviour when geocode_quality is unknown string |
|------|---------------------|---------------|---------------------------|------------------------|--------------------------------------------------|
| `server/storage.ts:654–657` | `buildFacilityWhere` — bbox branch | `lat`, `lng` in SQL `WHERE` clause: `lat >= ? AND lat <= ? AND lng >= ? AND lng <= ?` | SQLite NULL comparison: `NULL >= minLat` evaluates to NULL (falsy) so the row is **silently excluded** from bbox queries. No error. | 0 passes or fails the bbox range check normally — a facility at (0,0) will be included if the bbox covers the Gulf of Guinea, which is outside California. Will never match a California bbox. | Not read here. |
| `server/routes.ts:287–289` | `GET /api/facilities` DB path — row-to-JSON mapping | `r.lat`, `r.lng`, `r.geocode_quality` | `r.lat!` uses a TypeScript non-null assertion. At runtime better-sqlite3 returns `null` as JavaScript `null`. The `!` does not throw — it silently passes `null` into the JSON response. The client receives `"lat": null`. | `r.lat!` returns `0`. Client receives `"lat": 0`. | `r.geocode_quality` is passed through as-is (`geocodeQuality: r.geocode_quality`). Any unknown string is forwarded to the client unchanged. |
| `server/routes.ts:296` | `GET /api/facilities` in-memory fallback path | `f.lat`, `f.lng` | Not reachable here — the in-memory path uses `FacilityBase` objects that were created with `lat: 0, lng: 0` (never NULL). | The filter `f.lat !== 0 && f.lng !== 0` at line 296 removes zero-coord facilities before returning. | Not read on this path. |
| `server/services/facilitiesService.ts:253–257` | `geocodeMissingCoords` — SELECT batch | `lat` in `WHERE lat IS NULL` | The query is designed to select only NULL-lat rows. Rows with `lat = 0` are NOT selected by this query. This is a critical gap: rows seeded via `bulkUpsertFacilities` with `lat: null` (line 198–199 of facilitiesService.ts) will be picked up correctly. However any row that was somehow written with `lat = 0` instead of `NULL` will be permanently skipped by the geocoder. | `lat = 0` rows are permanently skipped by the geocoder loop because the WHERE clause is `lat IS NULL`. | `geocode_quality != 'geocode_failed'` is the exclusion condition. Any unknown string (e.g. `"census_exact"`) does NOT match `'geocode_failed'` so the row is eligible for re-geocoding — meaning rows already geocoded by a new geocoder could be re-processed on the next loop run if their lat was somehow reset to NULL. |

### 1B. Client-side read paths

| File | Function / location | What it reads | Behaviour when lat is null | Behaviour when lat is 0 | Behaviour when geocode_quality is unknown string |
|------|---------------------|---------------|---------------------------|------------------------|--------------------------------------------------|
| `client/src/components/MapView.tsx:486–487` | `buildGeoJSON` — GeoJSON feature construction | `f.lng`, `f.lat` as coordinates | MapLibre receives `[null, null]` as coordinates. MapLibre silently drops or misrenders the point. No JS exception. The point disappears from the map. | MapLibre renders a pin at (0, 0) — in the middle of the ocean (Gulf of Guinea). Visible on the map as a spurious offshore pin. | Not read here. |
| `client/src/components/MapView.tsx:397–399` | `fitBounds` loop | `f.lng`, `f.lat` | `bounds.extend([null, null])` — MapLibre LngLatBounds.extend with null values throws a TypeError at runtime, breaking the bounds-fitting update for all facilities. | `bounds.extend([0, 0])` — valid but extends bounds to include (0,0), causing the map to zoom out to show the Gulf of Guinea. | Not read here. |
| `client/src/components/MapView.tsx:500` | `haversineDistanceMiles` call in `isNearby` property | `f.lat`, `f.lng` | `haversineDistanceMiles` receives `null` for lat/lng. `Math.sin(null * ...)` coerces null to 0. Returns a computed (wrong) distance. The `isNearby` flag will be incorrectly set based on distance from (0, 0). | Same arithmetic issue as null — distance is computed from (0, 0) which is ~6,000 miles from California, so `isNearby` will be `false` for all California user locations. Point will be dimmed on the map. | Not read here. |
| `client/src/components/FacilityPanel.tsx:153–155` | `distanceMiles` calculation | `facility.lat`, `facility.lng` | `haversineDistanceMiles` receives null. Same coercion to 0 as above — incorrect distance shown in the badge. Does not throw. | Same as null — shows wildly incorrect distance (~6,000 mi). | Not read here. |
| `client/src/components/MapView.tsx:430–435` | `easeTo` when selected facility changes | `selectedFacility.lng`, `selectedFacility.lat` | `map.easeTo({ center: [null, null] })` — MapLibre will throw or silently fail to animate. The map does not crash but may not pan to the facility. | `map.easeTo({ center: [0, 0] })` — map pans to the Gulf of Guinea. Visible, disorienting bug. | Not read here. |

### 1C. geocode_quality read paths

| Location | How it reads geocode_quality | Exact strings it branches on | Effect of unknown string |
|----------|------------------------------|------------------------------|--------------------------|
| `server/services/facilitiesService.ts:254` | SQL WHERE clause | `'geocode_failed'` — excluded from geocoding loop | Unknown string (e.g. `"census_exact"`) does NOT match, so the row is considered eligible for re-geocoding. If lat is also NULL, it will be re-geocoded by Nominatim. If lat is non-NULL, it will not be selected (WHERE lat IS NULL) — so existing geocoded rows are safe. |
| `server/routes.ts:289` | JSON projection `geocodeQuality: r.geocode_quality` | None — passes through unchanged | Unknown string is forwarded to client JSON unchanged. |
| Client (all components) | `facility.geocodeQuality` field is received but **never read or branched on** in any client component. No client code inspects this field's value. | N/A | No client-side effect. |

---

## 2. DB Schema Contract

### 2A. Drizzle table definition (`shared/schema.ts:83–107`)

```
facilitiesTable = sqliteTable("facilities", {
  ...
  lat:           real("lat"),                            // REAL, nullable — no .notNull()
  lng:           real("lng"),                            // REAL, nullable — no .notNull()
  geocodeQuality: text("geocode_quality").default(""),   // TEXT NOT NULL DEFAULT ''
  ...
})
```

### 2B. SQLite DDL (`server/storage.ts:149–179`)

```sql
lat  REAL,               -- no NOT NULL, no DEFAULT → SQLite default is NULL
lng  REAL,               -- same
geocode_quality TEXT DEFAULT ''   -- NOT NULL implied by DEFAULT with no explicit NULL
```

There is NO `NOT NULL` constraint on `lat` or `lng`. There is NO `CHECK` constraint on any of the three columns. There are NO `DEFAULT` values on `lat` or `lng`.

### 2C. TypeScript types

From `shared/etl-types.ts:39–41` (FacilityDbRow — what storage returns):
```typescript
lat:             number | null;   // correct: can be null
lng:             number | null;   // correct: can be null
geocode_quality: string;          // never null — empty string is the baseline
```

From `shared/schema.ts:181–183` (Facility Zod schema — what routes project and what the client receives):
```typescript
lat: z.number(),             // required number — does NOT accept null
lng: z.number(),             // required number — does NOT accept null
geocodeQuality: z.string(),  // required string
```

**This is the critical schema mismatch:** `FacilityDbRow.lat` is `number | null` but `Facility.lat` (Zod schema) is `z.number()`. The route at `server/routes.ts:287–288` uses the TypeScript non-null assertion `r.lat!` to paper over this mismatch. At runtime when `r.lat` is `null`, the JSON response contains `"lat": null`, which violates the Zod schema that the client trusts.

### 2D. seedFromCCL write contract

When `seedFromCCL` calls `bulkUpsertFacilities` (facilitiesService.ts:196–202), it writes:
```typescript
lat: null,              // explicitly null — correct
lng: null,              // explicitly null — correct
geocode_quality: "",    // empty string — correct baseline
```

The `bulkUpsertFacilities` ON CONFLICT clause (storage.ts:756–766) unconditionally overwrites `lat`, `lng`, and `geocode_quality` with the incoming values. This means a re-seed after geocoding has completed will wipe all geocoded coordinates and reset them to NULL.

---

## 3. Startup Sequence Contract

The following describes the exact sequence from process start to first HTTP request being served correctly.

### Step 1: storage.ts module load (synchronous, before any route registration)
- `sqlite.exec(CREATE TABLE IF NOT EXISTS facilities ...)` runs. Table is created if absent.
- `addColumnIfMissing("facilities", "enriched_at", ...)` runs. Safe on all DB states.
- All other table bootstraps run synchronously.

### Step 2: server/index.ts — Express app setup (synchronous)
- Express session store, Passport, routes registered.

### Step 3: `registerRoutes` calls `autoSeedIfEmpty()` (deferred via setImmediate)
- `isDatabaseSeeded()` calls `getFacilityDbCount()` → `SELECT COUNT(*) FROM facilities`.
- If count > 0: seeding is skipped. Routes will query SQLite from the first request.
- If count == 0: `setImmediate(() => seedFromCCL())` schedules seeding. The HTTP server is already listening. Requests arriving before seeding completes will hit the `isDatabaseSeeded() == false` branch in routes and call `getCachedFacilities()`.

### Step 4: During seedFromCCL (asynchronous, non-blocking)
- `_seeding = true` flag is set.
- `getCachedFacilities()` returns `_cache?.data ?? []` (empty array) until `_cache` is populated.
- Once `cclRows` is fetched and mapped, `_cache` is set to the full list (with lat=0, lng=0 for all).
- `bulkUpsertFacilities` is called in chunks — DB rows are written with `lat=null, lng=null`.
- After all chunks are written, `_seeding = false`.
- `isDatabaseSeeded()` now returns `true`.

### Step 5: geocodeMissingCoords() (background, fire-and-forget)
- Starts after `seedFromCCL` completes the upsert loop.
- Processes 50 facilities per batch, 1.1 second delay between Nominatim requests.
- Writes `updateFacilityCoords` for each facility.
- Exits when no more `lat IS NULL AND geocode_quality != 'geocode_failed'` rows exist.

### isDatabaseSeeded() contract
- Defined in `server/services/facilitiesService.ts:78–84`.
- Returns `true` iff `SELECT COUNT(*) FROM facilities > 0`.
- Returns `false` if the DB throws any error (catches all exceptions).
- **All three facility route handlers** check this flag and branch:
  - `true` → `queryFacilitiesAll` / `searchFacilitiesAutocomplete` / `getFacilitiesMeta` (SQLite path)
  - `false` → `getCachedFacilities()` (in-memory path)
- There is **no automatic fallback** within routes if geocoding has not finished — the DB path is taken as soon as any facility row exists, even if all rows have `lat=NULL`.

### State the DB can be in when the first HTTP request arrives

| DB state | isDatabaseSeeded() | Route behaviour | Map result |
|----------|--------------------|-----------------|------------|
| Empty (0 rows) | false | getCachedFacilities() — returns [] until fetch completes | Empty map |
| Seeded, no geocoding | true | queryFacilitiesAll() — returns rows with lat=null | Client gets lat:null — map crash risk (fitBounds TypeError) |
| Partially geocoded | true | queryFacilitiesAll() — returns mix of lat=null and lat=float | Same crash risk from null rows |
| Fully geocoded | true | queryFacilitiesAll() — all rows have lat/lng | Map renders correctly |

---

## 4. Risk Scenarios

### Scenario A: Empty DB (first boot)
**What breaks:** `isDatabaseSeeded() = false`. Routes return `getCachedFacilities()` which triggers a fresh CCL fetch. During the fetch, `_seeding = false` and `_cache = null`, so `buildFacilityList()` is called. This does a full CHHS API fetch (potentially 30+ seconds). The first HTTP request blocks on this fetch. All subsequent requests within the same process share the cache once it is populated. The in-memory facilities have `lat=0, lng=0`. The route at line 296 filters out `f.lat !== 0` — so the map is empty until geocoding has written coordinates to the DB.

**How to prevent:** No action needed at this layer — the existing filter at line 296 prevents lat=0 points from reaching the client. The map correctly shows zero facilities until geocoding produces valid coordinates.

**Residual risk:** When the DB transitions from 0 rows to >0 rows mid-request, two concurrent requests could both enter `getCachedFacilities` simultaneously and trigger two parallel CCL fetches. The `_seeding` flag guards `seedFromCCL` against duplicate runs but not `buildFacilityList` (used by `getCachedFacilities` when not seeding).

### Scenario B: Partially geocoded DB (geocoder running in background)
**What breaks:** `isDatabaseSeeded() = true`. `queryFacilitiesAll()` returns all rows including those with `lat = NULL`. The route at `server/routes.ts:287–288` uses `r.lat!` — the non-null assertion does not filter out NULL rows. The JSON response contains `"lat": null` for ungeocoded facilities.

On the client:
- `buildGeoJSON` at `MapView.tsx:486` puts `[null, null]` into GeoJSON coordinates.
- `fitBounds` loop at line 397 calls `bounds.extend([null, null])` — throws TypeError, breaking the entire bounds-fit update for that render cycle.
- `haversineDistanceMiles` at line 500 receives null values — coerces to 0, produces wrong `isNearby` flag.
- `map.easeTo` with a selected facility that has `lat: null` sends `center: [null, null]` to MapLibre.

**How to prevent:** The route MUST filter out rows where `lat IS NULL` before building the JSON response. Alternatively, the route should only include facilities where `lat IS NOT NULL` in the SQL query. The `facilitySchema` Zod definition (`z.number()` for lat/lng) should be changed to `z.number().nullable()` or the route must guarantee non-null values.

### Scenario C: Fully geocoded DB
**What breaks:** Nothing — this is the happy path. All rows have valid float coordinates or `geocode_quality = 'geocode_failed'` with `lat = NULL`. The `geocode_failed` rows will still be returned by `queryFacilitiesAll` with `lat: null`, causing the same client-side risks as Scenario B.

**How to prevent:** Routes must filter out `lat IS NULL` rows regardless of geocode_quality, unless the client is explicitly prepared to handle null coordinates.

### Scenario D: Geocoder crashes
**What breaks:** `geocodeMissingCoords` throws. The `.catch()` at line 211–212 logs the error and swallows it. No retry occurs. All facilities processed up to the crash point have their coordinates. Facilities after the crash point remain with `lat = NULL, geocode_quality = ''`. They will be included in `queryFacilitiesAll` results with null coordinates, causing the client-side risks described in Scenario B.

**How to prevent:** Add a null/zero coordinate filter to the `/api/facilities` route response so null-lat rows are never sent to the client. The geocoder can be re-triggered on next restart since `geocode_quality` is still `''` (not `'geocode_failed'`).

**Additional risk:** A crash mid-batch leaves exactly 0–50 facilities in an ambiguous state (they were selected from the DB but not yet updated). On next server restart, `geocodeMissingCoords` will be called again and will retry those facilities.

### Scenario E: External API down (Census Bureau / Nominatim unreachable)
**What breaks:** `nominatimLookup` returns `null` for every call (the `try/catch` at line 235 catches network errors). Both Nominatim attempts return `null`. The geocoder calls `updateFacilityCoords(number, null, null, "geocode_failed")`. The facility is permanently marked as failed — it will never be geocoded even when the API comes back online.

**How to prevent:** Distinguish between a transient network failure and a genuine "no geocoding result". Transient failures (e.g. HTTP 5xx, network timeout) should NOT write `geocode_failed`. Only a clean "no results" response from the geocoder should write `geocode_failed`. The current implementation writes `geocode_failed` whenever both lookups return `null` regardless of the reason.

### Scenario F: New geocode_quality strings
**What breaks:** New strings like `"census_exact"`, `"census_non_exact"`, `"opencage"` added by the new geocoder implementation.

- `geocodeMissingCoords` query: `geocode_quality != 'geocode_failed'` — new strings do NOT match `'geocode_failed'`, so rows with new quality strings and `lat IS NULL` would be re-geocoded by the background loop. However if `lat IS NOT NULL` (the normal case after successful geocoding), these rows are not selected. This is safe.
- Route JSON projection: new strings are forwarded to the client as-is. Safe — no client code branches on geocodeQuality values.
- `bulkUpsertFacilities` ON CONFLICT: overwrites `geocode_quality` unconditionally. A re-seed would reset `"census_exact"` back to `""`. This is a data integrity risk.

**How to prevent:** The `bulkUpsertFacilities` ON CONFLICT clause must preserve `lat`, `lng`, and `geocode_quality` when the incoming value is NULL/empty and the existing value is non-empty (geocoded). The current implementation at `storage.ts:763–766` already does this pattern for `last_inspection_date` but not for `lat`/`lng`/`geocode_quality`.

---

## 5. Acceptance Criteria

The following behaviors MUST remain true after implementation. Each criterion references the scenario it covers.

### Geocoder correctness

1. [Scenario A, B, C] After `seedFromCCL` completes and before `geocodeMissingCoords` finishes, `GET /api/facilities` MUST NOT return any facility with `lat: null` or `lng: null`. Rows where `lat IS NULL` in the DB must be excluded from the response entirely, not passed through with a non-null assertion.

2. [Scenario C] `geocode_failed` rows (lat=NULL, geocode_quality='geocode_failed') MUST NOT appear in `GET /api/facilities` responses. They are unfindable by address and should be hidden from the map.

3. [Scenario B, D] `queryFacilitiesAll` in `server/storage.ts` or the route that calls it MUST add an implicit `WHERE lat IS NOT NULL AND lng IS NOT NULL` condition when serving the map endpoint, OR the route mapping code must filter the result array before building the JSON response.

4. [Scenario D, E] `nominatimLookup` returning `null` due to a network error (HTTP 5xx, connection refused, timeout) MUST be distinguished from a "no results" response. Only a "no results" HTTP 200 response with an empty array body should write `geocode_quality = 'geocode_failed'`. Network errors must leave `geocode_quality` unchanged so the row remains eligible for retry.

5. [Scenario F] When `bulkUpsertFacilities` is called with a row where `lat = null` and the existing DB row has a non-null `lat`, the existing `lat`, `lng`, and `geocode_quality` values MUST be preserved. The ON CONFLICT DO UPDATE clause must use `lat = CASE WHEN excluded.lat IS NOT NULL THEN excluded.lat ELSE lat END` (and similarly for `lng` and `geocode_quality`) to protect geocoded values from being overwritten by a re-seed.

6. [Scenario F] New geocode_quality strings introduced by a new geocoder (`"census_exact"`, `"census_non_exact"`, `"opencage"`) MUST NOT cause the Nominatim background loop to re-geocode already-geocoded rows. The `geocodeMissingCoords` WHERE clause `lat IS NULL AND geocode_quality != 'geocode_failed'` already satisfies this as long as criterion 5 is met (lat is never reset to NULL for geocoded rows).

### Client safety

7. [Scenario B, C] `buildGeoJSON` in `MapView.tsx` MUST NOT be called with any facility where `f.lat` or `f.lng` is `null`. The upstream response guarantee from criterion 1 makes this safe, but the client SHOULD also defensively filter: `facilities.filter(f => f.lat != null && f.lng != null)` before passing to MapView.

8. [Scenario B, C] The `fitBounds` loop in `MapView.tsx` (lines 397–399) MUST NOT call `bounds.extend` with null or zero coordinates. If the API ever returns a facility with `lat: 0`, the bounds calculation must skip it.

9. [Scenario A, B] The in-memory fallback path in `GET /api/facilities` (routes.ts line 296) already filters `f.lat !== 0 && f.lng !== 0`. This filter MUST be preserved as-is when any changes are made to that code branch.

### Schema

10. [All scenarios] The Zod `facilitySchema` in `shared/schema.ts` defines `lat: z.number()` (not nullable). If the API can legitimately return `lat: null` during a transitional state, either (a) the schema must be updated to `z.number().nullable()` and all client consumers updated accordingly, OR (b) the API must guarantee non-null (criterion 1 above). Both constraints cannot be violated simultaneously.

11. [Scenario F] `geocode_quality` in `shared/schema.ts` is `geocodeQuality: z.string()`. New quality strings from new geocoders are valid `string` values and satisfy this schema. No schema change is needed for new geocode_quality values.

### Rate limiting and external API

12. [Scenario E] The geocoder loop MUST maintain at least 1,100 ms between requests to any single geocoder service. If multiple geocoders are chained (Census → Nominatim → OpenCage), each individual service must respect its own 1,100 ms minimum. Do not reduce the `GEOCODE_DELAY` constant.

13. [Scenario E] If `OPENCAGE_API_KEY` is absent from the environment, the OpenCage geocoder step MUST be silently skipped. The system must be fully operational without this variable.

### Startup and seeding

14. [Scenario A] On first boot (empty DB), `isDatabaseSeeded()` returns `false` until the first `bulkUpsertFacilities` transaction commits. During this window, all facility requests MUST be served from `getCachedFacilities()` and must return a non-error response (empty array is acceptable).

15. [Scenario A] `autoSeedIfEmpty` uses `setImmediate` to defer seeding — this behavior MUST be preserved. The HTTP server must be able to serve health-check requests (`GET /api/health`) before seeding completes.

16. [Scenario D] If `geocodeMissingCoords` exits due to an uncaught exception, the server MUST NOT crash. The `.catch()` handler at `facilitiesService.ts:212` MUST be preserved. The geocoder will be retried on the next server restart.

### Data integrity under re-seed

17. [Scenario F] Running `npm run data:seed` on a production DB that already has geocoded rows MUST NOT reset those rows' `lat`, `lng`, or `geocode_quality` to NULL or `""`. Criterion 5 (ON CONFLICT preservation) enforces this.

18. [Scenario F] Running `autoSeedIfEmpty` on a DB that is already seeded (`isDatabaseSeeded() = true`) MUST be a no-op. The guard at `facilitiesService.ts:51` (`if (isDatabaseSeeded() || _seeding) return`) enforces this.
