import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const marketCommentsTable = pgTable("market_comments", {
  id: serial("id").primaryKey(),
  marketId: integer("market_id").notNull(),
  userId: integer("user_id").notNull(),
  text: text("text").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMarketCommentSchema = createInsertSchema(marketCommentsTable).omit({ id: true, createdAt: true });
export type InsertMarketComment = z.infer<typeof insertMarketCommentSchema>;
export type MarketComment = typeof marketCommentsTable.$inferSelect;
