import { Router } from "express";
import { db, marketIdeasTable, marketIdeaVotesTable, usersTable } from "@workspace/db";
import { eq, desc, and, count, sql } from "drizzle-orm";
import { authMiddleware, requireAuth, canTeach } from "../lib/auth.js";
import { evaluateAndAwardBadges } from "../lib/badges.js";

const router = Router();

router.get("/ideas", authMiddleware, requireAuth, async (req, res) => {
  const { status } = req.query;
  const userId = req.user!.id;

  const rows = await db
    .select({
      idea: marketIdeasTable,
      submitterUsername: usersTable.username,
      submitterDisplay: usersTable.displayName,
      voteCount: count(marketIdeaVotesTable.id),
    })
    .from(marketIdeasTable)
    .leftJoin(marketIdeaVotesTable, eq(marketIdeaVotesTable.ideaId, marketIdeasTable.id))
    .innerJoin(usersTable, eq(usersTable.id, marketIdeasTable.submittedBy))
    .groupBy(marketIdeasTable.id, usersTable.username, usersTable.displayName)
    .orderBy(desc(count(marketIdeaVotesTable.id)), desc(marketIdeasTable.createdAt));

  const filtered = status
    ? rows.filter(r => r.idea.status === status)
    : rows;

  const ideaIds = filtered.map(r => r.idea.id);
  const userVotes = ideaIds.length > 0
    ? await db
        .select({ ideaId: marketIdeaVotesTable.ideaId })
        .from(marketIdeaVotesTable)
        .where(eq(marketIdeaVotesTable.userId, userId))
    : [];

  const votedSet = new Set(userVotes.map(v => v.ideaId));

  res.json(filtered.map(({ idea: i, submitterUsername, submitterDisplay, voteCount }) => ({
    id: i.id,
    title: i.title,
    description: i.description,
    category: i.category,
    status: i.status,
    reviewNote: i.reviewNote,
    submittedBy: i.submittedBy,
    submitterUsername,
    submitterDisplay,
    cohortId: i.cohortId,
    voteCount,
    userVoted: votedSet.has(i.id),
    createdAt: i.createdAt,
  })));
});

router.post("/ideas", authMiddleware, requireAuth, async (req, res) => {
  const { title, description, category } = req.body;

  if (!title?.trim()) {
    res.status(400).json({ error: "Title is required" });
    return;
  }
  if (!description?.trim()) {
    res.status(400).json({ error: "Description is required" });
    return;
  }
  if (title.trim().length > 120) {
    res.status(400).json({ error: "Title must be 120 characters or fewer" });
    return;
  }
  if (description.trim().length > 1000) {
    res.status(400).json({ error: "Description must be 1000 characters or fewer" });
    return;
  }

  const [idea] = await db.insert(marketIdeasTable).values({
    title: title.trim(),
    description: description.trim(),
    category: category?.trim() || "general",
    submittedBy: req.user!.id,
  }).returning();

  evaluateAndAwardBadges(req.user!.id).catch(console.error);
  res.status(201).json({
    id: idea.id,
    title: idea.title,
    description: idea.description,
    category: idea.category,
    status: idea.status,
    submittedBy: idea.submittedBy,
    voteCount: 0,
    userVoted: false,
    createdAt: idea.createdAt,
  });
});

router.post("/ideas/:id/vote", authMiddleware, requireAuth, async (req, res) => {
  const ideaId = parseInt(String(req.params.id));
  if (isNaN(ideaId)) {
    res.status(400).json({ error: "Invalid idea ID" });
    return;
  }

  const [idea] = await db.select().from(marketIdeasTable).where(eq(marketIdeasTable.id, ideaId)).limit(1);
  if (!idea) {
    res.status(404).json({ error: "Idea not found" });
    return;
  }

  const [existing] = await db
    .select()
    .from(marketIdeaVotesTable)
    .where(and(eq(marketIdeaVotesTable.ideaId, ideaId), eq(marketIdeaVotesTable.userId, req.user!.id)))
    .limit(1);

  if (existing) {
    await db.delete(marketIdeaVotesTable).where(eq(marketIdeaVotesTable.id, existing.id));
    res.json({ voted: false });
  } else {
    await db.insert(marketIdeaVotesTable).values({ ideaId, userId: req.user!.id });
    evaluateAndAwardBadges(req.user!.id).catch(console.error);
    res.json({ voted: true });
  }
});

router.patch("/ideas/:id", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const ideaId = parseInt(String(req.params.id));
  if (isNaN(ideaId)) {
    res.status(400).json({ error: "Invalid idea ID" });
    return;
  }

  const { status, reviewNote } = req.body;
  if (!["approved", "rejected"].includes(status)) {
    res.status(400).json({ error: "Status must be 'approved' or 'rejected'" });
    return;
  }

  const [updated] = await db
    .update(marketIdeasTable)
    .set({ status, reviewNote: reviewNote?.trim() || null, reviewedBy: req.user!.id })
    .where(eq(marketIdeasTable.id, ideaId))
    .returning();

  if (!updated) {
    res.status(404).json({ error: "Idea not found" });
    return;
  }

  res.json({ id: updated.id, status: updated.status, reviewNote: updated.reviewNote });
});

export default router;
