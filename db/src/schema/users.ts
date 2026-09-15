import { pgTable, serial, text, timestamp, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("student"),
  cohortId: integer("cohort_id"),
  // Rotation group (1..3) for the maker/taker seat rotation. NULL = not in a group
  // (e.g. teacher/admin). One group is "active" (market_maker) per cycle.
  rotationGroup: integer("rotation_group"),
  giesBalance: numeric("gies_balance", { precision: 18, scale: 6 }).notNull().default("1000"),
  // Separate "market-maker desk" capital. Granted when a student enters their
  // maker cycle, settled (and zeroed) when they rotate out. Liquidity operations
  // draw from this while role = market_maker; personal trading uses giesBalance.
  deskBalance: numeric("desk_balance", { precision: 18, scale: 6 }).notNull().default("0"),
  faucetLastClaimed: timestamp("faucet_last_claimed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
