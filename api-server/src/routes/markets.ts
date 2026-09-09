import { Router } from "express";
import { db, marketsTable, tradesTable, priceHistoryTable, usersTable, transactionsTable, marketCommentsTable, lpPositionsTable } from "@workspace/db";
import { eq, desc, and, count } from "drizzle-orm";
import { authMiddleware, requireAuth, canTeach, generateTxHash } from "../lib/auth.js";
import { getPrice, computeEffectivePools } from "../lib/amm.js";

const router = Router();

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

router.post("/", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const { title, description, resolutionCriteria, learningPanel, category, cohortId, initialLiquidity, resolvesAt, maxPriceImpact, minPoolDepth, maxTradeSizePct, virtualLiquidity, virtualLiquidityDecayVolume } = req.body;
  if (!title || !description || !initialLiquidity) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  if (!resolutionCriteria || !resolutionCriteria.trim()) {
    res.status(400).json({ error: "Resolution criteria is required" });
    return;
  }

  if (maxPriceImpact !== undefined) {
    const v = parseFloat(maxPriceImpact);
    if (!isFinite(v) || v <= 0 || v >= 1) {
      res.status(400).json({ error: "maxPriceImpact must be a number between 0 and 1 (exclusive)" });
      return;
    }
  }
  if (minPoolDepth !== undefined) {
    const v = parseFloat(minPoolDepth);
    if (!isFinite(v) || v <= 0) {
      res.status(400).json({ error: "minPoolDepth must be a positive number" });
      return;
    }
  }
  if (maxTradeSizePct !== undefined) {
    const v = parseFloat(maxTradeSizePct);
    if (!isFinite(v) || v <= 0 || v > 1) {
      res.status(400).json({ error: "maxTradeSizePct must be a number between 0 and 1 (inclusive)" });
      return;
    }
  }
  if (virtualLiquidity !== undefined) {
    const v = parseFloat(virtualLiquidity);
    if (!isFinite(v) || v < 0) {
      res.status(400).json({ error: "virtualLiquidity must be a non-negative number" });
      return;
    }
  }
  if (virtualLiquidityDecayVolume !== undefined) {
    const v = parseFloat(virtualLiquidityDecayVolume);
    if (!isFinite(v) || v <= 0) {
      res.status(400).json({ error: "virtualLiquidityDecayVolume must be a positive number" });
      return;
    }
  }

  const teacher = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
  const teacherBalance = parseFloat(teacher[0].giesBalance);
  if (teacherBalance < initialLiquidity) {
    res.status(400).json({ error: "Insufficient balance for initial liquidity" });
    return;
  }

  // Closed-loop init (FPMM): lock the creator's GIES in the vault and mint an
  // equal number of complete sets (1 GIES -> 1 YES + 1 NO) into the reserves.
  // Reserves = supply = vault = initialLiquidity, so the market starts fully
  // collateralized at a 50/50 price.
  const liquidity = parseFloat(initialLiquidity);

  const insertValues: typeof marketsTable.$inferInsert = {
    title,
    description,
    resolutionCriteria: resolutionCriteria || "",
    learningPanel: learningPanel || null,
    category: category || "general",
    cohortId: cohortId || null,
    creatorId: req.user!.id,
    status: "open",
    yesPool: liquidity.toFixed(6),
    noPool: liquidity.toFixed(6),
    totalLiquidity: liquidity.toFixed(6),
    lpShares: liquidity.toFixed(6),
    vaultCollateral: liquidity.toFixed(6),
    totalYesSupply: liquidity.toFixed(6),
    totalNoSupply: liquidity.toFixed(6),
    resolvesAt: resolvesAt ? new Date(resolvesAt) : null,
    ...(maxPriceImpact !== undefined && { maxPriceImpact: parseFloat(maxPriceImpact).toFixed(4) }),
    ...(minPoolDepth !== undefined && { minPoolDepth: parseFloat(minPoolDepth).toFixed(6) }),
    ...(maxTradeSizePct !== undefined && { maxTradeSizePct: parseFloat(maxTradeSizePct).toFixed(4) }),
    ...(virtualLiquidity !== undefined && { virtualLiquidity: parseFloat(virtualLiquidity).toFixed(6) }),
    ...(virtualLiquidityDecayVolume !== undefined && { virtualLiquidityDecayVolume: parseFloat(virtualLiquidityDecayVolume).toFixed(6) }),
  };

  const market = await db.transaction(async (tx) => {
    const [created] = await tx.insert(marketsTable).values(insertValues).returning();

    await tx.update(usersTable)
      .set({ giesBalance: (teacherBalance - liquidity).toFixed(6) })
      .where(eq(usersTable.id, req.user!.id));

    // Creator owns 100% of the initial liquidity.
    await tx.insert(lpPositionsTable).values({
      userId: req.user!.id,
      marketId: created.id,
      lpShares: liquidity.toFixed(6),
      totalGiesProvided: liquidity.toFixed(6),
    });

    await tx.insert(priceHistoryTable).values({
      marketId: created.id,
      yesPrice: "0.5",
      noPrice: "0.5",
      volume: "0",
    });

    return created;
  });

  res.status(201).json(formatMarket(market));
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

router.post("/:marketId/resolve", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const marketId = parseInt(String(req.params.marketId));
  const { outcome } = req.body;

  if (!["yes", "no"].includes(outcome)) {
    res.status(400).json({ error: "Outcome must be 'yes' or 'no'" });
    return;
  }

  const [market] = await db.select().from(marketsTable).where(eq(marketsTable.id, marketId)).limit(1);
  if (!market) {
    res.status(404).json({ error: "Market not found" });
    return;
  }
  if (market.status === "resolved") {
    res.status(400).json({ error: "Market already resolved" });
    return;
  }

  const [updated] = await db.update(marketsTable)
    .set({ status: "resolved", outcome })
    .where(eq(marketsTable.id, marketId))
    .returning();

  res.json(formatMarket(updated));
});

router.post("/:marketId/close", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const marketId = parseInt(String(req.params.marketId));
  const [updated] = await db.update(marketsTable)
    .set({ status: "closed" })
    .where(eq(marketsTable.id, marketId))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "Market not found" });
    return;
  }
  res.json(formatMarket(updated));
});

router.patch("/:marketId/safeguards", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const marketId = parseInt(String(req.params.marketId));
  const { maxPriceImpact, minPoolDepth, maxTradeSizePct, virtualLiquidity, virtualLiquidityDecayVolume } = req.body;

  if (maxPriceImpact !== undefined) {
    const v = parseFloat(maxPriceImpact);
    if (!isFinite(v) || v <= 0 || v >= 1) {
      res.status(400).json({ error: "maxPriceImpact must be a number between 0 and 1 (exclusive)" });
      return;
    }
  }
  if (minPoolDepth !== undefined) {
    const v = parseFloat(minPoolDepth);
    if (!isFinite(v) || v <= 0) {
      res.status(400).json({ error: "minPoolDepth must be a positive number" });
      return;
    }
  }
  if (maxTradeSizePct !== undefined) {
    const v = parseFloat(maxTradeSizePct);
    if (!isFinite(v) || v <= 0 || v > 1) {
      res.status(400).json({ error: "maxTradeSizePct must be a number between 0 and 1 (inclusive)" });
      return;
    }
  }
  if (virtualLiquidity !== undefined) {
    const v = parseFloat(virtualLiquidity);
    if (!isFinite(v) || v < 0) {
      res.status(400).json({ error: "virtualLiquidity must be a non-negative number" });
      return;
    }
  }
  if (virtualLiquidityDecayVolume !== undefined) {
    const v = parseFloat(virtualLiquidityDecayVolume);
    if (!isFinite(v) || v <= 0) {
      res.status(400).json({ error: "virtualLiquidityDecayVolume must be a positive number" });
      return;
    }
  }

  if (
    maxPriceImpact === undefined &&
    minPoolDepth === undefined &&
    maxTradeSizePct === undefined &&
    virtualLiquidity === undefined &&
    virtualLiquidityDecayVolume === undefined
  ) {
    res.status(400).json({ error: "At least one field must be provided" });
    return;
  }

  const [market] = await db.select().from(marketsTable).where(eq(marketsTable.id, marketId)).limit(1);
  if (!market) {
    res.status(404).json({ error: "Market not found" });
    return;
  }

  type UpdateFields = Pick<typeof marketsTable.$inferInsert, "maxPriceImpact" | "minPoolDepth" | "maxTradeSizePct" | "virtualLiquidity" | "virtualLiquidityDecayVolume">;
  const updates: Partial<UpdateFields> = {
    ...(maxPriceImpact !== undefined && { maxPriceImpact: parseFloat(maxPriceImpact).toFixed(4) }),
    ...(minPoolDepth !== undefined && { minPoolDepth: parseFloat(minPoolDepth).toFixed(6) }),
    ...(maxTradeSizePct !== undefined && { maxTradeSizePct: parseFloat(maxTradeSizePct).toFixed(4) }),
    ...(virtualLiquidity !== undefined && { virtualLiquidity: parseFloat(virtualLiquidity).toFixed(6) }),
    ...(virtualLiquidityDecayVolume !== undefined && { virtualLiquidityDecayVolume: parseFloat(virtualLiquidityDecayVolume).toFixed(6) }),
  };

  const [updated] = await db.update(marketsTable)
    .set(updates)
    .where(eq(marketsTable.id, marketId))
    .returning();

  res.json(formatMarket(updated));
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
