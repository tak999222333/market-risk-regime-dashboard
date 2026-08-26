import { index, int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export const marketSnapshots = mysqlTable("marketSnapshots", {
  id: int("id").autoincrement().primaryKey(),
  market: mysqlEnum("market", ["global", "hongKong", "china"]).default("global").notNull(),
  compositeScore: int("compositeScore").notNull(),
  regime: varchar("regime", { length: 16 }).notNull(),
  confidence: int("confidence").notNull(),
  dataStatus: varchar("dataStatus", { length: 16 }).notNull(),
  payload: text("payload").notNull(),
  calculatedAt: timestamp("calculatedAt").defaultNow().notNull(),
}, (table) => [
  index("marketSnapshots_market_calculatedAt_idx").on(table.market, table.calculatedAt),
]);

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type MarketSnapshotRow = typeof marketSnapshots.$inferSelect;
