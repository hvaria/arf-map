-- Phase 2 R2 — Convert facility billing money columns to BIGINT cents.
--
-- Previously: DOUBLE PRECISION dollars across ops_invoices,
-- ops_billing_charges.amount, and ops_payments.amount. Float for money
-- drifts over time and is incorrect for any accounting surface. The
-- ops_resident_trust_* tables already use BIGINT cents; this migration
-- aligns facility billing to the same canonical integer-cents storage.
--
-- Wire/UI format stays in dollars — conversion happens at the route
-- boundary via server/lib/money.ts (dollarsToCents / centsToDollars).
-- The Drizzle TS definitions in server/ops/opsSchema.ts mirror this
-- migration (bigint(..., { mode: "number" })).
--
-- Strategy: single ALTER COLUMN ... TYPE BIGINT USING ROUND(col * 100)
-- per column. PostgreSQL rewrites the column in place inside the implicit
-- transaction (DDL inside a migration runs in a tx; partial failure
-- rolls back cleanly). Pre-production — downtime is acceptable; not
-- using expand-migrate-contract.
--
-- ops_billing_charges.quantity is intentionally LEFT AS DOUBLE PRECISION
-- because it represents fractional units (e.g. 1.5 hours of care), not
-- money. Only the per-unit `amount` is money.

BEGIN;

-- ── ops_invoices ──────────────────────────────────────────────────────────
ALTER TABLE ops_invoices
  ALTER COLUMN subtotal    TYPE BIGINT USING ROUND(subtotal    * 100)::BIGINT,
  ALTER COLUMN tax         TYPE BIGINT USING ROUND(tax         * 100)::BIGINT,
  ALTER COLUMN total       TYPE BIGINT USING ROUND(total       * 100)::BIGINT,
  ALTER COLUMN amount_paid TYPE BIGINT USING ROUND(amount_paid * 100)::BIGINT,
  ALTER COLUMN balance_due TYPE BIGINT USING ROUND(balance_due * 100)::BIGINT;

-- Defaults are reset by ALTER COLUMN TYPE; re-establish them (all 0 cents).
ALTER TABLE ops_invoices
  ALTER COLUMN subtotal    SET DEFAULT 0,
  ALTER COLUMN tax         SET DEFAULT 0,
  ALTER COLUMN total       SET DEFAULT 0,
  ALTER COLUMN amount_paid SET DEFAULT 0,
  ALTER COLUMN balance_due SET DEFAULT 0;

-- ── ops_billing_charges ───────────────────────────────────────────────────
-- amount only. quantity stays DOUBLE PRECISION (fractional units).
ALTER TABLE ops_billing_charges
  ALTER COLUMN amount TYPE BIGINT USING ROUND(amount * 100)::BIGINT;

-- ── ops_payments ──────────────────────────────────────────────────────────
ALTER TABLE ops_payments
  ALTER COLUMN amount TYPE BIGINT USING ROUND(amount * 100)::BIGINT;

COMMIT;
