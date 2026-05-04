/**
 * scripts/audit-facilities.ts
 *
 * Read-only audit of the `facilities` table. Produces data/audit-report.md
 * with the data-quality findings needed before we apply the new taxonomy.
 *
 * Usage: npx tsx scripts/audit-facilities.ts
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { Pool } from "pg";
import { TAXONOMY, normalizeRawType, type TaxonomyEntry } from "../shared/taxonomy";

/**
 * Resolve a stored `facility_type` string to a taxonomy entry. ETL writes
 * facilities with the taxonomy's `officialLabel` (not the raw CCL feed string),
 * so the audit must match against `officialLabel` as well as `ccldRawNames`.
 */
function resolveStoredFacilityType(stored: string): TaxonomyEntry | null {
  if (!stored) return null;
  // First try the raw-name index (matches CCL feed strings).
  const viaRaw = normalizeRawType(stored);
  if (viaRaw) return viaRaw;
  // Then try matching against officialLabel (what the ETL writes back).
  const target = stored.trim().toLowerCase();
  return TAXONOMY.find((e) => e.officialLabel.toLowerCase() === target) ?? null;
}

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL not set — check .env");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

type Row = Record<string, unknown>;

async function q(sql: string, params: unknown[] = []): Promise<Row[]> {
  const r = await pool.query(sql, params);
  return r.rows as Row[];
}

function mdTable(rows: Row[], cols: string[]): string {
  if (rows.length === 0) return "_(no rows)_\n";
  const header = "| " + cols.join(" | ") + " |";
  const sep = "| " + cols.map(() => "---").join(" | ") + " |";
  const body = rows
    .map((r) => "| " + cols.map((c) => fmt(r[c])).join(" | ") + " |")
    .join("\n");
  return `${header}\n${sep}\n${body}\n`;
}

function fmt(v: unknown): string {
  if (v === null || v === undefined) return "_null_";
  if (typeof v === "string" && v === "") return "_empty_";
  return String(v).replace(/\|/g, "\\|");
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

async function main() {
  console.log("Connecting to PostgreSQL…");
  const out: string[] = [];
  const now = new Date().toISOString();
  out.push(`# Facilities Data Audit\n\n_Generated: ${now}_\n`);

  // ── Section 1: row counts ─────────────────────────────────────────────
  const totalRow = await q(`SELECT COUNT(*)::int AS n FROM facilities`);
  const total = Number(totalRow[0]?.n ?? 0);
  out.push(`## 1. Row counts\n`);
  out.push(`- Total facilities: **${total.toLocaleString()}**\n`);

  if (total === 0) {
    out.push(`\n> Table is empty. Run \`npm run data:seed\` first.\n`);
    fs.writeFileSync(reportPath(), out.join("\n"));
    console.log(`Empty DB — wrote stub report to ${reportPath()}`);
    await pool.end();
    return;
  }

  // ── Section 2: facility_type distribution ─────────────────────────────
  const typeRows = await q(`
    SELECT facility_type, COUNT(*)::int AS n
    FROM facilities
    GROUP BY facility_type
    ORDER BY n DESC
  `);
  out.push(`\n## 2. facility_type distribution\n`);
  out.push(`Distinct values: **${typeRows.length}**\n`);
  out.push(mdTable(typeRows, ["facility_type", "n"]));

  // Spelling-variant fingerprint: group by normalized (lower + collapse spaces)
  const fingerprintMap = new Map<string, { variants: Set<string>; total: number }>();
  for (const r of typeRows) {
    const t = String(r.facility_type ?? "");
    const n = Number(r.n);
    const fp = t.toLowerCase().replace(/\s+/g, " ").trim();
    if (!fingerprintMap.has(fp)) fingerprintMap.set(fp, { variants: new Set(), total: 0 });
    const e = fingerprintMap.get(fp)!;
    e.variants.add(t);
    e.total += n;
  }
  const variants = [...fingerprintMap.entries()]
    .filter(([, v]) => v.variants.size > 1)
    .map(([fp, v]) => ({
      fingerprint: fp,
      variants: [...v.variants].join(" | "),
      total: v.total,
    }));
  out.push(`\n### 2a. Spelling/casing variants of the same type\n`);
  out.push(variants.length === 0
    ? `_(none — all distinct values look canonical)_\n`
    : mdTable(variants as unknown as Row[], ["fingerprint", "variants", "total"]));

  // Empty / whitespace types
  const emptyType = await q(`
    SELECT COUNT(*)::int AS n
    FROM facilities
    WHERE facility_type IS NULL OR TRIM(facility_type) = ''
  `);
  const emptyTypeN = Number(emptyType[0]?.n ?? 0);
  out.push(`\n### 2b. Empty/null facility_type\n`);
  out.push(`- ${emptyTypeN} rows (${pct(emptyTypeN, total)})\n`);

  // ── Section 3: facility_group distribution ────────────────────────────
  const groupRows = await q(`
    SELECT facility_group, COUNT(*)::int AS n
    FROM facilities
    GROUP BY facility_group
    ORDER BY n DESC
  `);
  out.push(`\n## 3. facility_group distribution\n`);
  out.push(mdTable(groupRows, ["facility_group", "n"]));

  // ── Section 4: type → group consistency ───────────────────────────────
  const typeGroupRows = await q(`
    SELECT facility_type, facility_group, COUNT(*)::int AS n
    FROM facilities
    GROUP BY facility_type, facility_group
    ORDER BY facility_type, n DESC
  `);
  // Find types that are split across multiple groups
  const splitTypes = new Map<string, Row[]>();
  for (const r of typeGroupRows) {
    const t = String(r.facility_type ?? "");
    if (!splitTypes.has(t)) splitTypes.set(t, []);
    splitTypes.get(t)!.push(r);
  }
  const inconsistent = [...splitTypes.entries()]
    .filter(([, rows]) => rows.length > 1)
    .map(([t, rows]) => ({
      facility_type: t,
      groups: rows.map((r) => `${r.facility_group}=${r.n}`).join(" | "),
    }));
  out.push(`\n## 4. type → group consistency\n`);
  out.push(`Types whose rows fall into more than one group:\n`);
  out.push(inconsistent.length === 0
    ? `_(none — every type maps to one group)_\n`
    : mdTable(inconsistent as unknown as Row[], ["facility_type", "groups"]));

  // ── Section 4a: stored facility_type values that don't resolve to any taxonomy entry
  out.push(`\n### 4a. facility_type values not recognized by the canonical taxonomy\n`);
  out.push(`Stored \`facility_type\` strings that cannot be resolved against \`shared/taxonomy.ts\` (matched against either \`ccldRawNames\` or \`officialLabel\`). These are real coverage gaps — the taxonomy is missing an entry, or the row was written with a non-canonical label.\n`);
  const unrecognized = typeRows
    .map((r) => ({ facility_type: String(r.facility_type ?? ""), n: Number(r.n) }))
    .filter((r) => r.facility_type && resolveStoredFacilityType(r.facility_type) === null);
  out.push(unrecognized.length === 0
    ? `_(none — every stored facility_type resolves to a taxonomy entry)_\n`
    : mdTable(unrecognized as unknown as Row[], ["facility_type", "n"]));

  // ── Section 4b: stored facility_group disagrees with taxonomy.domain
  out.push(`\n### 4b. Stored facility_group disagrees with taxonomy domain\n`);
  out.push(`Rows whose stored \`facility_group\` does not match the \`domain\` of the taxonomy entry resolved from \`facility_type\`. This is real drift — the row was written with a stale group label.\n`);
  const groupDrift: Row[] = [];
  for (const [t, rows] of splitTypes) {
    const tax = resolveStoredFacilityType(t);
    if (!tax) continue; // covered by section 4a
    for (const r of rows) {
      const storedGroup = String(r.facility_group ?? "");
      if (storedGroup !== tax.domain) {
        groupDrift.push({
          facility_type: t,
          stored_group: storedGroup,
          taxonomy_domain: tax.domain,
          n: Number(r.n),
        });
      }
    }
  }
  out.push(groupDrift.length === 0
    ? `_(none — every stored group matches the taxonomy domain)_\n`
    : mdTable(groupDrift, ["facility_type", "stored_group", "taxonomy_domain", "n"]));

  // ── Section 5: status distribution ────────────────────────────────────
  const statusRows = await q(`
    SELECT status, COUNT(*)::int AS n
    FROM facilities
    GROUP BY status
    ORDER BY n DESC
  `);
  out.push(`\n## 5. status distribution\n`);
  out.push(mdTable(statusRows, ["status", "n"]));

  // ── Section 6: county distribution (top 30) ───────────────────────────
  const countyRows = await q(`
    SELECT county, COUNT(*)::int AS n
    FROM facilities
    GROUP BY county
    ORDER BY n DESC
    LIMIT 30
  `);
  const countyTotal = await q(`SELECT COUNT(DISTINCT county)::int AS n FROM facilities`);
  out.push(`\n## 6. county distribution (top 30 of ${Number(countyTotal[0]?.n ?? 0)})\n`);
  out.push(mdTable(countyRows, ["county", "n"]));

  // County casing/spelling variants
  const allCounties = await q(`SELECT DISTINCT county FROM facilities ORDER BY county`);
  const countyFp = new Map<string, Set<string>>();
  for (const r of allCounties) {
    const c = String(r.county ?? "");
    const fp = c.toLowerCase().replace(/\s+/g, " ").trim();
    if (!countyFp.has(fp)) countyFp.set(fp, new Set());
    countyFp.get(fp)!.add(c);
  }
  const countyVariants = [...countyFp.entries()]
    .filter(([, set]) => set.size > 1)
    .map(([fp, set]) => ({ fingerprint: fp, variants: [...set].join(" | ") }));
  out.push(`\n### 6a. County spelling variants\n`);
  out.push(countyVariants.length === 0
    ? `_(none)_\n`
    : mdTable(countyVariants as unknown as Row[], ["fingerprint", "variants"]));

  // ── Section 7: capacity distribution ──────────────────────────────────
  const capRows = await q(`
    SELECT
      SUM(CASE WHEN capacity IS NULL THEN 1 ELSE 0 END)::int AS null_cap,
      SUM(CASE WHEN capacity = 0 THEN 1 ELSE 0 END)::int AS zero_cap,
      SUM(CASE WHEN capacity BETWEEN 1 AND 6 THEN 1 ELSE 0 END)::int AS small_1_6,
      SUM(CASE WHEN capacity BETWEEN 7 AND 15 THEN 1 ELSE 0 END)::int AS mid_7_15,
      SUM(CASE WHEN capacity BETWEEN 16 AND 49 THEN 1 ELSE 0 END)::int AS large_16_49,
      SUM(CASE WHEN capacity BETWEEN 50 AND 99 THEN 1 ELSE 0 END)::int AS xl_50_99,
      SUM(CASE WHEN capacity >= 100 THEN 1 ELSE 0 END)::int AS xxl_100p
    FROM facilities
  `);
  const cap = capRows[0] ?? {};
  out.push(`\n## 7. capacity distribution\n`);
  out.push(mdTable(
    [
      { bucket: "NULL", n: Number(cap.null_cap ?? 0) },
      { bucket: "0 (likely unknown)", n: Number(cap.zero_cap ?? 0) },
      { bucket: "1–6", n: Number(cap.small_1_6 ?? 0) },
      { bucket: "7–15", n: Number(cap.mid_7_15 ?? 0) },
      { bucket: "16–49", n: Number(cap.large_16_49 ?? 0) },
      { bucket: "50–99", n: Number(cap.xl_50_99 ?? 0) },
      { bucket: "100+", n: Number(cap.xxl_100p ?? 0) },
    ],
    ["bucket", "n"],
  ));

  // ── Section 8: geocode_quality distribution ───────────────────────────
  const geoRows = await q(`
    SELECT geocode_quality, COUNT(*)::int AS n
    FROM facilities
    GROUP BY geocode_quality
    ORDER BY n DESC
  `);
  const noGeo = await q(`SELECT COUNT(*)::int AS n FROM facilities WHERE lat IS NULL OR lng IS NULL`);
  out.push(`\n## 8. geocode_quality distribution\n`);
  out.push(mdTable(geoRows, ["geocode_quality", "n"]));
  out.push(`- Rows with NULL lat or lng: **${Number(noGeo[0]?.n ?? 0)}** (${pct(Number(noGeo[0]?.n ?? 0), total)})\n`);

  // ── Section 9: phone formatting ───────────────────────────────────────
  const phoneCheck = await q(`
    SELECT
      SUM(CASE WHEN phone = '' THEN 1 ELSE 0 END)::int AS empty_phone,
      SUM(CASE WHEN phone ~ '^\\(\\d{3}\\) \\d{3}-\\d{4}$' THEN 1 ELSE 0 END)::int AS canonical,
      SUM(CASE WHEN phone <> '' AND phone !~ '^\\(\\d{3}\\) \\d{3}-\\d{4}$' THEN 1 ELSE 0 END)::int AS non_canonical
    FROM facilities
  `);
  const ph = phoneCheck[0] ?? {};
  out.push(`\n## 9. phone formatting\n`);
  out.push(mdTable(
    [
      { bucket: "empty", n: Number(ph.empty_phone ?? 0) },
      { bucket: "canonical (XXX) XXX-XXXX", n: Number(ph.canonical ?? 0) },
      { bucket: "non-canonical", n: Number(ph.non_canonical ?? 0) },
    ],
    ["bucket", "n"],
  ));
  // Sample non-canonical phones
  const phoneSamples = await q(`
    SELECT phone, COUNT(*)::int AS n
    FROM facilities
    WHERE phone <> '' AND phone !~ '^\\(\\d{3}\\) \\d{3}-\\d{4}$'
    GROUP BY phone
    ORDER BY n DESC
    LIMIT 10
  `);
  if (phoneSamples.length > 0) {
    out.push(`\n### 9a. Sample non-canonical phone formats\n`);
    out.push(mdTable(phoneSamples, ["phone", "n"]));
  }

  // ── Section 10: enrichment completeness ───────────────────────────────
  const enrichRows = await q(`
    SELECT
      SUM(CASE WHEN last_inspection_date <> '' THEN 1 ELSE 0 END)::int AS has_inspection,
      SUM(CASE WHEN total_visits > 0 THEN 1 ELSE 0 END)::int AS has_visits,
      SUM(CASE WHEN citations > 0 THEN 1 ELSE 0 END)::int AS has_citations,
      SUM(CASE WHEN total_type_b > 0 THEN 1 ELSE 0 END)::int AS has_type_b,
      SUM(CASE WHEN administrator <> '' THEN 1 ELSE 0 END)::int AS has_admin,
      SUM(CASE WHEN licensee <> '' THEN 1 ELSE 0 END)::int AS has_licensee,
      SUM(CASE WHEN enriched_at IS NOT NULL THEN 1 ELSE 0 END)::int AS has_enriched_at
    FROM facilities
  `);
  const en = enrichRows[0] ?? {};
  out.push(`\n## 10. enrichment / compliance field completeness\n`);
  out.push(mdTable(
    [
      { field: "last_inspection_date", populated: Number(en.has_inspection ?? 0), pct: pct(Number(en.has_inspection ?? 0), total) },
      { field: "total_visits > 0", populated: Number(en.has_visits ?? 0), pct: pct(Number(en.has_visits ?? 0), total) },
      { field: "citations > 0", populated: Number(en.has_citations ?? 0), pct: pct(Number(en.has_citations ?? 0), total) },
      { field: "total_type_b > 0", populated: Number(en.has_type_b ?? 0), pct: pct(Number(en.has_type_b ?? 0), total) },
      { field: "administrator", populated: Number(en.has_admin ?? 0), pct: pct(Number(en.has_admin ?? 0), total) },
      { field: "licensee", populated: Number(en.has_licensee ?? 0), pct: pct(Number(en.has_licensee ?? 0), total) },
      { field: "enriched_at", populated: Number(en.has_enriched_at ?? 0), pct: pct(Number(en.has_enriched_at ?? 0), total) },
    ],
    ["field", "populated", "pct"],
  ));

  // ── Section 11: taxonomy coverage ─────────────────────────────────────
  out.push(`\n## 11. Taxonomy coverage\n`);
  const missingFromTaxonomy = typeRows
    .map((r) => ({ facility_type: String(r.facility_type ?? ""), n: Number(r.n) }))
    .filter((r) => r.facility_type && resolveStoredFacilityType(r.facility_type) === null);
  out.push(`Stored \`facility_type\` values absent from \`TAXONOMY\` in \`shared/taxonomy.ts\` (${TAXONOMY.length} taxonomy entries). Matching is case-insensitive against both \`ccldRawNames\` and \`officialLabel\`.\n`);
  out.push(missingFromTaxonomy.length === 0
    ? `_(none — every stored facility_type matches a taxonomy entry)_\n`
    : mdTable(missingFromTaxonomy as unknown as Row[], ["facility_type", "n"]));

  // ── Section 12: status filter chips ───────────────────────────────────
  out.push(`\n## 12. Recommended findings (auto-summary)\n`);
  const findings: string[] = [];
  if (variants.length > 0) findings.push(`- **${variants.length}** facility_type spelling/casing variants need normalization.`);
  if (emptyTypeN > 0) findings.push(`- **${emptyTypeN}** rows have empty facility_type.`);
  if (inconsistent.length > 0) findings.push(`- **${inconsistent.length}** facility types are split across multiple facility_groups (data drift).`);
  if (unrecognized.length > 0) findings.push(`- **${unrecognized.length}** distinct facility_type values are not recognized by the canonical taxonomy (\`normalizeRawType()\` returns null).`);
  if (groupDrift.length > 0) findings.push(`- **${groupDrift.length}** (facility_type, facility_group) pairs disagree with the taxonomy domain.`);
  if (countyVariants.length > 0) findings.push(`- **${countyVariants.length}** county names have casing/spelling variants.`);
  if (Number(cap.zero_cap ?? 0) > 0) findings.push(`- **${cap.zero_cap}** rows have capacity=0 (cannot distinguish "unknown" from "actually zero").`);
  if (Number(ph.non_canonical ?? 0) > 0) findings.push(`- **${ph.non_canonical}** phone numbers do not match canonical format.`);
  if (missingFromTaxonomy.length > 0) findings.push(`- **${missingFromTaxonomy.length}** distinct facility types are absent from \`TAXONOMY.ccldRawNames\` in \`shared/taxonomy.ts\`.`);
  if (Number(en.has_inspection ?? 0) / total < 0.5) findings.push(`- last_inspection_date populated on only ${pct(Number(en.has_inspection ?? 0), total)} of rows — enrichment is incomplete.`);
  if (Number(noGeo[0]?.n ?? 0) > 0) findings.push(`- **${noGeo[0]?.n}** rows have no geocoded coordinates.`);

  out.push(findings.length === 0 ? `_No issues detected._\n` : findings.join("\n") + "\n");

  // ── Write report ──────────────────────────────────────────────────────
  const file = reportPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, out.join("\n"));
  console.log(`\nReport written: ${file}`);
  console.log(`Open it to review findings before Phase 2.`);

  await pool.end();
}

function reportPath(): string {
  return path.resolve(process.cwd(), "data", "audit-report.md");
}

main().catch((err) => {
  console.error("Audit failed:", err);
  pool.end();
  process.exit(1);
});
