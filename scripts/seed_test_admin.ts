/**
 * DEV-ONLY: create (or reset) a known admin account for testing.
 *
 * Additive and idempotent — does NOT wipe anything. Creates the user if missing,
 * or resets its password + role to admin if it already exists.
 *
 * Usage:
 *   pnpm --filter @workspace/scripts exec tsx src/seed_test_admin.ts [username] [password]
 * Defaults: username "test_admin", password "test-admin-1234".
 *
 * Do NOT run this against the production database.
 */
import { db, usersTable } from "@workspace/db";
import crypto from "crypto";

// Mirrors the server's auth.hashPassword exactly.
function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "ibpm-salt-2025").digest("hex");
}

async function main() {
  const username = process.argv[2] || "test_admin";
  const password = process.argv[3] || "test-admin-1234";
  const passwordHash = hashPassword(password);

  await db
    .insert(usersTable)
    .values({
      username,
      displayName: "Test Admin",
      email: `${username}@illinois.edu`,
      passwordHash,
      role: "admin",
      // giesBalance / deskBalance fall back to their column defaults.
    })
    .onConflictDoUpdate({
      target: usersTable.username,
      set: { passwordHash, role: "admin" },
    });

  console.log("Admin ready.");
  console.log(`  username: ${username}`);
  console.log(`  password: ${password}`);
  console.log("  role:     admin");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
