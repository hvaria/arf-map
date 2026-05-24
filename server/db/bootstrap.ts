import { pool } from "./index";

const MAIN_PG_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS users (
    id       SERIAL PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS job_seeker_accounts (
    id                   SERIAL PRIMARY KEY,
    username             TEXT NOT NULL UNIQUE,
    email                TEXT NOT NULL UNIQUE,
    password             TEXT NOT NULL,
    email_verified       INTEGER NOT NULL DEFAULT 0,
    verification_token   TEXT,
    verification_expiry  BIGINT,
    created_at           BIGINT NOT NULL,
    last_login_at        BIGINT,
    failed_login_count   INTEGER NOT NULL DEFAULT 0,
    updated_at           BIGINT
  );

  CREATE TABLE IF NOT EXISTS job_seeker_profiles (
    id                   SERIAL PRIMARY KEY,
    account_id           INTEGER NOT NULL UNIQUE,
    name                 TEXT,
    first_name           TEXT,
    last_name            TEXT,
    phone                TEXT,
    address              TEXT,
    city                 TEXT,
    state                TEXT,
    zip_code             TEXT,
    profile_picture_url  TEXT,
    years_experience     INTEGER,
    job_types            TEXT,
    bio                  TEXT,
    updated_at           BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS facility_accounts (
    id                   SERIAL PRIMARY KEY,
    facility_number      TEXT NOT NULL UNIQUE,
    username             TEXT NOT NULL UNIQUE,
    password             TEXT NOT NULL,
    role                 TEXT NOT NULL DEFAULT 'facility_admin',
    email                TEXT,
    email_verified       INTEGER NOT NULL DEFAULT 0,
    verification_token   TEXT,
    verification_expiry  BIGINT,
    created_at           BIGINT NOT NULL,
    failed_login_count   INTEGER NOT NULL DEFAULT 0
  );
  -- Idempotent backfill for deployments where the table predates this column.
  ALTER TABLE facility_accounts
    ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'facility_admin';

  CREATE TABLE IF NOT EXISTS facility_overrides (
    id              SERIAL PRIMARY KEY,
    facility_number TEXT NOT NULL UNIQUE,
    phone           TEXT,
    description     TEXT,
    website         TEXT,
    email           TEXT,
    updated_at      BIGINT NOT NULL
  );
  -- ── facility_overrides: additive columns for public listing + report letterhead.
  -- All nullable, no defaults — Postgres 11+ ADD COLUMN with no default is a
  -- metadata-only change (instant, safe on populated production tables).
  -- NOTE: logo_* columns are for the customer FACILITY's own logo (each ARF
  -- uploads its own; used on their public listing and PDF reports). They are
  -- NOT the app brand identity (client/src/components/BrandLogo.tsx).
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS dba_name TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS logo_storage_uri TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS logo_mime_type TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS logo_updated_at BIGINT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS mailing_address_line1 TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS mailing_address_line2 TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS mailing_city TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS mailing_state TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS mailing_zip TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS hours_of_operation_json TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS languages_spoken_json TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS care_types_offered_json TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS administrator_name TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS administrator_phone TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS administrator_email TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS administrator_license_number TEXT;
  -- tax_id_last4: LAST 4 digits of EIN only. Full EIN is NEVER stored here.
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS tax_id_last4 TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS year_established INTEGER;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS accreditations_json TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS facebook_url TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS instagram_url TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS report_header_text TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS report_footer_text TEXT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS prefilled_from_ccld_at BIGINT;
  ALTER TABLE facility_overrides ADD COLUMN IF NOT EXISTS prefilled_fields TEXT;

  CREATE TABLE IF NOT EXISTS job_postings (
    id              SERIAL PRIMARY KEY,
    facility_number TEXT NOT NULL,
    title           TEXT NOT NULL,
    type            TEXT NOT NULL,
    salary          TEXT NOT NULL,
    description     TEXT NOT NULL,
    requirements    TEXT NOT NULL,
    posted_at       BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_job_postings_facility ON job_postings(facility_number);
  -- Phase 7: external_id is the URL-exposed public id (nanoid(12)). Internal
  -- FK relationships still use the integer PK; only URLs flip. Backfill uses
  -- a Postgres-side hash so we don't need nanoid in the DB; new rows are
  -- generated by app code via nanoid(12).
  ALTER TABLE job_postings ADD COLUMN IF NOT EXISTS external_id TEXT;
  UPDATE job_postings
     SET external_id = substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 12)
   WHERE external_id IS NULL;
  ALTER TABLE job_postings ALTER COLUMN external_id SET NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_job_postings_external_id
    ON job_postings(external_id);

  CREATE TABLE IF NOT EXISTS facilities (
    number                TEXT PRIMARY KEY,
    name                  TEXT NOT NULL,
    facility_type         TEXT NOT NULL DEFAULT '',
    facility_group        TEXT NOT NULL DEFAULT '',
    status                TEXT NOT NULL,
    address               TEXT NOT NULL DEFAULT '',
    city                  TEXT NOT NULL DEFAULT '',
    county                TEXT NOT NULL DEFAULT '',
    zip                   TEXT NOT NULL DEFAULT '',
    phone                 TEXT NOT NULL DEFAULT '',
    licensee              TEXT NOT NULL DEFAULT '',
    administrator         TEXT NOT NULL DEFAULT '',
    capacity              INTEGER DEFAULT 0,
    first_license_date    TEXT DEFAULT '',
    closed_date           TEXT DEFAULT '',
    last_inspection_date  TEXT DEFAULT '',
    total_visits          INTEGER DEFAULT 0,
    total_type_b          INTEGER DEFAULT 0,
    citations             INTEGER DEFAULT 0,
    lat                   DOUBLE PRECISION,
    lng                   DOUBLE PRECISION,
    geocode_quality       TEXT DEFAULT '',
    updated_at            BIGINT NOT NULL,
    enriched_at           BIGINT
  );
  CREATE INDEX IF NOT EXISTS idx_facilities_status ON facilities(status);
  CREATE INDEX IF NOT EXISTS idx_facilities_county ON facilities(county);
  CREATE INDEX IF NOT EXISTS idx_facilities_facility_type ON facilities(facility_type);
  CREATE INDEX IF NOT EXISTS idx_facilities_coords ON facilities(lat, lng) WHERE lat IS NOT NULL AND lng IS NOT NULL;

  CREATE TABLE IF NOT EXISTS applicant_interests (
    id              SERIAL PRIMARY KEY,
    job_seeker_id   INTEGER NOT NULL,
    facility_number TEXT NOT NULL,
    job_id          INTEGER,
    role_interest   TEXT,
    message         TEXT,
    status          TEXT NOT NULL DEFAULT 'pending'
,
    created_at      BIGINT NOT NULL,
    updated_at      BIGINT NOT NULL
  );
  -- Backfill: existing deployments may have the table without job_id; add it.
  ALTER TABLE applicant_interests ADD COLUMN IF NOT EXISTS job_id INTEGER;
  -- Drop the legacy single uniqueness constraint (jobSeekerId, facilityNumber)
  -- if it's still around — it would block per-job rows from coexisting with a
  -- facility-level row. The two partial indexes below enforce uniqueness now.
  ALTER TABLE applicant_interests
    DROP CONSTRAINT IF EXISTS applicant_interests_job_seeker_id_facility_number_unique;
  CREATE INDEX IF NOT EXISTS idx_interests_job_seeker ON applicant_interests(job_seeker_id);
  CREATE INDEX IF NOT EXISTS idx_interests_facility   ON applicant_interests(facility_number);
  -- Per-job uniqueness: at most one row per (seeker, job).
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_interests_seeker_job
    ON applicant_interests(job_seeker_id, job_id) WHERE job_id IS NOT NULL;
  -- Facility-level uniqueness: at most one "general interest at this facility"
  -- row per seeker. Per-job rows (job_id IS NOT NULL) are not constrained here.
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_interests_seeker_fac_general
    ON applicant_interests(job_seeker_id, facility_number) WHERE job_id IS NULL;
  -- Phase 7: external_id is the URL-exposed public id (nanoid(12)). Same
  -- pattern as job_postings — internal FK uses integer PK, URLs use this.
  ALTER TABLE applicant_interests ADD COLUMN IF NOT EXISTS external_id TEXT;
  UPDATE applicant_interests
     SET external_id = substr(md5(random()::text || id::text || clock_timestamp()::text), 1, 12)
   WHERE external_id IS NULL;
  ALTER TABLE applicant_interests ALTER COLUMN external_id SET NOT NULL;
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_applicant_interests_external_id
    ON applicant_interests(external_id);

  -- ── Job seeker credentials ────────────────────────────────────────────────
  -- One row per credential held by a seeker (1:many on job_seeker_accounts.id).
  -- The kind column is constrained at the app layer via credentialKindSchema;
  -- no CHECK constraint here so the enum can evolve without a migration.
  -- issued_at / expires_at are ISO YYYY-MM-DD text values (not bigint) to
  -- avoid timezone drift when rendering expiry tones.
  CREATE TABLE IF NOT EXISTS job_seeker_credentials (
    id                  SERIAL PRIMARY KEY,
    account_id          INTEGER NOT NULL,
    kind                TEXT NOT NULL,
    label               TEXT,
    license_number      TEXT,
    issuing_authority   TEXT,
    issued_at           TEXT,
    expires_at          TEXT,
    notes               TEXT,
    created_at          BIGINT NOT NULL,
    updated_at          BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_credentials_account
    ON job_seeker_credentials(account_id);
  -- Prevent accidental duplicate license numbers per seeker, but still allow
  -- multiple rows for kinds that have no number (e.g. several CPR renewals
  -- with NULL license_number, or multiple "OTHER" entries).
  CREATE UNIQUE INDEX IF NOT EXISTS uniq_credentials_account_kind_license
    ON job_seeker_credentials(account_id, kind, license_number)
    WHERE license_number IS NOT NULL;

  -- ── Job seeker work experience (LinkedIn-style timeline) ─────────────────
  -- One row per work-history entry. Month-precision dates stored as ISO
  -- YYYY-MM text (TZ-safe, sorts lexicographically). NULL end_date means
  -- the seeker is currently employed there.
  CREATE TABLE IF NOT EXISTS job_seeker_work_experience (
    id              SERIAL PRIMARY KEY,
    account_id      INTEGER NOT NULL,
    title           TEXT NOT NULL,
    company         TEXT NOT NULL,
    facility_number TEXT,
    location        TEXT,
    employment_type TEXT,
    start_date      TEXT NOT NULL,
    end_date        TEXT,
    description     TEXT,
    created_at      BIGINT NOT NULL,
    updated_at      BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_work_experience_account
    ON job_seeker_work_experience(account_id);

  CREATE TABLE IF NOT EXISTS enrichment_runs (
    id               SERIAL PRIMARY KEY,
    started_at       BIGINT NOT NULL,
    finished_at      BIGINT,
    trigger          TEXT NOT NULL,
    total_processed  INTEGER NOT NULL DEFAULT 0,
    total_enriched   INTEGER NOT NULL DEFAULT 0,
    total_no_data    INTEGER NOT NULL DEFAULT 0,
    total_failed     INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS login_attempts (
    id              SERIAL PRIMARY KEY,
    email           TEXT NOT NULL,
    ip              TEXT,
    success         BOOLEAN NOT NULL,
    failure_reason  TEXT,
    attempted_at    BIGINT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts(email);

  -- ── Operations paywall (Phase 0): per-account Stripe subscription ──────────
  -- Stripe columns are nullable until Phase 1 wires the SDK + webhook.
  -- One row per facility_accounts.id; the unique index below enforces that.
  CREATE TABLE IF NOT EXISTS facility_subscriptions (
    id                       SERIAL PRIMARY KEY,
    facility_account_id      INTEGER NOT NULL,
    stripe_customer_id       TEXT,
    stripe_subscription_id   TEXT,
    stripe_price_id          TEXT,
    status                   TEXT,
    current_period_start     BIGINT,
    current_period_end       BIGINT,
    cancel_at_period_end     INTEGER NOT NULL DEFAULT 0,
    trial_end                BIGINT,
    latest_invoice_url       TEXT,
    last_four                TEXT,
    card_brand               TEXT,
    created_at               BIGINT NOT NULL,
    updated_at               BIGINT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS facility_subscriptions_account_idx
    ON facility_subscriptions(facility_account_id);
  CREATE INDEX IF NOT EXISTS facility_subscriptions_stripe_sub_idx
    ON facility_subscriptions(stripe_subscription_id);
  -- UNIQUE on stripe_customer_id (allows multiple NULLs by default in
  -- Postgres) so the webhook's customer→account fallback resolution is
  -- guaranteed to be 1:1 — prevents customer-id confusion if duplicate
  -- subscription rows ever get created by hand.
  CREATE UNIQUE INDEX IF NOT EXISTS facility_subscriptions_stripe_customer_idx
    ON facility_subscriptions(stripe_customer_id);

  -- Hot-path cache columns on facility_accounts so the Operations gate
  -- middleware can authorize without joining facility_subscriptions. Kept in
  -- sync by the subscription writer (Phase 1). Idempotent for redeploys.
  ALTER TABLE facility_accounts
    ADD COLUMN IF NOT EXISTS subscription_status TEXT;
  ALTER TABLE facility_accounts
    ADD COLUMN IF NOT EXISTS subscription_current_period_end BIGINT;
`;

// Bootstrap is idempotent, but concurrent vitest forks running ADD
// COLUMN IF NOT EXISTS against the same table can deadlock against each
// other's ACCESS EXCLUSIVE locks. Serialize cross-fork by acquiring a
// Postgres advisory lock and cache the promise within a single fork.
const MAIN_BOOTSTRAP_LOCK_KEY = 0x6d61696e5f626f74; // 'main_bot'
let mainBootstrapPromise: Promise<void> | null = null;

export async function bootstrapMainSchema(): Promise<void> {
  if (!mainBootstrapPromise) {
    mainBootstrapPromise = (async () => {
      const client = await pool.connect();
      try {
        await client.query(`SELECT pg_advisory_lock($1)`, [MAIN_BOOTSTRAP_LOCK_KEY]);
        try {
          await client.query(MAIN_PG_SCHEMA_SQL);
        } finally {
          await client.query(`SELECT pg_advisory_unlock($1)`, [MAIN_BOOTSTRAP_LOCK_KEY]);
        }
        console.log("[db] main PostgreSQL tables bootstrapped");
      } finally {
        client.release();
      }
    })();
  }
  return mainBootstrapPromise;
}
