import { Router } from "express";
import { db, platformConfigTable, proposalsTable, usersTable, rosterTable } from "@workspace/db";
import { eq, desc, and } from "drizzle-orm";
import { authMiddleware, requireAdmin, requireActive } from "../lib/auth.js";
import { actionSchema, executeAction, sensitive, fail } from "../lib/governance.js";
const router = Router();
router.use(authMiddleware, requireAdmin, requireActive);
router.get("/", async (_req, res) => {
  const [config] = await db.select().from(platformConfigTable).where(eq(platformConfigTable.id, 1));
  const members = await db.select({ id: usersTable.id, displayName: usersTable.displayName }).from(usersTable).where(and(eq(usersTable.role, "admin"), eq(usersTable.active, true)));
  const proposals = await db.select().from(proposalsTable).orderBy(desc(proposalsTable.id)).limit(100);
  res.json({ backend: process.env.MARKET_BACKEND || "database", config, members, proposals });
});
router.get("/roster", async (_req, res) => { res.json(await db.select().from(rosterTable)); });
router.post("/proposals", async (req, res) => {
  const action = actionSchema.parse(req.body);
  if (process.env.MARKET_BACKEND === "solana" && action.type !== "roster") fail("Use committee wallet signatures for on-chain governance", 503);
  if (action.type === "reset_password") fail("Use the user password-reset endpoint to prepare a random credential");
  const proposal = await db.transaction(async tx => {
    const [config] = await tx.select().from(platformConfigTable).where(eq(platformConfigTable.id, 1)).for("update");
    if (!config) fail("Platform has not been initialized", 503);
    const [p] = await tx.insert(proposalsTable).values({ action, proposerId: req.user!.id, approvals: [req.user!.id], version: config.version, expiresAt: new Date(Date.now() + 7 * 86400_000) }).returning();
    return p;
  });
  res.status(201).json(proposal);
});
router.post("/proposals/:id/approve", async (req, res) => {
  const result = await db.transaction(async tx => {
    const [config] = await tx.select().from(platformConfigTable).where(eq(platformConfigTable.id, 1)).for("update");
    if (!config) fail("Platform has not been initialized", 503);
    const [proposal] = await tx.select().from(proposalsTable).where(eq(proposalsTable.id, Number(req.params.id))).for("update");
    if (!proposal || proposal.status !== "pending") fail("Pending proposal not found", 404);
    if (proposal.version !== config.version || proposal.expiresAt < new Date()) fail("Proposal has expired or committee configuration changed");
    const members = await tx.select().from(usersTable).where(and(eq(usersTable.role, "admin"), eq(usersTable.active, true)));
    const eligible = new Set(members.map(m => m.id));
    if (!eligible.has(req.user!.id)) fail("Not an active committee member", 403);
    const approvals = [...new Set([...proposal.approvals, req.user!.id])].filter(id => eligible.has(id));
    const action = actionSchema.parse(proposal.action);
    if (process.env.MARKET_BACKEND === "solana" && !["roster", "reset_password"].includes(action.type)) fail("Use committee wallet signatures for on-chain governance", 503);
    const threshold = sensitive(action) ? config.resolveThreshold : config.routineThreshold;
    if (approvals.length >= threshold) await executeAction(tx, config, action, proposal.proposerId);
    const [updated] = await tx.update(proposalsTable).set({ approvals, status: approvals.length >= threshold ? "executed" : "pending", executedAt: approvals.length >= threshold ? new Date() : null }).where(eq(proposalsTable.id, proposal.id)).returning();
    return updated;
  });
  res.json(result);
});
router.post("/pause", async (_req, res) => {
  if (process.env.MARKET_BACKEND === "solana") fail("Pause the program using committee wallet signatures", 503);
  // Any one committee member can stop new risk. Unpause requires a proposal.
  await db.update(platformConfigTable).set({ paused: true }).where(eq(platformConfigTable.id, 1));
  res.json({ paused: true });
});
export default router;
