// shared/resident-trust.ts — W12 enums + small helpers.
//
// Lives in shared/ (alongside obligations.ts, postings.ts, etc.) so both
// the server (ledger inserts, reconciliation) and the future client UI
// (entry form, statement view) import the same constants.
//
// Money convention: trust balances are stored as BIGINT cents in the DB
// and represented as `number` cents in TypeScript. This is divergent from
// the ops_billing_* tables which use DOUBLE PRECISION — see the DDL
// comment in server/ops/opsSchema.ts for the rationale (reconciliation
// needs bit-exact integer arithmetic).

export const TRUST_LEDGER_DIRECTIONS = ["credit", "debit"] as const;
export type TrustLedgerDirection = (typeof TRUST_LEDGER_DIRECTIONS)[number];

export const TRUST_LEDGER_CATEGORIES = [
  "cash_deposit",
  "cash_withdrawal",
  "allowance",
  "haircut",
  "snack",
  "transfer_in",
  "transfer_out",
  "reversal",
  "other",
] as const;
export type TrustLedgerCategory = (typeof TRUST_LEDGER_CATEGORIES)[number];

export const TRUST_LEDGER_CATEGORY_LABELS: Record<TrustLedgerCategory, string> = {
  cash_deposit: "Cash deposit",
  cash_withdrawal: "Cash withdrawal",
  allowance: "Allowance",
  haircut: "Haircut / personal care",
  snack: "Snack / vending",
  transfer_in: "Transfer in",
  transfer_out: "Transfer out",
  reversal: "Reversal",
  other: "Other",
};

export const TRUST_ACCOUNT_STATUSES = ["active", "closed"] as const;
export type TrustAccountStatus = (typeof TRUST_ACCOUNT_STATUSES)[number];

/** Stored as integer cents; helpers keep formatting consistent. */
export function centsToDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100);
  const remainder = abs % 100;
  return `${sign}$${dollars.toLocaleString()}.${String(remainder).padStart(2, "0")}`;
}

/** Parse "12.34" / "12" / "$12.34" → integer cents. Returns null on bad input. */
export function dollarsToCents(input: string): number | null {
  const trimmed = input.trim().replace(/^\$/, "");
  if (!trimmed) return null;
  const m = trimmed.match(/^(\d+)(?:\.(\d{1,2}))?$/);
  if (!m) return null;
  const dollars = parseInt(m[1], 10);
  const cents = m[2] ? parseInt(m[2].padEnd(2, "0"), 10) : 0;
  if (!Number.isFinite(dollars) || !Number.isFinite(cents)) return null;
  return dollars * 100 + cents;
}

/** Signed delta for a ledger entry (credit positive, debit negative). */
export function signedDeltaCents(direction: TrustLedgerDirection, amountCents: number): number {
  return direction === "credit" ? amountCents : -amountCents;
}

/** Default state machine for closing an account: only when balance is exactly 0. */
export function canCloseAccount(balanceCents: number): boolean {
  return balanceCents === 0;
}
