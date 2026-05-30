-- ─────────────────────────────────────────────────────────────────────────────
-- Phase — Applicant Profile Review
--
-- Lets a facility open an applicant's full profile from the Applicants tab, with
-- recruiter-only internal notes and an append-only status-change history. Two
-- new facility-side, per-interest tables, plus a wider status enum.
--
-- Hand-authored (not drizzle-kit generate): the generate snapshot is stale
-- relative to the live schema, and this migration carries CHECK / composite-FK /
-- trigger SQL that does not live in the Drizzle column defs (repo convention —
-- cf. migrations/0001..0008). db:migrate applies it via the journal entry.
--
-- Invariants honored:
--   • Phase 2 — composite FK against (id, facility_number) so a child can never
--     reference an interest in another tenant; enum-like TEXT column gets a CHECK.
--   • Phase 3 — applicant_status_history is append-only (created_by only, no
--     updated_*/trigger); applicant_notes gets the updated_at trigger.
--   • Phase 7 — applicant_notes is URL-addressed via external_id (nanoid(12));
--     soft-delete (deleted_at/deleted_by) because notes are audit-grade.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── Status enum: add 'rejected' + 'archived' ────────────────────────────────
-- applicant_interests.status had no CHECK historically (enforced only in zod).
-- Add one now with the full 5-value set. All existing rows are pending/viewed/
-- shortlisted, so the constraint validates cleanly with no backfill. DROP-then-
-- ADD keeps this re-runnable and is the pattern for future value changes.
ALTER TABLE applicant_interests
  DROP CONSTRAINT IF EXISTS applicant_interests_status_check;
ALTER TABLE applicant_interests
  ADD CONSTRAINT applicant_interests_status_check
  CHECK (status IN ('pending', 'viewed', 'shortlisted', 'rejected', 'archived'));

-- ── Composite UNIQUE target for the child FKs ───────────────────────────────
-- id is already the PK (unique on its own); this composite UNIQUE exists purely
-- so the two child tables can FK against (id, facility_number) for DB-level
-- tenant integrity (Phase 2 pattern).
ALTER TABLE applicant_interests
  DROP CONSTRAINT IF EXISTS applicant_interests_id_facility_number_unique;
ALTER TABLE applicant_interests
  ADD CONSTRAINT applicant_interests_id_facility_number_unique
  UNIQUE (id, facility_number);

-- ── applicant_status_history (append-only) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS applicant_status_history (
  id              SERIAL PRIMARY KEY,
  interest_id     INTEGER NOT NULL,
  facility_number TEXT NOT NULL,
  from_status     TEXT,
  to_status       TEXT NOT NULL,
  changed_by      TEXT DEFAULT 'system',
  note            TEXT,
  created_at      BIGINT NOT NULL,
  CONSTRAINT applicant_status_history_interest_fk
    FOREIGN KEY (interest_id, facility_number)
    REFERENCES applicant_interests (id, facility_number)
    ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_applicant_status_history_interest
  ON applicant_status_history (interest_id, created_at DESC);

-- ── applicant_notes (soft-delete, audited, external_id) ─────────────────────
CREATE TABLE IF NOT EXISTS applicant_notes (
  id              SERIAL PRIMARY KEY,
  external_id     TEXT NOT NULL,
  interest_id     INTEGER NOT NULL,
  facility_number TEXT NOT NULL,
  body            TEXT NOT NULL,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL,
  created_by      TEXT DEFAULT 'system',
  updated_by      TEXT DEFAULT 'system',
  deleted_at      BIGINT,
  deleted_by      TEXT,
  CONSTRAINT applicant_notes_interest_fk
    FOREIGN KEY (interest_id, facility_number)
    REFERENCES applicant_interests (id, facility_number)
    ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_applicant_notes_external_id
  ON applicant_notes (external_id);
-- Live (non-deleted) notes per interest, newest first — the list read path.
CREATE INDEX IF NOT EXISTS idx_applicant_notes_interest_live
  ON applicant_notes (interest_id, created_at DESC) WHERE deleted_at IS NULL;

-- updated_at trigger (function defined in Phase 3 / opsSchema; replicate
-- defensively in case this migration runs before that function exists).
CREATE OR REPLACE FUNCTION set_updated_at_epoch_ms() RETURNS TRIGGER AS $func$
BEGIN
  NEW.updated_at = (EXTRACT(EPOCH FROM NOW()) * 1000)::BIGINT;
  RETURN NEW;
END;
$func$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_applicant_notes_updated_at ON applicant_notes;
CREATE TRIGGER trg_applicant_notes_updated_at BEFORE UPDATE ON applicant_notes
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
