import { Router } from "express";
import healthRouter from "./health.js";
import authRouter from "./auth.js";
import usersRouter from "./users.js";
import cohortsRouter from "./cohorts.js";
import marketsRouter from "./markets.js";
import tradesRouter from "./trades.js";
import walletRouter from "./wallet.js";
import liquidityRouter from "./liquidity.js";
import leaderboardRouter from "./leaderboard.js";
import commentsRouter from "./comments.js";
import ideasRouter from "./ideas.js";
import badgesRouter from "./badges.js";

import committeeRouter from "./committee.js";

const router = Router();
router.use("/committee", committeeRouter);

router.use(healthRouter);
router.use("/auth", authRouter);
router.use("/users", usersRouter);
router.use("/cohorts", cohortsRouter);
router.use("/markets", marketsRouter);
router.use("/trades", tradesRouter);
router.use("/wallet", walletRouter);
router.use("/liquidity", liquidityRouter);
router.use("/leaderboard", leaderboardRouter);
router.use(commentsRouter);
router.use(ideasRouter);
router.use(badgesRouter);

export default router;
