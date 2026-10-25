import crypto from "node:crypto";
import bs58 from "bs58";
import { walletChallengesTable } from "@workspace/db";
import { requireActive } from "../lib/auth.js";
import { Router } from "express";
import { db, usersTable, rosterTable, transactionsTable } from "@workspace/db";
import { verifyPassword } from "../lib/security.js";
import { platformConfigTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { hashPassword, generateToken, generateTxHash, authMiddleware, requireAuth } from "../lib/auth.js";

const router = Router();

function userPayload(user: typeof usersTable.$inferSelect) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    cohortId: user.cohortId,
    active: user.active,
    walletAddress: user.walletAddress,
    giesBalance: parseFloat(user.giesBalance),
    createdAt: user.createdAt,
  };
}

router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    res.status(400).json({ error: "Username and password required" });
    return;
  }

  // Allow login by username OR email (students will know their email).
  const ident = String(username).trim().toLowerCase();
  let [user] = await db.select().from(usersTable).where(eq(usersTable.username, ident)).limit(1);
  if (!user) {
    [user] = await db.select().from(usersTable).where(eq(usersTable.email, ident)).limit(1);
  }

  if (!user || !verifyPassword(password, user.passwordHash)) {
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  if (!user.passwordHash.startsWith("scrypt:")) await db.update(usersTable).set({ passwordHash: hashPassword(password) }).where(eq(usersTable.id, user.id));
  const token = generateToken(user.id, user.sessionVersion);
  res.json({ user: userPayload(user), token });
});

// ---- Self-signup, gated to the class roster allowlist -------------------------
router.post("/register", async (req, res) => {
  const emailRaw = req.body?.email;
  const password = req.body?.password;

  if (!emailRaw || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }
  if (String(password).length < 8) {
    res.status(400).json({ error: "Password must be at least 8 characters" });
    return;
  }

  const email = String(emailRaw).trim().toLowerCase();
  if (!email.endsWith("@illinois.edu")) {
    res.status(400).json({ error: "Use your @illinois.edu email address" });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      // Lock the roster row so two people can't claim the same email at once.
      const [entry] = await tx
        .select()
        .from(rosterTable)
        .where(eq(rosterTable.email, email))
        .for("update")
        .limit(1);

      if (!entry) {
        throw Object.assign(new Error("This email isn't on the class roster. Contact the instructor."), { status: 403 });
      }
      if (entry.claimed) {
        throw Object.assign(new Error("An account for this email already exists. Try logging in or ask for a reset."), { status: 409 });
      }

      // Username = netid (the part before @). Fall back with a suffix on collision.
      const netid = email.split("@")[0];
      let username = netid;
      const [clash] = await tx.select().from(usersTable).where(eq(usersTable.username, username)).limit(1);
      if (clash) username = `${netid}_${entry.id}`;

      if (!entry.active) throw Object.assign(new Error("Membership is inactive"), { status: 403 });
      const [config] = await tx.select().from(platformConfigTable).where(eq(platformConfigTable.id, 1));
      if (!config) throw new Error("Platform has not been initialized");
      const [user] = await tx
        .insert(usersTable)
        .values({
          username,
          displayName: entry.displayName,
          email,
          passwordHash: hashPassword(password),
          role: "trader",
          cohortId: entry.cohortId ?? null,
          giesBalance: process.env.MARKET_BACKEND === "solana" ? "0" : config.starterAmount,
          deskBalance: "0",
        })
        .returning();

      await tx
        .update(rosterTable)
        .set({ claimed: true, claimedUserId: user.id })
        .where(eq(rosterTable.id, entry.id));

      return user;
    });

    const token = generateToken(result.id, result.sessionVersion);
    res.status(201).json({ user: userPayload(result), token });
  } catch (err: any) {
    res.status(err.status ?? 400).json({ error: err.message ?? "Registration failed" });
  }
});

// ---- Self-serve change password ----------------------------------------------
router.post("/change-password", authMiddleware, requireAuth, async (req, res) => {
  const { oldPassword, newPassword } = req.body;
  if (!oldPassword || !newPassword) {
    res.status(400).json({ error: "Current and new password are required" });
    return;
  }
  if (String(newPassword).length < 8) {
    res.status(400).json({ error: "New password must be at least 8 characters" });
    return;
  }

  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
  if (!user || !verifyPassword(oldPassword, user.passwordHash)) {
    res.status(401).json({ error: "Current password is incorrect" });
    return;
  }

  await db.update(usersTable).set({ passwordHash: hashPassword(newPassword), sessionVersion: user.sessionVersion + 1 }).where(eq(usersTable.id, user.id));
  res.json({ message: "Password updated" });
});

router.post("/logout", (req, res) => {
  res.json({ message: "Logged out successfully" });
});

router.get("/me", authMiddleware, requireAuth, async (req, res) => {
  if (req.user!.id === 0) return void res.json({ ...req.user, email: null, createdAt: new Date(0), giesBalance: 0 });
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    email: user.email,
    role: user.role,
    cohortId: user.cohortId,
    active: user.active,
    walletAddress: user.walletAddress,
    giesBalance: parseFloat(user.giesBalance),
    createdAt: user.createdAt,
  });
});

// A login proves campus identity; this separate signature proves wallet ownership.
router.post("/wallet-challenge", authMiddleware, requireAuth, requireActive, async (req, res) => {
  const wallet = req.body?.wallet;
  try { if (typeof wallet !== "string" || bs58.decode(wallet).length !== 32) throw new Error(); }
  catch { return void res.status(400).json({ error: "Invalid Solana public key" }); }
  const expiresAt = new Date(Date.now() + 5 * 60_000);
  const message = `iBPM wallet link\nOrigin: ${process.env.APP_ORIGIN || "http://localhost:5173"}\nAccount: ${req.user!.id}\nWallet: ${wallet}\nNonce: ${crypto.randomBytes(32).toString("hex")}\nExpires: ${expiresAt.toISOString()}`;
  await db.insert(walletChallengesTable).values({ userId: req.user!.id, wallet, message, expiresAt }).onConflictDoUpdate({ target: walletChallengesTable.userId, set: { wallet, message, expiresAt } });
  res.json({ message, expiresAt });
});
router.post("/link-wallet", authMiddleware, requireAuth, requireActive, async (req, res) => {
  const signature = req.body?.signature;
  if (typeof signature !== "string") return void res.status(400).json({ error: "Base64 wallet signature required" });
  try {
    const wallet = await db.transaction(async tx => {
      const [challenge] = await tx.select().from(walletChallengesTable).where(eq(walletChallengesTable.userId, req.user!.id)).for("update");
      if (!challenge || challenge.expiresAt < new Date()) throw Object.assign(new Error("Wallet challenge expired or already used"), { status: 400 });
      const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(bs58.decode(challenge.wallet))]), format: "der", type: "spki" });
      if (!crypto.verify(null, Buffer.from(challenge.message), key, Buffer.from(signature, "base64"))) throw Object.assign(new Error("Invalid wallet signature"), { status: 403 });
      const [user] = await tx.select().from(usersTable).where(eq(usersTable.id, req.user!.id)).for("update");
      if (user.walletAddress && user.walletAddress !== challenge.wallet) throw Object.assign(new Error("Wallet already linked. Wallet changes require a reviewed migration of on-chain positions."), { status: 409 });
      await tx.update(usersTable).set({ walletAddress: challenge.wallet }).where(eq(usersTable.id, user.id));
      await tx.delete(walletChallengesTable).where(eq(walletChallengesTable.userId, user.id));
      return challenge.wallet;
    });
    res.json({ walletAddress: wallet });
  } catch (err: any) {
    res.status(err.code === "23505" || err.cause?.code === "23505" ? 409 : err.status || 400).json({ error: err.code === "23505" || err.cause?.code === "23505" ? "Wallet is already linked to another account" : err.message });
  }
});

export default router;
