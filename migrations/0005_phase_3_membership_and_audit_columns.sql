-- ============================================================================
-- Phase 3 — facility_users membership table + standardized audit columns
-- ============================================================================
-- This migration lands two related changes:
--
--   1) `facility_users` — a forward-looking join table between
--      `facility_accounts` (one row per facility-owner login today) and
--      `users` (the legacy table preserved through Phase 2 R1 because storage.ts
--      still references it). The auth flow does NOT switch to this table in
--      Phase 3 — only the seam is laid so a later phase can introduce
--      multi-staff facilities without a schema rewrite. No rows are
--      backfilled here.
--
--   2) Standardized audit columns (`created_at`, `updated_at`, `created_by`,
--      `updated_by`) across every mutable `ops_*` table, plus a generic
--      BEFORE UPDATE trigger that keeps `updated_at` honest so the storage
--      layer can never forget to bump it. Append-only audit-grade tables
--      (audit trail, notification log, ledger, etc.) get `created_at` /
--      `created_by` only — they never `UPDATE` at the application layer and
--      adding `updated_*` would invite drift.
--
-- Run order: facility_users first (independent of every ops_* table); audit
-- columns next; trigger function + per-table triggers last.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- §1. `facility_users` — membership join (schema seam only; no auth flip)
-- ────────────────────────────────────────────────────────────────────────────
-- One row per (facility_accounts.id, users.id) pair. `role` mirrors the
-- NoteRole / RBAC role set used elsewhere (see server/ops/notePolicy.ts and
-- shared/auditor.ts); kept as a TEXT + CHECK so the canonical list lives in
-- code while the DB still rejects typos. `users.id` is RESTRICT-deleted —
-- deleting a user with active memberships should require explicit cleanup.
-- `facility_accounts.id` cascades — wiping a facility account wipes its
-- memberships as a matter of definition.
--
-- The partial UNIQUE index on (facility_account_id, user_id) WHERE
-- deleted_at IS NULL allows a soft-deleted membership to be re-added under
-- the same pair without violating uniqueness (matches the
-- ops_posting_catalog / ops_resident_trust_accounts archive+reopen pattern).

CREATE TABLE IF NOT EXISTS facility_users (
  id                     BIGSERIAL PRIMARY KEY,
  facility_account_id    INTEGER NOT NULL REFERENCES facility_accounts(id) ON DELETE CASCADE,
  user_id                INTEGER NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  role                   TEXT NOT NULL DEFAULT 'facility_admin',
  created_at             BIGINT NOT NULL,
  created_by             TEXT NOT NULL DEFAULT 'system',
  updated_at             BIGINT NOT NULL,
  updated_by             TEXT,
  deleted_at             BIGINT,
  CONSTRAINT chk_facility_users_role CHECK (
    role IN (
      'facility_admin',
      'admin',
      'auditor',
      'don',
      'med_tech',
      'schedule_lead',
      'office_manager'
    )
  )
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uniq_facility_users_account_user
  ON facility_users(facility_account_id, user_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_facility_users_account
  ON facility_users(facility_account_id) WHERE deleted_at IS NULL;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_facility_users_user
  ON facility_users(user_id) WHERE deleted_at IS NULL;
--> statement-breakpoint


-- ────────────────────────────────────────────────────────────────────────────
-- §2. Generic updated_at trigger function
-- ────────────────────────────────────────────────────────────────────────────
-- Fires BEFORE UPDATE on every mutable ops_* table. The application layer is
-- the single writer of `created_at` (on INSERT only) and `updated_by` (on
-- UPDATE); this trigger owns `updated_at` exclusively so storage code cannot
-- forget. Epoch-ms (BIGINT) to match the codebase convention.

CREATE OR REPLACE FUNCTION set_updated_at_epoch_ms() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint


-- ────────────────────────────────────────────────────────────────────────────
-- §3. Audit columns on mutable ops_* tables
-- ────────────────────────────────────────────────────────────────────────────
-- For each mutable table: add the four columns IF NOT EXISTS, backfill
-- created_by / updated_by to 'system' for existing rows (the BIGINT
-- timestamps stay as-is — the trigger only fires on FUTURE updates), and
-- install the trg_<table>_updated_at trigger.
--
-- created_by / updated_by are TEXT to match the existing ops_audit_trail.
-- actor_id convention (text-coercible AuditActor.id).
--
-- The following append-only tables get `created_at` + `created_by` ONLY (no
-- `updated_*`, no trigger) because the application layer never UPDATEs them
-- — corrections happen via a new row, not a mutation:
--
--   ops_audit_trail               — immutable audit log
--   ops_notification_log          — insert-only send-attempt log
--   ops_resident_trust_ledger     — insert-only financial ledger
--   ops_preaudit_pulls            — insert-only audit-pull log
--   ops_med_destruction           — insert-only destruction log
--   ops_controlled_sub_counts     — insert-only; corrections via a new row
--   ops_resident_trust_statements — insert-only monthly snapshots


-- ── ops_residents ──────────────────────────────────────────────────────────
ALTER TABLE ops_residents ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_residents ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_residents SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_residents SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_residents_updated_at ON ops_residents;
CREATE TRIGGER trg_ops_residents_updated_at BEFORE UPDATE ON ops_residents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_resident_assessments ───────────────────────────────────────────────
-- created_at existed; updated_at did NOT — added here. assessed_by is content
-- (which clinician scored the resident), distinct from audit attribution.
ALTER TABLE ops_resident_assessments ADD COLUMN IF NOT EXISTS updated_at BIGINT;
ALTER TABLE ops_resident_assessments ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_resident_assessments ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_resident_assessments SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE ops_resident_assessments SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_resident_assessments SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_resident_assessments_updated_at ON ops_resident_assessments;
CREATE TRIGGER trg_ops_resident_assessments_updated_at BEFORE UPDATE ON ops_resident_assessments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_care_plans ─────────────────────────────────────────────────────────
-- created_by already exists as TEXT NOT NULL (no DEFAULT) — leave intact.
ALTER TABLE ops_care_plans ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_care_plans SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_care_plans_updated_at ON ops_care_plans;
CREATE TRIGGER trg_ops_care_plans_updated_at BEFORE UPDATE ON ops_care_plans
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_daily_tasks ────────────────────────────────────────────────────────
-- updated_at did NOT exist — added so status flips (completed / refused) are
-- visible without scanning ops_audit_trail.
ALTER TABLE ops_daily_tasks ADD COLUMN IF NOT EXISTS updated_at BIGINT;
ALTER TABLE ops_daily_tasks ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_daily_tasks ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_daily_tasks SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE ops_daily_tasks SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_daily_tasks SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_daily_tasks_updated_at ON ops_daily_tasks;
CREATE TRIGGER trg_ops_daily_tasks_updated_at BEFORE UPDATE ON ops_daily_tasks
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_medications ────────────────────────────────────────────────────────
ALTER TABLE ops_medications ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_medications ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_medications SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_medications SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_medications_updated_at ON ops_medications;
CREATE TRIGGER trg_ops_medications_updated_at BEFORE UPDATE ON ops_medications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_med_passes ─────────────────────────────────────────────────────────
-- updated_at did NOT exist — added so the administered timestamp is not the
-- only mutation marker.
ALTER TABLE ops_med_passes ADD COLUMN IF NOT EXISTS updated_at BIGINT;
ALTER TABLE ops_med_passes ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_med_passes ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_med_passes SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE ops_med_passes SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_med_passes SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_med_passes_updated_at ON ops_med_passes;
CREATE TRIGGER trg_ops_med_passes_updated_at BEFORE UPDATE ON ops_med_passes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_incidents ──────────────────────────────────────────────────────────
ALTER TABLE ops_incidents ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_incidents ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_incidents SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_incidents SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_incidents_updated_at ON ops_incidents;
CREATE TRIGGER trg_ops_incidents_updated_at BEFORE UPDATE ON ops_incidents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_leads ──────────────────────────────────────────────────────────────
ALTER TABLE ops_leads ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_leads ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_leads SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_leads SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_leads_updated_at ON ops_leads;
CREATE TRIGGER trg_ops_leads_updated_at BEFORE UPDATE ON ops_leads
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_tours ──────────────────────────────────────────────────────────────
-- updated_at did NOT exist — added so tour outcome edits show a mutation
-- marker without scanning ops_audit_trail.
ALTER TABLE ops_tours ADD COLUMN IF NOT EXISTS updated_at BIGINT;
ALTER TABLE ops_tours ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_tours ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_tours SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE ops_tours SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_tours SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_tours_updated_at ON ops_tours;
CREATE TRIGGER trg_ops_tours_updated_at BEFORE UPDATE ON ops_tours
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_admissions ─────────────────────────────────────────────────────────
ALTER TABLE ops_admissions ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_admissions ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_admissions SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_admissions SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_admissions_updated_at ON ops_admissions;
CREATE TRIGGER trg_ops_admissions_updated_at BEFORE UPDATE ON ops_admissions
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_billing_charges ────────────────────────────────────────────────────
-- No UPDATE site today, but charges may be edited in the future; standardize.
ALTER TABLE ops_billing_charges ADD COLUMN IF NOT EXISTS updated_at BIGINT;
ALTER TABLE ops_billing_charges ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_billing_charges ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_billing_charges SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE ops_billing_charges SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_billing_charges SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_billing_charges_updated_at ON ops_billing_charges;
CREATE TRIGGER trg_ops_billing_charges_updated_at BEFORE UPDATE ON ops_billing_charges
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_invoices ───────────────────────────────────────────────────────────
ALTER TABLE ops_invoices ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_invoices ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_invoices SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_invoices SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_invoices_updated_at ON ops_invoices;
CREATE TRIGGER trg_ops_invoices_updated_at BEFORE UPDATE ON ops_invoices
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_payments ───────────────────────────────────────────────────────────
-- No UPDATE site today (payments are append-only in code), but the table is
-- not in the explicit insert-only list — standardize for future use.
ALTER TABLE ops_payments ADD COLUMN IF NOT EXISTS updated_at BIGINT;
ALTER TABLE ops_payments ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_payments ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_payments SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE ops_payments SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_payments SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_payments_updated_at ON ops_payments;
CREATE TRIGGER trg_ops_payments_updated_at BEFORE UPDATE ON ops_payments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_staff ──────────────────────────────────────────────────────────────
ALTER TABLE ops_staff ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_staff ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_staff SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_staff SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_staff_updated_at ON ops_staff;
CREATE TRIGGER trg_ops_staff_updated_at BEFORE UPDATE ON ops_staff
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_shifts ─────────────────────────────────────────────────────────────
-- updated_at did NOT exist — added so shift edits show a marker.
ALTER TABLE ops_shifts ADD COLUMN IF NOT EXISTS updated_at BIGINT;
ALTER TABLE ops_shifts ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_shifts ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_shifts SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE ops_shifts SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_shifts SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_shifts_updated_at ON ops_shifts;
CREATE TRIGGER trg_ops_shifts_updated_at BEFORE UPDATE ON ops_shifts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_facility_settings ──────────────────────────────────────────────────
-- created_at did NOT exist (only updated_at via upsert) — added.
ALTER TABLE ops_facility_settings ADD COLUMN IF NOT EXISTS created_at BIGINT;
ALTER TABLE ops_facility_settings ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_facility_settings ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_facility_settings SET created_at = updated_at WHERE created_at IS NULL;
UPDATE ops_facility_settings SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_facility_settings SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_facility_settings_updated_at ON ops_facility_settings;
CREATE TRIGGER trg_ops_facility_settings_updated_at BEFORE UPDATE ON ops_facility_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_compliance_calendar ────────────────────────────────────────────────
ALTER TABLE ops_compliance_calendar ADD COLUMN IF NOT EXISTS updated_at BIGINT;
ALTER TABLE ops_compliance_calendar ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_compliance_calendar ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_compliance_calendar SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE ops_compliance_calendar SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_compliance_calendar SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_compliance_calendar_updated_at ON ops_compliance_calendar;
CREATE TRIGGER trg_ops_compliance_calendar_updated_at BEFORE UPDATE ON ops_compliance_calendar
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_evidence_attachments ───────────────────────────────────────────────
-- Soft-delete via deleted_at — adds the four columns so the delete attribution
-- doesn't have to be reconstructed from ops_audit_trail.
ALTER TABLE ops_evidence_attachments ADD COLUMN IF NOT EXISTS created_at BIGINT;
ALTER TABLE ops_evidence_attachments ADD COLUMN IF NOT EXISTS updated_at BIGINT;
ALTER TABLE ops_evidence_attachments ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_evidence_attachments ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_evidence_attachments SET created_at = uploaded_at WHERE created_at IS NULL;
UPDATE ops_evidence_attachments SET updated_at = uploaded_at WHERE updated_at IS NULL;
UPDATE ops_evidence_attachments SET created_by = uploaded_by WHERE created_by IS NULL OR created_by = '';
UPDATE ops_evidence_attachments SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_evidence_attachments_updated_at ON ops_evidence_attachments;
CREATE TRIGGER trg_ops_evidence_attachments_updated_at BEFORE UPDATE ON ops_evidence_attachments
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_temperature_fixtures ───────────────────────────────────────────────
ALTER TABLE ops_temperature_fixtures ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_temperature_fixtures ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_temperature_fixtures SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_temperature_fixtures SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_temperature_fixtures_updated_at ON ops_temperature_fixtures;
CREATE TRIGGER trg_ops_temperature_fixtures_updated_at BEFORE UPDATE ON ops_temperature_fixtures
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_temperature_logs ───────────────────────────────────────────────────
-- updated_at did NOT exist — added so follow-up resolution is timestamped
-- without scanning ops_audit_trail. recordedBy is content (who took the
-- reading), separate from audit attribution.
ALTER TABLE ops_temperature_logs ADD COLUMN IF NOT EXISTS updated_at BIGINT;
ALTER TABLE ops_temperature_logs ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_temperature_logs ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_temperature_logs SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE ops_temperature_logs SET created_by = recorded_by WHERE created_by IS NULL OR created_by = '';
UPDATE ops_temperature_logs SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_temperature_logs_updated_at ON ops_temperature_logs;
CREATE TRIGGER trg_ops_temperature_logs_updated_at BEFORE UPDATE ON ops_temperature_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_drill_logs ─────────────────────────────────────────────────────────
-- created_by already exists as TEXT NOT NULL (no DEFAULT) — leave intact.
ALTER TABLE ops_drill_logs ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_drill_logs SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_drill_logs_updated_at ON ops_drill_logs;
CREATE TRIGGER trg_ops_drill_logs_updated_at BEFORE UPDATE ON ops_drill_logs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_vendors ────────────────────────────────────────────────────────────
ALTER TABLE ops_vendors ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_vendors ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_vendors SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_vendors SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_vendors_updated_at ON ops_vendors;
CREATE TRIGGER trg_ops_vendors_updated_at BEFORE UPDATE ON ops_vendors
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_complaints ─────────────────────────────────────────────────────────
-- created_by already exists as TEXT NOT NULL (no DEFAULT) — leave intact.
ALTER TABLE ops_complaints ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_complaints SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_complaints_updated_at ON ops_complaints;
CREATE TRIGGER trg_ops_complaints_updated_at BEFORE UPDATE ON ops_complaints
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_complaint_investigation_notes ──────────────────────────────────────
-- Append-only at the application layer (insert only — corrections add a new
-- note, never UPDATE an existing one). Standardize created_at + created_by;
-- skip updated_* and the trigger to match the append-only contract.
ALTER TABLE ops_complaint_investigation_notes ADD COLUMN IF NOT EXISTS created_at BIGINT;
ALTER TABLE ops_complaint_investigation_notes ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
UPDATE ops_complaint_investigation_notes SET created_at = noted_at WHERE created_at IS NULL;
UPDATE ops_complaint_investigation_notes SET created_by = noted_by WHERE created_by IS NULL OR created_by = '';
--> statement-breakpoint

-- ── ops_inspections ────────────────────────────────────────────────────────
-- created_by already exists as TEXT NOT NULL (no DEFAULT) — leave intact.
ALTER TABLE ops_inspections ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_inspections SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_inspections_updated_at ON ops_inspections;
CREATE TRIGGER trg_ops_inspections_updated_at BEFORE UPDATE ON ops_inspections
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_inspection_citations ───────────────────────────────────────────────
ALTER TABLE ops_inspection_citations ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_inspection_citations ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_inspection_citations SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
UPDATE ops_inspection_citations SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_inspection_citations_updated_at ON ops_inspection_citations;
CREATE TRIGGER trg_ops_inspection_citations_updated_at BEFORE UPDATE ON ops_inspection_citations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_staff_credentials ──────────────────────────────────────────────────
-- created_by already exists as TEXT NOT NULL (no DEFAULT) — leave intact.
ALTER TABLE ops_staff_credentials ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_staff_credentials SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_staff_credentials_updated_at ON ops_staff_credentials;
CREATE TRIGGER trg_ops_staff_credentials_updated_at BEFORE UPDATE ON ops_staff_credentials
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_obligations ────────────────────────────────────────────────────────
-- created_by already exists as TEXT NOT NULL (no DEFAULT) — leave intact.
ALTER TABLE ops_obligations ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_obligations SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_obligations_updated_at ON ops_obligations;
CREATE TRIGGER trg_ops_obligations_updated_at BEFORE UPDATE ON ops_obligations
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_share_links ────────────────────────────────────────────────────────
-- created_by already exists as TEXT NOT NULL (no DEFAULT) — leave intact.
ALTER TABLE ops_share_links ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_share_links SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_share_links_updated_at ON ops_share_links;
CREATE TRIGGER trg_ops_share_links_updated_at BEFORE UPDATE ON ops_share_links
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_posting_catalog ────────────────────────────────────────────────────
-- created_by already exists as TEXT NOT NULL (no DEFAULT) — leave intact.
ALTER TABLE ops_posting_catalog ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_posting_catalog SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_posting_catalog_updated_at ON ops_posting_catalog;
CREATE TRIGGER trg_ops_posting_catalog_updated_at BEFORE UPDATE ON ops_posting_catalog
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_posting_verifications ──────────────────────────────────────────────
-- One row per walkthrough check; not in the explicit insert-only list, so
-- standardize all four columns + trigger for future edits (e.g., evidence
-- backfill bumping evidence_count).
ALTER TABLE ops_posting_verifications ADD COLUMN IF NOT EXISTS updated_at BIGINT;
ALTER TABLE ops_posting_verifications ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_posting_verifications ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_posting_verifications SET updated_at = created_at WHERE updated_at IS NULL;
UPDATE ops_posting_verifications SET created_by = verified_by WHERE created_by IS NULL OR created_by = '';
UPDATE ops_posting_verifications SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_posting_verifications_updated_at ON ops_posting_verifications;
CREATE TRIGGER trg_ops_posting_verifications_updated_at BEFORE UPDATE ON ops_posting_verifications
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_resident_trust_accounts ────────────────────────────────────────────
-- created_by already exists as TEXT NOT NULL (no DEFAULT) — leave intact.
ALTER TABLE ops_resident_trust_accounts ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_resident_trust_accounts SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_resident_trust_accounts_updated_at ON ops_resident_trust_accounts;
CREATE TRIGGER trg_ops_resident_trust_accounts_updated_at BEFORE UPDATE ON ops_resident_trust_accounts
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint

-- ── ops_reports ────────────────────────────────────────────────────────────
-- Lifecycle column 'status' transitions generating → ready → expired, so
-- this IS mutable despite the audit-grade feel. Standardize created_at
-- (mapped from generated_at), updated_at, and the four audit columns.
ALTER TABLE ops_reports ADD COLUMN IF NOT EXISTS created_at BIGINT;
ALTER TABLE ops_reports ADD COLUMN IF NOT EXISTS updated_at BIGINT;
ALTER TABLE ops_reports ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
ALTER TABLE ops_reports ADD COLUMN IF NOT EXISTS updated_by TEXT;
UPDATE ops_reports SET created_at = generated_at WHERE created_at IS NULL;
UPDATE ops_reports SET updated_at = generated_at WHERE updated_at IS NULL;
UPDATE ops_reports SET created_by = generated_by WHERE created_by IS NULL OR created_by = '';
UPDATE ops_reports SET updated_by = 'system' WHERE updated_by IS NULL;
DROP TRIGGER IF EXISTS trg_ops_reports_updated_at ON ops_reports;
CREATE TRIGGER trg_ops_reports_updated_at BEFORE UPDATE ON ops_reports
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint


-- ────────────────────────────────────────────────────────────────────────────
-- §4. Append-only tables — created_by backfill only
-- ────────────────────────────────────────────────────────────────────────────
-- These tables already carry a content-attribution column (actor_id /
-- recorded_by / generated_by / etc.) but no `created_by` audit attribution.
-- We add `created_by` (defaulting 'system') so a single column name is the
-- audit-attribution reference across the entire ops_* schema, then backfill
-- from the relevant content column. We do NOT add `updated_*` columns and
-- do NOT install the BEFORE UPDATE trigger — the application layer never
-- UPDATEs these rows.

-- ops_audit_trail — actor_id is already TEXT NOT NULL; map → created_by.
ALTER TABLE ops_audit_trail ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
UPDATE ops_audit_trail SET created_by = actor_id WHERE created_by IS NULL OR created_by = '';
--> statement-breakpoint

-- ops_notification_log — no actor in the row today; default 'system'.
ALTER TABLE ops_notification_log ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
UPDATE ops_notification_log SET created_by = 'system' WHERE created_by IS NULL OR created_by = '';
--> statement-breakpoint

-- ops_resident_trust_ledger — recorded_by is the content actor; map → created_by.
ALTER TABLE ops_resident_trust_ledger ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
UPDATE ops_resident_trust_ledger SET created_by = recorded_by WHERE created_by IS NULL OR created_by = '';
--> statement-breakpoint

-- ops_preaudit_pulls — generated_by is the content actor; map → created_by.
-- Also missing created_at; map from generated_at.
ALTER TABLE ops_preaudit_pulls ADD COLUMN IF NOT EXISTS created_at BIGINT;
ALTER TABLE ops_preaudit_pulls ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
UPDATE ops_preaudit_pulls SET created_at = generated_at WHERE created_at IS NULL;
UPDATE ops_preaudit_pulls SET created_by = generated_by WHERE created_by IS NULL OR created_by = '';
--> statement-breakpoint

-- ops_med_destruction — destroyed_by is the content actor; map → created_by.
ALTER TABLE ops_med_destruction ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
UPDATE ops_med_destruction SET created_by = destroyed_by WHERE created_by IS NULL OR created_by = '';
--> statement-breakpoint

-- ops_controlled_sub_counts — counted_by is the content actor; map → created_by.
-- (Note: there IS one UPDATE site in resolveControlledSubDiscrepancy that
-- flips `resolved` + appends to discrepancy_notes; per the Phase 3 spec we
-- still treat this table as insert-only — corrections will move to a new
-- row in a future refactor — so we deliberately skip updated_* + trigger.)
ALTER TABLE ops_controlled_sub_counts ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
UPDATE ops_controlled_sub_counts SET created_by = counted_by WHERE created_by IS NULL OR created_by = '';
--> statement-breakpoint

-- ops_resident_trust_statements — generated_by is the content actor; map →
-- created_by. Also missing created_at; map from generated_at.
ALTER TABLE ops_resident_trust_statements ADD COLUMN IF NOT EXISTS created_at BIGINT;
ALTER TABLE ops_resident_trust_statements ADD COLUMN IF NOT EXISTS created_by TEXT NOT NULL DEFAULT 'system';
UPDATE ops_resident_trust_statements SET created_at = generated_at WHERE created_at IS NULL;
UPDATE ops_resident_trust_statements SET created_by = generated_by WHERE created_by IS NULL OR created_by = '';
--> statement-breakpoint
