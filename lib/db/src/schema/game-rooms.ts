import { pgTable, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

export const gameRoomsTable = pgTable("game_rooms", {
  code: text("code").primaryKey(),
  state: jsonb("state").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertGameRoomSchema = createInsertSchema(gameRoomsTable);
export type GameRoom = typeof gameRoomsTable.$inferSelect;