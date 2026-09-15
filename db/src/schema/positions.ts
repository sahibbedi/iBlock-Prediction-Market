import { pgTable, serial, timestamp, numeric, integer, text, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const positionsTable = pgTable("positions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  marketId: integer("market_id").notNull(),
  outcome: text("outcome").notNull(),
  tokenAmount: numeric("token_amount", { precision: 18, scale: 6 }).notNull().default("0"),
  totalCostBasis: numeric("total_cost_basis", { precision: 18, scale: 6 }).notNull().default("0"),
    realizedPnl: numeric("realized_pnl", { precision: 18, scale: 6 }).notNull().default("0"),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  }, (t) => ({
  uniquePosition: unique().on(t.userId, t.marketId, t.outcome),
  }));

export const lpPositionsTable = pgTable("lp_positions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  marketId: integer("market_id").notNull(),
  lpShares: numeric("lp_shares", { precision: 18, scale: 6 }).notNull().default("0"),
  totalGiesProvided: numeric("total_gies_provided", { precision: 18, scale: 6 }).notNull().default("0"),
  feesEarned: numeric("fees_earned", { precision: 18, scale: 6 }).notNull().default("0"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const priceHistoryTable = pgTable("price_history", {
  id: serial("id").primaryKey(),
  marketId: integer("market_id").notNull(),
  yesPrice: numeric("yes_price", { precision: 18, scale: 6 }).notNull(),
  noPrice: numeric("no_price", { precision: 18, scale: 6 }).notNull(),
  volume: numeric("volume", { precision: 18, scale: 6 }).notNull().default("0"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPositionSchema = createInsertSchema(positionsTable).omit({ id: true, updatedAt: true });
export type InsertPosition = z.infer<typeof insertPositionSchema>;
export type Position = typeof positionsTable.$inferSelect;
