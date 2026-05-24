-- ============================================================================
-- Phase 5 — Bypass-code redemption audit table
-- ============================================================================
-- The `OPERATIONS_BYPASS_CODES` env var lets the owner comp facilities to
-- `subscription_status = 'active'` without going through Stripe. Phase 1 only
-- logged the redemption to console; this migration adds a durable audit row so
-- the operator dashboard can answer "which codes have been redeemed, by whom,
-- when, and is the code still active?" without scraping logs.
--
-- Single-use-per-account is enforced at the DB level via a partial UNIQUE
-- index on (account_id) WHERE revoked_at IS NULL. The route translates the
-- 23505 duplicate-key error into a clean 409 BYPASS_ALREADY_REDEEMED.
--
-- Privacy: we deliberately store only the FIRST 8 CHARS of the code
-- (`code_prefix`). Logs may flow to aggregators, so the full code is never
-- persisted. The prefix is enough for an operator to correlate with the
-- configured env-var list, and short enough that revealing it does not
-- materially weaken the brute-force surface.
--
-- Foreign key to facility_accounts uses ON DELETE CASCADE because if the
-- account is hard-deleted (CCPA), the redemption history is meaningless
-- without an account to apply it to. (The legal_acceptances table makes the
-- opposite choice because legal defense survives deletion — different
-- compliance regime, different tradeoff.)
-- ============================================================================

CREATE TABLE IF NOT EXISTS billing_bypass_redemptions (
  id                    BIGSERIAL PRIMARY KEY,
  -- First 8 chars of the submitted code; never the full code.
  code_prefix           TEXT NOT NULL,
  account_id            INTEGER NOT NULL REFERENCES facility_accounts(id) ON DELETE CASCADE,
  redeemed_at           BIGINT NOT NULL,
  redeemed_ip           TEXT,
  redeemed_user_agent   TEXT,
  -- nullable: null = no expiry (owner-issued perpetual comp).
  expires_at            BIGINT,
  -- nullable: null = active. Setting revoked_at re-opens the unique index
  -- slot below, allowing the account to redeem again.
  revoked_at            BIGINT,
  revoked_by            TEXT,
  notes                 TEXT,
  created_at            BIGINT NOT NULL,
  updated_at            BIGINT NOT NULL
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS idx_bypass_redemptions_account
  ON billing_bypass_redemptions(account_id, redeemed_at DESC);
--> statement-breakpoint

-- Partial UNIQUE enforces "at most one ACTIVE redemption per account".
-- A revoked row (revoked_at IS NOT NULL) drops out of the index so the same
-- account can redeem a fresh code without manually deleting history.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_bypass_redemptions_account_active
  ON billing_bypass_redemptions(account_id) WHERE revoked_at IS NULL;
--> statement-breakpoint
