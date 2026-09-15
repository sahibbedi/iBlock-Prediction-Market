import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

// Allowlist for self-signup. Only emails present here (and unclaimed) may register.
// Seeded once from the class roster; ties every account to a vetted student and
// carries their academic cohort + rotation-group assignment onto the new account.
export const rosterTable = pgTable("roster", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  displayName: text("display_name").notNull(),
  cohortLabel: text("cohort_label"),        // "428" | "412" (human-readable)
  cohortId: integer("cohort_id"),           // resolved FK into cohorts.id
  rotationGroup: integer("rotation_group"), // 1..3
  claimed: boolean("claimed").notNull().default(false),
  claimedUserId: integer("claimed_user_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertRosterSchema = createInsertSchema(rosterTable).omit({ id: true, createdAt: true });
export type InsertRoster = z.infer<typeof insertRosterSchema>;
export type Roster = typeof rosterTable.$inferSelect;
