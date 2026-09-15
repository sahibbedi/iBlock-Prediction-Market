import { pgTable, serial, text, timestamp, integer, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const marketIdeasTable = pgTable("market_ideas", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  category: text("category").notNull().default("general"),
  submittedBy: integer("submitted_by").notNull(),
  cohortId: integer("cohort_id"),
  status: text("status").notNull().default("pending"),
  reviewedBy: integer("reviewed_by"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const marketIdeaVotesTable = pgTable("market_idea_votes", {
  id: serial("id").primaryKey(),
  ideaId: integer("idea_id").notNull(),
  userId: integer("user_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  uniqueVote: unique().on(t.ideaId, t.userId),
}));

export const insertMarketIdeaSchema = createInsertSchema(marketIdeasTable).omit({
  id: true,
  createdAt: true,
  status: true,
  reviewedBy: true,
  reviewNote: true,
});
export type InsertMarketIdea = z.infer<typeof insertMarketIdeaSchema>;
export type MarketIdea = typeof marketIdeasTable.$inferSelect;
