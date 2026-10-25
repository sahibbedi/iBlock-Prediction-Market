import { pgTable, integer, numeric, boolean, jsonb, serial, text, timestamp } from "drizzle-orm/pg-core";

export const platformConfigTable = pgTable("platform_config", {
  id: integer("id").primaryKey().default(1),
  routineThreshold: integer("routine_threshold").notNull().default(2),
  resolveThreshold: integer("resolve_threshold").notNull().default(2),
  version: integer("version").notNull().default(1),
  paused: boolean("paused").notNull().default(false),
  starterAmount: numeric("starter_amount", { precision: 18, scale: 6 }).notNull().default("5000"),
  makerCapital: numeric("maker_capital", { precision: 18, scale: 6 }).notNull().default("15000"),
  feeBase: numeric("fee_base", { precision: 6, scale: 4 }).notNull().default("0.02"),
  feeMax: numeric("fee_max", { precision: 6, scale: 4 }).notNull().default("0.05"),
  feeMatch: numeric("fee_match", { precision: 6, scale: 4 }).notNull().default("0"),
  rewardBudget: numeric("reward_budget", { precision: 18, scale: 6 }).notNull().default("0"),
  treasuryBalance: numeric("treasury_balance", { precision: 18, scale: 6 }).notNull().default("0"),
});

export const proposalsTable = pgTable("committee_proposals", {
  id: serial("id").primaryKey(),
  action: jsonb("action").$type<Record<string, unknown>>().notNull(),
  proposerId: integer("proposer_id").notNull(),
  approvals: jsonb("approvals").$type<number[]>().notNull().default([]),
  version: integer("version").notNull(),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  executedAt: timestamp("executed_at"),
});

export const rewardClaimsTable = pgTable("reward_claims", {
  id: serial("id").primaryKey(),
  claimId: text("claim_id").notNull().unique(),
  userId: integer("user_id").notNull(),
  amount: numeric("amount", { precision: 18, scale: 6 }).notNull(),
  evidence: text("evidence").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const walletChallengesTable = pgTable("wallet_challenges", {
  userId: integer("user_id").primaryKey(),
  wallet: text("wallet").notNull(),
  message: text("message").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
});
