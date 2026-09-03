-- Migration 0003: Drop payload TEXT column
-- 每個 snapshot 之前存 ~100KB JSON payload，係造成 D1 rows_read quota (89%) 嘅主因。
-- 由於前端只讀 composite_score / regime / confidence / data_status / calculated_at，冇必要保留 raw payload。
-- 執行呢個 migration 之前 worker.ts 已改用 lightweight columns 讀寫；worker code 有 try/catch fallback，
-- 令舊 schema (payload NOT NULL) 同新 schema (無 payload) 都能執行。
--
-- SQLite 唔支援 ALTER TABLE DROP COLUMN，只能用 rebuild table pattern。
-- D1 batch statement (Cloudflare D1 auto wraps them in an implicit transaction)。

ALTER TABLE market_snapshots RENAME TO market_snapshots_legacy;

CREATE TABLE market_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market TEXT NOT NULL CHECK (market IN ('global', 'hongKong', 'china')),
  composite_score INTEGER NOT NULL,
  regime TEXT NOT NULL,
  confidence INTEGER NOT NULL,
  data_status TEXT NOT NULL,
  calculated_at TEXT NOT NULL
);

INSERT INTO market_snapshots (id, market, composite_score, regime, confidence, data_status, calculated_at)
  SELECT id, market, composite_score, regime, confidence, data_status, calculated_at
  FROM market_snapshots_legacy;

DROP TABLE market_snapshots_legacy;

CREATE INDEX idx_market_snapshots_market_calculated_at
  ON market_snapshots (market, calculated_at);

CREATE INDEX idx_market_snapshots_market_calc
  ON market_snapshots (market, calculated_at DESC);
