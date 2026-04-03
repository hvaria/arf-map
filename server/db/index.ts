import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import path from "path";

const DB_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, "data.db")
  : "data.db";

/**
 * Singleton SQLite connection shared across the entire application.
 *
 * WAL mode allows concurrent reads while a write is in progress, which is
 * critical for a web server handling parallel requests.  NORMAL sync mode
 * provides OS-level durability without the overhead of FULL.  Foreign keys
 * are enforced globally to catch integrity bugs early.
 *
 * ── Migration path to PostgreSQL ────────────────────────────────────────────
 * 1. Replace this file with a `pg` + `drizzle-orm/node-postgres` connection.
 * 2. Update SqliteJobSeekerRepository → PostgresJobSeekerRepository.
 * 3. Update SqliteSessionStore → connect-pg-simple or similar.
 * No changes required in services, routes, middleware, or any frontend code.
 *
 * ── Migration path to Snowflake / data-warehouse read layer ─────────────────
 * Implement WarehouseJobSeekerRepository that satisfies the same
 * JobSeekerRepository interface and inject it wherever read-heavy queries live.
 */
export const sqlite = new Database(DB_PATH);
sqlite.pragma("journal_mode = WAL");
sqlite.pragma("synchronous = NORMAL");
sqlite.pragma("foreign_keys = ON");

export const db = drizzle(sqlite);
