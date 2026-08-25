import { calculateCompositeScore, calculateConfidence, determineRegime } from "../shared/riskRegime";
import type { DataFreshness, LiveMarketFactor, MarketFactorKey, MarketSnapshot } from "../shared/marketTypes";
import * as db from "./db";

type FredPoint = { date: string; value: number; previous: number | null };
type NasdaqQuote = { last: number; changePercent: number; updatedAt: string };
type BitcoinQuote = { price: number; changePercent: number; updatedAt: string };

const FRED_SERIES = {
  sp500: "SP500",
  vix: "VIXCLS",
  highYieldSpread: "BAMLH0A0HYM2",
  dollarIndex: "DTWEXBGS",
} as const;

const FACTOR_WEIGHTS: Record<MarketFactorKey, number> = {
  equity: 0.25,
  volatility: 0.2,
  credit: 0.25,
  safeHaven: 0.15,
  crossAsset: 0.15,
};

let cachedSnapshot: { snapshot: MarketSnapshot; storedAt: number } | null = null;

export function clampScore(value: number) {
  return Math.max(-100, Math.min(100, Math.round(value)));
}

export function scorePercentChange(changePercent: number, sensitivity = 55) {
  return clampScore(changePercent * sensitivity);
}

export function scoreVix(vix: number) {
  return clampScore((22 - vix) * 5);
}

export function scoreCreditSpread(spread: number) {
  return clampScore((4.5 - spread) * 35);
}

function parseNumeric(value: string | undefined) {
  if (!value) return Number.NaN;
  return Number(value.replace(/[^0-9+\-.]/g, "").replace("+", ""));
}

function formatNumber(value: number, options: Intl.NumberFormatOptions = {}) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, ...options }).format(value);
}

function formatSigned(value: number, suffix = "") {
  const prefix = value > 0 ? "+" : "";
  return `${prefix}${value.toFixed(2)}${suffix}`;
}

function dailyFreshness(date: string): DataFreshness {
  const parsed = new Date(`${date}T00:00:00Z`).getTime();
  if (Number.isNaN(parsed)) return "unavailable";
  const ageInDays = (Date.now() - parsed) / 86_400_000;
  if (ageInDays <= 1.75) return "fresh";
  if (ageInDays <= 4.75) return "delayed";
  return "stale";
}

async function fetchFredSeries(seriesId: string): Promise<FredPoint> {
  const response = await fetch(`https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(seriesId)}`, {
    headers: { Accept: "text/csv" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`FRED ${seriesId} returned ${response.status}`);

  const rows = (await response.text())
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .map((row) => {
      const [date, rawValue] = row.split(",");
      return { date, value: Number(rawValue) };
    })
    .filter((row) => row.date && Number.isFinite(row.value));
  const latest = rows.at(-1);
  if (!latest) throw new Error(`FRED ${seriesId} contains no numeric observations`);
  const previous = rows.at(-2)?.value ?? null;
  return { ...latest, previous };
}

async function fetchNasdaqNdx(): Promise<NasdaqQuote> {
  const response = await fetch("https://api.nasdaq.com/api/quote/ndx/info?assetclass=index", {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (compatible; MarketRegimePulse/1.0)",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Nasdaq NDX returned ${response.status}`);
  const payload = await response.json() as { data?: { primaryData?: { lastSalePrice?: string; percentageChange?: string; lastTradeTimestamp?: string } } };
  const primary = payload.data?.primaryData;
  const last = parseNumeric(primary?.lastSalePrice);
  const changePercent = parseNumeric(primary?.percentageChange);
  if (!Number.isFinite(last) || !Number.isFinite(changePercent)) throw new Error("Nasdaq NDX payload is incomplete");
  return { last, changePercent, updatedAt: primary?.lastTradeTimestamp ?? new Date().toISOString() };
}

async function fetchBitcoin(): Promise<BitcoinQuote> {
  const response = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true", {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`CoinGecko returned ${response.status}`);
  const payload = await response.json() as { bitcoin?: { usd?: number; usd_24h_change?: number; last_updated_at?: number } };
  const quote = payload.bitcoin;
  if (!quote || !Number.isFinite(quote.usd) || !Number.isFinite(quote.usd_24h_change)) throw new Error("CoinGecko payload is incomplete");
  return {
    price: quote.usd ?? 0,
    changePercent: quote.usd_24h_change ?? 0,
    updatedAt: quote.last_updated_at ? new Date(quote.last_updated_at * 1000).toISOString() : new Date().toISOString(),
  };
}

async function settled<T>(task: Promise<T>) {
  try {
    return { data: await task, error: null } as const;
  } catch (error) {
    return { data: null, error: error instanceof Error ? error.message : "Unknown data error" } as const;
  }
}

function unavailableFactor(key: MarketFactorKey, name: string, shortName: string, source: string, sourceUrl: string, frequency: LiveMarketFactor["frequency"], error: string): LiveMarketFactor {
  return {
    key, name, shortName, weight: FACTOR_WEIGHTS[key], score: 0,
    signal: "資料暫不可用，該因子未納入方向判讀。",
    explanation: error,
    latestValue: "—", change: "—", source, sourceUrl, frequency,
    updatedAt: "未取得", freshness: "unavailable",
  };
}

export async function fetchCurrentMarketSnapshot(): Promise<MarketSnapshot> {
  const [ndxResult, sp500Result, vixResult, creditResult, dollarResult, bitcoinResult] = await Promise.all([
    settled(fetchNasdaqNdx()),
    settled(fetchFredSeries(FRED_SERIES.sp500)),
    settled(fetchFredSeries(FRED_SERIES.vix)),
    settled(fetchFredSeries(FRED_SERIES.highYieldSpread)),
    settled(fetchFredSeries(FRED_SERIES.dollarIndex)),
    settled(fetchBitcoin()),
  ]);

  const factors: LiveMarketFactor[] = [];
  if (ndxResult.data) {
    const quote = ndxResult.data;
    factors.push({
      key: "equity", name: "股票風險偏好", shortName: "Equity", weight: FACTOR_WEIGHTS.equity,
      score: scorePercentChange(quote.changePercent),
      signal: quote.changePercent >= 0 ? "NASDAQ-100 日內走強，支持風險偏好。" : "NASDAQ-100 日內走弱，拖累風險偏好。",
      explanation: "以 Nasdaq-100 的日內百分比變化作為高 beta 股票風險偏好的即時代理。",
      latestValue: `NDX ${formatNumber(quote.last)}`, change: `${formatSigned(quote.changePercent, "%")}`,
      source: "Nasdaq Quote API", sourceUrl: "https://www.nasdaq.com/market-activity/index/ndx",
      frequency: "15 分鐘延遲", updatedAt: quote.updatedAt, freshness: "delayed",
    });
  } else if (sp500Result.data) {
    const point = sp500Result.data;
    const change = point.previous ? ((point.value / point.previous) - 1) * 100 : 0;
    factors.push({
      key: "equity", name: "股票風險偏好", shortName: "Equity", weight: FACTOR_WEIGHTS.equity,
      score: scorePercentChange(change), signal: "Nasdaq 延遲報價不可用，改用 S&P 500 日終變化。",
      explanation: "以 FRED S&P 500 日終數據作為備援股票因子。",
      latestValue: `S&P 500 ${formatNumber(point.value)}`, change: formatSigned(change, "%"),
      source: "FRED · S&P 500", sourceUrl: "https://fred.stlouisfed.org/series/SP500",
      frequency: "日終", updatedAt: point.date, freshness: dailyFreshness(point.date),
    });
  } else {
    factors.push(unavailableFactor("equity", "股票風險偏好", "Equity", "Nasdaq / FRED", "https://fred.stlouisfed.org/series/SP500", "日終", ndxResult.error ?? sp500Result.error ?? "資料來源沒有回應"));
  }

  if (vixResult.data) {
    const point = vixResult.data;
    const change = point.previous ? point.value - point.previous : 0;
    factors.push({
      key: "volatility", name: "波動率", shortName: "Volatility", weight: FACTOR_WEIGHTS.volatility,
      score: scoreVix(point.value), signal: point.value < 22 ? "VIX 處於相對受控區間。" : "VIX 高於壓力門檻，顯示避險需求上升。",
      explanation: "VIX 越低，波動率因子越支持 Risk-on；22 為本原型的中性參考位。",
      latestValue: `VIX ${point.value.toFixed(2)}`, change: formatSigned(change),
      source: "FRED · CBOE VIX", sourceUrl: "https://fred.stlouisfed.org/series/VIXCLS",
      frequency: "日終", updatedAt: point.date, freshness: dailyFreshness(point.date),
    });
  } else {
    factors.push(unavailableFactor("volatility", "波動率", "Volatility", "FRED · CBOE VIX", "https://fred.stlouisfed.org/series/VIXCLS", "日終", vixResult.error ?? "資料來源沒有回應"));
  }

  if (creditResult.data) {
    const point = creditResult.data;
    const change = point.previous ? point.value - point.previous : 0;
    factors.push({
      key: "credit", name: "信貸壓力", shortName: "Credit", weight: FACTOR_WEIGHTS.credit,
      score: scoreCreditSpread(point.value), signal: point.value < 4.5 ? "高收益債利差仍低於壓力參考位。" : "高收益債利差偏闊，信用壓力正在抬升。",
      explanation: "HY OAS 越低，代表信用風險溢酬越受控；4.5% 為本原型的中性參考位。",
      latestValue: `HY OAS ${point.value.toFixed(2)}%`, change: formatSigned(change, " pts"),
      source: "FRED · ICE BofA HY OAS", sourceUrl: "https://fred.stlouisfed.org/series/BAMLH0A0HYM2",
      frequency: "日終", updatedAt: point.date, freshness: dailyFreshness(point.date),
    });
  } else {
    factors.push(unavailableFactor("credit", "信貸壓力", "Credit", "FRED · ICE BofA HY OAS", "https://fred.stlouisfed.org/series/BAMLH0A0HYM2", "日終", creditResult.error ?? "資料來源沒有回應"));
  }

  if (dollarResult.data) {
    const point = dollarResult.data;
    const changePercent = point.previous ? ((point.value / point.previous) - 1) * 100 : 0;
    factors.push({
      key: "safeHaven", name: "美元／避險資產", shortName: "USD & havens", weight: FACTOR_WEIGHTS.safeHaven,
      score: scorePercentChange(-changePercent, 90), signal: changePercent <= 0 ? "美元未有明顯走強，避險需求受控。" : "美元上升，反映部分避險資金需求。",
      explanation: "美元指數日變化採反向計分；美元走強會降低此因子的 Risk-on 分數。",
      latestValue: `Dollar index ${point.value.toFixed(2)}`, change: formatSigned(changePercent, "%"),
      source: "FRED · Trade Weighted Dollar", sourceUrl: "https://fred.stlouisfed.org/series/DTWEXBGS",
      frequency: "日終", updatedAt: point.date, freshness: dailyFreshness(point.date),
    });
  } else {
    factors.push(unavailableFactor("safeHaven", "美元／避險資產", "USD & havens", "FRED · Trade Weighted Dollar", "https://fred.stlouisfed.org/series/DTWEXBGS", "日終", dollarResult.error ?? "資料來源沒有回應"));
  }

  if (bitcoinResult.data) {
    const quote = bitcoinResult.data;
    factors.push({
      key: "crossAsset", name: "跨資產確認", shortName: "Cross-asset", weight: FACTOR_WEIGHTS.crossAsset,
      score: scorePercentChange(quote.changePercent, 12), signal: quote.changePercent >= 0 ? "比特幣 24 小時回報為正，提供高 beta 跨資產確認。" : "比特幣 24 小時回報為負，未能確認風險偏好。",
      explanation: "以比特幣 24 小時變化作高 beta 跨資產確認；此因子並非單獨投資訊號。",
      latestValue: `BTC $${formatNumber(quote.price)}`, change: formatSigned(quote.changePercent, "%"),
      source: "CoinGecko", sourceUrl: "https://www.coingecko.com/en/coins/bitcoin",
      frequency: "分鐘級", updatedAt: quote.updatedAt, freshness: "fresh",
    });
  } else {
    factors.push(unavailableFactor("crossAsset", "跨資產確認", "CoinGecko", "CoinGecko", "https://www.coingecko.com/en/coins/bitcoin", "分鐘級", bitcoinResult.error ?? "資料來源沒有回應"));
  }

  const usableFactors = factors.filter((factor) => factor.freshness !== "unavailable");
  const compositeScore = calculateCompositeScore(factors);
  const rawConfidence = calculateConfidence(usableFactors);
  const confidence = Math.round(rawConfidence * (0.5 + (usableFactors.length / factors.length) * 0.5));
  const dataStatus = usableFactors.length === factors.length ? "fresh" : "partial";

  return {
    calculatedAt: new Date().toISOString(), compositeScore, regime: determineRegime(compositeScore), confidence,
    dataStatus, updateIntervalSeconds: 60, factors,
  };
}

export async function refreshAndStoreMarketSnapshot(force = false): Promise<MarketSnapshot> {
  if (!force && cachedSnapshot && Date.now() - cachedSnapshot.storedAt < 45_000) {
    return cachedSnapshot.snapshot;
  }
  const snapshot = await fetchCurrentMarketSnapshot();
  cachedSnapshot = { snapshot, storedAt: Date.now() };
  await db.insertMarketSnapshot(snapshot);
  return snapshot;
}
