import { calculateCompositeScore, calculateConfidence, determineRegime } from "../shared/riskRegime";
import { MARKET_SCOPES, MARKET_SCOPE_META, type DataFreshness, type LiveMarketFactor, type MarketFactorKey, type MarketScope, type MarketSnapshot, type SupplementalSignal } from "../shared/marketTypes";
import * as db from "./db";

type FredPoint = { date: string; value: number; previous: number | null };
type NasdaqQuote = { last: number; changePercent: number; updatedAt: string };
type BitcoinQuote = { price: number; changePercent: number; updatedAt: string };
type OfrFsiPoint = { value: number; updatedAt: string };
type StockConnectPoint = { date: string; northboundTurnover: number; southboundTurnover: number };

const FRED_SERIES = { sp500: "SP500", vix: "VIXCLS", highYieldSpread: "BAMLH0A0HYM2", dollarIndex: "DTWEXBGS", yuanPerUsd: "DEXCHUS" } as const;

const MARKET_CONFIG: Record<MarketScope, { weights: Record<MarketFactorKey, number>; equity: { symbol: string; name: string; label: string; sourceUrl: string; sensitivity: number }; cross: { symbol?: string; name: string; label: string; sourceUrl: string; sensitivity: number } }> = {
  global: {
    weights: { equity: 0.25, volatility: 0.2, credit: 0.25, safeHaven: 0.15, crossAsset: 0.15 },
    equity: { symbol: "ndx", name: "股票風險偏好", label: "NDX", sourceUrl: "https://www.nasdaq.com/market-activity/index/ndx", sensitivity: 55 },
    cross: { name: "跨資產確認", label: "BTC", sourceUrl: "https://www.coingecko.com/en/coins/bitcoin", sensitivity: 12 },
  },
  hongKong: {
    weights: { equity: 0.32, volatility: 0.15, credit: 0.18, safeHaven: 0.2, crossAsset: 0.15 },
    equity: { symbol: "ewh", name: "香港股票風險偏好", label: "EWH", sourceUrl: "https://www.ishares.com/us/products/239659/ishares-msci-hong-kong-etf", sensitivity: 75 },
    cross: { symbol: "kweb", name: "中國科技確認", label: "KWEB", sourceUrl: "https://www.kraneshares.com/kweb", sensitivity: 45 },
  },
  china: {
    weights: { equity: 0.3, volatility: 0.15, credit: 0.15, safeHaven: 0.22, crossAsset: 0.18 },
    equity: { symbol: "ashr", name: "A 股風險偏好", label: "ASHR", sourceUrl: "https://etf.dws.com/en-us/ASHR-xtrackers-harvest-csi-300-china-a-shares-etf/", sensitivity: 75 },
    cross: { symbol: "kweb", name: "中國科技確認", label: "KWEB", sourceUrl: "https://www.kraneshares.com/kweb", sensitivity: 50 },
  },
};

const MARKET_THRESHOLDS: Record<MarketScope, { riskOn: number; riskOff: number; vixNeutral: number; creditNeutral: number }> = {
  global: { riskOn: 40, riskOff: -40, vixNeutral: 22, creditNeutral: 4.5 },
  hongKong: { riskOn: 35, riskOff: -35, vixNeutral: 21, creditNeutral: 4.3 },
  china: { riskOn: 32, riskOff: -32, vixNeutral: 21, creditNeutral: 4.2 },
};

const snapshotCache = new Map<MarketScope, { snapshot: MarketSnapshot; storedAt: number }>();
const refreshInFlight = new Map<MarketScope, Promise<MarketSnapshot>>();
const sourceCache = new Map<string, { value: unknown; storedAt: number }>();
const sourceInFlight = new Map<string, Promise<unknown>>();

export function clampScore(value: number) { return Math.max(-100, Math.min(100, Math.round(value))); }
export function scorePercentChange(changePercent: number, sensitivity = 55) { return clampScore(changePercent * sensitivity); }
export function scoreVix(vix: number) { return clampScore((22 - vix) * 5); }
export function scoreCreditSpread(spread: number) { return clampScore((4.5 - spread) * 35); }
export function getMarketScopeMeta(scope: MarketScope) { return MARKET_SCOPE_META[scope]; }
export function determineMarketRegime(scope: MarketScope, score: number): MarketSnapshot["regime"] {
  if (scope === "global") return determineRegime(score);
  const thresholds = MARKET_THRESHOLDS[scope];
  return score >= thresholds.riskOn ? "Risk-on" : score <= thresholds.riskOff ? "Risk-off" : "中性";
}
export function scoreMarketVix(scope: MarketScope, vix: number) { return clampScore((MARKET_THRESHOLDS[scope].vixNeutral - vix) * 5); }
export function scoreMarketCredit(scope: MarketScope, spread: number) { return clampScore((MARKET_THRESHOLDS[scope].creditNeutral - spread) * 35); }
export function scoreOfrConfidenceImpact(value: number) {
  if (value <= 0) return 0;
  return -Math.min(6, Math.max(2, Math.round(value * 3)));
}

function parseNumeric(value: string | undefined) {
  if (!value) return Number.NaN;
  return Number(value.replace(/[^0-9+\-.]/g, "").replace("+", ""));
}
function formatNumber(value: number) { return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value); }
function formatSigned(value: number, suffix = "") { return `${value > 0 ? "+" : ""}${value.toFixed(2)}${suffix}`; }
export function dailyFreshness(date: string, now = new Date()): DataFreshness {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return "unavailable";

  const sourceDay = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  const currentDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  if (!Number.isFinite(sourceDay) || sourceDay > currentDay) return "fresh";

  let businessDays = 0;
  for (let day = sourceDay + 86_400_000; day <= currentDay; day += 86_400_000) {
    const weekday = new Date(day).getUTCDay();
    if (weekday !== 0 && weekday !== 6) businessDays += 1;
  }

  // Official daily series often publish after the U.S. close and pause on weekends.
  // Two business days is normal, three to five is disclosed as delayed, and only older data is stale.
  return businessDays <= 2 ? "fresh" : businessDays <= 5 ? "delayed" : "stale";
}

async function fetchFredSeries(seriesId: string): Promise<FredPoint> {
  const response = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`, { headers: { Accept: "text/csv" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`FRED ${seriesId} returned ${response.status}`);
  const rows = (await response.text()).trim().split(/\r?\n/).slice(1).map((row) => {
    const [date, rawValue] = row.split(",");
    return { date, value: Number(rawValue) };
  }).filter((row) => row.date && Number.isFinite(row.value));
  const latest = rows.at(-1);
  if (!latest) throw new Error(`FRED ${seriesId} contains no numeric observations`);
  return { ...latest, previous: rows.at(-2)?.value ?? null };
}

async function fetchNasdaqQuote(symbol: string, assetclass: "index" | "etf"): Promise<NasdaqQuote> {
  const response = await fetch(`https://api.nasdaq.com/api/quote/${symbol}/info?assetclass=${assetclass}`, {
    headers: { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; MarketRegimePulse/1.0)", "Accept-Language": "en-US,en;q=0.9" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Nasdaq ${symbol.toUpperCase()} returned ${response.status}`);
  const payload = await response.json() as { data?: { primaryData?: { lastSalePrice?: string; percentageChange?: string; lastTradeTimestamp?: string } } };
  const primary = payload.data?.primaryData;
  const last = parseNumeric(primary?.lastSalePrice);
  const changePercent = parseNumeric(primary?.percentageChange);
  if (!Number.isFinite(last) || !Number.isFinite(changePercent)) throw new Error(`Nasdaq ${symbol.toUpperCase()} payload is incomplete`);
  return { last, changePercent, updatedAt: primary?.lastTradeTimestamp ?? new Date().toISOString() };
}

async function fetchBitcoin(): Promise<BitcoinQuote> {
  const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true", { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`CoinGecko returned ${response.status}`);
  const payload = await response.json() as { bitcoin?: { usd?: number; usd_24h_change?: number; last_updated_at?: number } };
  const quote = payload.bitcoin;
  if (!quote || !Number.isFinite(quote.usd) || !Number.isFinite(quote.usd_24h_change)) throw new Error("CoinGecko payload is incomplete");
  return { price: quote.usd ?? 0, changePercent: quote.usd_24h_change ?? 0, updatedAt: quote.last_updated_at ? new Date(quote.last_updated_at * 1000).toISOString() : new Date().toISOString() };
}

async function fetchOfrFsi(): Promise<OfrFsiPoint> {
  const response = await fetch("https://www.financialresearch.gov/financial-stress-index/data/fsi.json", {
    headers: { Accept: "application/json", Range: "bytes=-8192", "User-Agent": "Mozilla/5.0 (compatible; MarketRegimePulse/1.0)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`OFR FSI returned ${response.status}`);
  const tail = await response.text();
  const observations = Array.from(tail.matchAll(/\[\s*(\d{13})\s*,\s*(-?\d+(?:\.\d+)?)\s*\]/g));
  const latest = observations.at(-1);
  if (!latest?.[1] || !latest[2]) throw new Error("OFR FSI range response has no parseable latest observation");
  const value = Number(latest[2]);
  if (!Number.isFinite(value)) throw new Error("OFR FSI latest value is invalid");
  return { value, updatedAt: new Date(Number(latest[1])).toISOString() };
}

function parseHkexNumber(value: unknown) {
  if (typeof value !== "string" && typeof value !== "number") return Number.NaN;
  return Number(String(value).replace(/,/g, ""));
}

export function parseStockConnectDailyPayload(raw: string): StockConnectPoint | null {
  const payload = raw.trim().replace(/^tabData\s*=\s*/, "").replace(/;\s*$/, "");
  const records = JSON.parse(payload) as Array<{ date?: string; market?: string; tradingDay?: number; content?: Array<{ table?: { tr?: Array<{ td?: string[][] }> } }> }>;
  const getTurnover = (market: string) => {
    const record = records.find((item) => item.market === market && item.tradingDay === 1);
    return parseHkexNumber(record?.content?.[0]?.table?.tr?.[0]?.td?.[0]?.[0]);
  };
  const sseNorth = getTurnover("SSE Northbound");
  const szseNorth = getTurnover("SZSE Northbound");
  const sseSouth = getTurnover("SSE Southbound");
  const szseSouth = getTurnover("SZSE Southbound");
  const date = records.find((item) => item.tradingDay === 1)?.date;
  if (!date || ![sseNorth, szseNorth, sseSouth, szseSouth].every(Number.isFinite)) return null;
  return { date, northboundTurnover: sseNorth + szseNorth, southboundTurnover: sseSouth + szseSouth };
}

async function fetchHkexStockConnect(): Promise<StockConnectPoint> {
  const hongKongNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Hong_Kong" }));
  for (let offset = 0; offset < 8; offset += 1) {
    const date = new Date(hongKongNow);
    date.setDate(date.getDate() - offset);
    const stamp = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
    const response = await fetch(`https://www.hkex.com.hk/eng/csm/DailyStat/data_tab_daily_${stamp}e.js`, { headers: { Accept: "application/javascript", "User-Agent": "Mozilla/5.0 (compatible; MarketRegimePulse/1.0)" }, signal: AbortSignal.timeout(15_000) });
    if (!response.ok) continue;
    const parsed = parseStockConnectDailyPayload(await response.text());
    if (parsed) return parsed;
  }
  throw new Error("HKEX Stock Connect has no parsable recent trading-day file");
}

async function resilient<T>(key: string, maxAgeMs: number, loader: () => Promise<T>): Promise<T> {
  const cached = sourceCache.get(key) as { value: T; storedAt: number } | undefined;
  if (cached && Date.now() - cached.storedAt < maxAgeMs) return cached.value;
  const running = sourceInFlight.get(key) as Promise<T> | undefined;
  if (running) {
    try { return await running; } catch (error) { if (cached) return cached.value; throw error; }
  }
  const request = loader();
  sourceInFlight.set(key, request);
  try {
    const value = await request;
    sourceCache.set(key, { value, storedAt: Date.now() });
    return value;
  } catch (error) {
    if (cached) return cached.value;
    throw error;
  } finally { sourceInFlight.delete(key); }
}

async function settled<T>(task: Promise<T>) {
  try { return { data: await task, error: null } as const; }
  catch (error) { return { data: null, error: error instanceof Error ? error.message : "Unknown data error" } as const; }
}

function unavailableFactor(key: MarketFactorKey, name: string, source: string, sourceUrl: string, frequency: LiveMarketFactor["frequency"], error: string, weights: Record<MarketFactorKey, number>): LiveMarketFactor {
  return { key, name, shortName: key, weight: weights[key], score: 0, signal: "資料暫不可用，該因子未納入方向判讀。", explanation: error, latestValue: "—", change: "—", source, sourceUrl, frequency, updatedAt: "未取得", freshness: "unavailable" };
}

function backupSnapshot(snapshot: MarketSnapshot, previous: MarketSnapshot | undefined): MarketSnapshot {
  if (!previous) return snapshot;
  const priorByKey = new Map(previous.factors.map((factor) => [factor.key, factor]));
  const factors = snapshot.factors.map((factor) => {
    if (factor.freshness !== "unavailable") return factor;
    const prior = priorByKey.get(factor.key);
    return prior ? { ...prior, freshness: "stale" as const, signal: "來源暫時逾時，已保留最近成功值，未以空值覆蓋結論。", explanation: `上次成功資料已暫時作為備援。原始刷新失敗原因：${factor.explanation}` } : factor;
  });
  const degraded = factors.some((factor) => factor.freshness === "unavailable" || factor.freshness === "stale");
  return { ...snapshot, factors, dataStatus: degraded ? "partial" : "fresh", confidence: factors.some((factor) => factor.freshness === "stale") ? Math.max(50, snapshot.confidence - 8) : snapshot.confidence };
}

export function stabilizeSnapshotWithPrevious(snapshot: MarketSnapshot, previous: MarketSnapshot | undefined) { return backupSnapshot(snapshot, previous); }

function unavailableSupplemental(id: SupplementalSignal["id"], name: string, shortName: string, source: string, sourceUrl: string, frequency: SupplementalSignal["frequency"], error: string): SupplementalSignal {
  return { id, name, shortName, status: "unavailable", latestValue: "—", source, sourceUrl, frequency, updatedAt: "未取得", freshness: "unavailable", explanation: error, confidenceImpact: 0, compositeImpact: 0 };
}

export function applySupplementaryConfidence(baseConfidence: number, signals: SupplementalSignal[]) {
  const confidenceImpact = signals.reduce((total, signal) => total + signal.confidenceImpact, 0);
  return Math.max(40, baseConfidence + confidenceImpact);
}

function buildOfrSupplemental(result: { data: OfrFsiPoint | null; error: string | null }): SupplementalSignal {
  if (!result.data) return unavailableSupplemental("ofrFinancialStress", "全球金融壓力", "OFR FSI", "U.S. Office of Financial Research", "https://www.financialresearch.gov/financial-stress-index/", "日度（約 2 工作日延遲）", result.error ?? "OFR 資料來源沒有回應");
  const point = result.data;
  const confidenceImpact = scoreOfrConfidenceImpact(point.value);
  return { id: "ofrFinancialStress", name: "全球金融壓力", shortName: "OFR FSI", status: confidenceImpact < 0 ? "caution" : "supportive", latestValue: `OFR FSI ${point.value.toFixed(3)}`, source: "U.S. Office of Financial Research", sourceUrl: "https://www.financialresearch.gov/financial-stress-index/", frequency: "日度（約 2 工作日延遲）", updatedAt: point.updatedAt, freshness: dailyFreshness(point.updatedAt.slice(0, 10)), explanation: confidenceImpact < 0 ? "OFR FSI 高於 0，代表日度系統性金融壓力高於歷史平均；本程式只下調置信度，不改變綜合分數。" : "OFR FSI 低於或等於 0，代表日度系統性金融壓力未高於歷史平均；本程式不因此上調綜合分數。", confidenceImpact, compositeImpact: 0 };
}

function buildStockConnectSupplemental(result: { data: StockConnectPoint | null; error: string | null }): SupplementalSignal {
  if (!result.data) return unavailableSupplemental("stockConnectActivity", "滬深港通活躍度", "Stock Connect", "HKEX Historical Daily", "https://www.hkex.com.hk/Mutual-Market/Stock-Connect/Statistics/Historical-Daily?sc_lang=en", "日終", result.error ?? "HKEX Stock Connect 資料來源沒有回應");
  const point = result.data;
  return { id: "stockConnectActivity", name: "滬深港通活躍度", shortName: "Stock Connect", status: "neutral", latestValue: `北向 ${formatNumber(point.northboundTurnover)} · 南向 ${formatNumber(point.southboundTurnover)}`, source: "HKEX Historical Daily", sourceUrl: "https://www.hkex.com.hk/Mutual-Market/Stock-Connect/Statistics/Historical-Daily?sc_lang=en", frequency: "日終", updatedAt: point.date, freshness: dailyFreshness(point.date), explanation: "此為 HKEX 公開的每日總成交活躍度，不是淨買入／賣出，因此只作中港跨境參與度背景，不改變綜合分數或置信度。", confidenceImpact: 0, compositeImpact: 0 };
}

export async function fetchMarketSnapshot(scope: MarketScope): Promise<MarketSnapshot> {
  const config = MARKET_CONFIG[scope];
  const equityClass = scope === "global" ? "index" : "etf" as const;
  const equityPromise = settled(resilient(`nasdaq:${config.equity.symbol}`, 90_000, () => fetchNasdaqQuote(config.equity.symbol, equityClass)));
  const crossPromise = scope === "global"
    ? settled(resilient("coingecko:bitcoin", 60_000, fetchBitcoin))
    : settled(resilient(`nasdaq:${config.cross.symbol}`, 90_000, () => fetchNasdaqQuote(config.cross.symbol!, "etf")));
  const currencySeries = scope === "global" ? FRED_SERIES.dollarIndex : FRED_SERIES.yuanPerUsd;
  const [vixResult, creditResult, currencyResult, equityResult, crossResult, ofrResult, stockConnectResult] = await Promise.all([
    settled(resilient("fred:vix", 15 * 60_000, () => fetchFredSeries(FRED_SERIES.vix))),
    settled(resilient("fred:hy-oas", 15 * 60_000, () => fetchFredSeries(FRED_SERIES.highYieldSpread))),
    settled(resilient(`fred:${currencySeries}`, 15 * 60_000, () => fetchFredSeries(currencySeries))),
    equityPromise,
    crossPromise,
    settled(resilient("ofr:fsi", 6 * 60 * 60_000, fetchOfrFsi)),
    scope === "global" ? Promise.resolve({ data: null, error: null } as const) : settled(resilient("hkex:stock-connect", 8 * 60 * 60_000, fetchHkexStockConnect)),
  ]);
  const factors: LiveMarketFactor[] = [];

  if (equityResult.data) {
    const quote = equityResult.data;
    factors.push({ key: "equity", name: config.equity.name, shortName: config.equity.label, weight: config.weights.equity, score: scorePercentChange(quote.changePercent, config.equity.sensitivity), signal: quote.changePercent >= 0 ? `${config.equity.label} 日內走強，支持市場風險偏好。` : `${config.equity.label} 日內走弱，拖累市場風險偏好。`, explanation: scope === "global" ? "以 Nasdaq-100 的日內變化作高 beta 股票代理。" : `以追蹤${scope === "hongKong" ? "香港" : "中國 A 股"}的美國上市 ETF 作可自動更新的市場代理，並非交易所原始指數。`, latestValue: `${config.equity.label} ${formatNumber(quote.last)}`, change: formatSigned(quote.changePercent, "%"), source: `Nasdaq Quote API · ${config.equity.label}`, sourceUrl: config.equity.sourceUrl, frequency: "15 分鐘延遲", updatedAt: quote.updatedAt, freshness: "delayed" });
  } else {
    factors.push(unavailableFactor("equity", config.equity.name, `Nasdaq Quote API · ${config.equity.label}`, config.equity.sourceUrl, "15 分鐘延遲", equityResult.error ?? "資料來源沒有回應", config.weights));
  }

  if (vixResult.data) {
    const point = vixResult.data;
    const neutral = MARKET_THRESHOLDS[scope].vixNeutral;
    factors.push({ key: "volatility", name: scope === "global" ? "波動率" : "全球波動壓力", shortName: "VIX", weight: config.weights.volatility, score: scoreMarketVix(scope, point.value), signal: point.value < neutral ? "VIX 處於相對受控區間。" : "VIX 高於該市場壓力參考位，避險需求上升。", explanation: scope === "global" ? "VIX 越低，波動率因子越支持 Risk-on。" : `以 VIX 作跨市場風險壓力確認；${scope === "hongKong" ? "香港" : "中國"}頁採 ${neutral} 作獨立中性參考位。`, latestValue: `VIX ${point.value.toFixed(2)}`, change: formatSigned(point.previous ? point.value - point.previous : 0), source: "FRED · CBOE VIX", sourceUrl: "https://fred.stlouisfed.org/series/VIXCLS", frequency: "日終", updatedAt: point.date, freshness: dailyFreshness(point.date) });
  } else factors.push(unavailableFactor("volatility", "全球波動壓力", "FRED · CBOE VIX", "https://fred.stlouisfed.org/series/VIXCLS", "日終", vixResult.error ?? "資料來源沒有回應", config.weights));

  if (creditResult.data) {
    const point = creditResult.data;
    const neutral = MARKET_THRESHOLDS[scope].creditNeutral;
    factors.push({ key: "credit", name: scope === "global" ? "信貸壓力" : "全球信貸壓力", shortName: "HY OAS", weight: config.weights.credit, score: scoreMarketCredit(scope, point.value), signal: point.value < neutral ? "高收益債利差仍低於壓力參考位。" : "高收益債利差偏闊，信用壓力正在抬升。", explanation: scope === "global" ? "HY OAS 越低，代表信用風險溢酬越受控。" : `以美國高收益債利差作全球壓力確認；${scope === "hongKong" ? "香港" : "中國"}頁採 ${neutral}% 作獨立中性參考位。`, latestValue: `HY OAS ${point.value.toFixed(2)}%`, change: formatSigned(point.previous ? point.value - point.previous : 0, " pts"), source: "FRED · ICE BofA HY OAS", sourceUrl: "https://fred.stlouisfed.org/series/BAMLH0A0HYM2", frequency: "日終", updatedAt: point.date, freshness: dailyFreshness(point.date) });
  } else factors.push(unavailableFactor("credit", "全球信貸壓力", "FRED · ICE BofA HY OAS", "https://fred.stlouisfed.org/series/BAMLH0A0HYM2", "日終", creditResult.error ?? "資料來源沒有回應", config.weights));

  if (currencyResult.data) {
    const point = currencyResult.data;
    const change = point.previous ? ((point.value / point.previous) - 1) * 100 : 0;
    const cny = scope !== "global";
    factors.push({ key: "safeHaven", name: cny ? "人民幣壓力" : "美元／避險資產", shortName: cny ? "USD/CNY" : "Dollar index", weight: config.weights.safeHaven, score: scorePercentChange(-change, cny ? 100 : 90), signal: change <= 0 ? (cny ? "人民幣沒有明顯轉弱，匯率壓力受控。" : "美元未有明顯走強，避險需求受控。") : (cny ? "人民幣走弱，為中港風險胃納帶來壓力。" : "美元上升，反映部分避險資金需求。"), explanation: cny ? "USD/CNY 上升代表人民幣相對美元走弱，因此採反向計分。" : "美元指數日變化採反向計分；美元走強會降低此因子的 Risk-on 分數。", latestValue: `${cny ? "USD/CNY" : "Dollar index"} ${point.value.toFixed(3)}`, change: formatSigned(change, "%"), source: cny ? "FRED · USD/CNY Spot" : "FRED · Trade Weighted Dollar", sourceUrl: cny ? "https://fred.stlouisfed.org/series/DEXCHUS" : "https://fred.stlouisfed.org/series/DTWEXBGS", frequency: "日終", updatedAt: point.date, freshness: dailyFreshness(point.date) });
  } else factors.push(unavailableFactor("safeHaven", scope === "global" ? "美元／避險資產" : "人民幣壓力", scope === "global" ? "FRED · Trade Weighted Dollar" : "FRED · USD/CNY Spot", scope === "global" ? "https://fred.stlouisfed.org/series/DTWEXBGS" : "https://fred.stlouisfed.org/series/DEXCHUS", "日終", currencyResult.error ?? "資料來源沒有回應", config.weights));

  if (crossResult.data) {
    if (scope === "global") {
      const quote = crossResult.data as BitcoinQuote;
      factors.push({ key: "crossAsset", name: config.cross.name, shortName: "BTC", weight: config.weights.crossAsset, score: scorePercentChange(quote.changePercent, config.cross.sensitivity), signal: quote.changePercent >= 0 ? "比特幣 24 小時回報為正，提供高 beta 跨資產確認。" : "比特幣 24 小時回報為負，未能確認風險偏好。", explanation: "以比特幣 24 小時變化作高 beta 跨資產確認；此因子並非單獨投資訊號。", latestValue: `BTC $${formatNumber(quote.price)}`, change: formatSigned(quote.changePercent, "%"), source: "CoinGecko", sourceUrl: config.cross.sourceUrl, frequency: "分鐘級", updatedAt: quote.updatedAt, freshness: "fresh" });
    } else {
      const quote = crossResult.data as NasdaqQuote;
      factors.push({ key: "crossAsset", name: config.cross.name, shortName: config.cross.label, weight: config.weights.crossAsset, score: scorePercentChange(quote.changePercent, config.cross.sensitivity), signal: quote.changePercent >= 0 ? "中國互聯網／高 beta 股票走強，提供區域風險確認。" : "中國互聯網／高 beta 股票走弱，未能確認區域風險偏好。", explanation: "以 KWEB 作中國科技及離岸高 beta 情緒代理，並非單一投資訊號。", latestValue: `KWEB ${formatNumber(quote.last)}`, change: formatSigned(quote.changePercent, "%"), source: "Nasdaq Quote API · KWEB", sourceUrl: config.cross.sourceUrl, frequency: "15 分鐘延遲", updatedAt: quote.updatedAt, freshness: "delayed" });
    }
  } else factors.push(unavailableFactor("crossAsset", config.cross.name, scope === "global" ? "CoinGecko" : "Nasdaq Quote API · KWEB", config.cross.sourceUrl, scope === "global" ? "分鐘級" : "15 分鐘延遲", crossResult.error ?? "資料來源沒有回應", config.weights));

  const usable = factors.filter((factor) => factor.freshness !== "unavailable");
  const compositeScore = calculateCompositeScore(factors);
  const rawConfidence = calculateConfidence(usable);
  const supplementary = [buildOfrSupplemental(ofrResult), ...(scope === "global" ? [] : [buildStockConnectSupplemental(stockConnectResult)])];
  const baseConfidence = Math.round(rawConfidence * (0.5 + (usable.length / factors.length) * 0.5));
  return { market: scope, calculatedAt: new Date().toISOString(), compositeScore, regime: determineMarketRegime(scope, compositeScore), confidence: applySupplementaryConfidence(baseConfidence, supplementary), dataStatus: usable.length === factors.length ? "fresh" : "partial", updateIntervalSeconds: 60, factors, supplementary };
}

export async function refreshAndStoreMarketSnapshot(scope: MarketScope, force = false): Promise<MarketSnapshot> {
  const cached = snapshotCache.get(scope);
  if (!force && cached && Date.now() - cached.storedAt < 45_000) return cached.snapshot;
  const inFlight = refreshInFlight.get(scope);
  if (inFlight) return inFlight;
  const refresh = (async () => {
    const previous = (await db.getRecentMarketSnapshots(scope, 1)).at(-1);
    const snapshot = backupSnapshot(await fetchMarketSnapshot(scope), previous);
    snapshotCache.set(scope, { snapshot, storedAt: Date.now() });
    await db.insertMarketSnapshot(snapshot);
    return snapshot;
  })();
  refreshInFlight.set(scope, refresh);
  try { return await refresh; } finally { refreshInFlight.delete(scope); }
}

export async function refreshAllMarketSnapshots(force = false): Promise<Record<MarketScope, MarketSnapshot>> {
  const entries = await Promise.all(MARKET_SCOPES.map(async (scope) => [scope, await refreshAndStoreMarketSnapshot(scope, force)] as const));
  return Object.fromEntries(entries) as Record<MarketScope, MarketSnapshot>;
}
