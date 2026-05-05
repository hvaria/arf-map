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

  CREATE TABLE IF NOT EXISTS applicant_interests (
    id              SERIAL PRIMARY KEY,
    job_seeker_id   INTEGER NOT NULL,
    facility_number TEXT NOT NULL,
    role_interest   TEXT,
    message         TEXT,
    status          TEXT NOT NULL DEFAULT 'pending',
    created_at      BIGINT NOT NULL,
    updated_at      BIGINT NOT NULL,
    CONSTRAINT applicant_interests_job_seeker_id_facility_number_unique
      UNIQUE (job_seeker_id, facility_number)
  );
  CREATE INDEX IF NOT EXISTS idx_interests_job_seeker ON applicant_interests(job_seeker_id);
  CREATE INDEX IF NOT EXISTS idx_interests_facility   ON applicant_interests(facility_number);

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
`;

export async function bootstrapMainSchema(): Promise<void> {
  await pool.query(MAIN_PG_SCHEMA_SQL);
  console.log("[db] main PostgreSQL tables bootstrapped");
}
