import { desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { InsertUser, marketSnapshots, users } from "../drizzle/schema";
import type { MarketScope, MarketSnapshot } from "../shared/marketTypes";
import { HISTORY_INTERVAL_META, type HistoryInterval } from "../shared/marketHistory";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  for (const field of ["name", "email", "loginMethod"] as const) {
    if (user[field] !== undefined) {
      values[field] = user[field] ?? null;
      updateSet[field] = user[field] ?? null;
    }
  }
  values.lastSignedIn = user.lastSignedIn ?? new Date();
  updateSet.lastSignedIn = values.lastSignedIn;
  values.role = user.role ?? (user.openId === ENV.ownerOpenId ? "admin" : "user");
  updateSet.role = values.role;
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function insertMarketSnapshot(snapshot: MarketSnapshot): Promise<void> {
  const db = await getDb();
  if (!db) {
    console.warn("[Market data] Database not available; snapshot is not persisted");
    return;
  }
  await db.insert(marketSnapshots).values({
    market: snapshot.market,
    compositeScore: snapshot.compositeScore,
    regime: snapshot.regime,
    confidence: snapshot.confidence,
    dataStatus: snapshot.dataStatus,
    payload: JSON.stringify(snapshot),
    calculatedAt: new Date(snapshot.calculatedAt),
  });
}

export async function getRecentMarketSnapshots(market: MarketScope, limit = 72): Promise<MarketSnapshot[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(marketSnapshots)
    .where(eq(marketSnapshots.market, market))
    .orderBy(desc(marketSnapshots.calculatedAt))
    .limit(limit);
  return rows.flatMap((row) => {
    try {
      const snapshot = JSON.parse(row.payload) as Partial<MarketSnapshot>;
      return [{ ...snapshot, market: snapshot.market ?? row.market } as MarketSnapshot];
    } catch {
      return [];
    }
  }).reverse();
}

export async function getMarketSnapshotsForInterval(market: MarketScope, interval: HistoryInterval): Promise<MarketSnapshot[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(marketSnapshots)
    .where(eq(marketSnapshots.market, market))
    .orderBy(desc(marketSnapshots.calculatedAt))
    .limit(HISTORY_INTERVAL_META[interval].maxRawRows);
  return rows.flatMap((row) => {
    try {
      const snapshot = JSON.parse(row.payload) as Partial<MarketSnapshot>;
      return [{ ...snapshot, market: snapshot.market ?? row.market } as MarketSnapshot];
    } catch {
      return [];
    }
  }).reverse();
}
