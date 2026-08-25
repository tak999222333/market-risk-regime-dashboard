# 香港及中國市場資料研究

## 可用資料與代理

| 用途 | 可用來源／代理 | 資料可用性與注意事項 |
|---|---|---|
| 香港股票風險偏好 | Nasdaq Quote API 的 EWH（iShares MSCI Hong Kong ETF） | 已在 2026-08-25 實測可取得價格、日內變化、時間戳及 `isRealTime=true`。此為香港市場 ETF 代理，並非恒生指數原始數值。 |
| 中國 A 股風險偏好 | Nasdaq Quote API 的 ASHR（Xtrackers Harvest CSI 300 China A-Shares ETF） | 已在 2026-08-25 實測可取得價格、日內變化、時間戳及 `isRealTime=true`。作 CSI 300／A 股風險代理。 |
| 中國科技／高 beta 確認 | Nasdaq Quote API 的 KWEB（KraneShares CSI China Internet ETF） | 已在 2026-08-25 實測可取得價格、日內變化、時間戳及 `isRealTime=true`。作中國互聯網高 beta 確認。 |
| 人民幣壓力 | FRED：DEXCHUS | 每日美元兌人民幣中間／現匯資料；數值上升代表人民幣對美元走弱，應降低中港風險分數。來源為美聯儲 H.10。 |
| 香港／中國官方指數資料 | Hang Seng Indexes、HKEX OMD Index | 恒生指數官方網站會顯示 HSI、HSCEI、恒生科技及時間戳；HKEX 說明 OMD Index 包含 HSI、VHSI、CSI 300、SSE Composite 等，但即時資料分發屬受授權資料服務。不可自動擷取其網頁延遲報價。 |

## 設計結論

首版會把 EWH、ASHR、KWEB 及 DEXCHUS 作為可持續自動更新的市場代理，同時保留 VIX 與美國 HY OAS 作為全球波動與信用壓力的外部確認。介面會明確標示「ETF／全球壓力代理」及資料頻率，避免誤稱為 HKEX 或 SSE 的原始即時行情。

## 外部來源

1. Hang Seng Indexes: https://www.hsi.com.hk/
2. HKEX Real-time Datafeeds: https://www.hkex.com.hk/Services/Market-Data-Services/Real-Time-Data-Services/Overview/Real_time-Datafeeds?sc_lang=en
3. FRED Chinese Yuan Renminbi to U.S. Dollar Spot Exchange Rate (DEXCHUS): https://fred.stlouisfed.org/series/DEXCHUS
4. Nasdaq Quote API probe: https://api.nasdaq.com/api/quote/ewh/info?assetclass=etf
5. Nasdaq Quote API probe: https://api.nasdaq.com/api/quote/ashr/info?assetclass=etf
6. Nasdaq Quote API probe: https://api.nasdaq.com/api/quote/kweb/info?assetclass=etf
