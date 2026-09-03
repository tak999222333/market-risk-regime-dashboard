import { calculateCompositeScore, calculateConfidence, determineRegime } from "../shared/riskRegime";
import { MARKET_SCOPES, MARKET_SCOPE_META, type DataFreshness, type LiveMarketFactor, type MarketFactorKey, type MarketScope, type MarketSnapshot, type SupplementalSignal } from "../shared/marketTypes";
import { STATIC_ASSETS } from "./generated-assets";

type HistoryInterval = "minute" | "hour" | "day";
type FredPoint = { date: string; value: number; previous: number | null };
type NasdaqQuote = { last: number; changePercent: number; updatedAt: string };
type BitcoinQuote = { price: number; changePercent: number; updatedAt: string };
type OfrFsiPoint = { value: number; updatedAt: string };
type StockConnectPoint = { date: string; northboundTurnover: number; southboundTurnover: number };

interface D1Result<T> { results: T[]; success: boolean; }
interface D1Statement { bind(...values: unknown[]): D1Statement; all<T>(): Promise<D1Result<T>>; first<T>(): Promise<T | null>; run(): Promise<unknown>; }
interface D1Database { prepare(query: string): D1Statement; }
interface Env { DB: D1Database; }

const FRED_SERIES = { vix: "VIXCLS", highYieldSpread: "BAMLH0A0HYM2", dollarIndex: "DTWEXBGS", yuanPerUsd: "DEXCHUS" } as const;
const INTERVAL_META: Record<HistoryInterval, { bucketMs: number; maxRawRows: number }> = {
  minute: { bucketMs: 60_000, maxRawRows: 50_000 },
  hour: { bucketMs: 60 * 60_000, maxRawRows: 50_000 },
  day: { bucketMs: 24 * 60 * 60_000, maxRawRows: 50_000 },
};
const MARKET_CONFIG: Record<MarketScope, { weights: Record<MarketFactorKey, number>; equity: { symbol: string; name: string; label: string; sourceUrl: string; sensitivity: number }; cross: { symbol?: string; name: string; label: string; sourceUrl: string; sensitivity: number } }> = {
  global: { weights: { equity: 0.25, volatility: 0.2, credit: 0.25, safeHaven: 0.15, crossAsset: 0.15 }, equity: { symbol: "ndx", name: "股票風險偏好", label: "NDX", sourceUrl: "https://www.nasdaq.com/market-activity/index/ndx", sensitivity: 55 }, cross: { name: "跨資產確認", label: "BTC", sourceUrl: "https://www.coingecko.com/en/coins/bitcoin", sensitivity: 12 } },
  hongKong: { weights: { equity: 0.32, volatility: 0.15, credit: 0.18, safeHaven: 0.2, crossAsset: 0.15 }, equity: { symbol: "ewh", name: "香港股票風險偏好", label: "EWH", sourceUrl: "https://www.ishares.com/us/products/239659/ishares-msci-hong-kong-etf", sensitivity: 75 }, cross: { symbol: "kweb", name: "中國科技確認", label: "KWEB", sourceUrl: "https://www.kraneshares.com/kweb", sensitivity: 45 } },
  china: { weights: { equity: 0.3, volatility: 0.15, credit: 0.15, safeHaven: 0.22, crossAsset: 0.18 }, equity: { symbol: "ashr", name: "A 股風險偏好", label: "ASHR", sourceUrl: "https://etf.dws.com/en-us/ASHR-xtrackers-harvest-csi-300-china-a-shares-etf/", sensitivity: 75 }, cross: { symbol: "kweb", name: "中國科技確認", label: "KWEB", sourceUrl: "https://www.kraneshares.com/kweb", sensitivity: 50 } },
};
const MARKET_THRESHOLDS: Record<MarketScope, { riskOn: number; riskOff: number; vixNeutral: number; creditNeutral: number }> = {
  global: { riskOn: 40, riskOff: -40, vixNeutral: 22, creditNeutral: 4.5 },
  hongKong: { riskOn: 35, riskOff: -35, vixNeutral: 21, creditNeutral: 4.3 },
  china: { riskOn: 32, riskOff: -32, vixNeutral: 21, creditNeutral: 4.2 },
};

const sourceCache = new Map<string, { value: unknown; storedAt: number }>();
const sourceInFlight = new Map<string, Promise<unknown>>();
const snapshotCache = new Map<MarketScope, { snapshot: MarketSnapshot; storedAt: number }>();
const refreshInFlight = new Map<MarketScope, Promise<MarketSnapshot>>();

function json(value: unknown, status = 200, extraHeaders: Record<string, string> = {}) {
  // 先用 Headers instance，它才能 normalize header name case (Cache-Control vs cache-control)
  const headers = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  for (const [k, v] of Object.entries(extraHeaders)) headers.set(k, v); // set() overwrites even with different casing
  return new Response(JSON.stringify(value), { status, headers });
}
function staticResponse(pathname: string) {
  const asset = STATIC_ASSETS[pathname] ?? STATIC_ASSETS["/index.html"];
  return new Response(asset.body, { headers: { "content-type": asset.contentType, "cache-control": pathname === "/index.html" || pathname === "/" ? "no-cache" : "public, max-age=31536000, immutable" } });
}
function clampScore(value: number) { return Math.max(-100, Math.min(100, Math.round(value))); }
function scorePercentChange(changePercent: number, sensitivity = 55) { return clampScore(changePercent * sensitivity); }
function scoreVix(scope: MarketScope, vix: number) { return clampScore((MARKET_THRESHOLDS[scope].vixNeutral - vix) * 5); }
function scoreCredit(scope: MarketScope, spread: number) { return clampScore((MARKET_THRESHOLDS[scope].creditNeutral - spread) * 35); }
function formatNumber(value: number) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value); }
function formatSigned(value: number, suffix = "") { return `${value > 0 ? "+" : ""}${value.toFixed(2)}${suffix}`; }
function parseNumeric(value: string | undefined) { return value ? Number(value.replace(/[^0-9+\-.]/g, "").replace("+", "")) : Number.NaN; }
function parseInterval(value: string | null): HistoryInterval { return value === "minute" || value === "1m" ? "minute" : value === "day" || value === "1d" ? "day" : "hour"; }
function determineMarketRegime(scope: MarketScope, score: number): MarketSnapshot["regime"] {
  if (scope === "global") return determineRegime(score);
  const { riskOn, riskOff } = MARKET_THRESHOLDS[scope];
  return score >= riskOn ? "Risk-on" : score <= riskOff ? "Risk-off" : "中性";
}
function scoreOfrConfidenceImpact(value: number) { return value <= 0 ? 0 : -Math.min(6, Math.max(2, Math.round(value * 3))); }
function dailyFreshness(date: string, now = new Date()): DataFreshness {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
  if (!match) return "unavailable";
  const sourceDay = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (!Number.isFinite(sourceDay) || sourceDay > currentDay) return "fresh";
  let businessDays = 0;
  for (let day = sourceDay + 86_400_000; day <= currentDay; day += 86_400_000) { const weekday = new Date(day).getUTCDay(); if (weekday !== 0 && weekday !== 6) businessDays += 1; }
  return businessDays <= 2 ? "fresh" : businessDays <= 5 ? "delayed" : "stale";
}

async function fetchWithTimeout(url: string, init: RequestInit = {}, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try { return await fetch(url, { ...init, signal: controller.signal }); }
  finally { clearTimeout(timeout); }
}
async function resilient<T>(key: string, maxAgeMs: number, loader: () => Promise<T>): Promise<T> {
  const cached = sourceCache.get(key) as { value: T; storedAt: number } | undefined;
  if (cached && Date.now() - cached.storedAt < maxAgeMs) return cached.value;
  const running = sourceInFlight.get(key) as Promise<T> | undefined;
  if (running) { try { return await running; } catch (error) { if (cached) return cached.value; throw error; } }
  const request = loader(); sourceInFlight.set(key, request);
  try { const value = await request; sourceCache.set(key, { value, storedAt: Date.now() }); return value; }
  catch (error) { if (cached) return cached.value; throw error; }
  finally { sourceInFlight.delete(key); }
}
async function settled<T>(task: Promise<T>) { try { return { data: await task, error: null } as const; } catch (error) { return { data: null, error: error instanceof Error ? error.message : "Unknown data error" } as const; } }

async function fetchFredSeries(seriesId: string): Promise<FredPoint> {
  const response = await fetchWithTimeout(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`, { headers: { Accept: "text/csv" } });
  if (!response.ok) throw new Error(`FRED ${seriesId} returned ${response.status}`);
  const rows = (await response.text()).trim().split(/\r?\n/).slice(1).map((row) => { const [date, rawValue] = row.split(","); return { date, value: Number(rawValue) }; }).filter((row) => row.date && Number.isFinite(row.value));
  const latest = rows.at(-1); if (!latest) throw new Error(`FRED ${seriesId} contains no numeric observations`);
  return { ...latest, previous: rows.at(-2)?.value ?? null };
}
async function fetchNasdaqQuote(symbol: string, assetclass: "index" | "etf"): Promise<NasdaqQuote> {
  const response = await fetchWithTimeout(`https://api.nasdaq.com/api/quote/${symbol}/info?assetclass=${assetclass}`, { headers: { Accept: "application/json", "Accept-Language": "en-US,en;q=0.9" } });
  if (!response.ok) throw new Error(`Nasdaq ${symbol.toUpperCase()} returned ${response.status}`);
  const payload = await response.json() as { data?: { primaryData?: { lastSalePrice?: string; percentageChange?: string; lastTradeTimestamp?: string } } };
  const primary = payload.data?.primaryData; const last = parseNumeric(primary?.lastSalePrice); const changePercent = parseNumeric(primary?.percentageChange);
  if (!Number.isFinite(last) || !Number.isFinite(changePercent)) throw new Error(`Nasdaq ${symbol.toUpperCase()} payload is incomplete`);
  return { last, changePercent, updatedAt: primary?.lastTradeTimestamp ?? new Date().toISOString() };
}
async function fetchBitcoin(): Promise<BitcoinQuote> {
  const response = await fetchWithTimeout("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true", { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`CoinGecko returned ${response.status}`);
  const payload = await response.json() as { bitcoin?: { usd?: number; usd_24h_change?: number; last_updated_at?: number } }; const quote = payload.bitcoin;
  if (!quote || !Number.isFinite(quote.usd) || !Number.isFinite(quote.usd_24h_change)) throw new Error("CoinGecko payload is incomplete");
  return { price: quote.usd ?? 0, changePercent: quote.usd_24h_change ?? 0, updatedAt: quote.last_updated_at ? new Date(quote.last_updated_at * 1000).toISOString() : new Date().toISOString() };
}
async function fetchOfrFsi(): Promise<OfrFsiPoint> {
  const response = await fetchWithTimeout("https://www.financialresearch.gov/financial-stress-index/data/fsi.json", { headers: { Accept: "application/json", Range: "bytes=-8192" } }, 20_000);
  if (!response.ok) throw new Error(`OFR FSI returned ${response.status}`);
  const observations = Array.from((await response.text()).matchAll(/\[\s*(\d{13})\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g)); const latest = observations.at(-1);
  if (!latest?.[1] || !latest[2]) throw new Error("OFR FSI response has no parseable latest observation");
  const value = Number(latest[2]); if (!Number.isFinite(value)) throw new Error("OFR FSI latest value is invalid");
  return { value, updatedAt: new Date(Number(latest[1])).toISOString() };
}
function parseHkexNumber(value: unknown) { return typeof value === "string" || typeof value === "number" ? Number(String(value).replace(/,/g, "")) : Number.NaN; }
function parseStockConnectDailyPayload(raw: string): StockConnectPoint | null {
  const records = JSON.parse(raw.trim().replace(/^tabData\s*=\s*/, "").replace(/;\s*$/, "")) as Array<{ date?: string; market?: string; tradingDay?: number; content?: Array<{ table?: { tr?: Array<{ td?: string[][] }> } }> }>;
  const getTurnover = (market: string) => parseHkexNumber(records.find((item) => item.market === market && item.tradingDay === 1)?.content?.[0]?.table?.tr?.[0]?.td?.[0]?.[0]);
  const sseNorth = getTurnover("SSE Northbound"), szseNorth = getTurnover("SZSE Northbound"), sseSouth = getTurnover("SSE Southbound"), szseSouth = getTurnover("SZSE Southbound");
  const date = records.find((item) => item.tradingDay === 1)?.date;
  return date && [sseNorth, szseNorth, sseSouth, szseSouth].every(Number.isFinite) ? { date, northboundTurnover: sseNorth + szseNorth, southboundTurnover: sseSouth + szseSouth } : null;
}
async function fetchHkexStockConnect(): Promise<StockConnectPoint> {
  const hongKongNow = new Date(Date.now() + 8 * 60 * 60_000);
  for (let offset = 0; offset < 8; offset += 1) {
    const date = new Date(hongKongNow.getTime() - offset * 86_400_000); const stamp = `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, "0")}${String(date.getUTCDate()).padStart(2, "0")}`;
    const response = await fetchWithTimeout(`https://www.hkex.com.hk/eng/csm/DailyStat/data_tab_daily_${stamp}e.js`, { headers: { Accept: "application/javascript" } });
    if (!response.ok) continue; const parsed = parseStockConnectDailyPayload(await response.text()); if (parsed) return parsed;
  }
  throw new Error("HKEX Stock Connect has no parsable recent trading-day file");
}

function unavailableFactor(key: MarketFactorKey, name: string, source: string, sourceUrl: string, frequency: LiveMarketFactor["frequency"], error: string, weights: Record<MarketFactorKey, number>): LiveMarketFactor {
  return { key, name, shortName: key, weight: weights[key], score: 0, signal: "資料暫不可用，該因子未納入方向判讀。", explanation: error, latestValue: "—", change: "—", source, sourceUrl, frequency, updatedAt: "未取得", freshness: "unavailable" };
}
function unavailableSupplemental(id: SupplementalSignal["id"], name: string, shortName: string, source: string, sourceUrl: string, frequency: SupplementalSignal["frequency"], error: string): SupplementalSignal {
  return { id, name, shortName, status: "unavailable", latestValue: "—", source, sourceUrl, frequency, updatedAt: "未取得", freshness: "unavailable", explanation: error, confidenceImpact: 0, compositeImpact: 0 };
}
function backupSnapshot(snapshot: MarketSnapshot, previous: MarketSnapshot | undefined): MarketSnapshot {
  if (!previous) return snapshot; const priorByKey = new Map(previous.factors.map((factor) => [factor.key, factor]));
  const factors = snapshot.factors.map((factor) => factor.freshness !== "unavailable" ? factor : priorByKey.get(factor.key) ? { ...priorByKey.get(factor.key)!, freshness: "stale" as const, signal: "來源暫時逾時，已保留最近成功值，未以空值覆蓋結論。", explanation: `上次成功資料已暫時作為備援。原始刷新失敗原因：${factor.explanation}` } : factor);
  const degraded = factors.some((factor) => factor.freshness === "unavailable" || factor.freshness === "stale");
  return { ...snapshot, factors, dataStatus: degraded ? "partial" : "fresh", confidence: factors.some((factor) => factor.freshness === "stale") ? Math.max(50, snapshot.confidence - 8) : snapshot.confidence };
}
function buildOfrSupplemental(result: { data: OfrFsiPoint | null; error: string | null }): SupplementalSignal {
  if (!result.data) return unavailableSupplemental("ofrFinancialStress", "全球金融壓力", "OFR FSI", "U.S. Office of Financial Research", "https://www.financialresearch.gov/financial-stress-index/", "日度（約 2 工作日延遲）", result.error ?? "OFR 資料來源沒有回應");
  const point = result.data, confidenceImpact = scoreOfrConfidenceImpact(point.value);
  return { id: "ofrFinancialStress", name: "全球金融壓力", shortName: "OFR FSI", status: confidenceImpact < 0 ? "caution" : "supportive", latestValue: `OFR FSI ${point.value.toFixed(3)}`, source: "U.S. Office of Financial Research", sourceUrl: "https://www.financialresearch.gov/financial-stress-index/", frequency: "日度（約 2 工作日延遲）", updatedAt: point.updatedAt, freshness: dailyFreshness(point.updatedAt.slice(0, 10)), explanation: confidenceImpact < 0 ? "OFR FSI 高於 0，代表日度系統性金融壓力高於歷史平均；本程式只下調置信度，不改變綜合分數。" : "OFR FSI 低於或等於 0，代表日度系統性金融壓力未高於歷史平均；本程式不因此上調綜合分數。", confidenceImpact, compositeImpact: 0 };
}
function buildStockConnectSupplemental(result: { data: StockConnectPoint | null; error: string | null }): SupplementalSignal {
  if (!result.data) return unavailableSupplemental("stockConnectActivity", "滬深港通活躍度", "Stock Connect", "HKEX Historical Daily", "https://www.hkex.com.hk/Mutual-Market/Stock-Connect/Statistics/Historical-Daily?sc_lang=en", "日終", result.error ?? "HKEX 資料來源沒有回應");
  const point = result.data;
  return { id: "stockConnectActivity", name: "滬深港通活躍度", shortName: "Stock Connect", status: "neutral", latestValue: `北向 ${formatNumber(point.northboundTurnover)} · 南向 ${formatNumber(point.southboundTurnover)}`, source: "HKEX Historical Daily", sourceUrl: "https://www.hkex.com.hk/Mutual-Market/Stock-Connect/Statistics/Historical-Daily?sc_lang=en", frequency: "日終", updatedAt: point.date, freshness: dailyFreshness(point.date), explanation: "此為 HKEX 公開的每日總成交活躍度，不是淨買入／賣出，因此只作中港跨境參與度背景，不改變綜合分數或置信度。", confidenceImpact: 0, compositeImpact: 0 };
}

async function fetchMarketSnapshot(scope: MarketScope): Promise<MarketSnapshot> {
  return fetchReliableWorkerSnapshot(scope);
  /* Legacy direct-source implementation retained below only as migration reference.
  const config = MARKET_CONFIG[scope], equityClass = scope === "global" ? "index" : "etf" as const, currencySeries = scope === "global" ? FRED_SERIES.dollarIndex : FRED_SERIES.yuanPerUsd;
  const [vixResult, creditResult, currencyResult, equityResult, crossResult, ofrResult, stockConnectResult] = await Promise.all([
    settled(resilient("fred:vix", 15 * 60_000, () => fetchFredSeries(FRED_SERIES.vix))), settled(resilient("fred:hy-oas", 15 * 60_000, () => fetchFredSeries(FRED_SERIES.highYieldSpread))), settled(resilient(`fred:${currencySeries}`, 15 * 60_000, () => fetchFredSeries(currencySeries))),
    settled(resilient(`nasdaq:${config.equity.symbol}`, 90_000, () => fetchNasdaqQuote(config.equity.symbol, equityClass))),
    scope === "global" ? settled(resilient("coingecko:bitcoin", 60_000, fetchBitcoin)) : settled(resilient(`nasdaq:${config.cross.symbol}`, 90_000, () => fetchNasdaqQuote(config.cross.symbol!, "etf"))),
    settled(resilient("ofr:fsi", 6 * 60 * 60_000, fetchOfrFsi)), scope === "global" ? Promise.resolve({ data: null, error: null } as const) : settled(resilient("hkex:stock-connect", 8 * 60 * 60_000, fetchHkexStockConnect)),
  ]);
  const factors: LiveMarketFactor[] = [];
  if (equityResult.data) { const quote = equityResult.data; factors.push({ key: "equity", name: config.equity.name, shortName: config.equity.label, weight: config.weights.equity, score: scorePercentChange(quote.changePercent, config.equity.sensitivity), signal: quote.changePercent >= 0 ? `${config.equity.label} 日內走強，支持市場風險偏好。` : `${config.equity.label} 日內走弱，拖累市場風險偏好。`, explanation: scope === "global" ? "以 Nasdaq-100 的日內變化作高 beta 股票代理。" : `以追蹤${scope === "hongKong" ? "香港" : "中國 A 股"}的美國上市 ETF 作可自動更新的市場代理，並非交易所原始指數。`, latestValue: `${config.equity.label} ${formatNumber(quote.last)}`, change: formatSigned(quote.changePercent, "%"), source: `Nasdaq Quote API · ${config.equity.label}`, sourceUrl: config.equity.sourceUrl, frequency: "15 分鐘延遲", updatedAt: quote.updatedAt, freshness: "delayed" }); }
  else factors.push(unavailableFactor("equity", config.equity.name, `Nasdaq Quote API · ${config.equity.label}`, config.equity.sourceUrl, "15 分鐘延遲", equityResult.error ?? "資料來源沒有回應", config.weights));
  if (vixResult.data) { const point = vixResult.data, neutral = MARKET_THRESHOLDS[scope].vixNeutral; factors.push({ key: "volatility", name: scope === "global" ? "波動率" : "全球波動壓力", shortName: "VIX", weight: config.weights.volatility, score: scoreVix(scope, point.value), signal: point.value < neutral ? "VIX 處於相對受控區間。" : "VIX 高於該市場壓力參考位，避險需求上升。", explanation: scope === "global" ? "VIX 越低，波動率因子越支持 Risk-on。" : `以 VIX 作跨市場風險壓力確認；${scope === "hongKong" ? "香港" : "中國"}頁採 ${neutral} 作獨立中性參考位。`, latestValue: `VIX ${point.value.toFixed(2)}`, change: formatSigned(point.previous ? point.value - point.previous : 0), source: "FRED · CBOE VIX", sourceUrl: "https://fred.stlouisfed.org/series/VIXCLS", frequency: "日終", updatedAt: point.date, freshness: dailyFreshness(point.date) }); }
  else factors.push(unavailableFactor("volatility", "全球波動壓力", "FRED · CBOE VIX", "https://fred.stlouisfed.org/series/VIXCLS", "日終", vixResult.error ?? "資料來源沒有回應", config.weights));
  if (creditResult.data) { const point = creditResult.data, neutral = MARKET_THRESHOLDS[scope].creditNeutral; factors.push({ key: "credit", name: scope === "global" ? "信貸壓力" : "全球信貸壓力", shortName: "HY OAS", weight: config.weights.credit, score: scoreCredit(scope, point.value), signal: point.value < neutral ? "高收益債利差仍低於壓力參考位。" : "高收益債利差偏闊，信用壓力正在抬升。", explanation: scope === "global" ? "HY OAS 越低，代表信用風險溢酬越受控。" : `以美國高收益債利差作全球壓力確認；${scope === "hongKong" ? "香港" : "中國"}頁採 ${neutral}% 作獨立中性參考位。`, latestValue: `HY OAS ${point.value.toFixed(2)}%`, change: formatSigned(point.previous ? point.value - point.previous : 0, " pts"), source: "FRED · ICE BofA HY OAS", sourceUrl: "https://fred.stlouisfed.org/series/BAMLH0A0HYM2", frequency: "日終", updatedAt: point.date, freshness: dailyFreshness(point.date) }); }
  else factors.push(unavailableFactor("credit", "全球信貸壓力", "FRED · ICE BofA HY OAS", "https://fred.stlouisfed.org/series/BAMLH0A0HYM2", "日終", creditResult.error ?? "資料來源沒有回應", config.weights));
  if (currencyResult.data) { const point = currencyResult.data, change = point.previous ? ((point.value / point.previous) - 1) * 100 : 0, cny = scope !== "global"; factors.push({ key: "safeHaven", name: cny ? "人民幣壓力" : "美元／避險資產", shortName: cny ? "USD/CNY" : "Dollar index", weight: config.weights.safeHaven, score: scorePercentChange(-change, cny ? 100 : 90), signal: change <= 0 ? (cny ? "人民幣沒有明顯轉弱，匯率壓力受控。" : "美元未有明顯走強，避險需求受控。") : (cny ? "人民幣走弱，為中港風險胃納帶來壓力。" : "美元上升，反映部分避險資金需求。"), explanation: cny ? "USD/CNY 上升代表人民幣相對美元走弱，因此採反向計分。" : "美元指數日變化採反向計分；美元走強會降低此因子的 Risk-on 分數。", latestValue: `${cny ? "USD/CNY" : "Dollar index"} ${point.value.toFixed(3)}`, change: formatSigned(change, "%"), source: cny ? "FRED · USD/CNY Spot" : "FRED · Trade Weighted Dollar", sourceUrl: cny ? "https://fred.stlouisfed.org/series/DEXCHUS" : "https://fred.stlouisfed.org/series/DTWEXBGS", frequency: "日終", updatedAt: point.date, freshness: dailyFreshness(point.date) }); }
  else factors.push(unavailableFactor("safeHaven", scope === "global" ? "美元／避險資產" : "人民幣壓力", scope === "global" ? "FRED · Trade Weighted Dollar" : "FRED · USD/CNY Spot", scope === "global" ? "https://fred.stlouisfed.org/series/DTWEXBGS" : "https://fred.stlouisfed.org/series/DEXCHUS", "日終", currencyResult.error ?? "資料來源沒有回應", config.weights));
  if (crossResult.data) { if (scope === "global") { const quote = crossResult.data as BitcoinQuote; factors.push({ key: "crossAsset", name: config.cross.name, shortName: "BTC", weight: config.weights.crossAsset, score: scorePercentChange(quote.changePercent, config.cross.sensitivity), signal: quote.changePercent >= 0 ? "比特幣 24 小時回報為正，提供高 beta 跨資產確認。" : "比特幣 24 小時回報為負，未能確認風險偏好。", explanation: "以比特幣 24 小時變化作高 beta 跨資產確認；此因子並非單獨投資訊號。", latestValue: `BTC $${formatNumber(quote.price)}`, change: formatSigned(quote.changePercent, "%"), source: "CoinGecko", sourceUrl: config.cross.sourceUrl, frequency: "分鐘級", updatedAt: quote.updatedAt, freshness: "fresh" }); } else { const quote = crossResult.data as NasdaqQuote; factors.push({ key: "crossAsset", name: config.cross.name, shortName: config.cross.label, weight: config.weights.crossAsset, score: scorePercentChange(quote.changePercent, config.cross.sensitivity), signal: quote.changePercent >= 0 ? "中國互聯網／高 beta 股票走強，提供區域風險確認。" : "中國互聯網／高 beta 股票走弱，未能確認區域風險偏好。", explanation: "以 KWEB 作中國科技及離岸高 beta 情緒代理，並非單一投資訊號。", latestValue: `KWEB ${formatNumber(quote.last)}`, change: formatSigned(quote.changePercent, "%"), source: "Nasdaq Quote API · KWEB", sourceUrl: config.cross.sourceUrl, frequency: "15 分鐘延遲", updatedAt: quote.updatedAt, freshness: "delayed" }); } }
  else factors.push(unavailableFactor("crossAsset", config.cross.name, scope === "global" ? "CoinGecko" : "Nasdaq Quote API · KWEB", config.cross.sourceUrl, scope === "global" ? "分鐘級" : "15 分鐘延遲", crossResult.error ?? "資料來源沒有回應", config.weights));
  const usable = factors.filter((factor) => factor.freshness !== "unavailable"), supplementary = [buildOfrSupplemental(ofrResult), ...(scope === "global" ? [] : [buildStockConnectSupplemental(stockConnectResult)])];
  const rawConfidence = calculateConfidence(usable), baseConfidence = Math.round(rawConfidence * (0.5 + (usable.length / factors.length) * 0.5)), confidenceImpact = supplementary.reduce((total, signal) => total + signal.confidenceImpact, 0), compositeScore = calculateCompositeScore(factors);
  return { market: scope, calculatedAt: new Date().toISOString(), compositeScore, regime: determineMarketRegime(scope, compositeScore), confidence: Math.max(40, baseConfidence + confidenceImpact), dataStatus: usable.length === factors.length ? "fresh" : "partial", updateIntervalSeconds: 60, factors, supplementary };
  */
}

const CLOUDFLARE_PROXY_SOURCES: Record<MarketScope, { equity: { symbol: string; name: string; label: string; sensitivity: number; url: string }; currency: { symbol: string; name: string; label: string; sensitivity: number; invert: boolean; url: string }; cross: { symbol: string; name: string; label: string; sensitivity: number; url: string } }> = {
  global: {
    equity: { symbol: "qqq", name: "Nasdaq-100 股票風險偏好", label: "QQQ", sensitivity: 55, url: "https://www.invesco.com/qqq-etf/en/home.html" },
    currency: { symbol: "uup", name: "美元／避險壓力", label: "UUP", sensitivity: 90, invert: true, url: "https://www.invesco.com/us/financial-products/etfs/holdings/main/holdings/0?audienceType=Investor&ticker=UUP" },
    cross: { symbol: "ibit", name: "比特幣跨資產確認", label: "IBIT", sensitivity: 18, url: "https://www.ishares.com/us/products/333011/ishares-bitcoin-trust-etf" },
  },
  hongKong: {
    equity: { symbol: "ewh", name: "香港股票風險偏好", label: "EWH", sensitivity: 75, url: "https://www.ishares.com/us/products/239659/ishares-msci-hong-kong-etf" },
    currency: { symbol: "uup", name: "美元／避險壓力", label: "UUP", sensitivity: 90, invert: true, url: "https://www.invesco.com/us/financial-products/etfs/holdings/main/holdings/0?audienceType=Investor&ticker=UUP" },
    cross: { symbol: "kweb", name: "中國科技確認", label: "KWEB", sensitivity: 45, url: "https://www.kraneshares.com/kweb" },
  },
  china: {
    equity: { symbol: "ashr", name: "A 股風險偏好", label: "ASHR", sensitivity: 75, url: "https://etf.dws.com/en-us/ASHR-xtrackers-harvest-csi-300-china-a-shares-etf/" },
    currency: { symbol: "uup", name: "美元／避險壓力", label: "UUP", sensitivity: 90, invert: true, url: "https://www.invesco.com/us/financial-products/etfs/holdings/main/holdings/0?audienceType=Investor&ticker=UUP" },
    cross: { symbol: "kweb", name: "中國科技確認", label: "KWEB", sensitivity: 50, url: "https://www.kraneshares.com/kweb" },
  },
};

function workerQuoteFactor(key: MarketFactorKey, name: string, label: string, quote: NasdaqQuote, weight: number, score: number, signal: string, explanation: string, url: string): LiveMarketFactor {
  return { key, name, shortName: label, weight, score, signal, explanation, latestValue: `${label} ${formatNumber(quote.last)}`, change: formatSigned(quote.changePercent, "%"), source: `Nasdaq Quote API · ${label}`, sourceUrl: url, frequency: "15 分鐘延遲", updatedAt: quote.updatedAt, freshness: "delayed" };
}

async function fetchReliableWorkerSnapshot(scope: MarketScope): Promise<MarketSnapshot> {
  const config = CLOUDFLARE_PROXY_SOURCES[scope];
  const weights = MARKET_CONFIG[scope].weights;
  const [equityResult, volatilityResult, creditResult, currencyResult, crossResult, ofrResult, stockConnectResult] = await Promise.all([
    settled(resilient(`nasdaq:${config.equity.symbol}`, 90_000, () => fetchNasdaqQuote(config.equity.symbol, "etf"))),
    settled(resilient("nasdaq:vxx", 90_000, () => fetchNasdaqQuote("vxx", "etf"))),
    settled(resilient("nasdaq:hyg", 90_000, () => fetchNasdaqQuote("hyg", "etf"))),
    settled(resilient(`nasdaq:${config.currency.symbol}`, 90_000, () => fetchNasdaqQuote(config.currency.symbol, "etf"))),
    settled(resilient(`nasdaq:${config.cross.symbol}`, 90_000, () => fetchNasdaqQuote(config.cross.symbol, "etf"))),
    settled(resilient("ofr:fsi", 6 * 60 * 60_000, fetchOfrFsi)),
    scope === "global" ? Promise.resolve({ data: null, error: null } as const) : settled(resilient("hkex:stock-connect", 8 * 60 * 60_000, fetchHkexStockConnect)),
  ]);
  const factors: LiveMarketFactor[] = [];

  if (equityResult.data) {
    const quote = equityResult.data;
    factors.push(workerQuoteFactor("equity", config.equity.name, config.equity.label, quote, weights.equity, scorePercentChange(quote.changePercent, config.equity.sensitivity), quote.changePercent >= 0 ? `${config.equity.label} 日內走強，支持市場風險偏好。` : `${config.equity.label} 日內走弱，拖累市場風險偏好。`, "以可自動更新的 Nasdaq 上市市場代理衡量股票風險偏好。", config.equity.url));
  } else factors.push(unavailableFactor("equity", config.equity.name, `Nasdaq Quote API · ${config.equity.label}`, config.equity.url, "15 分鐘延遲", equityResult.error ?? "資料來源沒有回應", weights));

  if (volatilityResult.data) {
    const quote = volatilityResult.data;
    factors.push(workerQuoteFactor("volatility", scope === "global" ? "波動率壓力" : "全球波動壓力", "VXX", quote, weights.volatility, scorePercentChange(-quote.changePercent, 55), quote.changePercent <= 0 ? "VXX 未有走強，波動壓力相對受控。" : "VXX 上升，代表波動率壓力增加。", "以 VXX 作可由 Cloudflare 直接驗證的 VIX 交易型代理；VXX 上升採反向計分。", "https://www.ipathetn.com/US/16/en/products/306772/"));
  } else factors.push(unavailableFactor("volatility", "波動率壓力", "Nasdaq Quote API · VXX", "https://www.ipathetn.com/US/16/en/products/306772/", "15 分鐘延遲", volatilityResult.error ?? "資料來源沒有回應", weights));

  if (creditResult.data) {
    const quote = creditResult.data;
    factors.push(workerQuoteFactor("credit", scope === "global" ? "信貸風險偏好" : "全球信貸風險偏好", "HYG", quote, weights.credit, scorePercentChange(quote.changePercent, 70), quote.changePercent >= 0 ? "高收益債 ETF 走強，支持信貸風險胃納。" : "高收益債 ETF 走弱，顯示信貸風險胃納轉弱。", "以 HYG 作可自動更新的高收益債市場代理，取代 Cloudflare 無法穩定讀取的 HY OAS 日終序列。", "https://www.ishares.com/us/products/239565/ishares-iboxx-high-yield-corporate-bond-etf"));
  } else factors.push(unavailableFactor("credit", "信貸風險偏好", "Nasdaq Quote API · HYG", "https://www.ishares.com/us/products/239565/ishares-iboxx-high-yield-corporate-bond-etf", "15 分鐘延遲", creditResult.error ?? "資料來源沒有回應", weights));

  if (currencyResult.data) {
    const quote = currencyResult.data;
    const score = scorePercentChange(config.currency.invert ? -quote.changePercent : quote.changePercent, config.currency.sensitivity);
    const signal = config.currency.invert ? (quote.changePercent <= 0 ? "美元 ETF 未有走強，避險壓力相對受控。" : "美元 ETF 走強，反映避險需求。") : (quote.changePercent >= 0 ? "人民幣代理走強，匯率壓力相對受控。" : "人民幣代理走弱，為區域風險胃納帶來壓力。");
    factors.push(workerQuoteFactor("safeHaven", config.currency.name, config.currency.label, quote, weights.safeHaven, score, signal, config.currency.invert ? "以 UUP 作美元強弱的可自動更新交易型代理；美元上升採反向計分。" : "以 CYB 作人民幣強弱的可自動更新交易型代理；代理上升代表人民幣相對支持風險胃納。", config.currency.url));
  } else factors.push(unavailableFactor("safeHaven", config.currency.name, `Nasdaq Quote API · ${config.currency.label}`, config.currency.url, "15 分鐘延遲", currencyResult.error ?? "資料來源沒有回應", weights));

  if (crossResult.data) {
    const quote = crossResult.data;
    factors.push(workerQuoteFactor("crossAsset", config.cross.name, config.cross.label, quote, weights.crossAsset, scorePercentChange(quote.changePercent, config.cross.sensitivity), quote.changePercent >= 0 ? `${config.cross.label} 走強，提供跨資產風險確認。` : `${config.cross.label} 走弱，未能確認風險偏好。`, scope === "global" ? "以 IBIT 作比特幣市場交易型代理，取代 Cloudflare 無法取得的 CoinGecko 即時端點。" : "以 KWEB 作中國科技及離岸高 beta 情緒代理，並非單一投資訊號。", config.cross.url));
  } else factors.push(unavailableFactor("crossAsset", config.cross.name, `Nasdaq Quote API · ${config.cross.label}`, config.cross.url, "15 分鐘延遲", crossResult.error ?? "資料來源沒有回應", weights));

  const usable = factors.filter((factor) => factor.freshness !== "unavailable");
  const supplementary = [buildOfrSupplemental(ofrResult), ...(scope === "global" ? [] : [buildStockConnectSupplemental(stockConnectResult)])];
  const rawConfidence = calculateConfidence(usable);
  const baseConfidence = Math.round(rawConfidence * (0.5 + (usable.length / factors.length) * 0.5));
  const confidenceImpact = supplementary.reduce((total, signal) => total + signal.confidenceImpact, 0);
  const compositeScore = calculateCompositeScore(factors);
  return { market: scope, calculatedAt: new Date().toISOString(), compositeScore, regime: determineMarketRegime(scope, compositeScore), confidence: Math.max(40, baseConfidence + confidenceImpact), dataStatus: usable.length === factors.length ? "fresh" : "partial", updateIntervalSeconds: 60, factors, supplementary };
}

// 輕量 row：chart + latest 都只用 5 個 lightweight 欄位。唔再儲 payload TEXT（100KB+）。
type LightSnapshotRow = { composite_score: number; regime: string; confidence: number; data_status: string; calculated_at: string };
async function latestSnapshot(env: Env, scope: MarketScope): Promise<MarketSnapshot | undefined> {
  const row = await env.DB.prepare(
    "SELECT composite_score, regime, confidence, data_status, calculated_at FROM market_snapshots WHERE market = ? ORDER BY calculated_at DESC LIMIT 1"
  ).bind(scope).first<LightSnapshotRow>();
  return row ? lightRowToSnapshot(scope, row) : undefined;
}
// 舊 schema 有 payload TEXT NOT NULL；為咗兼容未跑 migration 嘅環境，寫入時仍然填空字符串。
// 跑咗 migrations/0002_drop_payload.sql 之後個 column 就會消失，storeSnapshot 會自動 fallback 到新 schema。
async function storeSnapshot(env: Env, snapshot: MarketSnapshot) {
  try {
    await env.DB.prepare(
      "INSERT INTO market_snapshots (market, composite_score, regime, confidence, data_status, calculated_at) VALUES (?, ?, ?, ?, ?, ?)"
    ).bind(snapshot.market, snapshot.compositeScore, snapshot.regime, snapshot.confidence, snapshot.dataStatus, snapshot.calculatedAt).run();
  } catch {
    await env.DB.prepare(
      "INSERT INTO market_snapshots (market, composite_score, regime, confidence, data_status, payload, calculated_at) VALUES (?, ?, ?, ?, ?, '', ?)"
    ).bind(snapshot.market, snapshot.compositeScore, snapshot.regime, snapshot.confidence, snapshot.dataStatus, snapshot.calculatedAt).run();
  }
}

// 只保留最近 N 日資料，減低 D1 rows_read。回傳統計資訊（清理前後行數同刪咗幾多）。
const RETENTION_DAYS = 5;
async function cleanupOldSnapshots(env: Env, retentionDays = RETENTION_DAYS) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60_000).toISOString();
  const beforeRow = await env.DB.prepare("SELECT COUNT(*) AS total FROM market_snapshots").first<{ total: number }>();
  const toDeleteRow = await env.DB.prepare("SELECT COUNT(*) AS n FROM market_snapshots WHERE calculated_at < ?").bind(cutoff).first<{ n: number }>();
  await env.DB.prepare("DELETE FROM market_snapshots WHERE calculated_at < ?").bind(cutoff).run();
  const afterRow = await env.DB.prepare("SELECT COUNT(*) AS total FROM market_snapshots").first<{ total: number }>();
  return {
    retentionDays,
    cutoff,
    before: beforeRow?.total ?? 0,
    after: afterRow?.total ?? 0,
    deleted: toDeleteRow?.n ?? 0,
    ranAt: new Date().toISOString(),
  };
}
async function refreshMarket(env: Env, scope: MarketScope, force = false): Promise<MarketSnapshot> {
  const cached = snapshotCache.get(scope); if (!force && cached && Date.now() - cached.storedAt < 45_000) return cached.snapshot;
  const running = refreshInFlight.get(scope); if (running) return running;
  const task = (async () => { const snapshot = backupSnapshot(await fetchMarketSnapshot(scope), await latestSnapshot(env, scope)); await storeSnapshot(env, snapshot); snapshotCache.set(scope, { snapshot, storedAt: Date.now() }); return snapshot; })();
  refreshInFlight.set(scope, task); try { return await task; } finally { refreshInFlight.delete(scope); }
}
async function refreshAll(env: Env, force = false) { return Object.fromEntries(await Promise.all(MARKET_SCOPES.map(async (scope) => [scope, await refreshMarket(env, scope, force)] as const))) as Record<MarketScope, MarketSnapshot>; }
// 對應 chart bucket window 嘅小時計數：minute=6小時，hour=7日，day=90日。
// 隔住 query 花錯不拉到 payload 同時也拉少 row。
const HISTORY_WINDOW_HOURS: Record<HistoryInterval, number> = { minute: 6, hour: 24 * 7, day: 24 * 90 };
const HISTORY_MAX_ROWS: Record<HistoryInterval, number> = { minute: 500, hour: 2_000, day: 5_000 };

// 將輕量 row 重組成後端 API 仍然需要嘅 MarketSnapshot shape（factors/supplementary 留空 array）。
// 前端 aggregateHistoryForChart 只看 calculatedAt/compositeScore/confidence，其他欄位不影響畫 chart。
function lightRowToSnapshot(scope: MarketScope, row: LightSnapshotRow): MarketSnapshot {
  return {
    market: scope,
    calculatedAt: row.calculated_at,
    compositeScore: row.composite_score,
    regime: row.regime as MarketSnapshot["regime"],
    confidence: row.confidence,
    dataStatus: row.data_status as MarketSnapshot["dataStatus"],
    updateIntervalSeconds: 60,
    factors: [],
    supplementary: [],
  };
}

async function historyForInterval(env: Env, scope: MarketScope, interval: HistoryInterval) {
  const meta = INTERVAL_META[interval];
  const since = new Date(Date.now() - HISTORY_WINDOW_HOURS[interval] * 60 * 60_000).toISOString();
  const maxRows = HISTORY_MAX_ROWS[interval];
  // 只選 chart 需要嘅輕量欄位 + WHERE calculated_at >= ? 收窩範圍 + 較小 LIMIT。
  // 使用新索引 (market, calculated_at DESC)，D1 rows_read 大幅下降、CPU 並免要 parse 大 payload JSON。
  const result = await env.DB.prepare(
    "SELECT composite_score, regime, confidence, data_status, calculated_at FROM market_snapshots WHERE market = ? AND calculated_at >= ? ORDER BY calculated_at DESC LIMIT ?"
  ).bind(scope, since, maxRows).all<LightSnapshotRow>();
  const buckets = new Map<number, { snapshot: MarketSnapshot; samples: number }>();
  for (const row of result.results) {
    const timestamp = new Date(row.calculated_at).getTime();
    if (!Number.isFinite(timestamp)) continue;
    const key = Math.floor(timestamp / meta.bucketMs) * meta.bucketMs;
    const current = buckets.get(key);
    if (!current || new Date(current.snapshot.calculatedAt).getTime() <= timestamp) {
      buckets.set(key, { snapshot: lightRowToSnapshot(scope, row), samples: (current?.samples ?? 0) + 1 });
    } else {
      current.samples += 1;
    }
  }
  return Array.from(buckets.values())
    .sort((a, b) => new Date(a.snapshot.calculatedAt).getTime() - new Date(b.snapshot.calculatedAt).getTime())
    .map(({ snapshot }) => snapshot);
}
// SWR headers：browser 都能 cache、Cloudflare edge 都 cache。
// public,max-age=60 = client cache 60 秒；s-maxage=60 = edge cache 60 秒；stale-while-revalidate=300 = 5 分鐘內 stale hit 可即回舊鐐埋額重新 fetch。
const OVERVIEW_CACHE_HEADERS: Record<string, string> = {
  // 同 default no-store 相接，headers.set() 會 override
  "cache-control": "public, max-age=60, s-maxage=60, stale-while-revalidate=300",
};

async function api(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
  const url = new URL(request.url), interval = parseInterval(url.searchParams.get("interval") ?? url.searchParams.get("range"));
  if (url.pathname === "/api/health") return json({ ok: true, service: "market-regime-pulse", timestamp: new Date().toISOString() });
  // Cloudflare Workers 有 caches.default（DOM CacheStorage 冇），未裝 @cloudflare/workers-types，暫 cast。
  const workerCaches = caches as unknown as { default: Cache };
  if (url.pathname === "/api/overview" && request.method === "GET") {
    // Edge cache lookup：cache key = URL + interval。hit 就直接回，不碰 D1。
    const cache = workerCaches.default;
    const cacheKey = new Request(url.toString(), { method: "GET" });
    const cached = await cache.match(cacheKey);
    if (cached) return new Response(cached.body, cached);
    const snapshots = await refreshAll(env);
    const histories = Object.fromEntries(await Promise.all(MARKET_SCOPES.map(async (scope) => [scope, await historyForInterval(env, scope, interval)] as const))) as Record<MarketScope, MarketSnapshot[]>;
    const response = json({ snapshots, histories, interval }, 200, OVERVIEW_CACHE_HEADERS);
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  }
  if (url.pathname === "/api/refresh" && request.method === "POST") {
    const snapshots = await refreshAll(env, true);
    const histories = Object.fromEntries(await Promise.all(MARKET_SCOPES.map(async (scope) => [scope, await historyForInterval(env, scope, interval)] as const))) as Record<MarketScope, MarketSnapshot[]>;
    // 手動 refresh 同時 invalidate edge cache 以後下次 GET 都拉新
    const cache = workerCaches.default;
    ctx.waitUntil(Promise.all(["minute", "hour", "day"].map((i) => cache.delete(new Request(`${url.origin}/api/overview?interval=${i}`, { method: "GET" })))));
    return json({ snapshots, histories, interval });
  }
  if (url.pathname === "/api/cleanup" && request.method === "POST") {
    const daysParam = Number(url.searchParams.get("days"));
    const days = Number.isFinite(daysParam) && daysParam > 0 && daysParam <= 365 ? Math.round(daysParam) : RETENTION_DAYS;
    const result = await cleanupOldSnapshots(env, days);
    return json({ ok: true, ...result });
  }
  return json({ error: "Not found" }, 404);
}

function withAllowedCors(request: Request, response: Response): Response {
  const origin = request.headers.get("Origin");
  const allowedOrigins = new Set(["https://mriskdash-y5e2kzgw.manus.space", "https://market-regime-pulse.lumahub.workers.dev"]);
  if (!origin || !allowedOrigins.has(origin)) return response;
  const headers = new Headers(response.headers);
  headers.set("Access-Control-Allow-Origin", origin);
  headers.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type");
  headers.set("Vary", "Origin");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request: Request, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname.startsWith("/api/") && request.method === "OPTIONS") return withAllowedCors(request, new Response(null, { status: 204 }));
      if (url.pathname.startsWith("/api/")) return withAllowedCors(request, await api(request, env, ctx));
      return staticResponse(url.pathname);
    } catch (error) { return withAllowedCors(request, json({ error: error instanceof Error ? error.message : "Unexpected service error" }, 502)); }
  },
  async scheduled(controller: { cron?: string; scheduledTime?: number }, env: Env, ctx: { waitUntil(promise: Promise<unknown>): void }) {
    ctx.waitUntil(refreshAll(env, true));
    // 每小時 0 分嗰次順便清理舊資料；其他 cron tick 唔會做 DELETE，避免每 5 分鐘都 write。
    const scheduledTime = controller?.scheduledTime ?? Date.now();
    if (new Date(scheduledTime).getUTCMinutes() === 0) {
      ctx.waitUntil(cleanupOldSnapshots(env).then((r) => console.log("[cleanup]", r)).catch((e) => console.error("[cleanup] failed", e)));
    }
  },
};
