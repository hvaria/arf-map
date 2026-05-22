/**
 * Phase 2 R2 — facility billing money-in-cents smoke test.
 *
 * Verifies that the storage layer (opsStorage) treats money columns as
 * BIGINT cents end-to-end through a single round-trip:
 *
 *   1. createCharge with amount=12345 cents ($123.45)  ─ store as 12345
 *   2. generateInvoice                                  ─ subtotal=12345
 *   3. recordPayment with amount=2345 cents ($23.45)    ─ store as 2345
 *      → invoice.amountPaid=2345, balanceDue=10000      ($100.00)
 *
 * Conversion to/from dollars happens at the route boundary
 * (server/ops/opsRouter.ts via server/lib/money.ts). Storage never
 * converts. This test asserts storage cents-in / cents-out invariants
 * AND the helper round-trip (dollarsToCents -> centsToDollars).
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import {
  bootstrapOpsSchema,
  createCharge,
  generateInvoice,
  getInvoice,
  recordPayment,
} from "../../ops/opsStorage";
import { centsToDollars, dollarsToCents } from "../../lib/money";

const FACILITY = "TEST-FAC-MONEY-CENTS";
const RESIDENT = 9_400_001;

async function cleanup(): Promise<void> {
  await pool.query(`DELETE FROM ops_payments         WHERE facility_number = $1`, [FACILITY]);
  await pool.query(`DELETE FROM ops_invoices         WHERE facility_number = $1`, [FACILITY]);
  await pool.query(`DELETE FROM ops_billing_charges  WHERE facility_number = $1`, [FACILITY]);
}

beforeAll(async () => {
  await bootstrapMainSchema();
  await bootstrapOpsSchema();
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

beforeEach(async () => {
  await cleanup();
});

describe("money helpers", () => {
  it("dollarsToCents rounds half-away-from-zero (12.345 -> 1235)", () => {
    expect(dollarsToCents(12.345)).toBe(1235);
    expect(dollarsToCents(0)).toBe(0);
    expect(dollarsToCents(100)).toBe(10000);
  });

  it("centsToDollars is the exact inverse on whole-cent values", () => {
    expect(centsToDollars(12345)).toBe(123.45);
    expect(centsToDollars(0)).toBe(0);
    expect(centsToDollars(10000)).toBe(100);
  });
});

describe("Phase 2 R2 — billing storage uses BIGINT cents", () => {
  it("charge → invoice → payment round-trips cents without float drift", async () => {
    const now = Date.now();
    const periodStart = now - 30 * 86_400_000;
    const periodEnd   = now;

    // 1) Create a charge for $123.45 — stored as integer cents.
    const charge = await createCharge({
      facilityNumber: FACILITY,
      residentId:     RESIDENT,
      chargeType:     "care_level",
      description:    "Care services — May 2026",
      amount:         12345,           // 12345 cents = $123.45
      quantity:       1,
      billingPeriodStart: periodStart,
      billingPeriodEnd:   periodEnd,
      source:         "manual",
      createdAt:      now,
    });
    expect(charge.amount).toBe(12345);
    expect(Number.isInteger(charge.amount)).toBe(true);

    // 2) Generate an invoice — subtotal/total are integer cents = 12345.
    const invoice = await generateInvoice(FACILITY, RESIDENT, periodStart, periodEnd);
    expect(invoice.subtotal).toBe(12345);
    expect(invoice.tax).toBe(0);
    expect(invoice.total).toBe(12345);
    expect(invoice.amountPaid).toBe(0);
    expect(invoice.balanceDue).toBe(12345);
    for (const v of [invoice.subtotal, invoice.total, invoice.amountPaid, invoice.balanceDue]) {
      expect(Number.isInteger(v)).toBe(true);
    }

    // 3) Record a partial payment of $23.45 — invoice should reflect cents.
    await recordPayment({
      invoiceId:      invoice.id,
      facilityNumber: FACILITY,
      residentId:     RESIDENT,
      amount:         2345,            // 2345 cents = $23.45
      paymentDate:    now,
      paymentMethod:  "cash",
      type:           "payment",
      createdAt:      now,
    });

    const after = await getInvoice(invoice.id);
    expect(after).toBeDefined();
    expect(after?.amountPaid).toBe(2345);
    expect(after?.balanceDue).toBe(10000);
    // Confirmed: $100.00 outstanding, computed entirely in integer cents.
    expect(after?.status).toBe("sent");
  });

  it("fractional quantity × cents stays integer after ROUND in generateInvoice", async () => {
    const now = Date.now();
    const periodStart = now - 7 * 86_400_000;
    const periodEnd   = now;

    // 0.1 hour × $25.55 = $2.555 → rounds to 256 cents ($2.56) — not 255.5.
    await createCharge({
      facilityNumber: FACILITY,
      residentId:     RESIDENT,
      chargeType:     "extra_service",
      description:    "Short outing",
      amount:         2555,           // 2555 cents per unit = $25.55
      quantity:       0.1,
      billingPeriodStart: periodStart,
      billingPeriodEnd:   periodEnd,
      source:         "manual",
      createdAt:      now,
    });

    const invoice = await generateInvoice(FACILITY, RESIDENT, periodStart, periodEnd);
    expect(Number.isInteger(invoice.subtotal)).toBe(true);
    expect(invoice.subtotal).toBe(256);    // ROUND(2555 * 0.1) = 256
    expect(invoice.total).toBe(256);
    expect(invoice.balanceDue).toBe(256);
  });
});
