import { Router } from "express";
import { db, usersTable, positionsTable, marketsTable, tradesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { authMiddleware, requireAuth } from "../lib/auth.js";
import { getPrice } from "../lib/amm.js";
import { getBadgeCountsByUsers } from "../lib/badges.js";

const router = Router();

router.get("/", authMiddleware, requireAuth, async (req, res) => {
  const { cohortId } = req.query;

  const users = await db.select().from(usersTable);
  const filtered = cohortId
    ? users.filter(u => u.cohortId === parseInt(cohortId as string))
    : users;

  const entries = await Promise.all(filtered.map(async (user) => {
    const giesBalance = parseFloat(user.giesBalance);

    const positions = await db
      .select({ pos: positionsTable, market: marketsTable })
      .from(positionsTable)
      .innerJoin(marketsTable, eq(marketsTable.id, positionsTable.marketId))
      .where(eq(positionsTable.userId, user.id));

    let portfolioValue = giesBalance;
    let totalCost = 0;

    for (const { pos, market } of positions) {
      const tokens = parseFloat(pos.tokenAmount);
      if (tokens <= 0.000001) continue;
      const yesPool = parseFloat(market.yesPool);
      const noPool = parseFloat(market.noPool);
      const { yesPrice, noPrice } = getPrice(yesPool, noPool);
      const price = pos.outcome === "yes" ? yesPrice : noPrice;
      const value = market.status === "resolved"
        ? tokens * (market.outcome === pos.outcome ? 1 : 0)
        : tokens * price;
      portfolioValue += value;
      totalCost += parseFloat(pos.totalCostBasis);
    }

    const [{ count }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(tradesTable)
      .where(eq(tradesTable.userId, user.id));

    return {
      userId: user.id,
      username: user.username,
      displayName: user.displayName,
      giesBalance,
      totalPortfolioValue: portfolioValue,
      totalPnl: portfolioValue - 1000,
      tradesCount: Number(count),
      role: user.role,
    };
  }));

  entries.sort((a, b) => b.totalPortfolioValue - a.totalPortfolioValue);
  const badgeCounts = await getBadgeCountsByUsers(entries.map(e => e.userId));
  const result = entries.map((e, i) => ({
    ...e,
    rank: i + 1,
    badgeCount: badgeCounts.get(e.userId) ?? 0,
  }));

  res.json(result);
});

export default router;
