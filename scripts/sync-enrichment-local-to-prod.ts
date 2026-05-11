/**
 * scripts/sync-enrichment-local-to-prod.ts
 *
 * Copies enrichment columns (last_inspection_date, total_type_b, citations,
 * enriched_at) from a SOURCE Postgres database to a DESTINATION Postgres
 * database, joined by facility number. Used to lift the result of a long
 * `enrich-from-transparency.ts` run on local into prod without re-hitting
 * the CCLD Transparency API for 47k rows.
 *
 * Usage:
 *   SOURCE_DATABASE_URL="postgres://...local..."     \
 *   DEST_DATABASE_URL="postgres://...prod-via-proxy..." \
 *     npx tsx scripts/sync-enrichment-local-to-prod.ts
 *
 *   # or with a smoke-test cap:
 *   ... npx tsx scripts/sync-enrichment-local-to-prod.ts --limit 100
 *
 * Idempotent: only updates dest rows where dest.enriched_at IS NULL OR
 * src.enriched_at > dest.enriched_at, so re-running won't clobber newer
 * data on dest.
 */

import "dotenv/config";
import { Pool } from "pg";

interface CliOpts {
  limit: number;
  dryRun: boolean;
}

function parseArgs(argv: string[]): CliOpts {
  const opts: CliOpts = { limit: 0, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit" || a === "-n") {
      const v = parseInt(argv[++i] ?? "", 10);
      if (!Number.isFinite(v) || v < 0) {
        console.error(`Invalid --limit: ${argv[i]}`);
        process.exit(2);
      }
      opts.limit = v;
    } else if (a === "--dry-run") {
      opts.dryRun = true;
    }
  }
  return opts;
}

function log(msg: string) {
  const ts = new Date().toISOString().slice(11, 19);
  console.log(`[sync ${ts}] ${msg}`);
}

interface Row {
  number: string;
  last_inspection_date: string;
  total_type_b: number;
  citations: number;
  enriched_at: number;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));

  const SRC = process.env.SOURCE_DATABASE_URL;
  const DST = process.env.DEST_DATABASE_URL;
  if (!SRC) {
    console.error("SOURCE_DATABASE_URL not set");
    process.exit(1);
  }
  if (!DST) {
    console.error("DEST_DATABASE_URL not set");
    process.exit(1);
  }
  if (SRC === DST) {
    console.error("SOURCE_DATABASE_URL and DEST_DATABASE_URL are identical — refusing to run.");
    process.exit(1);
  }

  const src = new Pool({ connectionString: SRC });
  const dst = new Pool({ connectionString: DST });

  log("━━━ Enrichment sync: SRC → DST ━━━");
  log(`limit:   ${opts.limit > 0 ? opts.limit : "no limit"}`);
  log(`dry-run: ${opts.dryRun}`);

  // Sanity preview
  const srcCount = await src.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM facilities WHERE enriched_at IS NOT NULL`,
  );
  const dstCount = await dst.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM facilities WHERE enriched_at IS NOT NULL`,
  );
  log(`SRC has ${srcCount.rows[0].n.toLocaleString()} enriched rows`);
  log(`DST has ${dstCount.rows[0].n.toLocaleString()} enriched rows`);

  // Pull enriched rows from source
  const limitSql = opts.limit > 0 ? `LIMIT ${opts.limit}` : "";
  const fetchRes = await src.query<Row>(`
    SELECT number, last_inspection_date, total_type_b, citations, enriched_at
    FROM facilities
    WHERE enriched_at IS NOT NULL
    ORDER BY number
    ${limitSql}
  `);
  log(`Fetched ${fetchRes.rows.length.toLocaleString()} enriched rows from SRC`);

  if (opts.dryRun) {
    log("Dry-run: not writing to DST. Sample of first 3 rows:");
    for (const r of fetchRes.rows.slice(0, 3)) {
      console.log(" ", r);
    }
    await src.end();
    await dst.end();
    return;
  }

  // Bulk upsert into dest, in chunks
  const CHUNK = 500;
  let updated = 0;
  let skipped = 0;
  const startMs = Date.now();

  for (let i = 0; i < fetchRes.rows.length; i += CHUNK) {
    const chunk = fetchRes.rows.slice(i, i + CHUNK);

    const params: unknown[] = [];
    const tuples: string[] = [];
    for (const r of chunk) {
      const start = params.length;
      params.push(
        r.number,
        r.last_inspection_date ?? "",
        r.total_type_b ?? 0,
        r.citations ?? 0,
        r.enriched_at,
      );
      tuples.push(
        `($${start + 1}, $${start + 2}, $${start + 3}::int, $${start + 4}::int, $${start + 5}::bigint)`,
      );
    }

    // The WHERE clause makes this idempotent: only updates rows where dest
    // hasn't been enriched yet, or the source has a newer enriched_at.
    const sql = `
      UPDATE facilities f
      SET last_inspection_date = v.last_inspection_date,
          total_type_b         = v.total_type_b,
          citations            = v.citations,
          enriched_at          = v.enriched_at
      FROM (VALUES ${tuples.join(",")}) AS v(num, last_inspection_date, total_type_b, citations, enriched_at)
      WHERE f.number = v.num
        AND (f.enriched_at IS NULL OR v.enriched_at > f.enriched_at)
    `;
    const r = await dst.query(sql, params);
    updated += r.rowCount ?? 0;
    skipped += chunk.length - (r.rowCount ?? 0);

    if ((i + CHUNK) % 5000 === 0 || i + CHUNK >= fetchRes.rows.length) {
      log(`  progress: ${(i + chunk.length).toLocaleString()} / ${fetchRes.rows.length.toLocaleString()} — updated=${updated.toLocaleString()} skipped=${skipped.toLocaleString()}`);
    }
  }

  const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
  console.log();
  log(`━━━ Done in ${elapsed}s ━━━`);
  log(`Updated on DST: ${updated.toLocaleString()}`);
  log(`Skipped (already up-to-date or missing on DST): ${skipped.toLocaleString()}`);

  // Final coverage on dest
  const finalCount = await dst.query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM facilities WHERE enriched_at IS NOT NULL`,
  );
  log(`DST now has ${finalCount.rows[0].n.toLocaleString()} enriched rows`);

  await src.end();
  await dst.end();
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
