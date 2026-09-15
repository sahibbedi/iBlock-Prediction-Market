import { pgTable, serial, text, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const cohortsTable = pgTable("cohorts", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  teacherId: integer("teacher_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const cohortMembersTable = pgTable("cohort_members", {
  id: serial("id").primaryKey(),
  cohortId: integer("cohort_id").notNull(),
  userId: integer("user_id").notNull(),
  joinedAt: timestamp("joined_at").defaultNow().notNull(),
});

export const insertCohortSchema = createInsertSchema(cohortsTable).omit({ id: true, createdAt: true });
export type InsertCohort = z.infer<typeof insertCohortSchema>;
export type Cohort = typeof cohortsTable.$inferSelect;
