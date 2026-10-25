import { pgTable, serial, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Hourly point-in-time record of each market maker's liquidity position.
// Supports rewards over explicit reporting windows:
//   1) Fee attribution: sum over intervals of (poolShare * change in market cumulativeFees).
//   2) Eligibility floor: how much was deployed, across how many markets, for how long.
export const lpSnapshotsTable = pgTable("lp_snapshots", {
  id: serial("id").primaryKey(),
  takenAt: timestamp("taken_at").defaultNow().notNull(),
  userId: integer("user_id").notNull(),
  marketId: integer("market_id").notNull(),
  // Maker's share of this market's pool at snapshot time (0..1).
  poolShare: numeric("pool_share", { precision: 12, scale: 8 }).notNull().default("0"),
  // Mark-to-market GIES value of the maker's LP claim in this market.
  deployedValue: numeric("deployed_value", { precision: 18, scale: 6 }).notNull().default("0"),
  // Market's cumulative fees at snapshot time (for interval fee attribution).
  marketCumulativeFees: numeric("market_cumulative_fees", { precision: 18, scale: 6 }).notNull().default("0"),
});

export const insertLpSnapshotSchema = createInsertSchema(lpSnapshotsTable).omit({ id: true });
export type InsertLpSnapshot = z.infer<typeof insertLpSnapshotSchema>;
export type LpSnapshot = typeof lpSnapshotsTable.$inferSelect;
