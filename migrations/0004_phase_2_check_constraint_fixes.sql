-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 R1 follow-up: extend CHECK constraints to match storage reality
-- ─────────────────────────────────────────────────────────────────────────
-- The structural-lockdown migration (0001) added CHECK constraints sourced
-- from canonical Zod enums, but two columns had storage-layer status values
-- that were NOT in those enums:
--
--   ops_drill_logs.status — storage writes 'deleted' (soft delete) and
--     'completed' (debrief filed). 0001 only allowed
--     ('executed','scheduled','cancelled'), so soft-delete and
--     debrief-completion would 500 in production.
--
--   ops_vendors.status    — storage writes 'archived' (archiveVendor
--     terminal state). 0001 only allowed ('active','inactive'), so the
--     vendor archive surface would 500.
--
-- This migration drops and re-creates the two CHECK constraints with the
-- full storage-reality value set. CI didn't catch the mismatch because
-- bootstrapOpsSchema does not apply CHECK constraints in dev/test DBs.
-- ─────────────────────────────────────────────────────────────────────────

-- ops_drill_logs.status: allow soft-delete + debrief-completion.
-- DIAGNOSTIC (run before applying if you want to verify): the new allowlist
-- is a superset of the old, so this migration cannot reject any row that
-- already passed the old check.
ALTER TABLE ops_drill_logs DROP CONSTRAINT IF EXISTS chk_ops_drill_logs_status;
ALTER TABLE ops_drill_logs
  ADD CONSTRAINT chk_ops_drill_logs_status
  CHECK (status IN ('executed', 'scheduled', 'cancelled', 'completed', 'deleted'));

-- ops_vendors.status: allow 'archived' (archiveVendor terminal state).
ALTER TABLE ops_vendors DROP CONSTRAINT IF EXISTS chk_ops_vendors_status;
ALTER TABLE ops_vendors
  ADD CONSTRAINT chk_ops_vendors_status
  CHECK (status IN ('active', 'inactive', 'archived'));
