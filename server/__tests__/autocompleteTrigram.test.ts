/**
 * Phase 9 — autocomplete trigram-index regression suite.
 *
 * Locks down the contract of searchFacilitiesAutocompleteAsync:
 *
 *   - Substring case-insensitive match on `name` (most common typeahead
 *     path; covered by idx_facilities_name_trgm).
 *   - Substring case-insensitive match on `city` (Phase 9 added
 *     idx_facilities_city_trgm so this branch can use the index).
 *   - Substring exact-case match on `number` (Phase 9 added
 *     idx_facilities_number_trgm; facility numbers are numeric strings
 *     so casing is moot, but the LIKE pattern itself is exact-case).
 *   - LIMIT cap respected.
 *
 * The actual EXPLAIN ANALYZE check (verifying the trigram indexes are
 * being used, not seqscanned) lives in the perf-tuning runbook —
 * unit tests aren't the right place to assert query plans, because the
 * planner reasonably picks seqscan on a small test dataset where
 * index overhead would dominate.
 *
 * If the local DB is unreachable, the entire suite skips with a
 * console.warn rather than failing — matches the pattern in
 * health.test.ts. Production CI runs against a real DB so the
 * coverage is preserved.
 */

import "dotenv/config";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pool } from "../db/index";
import { bootstrapMainSchema } from "../db/bootstrap";
import { searchFacilitiesAutocompleteAsync } from "../storage";

const TEST_PREFIX = "TEST-AUTOCMP";
const FIXTURES = [
  {
    number: `${TEST_PREFIX}-001`,
    name: "Sunrise Senior Care Of Berkeley",
    city: "Berkeley",
    county: "Alameda",
    facility_type: "RCFE",
  },
  {
    number: `${TEST_PREFIX}-002`,
    name: "Pacific Oaks Residential Home",
    city: "Oakland",
    county: "Alameda",
    facility_type: "RCFE",
  },
  {
    number: `${TEST_PREFIX}-003`,
    name: "Sunset Vista Adult Residential Facility",
    city: "San Francisco",
    county: "San Francisco",
    facility_type: "ARF",
  },
];

let dbReachable = false;

async function cleanFixtures(): Promise<void> {
  await pool.query(`DELETE FROM facilities WHERE number LIKE $1`, [
    `${TEST_PREFIX}-%`,
  ]);
}

beforeAll(async () => {
  try {
    await pool.query("SELECT 1");
    dbReachable = true;
  } catch {
    dbReachable = false;
    return;
  }
  await bootstrapMainSchema();
  await cleanFixtures();
  const now = Date.now();
  for (const f of FIXTURES) {
    await pool.query(
      `INSERT INTO facilities
         (number, name, facility_type, facility_group, county, address, city,
          zip, phone, licensee, administrator, status, capacity,
          first_license_date, closed_date, last_inspection_date,
          total_visits, total_type_b, citations, lat, lng,
          geocode_quality, updated_at)
       VALUES ($1, $2, $3, NULL, $4, NULL, $5, NULL, NULL, NULL, NULL,
               'ACTIVE', 6, NULL, NULL, NULL, 0, 0, NULL, NULL, NULL,
               NULL, $6)`,
      [f.number, f.name, f.facility_type, f.county, f.city, now],
    );
  }
});

afterAll(async () => {
  if (dbReachable) await cleanFixtures();
  await pool.end();
});

describe("Phase 9 — searchFacilitiesAutocompleteAsync", () => {
  it("returns matches by name (substring, case-insensitive)", async () => {
    if (!dbReachable) {
      console.warn("Skipping: DB unreachable");
      return;
    }
    const rows = await searchFacilitiesAutocompleteAsync("sunrise", 10);
    const numbers = rows.map((r) => r.number);
    expect(numbers).toContain(`${TEST_PREFIX}-001`);
  });

  it("returns matches by name with mixed case input", async () => {
    if (!dbReachable) return;
    const rows = await searchFacilitiesAutocompleteAsync("SUNRISE", 10);
    expect(rows.map((r) => r.number)).toContain(`${TEST_PREFIX}-001`);
  });

  it("returns matches by city (substring, case-insensitive)", async () => {
    if (!dbReachable) return;
    const rows = await searchFacilitiesAutocompleteAsync("oakland", 10);
    expect(rows.map((r) => r.number)).toContain(`${TEST_PREFIX}-002`);
  });

  it("returns matches by city with mixed case input", async () => {
    if (!dbReachable) return;
    const rows = await searchFacilitiesAutocompleteAsync("BERKELEY", 10);
    expect(rows.map((r) => r.number)).toContain(`${TEST_PREFIX}-001`);
  });

  it("returns matches by facility number (substring, exact-case)", async () => {
    if (!dbReachable) return;
    const rows = await searchFacilitiesAutocompleteAsync(
      `${TEST_PREFIX}-003`,
      10,
    );
    expect(rows.map((r) => r.number)).toContain(`${TEST_PREFIX}-003`);
  });

  it("respects the LIMIT parameter", async () => {
    if (!dbReachable) return;
    const rows = await searchFacilitiesAutocompleteAsync(TEST_PREFIX, 2);
    expect(rows.length).toBeLessThanOrEqual(2);
  });

  it("returns an array even when no matches exist", async () => {
    if (!dbReachable) return;
    const rows = await searchFacilitiesAutocompleteAsync(
      "this-string-should-match-nothing-xyzqwerty",
      10,
    );
    expect(Array.isArray(rows)).toBe(true);
    expect(rows.length).toBe(0);
  });
});
