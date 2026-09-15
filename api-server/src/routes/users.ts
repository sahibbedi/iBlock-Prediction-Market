import { Router } from "express";
import { db, usersTable, lpPositionsTable, marketsTable, positionsTable, transactionsTable } from "@workspace/db";
import { eq, and, ne, inArray, isNotNull, gt } from "drizzle-orm";
import { authMiddleware, requireAuth, canTeach, hashPassword, generateTxHash } from "../lib/auth.js";
import crypto from "crypto";

const router = Router();

// Capital granted to a student's market-maker desk for the duration of their
// maker cycle. Settled and zeroed when they rotate out. One-line change here.
const MAKER_DESK_CAPITAL = 15000;

function formatUser(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    cohortId: user.cohortId,
    rotationGroup: user.rotationGroup,
    giesBalance: parseFloat(user.giesBalance),
    deskBalance: parseFloat(user.deskBalance),
    createdAt: user.createdAt,
  };
}

function generateTempPassword(): string {
  const n = crypto.randomInt(1000, 9999);
  const tail = crypto.randomBytes(2).toString("hex");
  return `gies-${n}-${tail}`;
}

async function creditPosition(tx: any, userId: number, marketId: number, outcome: string, tokens: number) {
  if (tokens <= 1e-9) return;
  const [existing] = await tx.select().from(positionsTable)
    .where(and(eq(positionsTable.userId, userId), eq(positionsTable.marketId, marketId), eq(positionsTable.outcome, outcome)))
    .for("update").limit(1);
  if (existing) {
    await tx.update(positionsTable)
      .set({ tokenAmount: (parseFloat(existing.tokenAmount) + tokens).toFixed(6), updatedAt: new Date() })
      .where(eq(positionsTable.id, existing.id));
  } else {
    await tx.insert(positionsTable).values({ userId, marketId, outcome, tokenAmount: tokens.toFixed(6), totalCostBasis: "0" });
  }
}

// Force-withdraw every open LP position for a departing maker, returning matched
// GIES to their desk (leftover tokens to their personal positions), then record
// the desk's performance for grading and zero it out.
async function settleMakerDesk(tx: any, userId: number) {
  const lpPositions = await tx.select().from(lpPositionsTable)
    .where(and(eq(lpPositionsTable.userId, userId), gt(lpPositionsTable.lpShares, "0")))
    .for("update");

  for (const lp of lpPositions) {
    const shares = parseFloat(lp.lpShares);
    if (shares <= 1e-9) continue;

    const [market] = await tx.select().from(marketsTable).where(eq(marketsTable.id, lp.marketId)).for("update").limit(1);
    if (!market) continue;

    const totalShares = parseFloat(market.lpShares);
    const yesPool = parseFloat(market.yesPool);
    const noPool = parseFloat(market.noPool);
    const frac = totalShares > 0 ? shares / totalShares : 0;
    const yesOut = yesPool * frac;
    const noOut = noPool * frac;
    const matched = Math.min(yesOut, noOut);
    const yesLeft = yesOut - matched;
    const noLeft = noOut - matched;

    const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update").limit(1);
    await tx.update(usersTable)
      .set({ deskBalance: (parseFloat(user.deskBalance) + matched).toFixed(6) })
      .where(eq(usersTable.id, userId));

    const newVault = parseFloat(market.vaultCollateral) - matched;
    await tx.update(marketsTable).set({
      yesPool: (yesPool - yesOut).toFixed(6),
      noPool: (noPool - noOut).toFixed(6),
      totalLiquidity: newVault.toFixed(6),
      lpShares: (totalShares - shares).toFixed(6),
      vaultCollateral: newVault.toFixed(6),
      totalYesSupply: (parseFloat(market.totalYesSupply) - matched).toFixed(6),
      totalNoSupply: (parseFloat(market.totalNoSupply) - matched).toFixed(6),
    }).where(eq(marketsTable.id, lp.marketId));

    await tx.update(lpPositionsTable).set({ lpShares: "0", updatedAt: new Date() }).where(eq(lpPositionsTable.id, lp.id));

    await creditPosition(tx, userId, lp.marketId, "yes", yesLeft);
    await creditPosition(tx, userId, lp.marketId, "no", noLeft);
  }

  // Record desk performance for grading, then zero the desk.
  const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, userId)).for("update").limit(1);
  const finalDesk = parseFloat(user.deskBalance);
  await tx.insert(transactionsTable).values({
    userId,
    type: "desk_settle",
    amount: (-finalDesk).toFixed(6),
    description: `Maker desk settled: returned ${finalDesk.toFixed(2)} GIES of ${MAKER_DESK_CAPITAL} grant (P&L ${(finalDesk - MAKER_DESK_CAPITAL).toFixed(2)})`,
    txHash: generateTxHash(),
  });
  await tx.update(usersTable).set({ deskBalance: "0", role: "student" }).where(eq(usersTable.id, userId));
}

router.get("/", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const { cohortId, role } = req.query;
  const users = await db.select().from(usersTable);
  let filtered = users;
  if (cohortId) filtered = filtered.filter((u) => u.cohortId === parseInt(cohortId as string));
  if (role) filtered = filtered.filter((u) => u.role === role);
  res.json(filtered.map(formatUser));
});

router.post("/", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const { username, displayName, email, password, role, cohortId, rotationGroup } = req.body;
  if (!username || !displayName || !password || !role) {
    res.status(400).json({ error: "Missing required fields" });
    return;
  }
  const [existing] = await db.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
  if (existing) {
    res.status(400).json({ error: "Username already taken" });
    return;
  }
  const [user] = await db.insert(usersTable).values({
    username, displayName, email,
    passwordHash: hashPassword(password),
    role, cohortId: cohortId ?? null, rotationGroup: rotationGroup ?? null,
    giesBalance: "5000", deskBalance: "0",
  }).returning();
  res.status(201).json(formatUser(user));
});

// ---- Rotation lever ----------------------------------------------------------
// Activate one rotation group as market makers (granting each a fresh desk),
// and settle every OTHER grouped maker back to student. Teacher/admin and
// ungrouped accounts are untouched.
// NOTE: declared before "/:userId/..." so it isn't captured as a userId route.
router.post("/rotation/activate", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const group = parseInt(req.body?.group);
  if (![1, 2, 3].includes(group)) {
    res.status(400).json({ error: "group must be 1, 2, or 3" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    // 1) Settle outgoing makers: any market_maker whose group != the new one.
    const outgoing = await tx.select().from(usersTable)
      .where(and(eq(usersTable.role, "market_maker"), isNotNull(usersTable.rotationGroup), ne(usersTable.rotationGroup, group)))
      .for("update");
    for (const m of outgoing) {
      await settleMakerDesk(tx, m.id);
    }

    // 2) Promote the incoming group's students and grant a fresh desk.
    const incoming = await tx.select().from(usersTable)
      .where(and(eq(usersTable.rotationGroup, group), inArray(usersTable.role, ["student", "market_maker"])))
      .for("update");
    for (const s of incoming) {
      await tx.update(usersTable)
        .set({ role: "market_maker", deskBalance: MAKER_DESK_CAPITAL.toFixed(6) })
        .where(eq(usersTable.id, s.id));
      await tx.insert(transactionsTable).values({
        userId: s.id,
        type: "desk_grant",
        amount: MAKER_DESK_CAPITAL.toFixed(6),
        description: `Maker desk granted for cycle (group ${group}): ${MAKER_DESK_CAPITAL} GIES`,
        txHash: generateTxHash(),
      });
    }

    return { promoted: incoming.length, settled: outgoing.length };
  });

  res.json({ activeGroup: group, marketMakers: result.promoted, settledToStudent: result.settled, deskCapital: MAKER_DESK_CAPITAL });
});

router.get("/:userId", authMiddleware, requireAuth, async (req, res) => {
  const userId = parseInt(String(req.params.userId));
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(user));
});

router.patch("/:userId", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const userId = parseInt(String(req.params.userId));
  const { displayName, email, role, cohortId, rotationGroup } = req.body;
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if (displayName !== undefined) updates.displayName = displayName;
  if (email !== undefined) updates.email = email;
  if (role !== undefined) updates.role = role;
  if (cohortId !== undefined) updates.cohortId = cohortId;
  if (rotationGroup !== undefined) updates.rotationGroup = rotationGroup;
  const [updated] = await db.update(usersTable).set(updates).where(eq(usersTable.id, userId)).returning();
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(formatUser(updated));
});

// ---- Teacher-initiated password reset ----------------------------------------
router.post("/:userId/reset-password", authMiddleware, requireAuth, canTeach, async (req, res) => {
  const userId = parseInt(String(req.params.userId));
  const provided = req.body?.newPassword;
  if (provided !== undefined && String(provided).length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }
  const tempPassword = provided ? String(provided) : generateTempPassword();
  const [updated] = await db.update(usersTable)
    .set({ passwordHash: hashPassword(tempPassword) })
    .where(eq(usersTable.id, userId)).returning();
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ userId: updated.id, username: updated.username, tempPassword });
});

export default router;
