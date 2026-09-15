import { Router } from "express";
import { db, usersTable, rosterTable, transactionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, generateToken, generateTxHash, authMiddleware, requireAuth } from "../lib/auth.js";

const router = Router();

// Starting personal (taker) balance for a newly registered student.
const TAKER_START_BALANCE = "5000";

// Desk capital granted to a maker on entering an active cycle.
// KEEP IN SYNC with MAKER_DESK_CAPITAL in routes/users.ts.
const MAKER_DESK_CAPITAL = "15000";

function userPayload(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    cohortId: user.cohortId,
    giesBalance: parseFloat(user.giesBalance),
    createdAt: user.createdAt,
  };
}

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  // Allow login by username OR email (students will know their email).
  const ident = String(username).trim().toLowerCase();
  let [user] = await db.select().from(usersTable).where(eq(usersTable.username, ident)).limit(1);
  if (!user) {
    [user] = await db.select().from(usersTable).where(eq(usersTable.email, ident)).limit(1);
  }

  if (!user || user.passwordHash !== hashPassword(password)) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const token = generateToken(user.id);
  res.json({ user: userPayload(user), token });
});

// ---- Self-signup, gated to the class roster allowlist -------------------------
router.post("/register", async (req, res) => {
  const emailRaw = req.body?.email;
  const password = req.body?.password;

  if (!emailRaw || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  if (String(password).length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const email = String(emailRaw).trim().toLowerCase();
  if (!email.endsWith("@illinois.edu")) {
    res.status(400).json({ error: "Use your @illinois.edu email address" });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Lock the roster row so two people can't claim the same email at once.
      const [entry] = await tx
        .select()
        .from(rosterTable)
        .where(eq(rosterTable.email, email))
        .for("update")
        .limit(1);

      if (!entry) {
        throw Object.assign(new Error("This email isn't on the class roster. Contact the instructor."), { status: 403 });
      }
      if (entry.claimed) {
        throw Object.assign(new Error("An account for this email already exists. Try logging in or ask for a reset."), { status: 409 });
      }

      // Username = netid (the part before @). Fall back with a suffix on collision.
      const netid = email.split("@")[0];
      let username = netid;
      const [clash] = await tx.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
      if (clash) username = `${netid}_${entry.id}`;

      // If this student's rotation group is the currently-active maker group,
      // promote them straight to market_maker with a fresh desk. This handles
      // students who register AFTER their group was activated (activation only
      // promotes accounts that already exist at the time it runs).
      const activeMakers = await tx
        .select({ rg: usersTable.rotationGroup })
        .from(usersTable)
        .where(eq(usersTable.role, "market_maker"));
      const activeGroups = new Set(
        activeMakers.map((m) => m.rg).filter((g): g is number => g != null)
      );
      const isActiveMaker = entry.rotationGroup != null && activeGroups.has(entry.rotationGroup);
      const role = isActiveMaker ? "market_maker" : "student";
      const deskBalance = isActiveMaker ? MAKER_DESK_CAPITAL : "0";

      const [user] = await tx
        .insert(usersTable)
        .values({
          username,
          displayName: entry.displayName,
          email,
          passwordHash: hashPassword(password),
          role,
          cohortId: entry.cohortId ?? null,
          rotationGroup: entry.rotationGroup ?? null,
          giesBalance: TAKER_START_BALANCE,
          deskBalance,
        })
        .returning();

      await tx
        .update(rosterTable)
        .set({ claimed: true, claimedUserId: user.id })
        .where(eq(rosterTable.id, entry.id));

      // Record the desk grant for the audit trail / grading (mirrors rotation activate).
      if (isActiveMaker) {
        await tx.insert(transactionsTable).values({
          userId: user.id,
          type: "desk_grant",
          amount: MAKER_DESK_CAPITAL,
          description: `Maker desk granted on registration (active group ${entry.rotationGroup}): ${MAKER_DESK_CAPITAL} GIES`,
          txHash: generateTxHash(),
        });
      }

      return user;
    });

    const token = generateToken(result.id);
    res.status(201).json({ user: userPayload(result), token });
  } catch (err: any) {
    res.status(err.status ?? 400).json({ error: err.message ?? "Registration failed" });
  }
});

// ---- Self-serve change password ----------------------------------------------
router.post("/change-password", authMiddleware, requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    res.status(400).json({ error: "Current and new password are required" });
    return;
  }
  if (String(newPassword).length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
  if (!user || user.passwordHash !== hashPassword(oldPassword)) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  await db.update(usersTable).set({ passwordHash: hashPassword(newPassword) }).where(eq(usersTable.id, user.id));
  res.json({ message: "Password updated" });
});

router.post("/logout", (req, res) => {
  res.json({ message: "Logged out successfully" });
});

router.get("/me", authMiddleware, requireAuth, async (req, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    cohortId: user.cohortId,
    giesBalance: parseFloat(user.giesBalance),
    createdAt: user.createdAt,
  });
});

export default router;
