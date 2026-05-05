# Facilities Data Audit

_Generated: 2026-05-05T00:32:50.999Z_

## 1. Row counts

- Total facilities: **68,526**


## 2. facility_type distribution

Distinct values: **33**

| facility_type | n |
| --- | --- |
| Family Child Care Home | 19758 |
| Residential Care Facility for the Elderly | 12389 |
| Child Care Center | 12295 |
| Adult Residential Facility | 8329 |
| Home Care Organization | 3654 |
| Infant Center | 3024 |
| School-Age Day Care Center | 2729 |
| Single-Licensed Child Care Center | 1371 |
| Adult Day Program | 1343 |
| Short-Term Residential Therapeutic Program | 594 |
| Group Home | 565 |
| Social Rehabilitation Facility | 527 |
| Small Family Home | 458 |
| Foster Family Agency | 295 |
| Foster Family Agency Sub-Office | 250 |
| Transitional Housing Placement Program | 202 |
| Adoption Agency | 164 |
| RCFE — Continuing Care Retirement Community | 132 |
| Enhanced Behavioral Supports Home (ARF) | 127 |
| Adult Residential Facility for Persons with Special Health Care Needs | 117 |
| Temporary Shelter Care Facility | 41 |
| Community Crisis Home (ARF) | 38 |
| Enhanced Behavioral Supports Home (GH) | 27 |
| Youth Homelessness Prevention Center (GH) | 22 |
| Transitional Shelter Care Facility | 19 |
| Residential Care Facility for the Chronically Ill | 17 |
| Community Crisis Home (DDS / Children's) | 14 |
| Day Care Center for Mildly Ill Children | 7 |
| Group Home — Children with Special Health Care Needs | 6 |
| Crisis Nursery | 6 |
| STRTP — Children's Crisis Residential | 3 |
| Community Treatment Facility | 2 |
| _empty_ | 1 |


### 2a. Spelling/casing variants of the same type

_(none — all distinct values look canonical)_


### 2b. Empty/null facility_type

- 1 rows (0.0%)


## 3. facility_group distribution

| facility_group | n |
| --- | --- |
| Child Care | 39184 |
| Adult & Senior Care | 23019 |
| Home Care | 3654 |
| Children's Residential | 2668 |
| Unknown | 1 |


## 4. type → group consistency

Types whose rows fall into more than one group:

_(none — every type maps to one group)_


### 4a. facility_type values not recognized by the canonical taxonomy

Stored `facility_type` strings that cannot be resolved against `shared/taxonomy.ts` (matched against either `ccldRawNames` or `officialLabel`). These are real coverage gaps — the taxonomy is missing an entry, or the row was written with a non-canonical label.

_(none — every stored facility_type resolves to a taxonomy entry)_


### 4b. Stored facility_group disagrees with taxonomy domain

Rows whose stored `facility_group` does not match the `domain` of the taxonomy entry resolved from `facility_type`. This is real drift — the row was written with a stale group label.

_(none — every stored group matches the taxonomy domain)_


## 5. status distribution

| status | n |
| --- | --- |
| LICENSED | 47440 |
| CLOSED | 17896 |
| PENDING | 2284 |
| INACTIVE | 816 |
| ON PROBATION | 90 |


## 6. county distribution (top 30 of 60)

| county | n |
| --- | --- |
| LOS ANGELES | 15656 |
| SAN DIEGO | 5930 |
| ORANGE | 5187 |
| RIVERSIDE | 4018 |
| SACRAMENTO | 3816 |
| SANTA CLARA | 3453 |
| ALAMEDA | 3008 |
| SAN BERNARDINO | 2908 |
| CONTRA COSTA | 2624 |
| FRESNO | 1679 |
| SAN MATEO | 1644 |
| SAN JOAQUIN | 1498 |
| VENTURA | 1452 |
| KERN | 1419 |
| SAN FRANCISCO | 1139 |
| SOLANO | 1036 |
| PLACER | 1027 |
| SANTA BARBARA | 999 |
| SONOMA | 988 |
| TULARE | 903 |
| STANISLAUS | 886 |
| MONTEREY | 643 |
| SAN LUIS OBISPO | 616 |
| MARIN | 594 |
| SANTA CRUZ | 509 |
| SHASTA | 443 |
| BUTTE | 417 |
| MERCED | 404 |
| YOLO | 385 |
| IMPERIAL | 335 |


### 6a. County spelling variants

_(none)_


## 7. capacity distribution

| bucket | n |
| --- | --- |
| NULL | 0 |
| 0 (likely unknown) | 3949 |
| 1–6 | 20194 |
| 7–15 | 22443 |
| 16–49 | 11890 |
| 50–99 | 6506 |
| 100+ | 3544 |


## 8. geocode_quality distribution

| geocode_quality | n |
| --- | --- |
| chhs_geo | 26866 |
| _empty_ | 21717 |
| census_batch | 19102 |
| nominatim_fallback | 509 |
| nominatim_no_match | 332 |

- Rows with NULL lat or lng: **22049** (32.2%)


## 9. phone formatting

| bucket | n |
| --- | --- |
| empty | 1960 |
| canonical (XXX) XXX-XXXX | 66565 |
| non-canonical | 1 |


### 9a. Sample non-canonical phone formats

| phone | n |
| --- | --- |
| 11589 CEDAR WAY | 1 |


## 10. enrichment / compliance field completeness

| field | populated | pct |
| --- | --- | --- |
| last_inspection_date | 25 | 0.0% |
| total_visits > 0 | 0 | 0.0% |
| citations > 0 | 0 | 0.0% |
| total_type_b > 0 | 0 | 0.0% |
| administrator | 68525 | 100.0% |
| licensee | 68526 | 100.0% |
| enriched_at | 25 | 0.0% |


## 11. Taxonomy coverage

Stored `facility_type` values absent from `TAXONOMY` in `shared/taxonomy.ts` (32 taxonomy entries). Matching is case-insensitive against both `ccldRawNames` and `officialLabel`.

_(none — every stored facility_type matches a taxonomy entry)_


## 12. Recommended findings (auto-summary)

- **1** rows have empty facility_type.
- **3949** rows have capacity=0 (cannot distinguish "unknown" from "actually zero").
- **1** phone numbers do not match canonical format.
- last_inspection_date populated on only 0.0% of rows — enrichment is incomplete.
- **22049** rows have no geocoded coordinates.
