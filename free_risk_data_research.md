# 免費公開 Risk-on／Risk-off 補充資料來源

研究日期：2026-08-26（香港時間）

## 優先資料來源

| 來源 | 可用訊號 | 頻率／延遲 | 適合用途 | 主要限制 |
|---|---|---|---|---|
| FRED | 美國國債收益率、HY OAS、VIX、美元、商業票據、經濟不確定性等 | 視系列而定，多為日終 | 信貸、利率、美元及宏觀壓力底座 | 不適合假裝為即時報價；每個系列有自己的發布時點 |
| OFR Financial Stress Index | 33 項市場變數合成的金融壓力 | 日度，資料約滯後 2 個工作天 | 全球壓力的慢速交叉驗證／警戒線 | 不可取代分鐘級市場訊號 |
| Cboe Daily Market Statistics | 指數與股票期權成交、Put/Call Ratio 等 | 日度 | 期權避險及情緒確認 | 使用前需遵守 Cboe 網站條款；單日 Put/Call 不應單獨當作反向訊號 |
| CFTC COT | VIX、股指、利率、美元及商品期貨的交易者持倉分類 | 每週，星期五發布截至星期二資料 | 槓桿／資產管理人倉位的中週期確認 | 滯後及分類限制，不可作日內訊號 |
| FINRA Fixed Income Data | 美國債券交易及固定收益市場彙總資料 | 工具／品種而定 | 信貸市場活躍度與交易壓力輔助訊號 | 不等同免費完整 HY OAS 曲線；需選擇適當彙總口徑 |
| HKEX Stock Connect Historical Daily | 滬深港通北向及南向每日統計 | 日度 | 中港資金流的本地確認訊號 | 是成交／流量統計，不必然等於淨買入；應明確定義計算方式 |
| HKMA Data & Statistics | 香港日度貨幣統計、月度統計及經濟金融資料 | 日度至月度 | 港元流動性與本地貨幣市場背景 | 多數適合作慢速流動性背景，不是即時風險開關 |

## 建議整合順序

1. 先把 HKEX 北向／南向每日統計加進香港及中國頁：它最能補足現有 ETF 代理欠缺的本地資金流訊號。
2. 將 OFR FSI 加入全球、香港及中國頁，但只作日度置信度警戒，而非高權重即時因子。OFR 官方 JSON 可透過尾端範圍請求取得最新資料。
3. Cboe 的公開 index Put/Call 歷史 CSV 已核實為舊檔，未有採用為自動化來源，以免加入過時避險訊號；如日後有穩定的官方最新端點才重新評估。
4. 最後再加入 CFTC COT，計算各合約持倉的 52 週百分位或 z-score，作每週倉位擁擠度提示。

## 資料披露規則

所有系列須顯示來源、原始頻率、最後原始觀察日期及資料用途。即時、日終和每週系列不可混為同一個「即時」標籤；慢速資料應只確認或降低置信度，不應在新一分鐘內大幅改變 regime。

## 來源

- FRED：https://fred.stlouisfed.org/
- OFR Financial Stress Index：https://www.financialresearch.gov/financial-stress-index/
- Cboe Daily Market Statistics：https://www.cboe.com/markets/us/options/market-statistics/daily/
- CFTC Commitments of Traders：https://www.cftc.gov/MarketReports/CommitmentsofTraders/index.htm
- FINRA Market Data FAQ：https://www.finra.org/investors/market-data-frequently-asked-questions
- HKEX Stock Connect Historical Daily：https://www.hkex.com.hk/Mutual-Market/Stock-Connect/Statistics/Historical-Daily?sc_lang=en
- HKMA Data & Statistics：https://www.hkma.gov.hk/eng/data-publications-and-research/data-and-statistics/
