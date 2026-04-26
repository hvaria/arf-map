/**
 * server/db/index.ts
 *
 * Dual-mode database connection.
 *
 * If DATABASE_URL is set → PostgreSQL (via node-postgres + Drizzle pg-core).
 * If DATABASE_URL is absent → SQLite (via better-sqlite3 + Drizzle sqlite-core).
 *
 * Callers import { db, sqlite, pool, usingPostgres } from "./db/index".
 * - sqlite: defined only in SQLite mode (undefined in Postgres mode)
 * - pool:   defined only in Postgres mode (undefined in SQLite mode)
 * - db:     always defined; type differs per mode but Drizzle query builder
 *           is used identically in both modes for ORM-style queries.
 */

import Database from "better-sqlite3";
import { drizzle as drizzleSqlite } from "drizzle-orm/better-sqlite3";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import path from "path";

const DATABASE_URL = process.env.DATABASE_URL;

/** True when the app is connected to PostgreSQL; false for SQLite. */
export const usingPostgres = !!DATABASE_URL;

// Use `any` for the db union type so downstream code compiles without
// requiring every Drizzle query to carry a complex conditional type.
// The alternative (a discriminated union) would require rewriting every
// query site — the `any` cast is the minimal-change approach.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let db: any;
let sqlite: Database.Database | undefined;
let pool: Pool | undefined;

// IMPORTANT: server/routes.ts imports `sqlite` and calls it directly without
// a null check (the file cannot be modified). We type `sqliteForRoutes` as
// `Database.Database` (non-optional) using a type assertion so TypeScript compiles.
// At runtime in Postgres mode the call will throw a TypeError — this is documented
// as a blocker in agents/05-blockers.md. The error is caught by Express's global
// error handler and returned as a 500. It only affects the password-reset session
// invalidation code path — all other routes are unaffected.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _sqliteExported: Database.Database = undefined as any;

if (usingPostgres) {
  pool = new Pool({
    connectionString: DATABASE_URL,
    // DATABASE_URL from Fly.io includes ?sslmode=disable for internal 6PN connections.
    // Do NOT add ssl: { rejectUnauthorized: false } here — it conflicts with sslmode=disable.
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 2000,
  });

  db = drizzlePg(pool);
  console.log("[db] using PostgreSQL");
} else {
  const DB_PATH = process.env.DATA_DIR
    ? path.join(process.env.DATA_DIR, "data.db")
    : "data.db";

  sqlite = new Database(DB_PATH);

  /**
   * WAL mode allows concurrent reads while a write is in progress, which is
   * critical for a web server handling parallel requests. NORMAL sync mode
   * provides OS-level durability without the overhead of FULL. Foreign keys
   * are enforced globally to catch integrity bugs early.
   *
   * ── Migration path to PostgreSQL ────────────────────────────────────────────
   * 1. Set DATABASE_URL environment variable.
   * 2. The usingPostgres branch above will activate automatically.
   * 3. Run drizzle-kit migrations against PostgreSQL schema (shared/schema.pg.ts).
   * No changes required in services, routes, middleware, or any frontend code.
   */
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");

  _sqliteExported = sqlite;
  db = drizzleSqlite(sqlite);
  console.log("[db] using SQLite:", DB_PATH);
}

// Export `sqlite` as non-optional Database so routes.ts (which cannot be
// modified) compiles under strict TypeScript. In Postgres mode, the value is
// undefined at runtime — callers that use `usingPostgres` guards are safe;
// callers in routes.ts that do not guard will throw a TypeError on that specific
// code path (caught by Express error handler).
export { db, pool };
export { _sqliteExported as sqlite };
