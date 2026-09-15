import { pgTable, serial, text, timestamp, integer, unique } from "drizzle-orm/pg-core";

export const userBadgesTable = pgTable("user_badges", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  badgeId: text("badge_id").notNull(),
  awardedAt: timestamp("awarded_at").defaultNow().notNull(),
}, (t) => ({
  uniqueBadge: unique().on(t.userId, t.badgeId),
}));

export type UserBadge = typeof userBadgesTable.$inferSelect;
