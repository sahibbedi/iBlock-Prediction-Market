import { Router } from "express";
import { db, usersTable, platformConfigTable, proposalsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import crypto from "node:crypto";
import { authMiddleware, requireAdmin, requireActive, hashPassword } from "../lib/auth.js";
const router = Router();
router.use(authMiddleware, requireAdmin, requireActive);
const format = ({ passwordHash, sessionVersion, ...user }: typeof usersTable.$inferSelect) => ({ ...user, giesBalance: Number(user.giesBalance), deskBalance: Number(user.deskBalance) });
router.get("/", async (_req, res) => { res.json((await db.select().from(usersTable)).map(format)); });
router.post("/:userId/reset-password", async (req, res) => {
  const tempPassword = crypto.randomBytes(18).toString("base64url");
  const user = await db.transaction(async tx => {
    const [config] = await tx.select().from(platformConfigTable).where(eq(platformConfigTable.id, 1)).for("update");
    const [requester] = await tx.select().from(usersTable).where(eq(usersTable.id, req.user!.id));
    if (!config || requester?.role !== "admin" || !requester.active) throw Object.assign(new Error("Active committee access required"), { status: 403 });
    const [current] = await tx.select().from(usersTable).where(eq(usersTable.id, Number(req.params.userId))).for("update");
    if (!current) return null;
    if (current.role === "admin") {
      const [proposal] = await tx.insert(proposalsTable).values({ action: { type: "reset_password", userId: current.id, passwordHash: hashPassword(tempPassword) }, proposerId: req.user!.id, approvals: [req.user!.id], version: config.version, expiresAt: new Date(Date.now() + 7 * 86400_000) }).returning();
      return { ...current, proposalId: proposal.id };
    }
    const [updated] = await tx.update(usersTable).set({ passwordHash: hashPassword(tempPassword), sessionVersion: current.sessionVersion + 1 }).where(eq(usersTable.id, current.id)).returning();
    return updated;
  });
  if (!user) return void res.status(404).json({ error: "User not found" });
  res.json({ username: user.username, tempPassword, ...("proposalId" in user ? { proposalId: user.proposalId, status: "pending" } : {}) });
});
export default router;
