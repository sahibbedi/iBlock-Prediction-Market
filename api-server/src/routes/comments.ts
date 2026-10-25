import { Router } from "express";
import { db, marketCommentsTable, usersTable, positionsTable } from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import { authMiddleware, requireParticipant, requireActive, requireAuth } from "../lib/auth.js";
import { evaluateAndAwardBadges } from "../lib/badges.js";

const router = Router();

function buildPositionLabel(yesAmt: number, noAmt: number): string {
  if (yesAmt > 0 && noAmt > 0) {
    return yesAmt >= noAmt ? `${yesAmt.toFixed(0)} YES tokens` : `${noAmt.toFixed(0)} NO tokens`;
  }
  if (yesAmt > 0) return `${yesAmt.toFixed(0)} YES tokens`;
  if (noAmt > 0) return `${noAmt.toFixed(0)} NO tokens`;
  return "No position";
}

router.get("/markets/:marketId/comments", authMiddleware, async (req, res) => {
  const marketId = parseInt(String(req.params.marketId));
  if (isNaN(marketId) || marketId <= 0) {
    res.status(400).json({ error: "Invalid market ID" });
    return;
  }

  const rawLimit = parseInt((req.query.limit as string) || "20");
  const rawOffset = parseInt((req.query.offset as string) || "0");
  const limit = isNaN(rawLimit) || rawLimit <= 0 ? 20 : Math.min(rawLimit, 100);
  const offset = isNaN(rawOffset) || rawOffset < 0 ? 0 : rawOffset;

  const comments = await db
    .select({
      comment: marketCommentsTable,
      username: usersTable.username,
      displayName: usersTable.displayName,
    })
    .from(marketCommentsTable)
    .innerJoin(usersTable, eq(usersTable.id, marketCommentsTable.userId))
    .where(eq(marketCommentsTable.marketId, marketId))
    .orderBy(desc(marketCommentsTable.createdAt))
    .limit(limit)
    .offset(offset);

  const commenterIds = [...new Set(comments.map(c => c.comment.userId))];

  const positions = commenterIds.length > 0
    ? await db
        .select()
        .from(positionsTable)
        .where(
          and(
            eq(positionsTable.marketId, marketId),
            inArray(positionsTable.userId, commenterIds)
          )
        )
    : [];

  const positionsByUser: Record<number, { yes: number; no: number }> = {};
  for (const pos of positions) {
    if (!positionsByUser[pos.userId]) {
      positionsByUser[pos.userId] = { yes: 0, no: 0 };
    }
    if (pos.outcome === "yes") {
      positionsByUser[pos.userId].yes = parseFloat(pos.tokenAmount);
    } else if (pos.outcome === "no") {
      positionsByUser[pos.userId].no = parseFloat(pos.tokenAmount);
    }
  }

  const result = comments.map(c => {
    const userPos = positionsByUser[c.comment.userId];
    const positionLabel = userPos
      ? buildPositionLabel(userPos.yes || 0, userPos.no || 0)
      : "No position";

    return {
      id: c.comment.id,
      marketId: c.comment.marketId,
      userId: c.comment.userId,
      username: c.username,
      displayName: c.displayName,
      text: c.comment.text,
      createdAt: c.comment.createdAt,
      positionLabel,
    };
  });

  res.json(result);
});

router.post("/markets/:marketId/comments", authMiddleware, requireAuth, requireParticipant, requireActive, async (req, res) => {
  const marketId = parseInt(String(req.params.marketId));
  if (isNaN(marketId) || marketId <= 0) {
    res.status(400).json({ error: "Invalid market ID" });
    return;
  }
  const { text } = req.body;

  if (!text || !text.trim()) {
    res.status(400).json({ error: "Comment text is required" });
    return;
  }

  if (text.trim().length > 1000) {
    res.status(400).json({ error: "Comment must be 1000 characters or fewer" });
    return;
  }

  const [comment] = await db
    .insert(marketCommentsTable)
    .values({
      marketId,
      userId: req.user!.id,
      text: text.trim(),
    })
    .returning();

  const [user] = await db
    .select({ username: usersTable.username, displayName: usersTable.displayName })
    .from(usersTable)
    .where(eq(usersTable.id, req.user!.id))
    .limit(1);

  const positions = await db
    .select()
    .from(positionsTable)
    .where(
      and(
        eq(positionsTable.marketId, marketId),
        eq(positionsTable.userId, req.user!.id)
      )
    );

  const yes = positions.find(p => p.outcome === "yes");
  const no = positions.find(p => p.outcome === "no");
  const yesAmt = yes ? parseFloat(yes.tokenAmount) : 0;
  const noAmt = no ? parseFloat(no.tokenAmount) : 0;
  const positionLabel = buildPositionLabel(yesAmt, noAmt);
  evaluateAndAwardBadges(req.user!.id).catch(console.error);

  res.status(201).json({
    id: comment.id,
    marketId: comment.marketId,
    userId: comment.userId,
    username: user.username,
    displayName: user.displayName,
    text: comment.text,
    createdAt: comment.createdAt,
    positionLabel,
  });
});

router.delete("/comments/:commentId", authMiddleware, requireAuth, async (req, res) => {
  const commentId = parseInt(String(req.params.commentId));
  if (isNaN(commentId) || commentId <= 0) {
    res.status(400).json({ error: "Invalid comment ID" });
    return;
  }

  const [comment] = await db
    .select()
    .from(marketCommentsTable)
    .where(eq(marketCommentsTable.id, commentId))
    .limit(1);

  if (!comment) {
    res.status(404).json({ error: "Comment not found" });
    return;
  }

  const isOwner = comment.userId === req.user!.id;
  const isPrivileged = ["admin"].includes(req.user!.role);

  if (!isOwner && !isPrivileged) {
    res.status(403).json({ error: "You can only delete your own comments" });
    return;
  }

  await db.delete(marketCommentsTable).where(eq(marketCommentsTable.id, commentId));
  res.status(204).send();
});

export default router;
