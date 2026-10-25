import { pgTable, serial, text, timestamp, numeric, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  displayName: text("display_name").notNull(),
  email: text("email"),
  walletAddress: text("wallet_address").unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("observer"),
  cohortId: integer("cohort_id"),
  active: boolean("active").notNull().default(true),
  sessionVersion: integer("session_version").notNull().default(0),
  giesBalance: numeric("gies_balance", { precision: 18, scale: 6 }).notNull().default("0"),
  // Persistent committee-funded capital. Personal trading uses giesBalance.
  deskBalance: numeric("desk_balance", { precision: 18, scale: 6 }).notNull().default("0"),
  faucetLastClaimed: timestamp("faucet_last_claimed"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(usersTable).omit({ id: true, createdAt: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof usersTable.$inferSelect;
