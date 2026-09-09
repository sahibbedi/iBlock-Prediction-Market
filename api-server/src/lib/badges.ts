import { db, userBadgesTable, tradesTable, marketIdeasTable, marketIdeaVotesTable, marketCommentsTable, transactionsTable, positionsTable, marketsTable } from "@workspace/db";
import { eq, and, count, gte, sql } from "drizzle-orm";

export interface BadgeDefinition {
  id: string;
  name: string;
  description: string;
  emoji: string;
  category: "trading" | "community" | "advanced";
}

export const BADGE_DEFINITIONS: BadgeDefinition[] = [
  { id: "first_trade",         name: "First Trade",       description: "Placed your very first trade",                  emoji: "🎯", category: "trading"   },
  { id: "veteran_trader",      name: "Veteran Trader",    description: "Placed 10 or more trades",                      emoji: "📈", category: "trading"   },
  { id: "prolific_trader",     name: "Prolific Trader",   description: "Placed 50 or more trades",                      emoji: "🚀", category: "trading"   },
  { id: "profit_taker",        name: "In The Green",      description: "Sold a position for the first time",            emoji: "💰", category: "trading"   },
  { id: "whale",               name: "Whale",             description: "Placed a single trade worth 100+ GIES",         emoji: "🐋", category: "trading"   },
  { id: "idea_pioneer",        name: "Idea Pioneer",      description: "Submitted your first market idea",               emoji: "💡", category: "community" },
  { id: "community_voter",     name: "Community Voice",   description: "Upvoted 5 or more market ideas",                emoji: "👍", category: "community" },
  { id: "commentator",         name: "Commentator",       description: "Posted your first comment on a market",         emoji: "💬", category: "community" },
  { id: "liquidity_provider",  name: "Market Maker",      description: "Added liquidity to a market pool",              emoji: "🌊", category: "advanced"  },
  { id: "oracle",              name: "Oracle",            description: "Correctly predicted 3 or more resolved markets", emoji: "🔮", category: "advanced"  },
];

const BADGE_IDS = new Set(BADGE_DEFINITIONS.map(b => b.id));

/**
 * Check all badge conditions for a user and award any newly-earned badges.
 * Returns the list of newly-awarded badge IDs.
 */
export async function evaluateAndAwardBadges(userId: number): Promise<string[]> {
  const existing = await db
    .select({ badgeId: userBadgesTable.badgeId })
    .from(userBadgesTable)
    .where(eq(userBadgesTable.userId, userId));
  const earned = new Set(existing.map(e => e.badgeId));

  const toAward: string[] = [];

  // --- TRADING ---
  if (!earned.has("first_trade") || !earned.has("veteran_trader") || !earned.has("prolific_trader") || !earned.has("profit_taker") || !earned.has("whale")) {
    const [tradeCounts] = await db
      .select({ total: count() })
      .from(tradesTable)
      .where(eq(tradesTable.userId, userId));
    const total = Number(tradeCounts?.total ?? 0);
    if (total >= 1  && !earned.has("first_trade"))       toAward.push("first_trade");
    if (total >= 10 && !earned.has("veteran_trader"))    toAward.push("veteran_trader");
    if (total >= 50 && !earned.has("prolific_trader"))   toAward.push("prolific_trader");

    if (!earned.has("profit_taker")) {
      const [sell] = await db.select({ id: tradesTable.id })
        .from(tradesTable)
        .where(and(eq(tradesTable.userId, userId), eq(tradesTable.side, "sell")))
        .limit(1);
      if (sell) toAward.push("profit_taker");
    }

    if (!earned.has("whale")) {
      const [big] = await db.select({ id: tradesTable.id })
        .from(tradesTable)
        .where(and(eq(tradesTable.userId, userId), gte(tradesTable.giesCost, "100")))
        .limit(1);
      if (big) toAward.push("whale");
    }
  }

  // --- COMMUNITY: ideas ---
  if (!earned.has("idea_pioneer")) {
    const [ic] = await db.select({ c: count() }).from(marketIdeasTable).where(eq(marketIdeasTable.submittedBy, userId));
    if (Number(ic?.c ?? 0) >= 1) toAward.push("idea_pioneer");
  }

  // --- COMMUNITY: votes ---
  if (!earned.has("community_voter")) {
    const [vc] = await db.select({ c: count() }).from(marketIdeaVotesTable).where(eq(marketIdeaVotesTable.userId, userId));
    if (Number(vc?.c ?? 0) >= 5) toAward.push("community_voter");
  }

  // --- COMMUNITY: comments ---
  if (!earned.has("commentator")) {
    const [cc] = await db.select({ c: count() }).from(marketCommentsTable).where(eq(marketCommentsTable.userId, userId));
    if (Number(cc?.c ?? 0) >= 1) toAward.push("commentator");
  }

  // --- ADVANCED: liquidity ---
  if (!earned.has("liquidity_provider")) {
    const [lp] = await db.select({ id: transactionsTable.id })
      .from(transactionsTable)
      .where(and(eq(transactionsTable.userId, userId), eq(transactionsTable.type, "liquidity_add")))
      .limit(1);
    if (lp) toAward.push("liquidity_provider");
  }

  // --- ADVANCED: oracle (3+ correctly predicted resolved markets) ---
  if (!earned.has("oracle")) {
    const correct = await db
      .select({ marketId: positionsTable.marketId })
      .from(positionsTable)
      .innerJoin(marketsTable, and(
        eq(marketsTable.id, positionsTable.marketId),
        eq(marketsTable.status, "resolved"),
        sql`${marketsTable.outcome} = ${positionsTable.outcome}`
      ))
      .where(and(
        eq(positionsTable.userId, userId),
        sql`${positionsTable.tokenAmount}::numeric > 0`
      ));
    if (correct.length >= 3) toAward.push("oracle");
  }

  if (toAward.length > 0) {
    await db.insert(userBadgesTable)
      .values(toAward.map(badgeId => ({ userId, badgeId })))
      .onConflictDoNothing();
  }

  return toAward;
}

/** Fetch all earned badges for a user, merged with definitions. */
export async function getUserBadges(userId: number) {
  const earned = await db
    .select()
    .from(userBadgesTable)
    .where(eq(userBadgesTable.userId, userId));
  const earnedMap = new Map(earned.map(e => [e.badgeId, e.awardedAt]));

  return BADGE_DEFINITIONS.map(def => ({
    ...def,
    earned: earnedMap.has(def.id),
    awardedAt: earnedMap.get(def.id) ?? null,
  }));
}

/** Batch fetch badge counts for multiple users (for leaderboard). */
export async function getBadgeCountsByUsers(userIds: number[]): Promise<Map<number, number>> {
  if (userIds.length === 0) return new Map();
  const rows = await db
    .select({ userId: userBadgesTable.userId, cnt: count() })
    .from(userBadgesTable)
    .where(sql`${userBadgesTable.userId} = ANY(${sql.raw(`ARRAY[${userIds.join(",")}]`)}::int[])`)
    .groupBy(userBadgesTable.userId);
  return new Map(rows.map(r => [r.userId, Number(r.cnt)]));
}
