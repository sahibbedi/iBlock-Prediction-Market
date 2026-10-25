/** Offline bootstrap for a NEW campus database. Never overwrites existing users. */
import { db, pool, usersTable, platformConfigTable } from "@workspace/db";
import { hashPassword } from "../../api-server/src/lib/security.js";
const members = JSON.parse(process.env.COMMITTEE_MEMBERS || "[]") as { username: string; displayName: string; email: string; password: string }[];
if (members.length < 2 || members.length > 7 || new Set(members.map(m => m.username)).size !== members.length || members.some(m => !m.username || !m.displayName || !m.email || m.password.length < 12)) throw new Error("COMMITTEE_MEMBERS must contain 2-7 unique admins with username, displayName, email, and password (12+ characters)");
try {
  await db.transaction(async tx => {
    const existing = await tx.select().from(usersTable);
    if (existing.length) throw new Error("Bootstrap requires an empty users table; existing beta data needs a reviewed migration");
    for (const member of members) await tx.insert(usersTable).values({ ...member, passwordHash: hashPassword(member.password), role: "admin", giesBalance: "0", deskBalance: "0" });
    await tx.insert(platformConfigTable).values({ id: 1, routineThreshold: 2, resolveThreshold: members.length >= 3 ? 3 : 2 });
  });
  console.log(`Initialized ${members.length} committee members. No funds minted. Set economics and fund the treasury through committee proposals.`);
} finally { await pool.end(); }
