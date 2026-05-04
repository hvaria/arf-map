# Facilities Data Audit

_Generated: 2026-05-04T20:56:31.737Z_

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


### 4a. Stored group vs. recomputed typeToGroup()

| facility_type | stored_group | recomputed_group | n |
| --- | --- | --- | --- |
| Infant Center | Child Care | Adult & Senior Care | 3024 |
| School-Age Day Care Center | Child Care | Adult & Senior Care | 2729 |
| Small Family Home | Children's Residential | Adult & Senior Care | 458 |
| Transitional Housing Placement Program | Children's Residential | Adult & Senior Care | 202 |
| Adoption Agency | Children's Residential | Adult & Senior Care | 164 |
| Temporary Shelter Care Facility | Children's Residential | Adult & Senior Care | 41 |
| Enhanced Behavioral Supports Home (GH) | Children's Residential | Adult & Senior Care | 27 |
| Youth Homelessness Prevention Center (GH) | Children's Residential | Adult & Senior Care | 22 |
| Transitional Shelter Care Facility | Children's Residential | Adult & Senior Care | 19 |
| Community Crisis Home (DDS / Children's) | Children's Residential | Adult & Senior Care | 14 |
| Day Care Center for Mildly Ill Children | Child Care | Adult & Senior Care | 7 |
| Crisis Nursery | Children's Residential | Adult & Senior Care | 6 |
| _empty_ | Unknown | Adult & Senior Care | 1 |


### 4b. Types that fell through typeToGroup() default

These types matched no explicit branch and were classified as "Adult & Senior Care".

| facility_type | recomputed_group | n |
| --- | --- | --- |
| Infant Center | Adult & Senior Care | 3024 |
| School-Age Day Care Center | Adult & Senior Care | 2729 |
| Small Family Home | Adult & Senior Care | 458 |
| Transitional Housing Placement Program | Adult & Senior Care | 202 |
| Adoption Agency | Adult & Senior Care | 164 |
| RCFE — Continuing Care Retirement Community | Adult & Senior Care | 132 |
| Enhanced Behavioral Supports Home (ARF) | Adult & Senior Care | 127 |
| Temporary Shelter Care Facility | Adult & Senior Care | 41 |
| Community Crisis Home (ARF) | Adult & Senior Care | 38 |
| Enhanced Behavioral Supports Home (GH) | Adult & Senior Care | 27 |
| Youth Homelessness Prevention Center (GH) | Adult & Senior Care | 22 |
| Transitional Shelter Care Facility | Adult & Senior Care | 19 |
| Residential Care Facility for the Chronically Ill | Adult & Senior Care | 17 |
| Community Crisis Home (DDS / Children's) | Adult & Senior Care | 14 |
| Day Care Center for Mildly Ill Children | Adult & Senior Care | 7 |
| Crisis Nursery | Adult & Senior Care | 6 |
| _empty_ | Adult & Senior Care | 1 |


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
| _empty_ | 41660 |
| chhs_geo | 26866 |

- Rows with NULL lat or lng: **41660** (60.8%)


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
| last_inspection_date | 0 | 0.0% |
| total_visits > 0 | 0 | 0.0% |
| citations > 0 | 0 | 0.0% |
| total_type_b > 0 | 0 | 0.0% |
| administrator | 68525 | 100.0% |
| licensee | 68526 | 100.0% |
| enriched_at | 0 | 0.0% |


## 11. TYPE_TO_NAME coverage

Types in DB that are NOT in the `TYPE_TO_NAME` lookup (16 known codes):

| facility_type | n |
| --- | --- |
| Family Child Care Home | 19758 |
| Infant Center | 3024 |
| School-Age Day Care Center | 2729 |
| Single-Licensed Child Care Center | 1371 |
| Small Family Home | 458 |
| Foster Family Agency Sub-Office | 250 |
| Transitional Housing Placement Program | 202 |
| Adoption Agency | 164 |
| RCFE — Continuing Care Retirement Community | 132 |
| Enhanced Behavioral Supports Home (ARF) | 127 |
| Temporary Shelter Care Facility | 41 |
| Community Crisis Home (ARF) | 38 |
| Enhanced Behavioral Supports Home (GH) | 27 |
| Youth Homelessness Prevention Center (GH) | 22 |
| Transitional Shelter Care Facility | 19 |
| Community Crisis Home (DDS / Children's) | 14 |
| Day Care Center for Mildly Ill Children | 7 |
| Group Home — Children with Special Health Care Needs | 6 |
| Crisis Nursery | 6 |
| STRTP — Children's Crisis Residential | 3 |


## 12. Recommended findings (auto-summary)

- **1** rows have empty facility_type — currently masked by the default fallback.
- **13** types where stored group disagrees with the `typeToGroup()` function.
- **17** types fell through `typeToGroup()` default and may be misclassified as Adult & Senior Care.
- **3949** rows have capacity=0 (cannot distinguish "unknown" from "actually zero").
- **1** phone numbers do not match canonical format.
- **20** distinct facility types are absent from the `TYPE_TO_NAME` lookup.
- last_inspection_date populated on only 0.0% of rows — enrichment is incomplete.
- **41660** rows have no geocoded coordinates.
