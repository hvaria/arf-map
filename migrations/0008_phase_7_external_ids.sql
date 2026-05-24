-- ─────────────────────────────────────────────────────────────────────────────
-- Phase 7 — External IDs (nanoid) for URL-exposed tables
--
-- Stop leaking sequential BIGSERIAL ids in URLs (enumeration / business-volume
-- leak). Add a non-null UNIQUE `external_id` to the two URL-exposed tables;
-- URLs flip to use it. Internal FK relationships keep using the integer PK
-- (zero migration cost on relationships).
--
-- Backfill strategy: existing rows get a one-time Postgres-side hash (hex
-- substring of md5) — collision-safe at our cardinalities and avoids needing
-- the nanoid alphabet in SQL. New rows inserted by the app code use real
-- `nanoid(12)` (URL-safe, ~71 bits of entropy).
--
-- Deferred tables (intentionally not converted this round): ops_residents and
-- every other `/api/ops/*` resource — adding external_id there is a large
-- refactor (50+ URLs) and the surface area is already gated by facility auth
-- + RBAC + composite-FK tenant isolation. Lower enumeration risk; defer to a
-- later phase. ops_share_links.token is already a random opaque string and
-- does NOT need external_id.
-- ─────────────────────────────────────────────────────────────────────────────

-- job_postings — URL-exposed at:
--   GET    /api/jobs/:externalId
--   PUT    /api/facility/jobs/:externalId
--   DELETE /api/facility/jobs/:externalId
--   POST   /api/facility/jobs            (returns externalId, not id)
ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS external_id TEXT;

UPDATE job_postings
   SET external_id = substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 12)
 WHERE external_id IS NULL;

ALTER TABLE job_postings ALTER COLUMN external_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_job_postings_external_id
  ON job_postings(external_id);


-- applicant_interests — URL-exposed at:
--   DELETE /api/jobseeker/interests/:externalId
--   PATCH  /api/facility/applicants/:externalId
ALTER TABLE applicant_interests ADD COLUMN IF NOT EXISTS external_id TEXT;

UPDATE applicant_interests
   SET external_id = substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 12)
 WHERE external_id IS NULL;

ALTER TABLE applicant_interests ALTER COLUMN external_id SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uniq_applicant_interests_external_id
  ON applicant_interests(external_id);
