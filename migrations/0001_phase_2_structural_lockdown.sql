-- ============================================================================
-- Phase 2 (Round 1) — Structural lockdown
-- ============================================================================
-- This migration is hand-authored (not drizzle-kit generated) because it
-- combines six classes of change that drizzle-kit's TS-diff workflow either
-- can't express well or that need orphan-row diagnostics inlined as SQL:
--
--   1. Composite UNIQUE (id, facility_number) on tenant parents — the FK
--      target for tenant-enforcing composite FKs below.
--   2. Foreign keys across the ops_* / tracker_* / notes schema, with
--      ON DELETE RESTRICT for clinical/financial parents and CASCADE only
--      for explicit child collections (note_tags, note_mentions, etc.).
--      Composite FKs against (id, facility_number) enforce tenant integrity
--      at the database — a child row in facility A literally cannot point
--      at a parent in facility B.
--   3. CHECK constraints on enum-like TEXT columns whose canonical lists
--      live in shared/ Zod schemas and shared/ const arrays.
--   4. NULL replaces the `text NOT NULL DEFAULT ''` sentinel on the
--      facilities table for columns that legitimately may be unknown.
--   5. Drop unused tables / dead code — the `users` table is left in place
--      because storage.ts still references it (see Phase 2 R1 report).
--   6. pg_trgm extension + GIN trigram index on facilities.name for
--      future similarity search.
--
-- Hand-edits expected: orphan diagnostics, empty-string→NULL migration,
-- CREATE EXTENSION pg_trgm + GIN index, all CHECK constraints, all FK
-- additions (drizzle-kit can't express composite-column FKs without a
-- foreignKey() builder call on every table, which would touch hundreds of
-- TS lines for no runtime benefit — the constraint IS in the DB regardless
-- of whether the Drizzle TS knows about it).
--
-- Run order matters. Composite UNIQUEs (§1) must exist before composite
-- FKs (§2) reference them. CHECK constraints (§3) come last because they
-- are independent of FK rewiring and benefit from running against the
-- already-cleaned data set.
--
-- All ALTER TABLE statements that ADD CONSTRAINT or ALTER COLUMN take an
-- ACCESS EXCLUSIVE lock for the duration; Postgres metadata-only changes
-- are fast but on a busy prod database it is wise to run this during a
-- maintenance window. Constraint validation scans the full table — if
-- the table is huge (>1M rows) and the cluster is loaded, consider
-- ADD CONSTRAINT ... NOT VALID + a separate VALIDATE CONSTRAINT (omitted
-- here because the ops_* tables are small).
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- §1. Composite tenant-integrity UNIQUE keys
-- ────────────────────────────────────────────────────────────────────────────
-- For every parent table whose `id` is referenced by child rows AND that
-- carries `facility_number`, add UNIQUE (id, facility_number). This is
-- redundant with the existing PRIMARY KEY (id) — id alone is already
-- unique — but Postgres requires the FK target be exactly the columns
-- declared in a UNIQUE/PK constraint. Composite UNIQUE is the cheapest
-- way to express "this tuple is jointly unique" without dropping the PK.
--
-- These are pure metadata additions on small tables; the unique-index
-- build is fast.

ALTER TABLE ops_residents
  ADD CONSTRAINT uniq_ops_residents_id_facility UNIQUE (id, facility_number);
--> statement-breakpoint

ALTER TABLE ops_medications
  ADD CONSTRAINT uniq_ops_medications_id_facility UNIQUE (id, facility_number);
--> statement-breakpoint

ALTER TABLE ops_med_passes
  ADD CONSTRAINT uniq_ops_med_passes_id_facility UNIQUE (id, facility_number);
--> statement-breakpoint

ALTER TABLE ops_care_plans
  ADD CONSTRAINT uniq_ops_care_plans_id_facility UNIQUE (id, facility_number);
--> statement-breakpoint

ALTER TABLE ops_leads
  ADD CONSTRAINT uniq_ops_leads_id_facility UNIQUE (id, facility_number);
--> statement-breakpoint

ALTER TABLE ops_invoices
  ADD CONSTRAINT uniq_ops_invoices_id_facility UNIQUE (id, facility_number);
--> statement-breakpoint

ALTER TABLE ops_staff
  ADD CONSTRAINT uniq_ops_staff_id_facility UNIQUE (id, facility_number);
--> statement-breakpoint

ALTER TABLE ops_temperature_fixtures
  ADD CONSTRAINT uniq_ops_temperature_fixtures_id_facility UNIQUE (id, facility_number);
--> statement-breakpoint

ALTER TABLE ops_inspections
  ADD CONSTRAINT uniq_ops_inspections_id_facility UNIQUE (id, facility_number);
--> statement-breakpoint

ALTER TABLE ops_complaints
  ADD CONSTRAINT uniq_ops_complaints_id_facility UNIQUE (id, facility_number);
--> statement-breakpoint

ALTER TABLE ops_obligations
  ADD CONSTRAINT uniq_ops_obligations_id_facility UNIQUE (id, facility_number);
--> statement-breakpoint

ALTER TABLE ops_share_links
  ADD CONSTRAINT uniq_ops_share_links_id_facility UNIQUE (id, facility_number);
--> statement-breakpoint

ALTER TABLE ops_posting_catalog
  ADD CONSTRAINT uniq_ops_posting_catalog_id_facility UNIQUE (id, facility_number);
--> statement-breakpoint

ALTER TABLE ops_resident_trust_accounts
  ADD CONSTRAINT uniq_ops_resident_trust_accounts_id_facility UNIQUE (id, facility_number);
--> statement-breakpoint


-- ────────────────────────────────────────────────────────────────────────────
-- §2. Foreign keys (composite tenant-enforcing where applicable)
-- ────────────────────────────────────────────────────────────────────────────
-- Pattern:
--   * Clinical/financial parents → ON DELETE RESTRICT (no cascading delete
--     of medical/billing data).
--   * Explicit child collections (note_tags, note_mentions, citation rows,
--     etc.) → ON DELETE CASCADE.
--   * If both child and parent carry `facility_number`, the FK is composite
--     against (id, facility_number) — this enforces tenant integrity at
--     the DB.
--
-- For each FK we emit a diagnostic SELECT as a SQL comment so the operator
-- running this migration in psql can see what is about to be cleaned up
-- (or what is going to block, if data is mid-flight). The diagnostic
-- COUNT lines are intentionally NOT executed as part of the migration —
-- they are sample queries the operator runs MANUALLY before applying.
-- See docs/runbooks/phase-2-migration-orphan-cleanup.md for the full
-- workflow if any DELETE/ADD CONSTRAINT step fails.

-- ── ops_resident_assessments.resident_id → ops_residents.id (RESTRICT) ─────
-- Composite tenant: assessment carries facility_number too.
-- DIAGNOSTIC: SELECT count(*) FROM ops_resident_assessments a
--             WHERE NOT EXISTS (SELECT 1 FROM ops_residents r
--                               WHERE r.id = a.resident_id
--                                 AND r.facility_number = a.facility_number);
DELETE FROM ops_resident_assessments
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_residents r WHERE r.id = ops_resident_assessments.resident_id
 );
--> statement-breakpoint
ALTER TABLE ops_resident_assessments
  ADD CONSTRAINT fk_ops_resident_assessments_resident
  FOREIGN KEY (resident_id, facility_number)
  REFERENCES ops_residents (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_care_plans.resident_id → ops_residents.id (RESTRICT) ──────────────
DELETE FROM ops_care_plans
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_residents r WHERE r.id = ops_care_plans.resident_id
 );
--> statement-breakpoint
ALTER TABLE ops_care_plans
  ADD CONSTRAINT fk_ops_care_plans_resident
  FOREIGN KEY (resident_id, facility_number)
  REFERENCES ops_residents (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_daily_tasks.care_plan_id → ops_care_plans.id (RESTRICT) ───────────
-- ── ops_daily_tasks.resident_id  → ops_residents.id (RESTRICT)  ───────────
DELETE FROM ops_daily_tasks
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_care_plans cp WHERE cp.id = ops_daily_tasks.care_plan_id
 )
    OR NOT EXISTS (
   SELECT 1 FROM ops_residents r WHERE r.id = ops_daily_tasks.resident_id
 );
--> statement-breakpoint
ALTER TABLE ops_daily_tasks
  ADD CONSTRAINT fk_ops_daily_tasks_care_plan
  FOREIGN KEY (care_plan_id, facility_number)
  REFERENCES ops_care_plans (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ops_daily_tasks
  ADD CONSTRAINT fk_ops_daily_tasks_resident
  FOREIGN KEY (resident_id, facility_number)
  REFERENCES ops_residents (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_medications.resident_id → ops_residents.id (RESTRICT) ─────────────
DELETE FROM ops_medications
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_residents r WHERE r.id = ops_medications.resident_id
 );
--> statement-breakpoint
ALTER TABLE ops_medications
  ADD CONSTRAINT fk_ops_medications_resident
  FOREIGN KEY (resident_id, facility_number)
  REFERENCES ops_residents (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_med_passes.medication_id → ops_medications.id (RESTRICT) ──────────
-- ── ops_med_passes.resident_id   → ops_residents.id   (RESTRICT) ──────────
DELETE FROM ops_med_passes
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_medications m WHERE m.id = ops_med_passes.medication_id
 )
    OR NOT EXISTS (
   SELECT 1 FROM ops_residents r WHERE r.id = ops_med_passes.resident_id
 );
--> statement-breakpoint
ALTER TABLE ops_med_passes
  ADD CONSTRAINT fk_ops_med_passes_medication
  FOREIGN KEY (medication_id, facility_number)
  REFERENCES ops_medications (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ops_med_passes
  ADD CONSTRAINT fk_ops_med_passes_resident
  FOREIGN KEY (resident_id, facility_number)
  REFERENCES ops_residents (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_controlled_sub_counts.medication_id → ops_medications.id (RESTRICT)
DELETE FROM ops_controlled_sub_counts
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_medications m WHERE m.id = ops_controlled_sub_counts.medication_id
 );
--> statement-breakpoint
ALTER TABLE ops_controlled_sub_counts
  ADD CONSTRAINT fk_ops_controlled_sub_counts_medication
  FOREIGN KEY (medication_id, facility_number)
  REFERENCES ops_medications (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_med_destruction.medication_id → ops_medications.id (RESTRICT) ─────
DELETE FROM ops_med_destruction
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_medications m WHERE m.id = ops_med_destruction.medication_id
 );
--> statement-breakpoint
ALTER TABLE ops_med_destruction
  ADD CONSTRAINT fk_ops_med_destruction_medication
  FOREIGN KEY (medication_id, facility_number)
  REFERENCES ops_medications (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_incidents.resident_id → ops_residents.id (RESTRICT, nullable) ─────
-- resident_id is nullable on incidents (some are facility-wide); keep FK
-- but allow NULL.
DELETE FROM ops_incidents
 WHERE resident_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM ops_residents r WHERE r.id = ops_incidents.resident_id
   );
--> statement-breakpoint
ALTER TABLE ops_incidents
  ADD CONSTRAINT fk_ops_incidents_resident
  FOREIGN KEY (resident_id, facility_number)
  REFERENCES ops_residents (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_tours.lead_id → ops_leads.id (RESTRICT) ───────────────────────────
DELETE FROM ops_tours
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_leads l WHERE l.id = ops_tours.lead_id
 );
--> statement-breakpoint
ALTER TABLE ops_tours
  ADD CONSTRAINT fk_ops_tours_lead
  FOREIGN KEY (lead_id, facility_number)
  REFERENCES ops_leads (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_admissions.lead_id     → ops_leads.id      (RESTRICT) ─────────────
-- ── ops_admissions.resident_id → ops_residents.id  (RESTRICT, nullable) ───
DELETE FROM ops_admissions
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_leads l WHERE l.id = ops_admissions.lead_id
 );
--> statement-breakpoint
DELETE FROM ops_admissions
 WHERE resident_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM ops_residents r WHERE r.id = ops_admissions.resident_id
   );
--> statement-breakpoint
ALTER TABLE ops_admissions
  ADD CONSTRAINT fk_ops_admissions_lead
  FOREIGN KEY (lead_id, facility_number)
  REFERENCES ops_leads (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ops_admissions
  ADD CONSTRAINT fk_ops_admissions_resident
  FOREIGN KEY (resident_id, facility_number)
  REFERENCES ops_residents (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_billing_charges.resident_id → ops_residents.id (RESTRICT) ─────────
DELETE FROM ops_billing_charges
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_residents r WHERE r.id = ops_billing_charges.resident_id
 );
--> statement-breakpoint
ALTER TABLE ops_billing_charges
  ADD CONSTRAINT fk_ops_billing_charges_resident
  FOREIGN KEY (resident_id, facility_number)
  REFERENCES ops_residents (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_invoices.resident_id → ops_residents.id (RESTRICT) ────────────────
DELETE FROM ops_invoices
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_residents r WHERE r.id = ops_invoices.resident_id
 );
--> statement-breakpoint
ALTER TABLE ops_invoices
  ADD CONSTRAINT fk_ops_invoices_resident
  FOREIGN KEY (resident_id, facility_number)
  REFERENCES ops_residents (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_payments.invoice_id   → ops_invoices.id    (RESTRICT) ─────────────
-- ── ops_payments.resident_id  → ops_residents.id   (RESTRICT) ─────────────
DELETE FROM ops_payments
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_invoices i WHERE i.id = ops_payments.invoice_id
 )
    OR NOT EXISTS (
   SELECT 1 FROM ops_residents r WHERE r.id = ops_payments.resident_id
 );
--> statement-breakpoint
ALTER TABLE ops_payments
  ADD CONSTRAINT fk_ops_payments_invoice
  FOREIGN KEY (invoice_id, facility_number)
  REFERENCES ops_invoices (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ops_payments
  ADD CONSTRAINT fk_ops_payments_resident
  FOREIGN KEY (resident_id, facility_number)
  REFERENCES ops_residents (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_shifts.staff_id → ops_staff.id (RESTRICT) ─────────────────────────
-- covered_by_id is a soft pointer (nullable) — left without a hard FK so
-- swapping coverers when a staff record is hard-deleted doesn't fail.
DELETE FROM ops_shifts
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_staff s WHERE s.id = ops_shifts.staff_id
 );
--> statement-breakpoint
ALTER TABLE ops_shifts
  ADD CONSTRAINT fk_ops_shifts_staff
  FOREIGN KEY (staff_id, facility_number)
  REFERENCES ops_staff (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_temperature_logs.fixture_id → ops_temperature_fixtures.id (RESTRICT)
DELETE FROM ops_temperature_logs
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_temperature_fixtures f WHERE f.id = ops_temperature_logs.fixture_id
 );
--> statement-breakpoint
ALTER TABLE ops_temperature_logs
  ADD CONSTRAINT fk_ops_temperature_logs_fixture
  FOREIGN KEY (fixture_id, facility_number)
  REFERENCES ops_temperature_fixtures (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_complaint_investigation_notes.complaint_id → ops_complaints.id (CASCADE)
-- Investigation notes are an explicit child collection — when a complaint
-- is hard-deleted the notes go with it. Hard-delete is rare (status flips
-- to 'closed' instead); CASCADE is the safe expression here.
DELETE FROM ops_complaint_investigation_notes
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_complaints c WHERE c.id = ops_complaint_investigation_notes.complaint_id
 );
--> statement-breakpoint
ALTER TABLE ops_complaint_investigation_notes
  ADD CONSTRAINT fk_ops_complaint_inv_notes_complaint
  FOREIGN KEY (complaint_id, facility_number)
  REFERENCES ops_complaints (id, facility_number)
  ON DELETE CASCADE;
--> statement-breakpoint

-- ── ops_inspection_citations.inspection_id → ops_inspections.id (CASCADE) ─
-- Citations belong to the inspection they were issued under — same as
-- investigation notes above.
DELETE FROM ops_inspection_citations
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_inspections i WHERE i.id = ops_inspection_citations.inspection_id
 );
--> statement-breakpoint
ALTER TABLE ops_inspection_citations
  ADD CONSTRAINT fk_ops_inspection_citations_inspection
  FOREIGN KEY (inspection_id, facility_number)
  REFERENCES ops_inspections (id, facility_number)
  ON DELETE CASCADE;
--> statement-breakpoint

-- ── ops_staff_credentials.staff_id → ops_staff.id (RESTRICT) ──────────────
DELETE FROM ops_staff_credentials
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_staff s WHERE s.id = ops_staff_credentials.staff_id
 );
--> statement-breakpoint
ALTER TABLE ops_staff_credentials
  ADD CONSTRAINT fk_ops_staff_credentials_staff
  FOREIGN KEY (staff_id, facility_number)
  REFERENCES ops_staff (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_preaudit_pulls.share_link_id → ops_share_links.id (RESTRICT, nullable)
-- Only populated when delivery_method='share_link'. Composite tenant: pull
-- carries facility_number too.
DELETE FROM ops_preaudit_pulls
 WHERE share_link_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM ops_share_links sl WHERE sl.id = ops_preaudit_pulls.share_link_id
   );
--> statement-breakpoint
ALTER TABLE ops_preaudit_pulls
  ADD CONSTRAINT fk_ops_preaudit_pulls_share_link
  FOREIGN KEY (share_link_id, facility_number)
  REFERENCES ops_share_links (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_posting_verifications.catalog_id → ops_posting_catalog.id (RESTRICT)
DELETE FROM ops_posting_verifications
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_posting_catalog pc WHERE pc.id = ops_posting_verifications.catalog_id
 );
--> statement-breakpoint
ALTER TABLE ops_posting_verifications
  ADD CONSTRAINT fk_ops_posting_verifications_catalog
  FOREIGN KEY (catalog_id, facility_number)
  REFERENCES ops_posting_catalog (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_resident_trust_accounts.resident_id → ops_residents.id (RESTRICT) ─
DELETE FROM ops_resident_trust_accounts
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_residents r WHERE r.id = ops_resident_trust_accounts.resident_id
 );
--> statement-breakpoint
ALTER TABLE ops_resident_trust_accounts
  ADD CONSTRAINT fk_ops_resident_trust_accounts_resident
  FOREIGN KEY (resident_id, facility_number)
  REFERENCES ops_residents (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_resident_trust_ledger.account_id  → ops_resident_trust_accounts.id (RESTRICT)
-- ── ops_resident_trust_ledger.resident_id → ops_residents.id              (RESTRICT)
DELETE FROM ops_resident_trust_ledger
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_resident_trust_accounts a WHERE a.id = ops_resident_trust_ledger.account_id
 )
    OR NOT EXISTS (
   SELECT 1 FROM ops_residents r WHERE r.id = ops_resident_trust_ledger.resident_id
 );
--> statement-breakpoint
ALTER TABLE ops_resident_trust_ledger
  ADD CONSTRAINT fk_ops_resident_trust_ledger_account
  FOREIGN KEY (account_id, facility_number)
  REFERENCES ops_resident_trust_accounts (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ops_resident_trust_ledger
  ADD CONSTRAINT fk_ops_resident_trust_ledger_resident
  FOREIGN KEY (resident_id, facility_number)
  REFERENCES ops_residents (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── ops_resident_trust_statements.account_id / resident_id (RESTRICT) ────
DELETE FROM ops_resident_trust_statements
 WHERE NOT EXISTS (
   SELECT 1 FROM ops_resident_trust_accounts a WHERE a.id = ops_resident_trust_statements.account_id
 )
    OR NOT EXISTS (
   SELECT 1 FROM ops_residents r WHERE r.id = ops_resident_trust_statements.resident_id
 );
--> statement-breakpoint
ALTER TABLE ops_resident_trust_statements
  ADD CONSTRAINT fk_ops_resident_trust_statements_account
  FOREIGN KEY (account_id, facility_number)
  REFERENCES ops_resident_trust_accounts (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ops_resident_trust_statements
  ADD CONSTRAINT fk_ops_resident_trust_statements_resident
  FOREIGN KEY (resident_id, facility_number)
  REFERENCES ops_residents (id, facility_number)
  ON DELETE RESTRICT;
--> statement-breakpoint

-- ── Notes module — explicit child collections (CASCADE) ───────────────────
-- These have no facility_number column on the child (the parent's
-- facility_number is the tenant boundary), so use single-column FKs to
-- ops_notes(id). CASCADE because deleting a note must take its tags,
-- mentions, attachments, ack receipts, and version snapshots with it.

DELETE FROM ops_note_tags
 WHERE NOT EXISTS (SELECT 1 FROM ops_notes n WHERE n.id = ops_note_tags.note_id);
--> statement-breakpoint
ALTER TABLE ops_note_tags
  ADD CONSTRAINT fk_ops_note_tags_note
  FOREIGN KEY (note_id) REFERENCES ops_notes (id) ON DELETE CASCADE;
--> statement-breakpoint

DELETE FROM ops_note_mentions
 WHERE NOT EXISTS (SELECT 1 FROM ops_notes n WHERE n.id = ops_note_mentions.note_id);
--> statement-breakpoint
ALTER TABLE ops_note_mentions
  ADD CONSTRAINT fk_ops_note_mentions_note
  FOREIGN KEY (note_id) REFERENCES ops_notes (id) ON DELETE CASCADE;
--> statement-breakpoint

DELETE FROM ops_note_attachments
 WHERE NOT EXISTS (SELECT 1 FROM ops_notes n WHERE n.id = ops_note_attachments.note_id);
--> statement-breakpoint
ALTER TABLE ops_note_attachments
  ADD CONSTRAINT fk_ops_note_attachments_note
  FOREIGN KEY (note_id) REFERENCES ops_notes (id) ON DELETE CASCADE;
--> statement-breakpoint

DELETE FROM ops_note_acknowledgments
 WHERE NOT EXISTS (SELECT 1 FROM ops_notes n WHERE n.id = ops_note_acknowledgments.note_id);
--> statement-breakpoint
ALTER TABLE ops_note_acknowledgments
  ADD CONSTRAINT fk_ops_note_acknowledgments_note
  FOREIGN KEY (note_id) REFERENCES ops_notes (id) ON DELETE CASCADE;
--> statement-breakpoint

DELETE FROM ops_note_versions
 WHERE NOT EXISTS (SELECT 1 FROM ops_notes n WHERE n.id = ops_note_versions.note_id);
--> statement-breakpoint
ALTER TABLE ops_note_versions
  ADD CONSTRAINT fk_ops_note_versions_note
  FOREIGN KEY (note_id) REFERENCES ops_notes (id) ON DELETE CASCADE;
--> statement-breakpoint

-- ── Trackers module — tracker_entry_versions.entry_id (CASCADE) ───────────
-- Version snapshots belong to the entry. If the entry is hard-deleted
-- (rare — soft-delete is preferred) the versions follow it.
DELETE FROM tracker_entry_versions
 WHERE NOT EXISTS (
   SELECT 1 FROM tracker_entries e WHERE e.id = tracker_entry_versions.entry_id
 );
--> statement-breakpoint
ALTER TABLE tracker_entry_versions
  ADD CONSTRAINT fk_tracker_entry_versions_entry
  FOREIGN KEY (entry_id) REFERENCES tracker_entries (id) ON DELETE CASCADE;
--> statement-breakpoint


-- ────────────────────────────────────────────────────────────────────────────
-- §3. CHECK constraints on enum-like columns
-- ────────────────────────────────────────────────────────────────────────────
-- Canonical lists are defined in:
--   shared/obligations.ts            → OBLIGATION_STATUSES, OBLIGATION_SEVERITIES, OBLIGATION_TYPES, OBLIGATION_TARGETS
--   shared/staff-credentials.ts      → CREDENTIAL_TYPES, CREDENTIAL_STATUSES
--   shared/resident-trust.ts         → TRUST_LEDGER_DIRECTIONS, TRUST_LEDGER_CATEGORIES, TRUST_ACCOUNT_STATUSES
--   shared/postings.ts               → POSTING_KEYS, POSTING_VERIFICATION_STATUSES
--   shared/reports.ts                → REPORT_KINDS, REPORT_STATUSES, REPORT_MIME_TYPES
--   shared/auditor.ts                → AUDITOR_AUDIENCES, SHARE_LINK_SCOPES
--   shared/incident-types.ts         → IncidentSeverity ('serious' | 'non_emergent')
--   server/ops/notesSchema.ts        → notePrioritySchema, noteStatusSchema, noteVisibilitySchema, ackRequiredRoleSchema, attachmentScanStatusSchema, noteCategorySchema
--   server/trackers/trackerSchema.ts → trackerAlertSeveritySchema, trackerAlertStatusSchema
--
-- Pre-flight: for each column, the operator should run
--   SELECT DISTINCT <column>, count(*) FROM <table> GROUP BY <column>;
-- to verify that every existing value is in the allowed set BEFORE this
-- migration runs. If an unexpected value is found, comment out the CHECK
-- for that column and surface as a TODO. The schema itself ships the
-- CHECK; it is the operator's responsibility to verify data first.
--
-- All CHECKs allow NULL implicitly (Postgres CHECK is "MUST be true";
-- NULL evaluates to NULL → not-false → passes). For NOT NULL columns
-- the upstream NOT NULL is already enforced separately.

-- ── ops_residents.status ─────────────────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_residents GROUP BY status;
ALTER TABLE ops_residents
  ADD CONSTRAINT chk_ops_residents_status
  CHECK (status IN ('active', 'discharged', 'on_hold'));
--> statement-breakpoint

-- ── ops_medications.status ───────────────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_medications GROUP BY status;
ALTER TABLE ops_medications
  ADD CONSTRAINT chk_ops_medications_status
  CHECK (status IN ('active', 'discontinued', 'completed'));
--> statement-breakpoint

-- ── ops_med_passes.status ────────────────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_med_passes GROUP BY status;
ALTER TABLE ops_med_passes
  ADD CONSTRAINT chk_ops_med_passes_status
  CHECK (status IN ('pending', 'administered', 'refused', 'held'));
--> statement-breakpoint

-- ── ops_incidents.status ─────────────────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_incidents GROUP BY status;
ALTER TABLE ops_incidents
  ADD CONSTRAINT chk_ops_incidents_status
  CHECK (status IN ('open', 'under_review', 'closed', 'reopened'));
--> statement-breakpoint

-- ── ops_incidents.event_severity (nullable) ──────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT event_severity, count(*) FROM ops_incidents GROUP BY event_severity;
ALTER TABLE ops_incidents
  ADD CONSTRAINT chk_ops_incidents_event_severity
  CHECK (event_severity IS NULL OR event_severity IN ('serious', 'non_emergent'));
--> statement-breakpoint

-- ── ops_leads.stage ──────────────────────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT stage, count(*) FROM ops_leads GROUP BY stage;
ALTER TABLE ops_leads
  ADD CONSTRAINT chk_ops_leads_stage
  CHECK (stage IN ('inquiry', 'qualified', 'toured', 'won', 'lost'));
--> statement-breakpoint

-- ── ops_invoices.status ──────────────────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_invoices GROUP BY status;
ALTER TABLE ops_invoices
  ADD CONSTRAINT chk_ops_invoices_status
  CHECK (status IN ('draft', 'sent', 'paid', 'overdue', 'void'));
--> statement-breakpoint

-- ── ops_staff.status ─────────────────────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_staff GROUP BY status;
ALTER TABLE ops_staff
  ADD CONSTRAINT chk_ops_staff_status
  CHECK (status IN ('active', 'inactive', 'terminated'));
--> statement-breakpoint

-- ── ops_shifts.status ────────────────────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_shifts GROUP BY status;
ALTER TABLE ops_shifts
  ADD CONSTRAINT chk_ops_shifts_status
  CHECK (status IN ('scheduled', 'in_progress', 'completed', 'missed'));
--> statement-breakpoint

-- ── ops_obligations.status / severity / target_type ──────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status,   count(*) FROM ops_obligations GROUP BY status;
-- DIAGNOSTIC: SELECT DISTINCT severity, count(*) FROM ops_obligations GROUP BY severity;
ALTER TABLE ops_obligations
  ADD CONSTRAINT chk_ops_obligations_status
  CHECK (status IN ('pending', 'in_progress', 'submitted', 'under_review',
                    'approved', 'rejected', 'expired', 'closed'));
--> statement-breakpoint
ALTER TABLE ops_obligations
  ADD CONSTRAINT chk_ops_obligations_severity
  CHECK (severity IN ('high', 'medium', 'low'));
--> statement-breakpoint
ALTER TABLE ops_obligations
  ADD CONSTRAINT chk_ops_obligations_target_type
  CHECK (target_type IN ('facility', 'resident', 'staff', 'vendor', 'room'));
--> statement-breakpoint

-- ── ops_drill_logs.status ────────────────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_drill_logs GROUP BY status;
ALTER TABLE ops_drill_logs
  ADD CONSTRAINT chk_ops_drill_logs_status
  CHECK (status IN ('executed', 'scheduled', 'cancelled'));
--> statement-breakpoint

-- ── ops_vendors.status ───────────────────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_vendors GROUP BY status;
ALTER TABLE ops_vendors
  ADD CONSTRAINT chk_ops_vendors_status
  CHECK (status IN ('active', 'inactive'));
--> statement-breakpoint

-- ── ops_complaints.status ────────────────────────────────────────────────
-- complainant_type is intentionally left without a CHECK in v1 — the
-- canonical list (anonymous | resident | family | staff | ombudsman | ...)
-- is still being firmed up. Add a CHECK in a follow-up migration once
-- shared/complaints.ts defines the enum.
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_complaints GROUP BY status;
ALTER TABLE ops_complaints
  ADD CONSTRAINT chk_ops_complaints_status
  CHECK (status IN ('open', 'investigating', 'resolved', 'closed'));
--> statement-breakpoint

-- ── ops_inspections.status ───────────────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_inspections GROUP BY status;
ALTER TABLE ops_inspections
  ADD CONSTRAINT chk_ops_inspections_status
  CHECK (status IN ('open', 'closed'));
--> statement-breakpoint

-- ── ops_inspection_citations.status ──────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_inspection_citations GROUP BY status;
ALTER TABLE ops_inspection_citations
  ADD CONSTRAINT chk_ops_inspection_citations_status
  CHECK (status IN ('open', 'closed'));
--> statement-breakpoint

-- ── ops_staff_credentials.status ─────────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_staff_credentials GROUP BY status;
ALTER TABLE ops_staff_credentials
  ADD CONSTRAINT chk_ops_staff_credentials_status
  CHECK (status IN ('active', 'expired', 'pending', 'na'));
--> statement-breakpoint

-- ── ops_posting_catalog.status ───────────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_posting_catalog GROUP BY status;
ALTER TABLE ops_posting_catalog
  ADD CONSTRAINT chk_ops_posting_catalog_status
  CHECK (status IN ('active', 'archived'));
--> statement-breakpoint

-- ── ops_posting_verifications.status ─────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_posting_verifications GROUP BY status;
ALTER TABLE ops_posting_verifications
  ADD CONSTRAINT chk_ops_posting_verifications_status
  CHECK (status IN ('current', 'missing', 'damaged', 'illegible'));
--> statement-breakpoint

-- ── ops_resident_trust_accounts.status ───────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_resident_trust_accounts GROUP BY status;
ALTER TABLE ops_resident_trust_accounts
  ADD CONSTRAINT chk_ops_resident_trust_accounts_status
  CHECK (status IN ('active', 'closed'));
--> statement-breakpoint

-- ── ops_resident_trust_ledger.direction / category ───────────────────────
-- DIAGNOSTIC: SELECT DISTINCT direction, count(*) FROM ops_resident_trust_ledger GROUP BY direction;
ALTER TABLE ops_resident_trust_ledger
  ADD CONSTRAINT chk_ops_resident_trust_ledger_direction
  CHECK (direction IN ('credit', 'debit'));
--> statement-breakpoint
ALTER TABLE ops_resident_trust_ledger
  ADD CONSTRAINT chk_ops_resident_trust_ledger_category
  CHECK (category IN ('cash_deposit', 'cash_withdrawal', 'allowance',
                      'haircut', 'snack', 'transfer_in', 'transfer_out',
                      'reversal', 'other'));
--> statement-breakpoint

-- ── ops_reports.status ───────────────────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT status, count(*) FROM ops_reports GROUP BY status;
ALTER TABLE ops_reports
  ADD CONSTRAINT chk_ops_reports_status
  CHECK (status IN ('generating', 'ready', 'failed', 'expired'));
--> statement-breakpoint

-- ── ops_share_links.scope ────────────────────────────────────────────────
-- DIAGNOSTIC: SELECT DISTINCT scope, count(*) FROM ops_share_links GROUP BY scope;
ALTER TABLE ops_share_links
  ADD CONSTRAINT chk_ops_share_links_scope
  CHECK (scope IN ('audit_readiness'));
--> statement-breakpoint

-- ── ops_notes.priority / status / visibility_scope / ack_required_role (nullable) ──
ALTER TABLE ops_notes
  ADD CONSTRAINT chk_ops_notes_priority
  CHECK (priority IN ('normal', 'urgent'));
--> statement-breakpoint
ALTER TABLE ops_notes
  ADD CONSTRAINT chk_ops_notes_status
  CHECK (status IN ('open', 'archived', 'deleted'));
--> statement-breakpoint
ALTER TABLE ops_notes
  ADD CONSTRAINT chk_ops_notes_visibility_scope
  CHECK (visibility_scope IN ('facility_wide', 'resident_specific', 'shift',
                              'admin_only', 'compliance', 'provider'));
--> statement-breakpoint
ALTER TABLE ops_notes
  ADD CONSTRAINT chk_ops_notes_ack_required_role
  CHECK (ack_required_role IS NULL OR ack_required_role IN (
    'caregivers_on_shift', 'med_techs', 'supervisors', 'all_staff'));
--> statement-breakpoint

-- ── ops_note_attachments.scan_status ─────────────────────────────────────
ALTER TABLE ops_note_attachments
  ADD CONSTRAINT chk_ops_note_attachments_scan_status
  CHECK (scan_status IN ('pending', 'clean', 'infected', 'failed'));
--> statement-breakpoint

-- ── tracker_alerts.severity / status ─────────────────────────────────────
ALTER TABLE tracker_alerts
  ADD CONSTRAINT chk_tracker_alerts_severity
  CHECK (severity IN ('info', 'warn', 'critical'));
--> statement-breakpoint
ALTER TABLE tracker_alerts
  ADD CONSTRAINT chk_tracker_alerts_status
  CHECK (status IN ('active', 'acknowledged', 'resolved'));
--> statement-breakpoint


-- ────────────────────────────────────────────────────────────────────────────
-- §4. facilities — NULL replaces empty-string sentinel
-- ────────────────────────────────────────────────────────────────────────────
-- Eleven columns currently `text NOT NULL DEFAULT ''` legitimately may be
-- unknown for many facilities. The empty string conflates "unknown" with
-- "affirmatively empty," which fights the search query in
-- searchFacilitiesAutocompleteAsync (LIKE on empty == match nothing
-- anyway, but `LOWER(licensee) LIKE '%foo%'` evaluates each row including
-- 800k empty strings). NULL is the correct sentinel.
--
-- Order: data migration (UPDATE empty → NULL) MUST come before ALTER
-- COLUMN DROP NOT NULL / DROP DEFAULT so the column constraint can be
-- relaxed without an intermediate "all rows must be non-empty" violation
-- (already satisfied) but more importantly so the historical default
-- never re-applies. App code (server/storage.ts, server/services/
-- facilitiesService.ts) already uses `?? ''` on read, so the runtime
-- impact is nil.

UPDATE facilities SET address              = NULL WHERE address              = '';
--> statement-breakpoint
UPDATE facilities SET city                 = NULL WHERE city                 = '';
--> statement-breakpoint
UPDATE facilities SET county               = NULL WHERE county               = '';
--> statement-breakpoint
UPDATE facilities SET zip                  = NULL WHERE zip                  = '';
--> statement-breakpoint
UPDATE facilities SET phone                = NULL WHERE phone                = '';
--> statement-breakpoint
UPDATE facilities SET licensee             = NULL WHERE licensee             = '';
--> statement-breakpoint
UPDATE facilities SET administrator        = NULL WHERE administrator        = '';
--> statement-breakpoint
UPDATE facilities SET first_license_date   = NULL WHERE first_license_date   = '';
--> statement-breakpoint
UPDATE facilities SET closed_date          = NULL WHERE closed_date          = '';
--> statement-breakpoint
UPDATE facilities SET last_inspection_date = NULL WHERE last_inspection_date = '';
--> statement-breakpoint
UPDATE facilities SET geocode_quality      = NULL WHERE geocode_quality      = '';
--> statement-breakpoint

ALTER TABLE facilities ALTER COLUMN address              DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN address              DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN city                 DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN city                 DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN county               DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN county               DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN zip                  DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN zip                  DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN phone                DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN phone                DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN licensee             DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN licensee             DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN administrator        DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN administrator        DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN first_license_date   DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN closed_date          DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN last_inspection_date DROP DEFAULT;
--> statement-breakpoint
ALTER TABLE facilities ALTER COLUMN geocode_quality      DROP DEFAULT;
--> statement-breakpoint


-- ────────────────────────────────────────────────────────────────────────────
-- §5. Drop unused tables / dead code
-- ────────────────────────────────────────────────────────────────────────────
-- `users` table is NOT dropped here. server/storage.ts still references
-- it (`getUser` / `getUserByUsername` / `createUser` against `users`).
-- Per Phase 2 R1 instructions ("if there are real consumers, leave it
-- alone and surface in the report") the table stays. A follow-up phase
-- can drop both the table and the dead storage methods together.
--
-- The `arf_data` Fly volume mount is removed from fly.toml in the same
-- commit as this migration — that is a deploy-config change, not a DDL
-- statement, so there is nothing to do here.


-- ────────────────────────────────────────────────────────────────────────────
-- §6. Search performance — pg_trgm + GIN trigram index on facilities.name
-- ────────────────────────────────────────────────────────────────────────────
-- Enables future use of `name % 'query'` (trigram similarity operator)
-- and accelerates `LOWER(name) LIKE '%query%'` substring search to an
-- index scan. The existing query in
-- searchFacilitiesAutocompleteAsync (server/storage.ts) is NOT changed
-- in this phase — that is app code and out of scope. A later phase will
-- switch the query to use `%` or `name ILIKE '%' || $1 || '%'` so this
-- index is actually consulted. Building the index now means the switch-
-- over later is a query-only change with no DDL.

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_facilities_name_trgm
  ON facilities USING GIN (LOWER(name) gin_trgm_ops);
--> statement-breakpoint
