# Agent 2 — Data Source Analyst Findings

## 1. CHHS CCL API — Field Inventory

**Endpoint:** `https://data.chhs.ca.gov/api/3/action/datastore_search`
**Resource ID:** `9f5d1d00-6b24-4f44-a158-9cbe4b43f117`

### Fields currently mapped by `mapCCLToFacility()`:
| API Field | DB Column | Notes |
|-----------|-----------|-------|
| `facility_number` | `number` | Primary key |
| `facility_name` | `name` | |
| `facility_type` | `type` | Normalized via `typeToGroup()` |
| `facility_status` | `status` | |
| `facility_address` | `address` | |
| `facility_city` | `city` | Stored ALL CAPS |
| `facility_zip` | `zip` | |
| `facility_telephone_number` | `phone` | |
| `facility_administrator` | `administrator` | |
| `facility_capacity` | `capacity` | |
| `license_first_date` | `license_first_date` | |
| `closed_date` | `closed_date` | |
| `county_name` | `county` | |
| `licensee` | `licensee` | |

### Critical gap — no lat/lng fields from CCL API:
The current code makes **no use of any coordinate fields** from the CCL API response. The `lat` and `lng` columns in the DB are populated entirely by Nominatim geocoding. If CHHS returns coordinate fields (e.g. `latitude`, `longitude`, `geom`), they are being ignored.

**Action required for Agent 4:** Before calling any geocoder, check whether the live API response includes coordinate fields and use them as a zero-API-call first pass.

---

## 2. Current Geocoder — Nominatim

**Base URL:** `https://nominatim.openstreetmap.org/search`

### Known limitations:
- Fails to resolve ~30–40% of California business/facility addresses
- Sends city names in ALL CAPS (per Agent 1's finding) — suboptimal for Nominatim which expects title case
- Failed lookups permanently marked `geocode_failed`; no retry path
- No retry logic on network failures — transient errors become permanent failures
- Single-geocoder strategy: no fallback if Nominatim fails

### Query format currently used:
1. `${name} ${address} ${city} CA ${zip}` (with name)
2. `${address} ${city} CA ${zip}` (fallback without name)

### Nominatim best practices (per official docs):
- Use structured parameters: `street=`, `city=`, `state=`, `postalcode=`, `country=` instead of freeform `q=`
- Title-case city names improve match rate
- Rate limit: 1 request/second (enforced) — do not exceed
- `countrycodes=us` already applied — good
- User-Agent must identify the application — currently set correctly

---

## 3. Alternative Geocoder Evaluation

### A. US Census Bureau Geocoder
**URL:** `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress`
- **Accuracy:** Gold standard for US addresses — authoritative federal source
- **Rate limit:** 10,000 requests/day; ~10 req/sec; batch endpoint handles up to 10,000 addresses per request
- **Auth:** None — completely free, no API key
- **Match quality field:** Returns `matchedAddress`, `coordinates`, and `tigerLineId`
- **Match types:** `"Exact"`, `"Non_Exact"`, `"Tie"` (or empty for no match)
- **Strengths:**
  - Free, no rate-limit key needed
  - Authoritative for US street addresses
  - Batch API can geocode thousands at once
  - Returns match quality indicator
- **Weaknesses:**
  - Slower than commercial APIs
  - Batch API requires CSV format
  - Single-address endpoint is simpler but returns less detail
- **Env var needed:** None

### B. OpenCage Geocoder
**URL:** `https://api.opencagedata.com/geocode/v1/json`
- **Accuracy:** Aggregates Nominatim + OSM + Geonames + other sources — higher hit rate than Nominatim alone
- **Rate limit (free):** 2,500 requests/day; 1 req/sec
- **Auth:** API key required
- **Response:** GeoJSON-compatible with `confidence` score (0–10) and `components` breakdown
- **Strengths:**
  - Multi-source fallback improves hit rate
  - Confidence score enables quality filtering
  - Reverse geocoding available
- **Weaknesses:**
  - Free tier limited to 2,500/day — could be exhausted during initial geocoding run
  - Requires API key registration
- **Env var needed:** `OPENCAGE_API_KEY`

### C. Photon (komoot)
**URL:** `https://photon.komoot.io/api`
- **Accuracy:** Similar to Nominatim (same underlying OSM data, different engine)
- **Rate limit:** Undocumented; no official SLA
- **Auth:** None
- **Strengths:** Free, no auth needed, slightly different hit rate vs. Nominatim
- **Weaknesses:** No reliability guarantees; no official rate limit documentation; would not provide meaningfully better coverage than Nominatim for CA addresses
- **Verdict:** Not recommended for production

### D. US Census Bureau — Single Address API
**URL:** `https://geocoding.geo.census.gov/geocoder/locations/address?street=&city=&state=&zip=&benchmark=Public_AR_Current&format=json`
- Structured parameters — ideal for our data
- Returns `coordinates.x` (lng) and `coordinates.y` (lat)
- Match indicator: `addressComponents.matchIndicator`
- **This is the strongest free option for US addresses**

---

## 4. Recommended Geocoding Strategy

### Primary: US Census Bureau Geocoder (structured single-address endpoint)
- Free, authoritative, no API key
- Use structured params: `street`, `city`, `state=CA`, `zip`
- Normalize city from ALL CAPS to Title Case before query (fixes current bug)
- Mark successful geocodes: `geocode_quality = "census_exact"` or `"census_non_exact"`
- Rate limit: 1 request/second with 100ms headroom (no key throttle, but be polite)

### Fallback: Nominatim (existing implementation)
- Only called when Census Bureau returns no match
- Already implemented and working
- Mark: `geocode_quality = "nominatim"`

### Optional second fallback: OpenCage
- Only if Census + Nominatim both fail AND `OPENCAGE_API_KEY` env var is set
- Mark: `geocode_quality = "opencage"`
- Skip if env var not present — keeps the system functional without requiring a key

### Zero-API first pass: CHHS API coordinates (if present)
- Before invoking any geocoder, check whether the CCL API row includes lat/lng fields
- If present and within California bounding box, use them directly
- Mark: `geocode_quality = "api"`
- Saves geocoding calls for up to N% of facilities

---

## 5. Rate Limiting Configuration

| Geocoder | Delay between calls | Daily limit | Auth |
|----------|--------------------|-----------:|------|
| Census Bureau | 1,100ms | 10,000 | None |
| Nominatim | 1,100ms | ~86,000 | None |
| OpenCage | 1,100ms | 2,500 | `OPENCAGE_API_KEY` |

Using a uniform 1,100ms delay (matching current `GEOCODE_DELAY`) is safe for all three.

---

## 6. Environment Variables

```bash
# OpenCage (optional second fallback — system works without this)
OPENCAGE_API_KEY=your_key_here

# No key needed for Census Bureau or Nominatim
```

---

## 7. City Casing Fix — Required for All Geocoders

Agent 1 confirmed cities are stored ALL CAPS. All geocoder queries must normalize to Title Case first:
```typescript
const titleCity = city.split(" ").map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(" ");
```
This applies to Census Bureau, OpenCage, and Nominatim queries.
