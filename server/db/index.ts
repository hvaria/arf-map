import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, types } from "pg";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL environment variable is required");
}

// node-postgres returns BIGINT (int8, OID 20) as string by default to avoid
// JS Number precision loss. Our IDs and epoch-ms timestamps fit safely in a
// JS number, and downstream code (Drizzle types, route handlers, JSON output)
// expects `number`. Parse globally — must run before any pool query.
types.setTypeParser(20, (val) => (val === null ? null : Number(val)));

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // DATABASE_URL from Fly.io includes ?sslmode=disable for internal 6PN connections.
  max: 10,
  idleTimeoutMillis: 30000,
  // 10s timeout to tolerate cold-start of an auto-stopped Fly Postgres machine.
  connectionTimeoutMillis: 10000,
});

export const db = drizzle(pool);

console.log("[db] using PostgreSQL");
