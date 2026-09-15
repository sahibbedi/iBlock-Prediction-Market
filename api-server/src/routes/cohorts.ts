import { Router } from "express";
import { db, cohortsTable, cohortMembersTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { authMiddleware, requireAuth, canTeach } from "../lib/auth.js";

const router = Router();

router.get("/", authMiddleware, requireAuth, async (req, res) => {
  const cohorts = await db.select().from(cohortsTable);
  const result = await Promise.all(cohorts.map(async (cohort) => {
    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(cohortMembersTable)
      .where(eq(cohortMembersTable.cohortId, cohort.id));
    return {
      id: cohort.id,
      name: cohort.name,
      description: cohort.description,
      teacherId: cohort.teacherId,
      memberCount: Number(count),
      createdAt: cohort.createdAt,
    };
  }));
  res.json(result);
});

router.post("/", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const { name, description } = req.body;
  if (!name) {
    res.status(400).json({ error: "Name is required" });
    return;
  }

  const [cohort] = await db.insert(cohortsTable).values({
    name,
    description,
    teacherId: req.user!.id,
  }).returning();

  res.status(201).json({
    id: cohort.id,
    name: cohort.name,
    description: cohort.description,
    teacherId: cohort.teacherId,
    memberCount: 0,
    createdAt: cohort.createdAt,
  });
});

router.get("/:cohortId", authMiddleware, requireAuth, async (req, res) => {
  const cohortId = parseInt(String(req.params.cohortId));
  const [cohort] = await db.select().from(cohortsTable).where(eq(cohortsTable.id, cohortId)).limit(1);
  if (!cohort) {
    res.status(404).json({ error: "Cohort not found" });
    return;
  }

  const [{ count }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(cohortMembersTable)
    .where(eq(cohortMembersTable.cohortId, cohortId));

  res.json({
    id: cohort.id,
    name: cohort.name,
    description: cohort.description,
    teacherId: cohort.teacherId,
    memberCount: Number(count),
    createdAt: cohort.createdAt,
  });
});

router.get("/:cohortId/members", authMiddleware, requireAuth, async (req, res) => {
  const cohortId = parseInt(String(req.params.cohortId));
  const members = await db
    .select({ user: usersTable })
    .from(cohortMembersTable)
    .innerJoin(usersTable, eq(usersTable.id, cohortMembersTable.userId))
    .where(eq(cohortMembersTable.cohortId, cohortId));

  res.json(members.map(m => ({
    id: m.user.id,
    username: m.user.username,
    displayName: m.user.displayName,
    email: m.user.email,
    role: m.user.role,
    cohortId: m.user.cohortId,
    giesBalance: parseFloat(m.user.giesBalance),
    createdAt: m.user.createdAt,
  })));
});

router.post("/:cohortId/members", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const cohortId = parseInt(String(req.params.cohortId));
  const { userId } = req.body;

  await db.insert(cohortMembersTable).values({ cohortId, userId }).onConflictDoNothing();
  await db.update(usersTable).set({ cohortId }).where(eq(usersTable.id, userId));

  res.json({ message: "Member added to cohort" });
});

export default router;
