import { Router } from "express";
import { db, marketsTable, tradesTable, usersTable, positionsTable, transactionsTable, priceHistoryTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { authMiddleware, requireAuth, generateTxHash } from "../lib/auth.js";
import { quoteBuy, quoteSell, quoteBuyExactTokens, computeDynamicFeeRate, evaluateSafeguards } from "../lib/amm.js";
import { evaluateAndAwardBadges } from "../lib/badges.js";

const router = Router();

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

async function getOrCreatePosition(tx: any, userId: number, marketId: number, outcome: string) {
  const [existing] = await tx
    .select()
    .from(positionsTable)
    .where(and(
      eq(positionsTable.userId, userId),
      eq(positionsTable.marketId, marketId),
      eq(positionsTable.outcome, outcome)
    ))
    .for("update")
    .limit(1);

  if (existing) return existing;

  const [created] = await tx.insert(positionsTable).values({
    userId,
    marketId,
    outcome,
    tokenAmount: "0",
    totalCostBasis: "0",
  }).returning();
  return created;
}

router.post("/quote", authMiddleware, requireAuth, async (req, res) => {
  const { marketId, side, outcome, amount, amountType } = req.body;

  const [market] = await db.select().from(marketsTable).where(eq(marketsTable.id, marketId)).limit(1);
  if (!market) {
    res.status(404).json({ error: "Market not found" });
    return;
  }
  if (market.status !== "open") {
    res.status(400).json({ error: "Market is not open for trading" });
    return;
  }

  const yesPool = parseFloat(market.yesPool);
  const noPool = parseFloat(market.noPool);
  const baseFeeRate = parseFloat(market.tradingFeeRate);
  const effectiveFeeRate = computeDynamicFeeRate(yesPool, noPool, baseFeeRate);

  const safeguardParams = {
    maxPriceImpact: parseFloat(market.maxPriceImpact),
    minPoolDepth: parseFloat(market.minPoolDepth),
    maxTradeSizePct: parseFloat(market.maxTradeSizePct),
  };

  try {
    let quote;
    let tradeGies: number;
    if (side === "buy") {
      quote = amountType === "gies"
        ? quoteBuy(yesPool, noPool, outcome, amount, effectiveFeeRate)
        : quoteBuyExactTokens(yesPool, noPool, outcome, amount, effectiveFeeRate);
      tradeGies = quote.giesCost;
    } else {
      quote = quoteSell(yesPool, noPool, outcome, amount, effectiveFeeRate);
      tradeGies = Math.abs(quote.giesCost);
    }

    const safeguard = evaluateSafeguards(quote, yesPool, noPool, tradeGies, safeguardParams, false);

    res.json({
      tokenAmount: quote.tokenAmount,
      giesCost: quote.giesCost,
      pricePerToken: quote.pricePerToken,
      priceImpact: quote.priceImpact * 100,
      newYesPrice: quote.newYesPrice,
      newNoPrice: quote.newNoPrice,
      effectiveFeeRate,
      isBootstrapping: false,
      safeguardWarnings: safeguard.warnings,
      isBlocked: safeguard.isBlocked,
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/", authMiddleware, requireAuth, async (req, res) => {
  const { marketId, side, outcome, amount, amountType } = req.body;

  if (side !== "buy" && side !== "sell") {
    res.status(400).json({ error: "side must be 'buy' or 'sell'" });
    return;
  }
  if (outcome !== "yes" && outcome !== "no") {
    res.status(400).json({ error: "outcome must be 'yes' or 'no'" });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Lock market + user rows so concurrent trades serialize.
      const [market] = await tx.select().from(marketsTable)
        .where(eq(marketsTable.id, marketId)).for("update").limit(1);
      if (!market) throw httpError(404, "Market not found");
      if (market.status !== "open") throw httpError(400, "Market is not open for trading");

      const [user] = await tx.select().from(usersTable)
        .where(eq(usersTable.id, req.user!.id)).for("update").limit(1);
      const userBalance = parseFloat(user.giesBalance);

      const yesPool = parseFloat(market.yesPool);
      const noPool = parseFloat(market.noPool);
      const totalVolume = parseFloat(market.totalVolume);
      const vaultCollateral = parseFloat(market.vaultCollateral);
      const totalYesSupply = parseFloat(market.totalYesSupply);
      const totalNoSupply = parseFloat(market.totalNoSupply);
      const baseFeeRate = parseFloat(market.tradingFeeRate);
      const effectiveFeeRate = computeDynamicFeeRate(yesPool, noPool, baseFeeRate);
      const safeguardParams = {
        maxPriceImpact: parseFloat(market.maxPriceImpact),
        minPoolDepth: parseFloat(market.minPoolDepth),
        maxTradeSizePct: parseFloat(market.maxTradeSizePct),
      };

      const txHash = generateTxHash();

      if (side === "buy") {
        const quote = amountType === "gies"
          ? quoteBuy(yesPool, noPool, outcome, amount, effectiveFeeRate)
          : quoteBuyExactTokens(yesPool, noPool, outcome, amount, effectiveFeeRate);

        const safeguard = evaluateSafeguards(quote, yesPool, noPool, quote.giesCost, safeguardParams, false);
        if (safeguard.isBlocked) throw httpError(400, safeguard.warnings[0] || "Trade blocked by safeguard");
        if (userBalance < quote.giesCost) throw httpError(400, `Insufficient $GIES balance. Need ${quote.giesCost.toFixed(2)}, have ${userBalance.toFixed(2)}`);

        const position = await getOrCreatePosition(tx, req.user!.id, marketId, outcome);
        const currentTokens = parseFloat(position.tokenAmount);
        const currentCost = parseFloat(position.totalCostBasis);

        const [trade] = await tx.insert(tradesTable).values({
          marketId, userId: req.user!.id, side: "buy", outcome,
          tokenAmount: quote.tokenAmount.toFixed(6),
          giesCost: quote.giesCost.toFixed(6),
          pricePerToken: quote.pricePerToken.toFixed(6),
          txHash,
        }).returning();

        await tx.update(usersTable)
          .set({ giesBalance: (userBalance - quote.giesCost).toFixed(6) })
          .where(eq(usersTable.id, req.user!.id));

        await tx.update(positionsTable)
          .set({
            tokenAmount: (currentTokens + quote.tokenAmount).toFixed(6),
            totalCostBasis: (currentCost + quote.giesCost).toFixed(6),
            updatedAt: new Date(),
          })
          .where(eq(positionsTable.id, position.id));

        // Retain the trading fee in the pool so LP shares appreciate (fee = vaultDelta - supplyDelta).
        const fee = quote.vaultDelta - quote.supplyDelta;
        await tx.update(marketsTable)
          .set({
            yesPool: (quote.newYesPool + fee).toFixed(6),
            noPool: (quote.newNoPool + fee).toFixed(6),
            totalVolume: (totalVolume + quote.giesCost).toFixed(6),
            vaultCollateral: (vaultCollateral + quote.vaultDelta).toFixed(6),
            totalYesSupply: (totalYesSupply + quote.vaultDelta).toFixed(6),
            totalNoSupply: (totalNoSupply + quote.vaultDelta).toFixed(6),
            cumulativeFees: (parseFloat(market.cumulativeFees) + fee).toFixed(6),
          })
          .where(eq(marketsTable.id, marketId));

        await tx.insert(transactionsTable).values({
          userId: req.user!.id, type: "trade_buy",
          amount: (-quote.giesCost).toFixed(6),
          description: `Buy ${quote.tokenAmount.toFixed(2)} ${outcome.toUpperCase()} tokens on "${market.title}"`,
          txHash, marketId,
        });

        await tx.insert(priceHistoryTable).values({
          marketId,
          yesPrice: quote.newYesPrice.toFixed(6),
          noPrice: quote.newNoPrice.toFixed(6),
          volume: quote.giesCost.toFixed(6),
        });

        return {
          trade: {
            id: trade.id, marketId: trade.marketId, userId: trade.userId,
            username: user.username, side: trade.side, outcome: trade.outcome,
            tokenAmount: parseFloat(trade.tokenAmount),
            giesCost: parseFloat(trade.giesCost),
            pricePerToken: parseFloat(trade.pricePerToken),
            txHash: trade.txHash, createdAt: trade.createdAt,
          },
          newYesPrice: quote.newYesPrice,
          newNoPrice: quote.newNoPrice,
          newGiesBalance: userBalance - quote.giesCost,
          txHash,
        };
      } else {
        // SELL
        if (amountType !== "tokens") throw httpError(400, "Sells must be token-denominated (amountType: 'tokens')");

        const position = await getOrCreatePosition(tx, req.user!.id, marketId, outcome);
        const currentTokens = parseFloat(position.tokenAmount);
        const sellAmount = amount;
        if (currentTokens < sellAmount) throw httpError(400, `Insufficient token balance. Have ${currentTokens.toFixed(2)} ${outcome.toUpperCase()} tokens`);

        const avgCost = currentTokens > 0 ? parseFloat(position.totalCostBasis) / currentTokens : 0;
        const basisRemoved = avgCost * sellAmount;

        const quote = quoteSell(yesPool, noPool, outcome, sellAmount, effectiveFeeRate);
        const giesReceived = Math.abs(quote.giesCost);

        const safeguard = evaluateSafeguards(quote, yesPool, noPool, giesReceived, safeguardParams, false);
        if (safeguard.isBlocked) throw httpError(400, safeguard.warnings[0] || "Trade blocked by safeguard");

        const [trade] = await tx.insert(tradesTable).values({
          marketId, userId: req.user!.id, side: "sell", outcome,
          tokenAmount: sellAmount.toFixed(6),
          giesCost: giesReceived.toFixed(6),
          pricePerToken: quote.pricePerToken.toFixed(6),
          txHash,
        }).returning();

        await tx.update(usersTable)
          .set({ giesBalance: (userBalance + giesReceived).toFixed(6) })
          .where(eq(usersTable.id, req.user!.id));

        await tx.update(positionsTable)
          .set({
            tokenAmount: (currentTokens - sellAmount).toFixed(6),
            totalCostBasis: (parseFloat(position.totalCostBasis) - basisRemoved).toFixed(6),
            realizedPnl: (parseFloat(position.realizedPnl) + (giesReceived - basisRemoved)).toFixed(6),
            updatedAt: new Date(),
          })
          .where(eq(positionsTable.id, position.id));

        // Retain the trading fee in the pool so LP shares appreciate (fee = vaultDelta - supplyDelta).
        const fee = quote.vaultDelta - quote.supplyDelta;
        await tx.update(marketsTable)
          .set({
            yesPool: (quote.newYesPool + fee).toFixed(6),
            noPool: (quote.newNoPool + fee).toFixed(6),
            totalVolume: (totalVolume + giesReceived).toFixed(6),
            vaultCollateral: (vaultCollateral + quote.vaultDelta).toFixed(6),
            totalYesSupply: (totalYesSupply + quote.vaultDelta).toFixed(6),
            totalNoSupply: (totalNoSupply + quote.vaultDelta).toFixed(6),
            cumulativeFees: (parseFloat(market.cumulativeFees) + fee).toFixed(6),
          })
          .where(eq(marketsTable.id, marketId));

        await tx.insert(transactionsTable).values({
          userId: req.user!.id, type: "trade_sell",
          amount: giesReceived.toFixed(6),
          description: `Sell ${sellAmount.toFixed(2)} ${outcome.toUpperCase()} tokens on "${market.title}"`,
          txHash, marketId,
        });

        await tx.insert(priceHistoryTable).values({
          marketId,
          yesPrice: quote.newYesPrice.toFixed(6),
          noPrice: quote.newNoPrice.toFixed(6),
          volume: giesReceived.toFixed(6),
        });

        return {
          trade: {
            id: trade.id, marketId: trade.marketId, userId: trade.userId,
            username: user.username, side: trade.side, outcome: trade.outcome,
            tokenAmount: parseFloat(trade.tokenAmount),
            giesCost: parseFloat(trade.giesCost),
            pricePerToken: parseFloat(trade.pricePerToken),
            txHash: trade.txHash, createdAt: trade.createdAt,
          },
          newYesPrice: quote.newYesPrice,
          newNoPrice: quote.newNoPrice,
          newGiesBalance: userBalance + giesReceived,
          txHash,
        };
      }
    });

    evaluateAndAwardBadges(req.user!.id).catch(console.error);
    res.json(result);
  } catch (err: any) {
    res.status(err.status ?? 400).json({ error: err.message });
  }
});

export default router;
