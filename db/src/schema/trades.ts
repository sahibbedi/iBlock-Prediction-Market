import { pgTable, serial, text, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  marketId: integer("market_id").notNull(),
  userId: integer("user_id").notNull(),
  side: text("side").notNull(),
  outcome: text("outcome").notNull(),
  tokenAmount: numeric("token_amount", { precision: 18, scale: 6 }).notNull(),
  giesCost: numeric("gies_cost", { precision: 18, scale: 6 }).notNull(),
  pricePerToken: numeric("price_per_token", { precision: 18, scale: 6 }).notNull(),
  txHash: text("tx_hash").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({ id: true, createdAt: true });
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
