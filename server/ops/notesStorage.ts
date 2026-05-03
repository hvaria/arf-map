import { pool } from "../db/index";
import { NOTES_PG_SCHEMA_SQL } from "./notesSchema";

// ─────────────────────────────────────────────────────────────────────────────
// Notes module — schema bootstrap.
//
// Repository functions (create/list/get/reply/ack/archive/etc.) land in slice
// 2 of the Notes module rollout. Keeping this file scoped to the bootstrap
// for now mirrors the opsStorage.ts pattern: DDL lives next to the SQL
// constant, and a single idempotent function is invoked from server/index.ts
// at startup.
// ─────────────────────────────────────────────────────────────────────────────

export async function bootstrapNotesSchema(): Promise<void> {
  await pool.query(NOTES_PG_SCHEMA_SQL);
  console.log("[notes] PostgreSQL tables bootstrapped");
}
