/**
 * Money conversion helpers.
 *
 * Canonical storage format for facility billing money columns
 * (ops_invoices.*, ops_billing_charges.amount, ops_payments.amount,
 * ops_resident_trust_*) is BIGINT cents — an integer count of the smallest
 * currency unit. This guarantees bit-exact arithmetic across additions and
 * reconciliation queries; floats drift.
 *
 * The wire / UI format is dollars (a JS number). Conversion is done at the
 * route boundary — handlers parse the request body, convert dollars → cents
 * before calling storage, and convert cents → dollars before serializing
 * the response. Storage layer is cents end-to-end and never converts.
 *
 * Never round in storage. Always round in `dollarsToCents` so that user
 * input like 12.345 is captured as 1235 cents (banker's rounding is not
 * needed here — Math.round is half-away-from-zero, which matches every
 * other place in the codebase that converts user dollars).
 */

export const dollarsToCents = (dollars: number): number =>
  Math.round(dollars * 100);

export const centsToDollars = (cents: number): number => cents / 100;
