/**
 * One-shot admin reset for a facility account.
 *
 * Bypasses the OTP flow entirely — looks up the account by email OR username,
 * hashes a new password with the same algorithm Passport uses, clears any
 * lockout counter, marks the email verified, and invalidates existing
 * sessions so the new password takes effect immediately.
 *
 * Use this to unstick yourself when forgot-password isn't working (e.g. you
 * forgot which username the email is attached to, or the account was locked
 * out before the reset-clears-lockout fix landed).
 *
 * Usage (PowerShell):
 *   $env:DATABASE_URL="postgres://..."
 *   npx tsx scripts/admin-reset-facility-password.ts <email-or-username> <new-password>
 *
 * The password is read from argv to keep the script trivial. Don't paste a
 * password you care about into shell history on a shared machine — use the
 * web reset flow once it works again.
 */
import { hashPassword } from "../server/auth";
import { pool } from "../server/db/index";

async function main() {
  const [, , identifier, newPassword] = process.argv;
  if (!identifier || !newPassword) {
    console.error("Usage: tsx scripts/admin-reset-facility-password.ts <email-or-username> <new-password>");
    process.exit(1);
  }
  if (newPassword.length < 8) {
    console.error("Refusing to set a password shorter than 8 characters.");
    process.exit(1);
  }

  // Find candidate accounts. We accept both forms so the operator doesn't
  // have to know which one is on file. Email match is case-insensitive
  // (matches the storage-layer behavior). Username match is exact.
  const result = await pool.query<{
    id: number;
    username: string;
    email: string | null;
    facility_number: string;
    email_verified: number;
    failed_login_count: number;
  }>(
    `SELECT id, username, email, facility_number, email_verified, failed_login_count
       FROM facility_accounts
      WHERE username = $1 OR LOWER(email) = LOWER($1)`,
    [identifier],
  );

  if (result.rows.length === 0) {
    console.error(`No facility account found matching "${identifier}".`);
    process.exit(2);
  }
  if (result.rows.length > 1) {
    console.error(`Ambiguous: ${result.rows.length} accounts match "${identifier}":`);
    for (const r of result.rows) {
      console.error(`  id=${r.id} username=${r.username} email=${r.email} facility=${r.facility_number}`);
    }
    console.error("Re-run with a more specific identifier (e.g. the exact username).");
    process.exit(3);
  }

  const account = result.rows[0];
  const hashed = await hashPassword(newPassword);

  await pool.query("BEGIN");
  try {
    await pool.query(
      `UPDATE facility_accounts
          SET password = $1,
              failed_login_count = 0,
              email_verified = 1,
              verification_token = NULL,
              verification_expiry = NULL
        WHERE id = $2`,
      [hashed, account.id],
    );
    // Kill any active sessions for this account so the old password's session
    // (if one exists) can't continue. Mirrors the reset-password route.
    await pool.query(
      "DELETE FROM session WHERE sess->'passport'->>'user' = $1",
      [String(account.id)],
    );
    await pool.query("COMMIT");
  } catch (err) {
    await pool.query("ROLLBACK");
    throw err;
  }

  console.log("Password updated:");
  console.log(`  id              = ${account.id}`);
  console.log(`  username        = ${account.username}`);
  console.log(`  email           = ${account.email ?? "(none)"}`);
  console.log(`  facility_number = ${account.facility_number}`);
  console.log("");
  console.log("You can now log in with that username or email and the new password.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => pool.end());
