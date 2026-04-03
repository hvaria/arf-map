/**
 * server/db/seed.ts — development seed script
 *
 * Creates one verified demo job seeker account if it does not already exist.
 *
 * Usage:
 *   npx tsx server/db/seed.ts
 *
 * The demo credentials are logged to stdout so they are always visible
 * after running the seed.  Never commit real credentials here.
 */
import "dotenv/config";
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { jobSeekerAccounts } from "@shared/schema";
import { hashPassword } from "../auth";
import path from "path";

const DB_PATH = process.env.DATA_DIR
  ? path.join(process.env.DATA_DIR, "data.db")
  : "data.db";

const DEMO_EMAIL = "demo@arfcare.dev";
const DEMO_PASSWORD = "Demo1234!";

async function seed() {
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite);

  const existing = await db
    .select({ id: jobSeekerAccounts.id })
    .from(jobSeekerAccounts)
    .where(eq(jobSeekerAccounts.email, DEMO_EMAIL))
    .get();

  if (existing) {
    console.log(`[seed] Demo account already exists (id=${existing.id}). Skipping.`);
  } else {
    const hashed = await hashPassword(DEMO_PASSWORD);
    const now = Date.now();
    const inserted = await db
      .insert(jobSeekerAccounts)
      .values({
        username: DEMO_EMAIL,
        email: DEMO_EMAIL,
        password: hashed,
        emailVerified: 1, // pre-verified for demo convenience
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: jobSeekerAccounts.id })
      .get();

    console.log(`[seed] Created demo account (id=${inserted.id}).`);
  }

  console.log("");
  console.log("─────────────────────────────────────────");
  console.log("  Demo Job Seeker Login");
  console.log("  Email:    " + DEMO_EMAIL);
  console.log("  Password: " + DEMO_PASSWORD);
  console.log("─────────────────────────────────────────");
  console.log("");

  sqlite.close();
}

seed().catch((err) => {
  console.error("[seed] Failed:", err);
  process.exit(1);
});
