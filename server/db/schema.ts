/**
 * server/db/schema.ts
 *
 * Single re-export point for all Drizzle schema tables and types.
 * Import from here instead of @shared/schema when you're inside the server
 * package and want a clean local alias.
 *
 * When migrating to PostgreSQL, update shared/schema.ts (or a new
 * server/db/pgSchema.ts) to use drizzle-orm/pg-core table definitions and
 * point this file at the new schema.  No other server files need updating.
 */
export * from "@shared/schema";
