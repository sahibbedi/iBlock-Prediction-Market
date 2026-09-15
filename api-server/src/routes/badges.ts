import { Router } from "express";
import { authMiddleware, requireAuth } from "../lib/auth.js";
import { BADGE_DEFINITIONS, getUserBadges, evaluateAndAwardBadges } from "../lib/badges.js";

const router = Router();

/** All badge definitions (no auth needed for definitions). */
router.get("/badges/definitions", authMiddleware, requireAuth, async (_req, res) => {
  res.json(BADGE_DEFINITIONS);
});

/** Current user's badges (earned + all definitions for the grid). */
router.get("/badges/me", authMiddleware, requireAuth, async (req, res) => {
  const badges = await getUserBadges(req.user!.id);
  res.json(badges);
});

/** Another user's badges (public). */
router.get("/badges/user/:userId", authMiddleware, requireAuth, async (req, res) => {
  const userId = parseInt(String(req.params.userId));
  if (isNaN(userId)) {
    res.status(400).json({ error: "Invalid user ID" });
    return;
  }
  const badges = await getUserBadges(userId);
  res.json(badges);
});

/** Manually trigger evaluation (useful for testing / retroactive awards). */
router.post("/badges/evaluate", authMiddleware, requireAuth, async (req, res) => {
  const newBadges = await evaluateAndAwardBadges(req.user!.id);
  res.json({ awarded: newBadges });
});

export default router;
