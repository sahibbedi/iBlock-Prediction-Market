import { db, usersTable, marketsTable, lpPositionsTable, lpSnapshotsTable } from "@workspace/db";
import { eq, and, gt } from "drizzle-orm";
import { logger } from "./logger.js";

// Mark-to-market value of an LP claim: share * (yesPool*yesPrice + noPool*noPrice),
// which simplifies to share * (2*yesPool*noPool / total).
function claimValue(yesPool: number, noPool: number): number {
  const total = yesPool + noPool;
  return total > 0 ? (2 * yesPool * noPool) / total : 0;
}

/**
 * Take one point-in-time snapshot of every market maker's open LP positions.
 * Cheap: a handful of makers x a handful of markets. Safe to call repeatedly.
 */
export async function runSnapshot(): Promise<number> {
  try {
    const makers = (await db.select().from(usersTable)).filter((u) => u.role === "market_maker");
    if (makers.length === 0) return 0;

    const markets = await db.select().from(marketsTable);
    const marketById = new Map(markets.map((m) => [m.id, m]));

    const rows: any[] = [];
    for (const maker of makers) {
      const positions = await db
        .select()
        .from(lpPositionsTable)
        .where(and(eq(lpPositionsTable.userId, maker.id), gt(lpPositionsTable.lpShares, "0")));

      for (const pos of positions) {
        const market = marketById.get(pos.marketId);
        if (!market || market.status !== "open") continue;

        const totalShares = parseFloat(market.lpShares);
        const myShares = parseFloat(pos.lpShares);
        const poolShare = totalShares > 0 ? myShares / totalShares : 0;
        const deployedValue = poolShare * claimValue(parseFloat(market.yesPool), parseFloat(market.noPool));

        rows.push({
          userId: maker.id,
          marketId: market.id,
          poolShare: poolShare.toFixed(8),
          deployedValue: deployedValue.toFixed(6),
          marketCumulativeFees: market.cumulativeFees,
        });
      }
    }

    if (rows.length > 0) {
      await db.insert(lpSnapshotsTable).values(rows);
    }
    logger.info({ makers: makers.length, rows: rows.length }, "LP snapshot taken");
    return rows.length;
  } catch (err) {
    // Never let a snapshot failure crash the server.
    logger.error({ err }, "LP snapshot failed");
    return 0;
  }
}

let started = false;
const HOUR_MS = 60 * 60 * 1000;

/** Start the hourly snapshot loop once, on server boot. */
export function startSnapshotLoop(): void {
  if (started) return;
  started = true;
  // First snapshot shortly after boot, then hourly.
  setTimeout(() => void runSnapshot(), 30_000);
  setInterval(() => void runSnapshot(), HOUR_MS);
  logger.info("LP snapshot loop started (hourly)");
}
