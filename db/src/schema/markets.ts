import { pgTable, serial, text, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const marketsTable = pgTable("markets", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  resolutionCriteria: text("resolution_criteria").notNull().default(""),
  learningPanel: text("learning_panel"),
  category: text("category").notNull().default("general"),
  cohortId: integer("cohort_id"),
  creatorId: integer("creator_id").notNull(),
  status: text("status").notNull().default("open"),
  outcome: text("outcome"),
  yesPool: numeric("yes_pool", { precision: 18, scale: 6 }).notNull().default("500"),
  noPool: numeric("no_pool", { precision: 18, scale: 6 }).notNull().default("500"),
  totalVolume: numeric("total_volume", { precision: 18, scale: 6 }).notNull().default("0"),
  totalLiquidity: numeric("total_liquidity", { precision: 18, scale: 6 }).notNull().default("1000"),
  lpShares: numeric("lp_shares", { precision: 18, scale: 6 }).notNull().default("1000"),
    vaultCollateral: numeric("vault_collateral", { precision: 18, scale: 6 }).notNull().default("0"),
    totalYesSupply: numeric("total_yes_supply", { precision: 18, scale: 6 }).notNull().default("0"),
    totalNoSupply: numeric("total_no_supply", { precision: 18, scale: 6 }).notNull().default("0"),
  // Running total of trading fees this market has generated over its life.
  // Used (with the LP snapshots) to attribute fees to each LP for rewards.
  cumulativeFees: numeric("cumulative_fees", { precision: 18, scale: 6 }).notNull().default("0"),

  tradingFeeRate: numeric("trading_fee_rate", { precision: 6, scale: 4 }).notNull().default("0.02"),
  maxPriceImpact: numeric("max_price_impact", { precision: 6, scale: 4 }).notNull().default("0.15"),
  minPoolDepth: numeric("min_pool_depth", { precision: 18, scale: 6 }).notNull().default("10"),
  maxTradeSizePct: numeric("max_trade_size_pct", { precision: 6, scale: 4 }).notNull().default("0.25"),
  virtualLiquidity: numeric("virtual_liquidity", { precision: 18, scale: 6 }).notNull().default("400"),
  virtualLiquidityDecayVolume: numeric("virtual_liquidity_decay_volume", { precision: 18, scale: 6 }).notNull().default("1000"),
  resolvesAt: timestamp("resolves_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMarketSchema = createInsertSchema(marketsTable).omit({ id: true, createdAt: true });
export type InsertMarket = z.infer<typeof insertMarketSchema>;
export type Market = typeof marketsTable.$inferSelect;