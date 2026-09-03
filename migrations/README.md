# D1 Migrations

管理 D1 database schema 嘅正式方式。避免將來再喺 Cloudflare Dashboard 手動改 schema。

## 現有 migrations

| # | 名稱 | 狀態 | 目的 |
|---|------|------|------|
| 0001 | initial_schema | ✅ 已 apply (原始 schema，documentation 用途) | 建立 `market_snapshots` table |
| 0002 | add_desc_index | ✅ 已 apply (透過 Dashboard 手動) | 加 `(market, calculated_at DESC)` index，用於 chart query |
| 0003 | drop_payload_column | ⏳ **未 apply** — 需要停一分鐘 write | Rebuild table 移除 payload TEXT column，最大力慳 D1 storage / rows_read |

## 執行方法

Local / new environment：

```bash
wrangler d1 migrations apply market-regime-pulse
```

指定 remote (生產)：

```bash
wrangler d1 migrations apply market-regime-pulse --remote
```

## 執行 0003 之前要諗

- Table rename + rebuild 期間，如果啱啱 cron 觸發 storeSnapshot 有機會 write failed。
- Worker code 已有 try/catch fallback，會 auto-retry 用另一個 schema shape。
- 但保險做法：apply 前先 disable cron 一分鐘（喺 Cloudflare Dashboard），apply 完再 enable。
- Table 只有 ~24K rows，migration 應該 <5 秒。
