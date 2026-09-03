-- Migration 0001: Initial schema
-- 記錄現有 D1 database `market-regime-pulse` 嘅初始 schema。
-- 呢個 file 只係 documentation 用途；已經 run 過嘅 database 唔需要重跑。
-- 新 environment (staging / preview) 就用 wrangler d1 migrations apply 一鍵建立。

CREATE TABLE IF NOT EXISTS market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market TEXT NOT NULL CHECK (market IN ('global', 'hongKong', 'china')),
  composite_score INTEGER NOT NULL,
  regime TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  data_status TEXT NOT NULL,
  payload TEXT NOT NULL,
  calculated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_market_snapshots_market_calculated_at
  ON market_snapshots (market, calculated_at);
