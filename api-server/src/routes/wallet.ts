import { Router } from "express";
import { db, usersTable, transactionsTable, positionsTable, marketsTable } from "@workspace/db";
import { eq, and, desc } from "drizzle-orm";
import { authMiddleware, requireAuth, requireParticipant, generateTxHash } from "../lib/auth.js";
import { getPrice } from "../lib/amm.js";

const router = Router();
function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

router.get("/balance", authMiddleware, requireAuth, async (req, res) => {
  if (!req.user!.id) return void res.json({ giesBalance: 0, deskBalance: 0, role: "observer", totalPortfolioValue: 0, unrealizedPnl: 0, realizedPnl: 0 });
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
  const giesBalance = parseFloat(user.giesBalance);

  const positions = await db
    .select({ pos: positionsTable, market: marketsTable })
    .from(positionsTable)
    .innerJoin(marketsTable, eq(marketsTable.id, positionsTable.marketId))
    .where(eq(positionsTable.userId, req.user!.id));

  let totalPortfolioValue = giesBalance;
  let unrealizedPnl = 0;
  let realizedPnl = 0;

  for (const { pos, market } of positions) {
    realizedPnl += parseFloat(pos.realizedPnl);

    const tokens = parseFloat(pos.tokenAmount);
    if (tokens <= 0) continue;

    const costBasis = parseFloat(pos.totalCostBasis);
    let currentValue: number;
    if (market.status === "resolved") {
      const payoutPrice = market.outcome === pos.outcome ? 1 : 0;
      currentValue = tokens * payoutPrice;
    } else {
      const { yesPrice, noPrice } = getPrice(parseFloat(market.yesPool), parseFloat(market.noPool));
      const currentPrice = pos.outcome === "yes" ? yesPrice : noPrice;
      currentValue = tokens * currentPrice;
    }
    totalPortfolioValue += currentValue;
    unrealizedPnl += currentValue - costBasis;
  }

  res.json({
    giesBalance,
    deskBalance: parseFloat(user.deskBalance),
    role: user.role,
    totalPortfolioValue,
    unrealizedPnl,
    realizedPnl,
  });
});

router.get("/transactions", authMiddleware, requireAuth, async (req, res) => {
  const limit = parseInt((req.query.limit as string) || "50");
  const txs = await db
    .select()
    .from(transactionsTable)
    .where(eq(transactionsTable.userId, req.user!.id))
    .orderBy(desc(transactionsTable.createdAt))
    .limit(limit);

  res.json(txs.map(tx => ({
    id: tx.id,
    type: tx.type,
    amount: parseFloat(tx.amount),
    description: tx.description,
    txHash: tx.txHash,
    marketId: tx.marketId,
    createdAt: tx.createdAt,
  })));
});

router.get("/positions", authMiddleware, requireAuth, async (req, res) => {
  const positions = await db
    .select({ pos: positionsTable, market: marketsTable })
    .from(positionsTable)
    .innerJoin(marketsTable, eq(marketsTable.id, positionsTable.marketId))
    .where(eq(positionsTable.userId, req.user!.id));

  const result = positions
    .filter(({ pos }) => parseFloat(pos.tokenAmount) > 0.000001)
    .map(({ pos, market }) => {
      const tokens = parseFloat(pos.tokenAmount);
      const yesPool = parseFloat(market.yesPool);
      const noPool = parseFloat(market.noPool);
      const { yesPrice, noPrice } = getPrice(yesPool, noPool);
      const currentPrice = pos.outcome === "yes" ? yesPrice : noPrice;
      const currentValue = market.status === "resolved"
        ? tokens * (market.outcome === pos.outcome ? 1 : 0)
        : tokens * currentPrice;
      const costBasis = parseFloat(pos.totalCostBasis);
      const avgCostBasis = tokens > 0 ? costBasis / tokens : 0;

      return {
        marketId: market.id,
        marketTitle: market.title,
        marketStatus: market.status,
        outcome: pos.outcome,
        tokenAmount: tokens,
        avgCostBasis,
        currentValue,
        unrealizedPnl: currentValue - costBasis,
      };
    });

  res.json(result);
});

router.post("/redeem", authMiddleware, requireAuth, requireParticipant, async (req, res) => {
  const { marketId, outcome } = req.body;

  if (outcome !== "yes" && outcome !== "no") {
    res.status(400).json({ error: "outcome must be 'yes' or 'no'" });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [market] = await tx.select().from(marketsTable)
        .where(eq(marketsTable.id, marketId)).for("update").limit(1);
      if (!market) throw httpError(404, "Market not found");
      if (market.status !== "resolved") throw httpError(400, "Market has not been resolved yet");

      const [pos] = await tx.select().from(positionsTable)
        .where(and(
          eq(positionsTable.userId, req.user!.id),
          eq(positionsTable.marketId, marketId),
          eq(positionsTable.outcome, outcome)
        ))
        .for("update").limit(1);
      if (!pos || parseFloat(pos.tokenAmount) <= 0) throw httpError(400, "No tokens to redeem");

      const [user] = await tx.select().from(usersTable)
        .where(eq(usersTable.id, req.user!.id)).for("update").limit(1);

      const tokens = parseFloat(pos.tokenAmount);
      const payoutPerToken = market.outcome === outcome ? 1 : 0;
      const payout = tokens * payoutPerToken;
      const realizedGain = payout - parseFloat(pos.totalCostBasis);
      const newBalance = parseFloat(user.giesBalance) + payout;
      const txHash = generateTxHash();

      const vaultCollateral = parseFloat(market.vaultCollateral);
      if (vaultCollateral + 1e-6 < payout) throw httpError(500, "Vault has insufficient collateral (this should never happen)");
      const currentSupply = parseFloat(outcome === "yes" ? market.totalYesSupply : market.totalNoSupply);

      // Burn the redeemed claims and pay the winner from the vault.
      await tx.update(positionsTable)
        .set({
          tokenAmount: "0",
          totalCostBasis: "0",
          realizedPnl: (parseFloat(pos.realizedPnl) + realizedGain).toFixed(6),
          updatedAt: new Date(),
        })
        .where(eq(positionsTable.id, pos.id));

      await tx.update(usersTable)
        .set({ giesBalance: newBalance.toFixed(6) })
        .where(eq(usersTable.id, req.user!.id));

      await tx.update(marketsTable)
        .set({
          vaultCollateral: (vaultCollateral - payout).toFixed(6),
          ...(outcome === "yes"
            ? { totalYesSupply: (currentSupply - tokens).toFixed(6) }
            : { totalNoSupply: (currentSupply - tokens).toFixed(6) }),
        })
        .where(eq(marketsTable.id, marketId));

      await tx.insert(transactionsTable).values({
        userId: req.user!.id,
        type: "redeem",
        amount: payout.toFixed(6),
        description: `Redeemed ${tokens.toFixed(2)} ${outcome.toUpperCase()} tokens from "${market.title}"`,
        txHash,
        marketId,
      });

      return { tokensRedeemed: tokens, giesReceived: payout, realizedPnl: realizedGain, newBalance };
    });

    res.json(result);
  } catch (err: any) {
    res.status(err.status ?? 400).json({ error: err.message });
  }
});

export default router;
