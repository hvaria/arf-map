-- ============================================================================
-- Phase 4 — Legal acceptance log + CCPA / data-subject request queue
-- ============================================================================
-- This migration lands two new tables that together carry the legal +
-- privacy hardening introduced in Phase 4:
--
--   1) `legal_acceptances` — one row per (account, document, version)
--      clickwrap acceptance. Two-tenant (facility + job_seeker) because the
--      same Terms / Privacy / AUP version applies to both portals and we
--      want a single immutable log to defend against "I never agreed".
--      Re-prompts on version bump: a fresh row is required for every new
--      version string, and `getPendingAcceptances` returns any document
--      whose CURRENT version has no acceptance row yet.
--
--   2) `account_data_requests` — append-mostly queue for CCPA-style data
--      subject requests (export, delete) and the OTP-gated email-change
--      flow. Status is mutable (pending → fulfilled | cancelled); the
--      `set_updated_at_epoch_ms` trigger from Phase 3 keeps `updated_at`
--      honest. `payload_json` carries the email-change new-address + OTP
--      state so we never store an in-flight email on the live account row.
--
-- Run order: legal_acceptances first (no dependencies), then
-- account_data_requests + its updated_at trigger.
-- ============================================================================


-- ────────────────────────────────────────────────────────────────────────────
-- §1. `legal_acceptances` — clickwrap acceptance log
-- ────────────────────────────────────────────────────────────────────────────
-- Immutable / append-only. The CHECK constraints lock the small enums in the
-- DB so a buggy writer cannot poison the audit trail with novel values; the
-- canonical lists still live in code (`shared/legal.ts`).
--
-- The UNIQUE index on (account_kind, account_id, document, version) makes
-- `recordAcceptance` idempotent — re-posting the same accept payload is a
-- no-op via `ON CONFLICT DO NOTHING`, which we rely on so the FE can safely
-- replay an accept on a flaky network without duplicate audit rows.
--
-- We deliberately do NOT add a foreign key to facility_accounts /
-- job_seeker_accounts: a tombstoned account must keep its acceptance
-- history (legal defense survives account deletion).

CREATE TABLE IF NOT EXISTS legal_acceptances (
  id                     BIGSERIAL PRIMARY KEY,
  account_kind           TEXT NOT NULL CHECK (account_kind IN ('facility', 'job_seeker')),
  account_id             INTEGER NOT NULL,
  document               TEXT NOT NULL CHECK (document IN ('terms', 'privacy', 'aup')),
  version                TEXT NOT NULL,
  accepted_at            BIGINT NOT NULL,
  accepted_ip            TEXT,
  accepted_user_agent    TEXT
);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS uniq_legal_acceptances_account_doc_version
  ON legal_acceptances(account_kind, account_id, document, version);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_legal_acceptances_account
  ON legal_acceptances(account_kind, account_id);
--> statement-breakpoint


-- ────────────────────────────────────────────────────────────────────────────
-- §2. `account_data_requests` — CCPA + email-change queue
-- ────────────────────────────────────────────────────────────────────────────
-- One row per request. `kind` partitions the three flows:
--   - 'export'       — CCPA right-to-know. Operator fulfills manually.
--   - 'delete'       — CCPA right-to-delete. Operator fulfills manually.
--   - 'email_change' — User-initiated email change. Auto-fulfilled when the
--                      OTP in payload_json is verified by the user.
--
-- `status` lifecycle: pending → fulfilled | cancelled. Once `fulfilled` /
-- `cancelled` the row is terminal — corrections are a NEW row, not an
-- UPDATE. (The trigger still fires on edits to `notes` etc., which is fine.)
--
-- `payload_json` is JSONB so the email-change flow can store
-- { newEmail, otpHash, otpExpiry } without a parallel table. The shape is
-- enforced by the application Zod schema, not by the DB.
--
-- The partial index on pending requests is the hot path for the operator
-- dashboard ("show me everything still open").

CREATE TABLE IF NOT EXISTS account_data_requests (
  id              BIGSERIAL PRIMARY KEY,
  account_kind    TEXT NOT NULL CHECK (account_kind IN ('facility', 'job_seeker')),
  account_id      INTEGER NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('export', 'delete', 'email_change')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'fulfilled', 'cancelled')),
  requested_at    BIGINT NOT NULL,
  requested_ip    TEXT,
  fulfilled_at    BIGINT,
  fulfilled_by    TEXT,
  notes           TEXT,
  payload_json    JSONB,
  created_at      BIGINT NOT NULL,
  updated_at      BIGINT NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_account_data_requests_account
  ON account_data_requests(account_kind, account_id, requested_at DESC);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_account_data_requests_pending
  ON account_data_requests(kind, status) WHERE status = 'pending';
--> statement-breakpoint


-- ────────────────────────────────────────────────────────────────────────────
-- §3. updated_at trigger (reuses set_updated_at_epoch_ms from Phase 3)
-- ────────────────────────────────────────────────────────────────────────────
-- The trigger function was created in migration 0005 and stays installed
-- across this migration. We only add the per-table trigger row here.

DROP TRIGGER IF EXISTS trg_account_data_requests_updated_at ON account_data_requests;
CREATE TRIGGER trg_account_data_requests_updated_at BEFORE UPDATE ON account_data_requests
  FOR EACH ROW EXECUTE FUNCTION set_updated_at_epoch_ms();
--> statement-breakpoint
