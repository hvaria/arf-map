/**
 * W9 Vendors — server storage tests.
 *
 * Coverage:
 *  - expiringWithinDays filter is correct across BOTH coi_expires_at AND
 *    license_expires_at (whichever is earliest qualifies).
 *  - Vendors with no expiry dates at all are NOT returned by the expiring filter.
 *  - archive transitions: active → archived; archived rows hidden by default.
 *  - Update rejects unknown status values.
 *  - Tenant isolation.
 */

import "dotenv/config";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { pool } from "../../db/index";
import { bootstrapMainSchema } from "../../db/bootstrap";
import {
  archiveVendor,
  bootstrapOpsSchema,
  createVendor,
  listVendors,
  updateVendor,
} from "../../ops/opsStorage";

const FACILITY_A = "TEST-FAC-VND-A";
const FACILITY_B = "TEST-FAC-VND-B";
const ALL_FN = [FACILITY_A, FACILITY_B] as const;
const ACTOR = { id: "alice", role: "admin" };

async function cleanup(): Promise<void> {
  await pool.query(
    `DELETE FROM ops_vendors     WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
  await pool.query(
    `DELETE FROM ops_audit_trail WHERE facility_number = ANY($1::text[])`,
    [[...ALL_FN]],
  );
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

const DAY = 24 * 60 * 60 * 1000;

async function seedVendor(
  facilityNumber: string,
  overrides: Partial<{
    vendorName: string;
    vendorType: string;
    coiExpiresAt: number | null;
    licenseExpiresAt: number | null;
  }>,
) {
  return createVendor(
    {
      facilityNumber,
      vendorName: overrides.vendorName ?? "Acme Co",
      vendorType: overrides.vendorType ?? "pharmacy",
      contactName: null,
      contactPhone: null,
      contactEmail: null,
      coiExpiresAt: overrides.coiExpiresAt ?? null,
      licenseExpiresAt: overrides.licenseExpiresAt ?? null,
      notes: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    ACTOR,
  );
}

describe("vendors — expiringWithinDays filter", () => {
  it("includes vendors whose COI expires inside the window", async () => {
    const soon = Date.now() + 10 * DAY;
    const farFuture = Date.now() + 200 * DAY;
    await seedVendor(FACILITY_A, { vendorName: "COI-soon", coiExpiresAt: soon });
    await seedVendor(FACILITY_A, { vendorName: "COI-later", coiExpiresAt: farFuture });

    const r = await listVendors(FACILITY_A, { expiringWithinDays: 30, page: 1, limit: 50 });
    expect(r.total).toBe(1);
    expect(r.vendors[0].vendorName).toBe("COI-soon");
  });

  it("includes vendors whose LICENSE expires inside the window (even if COI is far out)", async () => {
    const soonLic = Date.now() + 5 * DAY;
    const farCoi = Date.now() + 500 * DAY;
    await seedVendor(FACILITY_A, {
      vendorName: "License-soon",
      coiExpiresAt: farCoi,
      licenseExpiresAt: soonLic,
    });
    await seedVendor(FACILITY_A, { vendorName: "License-none" });

    const r = await listVendors(FACILITY_A, { expiringWithinDays: 30, page: 1, limit: 50 });
    expect(r.total).toBe(1);
    expect(r.vendors[0].vendorName).toBe("License-soon");
  });

  it("excludes vendors whose neither COI nor license fall in window", async () => {
    await seedVendor(FACILITY_A, {
      vendorName: "All-clear",
      coiExpiresAt: Date.now() + 365 * DAY,
      licenseExpiresAt: Date.now() + 365 * DAY,
    });
    await seedVendor(FACILITY_A, { vendorName: "No-dates" });
    const r = await listVendors(FACILITY_A, { expiringWithinDays: 30, page: 1, limit: 50 });
    expect(r.total).toBe(0);
  });

  it("respects vendorType in combination with expiringWithinDays", async () => {
    const soon = Date.now() + 5 * DAY;
    await seedVendor(FACILITY_A, { vendorName: "Pharm-A", vendorType: "pharmacy", coiExpiresAt: soon });
    await seedVendor(FACILITY_A, { vendorName: "HVAC-B", vendorType: "hvac", coiExpiresAt: soon });

    const r = await listVendors(FACILITY_A, {
      expiringWithinDays: 30,
      vendorType: "pharmacy",
      page: 1,
      limit: 50,
    });
    expect(r.total).toBe(1);
    expect(r.vendors[0].vendorName).toBe("Pharm-A");
  });
});

describe("vendors — archive transitions", () => {
  it("archiveVendor sets status='archived' and hides from default list", async () => {
    const v = await seedVendor(FACILITY_A, { vendorName: "X" });
    const archived = await archiveVendor(v.id, FACILITY_A, ACTOR);
    expect(archived?.status).toBe("archived");

    const defaultList = await listVendors(FACILITY_A, { page: 1, limit: 50 });
    expect(defaultList.total).toBe(0);

    const archivedList = await listVendors(FACILITY_A, { status: "archived", page: 1, limit: 50 });
    expect(archivedList.total).toBe(1);
  });

  it("update rejects unknown status values", async () => {
    const v = await seedVendor(FACILITY_A, { vendorName: "X" });
    await expect(
      updateVendor(v.id, FACILITY_A, { status: "junk" }, ACTOR),
    ).rejects.toThrow(/Invalid vendor status/i);
  });

  it("archive is idempotent (re-archive returns same row)", async () => {
    const v = await seedVendor(FACILITY_A, { vendorName: "X" });
    await archiveVendor(v.id, FACILITY_A, ACTOR);
    const again = await archiveVendor(v.id, FACILITY_A, ACTOR);
    expect(again?.status).toBe("archived");
  });
});

describe("vendors — tenant isolation", () => {
  it("facility A vendors are invisible to facility B", async () => {
    await seedVendor(FACILITY_A, { vendorName: "A-only" });
    const bView = await listVendors(FACILITY_B, { page: 1, limit: 50 });
    expect(bView.total).toBe(0);
  });
});
