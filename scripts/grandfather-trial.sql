-- =============================================================================
-- One-off: grant a 30-day trial to all existing facility accounts on Operations
-- paywall launch day.
--
-- Run this AFTER the bootstrap has added the subscription_status column (i.e.
-- after at least one deploy of the Phase 0 schema change has booted), but
-- BEFORE flipping the Operations paywall gate live in the app.
--
-- Idempotent: only updates accounts that don't already have a status set, so
-- re-running it on launch day is safe — it won't overwrite any subscription
-- that was already created (e.g. a test account that signed up via Stripe).
--
-- This script is NOT auto-run by the application. Devops executes it manually
-- as part of the launch-day runbook.
-- =============================================================================

UPDATE facility_accounts
SET subscription_status = 'trialing',
    subscription_current_period_end = (EXTRACT(EPOCH FROM NOW()) * 1000 + (30 * 24 * 60 * 60 * 1000))::BIGINT
WHERE subscription_status IS NULL;

-- Verify before exiting:
-- SELECT COUNT(*) FROM facility_accounts WHERE subscription_status = 'trialing';
