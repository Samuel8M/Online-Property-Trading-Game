import { pgTable, text, jsonb, timestamp, index } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";

export const gameRoomsTable = pgTable("game_rooms", {
  code: text("code").primaryKey(),
  state: jsonb("state").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // New/legacy rows are checked once; reconciled inactive rooms have no due work.
  nextReconcileAt: timestamp("next_reconcile_at", { withTimezone: true }).defaultNow(),
}, table => [
  index("game_rooms_due_idx").on(table.nextReconcileAt, table.code)
    .where(sql`${table.nextReconcileAt} IS NOT NULL`),
]);

export const insertGameRoomSchema = createInsertSchema(gameRoomsTable);
export type GameRoom = typeof gameRoomsTable.$inferSelect;