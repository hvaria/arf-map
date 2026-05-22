-- ============================================================================
-- Phase 2 (Round 2 — Agent B) — JSONB conversion + Stripe webhook idempotency
-- ============================================================================
-- Two coupled changes, bundled into one migration because both are small
-- additive DDL and ship together:
--
--   1. Convert ~13 TEXT columns that currently hold a JSON-shaped string to
--      JSONB. These columns were created when Drizzle's text() was the
--      lowest-common-denominator pick for "store anything"; with the schema
--      now stabilised on Postgres, JSONB is a strict improvement:
--        - Postgres validates the shape on write (a bad blob no longer
--          silently corrupts the row).
--        - Future GIN indexes can target specific JSON keys
--          (e.g. an index on care_types_offered to speed `?| array['memory_care']`).
--        - JSON_TABLE / `->`/`->>` operators become available without
--          repeatedly parsing every row in the app layer.
--
--      Conversion is done with `ALTER COLUMN ... TYPE JSONB USING <expr>`.
--      The USING clause is gated through a CASE so NULL / empty strings
--      survive instead of choking the cast.
--
--   2. Add `stripe_processed_events(event_id PRIMARY KEY)`. The Stripe
--      webhook handler does an `INSERT ... ON CONFLICT DO NOTHING ...
--      RETURNING` against this table as the first step after signature
--      verification. If RETURNING yields no row, Stripe replayed an event
--      we already processed — the handler short-circuits with 200 so
--      Stripe stops retrying without re-mutating any subscription state.
--
-- Money columns (`ops_invoices.{subtotal,tax,total,amount_paid,balance_due}`,
-- `ops_billing_charges.amount`, `ops_payments.amount`) are deliberately NOT
-- touched here — sibling agent A owns the float→bigint-cents conversion.
--
-- Order matters: §1 (conversions) is safe to run on populated production
-- data because every USING clause guards against NULL/empty strings, but if
-- a legacy row contains malformed JSON the ALTER will fail with
-- `invalid input syntax for type json`. The DIAGNOSTIC comments below each
-- conversion point at a SELECT the operator can run BEFORE migration to
-- spot a bad row.
--
-- §2 is brand-new DDL — CREATE TABLE IF NOT EXISTS + CREATE INDEX
-- IF NOT EXISTS — and is fully idempotent on its own.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- §1. TEXT → JSONB conversions
-- ────────────────────────────────────────────────────────────────────────────

-- ── 1.1 facility_overrides.* (nullable text → jsonb) ──────────────────────
-- All five columns are nullable. Empty strings are coerced to NULL by the
-- USING CASE so the cast can't choke on the `''` legacy sentinel.
-- DIAGNOSTIC: SELECT facility_number, hours_of_operation_json
--   FROM facility_overrides
--   WHERE hours_of_operation_json IS NOT NULL
--     AND hours_of_operation_json <> ''
--     AND hours_of_operation_json !~ '^\s*[\[{]' LIMIT 5;

ALTER TABLE facility_overrides
  ALTER COLUMN hours_of_operation_json TYPE JSONB
    USING (CASE WHEN hours_of_operation_json IS NULL OR hours_of_operation_json = ''
                THEN NULL
                ELSE hours_of_operation_json::jsonb END);
--> statement-breakpoint

ALTER TABLE facility_overrides
  ALTER COLUMN languages_spoken_json TYPE JSONB
    USING (CASE WHEN languages_spoken_json IS NULL OR languages_spoken_json = ''
                THEN NULL
                ELSE languages_spoken_json::jsonb END);
--> statement-breakpoint

ALTER TABLE facility_overrides
  ALTER COLUMN care_types_offered_json TYPE JSONB
    USING (CASE WHEN care_types_offered_json IS NULL OR care_types_offered_json = ''
                THEN NULL
                ELSE care_types_offered_json::jsonb END);
--> statement-breakpoint

ALTER TABLE facility_overrides
  ALTER COLUMN accreditations_json TYPE JSONB
    USING (CASE WHEN accreditations_json IS NULL OR accreditations_json = ''
                THEN NULL
                ELSE accreditations_json::jsonb END);
--> statement-breakpoint

-- prefilled_fields is a JSON array of column names written by
-- storage.prefillFacilityOverrideFromCcld(). Defensive empty-string guard
-- mirrors the four above (the helper itself writes '[]' rather than '', but
-- legacy rows or hand-edits may have either).
ALTER TABLE facility_overrides
  ALTER COLUMN prefilled_fields TYPE JSONB
    USING (CASE WHEN prefilled_fields IS NULL OR prefilled_fields = ''
                THEN NULL
                ELSE prefilled_fields::jsonb END);
--> statement-breakpoint


-- ── 1.2 job_seeker_profiles.job_types (nullable text → jsonb) ─────────────
-- Currently stores a JSON array of role/job-type tags chosen by the seeker.
-- DIAGNOSTIC: SELECT id, job_types FROM job_seeker_profiles
--   WHERE job_types IS NOT NULL AND job_types <> ''
--     AND job_types !~ '^\s*\[' LIMIT 5;
ALTER TABLE job_seeker_profiles
  ALTER COLUMN job_types TYPE JSONB
    USING (CASE WHEN job_types IS NULL OR job_types = ''
                THEN NULL
                ELSE job_types::jsonb END);
--> statement-breakpoint


-- ── 1.3 job_postings.requirements (NOT NULL text → NOT NULL jsonb) ────────
-- The column is NOT NULL; every row currently holds a serialised JSON array
-- of strings (e.g. '["RCFE License","CPR"]'). The USING expression keeps
-- the empty-array semantic on the off chance a row holds '' or whitespace.
-- DIAGNOSTIC: SELECT id, requirements FROM job_postings
--   WHERE requirements IS NULL OR requirements = ''
--      OR requirements !~ '^\s*\[' LIMIT 5;
ALTER TABLE job_postings
  ALTER COLUMN requirements TYPE JSONB
    USING (CASE WHEN requirements IS NULL OR requirements = ''
                THEN '[]'::jsonb
                ELSE requirements::jsonb END);
--> statement-breakpoint

ALTER TABLE job_postings
  ALTER COLUMN requirements SET DEFAULT '[]'::jsonb;
--> statement-breakpoint


-- ── 1.4 ops_drill_logs.{participants,residents_involved,corrective_actions}_json
-- All three nullable, hold a JSON array of strings written via
-- jsonArrayToText() in server/ops/opsStorage.ts.
ALTER TABLE ops_drill_logs
  ALTER COLUMN participants_json TYPE JSONB
    USING (CASE WHEN participants_json IS NULL OR participants_json = ''
                THEN NULL
                ELSE participants_json::jsonb END);
--> statement-breakpoint

ALTER TABLE ops_drill_logs
  ALTER COLUMN residents_involved_json TYPE JSONB
    USING (CASE WHEN residents_involved_json IS NULL OR residents_involved_json = ''
                THEN NULL
                ELSE residents_involved_json::jsonb END);
--> statement-breakpoint

ALTER TABLE ops_drill_logs
  ALTER COLUMN corrective_actions_json TYPE JSONB
    USING (CASE WHEN corrective_actions_json IS NULL OR corrective_actions_json = ''
                THEN NULL
                ELSE corrective_actions_json::jsonb END);
--> statement-breakpoint


-- ── 1.5 ops_inspections.findings_json (nullable text → jsonb) ─────────────
-- The route layer currently accepts a free-form string from the client
-- (z.string().max(16_000)) and writes it as-is. Post-conversion the storage
-- layer must pass a parsed JS value (the route layer JSON.parses incoming
-- strings before handing to storage; see opsStorage / opsRouter updates).
ALTER TABLE ops_inspections
  ALTER COLUMN findings_json TYPE JSONB
    USING (CASE WHEN findings_json IS NULL OR findings_json = ''
                THEN NULL
                ELSE findings_json::jsonb END);
--> statement-breakpoint


-- ── 1.6 ops_preaudit_pulls.{sections_json,totals_json} (nullable text → jsonb)
-- Written via serializeAndCap() which previously could append a literal
-- "...(truncated)" marker, breaking JSON validity. The helper is updated
-- in this round to emit a valid `{ "_truncated": true, ... }` sentinel
-- object instead, so the cast below always succeeds on freshly written
-- rows. Legacy rows where the marker landed mid-string would fail the
-- cast — operators should run the diagnostic and either delete or repair
-- such rows.
-- DIAGNOSTIC: SELECT id, generated_at
--   FROM ops_preaudit_pulls
--   WHERE (sections_json IS NOT NULL AND sections_json LIKE '%...(truncated)')
--      OR (totals_json   IS NOT NULL AND totals_json   LIKE '%...(truncated)');
ALTER TABLE ops_preaudit_pulls
  ALTER COLUMN sections_json TYPE JSONB
    USING (CASE WHEN sections_json IS NULL OR sections_json = ''
                THEN NULL
                ELSE sections_json::jsonb END);
--> statement-breakpoint

ALTER TABLE ops_preaudit_pulls
  ALTER COLUMN totals_json TYPE JSONB
    USING (CASE WHEN totals_json IS NULL OR totals_json = ''
                THEN NULL
                ELSE totals_json::jsonb END);
--> statement-breakpoint


-- ── 1.7 ops_reports.parameters_json (nullable text → jsonb) ───────────────
ALTER TABLE ops_reports
  ALTER COLUMN parameters_json TYPE JSONB
    USING (CASE WHEN parameters_json IS NULL OR parameters_json = ''
                THEN NULL
                ELSE parameters_json::jsonb END);
--> statement-breakpoint


-- ── 1.8 ops_notification_log.triage_snapshot (nullable text → jsonb) ──────
-- Same truncation caveat as ops_preaudit_pulls above — the in-app helper
-- now emits a sentinel object on byte-cap overflow rather than appending
-- a marker mid-string.
-- DIAGNOSTIC: SELECT id, scheduled_for
--   FROM ops_notification_log
--   WHERE triage_snapshot IS NOT NULL
--     AND triage_snapshot LIKE '%...(truncated)';
ALTER TABLE ops_notification_log
  ALTER COLUMN triage_snapshot TYPE JSONB
    USING (CASE WHEN triage_snapshot IS NULL OR triage_snapshot = ''
                THEN NULL
                ELSE triage_snapshot::jsonb END);
--> statement-breakpoint


-- ── 1.9 ops_resident_assessments.raw_json (nullable text → jsonb) ─────────
-- The original LIC form passthrough payload.
ALTER TABLE ops_resident_assessments
  ALTER COLUMN raw_json TYPE JSONB
    USING (CASE WHEN raw_json IS NULL OR raw_json = ''
                THEN NULL
                ELSE raw_json::jsonb END);
--> statement-breakpoint


-- ── 1.10 ops_note_audit_log.payload_diff (nullable text → jsonb) ──────────
-- Diff written by notesStorage; always JSON.stringified upstream.
ALTER TABLE ops_note_audit_log
  ALTER COLUMN payload_diff TYPE JSONB
    USING (CASE WHEN payload_diff IS NULL OR payload_diff = ''
                THEN NULL
                ELSE payload_diff::jsonb END);
--> statement-breakpoint


-- ── COLUMNS DELIBERATELY NOT CONVERTED ────────────────────────────────────
-- ops_audit_trail.{before_json, after_json}        — owned by serializeAndCap
--   in auditStorage which can emit truncation markers; conversion would
--   require helper rework + risk legacy-row failure on cast. Out of scope
--   for this round.
-- ops_facility_settings.setting_value              — free-form string, not
--   strictly JSON-shaped today.
-- prefilled_fields above IS converted (it's a JSON array of column names).
-- ────────────────────────────────────────────────────────────────────────────


-- ============================================================================
-- §2. Stripe webhook idempotency table
-- ============================================================================
-- Append-only registry of every successfully received Stripe event id. The
-- webhook handler runs:
--
--   INSERT INTO stripe_processed_events (event_id, event_type, processed_at)
--   VALUES ($1, $2, $3)
--   ON CONFLICT (event_id) DO NOTHING
--   RETURNING event_id;
--
-- immediately after signature verification. If RETURNING yields zero rows,
-- Stripe replayed an event we already handled — the handler short-circuits
-- with HTTP 200 so Stripe stops retrying without re-mutating subscription
-- state. event_id is the PRIMARY KEY; the lookup is O(1) on a B-tree.
-- processed_at is BIGINT epoch-ms (matches the rest of the schema's time
-- convention); the idx_stripe_events_processed_at index supports the
-- nightly purge / observability query "events processed in the last 24h".
--
-- The table is unbounded by design — Stripe event ids are 1 KB-ish; even
-- at 10k events/day a year of retention is 3.6M rows / a few hundred MB.
-- A retention purge is left for a future operations runbook.

CREATE TABLE IF NOT EXISTS stripe_processed_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  processed_at BIGINT NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_stripe_events_processed_at
  ON stripe_processed_events(processed_at);
--> statement-breakpoint
