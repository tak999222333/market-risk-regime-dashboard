-- Migration 0002: Add DESC index on (market, calculated_at)
-- 為 ORDER BY calculated_at DESC LIMIT 加速。
-- 生產環境已經手動 apply 過（透過 Cloudflare D1 Console）。EXPLAIN QUERY PLAN 已確認生效。

CREATE INDEX IF NOT EXISTS idx_market_snapshots_market_calc
  ON market_snapshots (market, calculated_at DESC);
