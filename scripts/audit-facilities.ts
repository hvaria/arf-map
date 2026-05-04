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
import { TYPE_TO_NAME, typeToGroup } from "../shared/etl-types";

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

  // Recompute typeToGroup() and compare to stored facility_group
  out.push(`\n### 4a. Stored group vs. recomputed typeToGroup()\n`);
  const recomputeRows = typeRows.map((r) => {
    const t = String(r.facility_type ?? "");
    return { facility_type: t, recomputed_group: typeToGroup(t), n: Number(r.n) };
  });
  // Find types whose recomputed group differs from any stored group
  const drift: Row[] = [];
  for (const r of recomputeRows) {
    const stored = splitTypes.get(r.facility_type)?.map((s) => String(s.facility_group)) ?? [];
    const mismatch = stored.find((g) => g !== r.recomputed_group);
    if (mismatch) {
      drift.push({
        facility_type: r.facility_type,
        stored_group: stored.join(" | "),
        recomputed_group: r.recomputed_group,
        n: r.n,
      });
    }
  }
  out.push(drift.length === 0
    ? `_(none — stored groups match the typeToGroup() function)_\n`
    : mdTable(drift, ["facility_type", "stored_group", "recomputed_group", "n"]));

  // Types that fell through to default "Adult & Senior Care" (no explicit match)
  const fallthroughTypes = recomputeRows.filter((r) => {
    const lower = r.facility_type.toLowerCase();
    const explicit =
      lower.includes("child care center") ||
      lower.includes("family child care") ||
      lower.includes("group home") ||
      lower.includes("short-term residential") ||
      lower.includes("strtp") ||
      lower.includes("community treatment") ||
      lower.includes("foster family") ||
      lower.includes("home care organization") ||
      lower.includes("adult residential") ||
      lower.includes("residential care facility for the elderly") ||
      lower.includes("social rehabilitation") ||
      lower.includes("adult day");
    return !explicit;
  });
  out.push(`\n### 4b. Types that fell through typeToGroup() default\n`);
  out.push(`These types matched no explicit branch and were classified as "${typeToGroup("__no_match__")}".\n`);
  out.push(fallthroughTypes.length === 0
    ? `_(none)_\n`
    : mdTable(fallthroughTypes as unknown as Row[], ["facility_type", "recomputed_group", "n"]));

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

  // ── Section 11: TYPE_TO_NAME coverage ─────────────────────────────────
  out.push(`\n## 11. TYPE_TO_NAME coverage\n`);
  const knownNames = new Set(Object.values(TYPE_TO_NAME).map((s) => s.toLowerCase()));
  const unmapped = typeRows
    .map((r) => ({ facility_type: String(r.facility_type ?? ""), n: Number(r.n) }))
    .filter((r) => r.facility_type && !knownNames.has(r.facility_type.toLowerCase()));
  out.push(`Types in DB that are NOT in the \`TYPE_TO_NAME\` lookup (${Object.keys(TYPE_TO_NAME).length} known codes):\n`);
  out.push(unmapped.length === 0
    ? `_(none — every DB type is in the known lookup)_\n`
    : mdTable(unmapped as unknown as Row[], ["facility_type", "n"]));

  // ── Section 12: status filter chips ───────────────────────────────────
  out.push(`\n## 12. Recommended findings (auto-summary)\n`);
  const findings: string[] = [];
  if (variants.length > 0) findings.push(`- **${variants.length}** facility_type spelling/casing variants need normalization.`);
  if (emptyTypeN > 0) findings.push(`- **${emptyTypeN}** rows have empty facility_type — currently masked by the default fallback.`);
  if (inconsistent.length > 0) findings.push(`- **${inconsistent.length}** facility types are split across multiple facility_groups (data drift).`);
  if (drift.length > 0) findings.push(`- **${drift.length}** types where stored group disagrees with the \`typeToGroup()\` function.`);
  if (fallthroughTypes.length > 0) findings.push(`- **${fallthroughTypes.length}** types fell through \`typeToGroup()\` default and may be misclassified as Adult & Senior Care.`);
  if (countyVariants.length > 0) findings.push(`- **${countyVariants.length}** county names have casing/spelling variants.`);
  if (Number(cap.zero_cap ?? 0) > 0) findings.push(`- **${cap.zero_cap}** rows have capacity=0 (cannot distinguish "unknown" from "actually zero").`);
  if (Number(ph.non_canonical ?? 0) > 0) findings.push(`- **${ph.non_canonical}** phone numbers do not match canonical format.`);
  if (unmapped.length > 0) findings.push(`- **${unmapped.length}** distinct facility types are absent from the \`TYPE_TO_NAME\` lookup.`);
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
