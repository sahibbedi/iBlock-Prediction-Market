import { Router } from "express";
import { db, marketsTable, usersTable, lpPositionsTable, transactionsTable, positionsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { authMiddleware, requireAuth, generateTxHash } from "../lib/auth.js";
import { evaluateAndAwardBadges } from "../lib/badges.js";

const router = Router();

function httpError(status: number, message: string) {
  return Object.assign(new Error(message), { status });
}

function requireMarketMaker(req: any, res: any, next: any) {
  if (!req.user) return res.status(401).json({ error: "Authentication required" });
  if (!["market_maker", "teacher", "admin"].includes(req.user.role)) {
    return res.status(403).json({ error: "Market maker role required to provide liquidity" });
  }
  next();
}

// Credit outcome tokens to a user's position (creating the row if needed), inside a txn.
async function creditPosition(tx: any, userId: number, marketId: number, outcome: string, tokens: number) {
  if (tokens <= 1e-9) return;
  const [existing] = await tx.select().from(positionsTable)
    .where(and(
      eq(positionsTable.userId, userId),
      eq(positionsTable.marketId, marketId),
      eq(positionsTable.outcome, outcome)
    )).for("update").limit(1);
  if (existing) {
    await tx.update(positionsTable)
      .set({ tokenAmount: (parseFloat(existing.tokenAmount) + tokens).toFixed(6), updatedAt: new Date() })
      .where(eq(positionsTable.id, existing.id));
  } else {
    await tx.insert(positionsTable).values({
      userId, marketId, outcome,
      tokenAmount: tokens.toFixed(6),
      totalCostBasis: "0",
    });
  }
}

async function getOrCreateLpPosition(tx: any, userId: number, marketId: number) {
  const [existing] = await tx.select().from(lpPositionsTable)
    .where(and(eq(lpPositionsTable.userId, userId), eq(lpPositionsTable.marketId, marketId)))
    .for("update").limit(1);
  if (existing) return existing;
  const [created] = await tx.insert(lpPositionsTable).values({
    userId, marketId, lpShares: "0", totalGiesProvided: "0",
  }).returning();
  return created;
}

router.post("/provide", authMiddleware, requireAuth, requireMarketMaker, async (req, res) => {
  const { marketId, giesAmount } = req.body;
  if (!giesAmount || giesAmount <= 0) {
    res.status(400).json({ error: "Amount must be positive" });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [market] = await tx.select().from(marketsTable).where(eq(marketsTable.id, marketId)).for("update").limit(1);
      if (!market) throw httpError(404, "Market not found");
      if (market.status !== "open") throw httpError(400, "Market is not open");

      const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).for("update").limit(1);
      const userBalance = parseFloat(user.giesBalance);
      if (userBalance < giesAmount) throw httpError(400, "Insufficient $GIES balance");

      const yesPool = parseFloat(market.yesPool);
      const noPool = parseFloat(market.noPool);
      const totalShares = parseFloat(market.lpShares);
      const f = giesAmount;

      // Ratio-preserving add (FPMM): lock f GIES, mint f complete sets, add them to
      // the pool proportionally so the PRICE IS UNCHANGED, and return the leftover
      // outcome tokens to the LP. Shares are minted pro-rata to the contribution.
      const poolWeight = Math.max(yesPool, noPool);
      const yesAdd = f * yesPool / poolWeight;
      const noAdd = f * noPool / poolWeight;
      const yesBack = f - yesAdd;
      const noBack = f - noAdd;
      const sharesMinted = totalShares > 0 ? f * totalShares / poolWeight : f;

      const txHash = generateTxHash();

      await tx.update(usersTable)
        .set({ giesBalance: (userBalance - f).toFixed(6) })
        .where(eq(usersTable.id, req.user!.id));

      const newVault = parseFloat(market.vaultCollateral) + f;
      await tx.update(marketsTable)
        .set({
          yesPool: (yesPool + yesAdd).toFixed(6),
          noPool: (noPool + noAdd).toFixed(6),
          totalLiquidity: newVault.toFixed(6),
          lpShares: (totalShares + sharesMinted).toFixed(6),
          vaultCollateral: newVault.toFixed(6),
          totalYesSupply: (parseFloat(market.totalYesSupply) + f).toFixed(6),
          totalNoSupply: (parseFloat(market.totalNoSupply) + f).toFixed(6),
        })
        .where(eq(marketsTable.id, marketId));

      const lpPos = await getOrCreateLpPosition(tx, req.user!.id, marketId);
      await tx.update(lpPositionsTable)
        .set({
          lpShares: (parseFloat(lpPos.lpShares) + sharesMinted).toFixed(6),
          totalGiesProvided: (parseFloat(lpPos.totalGiesProvided) + f).toFixed(6),
          updatedAt: new Date(),
        })
        .where(eq(lpPositionsTable.id, lpPos.id));

      // Leftover outcome tokens (when the pool isn't balanced) go to the LP.
      await creditPosition(tx, req.user!.id, marketId, "yes", yesBack);
      await creditPosition(tx, req.user!.id, marketId, "no", noBack);

      await tx.insert(transactionsTable).values({
        userId: req.user!.id, type: "liquidity_add",
        amount: (-f).toFixed(6),
        description: `Added ${f.toFixed(2)} $GIES liquidity to "${market.title}"`,
        txHash, marketId,
      });

      return {
        lpShares: sharesMinted,
        giesAmount: f,
        yesTokensReturned: yesBack,
        noTokensReturned: noBack,
        newGiesBalance: userBalance - f,
      };
    });

    evaluateAndAwardBadges(req.user!.id).catch(console.error);
    res.json(result);
  } catch (err: any) {
    res.status(err.status ?? 400).json({ error: err.message });
  }
});

router.post("/remove", authMiddleware, requireAuth, requireMarketMaker, async (req, res) => {
  const { marketId, lpShares } = req.body;
  if (!lpShares || lpShares <= 0) {
    res.status(400).json({ error: "Shares must be positive" });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const [market] = await tx.select().from(marketsTable).where(eq(marketsTable.id, marketId)).for("update").limit(1);
      if (!market) throw httpError(404, "Market not found");

      const [lpPos] = await tx.select().from(lpPositionsTable)
        .where(and(eq(lpPositionsTable.userId, req.user!.id), eq(lpPositionsTable.marketId, marketId)))
        .for("update").limit(1);
      if (!lpPos || parseFloat(lpPos.lpShares) + 1e-9 < lpShares) throw httpError(400, "Insufficient LP shares");

      const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).for("update").limit(1);

      const totalShares = parseFloat(market.lpShares);
      const yesPool = parseFloat(market.yesPool);
      const noPool = parseFloat(market.noPool);
      const frac = lpShares / totalShares;
      const yesOut = yesPool * frac;
      const noOut = noPool * frac;

      // Return proportional inventory; auto-merge the matched pairs back to GIES
      // (1 YES + 1 NO -> 1 GIES from the vault), leave the unmatched excess as tokens.
      // This is the fix for the old overpay bug (it paid yesOut+noOut as GIES).
      const matched = Math.min(yesOut, noOut);
      const yesLeft = yesOut - matched;
      const noLeft = noOut - matched;

      const txHash = generateTxHash();

      await tx.update(usersTable)
        .set({ giesBalance: (parseFloat(user.giesBalance) + matched).toFixed(6) })
        .where(eq(usersTable.id, req.user!.id));

      const newVault = parseFloat(market.vaultCollateral) - matched;
      await tx.update(marketsTable)
        .set({
          yesPool: (yesPool - yesOut).toFixed(6),
          noPool: (noPool - noOut).toFixed(6),
          totalLiquidity: newVault.toFixed(6),
          lpShares: (totalShares - lpShares).toFixed(6),
          vaultCollateral: newVault.toFixed(6),
          totalYesSupply: (parseFloat(market.totalYesSupply) - matched).toFixed(6),
          totalNoSupply: (parseFloat(market.totalNoSupply) - matched).toFixed(6),
        })
        .where(eq(marketsTable.id, marketId));

      await tx.update(lpPositionsTable)
        .set({ lpShares: (parseFloat(lpPos.lpShares) - lpShares).toFixed(6), updatedAt: new Date() })
        .where(eq(lpPositionsTable.id, lpPos.id));

      await creditPosition(tx, req.user!.id, marketId, "yes", yesLeft);
      await creditPosition(tx, req.user!.id, marketId, "no", noLeft);

      await tx.insert(transactionsTable).values({
        userId: req.user!.id, type: "liquidity_remove",
        amount: matched.toFixed(6),
        description: `Removed liquidity from "${market.title}" — ${matched.toFixed(2)} GIES + leftover tokens`,
        txHash, marketId,
      });

      return {
        lpShares,
        giesReturned: matched,
        yesTokensReturned: yesLeft,
        noTokensReturned: noLeft,
        newGiesBalance: parseFloat(user.giesBalance) + matched,
      };
    });

    res.json(result);
  } catch (err: any) {
    res.status(err.status ?? 400).json({ error: err.message });
  }
});

router.get("/positions", authMiddleware, requireAuth, async (req, res) => {
  const positions = await db
    .select({ lp: lpPositionsTable, market: marketsTable })
    .from(lpPositionsTable)
    .innerJoin(marketsTable, eq(marketsTable.id, lpPositionsTable.marketId))
    .where(eq(lpPositionsTable.userId, req.user!.id));

  const result = positions
    .filter(({ lp }) => parseFloat(lp.lpShares) > 0.000001)
    .map(({ lp, market }) => {
      const myShares = parseFloat(lp.lpShares);
      const totalShares = parseFloat(market.lpShares);
      const poolShare = totalShares > 0 ? myShares / totalShares : 0;
      const yesPool = parseFloat(market.yesPool);
      const noPool = parseFloat(market.noPool);
      const total = yesPool + noPool;
      // Mark-to-market value of the LP's pool claim:
      // share * (yesPool * yesPrice + noPool * noPrice), yesPrice = noPool/total.
      const claimValue = total > 0 ? (2 * yesPool * noPool) / total : 0;
      const estimatedValue = poolShare * claimValue;

      return {
        marketId: market.id,
        marketTitle: market.title,
        lpShares: myShares,
        poolShare,
        estimatedValue,
        totalGiesProvided: parseFloat(lp.totalGiesProvided),
      };
    });

  res.json(result);
});

export default router;
