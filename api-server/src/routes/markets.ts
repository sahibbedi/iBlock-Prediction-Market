import { Router } from "express";
import { db, marketsTable, tradesTable, priceHistoryTable, usersTable, transactionsTable, marketCommentsTable, lpPositionsTable } from "@workspace/db";
import { eq, desc, and, count } from "drizzle-orm";
import { authMiddleware, requireAuth, requireAdmin, generateTxHash } from "../lib/auth.js";
import { getPrice, computeEffectivePools } from "../lib/amm.js";

const router = Router();
router.use((req, res, next) => {
  if (req.method !== "GET" && !req.path.endsWith("/reset-password")) return void res.status(409).json({ error: "Use /api/committee/proposals for committee approval" });
  next();
});

function formatMarket(m: typeof marketsTable.$inferSelect) {
  const yesPool = parseFloat(m.yesPool);
  const noPool = parseFloat(m.noPool);
  const totalVolume = parseFloat(m.totalVolume);
  const virtualLiquidity = parseFloat(m.virtualLiquidity ?? "0");
  const virtualLiquidityDecayVolume = parseFloat(m.virtualLiquidityDecayVolume ?? "1000");
  const { yesPrice, noPrice } = getPrice(yesPool, noPool);
  const { effectiveVirtualPerSide } = computeEffectivePools(
    yesPool, noPool, totalVolume, virtualLiquidity, virtualLiquidityDecayVolume
  );
  return {
    id: m.id,
    title: m.title,
    description: m.description,
    resolutionCriteria: m.resolutionCriteria,
    learningPanel: m.learningPanel,
    category: m.category,
    cohortId: m.cohortId,
    creatorId: m.creatorId,
    status: m.status,
    outcome: m.outcome,
    yesPrice,
    noPrice,
    totalVolume,
    totalLiquidity: parseFloat(m.totalLiquidity),
    resolvesAt: m.resolvesAt,
    createdAt: m.createdAt,
    tradingFeeRate: parseFloat(m.tradingFeeRate),
    maxPriceImpact: parseFloat(m.maxPriceImpact),
    minPoolDepth: parseFloat(m.minPoolDepth),
    maxTradeSizePct: parseFloat(m.maxTradeSizePct),
    virtualLiquidity,
    virtualLiquidityDecayVolume,
    effectiveVirtualLiquidity: effectiveVirtualPerSide * 2,
  };
}

router.get("/", authMiddleware, requireAuth, async (req, res) => {
  const { cohortId, status } = req.query;

  const rows = await db
    .select({
      market: marketsTable,
      commentCount: count(marketCommentsTable.id),
    })
    .from(marketsTable)
    .leftJoin(marketCommentsTable, eq(marketCommentsTable.marketId, marketsTable.id))
    .groupBy(marketsTable.id)
    .orderBy(desc(marketsTable.createdAt));

  let filtered = rows;
  if (cohortId) {
    filtered = filtered.filter(({ market: m }) => m.cohortId === parseInt(cohortId as string) || m.cohortId === null);
  }
  if (status) {
    filtered = filtered.filter(({ market: m }) => m.status === status);
  }

  res.json(filtered.map(({ market: m, commentCount }) => ({
    ...formatMarket(m),
    commentCount,
  })));
});

router.get("/:marketId", authMiddleware, requireAuth, async (req, res) => {
  const marketId = parseInt(String(req.params.marketId));
  const [market] = await db.select().from(marketsTable).where(eq(marketsTable.id, marketId)).limit(1);
  if (!market) {
    res.status(404).json({ error: "Market not found" });
    return;
  }

  const recentTrades = await db
    .select({
      trade: tradesTable,
      username: usersTable.username,
    })
    .from(tradesTable)
    .innerJoin(usersTable, eq(usersTable.id, tradesTable.userId))
    .where(eq(tradesTable.marketId, marketId))
    .orderBy(desc(tradesTable.createdAt))
    .limit(20);

  const formatted = {
    ...formatMarket(market),
    yesPool: parseFloat(market.yesPool),
    noPool: parseFloat(market.noPool),
    lpShares: parseFloat(market.lpShares),
    recentTrades: recentTrades.map(t => ({
      id: t.trade.id,
      marketId: t.trade.marketId,
      userId: t.trade.userId,
      username: t.username,
      side: t.trade.side,
      outcome: t.trade.outcome,
      tokenAmount: parseFloat(t.trade.tokenAmount),
      giesCost: parseFloat(t.trade.giesCost),
      pricePerToken: parseFloat(t.trade.pricePerToken),
      txHash: t.trade.txHash,
      createdAt: t.trade.createdAt,
    })),
  };

  res.json(formatted);
});

router.get("/:marketId/price-history", authMiddleware, requireAuth, async (req, res) => {
  const marketId = parseInt(String(req.params.marketId));
  const history = await db
    .select()
    .from(priceHistoryTable)
    .where(eq(priceHistoryTable.marketId, marketId))
    .orderBy(priceHistoryTable.createdAt);

  res.json(history.map(h => ({
    timestamp: h.createdAt,
    yesPrice: parseFloat(h.yesPrice),
    noPrice: parseFloat(h.noPrice),
    volume: parseFloat(h.volume),
  })));
});

router.get("/:marketId/trades", authMiddleware, requireAuth, async (req, res) => {
  const marketId = parseInt(String(req.params.marketId));
  const limit = parseInt((req.query.limit as string) || "50");

  const trades = await db
    .select({ trade: tradesTable, username: usersTable.username })
    .from(tradesTable)
    .innerJoin(usersTable, eq(usersTable.id, tradesTable.userId))
    .where(eq(tradesTable.marketId, marketId))
    .orderBy(desc(tradesTable.createdAt))
    .limit(limit);

  res.json(trades.map(t => ({
    id: t.trade.id,
    marketId: t.trade.marketId,
    userId: t.trade.userId,
    username: t.username,
    side: t.trade.side,
    outcome: t.trade.outcome,
    tokenAmount: parseFloat(t.trade.tokenAmount),
    giesCost: parseFloat(t.trade.giesCost),
    pricePerToken: parseFloat(t.trade.pricePerToken),
    txHash: t.trade.txHash,
    createdAt: t.trade.createdAt,
  })));
});

export default router;
