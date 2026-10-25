import { Router } from "express";
import { db, usersTable, positionsTable, marketsTable, tradesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { authMiddleware, requireAuth } from "../lib/auth.js";
import { getPrice } from "../lib/amm.js";
import { getBadgeCountsByUsers } from "../lib/badges.js";

const router = Router();

// Every participant starts with this personal (taker) balance. P&L on the
// leaderboard is measured against it. KEEP IN SYNC with TAKER_START_BALANCE
// in routes/auth.ts. (Maker desk capital is graded separately, so the board
// reflects personal trading performance only.)
const STARTING_ALLOCATION = 5000;

router.get("/", authMiddleware, requireAuth, async (req, res) => {
  const { cohortId } = req.query;

  const users = await db.select().from(usersTable);
  const filtered = users.filter((u) => {
    // Only participants compete; committee accounts are operators.
    if (u.role !== "trader" && u.role !== "market_maker") return false;
    if (cohortId) return u.cohortId === parseInt(cohortId as string);
    return true;
  });

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
      totalPnl: portfolioValue - STARTING_ALLOCATION,
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
