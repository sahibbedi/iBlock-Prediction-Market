import { Router } from "express";
import { db, usersTable, cohortMembersTable } from "@workspace/db";
import { eq, and, ne, inArray, isNotNull } from "drizzle-orm";
import { authMiddleware, requireAuth, canTeach, hashPassword } from "../lib/auth.js";
import crypto from "crypto";

const router = Router();

function formatUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    cohortId: user.cohortId,
    rotationGroup: user.rotationGroup,
    giesBalance: parseFloat(user.giesBalance),
    createdAt: user.createdAt,
  };
}

// A friendly temp password, e.g. "gies-4823-swap". Easy to read out / type.
function generateTempPassword(): string {
  const n = crypto.randomInt(1000, 9999);
  const tail = crypto.randomBytes(2).toString("hex");
  return `gies-${n}-${tail}`;
}

router.get("/", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const { cohortId, role } = req.query;
  const users = await db.select().from(usersTable);
  let filtered = users;
  if (cohortId) filtered = filtered.filter((u) => u.cohortId === parseInt(cohortId as string));
  if (role) filtered = filtered.filter((u) => u.role === role);
  res.json(filtered.map(formatUser));
});

router.post("/", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const { username, displayName, email, password, role, cohortId, rotationGroup } = req.body;
  if (!username || !displayName || !password || !role) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }

  const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (existing) {
    res.status(400).json({ error: "Username already taken" });
    return;
  }

  const [user] = await db
    .insert(usersTable)
    .values({
      username,
      displayName,
      email,
      passwordHash: hashPassword(password),
      role,
      cohortId: cohortId ?? null,
      rotationGroup: rotationGroup ?? null,
      giesBalance: "1000",
    })
    .returning();

  res.status(201).json(formatUser(user));
});

// ---- Rotation lever ----------------------------------------------------------
// Activate one rotation group as market makers; revert every other grouped
// participant to student. Teacher/admin and ungrouped seed accounts are untouched.
// NOTE: declared before "/:userId/..." so it isn't captured as a userId route.
router.post("/rotation/activate", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const group = parseInt(req.body?.group);
  if (![1, 2, 3].includes(group)) {
    res.status(400).json({ error: "group must be 1, 2, or 3" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    // Promote the active group's students to market makers.
    const promoted = await tx
      .update(usersTable)
      .set({ role: "market_maker" })
      .where(and(eq(usersTable.rotationGroup, group), inArray(usersTable.role, ["student", "market_maker"])))
      .returning({ id: usersTable.id });

    // Return everyone else who is currently a grouped market maker to student.
    const demoted = await tx
      .update(usersTable)
      .set({ role: "student" })
      .where(and(ne(usersTable.rotationGroup, group), isNotNull(usersTable.rotationGroup), eq(usersTable.role, "market_maker")))
      .returning({ id: usersTable.id });

    return { promoted: promoted.length, demoted: demoted.length };
  });

  res.json({ activeGroup: group, marketMakers: result.promoted, revertedToStudent: result.demoted });
});

router.get("/:userId", authMiddleware, requireAuth, async (req, res) => {
  const userId = parseInt(req.params.userId);
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(user));
});

router.patch("/:userId", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const userId = parseInt(req.params.userId);
  const { displayName, email, role, cohortId, rotationGroup } = req.body;

  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (displayName !== undefined) updates.displayName = displayName;
  if (email !== undefined) updates.email = email;
  if (role !== undefined) updates.role = role;
  if (cohortId !== undefined) updates.cohortId = cohortId;
  if (rotationGroup !== undefined) updates.rotationGroup = rotationGroup;

  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(updated));
});

router.post("/:userId/promote", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const userId = parseInt(req.params.userId);
  const [updated] = await db.update(usersTable).set({ role: "market_maker" }).where(eq(usersTable.id, userId)).returning();
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(updated));
});

// ---- Teacher-initiated password reset ----------------------------------------
// Sets (or generates) a temporary password and returns it so the instructor can
// hand it to the student. Student should change it via /auth/change-password.
router.post("/:userId/reset-password", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const userId = parseInt(req.params.userId);
  const provided = req.body?.newPassword;
  if (provided !== undefined && String(provided).length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  const tempPassword = provided ? String(provided) : generateTempPassword();

  const [updated] = await db
    .update(usersTable)
    .set({ passwordHash: hashPassword(tempPassword) })
    .where(eq(usersTable.id, userId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ userId: updated.id, username: updated.username, tempPassword });
});

export default router;
