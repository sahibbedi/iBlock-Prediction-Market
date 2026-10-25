import { z } from "zod/v4";
import { db, platformConfigTable, usersTable, marketsTable, positionsTable, lpPositionsTable, rosterTable, transactionsTable, priceHistoryTable, rewardClaimsTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { generateTxHash } from "./auth.js";

const amount = z.number().finite().positive().max(1e9);
const fraction = z.number().positive().max(1);
const id = z.number().int().positive();
export const actionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("reset_password"), userId: id, passwordHash: z.string().regex(/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/) }),
  z.object({ type: z.literal("role"), userId: id, role: z.enum(["admin", "market_maker", "trader", "observer"]) }),
  z.object({ type: z.literal("membership"), userId: id, active: z.boolean() }),
  z.object({ type: z.literal("capital"), userId: id, amount, clawback: z.boolean().default(false) }),
  z.object({ type: z.literal("roster"), email: z.email().endsWith("@illinois.edu"), displayName: z.string().min(1).max(200), active: z.boolean(), cohortId: id.nullable().default(null) }),
  z.object({ type: z.literal("treasury"), amount }),
  z.object({ type: z.literal("pause"), paused: z.boolean() }),
  z.object({ type: z.literal("thresholds"), routine: z.number().int().min(2), resolve: z.number().int().min(2) }),
  z.object({ type: z.literal("economics"), starterAmount: amount, makerCapital: amount, feeBase: z.number().min(0).max(0.1), feeMax: z.number().min(0).max(0.1), feeMatch: z.number().min(0).max(1), rewardBudget: z.number().min(0).max(1e9) }),
  z.object({ type: z.literal("create_market"), title: z.string().min(1).max(200), description: z.string().min(1), resolutionCriteria: z.string().min(1), initialLiquidity: amount, category: z.string().default("general"), cohortId: id.nullable().default(null) }),
  z.object({ type: z.literal("close_market"), marketId: id }),
  z.object({ type: z.literal("resolve_market"), marketId: id, outcome: z.enum(["yes", "no"]) }),
  z.object({ type: z.literal("market_params"), marketId: id, maxPriceImpact: fraction, minPoolDepth: amount, maxTradeSizePct: fraction, feeBase: z.number().min(0).max(0.1), feeMax: z.number().min(0).max(0.1) }),
  z.object({ type: z.literal("reward"), userId: id, claimId: z.string().min(1).max(100), attributedFees: amount, evidence: z.string().min(10).max(2000) }),
]);
export type Action = z.infer<typeof actionSchema>;
export const sensitive = (a: Action) => ["resolve_market", "thresholds", "role", "reward", "economics", "treasury", "reset_password"].includes(a.type) || (a.type === "capital" && a.clawback);
export const fail = (message: string, status = 400): never => { throw Object.assign(new Error(message), { status }); };

// Called only while the singleton config and the proposal are locked in one transaction.
export async function executeAction(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], config: typeof platformConfigTable.$inferSelect, action: Action, proposer: number) {
  if (action.type === "pause") {
    await tx.update(platformConfigTable).set({ paused: action.paused }).where(eq(platformConfigTable.id, 1));
  } else if (action.type === "thresholds") {
    const members = await tx.select().from(usersTable).where(and(eq(usersTable.role, "admin"), eq(usersTable.active, true)));
    if (action.resolve < action.routine || action.resolve > members.length) fail("Thresholds must fit the active committee and resolution must be >= routine");
    await tx.update(platformConfigTable).set({ routineThreshold: action.routine, resolveThreshold: action.resolve, version: config.version + 1 }).where(eq(platformConfigTable.id, 1));
  } else if (action.type === "economics") {
    if (action.feeBase > action.feeMax) fail("Base fee must not exceed maximum fee");
    const { type, ...values } = action;
    await tx.update(platformConfigTable).set(Object.fromEntries(Object.entries(values).map(([k,v]) => [k, String(v)]))).where(eq(platformConfigTable.id, 1));
  } else if (action.type === "treasury") {
    await tx.update(platformConfigTable).set({ treasuryBalance: (Number(config.treasuryBalance) + action.amount).toFixed(6) }).where(eq(platformConfigTable.id, 1));
  } else if (action.type === "roster") {
    const linked = await tx.select().from(usersTable).where(eq(usersTable.email, action.email));
    if (linked.some(u => u.role === "admin")) fail("Committee membership must be changed through a role proposal");
    await tx.insert(rosterTable).values(action).onConflictDoUpdate({ target: rosterTable.email, set: { displayName: action.displayName, active: action.active, cohortId: action.cohortId } });
    await tx.update(usersTable).set({ active: action.active }).where(eq(usersTable.email, action.email));
  } else if (action.type === "create_market") {
    if (config.paused) fail("Platform is paused");
    if (Number(config.treasuryBalance) < action.initialLiquidity) fail("Fund the committee treasury first");
    const n = action.initialLiquidity.toFixed(6);
    const [market] = await tx.insert(marketsTable).values({ ...action, creatorId: proposer, status: "open", yesPool: n, noPool: n, totalLiquidity: n, lpShares: n, vaultCollateral: n, totalYesSupply: n, totalNoSupply: n, tradingFeeRate: config.feeBase, maxFeeRate: config.feeMax, virtualLiquidity: "0" }).returning();
    // user_id=0 denotes treasury-owned protocol liquidity, never an admin's personal claim.
    await tx.insert(lpPositionsTable).values({ userId: 0, marketId: market.id, lpShares: n, totalGiesProvided: n });
    await tx.insert(priceHistoryTable).values({ marketId: market.id, yesPrice: "0.5", noPrice: "0.5", volume: "0" });
    await tx.update(platformConfigTable).set({ treasuryBalance: (Number(config.treasuryBalance) - action.initialLiquidity).toFixed(6) }).where(eq(platformConfigTable.id, 1));
  } else if (action.type === "close_market" || action.type === "resolve_market" || action.type === "market_params") {
    const [market] = await tx.select().from(marketsTable).where(eq(marketsTable.id, action.marketId)).for("update");
    if (!market) fail("Market not found", 404);
    if (market.status === "resolved") fail("Market is already resolved");
    if (action.type === "close_market") await tx.update(marketsTable).set({ status: "closed" }).where(eq(marketsTable.id, market.id));
    if (action.type === "resolve_market") await tx.update(marketsTable).set({ status: "resolved", outcome: action.outcome }).where(eq(marketsTable.id, market.id));
    if (action.type === "market_params") {
      if (action.feeBase > action.feeMax) fail("Base fee must not exceed maximum fee");
      await tx.update(marketsTable).set({ maxPriceImpact: String(action.maxPriceImpact), minPoolDepth: String(action.minPoolDepth), maxTradeSizePct: String(action.maxTradeSizePct), tradingFeeRate: String(action.feeBase), maxFeeRate: String(action.feeMax) }).where(eq(marketsTable.id, market.id));
    }
  } else {
    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, action.userId)).for("update");
    if (!user) fail("User not found", 404);
    if (action.type === "reset_password") {
      await tx.update(usersTable).set({ passwordHash: action.passwordHash, sessionVersion: user.sessionVersion + 1 }).where(eq(usersTable.id, user.id));
    } else if (action.type === "role") {
      if (action.role === "admin" && !user.active) fail("Activate membership before appointing a committee member");
      if (user.role === "admin" || action.role === "admin") {
        const members = await tx.select().from(usersTable).where(and(eq(usersTable.role, "admin"), eq(usersTable.active, true)));
        if (user.role === "admin" && action.role !== "admin" && members.length - 1 < config.resolveThreshold) fail("Cannot strand the committee below its approval threshold");
        await tx.update(platformConfigTable).set({ version: config.version + 1 }).where(eq(platformConfigTable.id, 1));
      }
      if (action.role === "observer" || action.role === "admin") {
        const holdings = await tx.select().from(positionsTable).where(and(eq(positionsTable.userId, user.id), gt(positionsTable.tokenAmount, "0")));
        if (holdings.length || Number(user.giesBalance) > 0) fail("Participant balances and claims must be settled before becoming an observer or admin");
      }
      if (action.role !== "market_maker") {
        const lp = await tx.select().from(lpPositionsTable).where(and(eq(lpPositionsTable.userId, user.id), gt(lpPositionsTable.lpShares, "0")));
        if (lp.length || Number(user.deskBalance) > 0) fail("Withdraw liquidity and claw back desk capital before removing maker status");
      }
      await tx.update(usersTable).set({ role: action.role }).where(eq(usersTable.id, user.id));
    } else if (action.type === "membership") {
      if (user.role === "admin") fail("Change committee roles through a role proposal");
      await tx.update(usersTable).set({ active: action.active }).where(eq(usersTable.id, user.id));
      if (user.email) await tx.update(rosterTable).set({ active: action.active }).where(eq(rosterTable.email, user.email));
    } else if (action.type === "capital") {
      if (user.role !== "market_maker" || (!action.clawback && !user.active)) fail("An active appointed maker is required");
      const delta = action.clawback ? -action.amount : action.amount;
      if (Number(user.deskBalance) + delta < 0) fail("Insufficient idle maker capital");
      await tx.update(usersTable).set({ deskBalance: (Number(user.deskBalance) + delta).toFixed(6) }).where(eq(usersTable.id, user.id));
      if (action.clawback) await tx.update(platformConfigTable).set({ treasuryBalance: (Number(config.treasuryBalance) + action.amount).toFixed(6) }).where(eq(platformConfigTable.id, 1));
      await tx.insert(transactionsTable).values({ userId: user.id, type: action.clawback ? "capital_clawback" : "capital_grant", amount: String(delta), description: "Committee maker capital adjustment", txHash: generateTxHash() });
    } else if (action.type === "reward") {
      if (user.role !== "market_maker" || !user.active) fail("Only active makers receive LP rewards");
      const reward = Number((action.attributedFees * Number(config.feeMatch)).toFixed(6));
      if (reward <= 0 || reward > Number(config.rewardBudget)) fail("Reward exceeds remaining emissions budget or is zero");
      const existingClaim = await tx.select().from(rewardClaimsTable).where(eq(rewardClaimsTable.claimId, action.claimId));
      if (existingClaim.length) fail("Reward claim has already been paid", 409);
      await tx.insert(rewardClaimsTable).values({ claimId: action.claimId, userId: user.id, amount: String(reward), evidence: action.evidence });
      await tx.update(platformConfigTable).set({ rewardBudget: (Number(config.rewardBudget) - reward).toFixed(6) }).where(eq(platformConfigTable.id, 1));
      await tx.update(usersTable).set({ giesBalance: (Number(user.giesBalance) + reward).toFixed(6) }).where(eq(usersTable.id, user.id));
      await tx.insert(transactionsTable).values({ userId: user.id, type: "lp_reward", amount: String(reward), description: `Committee reward ${action.claimId}`, txHash: generateTxHash() });
    }
  }
}
